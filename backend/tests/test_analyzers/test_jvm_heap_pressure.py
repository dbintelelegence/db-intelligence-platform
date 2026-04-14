"""
Tests for JvmHeapPressureAnalyzer.

These tests run entirely in memory — no database, no network.
The analyzer is a pure function: metrics + baselines + log signals → verdict.

Run with:  cd backend && python -m pytest tests/test_analyzers/test_jvm_heap_pressure.py -v
"""

import pytest
from datetime import datetime
from unittest.mock import MagicMock

from app.analyzers.elasticsearch.jvm_heap_pressure import JvmHeapPressureAnalyzer
from app.models.models import HealthStatus, ConfidenceLevel


def make_baseline(p50, p75, p95, p99, mean=None, std_dev=None):
    """Helper: create a mock baseline profile."""
    b = MagicMock()
    b.p50 = p50
    b.p75 = p75
    b.p95 = p95
    b.p99 = p99
    b.mean = mean or p50
    b.std_dev = std_dev or (p95 - p50) / 2
    return b


NORMAL_BASELINES = {
    "jvm.heap.used.percent": make_baseline(
        p50=58.0, p75=65.0, p95=72.0, p99=78.0, mean=59.0, std_dev=6.0
    ),
    "gc.old.collection.seconds": make_baseline(
        p50=0.3, p75=0.5, p95=0.8, p99=1.2, mean=0.35, std_dev=0.15
    ),
    "gc.old.collection.count": make_baseline(
        p50=2.0, p75=3.0, p95=5.0, p99=8.0, mean=2.2, std_dev=0.8
    ),
}

NOW = datetime(2026, 3, 21, 10, 15, 0)
analyzer = JvmHeapPressureAnalyzer()


class TestHealthyState:

    def test_normal_metrics_returns_healthy(self):
        metrics = {
            "jvm.heap.used.percent": 61.0,
            "gc.old.collection.seconds": 0.32,
            "gc.old.collection.count": 2.1,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)[0]
        assert result.status == HealthStatus.healthy

    def test_healthy_state_has_high_confidence(self):
        metrics = {
            "jvm.heap.used.percent": 58.0,
            "gc.old.collection.seconds": 0.30,
            "gc.old.collection.count": 2.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)[0]
        assert result.confidence == ConfidenceLevel.high

    def test_healthy_has_no_recommendation_action(self):
        metrics = {
            "jvm.heap.used.percent": 60.0,
            "gc.old.collection.seconds": 0.33,
            "gc.old.collection.count": 2.2,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)[0]
        assert "no action" in result.recommendation.lower()


class TestDegradedState:

    def test_heap_above_p75_returns_degraded(self):
        metrics = {
            "jvm.heap.used.percent": 68.0,  # above p75=65
            "gc.old.collection.seconds": 0.35,
            "gc.old.collection.count": 2.3,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)[0]
        assert result.status == HealthStatus.degraded

    def test_elevated_gc_returns_degraded(self):
        metrics = {
            "jvm.heap.used.percent": 62.0,  # normal heap
            "gc.old.collection.seconds": 0.55,  # 1.8x baseline p50 — elevated
            "gc.old.collection.count": 3.5,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)[0]
        assert result.status == HealthStatus.degraded

    def test_single_metric_anomaly_is_low_confidence(self):
        """Only heap is elevated, GC is normal — LOW confidence."""
        metrics = {
            "jvm.heap.used.percent": 74.0,  # > p95 but GC is fine
            "gc.old.collection.seconds": 0.31,
            "gc.old.collection.count": 2.1,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)[0]
        # Status degraded but confidence low since only one signal
        assert result.status in (HealthStatus.degraded, HealthStatus.critical)
        assert result.confidence == ConfidenceLevel.low


class TestCriticalState:

    def test_heap_above_p95_and_gc_3x_returns_critical(self):
        metrics = {
            "jvm.heap.used.percent": 82.0,  # > p95=72
            "gc.old.collection.seconds": 1.2,  # 4x baseline p50=0.3
            "gc.old.collection.count": 8.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)[0]
        assert result.status == HealthStatus.critical

    def test_critical_has_fielddata_recommendation_when_log_present(self):
        metrics = {
            "jvm.heap.used.percent": 85.0,
            "gc.old.collection.seconds": 1.5,
            "gc.old.collection.count": 10.0,
        }
        log_signals = {"fielddata_eviction": 47}
        result = analyzer.analyze(metrics, NORMAL_BASELINES, log_signals, NOW)[0]
        assert "fielddata" in result.recommendation.lower()

    def test_critical_root_cause_mentions_aggregation(self):
        metrics = {
            "jvm.heap.used.percent": 82.0,
            "gc.old.collection.seconds": 1.1,
            "gc.old.collection.count": 7.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)[0]
        assert "aggregation" in result.root_cause.lower() or "fielddata" in result.root_cause.lower()


class TestConfidenceLevels:

    def test_both_metrics_anomalous_gives_medium_confidence(self):
        metrics = {
            "jvm.heap.used.percent": 74.0,  # 2.5 sigma above mean
            "gc.old.collection.seconds": 0.70,  # 2.3 sigma above mean
            "gc.old.collection.count": 4.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)[0]
        assert result.confidence == ConfidenceLevel.medium

    def test_fielddata_log_boosts_confidence_to_high(self):
        metrics = {
            "jvm.heap.used.percent": 74.0,
            "gc.old.collection.seconds": 0.70,
            "gc.old.collection.count": 4.0,
        }
        log_signals = {"fielddata_eviction": 12}
        result = analyzer.analyze(metrics, NORMAL_BASELINES, log_signals, NOW)[0]
        assert result.confidence == ConfidenceLevel.high

    def test_gc_pause_log_boosts_confidence(self):
        metrics = {
            "jvm.heap.used.percent": 68.0,
            "gc.old.collection.seconds": 0.65,
            "gc.old.collection.count": 3.8,
        }
        log_signals = {"gc_pause": 8}
        result = analyzer.analyze(metrics, NORMAL_BASELINES, log_signals, NOW)[0]
        # Should be medium or high, not low
        assert result.confidence != ConfidenceLevel.low

    def test_circuit_breaker_does_not_boost_confidence(self):
        """Circuit breaker is a secondary effect — noted in evidence but doesn't boost confidence."""
        metrics = {
            "jvm.heap.used.percent": 68.0,
            "gc.old.collection.seconds": 0.35,
            "gc.old.collection.count": 2.5,
        }
        log_signals = {"circuit_breaker_trip": 3}
        result_with_cb = analyzer.analyze(metrics, NORMAL_BASELINES, log_signals, NOW)[0]
        result_without_cb = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)[0]
        assert result_with_cb.confidence == result_without_cb.confidence


class TestNoBaseline:

    def test_no_baseline_still_returns_verdict(self):
        """Analyzer must run even without baseline — just with lower confidence."""
        metrics = {
            "jvm.heap.used.percent": 82.0,
            "gc.old.collection.seconds": 1.2,
            "gc.old.collection.count": 8.0,
        }
        results = analyzer.analyze(metrics, {}, {}, NOW)
        assert results is not None
        assert len(results) > 0
        assert results[0].confidence == ConfidenceLevel.low

    def test_no_baseline_summary_says_no_baseline(self):
        metrics = {
            "jvm.heap.used.percent": 70.0,
            "gc.old.collection.seconds": 0.4,
            "gc.old.collection.count": 2.5,
        }
        result = analyzer.analyze(metrics, {}, {}, NOW)[0]
        assert "no baseline" in result.baseline_summary.lower()


class TestCanRun:

    def test_can_run_with_all_required_metrics(self):
        available = set(JvmHeapPressureAnalyzer.REQUIRED_METRICS)
        assert analyzer.can_run(available) is True

    def test_cannot_run_with_missing_required_metric(self):
        available = {"jvm.heap.used.percent", "gc.old.collection.seconds"}
        # Missing gc.old.collection.count
        assert analyzer.can_run(available) is False

    def test_can_run_with_extra_metrics(self):
        available = set(JvmHeapPressureAnalyzer.REQUIRED_METRICS) | {"some.other.metric"}
        assert analyzer.can_run(available) is True


class TestEvidenceChain:

    def test_evidence_includes_metric_observations(self):
        metrics = {
            "jvm.heap.used.percent": 80.0,
            "gc.old.collection.seconds": 0.9,
            "gc.old.collection.count": 6.0,
        }
        result = analyzer.analyze(metrics, NORMAL_BASELINES, {}, NOW)[0]
        metric_evidence = [e for e in result.evidence if e.source_type == "metric"]
        assert len(metric_evidence) >= 2

    def test_evidence_includes_log_signal_when_present(self):
        metrics = {
            "jvm.heap.used.percent": 80.0,
            "gc.old.collection.seconds": 0.9,
            "gc.old.collection.count": 6.0,
        }
        log_signals = {"fielddata_eviction": 23, "gc_pause": 5}
        result = analyzer.analyze(metrics, NORMAL_BASELINES, log_signals, NOW)[0]
        log_evidence = [e for e in result.evidence if e.source_type == "log_signal"]
        assert len(log_evidence) == 2

    def test_fielddata_evidence_has_positive_confidence_delta(self):
        metrics = {
            "jvm.heap.used.percent": 75.0,
            "gc.old.collection.seconds": 0.8,
            "gc.old.collection.count": 5.0,
        }
        log_signals = {"fielddata_eviction": 10}
        result = analyzer.analyze(metrics, NORMAL_BASELINES, log_signals, NOW)[0]
        fielddata_ev = next(
            (e for e in result.evidence if "fielddata_eviction" in e.text), None
        )
        assert fielddata_ev is not None
        assert fielddata_ev.confidence_delta == 1
