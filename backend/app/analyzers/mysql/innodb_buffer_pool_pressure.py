"""
Analyzer: MySQL InnoDB Buffer Pool Pressure

Failure mode: InnoDB buffer pool consuming too much of available RAM,
causing memory pressure, OS swapping, and disk I/O spikes as pages are
evicted to disk.

What it watches:
  Metrics (required):
    - mysql.buffer.pool.pressure.pct   — buffer_pool / mem_available * 100 (CUSTOM_QUERY)
    - mysql.buffer.pool.bytes          — raw buffer pool size for evidence text

  Corroborating:
    - mysql.memory.available.bytes     — absolute available RAM
    - mysql.tmp.disk.tables            — temp disk tables = memory spillover confirmed
    - mysql.select.full.join           — large scans competing for buffer pool pages

Verdict logic:
  Status determined by buffer_pool_pressure_pct deviation from baseline.

  Critical:  sigma > critical_sigma_threshold OR pct > 90%
             (buffer pool consuming > 90% of available RAM → swapping imminent)
  Degraded:  sigma > degraded_sigma_threshold OR pct > p95 baseline OR pct > 70%
  Healthy:   within baseline bounds

Confidence:
  MEDIUM if pressure pct alone is anomalous
  +1 if tmp.disk.tables elevated (memory spillover confirmed)
  +1 if available.bytes is critically low (< 10% of total RAM)
  Maximum: HIGH   Minimum: LOW
"""

from datetime import datetime
from app.analyzers.base import BaseAnalyzer, VerdictResult, EvidenceItem
from app.models.models import HealthStatus, ConfidenceLevel
from app.core.config import get_settings

settings = get_settings()

# Buffer pool pressure thresholds (used only when no baseline available)
DEGRADED_PCT_THRESHOLD = 70.0
CRITICAL_PCT_THRESHOLD = 90.0


class InnodbBufferPoolPressureAnalyzer(BaseAnalyzer):

    ANALYZER_NAME = "mysql_innodb_buffer_pool_pressure"

    REQUIRED_METRICS = [
        "mysql.buffer.pool.pressure.pct",
        "mysql.buffer.pool.bytes",
    ]

    CORROBORATING_METRICS = [
        "mysql.memory.available.bytes",
        "mysql.tmp.disk.tables",
        "mysql.select.full.join",
    ]

    OPTIONAL_LOG_SIGNALS = []

    def analyze(
        self,
        metrics: dict[str, float],
        baselines: dict,
        log_signals: dict[str, int],
        metric_ts: datetime,
    ) -> VerdictResult:

        pressure_pct = metrics["mysql.buffer.pool.pressure.pct"]
        buffer_pool_bytes = metrics["mysql.buffer.pool.bytes"]
        mem_available = metrics.get("mysql.memory.available.bytes")
        tmp_disk_tables = metrics.get("mysql.tmp.disk.tables")
        full_joins = metrics.get("mysql.select.full.join")

        baseline = baselines.get("mysql.buffer.pool.pressure.pct")
        tmp_baseline = baselines.get("mysql.tmp.disk.tables")
        evidence: list[EvidenceItem] = []

        buffer_pool_gb = buffer_pool_bytes / (1024 ** 3)
        mem_available_gb = (mem_available / (1024 ** 3)) if mem_available else None

        # ── Baseline sigma scoring ─────────────────────────────────────────────
        sigma = 0.0
        has_baseline = baseline is not None and getattr(baseline, "is_valid", False)

        if has_baseline:
            if baseline.std_dev > 0:
                sigma = (pressure_pct - baseline.p50) / baseline.std_dev
            observed_str = (
                f"Buffer pool {buffer_pool_gb:.1f}GB consuming {pressure_pct:.1f}% of available RAM"
                + (f" ({mem_available_gb:.1f}GB free)" if mem_available_gb else "")
                + f", baseline p50={baseline.p50:.1f}%, p95={baseline.p95:.1f}%"
            )
            baseline_summary = (
                f"Normal pressure: {baseline.p50:.1f}% ± {baseline.std_dev:.1f}% "
                f"(p95={baseline.p95:.1f}%)"
            )
        else:
            observed_str = (
                f"Buffer pool {buffer_pool_gb:.1f}GB consuming {pressure_pct:.1f}% of available RAM"
                + (f" ({mem_available_gb:.1f}GB free)" if mem_available_gb else "")
                + " — no baseline yet"
            )
            baseline_summary = "Insufficient history for baseline (< 100 samples)"

        evidence.append(EvidenceItem(
            text=f"mysql.buffer.pool.pressure.pct={pressure_pct:.1f}% sigma={sigma:.2f} (pool={buffer_pool_gb:.1f}GB)",
            source_type="metric",
            confidence_delta=0,
        ))

        # ── Status determination ───────────────────────────────────────────────
        if not has_baseline:
            if pressure_pct >= CRITICAL_PCT_THRESHOLD:
                status = HealthStatus.critical
                root_cause = (
                    f"InnoDB buffer pool ({buffer_pool_gb:.1f}GB) consuming {pressure_pct:.1f}% of "
                    f"available RAM. OS memory pressure likely — swapping may occur."
                )
            elif pressure_pct >= DEGRADED_PCT_THRESHOLD:
                status = HealthStatus.degraded
                root_cause = (
                    f"InnoDB buffer pool ({buffer_pool_gb:.1f}GB) consuming {pressure_pct:.1f}% of "
                    f"available RAM. Risk of memory pressure under increased load."
                )
            else:
                status = HealthStatus.healthy
                root_cause = f"InnoDB buffer pool pressure within acceptable range at {pressure_pct:.1f}%."
            confidence = ConfidenceLevel.low
        elif sigma > settings.critical_sigma_threshold or pressure_pct >= CRITICAL_PCT_THRESHOLD:
            status = HealthStatus.critical
            root_cause = (
                f"InnoDB buffer pool ({buffer_pool_gb:.1f}GB) at critical pressure: "
                f"{pressure_pct:.1f}% of available RAM ({sigma:.1f}σ above baseline). "
                f"OS will begin paging — expect severe I/O latency and query timeouts."
            )
            confidence = ConfidenceLevel.medium
        elif sigma > settings.degraded_sigma_threshold or (has_baseline and pressure_pct > baseline.p95):
            status = HealthStatus.degraded
            root_cause = (
                f"InnoDB buffer pool pressure elevated at {pressure_pct:.1f}% of available RAM "
                f"({sigma:.1f}σ above baseline p50={baseline.p50:.1f}%). "
                f"Buffer pool ({buffer_pool_gb:.1f}GB) competing with OS and other processes for RAM."
            )
            confidence = ConfidenceLevel.medium
        else:
            status = HealthStatus.healthy
            root_cause = (
                f"InnoDB buffer pool pressure within baseline at {pressure_pct:.1f}% "
                f"({sigma:.1f}σ from p50)."
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

        # ── Corroborating: available RAM critically low ────────────────────────
        if mem_available is not None and status != HealthStatus.healthy:
            # < 1GB free is always concerning regardless of baseline
            if mem_available < 1 * (1024 ** 3):
                evidence.append(EvidenceItem(
                    text=f"mysql.memory.available.bytes={mem_available_gb:.2f}GB — critically low free RAM",
                    source_type="metric",
                    confidence_delta=1,
                ))
                if confidence == ConfidenceLevel.medium:
                    confidence = ConfidenceLevel.high
            else:
                evidence.append(EvidenceItem(
                    text=f"mysql.memory.available.bytes={mem_available_gb:.1f}GB free",
                    source_type="metric",
                    confidence_delta=0,
                ))

        # ── Corroborating: full joins ─────────────────────────────────────────
        if full_joins is not None and full_joins > 0 and status != HealthStatus.healthy:
            evidence.append(EvidenceItem(
                text=f"mysql.select.full.join={full_joins:.0f} — large table scans may be thrashing buffer pool",
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
        )
