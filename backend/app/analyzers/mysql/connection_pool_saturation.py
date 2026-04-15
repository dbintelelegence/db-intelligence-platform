"""
Analyzer: MySQL Connection Pool Saturation

Failure mode: Connection count exhausting max_connections — but the root cause
differs and determines the correct fix. This analyzer distinguishes three patterns:

  LEAK     — connections grow while active threads stay low and query rate is flat.
             The database is not under load. Application is not returning connections
             to the pool. Raising max_connections will not help.

  PILE-UP  — connections high AND threads running high AND slow query rate elevated.
             Slow queries are holding connections open. Connections are the symptom;
             slow queries are the cause.

  SURGE    — connections high AND query throughput 2x+ above baseline AND threads
             running proportional to connections. Genuine traffic increase. The
             database is actually under load.

What it watches:
  Metrics (required):
    - mysql.connection.pct        — threads_connected / max_connections * 100
    - mysql.connections.current   — raw thread count for evidence text

  Corroborating:
    - mysql.threads.running       — active vs connected ratio (key for leak detection)
    - mysql.slow.query.rate       — confirms pile-up pattern
    - mysql.query.rate            — query throughput rate (confirms surge pattern)

Verdict logic:
  Status from sigma score / absolute threshold as before.
  Root cause from pattern classification using corroborating signals.
  Confidence boosted by each corroborating signal that confirms the pattern.
"""

from datetime import datetime
from app.analyzers.base import BaseAnalyzer, VerdictResult, EvidenceItem
from app.models.models import HealthStatus, ConfidenceLevel
from app.core.config import get_settings

settings = get_settings()

# Utilization ratio: threads_running / threads_connected
# Low ratio with high connections = leak (connections idle, not working)
# High ratio = connections are active (pile-up or surge)
_IDLE_RATIO_THRESHOLD = 0.15   # < 15% of connections actively running queries = leak signal

# Slow query rate above this is significant
_SLOW_QUERY_RATE_ELEVATED = 0.5  # queries/sec

# Query throughput sigma above this confirms surge
_SURGE_SIGMA_THRESHOLD = 1.5


class ConnectionPoolSaturationAnalyzer(BaseAnalyzer):

    ANALYZER_NAME = "mysql_connection_pool_saturation"

    REQUIRED_METRICS = [
        "mysql.connection.pct",
        "mysql.connections.current",
    ]

    CORROBORATING_METRICS = [
        "mysql.threads.running",
        "mysql.slow.query.rate",
        "mysql.query.rate",
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

        conn_pct       = metrics["mysql.connection.pct"]
        conn_current   = metrics["mysql.connections.current"]
        threads_running = metrics.get("mysql.threads.running")
        slow_query_rate = metrics.get("mysql.slow.query.rate", 0.0)
        query_rate      = metrics.get("mysql.query.rate")

        baseline         = baselines.get("mysql.connection.pct")
        threads_baseline = baselines.get("mysql.threads.running")
        query_rate_baseline = baselines.get("mysql.query.rate")

        evidence: list[EvidenceItem] = []

        # ── Baseline sigma for connection % ───────────────────────────────────
        sigma = 0.0
        has_baseline = baseline is not None and getattr(baseline, "is_valid", False)

        if has_baseline and baseline.std_dev > 0:
            sigma = (conn_pct - baseline.p50) / baseline.std_dev

        # ── Status determination ──────────────────────────────────────────────
        if not has_baseline:
            if conn_pct >= 90:
                status = HealthStatus.critical
            elif conn_pct >= 70:
                status = HealthStatus.degraded
            else:
                status = HealthStatus.healthy
            confidence = ConfidenceLevel.low
        elif sigma > settings.critical_sigma_threshold or conn_pct >= 90:
            status = HealthStatus.critical
            confidence = ConfidenceLevel.medium
        elif sigma > settings.degraded_sigma_threshold or (has_baseline and conn_pct > baseline.p95):
            status = HealthStatus.degraded
            confidence = ConfidenceLevel.medium
        else:
            status = HealthStatus.healthy
            confidence = ConfidenceLevel.medium

        # ── Pattern classification (only meaningful when not healthy) ─────────
        pattern = None  # "leak" | "pileup" | "surge" | None

        if status != HealthStatus.healthy and threads_running is not None and conn_current > 0:
            utilization_ratio = threads_running / conn_current

            # Compute query rate sigma if available
            queries_sigma = 0.0
            if query_rate is not None and query_rate_baseline and query_rate_baseline.std_dev > 0:
                queries_sigma = (query_rate - query_rate_baseline.p50) / query_rate_baseline.std_dev

            threads_sigma = 0.0
            if threads_baseline and threads_baseline.std_dev > 0:
                threads_sigma = (threads_running - threads_baseline.p50) / threads_baseline.std_dev

            if utilization_ratio < _IDLE_RATIO_THRESHOLD and slow_query_rate < _SLOW_QUERY_RATE_ELEVATED:
                # Connections are mostly idle — not doing work
                pattern = "leak"
            elif slow_query_rate >= _SLOW_QUERY_RATE_ELEVATED and threads_sigma > 1.0:
                # Active threads elevated AND slow queries — queries holding connections
                pattern = "pileup"
            elif queries_sigma > _SURGE_SIGMA_THRESHOLD and threads_sigma > 0.5:
                # Query throughput genuinely elevated — real traffic surge
                pattern = "surge"

        # ── Build root cause and recommendation from pattern ──────────────────
        if status == HealthStatus.healthy:
            if has_baseline:
                observed = (
                    f"Connection pool at {conn_pct:.1f}% "
                    f"({conn_current:.0f} connections), "
                    f"baseline p50={baseline.p50:.1f}%, p95={baseline.p95:.1f}%"
                )
            else:
                observed = f"Connection pool at {conn_pct:.1f}% ({conn_current:.0f} connections)"
            root_cause = f"Connection pool within normal range at {conn_pct:.1f}%."
            recommendation = "No action required."

        elif pattern == "leak":
            threads_str = f"{threads_running:.0f}" if threads_running is not None else "unknown"
            utilization_pct = (threads_running / conn_current * 100) if threads_running is not None else 0
            observed = (
                f"Connection pool at {conn_pct:.1f}% ({conn_current:.0f} connections) "
                f"but only {threads_str} threads actively running ({utilization_pct:.0f}% utilization). "
                f"Slow query rate is {slow_query_rate:.2f}/s."
            )
            root_cause = (
                f"Connection count is high ({conn_pct:.1f}%) but {utilization_pct:.0f}% of connections "
                f"are idle — not executing queries. This is a connection leak in the application layer, "
                f"not a database load problem. Raising max_connections will delay but not fix the issue."
            )
            recommendation = (
                "Look for application instances that are not returning connections to the pool. "
                "Run: SELECT host, COUNT(*) as open_connections, "
                "SUM(command='Sleep') as idle FROM information_schema.processlist "
                "GROUP BY host ORDER BY open_connections DESC; "
                "Identify app hosts with high idle ratios. "
                "Check connection pool configuration (max pool size, idle timeout, validation queries)."
            )
            confidence = ConfidenceLevel.high

        elif pattern == "pileup":
            threads_str = f"{threads_running:.0f}" if threads_running is not None else "unknown"
            observed = (
                f"Connection pool at {conn_pct:.1f}% ({conn_current:.0f} connections). "
                f"Active threads: {threads_str}. Slow query rate: {slow_query_rate:.2f}/s. "
                f"Connections are being held by slow queries."
            )
            root_cause = (
                f"Slow queries are holding connections open, causing pool saturation. "
                f"Slow query rate of {slow_query_rate:.2f}/s with {threads_str} active threads "
                f"indicates queries are taking too long to complete — connections cannot be released "
                f"back to the pool. The bottleneck is query performance, not connection limits."
            )
            recommendation = (
                "Find the slow queries holding connections: "
                "SELECT * FROM information_schema.processlist "
                "WHERE time > 5 ORDER BY time DESC LIMIT 20; "
                "Check slow query log for the query patterns that started spiking. "
                "Look for missing indexes (EXPLAIN on the slow queries) or lock contention "
                "(SHOW ENGINE INNODB STATUS for lock waits). "
                "Do not raise max_connections until slow queries are resolved."
            )
            confidence = ConfidenceLevel.high

        elif pattern == "surge":
            query_rate_str = f"{query_rate:.0f}" if query_rate is not None else "unknown"
            query_rate_baseline_str = f"{query_rate_baseline.p50:.0f}" if query_rate_baseline else "unknown"
            observed = (
                f"Connection pool at {conn_pct:.1f}% ({conn_current:.0f} connections). "
                f"Query rate: {query_rate_str}/s vs baseline {query_rate_baseline_str}/s. "
                f"Active threads proportional to connection growth."
            )
            root_cause = (
                f"Genuine traffic surge — query throughput is elevated above baseline "
                f"and connection growth is proportional to active query load. "
                f"The database is under real load, not experiencing a leak or slow query pile-up."
            )
            recommendation = (
                "Short-term: temporarily increase max_connections if headroom exists in RAM "
                "(each connection uses ~1MB). "
                "Medium-term: add a connection pooler (ProxySQL or PgBouncer) to multiplex "
                "application connections. "
                "Long-term: evaluate whether read replicas can absorb SELECT traffic "
                "to reduce primary load."
            )
            if confidence == ConfidenceLevel.medium:
                confidence = ConfidenceLevel.high

        else:
            # No pattern identified — generic saturation message
            if has_baseline:
                observed = (
                    f"Connection pool at {conn_pct:.1f}% "
                    f"({conn_current:.0f} connections), "
                    f"baseline p50={baseline.p50:.1f}%, p95={baseline.p95:.1f}%"
                )
            else:
                observed = (
                    f"Connection pool at {conn_pct:.1f}% "
                    f"({conn_current:.0f} connections) — no baseline yet"
                )
            root_cause = (
                f"Connection pool elevated at {conn_pct:.1f}% ({sigma:.1f}σ above baseline). "
                f"Insufficient corroborating signals to determine whether this is a leak, "
                f"slow query pile-up, or traffic surge."
            )
            recommendation = (
                "Check active vs idle connections: "
                "SELECT command, COUNT(*) FROM information_schema.processlist GROUP BY command; "
                "High Sleep count = likely leak. High Query count with slow_query_log entries = pile-up. "
                "High Query count with normal query times = traffic surge."
            )

        # ── Baseline summary ──────────────────────────────────────────────────
        if has_baseline:
            baseline_summary = (
                f"Normal range: {baseline.p50:.1f}% ± {baseline.std_dev:.1f}% "
                f"(p95={baseline.p95:.1f}%)"
            )
        else:
            baseline_summary = "Insufficient history for baseline (< 100 samples)"

        # ── Evidence items ────────────────────────────────────────────────────
        evidence.append(EvidenceItem(
            text=f"mysql.connection.pct={conn_pct:.1f}% ({conn_current:.0f} connections) sigma={sigma:.2f}",
            source_type="metric",
            confidence_delta=0,
        ))

        if threads_running is not None:
            threads_sigma = 0.0
            if threads_baseline and threads_baseline.std_dev > 0:
                threads_sigma = (threads_running - threads_baseline.p50) / threads_baseline.std_dev
            utilization_ratio = threads_running / conn_current if conn_current > 0 else 0
            evidence.append(EvidenceItem(
                text=(
                    f"mysql.threads.running={threads_running:.0f} "
                    f"({utilization_ratio*100:.0f}% of connections active, sigma={threads_sigma:.1f})"
                    + (f" — confirms {pattern} pattern" if pattern else "")
                ),
                source_type="metric",
                confidence_delta=1 if pattern in ("pileup", "surge") else 0,
            ))

        if slow_query_rate is not None and slow_query_rate > 0:
            evidence.append(EvidenceItem(
                text=(
                    f"mysql.slow.query.rate={slow_query_rate:.3f}/s"
                    + (" — confirms slow query pile-up" if pattern == "pileup" else "")
                ),
                source_type="metric",
                confidence_delta=1 if pattern == "pileup" else 0,
            ))

        if query_rate is not None and query_rate_baseline:
            queries_sigma = 0.0
            if query_rate_baseline.std_dev > 0:
                queries_sigma = (query_rate - query_rate_baseline.p50) / query_rate_baseline.std_dev
            evidence.append(EvidenceItem(
                text=(
                    f"mysql.query.rate={query_rate:.1f}/s "
                    f"vs baseline p50={query_rate_baseline.p50:.1f}/s (sigma={queries_sigma:.1f})"
                    + (" — confirms traffic surge" if pattern == "surge" else "")
                ),
                source_type="metric",
                confidence_delta=1 if pattern == "surge" else 0,
            ))

        if log_signals.get("mysql_too_many_connections", 0) > 0:
            evidence.append(EvidenceItem(
                text="mysql_too_many_connections log event — connections actively being refused",
                source_type="log_signal",
                confidence_delta=1,
            ))
            confidence = ConfidenceLevel.high

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
