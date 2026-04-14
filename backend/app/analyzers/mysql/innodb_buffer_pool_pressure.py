"""
Analyzer: MySQL InnoDB Buffer Pool Pressure (per-instance)

Failure mode: InnoDB buffer pool consuming too much of a host's available RAM,
causing memory pressure, OS swapping, and disk I/O spikes as pages evict to disk.

Each MySQL instance has its own buffer pool configured independently, and each host
has different amounts of available RAM. This analyzer writes one verdict per instance
so the dashboard can pinpoint exactly which node is under pressure.

What it watches:
  Metrics (required, per-instance via get_latest_metrics_per_instance):
    - mysql.buffer.pool.pressure.pct   — buffer_pool / mem_available * 100 (per host)
    - mysql.buffer.pool.bytes          — raw buffer pool size for evidence text

  Corroborating (per-instance):
    - mysql.memory.available.bytes     — absolute available RAM
    - mysql.tmp.disk.tables            — temp disk tables = memory spillover confirmed

Verdict logic (per instance):
  Critical:  pressure_pct > 90% OR sigma > critical_sigma_threshold
  Degraded:  pressure_pct > 70% OR sigma > degraded_sigma_threshold OR pct > p95
  Healthy:   within baseline bounds

Returns list[VerdictResult] — one entry per discovered MySQL instance.
"""

from datetime import datetime
from app.analyzers.base import BaseAnalyzer, VerdictResult, EvidenceItem
from app.models.models import HealthStatus, ConfidenceLevel
from app.core.config import get_settings

settings = get_settings()

DEGRADED_PCT_THRESHOLD = 70.0
CRITICAL_PCT_THRESHOLD = 90.0

# Metrics fetched per-instance via get_latest_metrics_per_instance
PER_INSTANCE_METRICS = [
    "mysql.buffer.pool.pressure.pct",
    "mysql.buffer.pool.bytes",
    "mysql.memory.available.bytes",
]

CORROBORATING_METRICS = [
    "mysql.tmp.disk.tables",
]


class InnodbBufferPoolPressureAnalyzer(BaseAnalyzer):

    ANALYZER_NAME = "mysql_innodb_buffer_pool_pressure"

    # These are still declared so can_run() works against the cluster-level metrics dict.
    # The actual per-instance fetch happens in analyze() via the adapter reference.
    REQUIRED_METRICS = [
        "mysql.buffer.pool.pressure.pct",
        "mysql.buffer.pool.bytes",
    ]

    CORROBORATING_METRICS = CORROBORATING_METRICS

    OPTIONAL_LOG_SIGNALS = []

    def analyze(
        self,
        metrics: dict[str, float],
        baselines: dict,
        log_signals: dict[str, int],
        metric_ts: datetime,
        per_instance_metrics: dict[str, dict[str, float]] | None = None,
    ) -> list[VerdictResult]:
        """
        Returns one VerdictResult per MySQL instance.

        per_instance_metrics: {instance_id: {canonical_name: value}}
        Populated by the runner before calling analyze() for per-instance analyzers.
        Falls back to a single cluster-level verdict if not provided.
        """
        if not per_instance_metrics:
            # Fallback: single cluster-level verdict from aggregated metrics
            return [self._analyze_instance(
                instance_id=None,
                pressure_pct=metrics.get("mysql.buffer.pool.pressure.pct", 0.0),
                buffer_pool_bytes=metrics.get("mysql.buffer.pool.bytes", 0.0),
                mem_available=metrics.get("mysql.memory.available.bytes"),
                tmp_disk_tables=metrics.get("mysql.tmp.disk.tables"),
                baselines=baselines,
                metric_ts=metric_ts,
            )]

        results = []
        for instance_id, inst_metrics in per_instance_metrics.items():
            pressure_pct = inst_metrics.get("mysql.buffer.pool.pressure.pct")
            if pressure_pct is None:
                continue  # no data for this instance — skip
            results.append(self._analyze_instance(
                instance_id=instance_id,
                pressure_pct=pressure_pct,
                buffer_pool_bytes=inst_metrics.get("mysql.buffer.pool.bytes", 0.0),
                mem_available=inst_metrics.get("mysql.memory.available.bytes"),
                tmp_disk_tables=inst_metrics.get("mysql.tmp.disk.tables"),
                baselines=baselines,
                metric_ts=metric_ts,
            ))
        return results

    def _analyze_instance(
        self,
        instance_id: str | None,
        pressure_pct: float,
        buffer_pool_bytes: float,
        mem_available: float | None,
        tmp_disk_tables: float | None,
        baselines: dict,
        metric_ts: datetime,
    ) -> VerdictResult:

        baseline = baselines.get("mysql.buffer.pool.pressure.pct")
        tmp_baseline = baselines.get("mysql.tmp.disk.tables")
        evidence: list[EvidenceItem] = []

        buffer_pool_gb = buffer_pool_bytes / (1024 ** 3) if buffer_pool_bytes else 0.0
        mem_available_gb = (mem_available / (1024 ** 3)) if mem_available else None

        instance_label = f" on {instance_id}" if instance_id else ""

        # ── Baseline sigma scoring ─────────────────────────────────────────────
        sigma = 0.0
        has_baseline = baseline is not None and getattr(baseline, "is_valid", False)

        if has_baseline:
            if baseline.std_dev > 0:
                sigma = (pressure_pct - baseline.p50) / baseline.std_dev
            observed_str = (
                f"Buffer pool {buffer_pool_gb:.1f}GB consuming {pressure_pct:.1f}% of available RAM"
                + (f" ({mem_available_gb:.1f}GB free)" if mem_available_gb else "")
                + f"{instance_label}, baseline p50={baseline.p50:.1f}%, p95={baseline.p95:.1f}%"
            )
            baseline_summary = (
                f"Normal pressure: {baseline.p50:.1f}% ± {baseline.std_dev:.1f}% "
                f"(p95={baseline.p95:.1f}%)"
            )
        else:
            observed_str = (
                f"Buffer pool {buffer_pool_gb:.1f}GB consuming {pressure_pct:.1f}% of available RAM"
                + (f" ({mem_available_gb:.1f}GB free)" if mem_available_gb else "")
                + f"{instance_label} — no baseline yet"
            )
            baseline_summary = "Insufficient history for baseline (< 100 samples)"

        evidence.append(EvidenceItem(
            text=f"mysql.buffer.pool.pressure.pct={pressure_pct:.1f}% sigma={sigma:.2f} (pool={buffer_pool_gb:.1f}GB){instance_label}",
            source_type="metric",
            confidence_delta=0,
        ))

        # ── Status determination ───────────────────────────────────────────────
        if not has_baseline:
            if pressure_pct >= CRITICAL_PCT_THRESHOLD:
                status = HealthStatus.critical
                root_cause = (
                    f"InnoDB buffer pool ({buffer_pool_gb:.1f}GB) consuming {pressure_pct:.1f}% of "
                    f"available RAM{instance_label}. OS memory pressure likely — swapping may occur."
                )
            elif pressure_pct >= DEGRADED_PCT_THRESHOLD:
                status = HealthStatus.degraded
                root_cause = (
                    f"InnoDB buffer pool ({buffer_pool_gb:.1f}GB) consuming {pressure_pct:.1f}% of "
                    f"available RAM{instance_label}. Risk of memory pressure under increased load."
                )
            else:
                status = HealthStatus.healthy
                root_cause = f"InnoDB buffer pool pressure within acceptable range at {pressure_pct:.1f}%{instance_label}."
            confidence = ConfidenceLevel.low
        elif sigma > settings.critical_sigma_threshold or pressure_pct >= CRITICAL_PCT_THRESHOLD:
            status = HealthStatus.critical
            root_cause = (
                f"InnoDB buffer pool ({buffer_pool_gb:.1f}GB) at critical pressure: "
                f"{pressure_pct:.1f}% of available RAM ({sigma:.1f}σ above baseline){instance_label}. "
                f"OS will begin paging — expect severe I/O latency and query timeouts."
            )
            confidence = ConfidenceLevel.medium
        elif sigma > settings.degraded_sigma_threshold or (has_baseline and pressure_pct > baseline.p95):
            status = HealthStatus.degraded
            root_cause = (
                f"InnoDB buffer pool pressure elevated at {pressure_pct:.1f}% of available RAM "
                f"({sigma:.1f}σ above baseline p50={baseline.p50:.1f}%){instance_label}. "
                f"Buffer pool ({buffer_pool_gb:.1f}GB) competing with OS and other processes for RAM."
            )
            confidence = ConfidenceLevel.medium
        else:
            status = HealthStatus.healthy
            root_cause = (
                f"InnoDB buffer pool pressure within baseline at {pressure_pct:.1f}% "
                f"({sigma:.1f}σ from p50){instance_label}."
            )
            confidence = ConfidenceLevel.medium

        # ── Corroborating: tmp disk tables ────────────────────────────────────
        if tmp_disk_tables is not None and status != HealthStatus.healthy:
            tmp_sigma = 0.0
            if tmp_baseline and tmp_baseline.std_dev > 0:
                tmp_sigma = (tmp_disk_tables - tmp_baseline.p50) / tmp_baseline.std_dev
            if tmp_sigma > 1.5 or tmp_disk_tables > 1000:
                evidence.append(EvidenceItem(
                    text=f"mysql.tmp.disk.tables={tmp_disk_tables:.0f} (sigma={tmp_sigma:.1f}) — memory spillover to disk confirmed",
                    source_type="metric",
                    confidence_delta=1,
                ))
                if confidence == ConfidenceLevel.medium:
                    confidence = ConfidenceLevel.high

        # ── Corroborating: available RAM ──────────────────────────────────────
        if mem_available is not None:
            if mem_available < 1 * (1024 ** 3) and status != HealthStatus.healthy:
                evidence.append(EvidenceItem(
                    text=f"mysql.memory.available.bytes={mem_available_gb:.2f}GB — critically low free RAM{instance_label}",
                    source_type="metric",
                    confidence_delta=1,
                ))
                if confidence == ConfidenceLevel.medium:
                    confidence = ConfidenceLevel.high
            else:
                evidence.append(EvidenceItem(
                    text=f"mysql.memory.available.bytes={mem_available_gb:.1f}GB free{instance_label}",
                    source_type="metric",
                    confidence_delta=0,
                ))

        recommendation = (
            "Check current buffer pool usage: "
            "SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_%'; "
            "If buffer pool hit ratio < 99%, pool may be undersized. "
            "Consider reducing innodb_buffer_pool_size if server is memory-constrained, "
            "or adding RAM and increasing pool size if hit ratio is low. "
            "Check for large full-table scans consuming buffer pool: "
            "SELECT * FROM sys.statements_with_full_table_scans LIMIT 10;"
        )

        return VerdictResult(
            analyzer_name=self.ANALYZER_NAME,
            status=status,
            observed=observed_str,
            baseline_summary=baseline_summary,
            root_cause=root_cause,
            recommendation=recommendation,
            confidence=confidence,
            evidence=evidence,
            metric_ts=metric_ts,
            instance_id=instance_id,
        )
