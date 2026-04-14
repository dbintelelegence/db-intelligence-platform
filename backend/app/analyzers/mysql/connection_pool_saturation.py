"""
Analyzer: MySQL Connection Pool Saturation

Failure mode: Too many client connections exhausting the MySQL connection pool,
causing new connections to be refused.

What it watches:
  Metrics (required):
    - mysql.connection.pct        — threads_connected / max_connections * 100 (CUSTOM_QUERY)
    - mysql.connections.current   — raw thread count for evidence text

  Corroborating:
    - mysql.threads.running       — active threads vs connected (utilization density)
    - mysql.slow.query.rate       — slow queries + high connections = confirmed saturation

Verdict logic:
  Status determined by connection_pct deviation from baseline (sigma score).

  Critical:  sigma > critical_sigma_threshold (3.5) OR pct > 90%
  Degraded:  sigma > degraded_sigma_threshold (2.0) OR pct > p95 baseline
  Healthy:   within baseline bounds

Confidence:
  MEDIUM if connection_pct alone is anomalous
  +1 if threads.running is also elevated (confirmed active pressure)
  +1 if slow.query.rate is elevated (confirmed downstream impact)
  Maximum: HIGH   Minimum: LOW
"""

from datetime import datetime
from app.analyzers.base import BaseAnalyzer, VerdictResult, EvidenceItem
from app.models.models import HealthStatus, ConfidenceLevel
from app.core.config import get_settings

settings = get_settings()


class ConnectionPoolSaturationAnalyzer(BaseAnalyzer):

    ANALYZER_NAME = "mysql_connection_pool_saturation"

    REQUIRED_METRICS = [
        "mysql.connection.pct",
        "mysql.connections.current",
    ]

    CORROBORATING_METRICS = [
        "mysql.threads.running",
        "mysql.slow.query.rate",
    ]

    OPTIONAL_LOG_SIGNALS = [
        "mysql_too_many_connections",
    ]

    def analyze(
        self,
        metrics: dict[str, float],
        baselines: dict,
        log_signals: dict[str, int],
        metric_ts: datetime,
    ) -> VerdictResult:

        conn_pct = metrics["mysql.connection.pct"]
        conn_current = metrics["mysql.connections.current"]
        threads_running = metrics.get("mysql.threads.running")
        slow_query_rate = metrics.get("mysql.slow.query.rate")

        baseline = baselines.get("mysql.connection.pct")
        threads_baseline = baselines.get("mysql.threads.running")

        evidence: list[EvidenceItem] = []

        # ── Baseline sigma scoring ────────────────────────────────────────────
        sigma = 0.0
        has_baseline = baseline is not None and getattr(baseline, "is_valid", False)

        if has_baseline:
            if baseline.std_dev > 0:
                sigma = (conn_pct - baseline.p50) / baseline.std_dev
            observed_str = (
                f"Connection pool at {conn_pct:.1f}% "
                f"({conn_current:.0f} connections), "
                f"baseline p50={baseline.p50:.1f}%, p95={baseline.p95:.1f}%"
            )
            baseline_summary = (
                f"Normal range: {baseline.p50:.1f}% ± {baseline.std_dev:.1f}% "
                f"(p95={baseline.p95:.1f}%)"
            )
        else:
            observed_str = (
                f"Connection pool at {conn_pct:.1f}% "
                f"({conn_current:.0f} connections) — no baseline yet"
            )
            baseline_summary = "Insufficient history for baseline (< 100 samples)"

        evidence.append(EvidenceItem(
            text=f"mysql.connection.pct={conn_pct:.1f}% sigma={sigma:.2f}",
            source_type="metric",
            confidence_delta=0,
        ))

        # ── Status determination ───────────────────────────────────────────────
        if not has_baseline:
            # No baseline — use absolute threshold only
            if conn_pct >= 90:
                status = HealthStatus.critical
                root_cause = (
                    f"Connection pool critically saturated at {conn_pct:.1f}% "
                    f"({conn_current:.0f} connections). New connections will be refused."
                )
            elif conn_pct >= 70:
                status = HealthStatus.degraded
                root_cause = (
                    f"Connection pool elevated at {conn_pct:.1f}% "
                    f"({conn_current:.0f} connections). Risk of connection refusal under load."
                )
            else:
                status = HealthStatus.healthy
                root_cause = f"Connection pool within normal range at {conn_pct:.1f}%."
            confidence = ConfidenceLevel.low
        elif sigma > settings.critical_sigma_threshold or conn_pct >= 90:
            status = HealthStatus.critical
            root_cause = (
                f"Connection pool critically saturated at {conn_pct:.1f}% "
                f"({sigma:.1f}σ above baseline). "
                f"New connections will be refused at {conn_current:.0f} active connections."
            )
            confidence = ConfidenceLevel.medium
        elif sigma > settings.degraded_sigma_threshold or (has_baseline and conn_pct > baseline.p95):
            status = HealthStatus.degraded
            root_cause = (
                f"Connection pool elevated at {conn_pct:.1f}% "
                f"({sigma:.1f}σ above baseline p50={baseline.p50:.1f}%). "
                f"Risk of connection refusal under increased load."
            )
            confidence = ConfidenceLevel.medium
        else:
            status = HealthStatus.healthy
            root_cause = (
                f"Connection pool within baseline bounds at {conn_pct:.1f}% "
                f"({sigma:.1f}σ from p50)."
            )
            confidence = ConfidenceLevel.medium

        # ── Corroborating: threads running ────────────────────────────────────
        if threads_running is not None and status != HealthStatus.healthy:
            threads_sigma = 0.0
            if threads_baseline and threads_baseline.std_dev > 0:
                threads_sigma = (threads_running - threads_baseline.p50) / threads_baseline.std_dev
            if threads_sigma > 1.5 or threads_running > 10:
                evidence.append(EvidenceItem(
                    text=f"mysql.threads.running={threads_running:.0f} (sigma={threads_sigma:.1f}) — active query pressure confirmed",
                    source_type="metric",
                    confidence_delta=1,
                ))
                if confidence == ConfidenceLevel.medium:
                    confidence = ConfidenceLevel.high

        # ── Corroborating: slow query rate ────────────────────────────────────
        if slow_query_rate is not None and slow_query_rate > 0 and status != HealthStatus.healthy:
            evidence.append(EvidenceItem(
                text=f"mysql.slow.query.rate={slow_query_rate:.3f}/s — downstream query impact confirmed",
                source_type="metric",
                confidence_delta=1,
            ))
            if confidence == ConfidenceLevel.medium:
                confidence = ConfidenceLevel.high

        # ── Log signal ────────────────────────────────────────────────────────
        if log_signals.get("mysql_too_many_connections", 0) > 0:
            evidence.append(EvidenceItem(
                text="mysql_too_many_connections log signal present",
                source_type="log_signal",
                confidence_delta=1,
            ))
            confidence = ConfidenceLevel.high

        recommendation = (
            "Identify long-running or idle connections: "
            "SELECT * FROM information_schema.processlist ORDER BY time DESC LIMIT 20; "
            "Consider increasing max_connections if hardware allows, "
            "or implement connection pooling (ProxySQL/HAProxy). "
            "Check for connection leaks in application code."
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
