"""
Analyzer: Shard Allocation Failure (Elasticsearch)

Failure mode: Shards stuck unassigned, causing data unavailability and
cluster degradation.

What it watches:
  Metrics (required):
    - cluster.shards.unassigned     — shards with no assigned node
    - cluster.health.status         — 0=green, 0.333=yellow, 0.666=red (numeric encoding)

  Metrics (corroborating):
    - cluster.shards.relocating     — shards in motion (high = recovery in progress)
    - cluster.shards.initializing   — shards warming up (high = recovery in progress)
    - cluster.shards.active         — total active shards (drop = data loss risk)

  Log signals (optional, boost confidence):
    - shard_failed               — explicit shard failure event in logs
    - node_left                  — node departure often triggers unassigned shards
    - allocation_explain_error   — allocation decider rejected placement

Verdict logic:
  Critical:
    - cluster.health.status == red (>= 0.6) AND unassigned > 0
    - OR unassigned sigma score > critical_sigma_threshold

  Degraded:
    - cluster.health.status == yellow (>= 0.3) AND unassigned > 0
    - OR unassigned > baseline p95
    - OR unassigned sigma score > degraded_sigma_threshold

  Healthy:
    - unassigned == 0 AND status green

Confidence:
  Base: MEDIUM if both primary metrics present and anomalous
  Base: LOW if only unassigned is anomalous (status missing)
  +1 if shard_failed log signal present
  +1 if node_left log signal corroborates (explains cause)
  Maximum: HIGH   Minimum: LOW
"""

from datetime import datetime

from app.analyzers.base import BaseAnalyzer, EvidenceItem, VerdictResult
from app.core.config import get_settings
from app.models.models import ConfidenceLevel, HealthStatus

settings = get_settings()

# cluster.health.status encoding after adapter normalisation:
# The adapter fetches elasticsearch_cluster_health_status{color="green"} and
# takes max() across nodes. Value = 1.0 means cluster is green, 0.0 means
# yellow or red. We cannot distinguish yellow from red without fetching those
# separately — so 0.0 is treated as "not green" (at minimum yellow).
_STATUS_GREEN = 1.0


class ShardAllocationAnalyzer(BaseAnalyzer):

    ANALYZER_NAME = "shard_allocation_failure"

    REQUIRED_METRICS = [
        "cluster.shards.unassigned",
        "cluster.health.status",
    ]

    CORROBORATING_METRICS = [
        "cluster.shards.relocating",
        "cluster.shards.initializing",
        "cluster.shards.active",
    ]

    OPTIONAL_LOG_SIGNALS = [
        "shard_failed",
        "node_left",
        "allocation_explain_error",
    ]

    def analyze(
        self,
        metrics: dict[str, float],
        baselines: dict,
        log_signals: dict[str, int],
        metric_ts: datetime,
    ) -> VerdictResult:

        unassigned = metrics["cluster.shards.unassigned"]
        health_status_val = metrics["cluster.health.status"]

        relocating = metrics.get("cluster.shards.relocating", 0.0)
        initializing = metrics.get("cluster.shards.initializing", 0.0)
        active = metrics.get("cluster.shards.active")

        unassigned_baseline = baselines.get("cluster.shards.unassigned")
        active_baseline = baselines.get("cluster.shards.active")

        evidence: list[EvidenceItem] = []
        has_corroborating = relocating is not None or initializing is not None

        # ── Compute deviations ────────────────────────────────────────────────
        unassigned_sigma = 0.0
        unassigned_vs_p95 = False

        if unassigned_baseline and unassigned_baseline.std_dev > 0:
            unassigned_sigma = (
                (unassigned - unassigned_baseline.mean) / unassigned_baseline.std_dev
            )
            unassigned_vs_p95 = unassigned > unassigned_baseline.p95
            evidence.append(EvidenceItem(
                text=(
                    f"cluster.shards.unassigned={unassigned:.0f} "
                    f"vs baseline p50={unassigned_baseline.p50:.0f} "
                    f"p95={unassigned_baseline.p95:.0f} "
                    f"(sigma={unassigned_sigma:+.1f})"
                ),
                source_type="metric",
                confidence_delta=0,
            ))
        elif unassigned_baseline and unassigned_baseline.std_dev == 0:
            # Baseline is all-zeros — any non-zero value is an anomaly
            unassigned_vs_p95 = unassigned > 0
            if unassigned > 0:
                unassigned_sigma = settings.critical_sigma_threshold + 1  # treat as extreme
            evidence.append(EvidenceItem(
                text=(
                    f"cluster.shards.unassigned={unassigned:.0f} "
                    f"(baseline is always 0 — any unassigned shard is an anomaly)"
                ),
                source_type="metric",
                confidence_delta=0,
            ))
        else:
            evidence.append(EvidenceItem(
                text=f"cluster.shards.unassigned={unassigned:.0f} (no baseline yet)",
                source_type="metric",
                confidence_delta=0,
            ))

        # Health status interpretation:
        # adapter returns max(color="green") across nodes — 1.0=green, 0.0=not-green
        is_green = health_status_val >= _STATUS_GREEN
        is_not_green = not is_green
        status_label = "green" if is_green else "yellow/red"
        evidence.append(EvidenceItem(
            text=f"cluster.health.status={status_label} (encoded={health_status_val:.3f})",
            source_type="metric",
            confidence_delta=0,
        ))

        # Corroborating metrics
        if relocating is not None:
            evidence.append(EvidenceItem(
                text=f"cluster.shards.relocating={relocating:.0f}",
                source_type="metric",
                confidence_delta=0,
            ))
        if initializing is not None:
            evidence.append(EvidenceItem(
                text=f"cluster.shards.initializing={initializing:.0f}",
                source_type="metric",
                confidence_delta=0,
            ))
        if active is not None and active_baseline:
            active_drop_pct = (
                ((active_baseline.p50 - active) / active_baseline.p50 * 100)
                if active_baseline.p50 > 0 else 0
            )
            if active_drop_pct > 5:
                evidence.append(EvidenceItem(
                    text=(
                        f"cluster.shards.active={active:.0f} "
                        f"vs baseline p50={active_baseline.p50:.0f} "
                        f"({active_drop_pct:.1f}% below normal — data availability risk)"
                    ),
                    source_type="metric",
                    confidence_delta=0,
                ))

        # ── Determine status ──────────────────────────────────────────────────
        # Critical: not green AND unassigned shards present AND extreme sigma
        is_critical = (
            is_not_green and unassigned > 0 and unassigned_sigma > settings.critical_sigma_threshold
        ) or unassigned_sigma > settings.critical_sigma_threshold

        is_degraded = (
            (is_not_green and unassigned > 0)
            or unassigned_vs_p95
            or unassigned_sigma > settings.degraded_sigma_threshold
        )

        if is_critical:
            status = HealthStatus.critical
        elif is_degraded:
            status = HealthStatus.degraded
        else:
            status = HealthStatus.healthy

        # ── Base confidence ───────────────────────────────────────────────────
        # No baseline → LOW. Both primary metrics anomalous → MEDIUM.
        # Healthy with baselines → HIGH.
        has_unassigned_baseline = unassigned_baseline is not None

        if not has_unassigned_baseline:
            confidence_level = 0  # LOW
        elif status == HealthStatus.healthy:
            confidence_level = 2  # HIGH — cluster is clean
        elif is_not_green:
            confidence_level = 1  # MEDIUM — both primary signals agree
        else:
            confidence_level = 0  # LOW — only unassigned count is off

        # ── Log signal corroboration ──────────────────────────────────────────
        shard_failed_count = log_signals.get("shard_failed", 0)
        node_left_count = log_signals.get("node_left", 0)
        alloc_error_count = log_signals.get("allocation_explain_error", 0)

        if shard_failed_count > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"shard_failed: {shard_failed_count} events — direct confirmation of allocation failure",
                source_type="log_signal",
                confidence_delta=1,
            ))

        if node_left_count > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"node_left: {node_left_count} events — node departure is the likely trigger",
                source_type="log_signal",
                confidence_delta=1,
            ))

        if alloc_error_count > 0:
            evidence.append(EvidenceItem(
                text=f"allocation_explain_error: {alloc_error_count} events — allocation decider rejected placement",
                source_type="log_signal",
                confidence_delta=0,
            ))

        confidence_map = {0: ConfidenceLevel.low, 1: ConfidenceLevel.medium, 2: ConfidenceLevel.high}
        confidence = confidence_map[confidence_level]

        # ── Human-readable fields ─────────────────────────────────────────────
        if status == HealthStatus.healthy:
            observed = (
                f"Cluster is {status_label} with {unassigned:.0f} unassigned shards"
            )
            root_cause = "No shard allocation failure detected"
            recommendation = "No action required"
        else:
            recovery_hint = ""
            if relocating > 0 or initializing > 0:
                recovery_hint = (
                    f" Recovery appears in progress: "
                    f"{relocating:.0f} relocating, {initializing:.0f} initializing."
                )

            observed = (
                f"Cluster is {status_label} with {unassigned:.0f} unassigned shard(s)."
                f"{recovery_hint}"
            )

            if node_left_count > 0:
                root_cause = (
                    f"Node departure ({node_left_count} events) left shards with no eligible target. "
                    "Elasticsearch cannot allocate replicas when insufficient nodes remain "
                    "or disk/allocation filter constraints prevent rebalancing."
                )
            elif shard_failed_count > 0:
                root_cause = (
                    "Shard failure events indicate a node or disk error prevented the primary "
                    "from being written or the replica from being promoted. "
                    "Check node logs for I/O errors or JVM crashes."
                )
            else:
                root_cause = (
                    "Unassigned shards indicate Elasticsearch cannot find an eligible node. "
                    "Common causes: disk watermark breached, allocation filter mismatch, "
                    "or insufficient replicas for the current node count."
                )

            recommendation = (
                "Run GET /_cluster/allocation/explain to identify the specific decider blocking allocation. "
                "Check disk usage on all nodes (high watermark = 85%, flood stage = 95%). "
                "If a node left recently, verify it rejoined or reduce replica count to match node count."
            )

        if unassigned_baseline:
            baseline_summary = (
                f"Unassigned shards normally {unassigned_baseline.p50:.0f}–{unassigned_baseline.p95:.0f} "
                f"(p50–p95 over baseline window)"
            )
        else:
            baseline_summary = "No baseline established yet — requires 100+ samples"

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
