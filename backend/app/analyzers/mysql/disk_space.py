"""
Analyzer: Disk Space (MySQL)

Failure mode: MySQL data directory disk running out of space, causing:
  - InnoDB: transaction log writes fail → instance crashes
  - Binary log: replication stops when binlog can't be written
  - tmpdir: complex queries fail if temp files can't be created
  - General: any write to any table fails once disk is full

Unlike Elasticsearch (which enforces watermarks gracefully), MySQL does not
self-protect on disk — it crashes or hangs when the disk fills completely.

What it watches:
  Metrics (required):
    - mysql.disk.available.bytes — free space on MySQL data directory mount
    - mysql.disk.total.bytes     — total disk capacity

  Metrics (corroborating):
    - mysql.replication.lag.seconds — lag spikes often precede or follow disk issues
    - mysql.slow.queries.total      — disk-bound queries show up as slow queries

  Log signals (optional):
    - mysql_disk_full             — explicit "disk full" error in MySQL logs
    - mysql_replication_error     — replication errors caused by disk full on replica

Verdict logic:
  Critical  (>= 90% used): MySQL will fail to write within minutes/hours.
  Degraded  (>= 75% used): Warning — growth trend is dangerous.
  Healthy:  < 75% used.

  Sigma scoring augments absolute thresholds when baselines exist.

Confidence:
  No baseline: LOW — absolute thresholds only
  Baseline present: MEDIUM
  +1 if replication lag corroborates (disk pressure visible in replication)
  +1 if mysql_disk_full log present
  Maximum: HIGH
"""

from datetime import datetime

from app.analyzers.base import BaseAnalyzer, EvidenceItem, VerdictResult
from app.core.config import get_settings
from app.models.models import ConfidenceLevel, HealthStatus

settings = get_settings()

# Thresholds — earlier than actual failure to give lead time
WARN_PCT     = 75.0   # start warning at 75%
CRITICAL_PCT = 90.0   # critical at 90% — failure is imminent


class MySQLDiskSpaceAnalyzer(BaseAnalyzer):

    ANALYZER_NAME = "mysql_disk_space"

    REQUIRED_METRICS = [
        "mysql.disk.available.bytes",
        "mysql.disk.total.bytes",
    ]

    CORROBORATING_METRICS = [
        "mysql.replication.lag.seconds",
        "mysql.slow.queries.total",
    ]

    OPTIONAL_LOG_SIGNALS = [
        "mysql_disk_full",
        "mysql_replication_error",
    ]

    def analyze(
        self,
        metrics: dict[str, float],
        baselines: dict,
        log_signals: dict[str, int],
        metric_ts: datetime,
    ) -> VerdictResult:

        available = metrics["mysql.disk.available.bytes"]
        total     = metrics["mysql.disk.total.bytes"]

        if total <= 0:
            return VerdictResult(
                analyzer_name=self.ANALYZER_NAME,
                status=HealthStatus.unknown,
                observed="mysql.disk.total.bytes is 0 — metric may be misconfigured",
                baseline_summary="Cannot assess disk usage without total bytes",
                root_cause="Disk metric reporting issue",
                recommendation="Verify node_filesystem_size_bytes is being scraped correctly",
                confidence=ConfidenceLevel.low,
                metric_ts=metric_ts,
            )

        used_pct      = ((total - available) / total) * 100.0
        available_gb  = available / (1024 ** 3)
        total_gb      = total / (1024 ** 3)
        used_gb       = total_gb - available_gb

        repl_lag    = metrics.get("mysql.replication.lag.seconds")
        slow_queries = metrics.get("mysql.slow.queries.total")

        available_baseline = baselines.get("mysql.disk.available.bytes")
        evidence: list[EvidenceItem] = []

        # ── Primary evidence ──────────────────────────────────────────────────
        evidence.append(EvidenceItem(
            text=(
                f"disk used {used_pct:.1f}% "
                f"({used_gb:.1f} GB used, {available_gb:.1f} GB free of {total_gb:.1f} GB)"
            ),
            source_type="metric",
            confidence_delta=0,
        ))

        # ── Sigma scoring ─────────────────────────────────────────────────────
        sigma = 0.0
        has_baseline = available_baseline is not None

        if has_baseline and available_baseline.std_dev > 0:
            sigma = (available - available_baseline.mean) / available_baseline.std_dev
            evidence.append(EvidenceItem(
                text=(
                    f"mysql.disk.available.bytes: {available_gb:.1f} GB "
                    f"vs baseline p50={available_baseline.p50 / (1024**3):.1f} GB "
                    f"(sigma={sigma:+.1f})"
                ),
                source_type="metric",
                confidence_delta=0,
            ))

        # ── Corroborating ─────────────────────────────────────────────────────
        if repl_lag is not None and repl_lag > 30:
            evidence.append(EvidenceItem(
                text=(
                    f"mysql.replication.lag.seconds={repl_lag:.0f}s — "
                    "elevated lag may indicate disk contention on replica"
                ),
                source_type="metric",
                confidence_delta=1,
            ))

        if slow_queries is not None:
            evidence.append(EvidenceItem(
                text=f"mysql.slow.queries.total={slow_queries:.0f}",
                source_type="metric",
                confidence_delta=0,
            ))

        # ── Status determination ──────────────────────────────────────────────
        abs_critical = used_pct >= CRITICAL_PCT
        abs_degraded = used_pct >= WARN_PCT

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
            confidence_level = 0  # LOW
        elif status == HealthStatus.healthy:
            confidence_level = 2  # HIGH
        else:
            confidence_level = 1  # MEDIUM

        if repl_lag is not None and repl_lag > 30 and status != HealthStatus.healthy:
            confidence_level = min(confidence_level + 1, 2)

        disk_full_logs  = log_signals.get("mysql_disk_full", 0)
        repl_error_logs = log_signals.get("mysql_replication_error", 0)

        if disk_full_logs > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"mysql_disk_full: {disk_full_logs} log events — direct confirmation",
                source_type="log_signal",
                confidence_delta=1,
            ))
        if repl_error_logs > 0:
            evidence.append(EvidenceItem(
                text=f"mysql_replication_error: {repl_error_logs} events — may be disk-related",
                source_type="log_signal",
                confidence_delta=0,
            ))

        confidence_map = {0: ConfidenceLevel.low, 1: ConfidenceLevel.medium, 2: ConfidenceLevel.high}
        confidence = confidence_map[confidence_level]

        # ── Baseline summary ──────────────────────────────────────────────────
        if has_baseline:
            baseline_summary = (
                f"Normal free space: "
                f"{available_baseline.p50 / (1024**3):.1f}–"
                f"{available_baseline.p95 / (1024**3):.1f} GB "
                f"(p50–p95 over baseline window)"
            )
        else:
            baseline_summary = "No baseline established yet — using absolute thresholds (warn 75%, critical 90%)"

        # ── Human-readable fields ─────────────────────────────────────────────
        if status == HealthStatus.healthy:
            observed = (
                f"Disk usage {used_pct:.1f}% — {available_gb:.1f} GB free. "
                "Sufficient space for MySQL operation."
            )
            root_cause = "No disk space pressure detected"
            recommendation = "No action required"

        elif status == HealthStatus.degraded:
            observed = (
                f"Disk usage {used_pct:.1f}% — only {available_gb:.1f} GB free of {total_gb:.1f} GB. "
                "Approaching critical threshold."
            )
            root_cause = (
                f"MySQL data directory disk at {used_pct:.1f}% capacity with only {available_gb:.1f} GB remaining. "
                "At this rate, disk may fill before the next maintenance window. "
                "MySQL will crash or hang if the disk fills completely — there is no graceful degradation."
            )
            recommendation = (
                "Identify largest consumers: run 'du -sh /var/lib/mysql/*' on the host. "
                "Purge old binary logs: PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL 3 DAY). "
                "Check for large temporary tables: SELECT * FROM information_schema.INNODB_TEMP_TABLE_INFO. "
                "Consider adding disk capacity or archiving old data."
            )

        else:  # critical
            observed = (
                f"CRITICAL: Disk usage {used_pct:.1f}% — only {available_gb:.1f} GB free. "
                "MySQL is at risk of crashing or refusing writes imminently."
            )
            root_cause = (
                f"MySQL data directory disk at {used_pct:.1f}% — only {available_gb:.1f} GB remaining. "
                "When disk reaches 100%, InnoDB will fail to write transaction logs, "
                "binary logging will stop (breaking replication), and all INSERT/UPDATE/DELETE "
                "statements will return 'ERROR 1030: Got error 28 from storage engine' (disk full). "
                "The instance may crash or hang."
            )
            recommendation = (
                "URGENT: Free disk space immediately. "
                "1. Purge binary logs: PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL 1 DAY). "
                "2. Find large tables: SELECT table_schema, table_name, "
                "ROUND((data_length+index_length)/1024/1024,1) AS size_mb "
                "FROM information_schema.tables ORDER BY size_mb DESC LIMIT 10. "
                "3. If available: add disk volume or extend partition. "
                "4. As last resort: stop MySQL, move datadir to larger mount, symlink. "
                "Do NOT let this reach 100% — recovery from a crashed InnoDB instance is complex."
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
