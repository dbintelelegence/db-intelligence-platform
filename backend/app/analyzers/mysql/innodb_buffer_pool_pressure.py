"""
Analyzer: MySQL InnoDB Buffer Pool Pressure (per-instance)

Failure mode: InnoDB buffer pool sized too large relative to total host RAM,
leaving insufficient memory for the OS, connections, and other processes,
leading to swapping and I/O latency.

Ratio: innodb_buffer_pool_size / node_memory_MemTotal_bytes × 100
This is a configuration sizing check — how much of total host RAM is
allocated to the buffer pool. Recommended ceiling: 75-80% of total RAM.

Each MySQL instance is evaluated independently (different hosts have
different RAM). One verdict per instance.

What it watches:
  Metrics (required, per-instance via get_latest_metrics_per_instance):
    - mysql.buffer.pool.pressure.pct   — buffer_pool / mem_total * 100 (per host)
    - mysql.buffer.pool.bytes          — configured buffer pool size
    - mysql.memory.total.bytes         — total host RAM

  Corroborating (per-instance):
    - mysql.memory.available.bytes     — currently free RAM (secondary signal)
    - mysql.tmp.disk.tables            — memory spillover confirmed

Verdict logic (per instance):
  Critical:  pct > 85% OR sigma > critical_sigma_threshold
             (buffer pool consuming > 85% of total RAM — OS and connections starved)
  Degraded:  pct > 75% OR sigma > degraded_sigma_threshold OR pct > p95
             (above recommended 75% ceiling)
  Healthy:   <= 75% of total RAM

Returns list[VerdictResult] — one entry per discovered MySQL instance.
"""

from datetime import datetime
from app.analyzers.base import BaseAnalyzer, VerdictResult, EvidenceItem
from app.models.models import HealthStatus, ConfidenceLevel
from app.core.config import get_settings

settings = get_settings()

# Recommended ceiling: buffer pool should not exceed 75-80% of total RAM.
# Above 85% leaves < 15% for OS, connections, and other processes.
DEGRADED_PCT_THRESHOLD = 75.0
CRITICAL_PCT_THRESHOLD = 85.0

# Metrics fetched per-instance via get_latest_metrics_per_instance
PER_INSTANCE_METRICS = [
    "mysql.buffer.pool.pressure.pct",
    "mysql.buffer.pool.bytes",
    "mysql.memory.total.bytes",
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
                mem_total=metrics.get("mysql.memory.total.bytes"),
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
                mem_total=inst_metrics.get("mysql.memory.total.bytes"),
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
        mem_total: float | None,
        mem_available: float | None,
        tmp_disk_tables: float | None,
        baselines: dict,
        metric_ts: datetime,
    ) -> VerdictResult:

        baseline = baselines.get("mysql.buffer.pool.pressure.pct")
        tmp_baseline = baselines.get("mysql.tmp.disk.tables")
        evidence: list[EvidenceItem] = []

        buffer_pool_gb = buffer_pool_bytes / (1024 ** 3) if buffer_pool_bytes else 0.0
        mem_total_gb = (mem_total / (1024 ** 3)) if mem_total else None
        mem_available_gb = (mem_available / (1024 ** 3)) if mem_available else None

        instance_label = f" on {instance_id}" if instance_id else ""

        # ── Baseline sigma scoring ─────────────────────────────────────────────
        sigma = 0.0
        has_baseline = baseline is not None and getattr(baseline, "is_valid", False)

        mem_context = (
            f" of {mem_total_gb:.0f}GB total RAM" if mem_total_gb else ""
        )

        if has_baseline:
            if baseline.std_dev > 0:
                sigma = (pressure_pct - baseline.p50) / baseline.std_dev
            observed_str = (
                f"Buffer pool {buffer_pool_gb:.1f}GB = {pressure_pct:.1f}%{mem_context}{instance_label}"
                f", baseline p50={baseline.p50:.1f}%, p95={baseline.p95:.1f}%"
            )
            baseline_summary = (
                f"Normal allocation: {baseline.p50:.1f}% ± {baseline.std_dev:.1f}% "
                f"of total RAM (p95={baseline.p95:.1f}%)"
            )
        else:
            observed_str = (
                f"Buffer pool {buffer_pool_gb:.1f}GB = {pressure_pct:.1f}%{mem_context}{instance_label}"
                " — no baseline yet"
            )
            baseline_summary = "Insufficient history for baseline (< 100 samples)"

        evidence.append(EvidenceItem(
            text=f"mysql.buffer.pool.pressure.pct={pressure_pct:.1f}% (pool={buffer_pool_gb:.1f}GB / total={mem_total_gb:.0f}GB){instance_label}" if mem_total_gb else f"mysql.buffer.pool.pressure.pct={pressure_pct:.1f}%{instance_label}",
            source_type="metric",
            confidence_delta=0,
        ))

        # ── Status determination ───────────────────────────────────────────────
        if not has_baseline:
            if pressure_pct >= CRITICAL_PCT_THRESHOLD:
                status = HealthStatus.critical
                root_cause = (
                    f"InnoDB buffer pool ({buffer_pool_gb:.1f}GB) allocated {pressure_pct:.1f}%{mem_context}{instance_label}. "
                    f"Exceeds recommended 85% ceiling — OS, connections, and other processes are starved for RAM."
                )
            elif pressure_pct >= DEGRADED_PCT_THRESHOLD:
                status = HealthStatus.degraded
                root_cause = (
                    f"InnoDB buffer pool ({buffer_pool_gb:.1f}GB) allocated {pressure_pct:.1f}%{mem_context}{instance_label}. "
                    f"Above recommended 75% ceiling — risk of memory pressure under increased load."
                )
            else:
                status = HealthStatus.healthy
                root_cause = (
                    f"InnoDB buffer pool ({buffer_pool_gb:.1f}GB) allocated {pressure_pct:.1f}%{mem_context}{instance_label}. "
                    f"Within recommended sizing range."
                )
            confidence = ConfidenceLevel.low
        elif sigma > settings.critical_sigma_threshold or pressure_pct >= CRITICAL_PCT_THRESHOLD:
            status = HealthStatus.critical
            root_cause = (
                f"InnoDB buffer pool ({buffer_pool_gb:.1f}GB) allocated {pressure_pct:.1f}%{mem_context} "
                f"({sigma:.1f}σ above baseline){instance_label}. "
                f"Exceeds 85% ceiling — OS and other processes are starved for RAM."
            )
            confidence = ConfidenceLevel.medium
        elif sigma > settings.degraded_sigma_threshold or (has_baseline and pressure_pct > baseline.p95):
            status = HealthStatus.degraded
            root_cause = (
                f"InnoDB buffer pool ({buffer_pool_gb:.1f}GB) allocated {pressure_pct:.1f}%{mem_context} "
                f"({sigma:.1f}σ above baseline p50={baseline.p50:.1f}%){instance_label}. "
                f"Above recommended 75% ceiling."
            )
            confidence = ConfidenceLevel.medium
        else:
            status = HealthStatus.healthy
            root_cause = (
                f"InnoDB buffer pool ({buffer_pool_gb:.1f}GB) allocated {pressure_pct:.1f}%{mem_context} "
                f"({sigma:.1f}σ from baseline){instance_label}. Within recommended sizing range."
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

        # ── Corroborating: available RAM (secondary signal) ───────────────────
        if mem_available is not None:
            if mem_available < 1 * (1024 ** 3) and status != HealthStatus.healthy:
                evidence.append(EvidenceItem(
                    text=f"mysql.memory.available.bytes={mem_available_gb:.2f}GB currently free — critically low{instance_label}",
                    source_type="metric",
                    confidence_delta=1,
                ))
                if confidence == ConfidenceLevel.medium:
                    confidence = ConfidenceLevel.high
            else:
                evidence.append(EvidenceItem(
                    text=f"mysql.memory.available.bytes={mem_available_gb:.1f}GB currently free{instance_label}",
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
