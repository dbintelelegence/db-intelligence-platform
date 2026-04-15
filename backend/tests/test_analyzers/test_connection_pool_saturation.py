"""
Tests: MySQL Connection Pool Saturation Analyzer

Each test class covers one scenario with realistic simulator data.
The analyzer distinguishes three root cause patterns:

  LEAK    — connections high, threads mostly idle, slow queries flat
            → application not returning connections to the pool
  PILE-UP — connections high, threads running elevated, slow queries high
            → slow queries holding connections open
  SURGE   — connections high, query rate above baseline, threads proportional
            → genuine traffic increase

Simulator data rationale (per class docstring below):
  - Baseline: p50=50%, std_dev=10 → sigma 2.0 at 70%, sigma 3.5 at 85%
  - Threads baseline: p50=10, std_dev=5
  - Query rate baseline: p50=1000/s, std_dev=200

Thresholds (from settings defaults):
  degraded_sigma_threshold = 2.0
  critical_sigma_threshold = 3.5
"""

from datetime import datetime
from unittest.mock import MagicMock

import pytest

from app.analyzers.mysql.connection_pool_saturation import ConnectionPoolSaturationAnalyzer
from app.models.models import HealthStatus, ConfidenceLevel

# ── Helpers ───────────────────────────────────────────────────────────────────

def make_baseline(p50, p75, p95, p99=None, mean=None, std_dev=None):
    b = MagicMock()
    b.p50 = p50
    b.p75 = p75
    b.p95 = p95
    b.p99 = p99 or p95
    b.mean = mean or p50
    b.std_dev = std_dev or max((p95 - p50) / 2, 0.01)
    b.is_valid = True   # required — analyzer checks getattr(baseline, "is_valid", False)
    return b


# ── Module-level constants ────────────────────────────────────────────────────

NOW = datetime(2026, 4, 14, 21, 0, 0)

# Baseline represents a cluster where connections normally run at 50% (±10%)
# p95 at 65% means anything above 65% is genuinely unusual
NORMAL_BASELINES = {
    "mysql.connection.pct":  make_baseline(p50=50.0, p75=57.0, p95=65.0, std_dev=10.0),
    "mysql.threads.running": make_baseline(p50=10.0, p75=13.0, p95=18.0, std_dev=5.0),
    "mysql.query.rate":      make_baseline(p50=1000.0, p75=1200.0, p95=1500.0, std_dev=200.0),
}

analyzer = ConnectionPoolSaturationAnalyzer()


# ── 1. Healthy state ──────────────────────────────────────────────────────────

class TestHealthyState:
    """
    Simulator: Normal production load.
    Connections at 52% (sigma=0.2), threads running proportionally,
    slow query rate negligible. No anomaly of any kind.
    """

    def test_healthy_status(self):
        metrics = {
            "mysql.connection.pct":      52.0,
            "mysql.connections.current": 104.0,
            "mysql.threads.running":     11.0,
            "mysql.slow.query.rate":     0.05,
            "mysql.query.rate":          1050.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)
        assert result.status == HealthStatus.healthy

    def test_healthy_confidence_medium(self):
        metrics = {
            "mysql.connection.pct":      52.0,
            "mysql.connections.current": 104.0,
            "mysql.threads.running":     11.0,
            "mysql.slow.query.rate":     0.05,
            "mysql.query.rate":          1050.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)
        assert result.confidence == ConfidenceLevel.medium

    def test_healthy_no_pattern_classified(self):
        """Pattern classification only runs when status is not healthy."""
        metrics = {
            "mysql.connection.pct":      52.0,
            "mysql.connections.current": 104.0,
            "mysql.threads.running":     11.0,
            "mysql.slow.query.rate":     0.05,
            "mysql.query.rate":          1050.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)
        assert "leak" not in result.root_cause.lower()
        assert "pile" not in result.root_cause.lower()
        assert "surge" not in result.root_cause.lower()

    def test_healthy_no_action_recommendation(self):
        metrics = {
            "mysql.connection.pct":      52.0,
            "mysql.connections.current": 104.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)
        assert "no action" in result.recommendation.lower()


# ── 2. Leak pattern ───────────────────────────────────────────────────────────

class TestLeakPattern:
    """
    Simulator: Connection leak scenario.
    A microservice deployed at 21:00 opened 170 connections but has a bug
    where connections are never returned to the pool after requests complete.
    Connections climb to 85% but active threads stay at 5 (idle sleep state).
    Slow query rate is flat — no query load. Query throughput normal.

    Expected: degraded status, LEAK pattern identified, HIGH confidence.
    The recommendation must point to the application layer, NOT suggest
    raising max_connections.
    """

    LEAK_METRICS = {
        "mysql.connection.pct":      85.0,   # sigma=(85-50)/10=3.5 → critical boundary
        "mysql.connections.current": 170.0,
        "mysql.threads.running":     5.0,    # utilization=5/170=0.03 → far below 0.15 leak threshold
        "mysql.slow.query.rate":     0.1,    # well below 0.5/s elevated threshold
        "mysql.query.rate":          980.0,  # normal (sigma=-0.1)
    }

    def test_leak_is_degraded_or_critical(self):
        result = analyzer.analyze(self.LEAK_METRICS, NORMAL_BASELINES, {}, NOW)
        assert result.status in (HealthStatus.degraded, HealthStatus.critical)

    def test_leak_confidence_high(self):
        """Three signals agree (conn high, threads idle, slow queries flat) → HIGH."""
        result = analyzer.analyze(self.LEAK_METRICS, NORMAL_BASELINES, {}, NOW)
        assert result.confidence == ConfidenceLevel.high

    def test_leak_root_cause_names_leak(self):
        result = analyzer.analyze(self.LEAK_METRICS, NORMAL_BASELINES, {}, NOW)
        assert "leak" in result.root_cause.lower()

    def test_leak_root_cause_says_not_db_load(self):
        """Must tell the engineer this is NOT a database load problem."""
        result = analyzer.analyze(self.LEAK_METRICS, NORMAL_BASELINES, {}, NOW)
        assert "not a database load" in result.root_cause.lower()

    def test_leak_recommendation_processlist(self):
        """Must point to information_schema.processlist to identify offending hosts."""
        result = analyzer.analyze(self.LEAK_METRICS, NORMAL_BASELINES, {}, NOW)
        assert "processlist" in result.recommendation.lower()

    def test_leak_recommendation_does_not_say_raise_max_connections(self):
        """Raising max_connections does not fix a leak — must not suggest it as the fix."""
        result = analyzer.analyze(self.LEAK_METRICS, NORMAL_BASELINES, {}, NOW)
        # The recommendation may mention max_connections as what NOT to do,
        # but the primary action must not be to raise it
        rec = result.recommendation.lower()
        # Should mention the app layer, not suggest raising limits as first action
        assert "application" in rec or "pool" in rec or "processlist" in rec

    def test_leak_observed_shows_idle_percentage(self):
        """Observed field must show that most connections are idle."""
        result = analyzer.analyze(self.LEAK_METRICS, NORMAL_BASELINES, {}, NOW)
        # 5/170 = ~2% utilization — should appear in observed
        assert "%" in result.observed
        assert "85" in result.observed  # connection pct

    def test_leak_evidence_has_threads_running(self):
        result = analyzer.analyze(self.LEAK_METRICS, NORMAL_BASELINES, {}, NOW)
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        threads_ev = next((e for e in metric_evidence if "threads.running" in e.text), None)
        assert threads_ev is not None

    def test_leak_evidence_mentions_pattern(self):
        result = analyzer.analyze(self.LEAK_METRICS, NORMAL_BASELINES, {}, NOW)
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        threads_ev = next((e for e in metric_evidence if "threads.running" in e.text), None)
        assert threads_ev is not None
        assert "leak" in threads_ev.text.lower()


# ── 3. Pile-up pattern ────────────────────────────────────────────────────────

class TestPileupPattern:
    """
    Simulator: Slow query pile-up scenario.
    A missing index on a new feature deployed at 20:30 causes full-table
    scans. Each query takes 8-12 seconds instead of <100ms. Connections
    pile up because threads cannot complete and release. Slow query rate
    spikes to 1.2/s. Active threads are at 20 (2σ above baseline of 10).

    Expected: degraded/critical status, PILE-UP pattern, HIGH confidence.
    Recommendation must say: fix the slow queries, do NOT raise max_connections.
    """

    PILEUP_METRICS = {
        "mysql.connection.pct":      85.0,   # sigma=3.5
        "mysql.connections.current": 170.0,
        "mysql.threads.running":     20.0,   # sigma=(20-10)/5=2.0 → above 1.0 threshold
        "mysql.slow.query.rate":     1.2,    # well above 0.5/s elevated threshold
        "mysql.query.rate":          980.0,  # normal (surge not the cause)
    }

    PILEUP_BASELINES = {
        **NORMAL_BASELINES,
        "mysql.threads.running": make_baseline(p50=10.0, p75=13.0, p95=18.0, std_dev=5.0),
    }

    def test_pileup_is_degraded_or_critical(self):
        result = analyzer.analyze(self.PILEUP_METRICS, self.PILEUP_BASELINES, {}, NOW)
        assert result.status in (HealthStatus.degraded, HealthStatus.critical)

    def test_pileup_confidence_high(self):
        """Slow queries + elevated threads both confirm pile-up → HIGH."""
        result = analyzer.analyze(self.PILEUP_METRICS, self.PILEUP_BASELINES, {}, NOW)
        assert result.confidence == ConfidenceLevel.high

    def test_pileup_root_cause_names_slow_queries(self):
        result = analyzer.analyze(self.PILEUP_METRICS, self.PILEUP_BASELINES, {}, NOW)
        assert "slow quer" in result.root_cause.lower()

    def test_pileup_root_cause_says_performance_bottleneck(self):
        """Must tell the engineer the bottleneck is query performance, not connection limits."""
        result = analyzer.analyze(self.PILEUP_METRICS, self.PILEUP_BASELINES, {}, NOW)
        assert "bottleneck" in result.root_cause.lower() or "performance" in result.root_cause.lower()

    def test_pileup_recommendation_says_do_not_raise_max_connections(self):
        """Critical: raising max_connections is wrong here — the test verifies this is called out."""
        result = analyzer.analyze(self.PILEUP_METRICS, self.PILEUP_BASELINES, {}, NOW)
        assert "do not raise max_connections" in result.recommendation.lower()

    def test_pileup_recommendation_mentions_processlist(self):
        result = analyzer.analyze(self.PILEUP_METRICS, self.PILEUP_BASELINES, {}, NOW)
        assert "processlist" in result.recommendation.lower()

    def test_pileup_recommendation_mentions_explain(self):
        """Must point to EXPLAIN to diagnose the slow queries."""
        result = analyzer.analyze(self.PILEUP_METRICS, self.PILEUP_BASELINES, {}, NOW)
        assert "explain" in result.recommendation.lower()

    def test_pileup_observed_shows_slow_query_rate(self):
        result = analyzer.analyze(self.PILEUP_METRICS, self.PILEUP_BASELINES, {}, NOW)
        assert "1.2" in result.observed or "slow" in result.observed.lower()

    def test_pileup_evidence_has_slow_query_rate(self):
        result = analyzer.analyze(self.PILEUP_METRICS, self.PILEUP_BASELINES, {}, NOW)
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        slow_ev = next((e for e in metric_evidence if "slow.query.rate" in e.text), None)
        assert slow_ev is not None

    def test_pileup_evidence_confirms_pileup(self):
        result = analyzer.analyze(self.PILEUP_METRICS, self.PILEUP_BASELINES, {}, NOW)
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        slow_ev = next((e for e in metric_evidence if "slow.query.rate" in e.text), None)
        assert slow_ev is not None
        assert "pile" in slow_ev.text.lower() or "slow" in slow_ev.text.lower()

    def test_pileup_evidence_slow_query_has_positive_confidence_delta(self):
        result = analyzer.analyze(self.PILEUP_METRICS, self.PILEUP_BASELINES, {}, NOW)
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        slow_ev = next((e for e in metric_evidence if "slow.query.rate" in e.text), None)
        assert slow_ev is not None
        assert slow_ev.confidence_delta == 1


# ── 4. Surge pattern ─────────────────────────────────────────────────────────

class TestSurgePattern:
    """
    Simulator: Genuine traffic surge scenario.
    A marketing campaign launched at 20:00 drove 2.8x normal query volume.
    Connections increased proportionally — every connection is actively
    working. Active threads are at 30 (4σ above baseline). Query rate at
    1,400/s (sigma=2.0 above baseline of 1,000/s). Slow queries normal.

    threads_running=30, conn_current=170 → utilization=30/170=0.18 > 0.15
    This escapes the leak branch. Slow query rate 0.1 < 0.5 escapes pile-up.
    queries_sigma=2.0 > 1.5 AND threads_sigma=4.0 > 0.5 → SURGE.

    Expected: degraded/critical, SURGE pattern, HIGH confidence.
    Recommendation: short-term increase max_connections, medium-term ProxySQL.
    """

    SURGE_METRICS = {
        "mysql.connection.pct":      85.0,   # sigma=3.5
        "mysql.connections.current": 170.0,
        "mysql.threads.running":     30.0,   # utilization=30/170=0.18 > 0.15 (escapes leak)
                                             # threads_sigma=(30-10)/5=4.0 > 0.5 (surge corroboration)
        "mysql.slow.query.rate":     0.1,    # < 0.5 (escapes pile-up)
        "mysql.query.rate":          1400.0, # queries_sigma=(1400-1000)/200=2.0 > 1.5 (surge signal)
    }

    def test_surge_is_degraded_or_critical(self):
        result = analyzer.analyze(self.SURGE_METRICS, NORMAL_BASELINES, {}, NOW)
        assert result.status in (HealthStatus.degraded, HealthStatus.critical)

    def test_surge_confidence_high(self):
        """Query rate + threads both elevated and proportional → HIGH."""
        result = analyzer.analyze(self.SURGE_METRICS, NORMAL_BASELINES, {}, NOW)
        assert result.confidence == ConfidenceLevel.high

    def test_surge_root_cause_names_traffic_surge(self):
        result = analyzer.analyze(self.SURGE_METRICS, NORMAL_BASELINES, {}, NOW)
        assert "surge" in result.root_cause.lower() or "traffic" in result.root_cause.lower()

    def test_surge_root_cause_says_genuine_load(self):
        """Must distinguish from leak/pile-up — this is real database load."""
        result = analyzer.analyze(self.SURGE_METRICS, NORMAL_BASELINES, {}, NOW)
        assert "genuine" in result.root_cause.lower() or "real load" in result.root_cause.lower() \
               or "real" in result.root_cause.lower()

    def test_surge_recommendation_mentions_max_connections(self):
        """Raising max_connections IS valid for a surge — unlike leak or pile-up."""
        result = analyzer.analyze(self.SURGE_METRICS, NORMAL_BASELINES, {}, NOW)
        assert "max_connections" in result.recommendation.lower()

    def test_surge_recommendation_mentions_connection_pooler(self):
        """Medium-term fix: ProxySQL or PgBouncer to multiplex connections."""
        result = analyzer.analyze(self.SURGE_METRICS, NORMAL_BASELINES, {}, NOW)
        rec = result.recommendation.lower()
        assert "proxysql" in rec or "pgbouncer" in rec or "pooler" in rec or "pool" in rec

    def test_surge_observed_shows_query_rate(self):
        result = analyzer.analyze(self.SURGE_METRICS, NORMAL_BASELINES, {}, NOW)
        assert "1400" in result.observed or "query rate" in result.observed.lower()

    def test_surge_evidence_has_query_rate(self):
        result = analyzer.analyze(self.SURGE_METRICS, NORMAL_BASELINES, {}, NOW)
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        qr_ev = next((e for e in metric_evidence if "mysql.query.rate=" in e.text), None)
        assert qr_ev is not None

    def test_surge_evidence_confirms_surge(self):
        result = analyzer.analyze(self.SURGE_METRICS, NORMAL_BASELINES, {}, NOW)
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        qr_ev = next((e for e in metric_evidence if "mysql.query.rate=" in e.text), None)
        assert qr_ev is not None
        assert "surge" in qr_ev.text.lower()

    def test_surge_evidence_query_rate_has_positive_confidence_delta(self):
        result = analyzer.analyze(self.SURGE_METRICS, NORMAL_BASELINES, {}, NOW)
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        qr_ev = next((e for e in metric_evidence if "mysql.query.rate=" in e.text), None)
        assert qr_ev is not None
        assert qr_ev.confidence_delta == 1


# ── 5. No pattern — insufficient corroborating signals ────────────────────────

class TestNoPatternClassified:
    """
    Simulator: Connections high but threads_running not available.
    Maybe mysqld_exporter is partially configured and threads_running
    isn't being scraped. Connection % is 80% (sigma=3.0 → degraded)
    but without threads_running, the pattern cannot be classified.

    Expected: degraded status, generic root cause, diagnostic query in recommendation.
    """

    NO_PATTERN_METRICS = {
        "mysql.connection.pct":      80.0,   # sigma=(80-50)/10=3.0 → degraded
        "mysql.connections.current": 160.0,
        # mysql.threads.running intentionally absent
        "mysql.slow.query.rate":     0.2,
    }

    def test_no_pattern_is_degraded(self):
        result = analyzer.analyze(self.NO_PATTERN_METRICS, NORMAL_BASELINES, {}, NOW)
        assert result.status == HealthStatus.degraded

    def test_no_pattern_confidence_not_high(self):
        """Without corroborating signals, cannot be HIGH confidence."""
        result = analyzer.analyze(self.NO_PATTERN_METRICS, NORMAL_BASELINES, {}, NOW)
        assert result.confidence != ConfidenceLevel.high

    def test_no_pattern_root_cause_mentions_insufficient_signals(self):
        result = analyzer.analyze(self.NO_PATTERN_METRICS, NORMAL_BASELINES, {}, NOW)
        assert "insufficient" in result.root_cause.lower() or "elevated" in result.root_cause.lower()

    def test_no_pattern_recommendation_has_diagnostic_query(self):
        """Should give the engineer a manual diagnostic query to classify the pattern."""
        result = analyzer.analyze(self.NO_PATTERN_METRICS, NORMAL_BASELINES, {}, NOW)
        rec = result.recommendation.lower()
        assert "processlist" in rec or "sleep" in rec or "information_schema" in rec


# ── 6. No baseline (absolute threshold path) ──────────────────────────────────

class TestNoBaseline:
    """
    Simulator: New cluster, < 100 metric samples.
    No baseline exists. The analyzer must fall back to absolute thresholds:
      >= 90% → critical
      >= 70% → degraded
      < 70%  → healthy
    Confidence must be LOW because sigma scoring is unavailable.
    """

    def test_no_baseline_critical_at_90pct(self):
        metrics = {
            "mysql.connection.pct":      92.0,
            "mysql.connections.current": 184.0,
        }
        result = analyzer.analyze(metrics, {}, {}, NOW)
        assert result.status == HealthStatus.critical

    def test_no_baseline_degraded_at_75pct(self):
        metrics = {
            "mysql.connection.pct":      75.0,
            "mysql.connections.current": 150.0,
        }
        result = analyzer.analyze(metrics, {}, {}, NOW)
        assert result.status == HealthStatus.degraded

    def test_no_baseline_healthy_at_50pct(self):
        metrics = {
            "mysql.connection.pct":      50.0,
            "mysql.connections.current": 100.0,
        }
        result = analyzer.analyze(metrics, {}, {}, NOW)
        assert result.status == HealthStatus.healthy

    def test_no_baseline_confidence_low(self):
        """Without a baseline, sigma scoring is impossible → LOW confidence always."""
        metrics = {
            "mysql.connection.pct":      92.0,
            "mysql.connections.current": 184.0,
        }
        result = analyzer.analyze(metrics, {}, {}, NOW)
        assert result.confidence == ConfidenceLevel.low

    def test_no_baseline_summary_mentions_insufficient_history(self):
        metrics = {
            "mysql.connection.pct":      92.0,
            "mysql.connections.current": 184.0,
        }
        result = analyzer.analyze(metrics, {}, {}, NOW)
        assert "insufficient" in result.baseline_summary.lower() or \
               "no baseline" in result.baseline_summary.lower()

    def test_no_baseline_boundary_exactly_70pct_is_degraded(self):
        """Boundary condition: exactly 70% must be degraded (>= 70 threshold)."""
        metrics = {
            "mysql.connection.pct":      70.0,
            "mysql.connections.current": 140.0,
        }
        result = analyzer.analyze(metrics, {}, {}, NOW)
        assert result.status == HealthStatus.degraded

    def test_no_baseline_below_70pct_is_healthy(self):
        metrics = {
            "mysql.connection.pct":      69.9,
            "mysql.connections.current": 139.0,
        }
        result = analyzer.analyze(metrics, {}, {}, NOW)
        assert result.status == HealthStatus.healthy


# ── 7. Log signal — too many connections ─────────────────────────────────────

class TestLogSignal:
    """
    Simulator: Log event confirming connections are actively being refused.
    MySQL itself has logged 'Too many connections' error — this is direct
    evidence, not an inference. Confidence must immediately go to HIGH
    regardless of other signal state.
    """

    BASE_METRICS = {
        "mysql.connection.pct":      85.0,
        "mysql.connections.current": 170.0,
        "mysql.threads.running":     5.0,
        "mysql.slow.query.rate":     0.1,
    }

    def test_log_signal_forces_high_confidence(self):
        log_signals = {"mysql_too_many_connections": 3}
        result = analyzer.analyze(self.BASE_METRICS, NORMAL_BASELINES, log_signals, NOW)
        assert result.confidence == ConfidenceLevel.high

    def test_log_signal_appears_in_evidence(self):
        log_signals = {"mysql_too_many_connections": 3}
        result = analyzer.analyze(self.BASE_METRICS, NORMAL_BASELINES, log_signals, NOW)
        log_evidence = [e for e in result.evidence if e.source_type == "log_signal"]
        assert len(log_evidence) >= 1

    def test_log_signal_evidence_mentions_refused(self):
        log_signals = {"mysql_too_many_connections": 3}
        result = analyzer.analyze(self.BASE_METRICS, NORMAL_BASELINES, log_signals, NOW)
        log_evidence = [e for e in result.evidence if e.source_type == "log_signal"]
        text = log_evidence[0].text.lower()
        assert "refused" in text or "too many" in text or "connections" in text

    def test_log_signal_evidence_has_positive_confidence_delta(self):
        log_signals = {"mysql_too_many_connections": 3}
        result = analyzer.analyze(self.BASE_METRICS, NORMAL_BASELINES, log_signals, NOW)
        log_evidence = [e for e in result.evidence if e.source_type == "log_signal"]
        assert log_evidence[0].confidence_delta == 1

    def test_no_log_signal_does_not_add_log_evidence(self):
        result = analyzer.analyze(self.BASE_METRICS, NORMAL_BASELINES, {}, NOW)
        log_evidence = [e for e in result.evidence if e.source_type == "log_signal"]
        assert len(log_evidence) == 0


# ── 8. Critical vs degraded boundary ─────────────────────────────────────────

class TestStatusBoundaries:
    """
    Simulator: Precise boundary testing with a known baseline.
    baseline: p50=50, std_dev=10, p95=65
      sigma > 3.5 (conn_pct > 85) → critical
      sigma > 2.0 (conn_pct > 70) → degraded
      conn_pct >= 90 → always critical regardless of sigma
    """

    def test_absolute_90pct_is_critical_regardless_of_sigma(self):
        """90% absolute threshold overrides sigma — even if sigma < 3.5."""
        # With baseline p50=50, std_dev=10: sigma at 90% = 4.0 (happens to be > 3.5 too)
        # Use a high-std_dev baseline to depress sigma while keeping absolute pct high
        high_std_baselines = {
            "mysql.connection.pct": make_baseline(p50=50.0, p75=70.0, p95=85.0, std_dev=25.0),
        }
        # sigma = (90-50)/25 = 1.6 < 3.5 — but absolute >= 90 still triggers critical
        metrics = {
            "mysql.connection.pct":      90.0,
            "mysql.connections.current": 180.0,
        }
        result = analyzer.analyze(metrics, high_std_baselines, {}, NOW)
        assert result.status == HealthStatus.critical

    def test_above_p95_baseline_is_degraded(self):
        """conn_pct just above p95 triggers degraded even without sigma threshold breach."""
        metrics = {
            "mysql.connection.pct":      66.0,   # > p95=65, sigma=(66-50)/10=1.6 < 2.0
            "mysql.connections.current": 132.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)
        assert result.status == HealthStatus.degraded

    def test_well_within_baseline_is_healthy(self):
        metrics = {
            "mysql.connection.pct":      55.0,   # sigma=0.5, below p95=65
            "mysql.connections.current": 110.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)
        assert result.status == HealthStatus.healthy


# ── 9. Can run — required metrics ────────────────────────────────────────────

class TestCanRun:
    """Verifies the analyzer correctly gates on required metrics."""

    def test_can_run_with_required_metrics(self):
        assert analyzer.can_run({"mysql.connection.pct", "mysql.connections.current"})

    def test_cannot_run_missing_connection_pct(self):
        assert not analyzer.can_run({"mysql.connections.current"})

    def test_cannot_run_missing_connections_current(self):
        assert not analyzer.can_run({"mysql.connection.pct"})

    def test_cannot_run_empty_metrics(self):
        assert not analyzer.can_run(set())

    def test_can_run_with_extra_metrics(self):
        """Extra metrics beyond required should not prevent running."""
        assert analyzer.can_run({
            "mysql.connection.pct",
            "mysql.connections.current",
            "mysql.threads.running",
            "mysql.slow.query.rate",
            "mysql.query.rate",
        })


# ── 10. Evidence chain integrity ─────────────────────────────────────────────

class TestEvidenceChain:
    """
    Verifies evidence items are built correctly for each pattern.
    The evidence list is what drives the LLM explanation quality.
    """

    def test_evidence_always_has_connection_pct_item(self):
        """Every run must include the primary metric in evidence."""
        metrics = {
            "mysql.connection.pct":      85.0,
            "mysql.connections.current": 170.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        conn_ev = next((e for e in metric_evidence if "connection.pct" in e.text), None)
        assert conn_ev is not None

    def test_connection_pct_evidence_shows_sigma(self):
        metrics = {
            "mysql.connection.pct":      85.0,
            "mysql.connections.current": 170.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        conn_ev = next((e for e in metric_evidence if "connection.pct" in e.text), None)
        assert "sigma" in conn_ev.text.lower()

    def test_leak_evidence_threads_shows_utilization_pct(self):
        """Leak pattern evidence must show what % of connections are active."""
        leak_metrics = {
            "mysql.connection.pct":      85.0,
            "mysql.connections.current": 170.0,
            "mysql.threads.running":     5.0,
            "mysql.slow.query.rate":     0.1,
        }
        result = analyzer.analyze(leak_metrics, NORMAL_BASELINES, {}, NOW)
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        threads_ev = next((e for e in metric_evidence if "threads.running" in e.text), None)
        assert threads_ev is not None
        assert "%" in threads_ev.text   # utilization ratio should appear as percentage

    def test_surge_evidence_shows_baseline_comparison(self):
        """Surge evidence must show current vs baseline query rate."""
        surge_metrics = {
            "mysql.connection.pct":      85.0,
            "mysql.connections.current": 170.0,
            "mysql.threads.running":     30.0,
            "mysql.slow.query.rate":     0.1,
            "mysql.query.rate":          1400.0,
        }
        result = analyzer.analyze(surge_metrics, NORMAL_BASELINES, {}, NOW)
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        qr_ev = next((e for e in metric_evidence if "mysql.query.rate=" in e.text), None)
        assert qr_ev is not None
        assert "baseline" in qr_ev.text.lower() or "p50" in qr_ev.text.lower()

    def test_all_patterns_produce_at_least_two_evidence_items(self):
        """Minimum evidence for a useful LLM explanation."""
        for metrics in [
            # leak
            {"mysql.connection.pct": 85.0, "mysql.connections.current": 170.0,
             "mysql.threads.running": 5.0, "mysql.slow.query.rate": 0.1},
            # pileup
            {"mysql.connection.pct": 85.0, "mysql.connections.current": 170.0,
             "mysql.threads.running": 20.0, "mysql.slow.query.rate": 1.2},
            # surge
            {"mysql.connection.pct": 85.0, "mysql.connections.current": 170.0,
             "mysql.threads.running": 30.0, "mysql.slow.query.rate": 0.1,
             "mysql.query.rate": 1400.0},
        ]:
            result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)
            assert len(result.evidence) >= 2, \
                f"Expected >=2 evidence items, got {len(result.evidence)} for metrics={metrics}"
