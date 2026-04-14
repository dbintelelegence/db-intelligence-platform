"""
Regression tests for per-instance verdict architecture.

Tests cover the bugs that were fixed:
  1. Analyzers that support per-instance return list[VerdictResult], not a single result
  2. Each result has a non-None instance_id matching the node/host
  3. Fallback to cluster-level (instance_id=None) when per_instance_metrics not provided
  4. Per-instance results don't collapse: one degraded + two healthy = two healthy, one degraded

Run with:  cd backend && python -m pytest tests/test_analyzers/test_per_instance_verdicts.py -v
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.analyzers.elasticsearch.jvm_heap_pressure import JvmHeapPressureAnalyzer
from app.analyzers.elasticsearch.thread_pool_saturation import ThreadPoolSaturationAnalyzer
from app.analyzers.mysql.innodb_buffer_pool_pressure import InnodbBufferPoolPressureAnalyzer
from app.models.models import HealthStatus, ConfidenceLevel


NOW = datetime.now(timezone.utc)


def make_baseline(p50, p75, p95, p99=None, mean=None, std_dev=None):
    b = MagicMock()
    b.p50 = p50
    b.p75 = p75
    b.p95 = p95
    b.p99 = p99 or p95
    b.mean = mean or p50
    b.std_dev = std_dev or max((p95 - p50) / 2, 0.01)
    return b


JVM_BASELINES = {
    "jvm.heap.used.percent": make_baseline(58.0, 65.0, 72.0, mean=59.0, std_dev=6.0),
    "gc.old.collection.seconds": make_baseline(0.3, 0.5, 0.8, mean=0.35, std_dev=0.15),
    "gc.old.collection.count": make_baseline(2.0, 3.0, 5.0, mean=2.2, std_dev=0.8),
}

TP_BASELINES = {
    "thread_pool.write.rejected": make_baseline(0.0, 0.0, 0.0, mean=0.0, std_dev=0.0),
    "thread_pool.write.queue": make_baseline(0.0, 1.0, 3.0, mean=0.5, std_dev=1.0),
}

INNODB_BASELINES = {}  # empty — no baseline yet, low confidence path


# ── JVM Heap Pressure ─────────────────────────────────────────────────────────

class TestJvmHeapPressurePerInstance:

    def setup_method(self):
        self.analyzer = JvmHeapPressureAnalyzer()
        self.cluster_metrics = {
            "jvm.heap.used.percent": 65.0,
            "gc.old.collection.seconds": 0.4,
            "gc.old.collection.count": 2.5,
        }

    def test_returns_list(self):
        per_instance = {
            "node-1": {"jvm.heap.used.percent": 65.0, "gc.old.collection.seconds": 0.3, "gc.old.collection.count": 2.0},
            "node-2": {"jvm.heap.used.percent": 55.0, "gc.old.collection.seconds": 0.2, "gc.old.collection.count": 1.5},
        }
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=JVM_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=per_instance,
        )
        assert isinstance(results, list)
        assert len(results) == 2

    def test_each_result_has_instance_id(self):
        per_instance = {
            "node-1": {"jvm.heap.used.percent": 65.0, "gc.old.collection.seconds": 0.3, "gc.old.collection.count": 2.0},
            "node-2": {"jvm.heap.used.percent": 55.0, "gc.old.collection.seconds": 0.2, "gc.old.collection.count": 1.5},
        }
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=JVM_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=per_instance,
        )
        instance_ids = {r.instance_id for r in results}
        assert instance_ids == {"node-1", "node-2"}

    def test_per_instance_statuses_are_independent(self):
        """One node degraded, one healthy — must produce separate verdicts, not collapse."""
        per_instance = {
            "node-degraded": {"jvm.heap.used.percent": 80.0, "gc.old.collection.seconds": 0.9, "gc.old.collection.count": 6.0},
            "node-healthy":  {"jvm.heap.used.percent": 50.0, "gc.old.collection.seconds": 0.2, "gc.old.collection.count": 1.5},
        }
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=JVM_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=per_instance,
        )
        by_node = {r.instance_id: r for r in results}
        assert by_node["node-degraded"].status in (HealthStatus.degraded, HealthStatus.critical)
        assert by_node["node-healthy"].status == HealthStatus.healthy

    def test_fallback_to_cluster_level_when_no_per_instance(self):
        """When per_instance_metrics is None, return single cluster-level verdict with instance_id=None."""
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=JVM_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=None,
        )
        assert isinstance(results, list)
        assert len(results) == 1
        assert results[0].instance_id is None

    def test_node_missing_heap_metric_is_skipped(self):
        """A node dict without jvm.heap.used.percent should be skipped — not crash."""
        per_instance = {
            "node-1": {"jvm.heap.used.percent": 65.0, "gc.old.collection.seconds": 0.3, "gc.old.collection.count": 2.0},
            "node-no-heap": {"gc.old.collection.seconds": 0.3},  # missing required metric
        }
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=JVM_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=per_instance,
        )
        # node-no-heap should be skipped, only node-1 returned
        assert len(results) == 1
        assert results[0].instance_id == "node-1"


# ── Thread Pool Saturation ────────────────────────────────────────────────────

class TestThreadPoolSaturationPerInstance:

    def setup_method(self):
        self.analyzer = ThreadPoolSaturationAnalyzer()
        self.cluster_metrics = {
            "thread_pool.write.rejected": 0.0,
            "thread_pool.write.queue": 1.0,
        }

    def test_returns_list_per_node(self):
        per_instance = {
            "node-1": {"thread_pool.write.rejected": 0.0, "thread_pool.write.queue": 0.0},
            "node-2": {"thread_pool.write.rejected": 5.0, "thread_pool.write.queue": 10.0},
            "node-3": {"thread_pool.write.rejected": 0.0, "thread_pool.write.queue": 0.0},
        }
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=TP_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=per_instance,
        )
        assert len(results) == 3

    def test_zero_baseline_rejection_triggers_critical(self):
        """When baseline std_dev == 0 (always-zero baseline), any rejection is critical."""
        per_instance = {
            "node-1": {"thread_pool.write.rejected": 1.0, "thread_pool.write.queue": 0.0},
        }
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=TP_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=per_instance,
        )
        assert results[0].status == HealthStatus.critical

    def test_fallback_cluster_level_when_no_per_instance(self):
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=TP_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=None,
        )
        assert len(results) == 1
        assert results[0].instance_id is None


# ── InnoDB Buffer Pool Pressure ───────────────────────────────────────────────

class TestInnodbBufferPoolPerInstance:

    def setup_method(self):
        self.analyzer = InnodbBufferPoolPressureAnalyzer()
        self.cluster_metrics = {
            "mysql.buffer.pool.bytes": 8 * 1024**3,
            "mysql.memory.total.bytes": 16 * 1024**3,
            "mysql.buffer.pool.pressure.pct": 50.0,
        }

    def test_returns_list_per_instance(self):
        per_instance = {
            "10.0.0.1": {
                "mysql.buffer.pool.pressure.pct": 60.0,
                "mysql.buffer.pool.bytes": 9.6 * 1024**3,
                "mysql.memory.total.bytes": 16 * 1024**3,
            },
            "10.0.0.2": {
                "mysql.buffer.pool.pressure.pct": 80.0,
                "mysql.buffer.pool.bytes": 12.8 * 1024**3,
                "mysql.memory.total.bytes": 16 * 1024**3,
            },
        }
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=INNODB_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=per_instance,
        )
        assert isinstance(results, list)
        assert len(results) == 2

    def test_instance_ids_are_set(self):
        per_instance = {
            "10.0.0.1": {
                "mysql.buffer.pool.pressure.pct": 60.0,
                "mysql.buffer.pool.bytes": 9.6 * 1024**3,
                "mysql.memory.total.bytes": 16 * 1024**3,
            },
        }
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=INNODB_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=per_instance,
        )
        assert results[0].instance_id == "10.0.0.1"

    def test_pressure_above_75pct_is_degraded(self):
        """Buffer pool >75% of total RAM should trigger degraded."""
        per_instance = {
            "10.0.0.1": {
                "mysql.buffer.pool.pressure.pct": 78.0,
                "mysql.buffer.pool.bytes": 12.5 * 1024**3,
                "mysql.memory.total.bytes": 16 * 1024**3,
            },
        }
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=INNODB_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=per_instance,
        )
        assert results[0].status in (HealthStatus.degraded, HealthStatus.critical)

    def test_pressure_below_75pct_is_healthy(self):
        """Buffer pool <75% of total RAM should be healthy."""
        per_instance = {
            "10.0.0.1": {
                "mysql.buffer.pool.pressure.pct": 60.0,
                "mysql.buffer.pool.bytes": 9.6 * 1024**3,
                "mysql.memory.total.bytes": 16 * 1024**3,
            },
        }
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=INNODB_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=per_instance,
        )
        assert results[0].status == HealthStatus.healthy

    def test_pressure_above_85pct_is_critical(self):
        """Buffer pool >85% of total RAM should trigger critical."""
        per_instance = {
            "10.0.0.1": {
                "mysql.buffer.pool.pressure.pct": 90.0,
                "mysql.buffer.pool.bytes": 14.4 * 1024**3,
                "mysql.memory.total.bytes": 16 * 1024**3,
            },
        }
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=INNODB_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=per_instance,
        )
        assert results[0].status == HealthStatus.critical

    def test_instances_evaluated_independently(self):
        """One instance healthy, one degraded — must NOT collapse to worst-case."""
        per_instance = {
            "10.0.0.1": {
                "mysql.buffer.pool.pressure.pct": 50.0,
                "mysql.buffer.pool.bytes": 8 * 1024**3,
                "mysql.memory.total.bytes": 16 * 1024**3,
            },
            "10.0.0.2": {
                "mysql.buffer.pool.pressure.pct": 88.0,
                "mysql.buffer.pool.bytes": 14.1 * 1024**3,
                "mysql.memory.total.bytes": 16 * 1024**3,
            },
        }
        results = self.analyzer.analyze(
            metrics=self.cluster_metrics,
            baselines=INNODB_BASELINES,
            log_signals={},
            metric_ts=NOW,
            per_instance_metrics=per_instance,
        )
        by_host = {r.instance_id: r for r in results}
        assert by_host["10.0.0.1"].status == HealthStatus.healthy
        assert by_host["10.0.0.2"].status in (HealthStatus.degraded, HealthStatus.critical)
