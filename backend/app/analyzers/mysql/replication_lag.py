"""
Analyzer: MySQL Replication Lag

Failure mode: Replica falling behind the primary, causing stale reads and
potential data loss window if primary fails.

What it watches:
  Metrics (required):
    - mysql.replication.lag.seconds  — max lag across all channels (CUSTOM_QUERY)

  Corroborating:
    - mysql.replication.io.running   — avg IO thread health (< 1.0 = thread stopped)
    - mysql.replication.sql.running  — avg SQL thread health (< 1.0 = thread stopped)

Verdict logic:
  Thread stopped (io.running < 1.0 OR sql.running < 1.0):
    → critical immediately, regardless of lag value.
    Reason: lag reading is unreliable when the thread is stopped.

  Thread running + lag deviation from baseline (sigma score):
    Critical:  sigma > critical_sigma_threshold OR lag > 60s
    Degraded:  sigma > degraded_sigma_threshold OR lag > p95 baseline
    Healthy:   within baseline bounds

  No replication (metric absent): analyzer skipped via can_run() returning False.

Confidence:
  HIGH if both IO+SQL threads confirmed running (replication is active)
  MEDIUM if thread status not available
  -1 if thread is stopped (unreliable reading)
  Maximum: HIGH   Minimum: LOW
"""

from datetime import datetime
from app.analyzers.base import BaseAnalyzer, VerdictResult, EvidenceItem
from app.models.models import HealthStatus, ConfidenceLevel
from app.core.config import get_settings

settings = get_settings()

# Threshold below which we consider a thread "not fully running"
# (< 1.0 means at least one instance has the thread stopped)
THREAD_HEALTHY_THRESHOLD = 0.99


class ReplicationLagAnalyzer(BaseAnalyzer):

    ANALYZER_NAME = "mysql_replication_lag"

    REQUIRED_METRICS = [
        "mysql.replication.lag.seconds",
    ]

    CORROBORATING_METRICS = [
        "mysql.replication.io.running",
        "mysql.replication.sql.running",
    ]

    OPTIONAL_LOG_SIGNALS = []

    def analyze(
        self,
        metrics: dict[str, float],
        baselines: dict,
        log_signals: dict[str, int],
        metric_ts: datetime,
    ) -> VerdictResult:

        lag_seconds = metrics["mysql.replication.lag.seconds"]
        io_running = metrics.get("mysql.replication.io.running")
        sql_running = metrics.get("mysql.replication.sql.running")

        baseline = baselines.get("mysql.replication.lag.seconds")
        evidence: list[EvidenceItem] = []

        # ── Thread health check — overrides lag reading ────────────────────────
        io_stopped = io_running is not None and io_running < THREAD_HEALTHY_THRESHOLD
        sql_stopped = sql_running is not None and sql_running < THREAD_HEALTHY_THRESHOLD

        if io_running is not None:
            evidence.append(EvidenceItem(
                text=f"mysql.replication.io.running={io_running:.2f} ({'STOPPED on some instances' if io_stopped else 'healthy'})",
                source_type="metric",
                confidence_delta=-1 if io_stopped else 1,
            ))
        if sql_running is not None:
            evidence.append(EvidenceItem(
                text=f"mysql.replication.sql.running={sql_running:.2f} ({'STOPPED on some instances' if sql_stopped else 'healthy'})",
                source_type="metric",
                confidence_delta=-1 if sql_stopped else 1,
            ))

        if io_stopped or sql_stopped:
            stopped = []
            if io_stopped:
                stopped.append("IO")
            if sql_stopped:
                stopped.append("SQL")
            thread_desc = " and ".join(stopped)
            return VerdictResult(
                analyzer_name=self.ANALYZER_NAME,
                status=HealthStatus.critical,
                observed=(
                    f"Replication {thread_desc} thread stopped "
                    f"(io={io_running:.2f if io_running is not None else 'N/A'}, "
                    f"sql={sql_running:.2f if sql_running is not None else 'N/A'}). "
                    f"Lag reading ({lag_seconds:.0f}s) is unreliable."
                ),
                baseline_summary="Replication threads must both be running for valid lag measurement.",
                root_cause=(
                    f"MySQL replication {thread_desc} thread has stopped on one or more instances. "
                    f"Replication is not proceeding. The replica is not receiving or applying binlog events."
                ),
                recommendation=(
                    "Investigate replication error: SHOW SLAVE STATUS\\G on affected instance. "
                    "Common causes: network partition to primary, GTIDs out of sync, "
                    "binary log purged on primary, or disk full on replica. "
                    "Fix the underlying cause, then: START SLAVE;"
                ),
                confidence=ConfidenceLevel.high,
                evidence=evidence,
                metric_ts=metric_ts,
            )

        # ── Baseline sigma scoring ────────────────────────────────────────────
        sigma = 0.0
        has_baseline = baseline is not None and getattr(baseline, "is_valid", False)

        if has_baseline:
            if baseline.std_dev > 0:
                sigma = (lag_seconds - baseline.p50) / baseline.std_dev
            observed_str = (
                f"Replication lag {lag_seconds:.1f}s "
                f"(baseline p50={baseline.p50:.1f}s, p95={baseline.p95:.1f}s)"
            )
            baseline_summary = (
                f"Normal lag: {baseline.p50:.1f}s ± {baseline.std_dev:.1f}s "
                f"(p95={baseline.p95:.1f}s)"
            )
        else:
            observed_str = f"Replication lag {lag_seconds:.1f}s — no baseline yet"
            baseline_summary = "Insufficient history for baseline (< 100 samples)"

        evidence.insert(0, EvidenceItem(
            text=f"mysql.replication.lag.seconds={lag_seconds:.1f}s sigma={sigma:.2f}",
            source_type="metric",
            confidence_delta=0,
        ))

        # ── Status determination ───────────────────────────────────────────────
        threads_healthy = (
            (io_running is None or io_running >= THREAD_HEALTHY_THRESHOLD) and
            (sql_running is None or sql_running >= THREAD_HEALTHY_THRESHOLD)
        )

        if not has_baseline:
            if lag_seconds >= 60:
                status = HealthStatus.critical
                root_cause = f"Replication lag critically high at {lag_seconds:.0f}s. Reads from replica are severely stale."
            elif lag_seconds >= 10:
                status = HealthStatus.degraded
                root_cause = f"Replication lag elevated at {lag_seconds:.1f}s. Replica reads may be stale."
            else:
                status = HealthStatus.healthy
                root_cause = f"Replication lag within acceptable range at {lag_seconds:.1f}s."
            confidence = ConfidenceLevel.low
        elif sigma > settings.critical_sigma_threshold or lag_seconds >= 60:
            status = HealthStatus.critical
            root_cause = (
                f"Replication lag critically elevated at {lag_seconds:.0f}s "
                f"({sigma:.1f}σ above baseline p50={baseline.p50:.1f}s). "
                f"Replica is significantly behind the primary — reads are stale."
            )
            confidence = ConfidenceLevel.medium
        elif sigma > settings.degraded_sigma_threshold or (has_baseline and lag_seconds > baseline.p95):
            status = HealthStatus.degraded
            root_cause = (
                f"Replication lag above baseline at {lag_seconds:.1f}s "
                f"({sigma:.1f}σ above p50={baseline.p50:.1f}s). "
                f"Replica is falling behind — investigate primary write load or replica capacity."
            )
            confidence = ConfidenceLevel.medium
        else:
            status = HealthStatus.healthy
            root_cause = f"Replication lag within baseline bounds at {lag_seconds:.1f}s ({sigma:.1f}σ)."
            confidence = ConfidenceLevel.medium

        # Threads healthy → boost confidence
        if threads_healthy and io_running is not None and status == HealthStatus.healthy:
            confidence = ConfidenceLevel.high

        recommendation = (
            "Check primary write load: SHOW PROCESSLIST on primary. "
            "Check replica capacity: SHOW SLAVE STATUS\\G. "
            "Consider: parallel replication (slave_parallel_workers), "
            "read-heavy workloads off replica, or upgrading replica hardware. "
            "For lag > 60s: investigate large transactions or DDL on primary."
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
