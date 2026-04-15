"""
Analyzer: Disk Watermark (Elasticsearch)

Failure mode: Elasticsearch enforces three disk watermarks that trigger
progressively severe protective actions:

  Low  watermark (85%): ES stops allocating new shards to the node.
                        Unassigned shards may accumulate.
  High watermark (90%): ES attempts to relocate shards off the node.
                        Causes heavy network/IO as shards move.
  Flood watermark (95%): ES makes ALL indices on the node read-only.
                         Writes fail immediately for customers.

This analyzer fires BEFORE customers see write failures.

What it watches:
  Metrics (required):
    - fs.total.available.bytes   — free space remaining on data path
    - fs.total.total.bytes       — total disk capacity

  Metrics (corroborating):
    - cluster.shards.unassigned  — unassigned shards often caused by disk watermark
    - disk.io.time.seconds       — I/O saturation accompanying disk pressure

  Log signals (optional):
    - disk_watermark_breach       — ES log confirms watermark crossed
    - shard_failed                — shards failing due to disk full

Verdict logic:
  Critical  (flood stage):  disk_used_pct >= 92% OR sigma > critical_threshold
  Degraded  (high stage):   disk_used_pct >= 87% OR sigma > degraded_threshold
  Healthy:                  disk_used_pct < 87% AND within baseline

Note: thresholds are slightly inside ES defaults to give early warning.

Confidence:
  No baseline: LOW — uses absolute thresholds only
  Baseline present, one metric anomalous: MEDIUM
  Baseline + unassigned shards corroborate: HIGH
  +1 if disk_watermark_breach log present (direct confirmation)
"""

from datetime import datetime

from app.analyzers.base import BaseAnalyzer, EvidenceItem, VerdictResult
from app.core.config import get_settings
from app.models.models import ConfidenceLevel, HealthStatus

settings = get_settings()

# ES default watermark thresholds (slightly inside to warn early)
WARN_PCT   = 87.0   # low watermark starts at 85% — warn at 87%
HIGH_PCT   = 92.0   # flood stage at 95% — warn at 92%


class DiskWatermarkAnalyzer(BaseAnalyzer):

    ANALYZER_NAME = "disk_watermark"

    REQUIRED_METRICS = [
        "fs.total.available.bytes",
        "fs.total.total.bytes",
    ]

    CORROBORATING_METRICS = [
        "cluster.shards.unassigned",
        "disk.io.time.seconds",
    ]

    OPTIONAL_LOG_SIGNALS = [
        "disk_watermark_breach",
        "shard_failed",
    ]

    def analyze(
        self,
        metrics: dict[str, float],
        baselines: dict,
        log_signals: dict[str, int],
        metric_ts: datetime,
    ) -> VerdictResult:

        available = metrics["fs.total.available.bytes"]
        total     = metrics["fs.total.total.bytes"]

        # Guard against zero total (misconfigured exporter)
        if total <= 0:
            return VerdictResult(
                analyzer_name=self.ANALYZER_NAME,
                status=HealthStatus.unknown,
                observed="fs.total.total.bytes is 0 — metric may be misconfigured",
                baseline_summary="Cannot assess disk usage without total bytes",
                root_cause="Disk metric reporting issue",
                recommendation="Verify node_filesystem_size_bytes is being scraped correctly",
                confidence=ConfidenceLevel.low,
                metric_ts=metric_ts,
            )

        used_pct = ((total - available) / total) * 100.0
        available_gb = available / (1024 ** 3)
        total_gb = total / (1024 ** 3)

        unassigned = metrics.get("cluster.shards.unassigned", 0.0)
        disk_io    = metrics.get("disk.io.time.seconds")

        # Baselines
        available_baseline = baselines.get("fs.total.available.bytes")
        evidence: list[EvidenceItem] = []

        # ── Primary evidence ──────────────────────────────────────────────────
        evidence.append(EvidenceItem(
            text=(
                f"disk used {used_pct:.1f}% "
                f"({available_gb:.1f} GB free of {total_gb:.1f} GB)"
            ),
            source_type="metric",
            confidence_delta=0,
        ))

        # ── Sigma scoring against baseline ────────────────────────────────────
        sigma = 0.0
        has_baseline = available_baseline is not None

        if has_baseline and available_baseline.std_dev > 0:
            # Sigma on available bytes — negative sigma means less space than normal
            sigma = (available - available_baseline.mean) / available_baseline.std_dev
            evidence.append(EvidenceItem(
                text=(
                    f"fs.total.available.bytes: {available_gb:.1f} GB "
                    f"vs baseline p50={available_baseline.p50 / (1024**3):.1f} GB "
                    f"(sigma={sigma:+.1f})"
                ),
                source_type="metric",
                confidence_delta=0,
            ))

        # ── Corroborating: unassigned shards ─────────────────────────────────
        if unassigned > 0:
            evidence.append(EvidenceItem(
                text=(
                    f"cluster.shards.unassigned={unassigned:.0f} — "
                    "unassigned shards often indicate low watermark breach"
                ),
                source_type="metric",
                confidence_delta=1,
            ))

        if disk_io is not None:
            evidence.append(EvidenceItem(
                text=f"disk.io.time.seconds={disk_io:.2f}",
                source_type="metric",
                confidence_delta=0,
            ))

        # ── Status determination ──────────────────────────────────────────────
        # Absolute thresholds come first (disk is dangerous without baselines).
        # Sigma augments when baseline is available.
        abs_critical = used_pct >= HIGH_PCT
        abs_degraded = used_pct >= WARN_PCT

        # sigma is negative when less space than baseline — more negative = worse
        sigma_critical = has_baseline and sigma < -settings.critical_sigma_threshold
        sigma_degraded = has_baseline and sigma < -settings.degraded_sigma_threshold

        if abs_critical or sigma_critical:
            status = HealthStatus.critical
        elif abs_degraded or sigma_degraded:
            status = HealthStatus.degraded
        else:
            status = HealthStatus.healthy

        # ── Confidence ────────────────────────────────────────────────────────
        if not has_baseline:
            confidence_level = 0  # LOW — absolute only
        elif status == HealthStatus.healthy:
            confidence_level = 2  # HIGH — clean
        else:
            confidence_level = 1  # MEDIUM — anomaly detected

        # Unassigned shards corroborate disk as the cause
        if unassigned > 0 and status != HealthStatus.healthy:
            confidence_level = min(confidence_level + 1, 2)

        # Log signal: direct confirmation
        watermark_events = log_signals.get("disk_watermark_breach", 0)
        shard_failed_events = log_signals.get("shard_failed", 0)

        if watermark_events > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"disk_watermark_breach: {watermark_events} log events — direct confirmation",
                source_type="log_signal",
                confidence_delta=1,
            ))
        if shard_failed_events > 0:
            evidence.append(EvidenceItem(
                text=f"shard_failed: {shard_failed_events} events — may be caused by disk full",
                source_type="log_signal",
                confidence_delta=0,
            ))

        confidence_map = {0: ConfidenceLevel.low, 1: ConfidenceLevel.medium, 2: ConfidenceLevel.high}
        confidence = confidence_map[confidence_level]

        # ── Human-readable fields ─────────────────────────────────────────────
        if has_baseline:
            baseline_summary = (
                f"Normal available space: "
                f"{available_baseline.p50 / (1024**3):.1f}–"
                f"{available_baseline.p95 / (1024**3):.1f} GB "
                f"(p50–p95 over baseline window)"
            )
        else:
            baseline_summary = "No baseline established yet — using absolute thresholds only"

        if status == HealthStatus.healthy:
            observed = (
                f"Disk usage {used_pct:.1f}% — {available_gb:.1f} GB free. "
                "Within safe limits (below low watermark)."
            )
            root_cause = "No disk watermark pressure detected"
            recommendation = "No action required"

        elif status == HealthStatus.degraded:
            observed = (
                f"Disk usage {used_pct:.1f}% — only {available_gb:.1f} GB free. "
                "Approaching or past the low watermark (85%). "
                "Elasticsearch will stop allocating new shards to affected nodes."
            )
            root_cause = (
                f"Disk usage at {used_pct:.1f}% is approaching the Elasticsearch low watermark (85%). "
                "New shard allocation to this node will be blocked. "
                "If usage reaches 90% (high watermark), ES will relocate existing shards off the node."
            )
            recommendation = (
                "Immediate: identify and delete old indices or snapshots to free space. "
                "Use GET /_cat/indices?v&s=store.size:desc to find largest indices. "
                "Consider increasing disk capacity or adding nodes. "
                "Monitor: GET /_cluster/stats?human to track disk usage per node."
            )

        else:  # critical
            observed = (
                f"CRITICAL: Disk usage {used_pct:.1f}% — only {available_gb:.1f} GB free. "
                "At or near the flood stage watermark (95%). "
                "Elasticsearch may have set ALL indices to read-only."
            )
            root_cause = (
                f"Disk usage at {used_pct:.1f}% has reached or exceeded the Elasticsearch flood stage "
                "watermark (95%). The cluster will have automatically set index.blocks.read_only_allow_delete=true "
                "on all indices. Write operations are failing for all customers on this node."
            )
            recommendation = (
                "URGENT: Free disk space immediately — delete unneeded indices or snapshots. "
                "After freeing space, remove the read-only block: "
                "PUT /_all/_settings {\"index.blocks.read_only_allow_delete\": null}. "
                "Then force allocation: POST /_cluster/reroute?retry_failed=true. "
                "Long-term: set up ILM policies or add disk capacity."
            )

        return VerdictResult(
            analyzer_name=self.ANALYZER_NAME,
            status=status,
            observed=observed,
            baseline_summary=baseline_summary,
            root_cause=root_cause,
            recommendation=recommendation,
            confidence=confidence,
            evidence=evidence,
            metric_ts=metric_ts,
        )
