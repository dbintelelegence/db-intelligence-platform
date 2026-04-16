"""
Tests: skip-if-unchanged guard in analyzer_runner

The runner skips writing a new verdict row when both:
  - status is identical to the previous verdict, AND
  - observed text is identical to the previous verdict

A new row is always written when:
  - there is no previous verdict (first run)
  - status has changed
  - observed text has changed (metric values shifted) even if status is the same

_get_prev_verdict and _get_prev_status are tested directly.
The skip-if-unchanged condition is tested by mocking _get_prev_verdict
inside run_cluster_from_metrics to isolate DB interactions.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

from app.models.models import HealthStatus, ConfidenceLevel
from app.analyzers.base import VerdictResult, EvidenceItem


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_cluster(cluster_id_str="Alpha|us-east1|test_cluster"):
    from app.models.models import DbType
    c = MagicMock()
    c.id = uuid.uuid4()
    c.cluster_id = cluster_id_str
    c.display_name = "Test Cluster"
    c.db_type = DbType.elasticsearch
    c.current_status = HealthStatus.healthy
    return c


def make_verdict_row(status, observed, analyzer_name="jvm_heap_pressure", instance_id=None):
    """Simulate a Verdict ORM row returned by the DB."""
    v = MagicMock()
    v.id = uuid.uuid4()
    v.status = status
    v.observed = observed
    v.analyzer_name = analyzer_name
    v.instance_id = instance_id
    v.run_at = datetime(2026, 4, 15, 10, 0, 0, tzinfo=timezone.utc)
    return v


def make_verdict_result(status, observed, analyzer_name="jvm_heap_pressure", instance_id=None):
    """Simulate a VerdictResult returned by an analyzer."""
    return VerdictResult(
        analyzer_name=analyzer_name,
        status=status,
        observed=observed,
        baseline_summary="p50=60 p95=80",
        root_cause="Test root cause",
        recommendation="Test recommendation",
        confidence=ConfidenceLevel.medium,
        evidence=[],
        metric_ts=datetime(2026, 4, 15, 10, 1, 0, tzinfo=timezone.utc),
        instance_id=instance_id,
    )


def make_db_for_cluster(cluster):
    """
    Build an AsyncMock DB that returns `cluster` from select(Cluster).
    Uses a sync MagicMock for the execute chain so scalar_one_or_none/scalar_one
    don't return coroutines.
    """
    db = AsyncMock()
    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = cluster
    exec_result.scalar_one.return_value = cluster
    db.execute.return_value = exec_result
    return db


# ── Tests for _get_prev_verdict ───────────────────────────────────────────────

class TestGetPrevVerdict:
    """_get_prev_verdict fetches the most recent Verdict row or returns None."""

    @pytest.mark.asyncio
    async def test_returns_none_when_no_prior_verdicts(self):
        from app.runner.analyzer_runner import _get_prev_verdict

        exec_result = MagicMock()
        exec_result.scalar_one_or_none.return_value = None
        db = AsyncMock()
        db.execute.return_value = exec_result

        result = await _get_prev_verdict(db, uuid.uuid4(), "jvm_heap_pressure")
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_verdict_row_when_prior_exists(self):
        from app.runner.analyzer_runner import _get_prev_verdict

        prior = make_verdict_row(HealthStatus.critical, "heap at 95%")
        exec_result = MagicMock()
        exec_result.scalar_one_or_none.return_value = prior
        db = AsyncMock()
        db.execute.return_value = exec_result

        result = await _get_prev_verdict(db, uuid.uuid4(), "jvm_heap_pressure")
        assert result is prior
        assert result.status == HealthStatus.critical

    @pytest.mark.asyncio
    async def test_get_prev_status_returns_none_when_no_prior(self):
        from app.runner.analyzer_runner import _get_prev_status

        exec_result = MagicMock()
        exec_result.scalar_one_or_none.return_value = None
        db = AsyncMock()
        db.execute.return_value = exec_result

        result = await _get_prev_status(db, uuid.uuid4(), "jvm_heap_pressure")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_prev_status_returns_status_from_verdict(self):
        from app.runner.analyzer_runner import _get_prev_status

        prior = make_verdict_row(HealthStatus.degraded, "heap at 82%")
        exec_result = MagicMock()
        exec_result.scalar_one_or_none.return_value = prior
        db = AsyncMock()
        db.execute.return_value = exec_result

        result = await _get_prev_status(db, uuid.uuid4(), "jvm_heap_pressure")
        assert result == HealthStatus.degraded

    @pytest.mark.asyncio
    async def test_get_prev_status_consistent_with_get_prev_verdict(self):
        """_get_prev_status must return the same value as _get_prev_verdict().status."""
        from app.runner.analyzer_runner import _get_prev_status, _get_prev_verdict

        prior = make_verdict_row(HealthStatus.critical, "heap 95%")
        exec_result = MagicMock()
        exec_result.scalar_one_or_none.return_value = prior
        db = AsyncMock()
        db.execute.return_value = exec_result
        cluster_uuid = uuid.uuid4()

        verdict = await _get_prev_verdict(db, cluster_uuid, "jvm_heap_pressure")

        # Reset the mock for second call
        exec_result.scalar_one_or_none.return_value = prior
        status = await _get_prev_status(db, cluster_uuid, "jvm_heap_pressure")

        assert status == verdict.status


# ── Tests for skip-if-unchanged condition ─────────────────────────────────────

class TestSkipCondition:
    """
    Tests the skip-if-unchanged condition in isolation.
    We patch _get_prev_verdict and _write_verdict so no DB is needed.
    The analyzer is also patched to return a controlled VerdictResult.
    """

    # Full set of required + corroborating metrics for JvmHeapPressureAnalyzer
    COMMON_METRICS = {
        "jvm.heap.used.percent": 91.0,
        "jvm.heap.used.bytes": 9_500_000_000,
        "jvm.heap.max.bytes": 10_000_000_000,
        "gc.old.collection.seconds": 5.0,
        "gc.old.collection.count": 10.0,
    }

    RUN_AT = datetime(2026, 4, 15, 10, 1, 0, tzinfo=timezone.utc)

    async def _run(self, cluster, prev_verdict, analyzer_result):
        """
        Helper: run run_cluster_from_metrics with all DB/LLM/analyzer calls mocked.
        Patches can_run() → True so the analyzer always proceeds regardless of
        which metrics are in the dict, then patches analyze() to return our result.
        """
        from app.runner.analyzer_runner import run_cluster_from_metrics

        db = make_db_for_cluster(cluster)

        with patch("app.runner.analyzer_runner._get_prev_verdict",
                   new_callable=AsyncMock, return_value=prev_verdict), \
             patch("app.runner.analyzer_runner._write_verdict",
                   new_callable=AsyncMock,
                   return_value=make_verdict_row(analyzer_result.status, analyzer_result.observed)) as mock_write, \
             patch("app.runner.analyzer_runner._update_cluster_status",
                   new_callable=AsyncMock), \
             patch("app.runner.analyzer_runner.get_baselines_for_cluster",
                   new_callable=AsyncMock, return_value={}), \
             patch("app.runner.analyzer_runner.generate_explanation",
                   new_callable=AsyncMock):

            from app.analyzers.elasticsearch.jvm_heap_pressure import JvmHeapPressureAnalyzer
            with patch.object(JvmHeapPressureAnalyzer, "can_run", return_value=True), \
                 patch.object(JvmHeapPressureAnalyzer, "analyze", return_value=analyzer_result):
                await run_cluster_from_metrics(
                    db=db,
                    cluster_composite_id=cluster.cluster_id,
                    metrics=self.COMMON_METRICS,
                    per_instance={},
                    run_at=self.RUN_AT,
                )

            return mock_write

    @pytest.mark.asyncio
    async def test_no_prior_verdict_always_writes(self):
        """First ever run for this analyzer — no prior verdict → must write."""
        cluster = make_cluster()
        result = make_verdict_result(HealthStatus.critical, "heap 91%")

        mock_write = await self._run(cluster, prev_verdict=None, analyzer_result=result)
        assert mock_write.called

    @pytest.mark.asyncio
    async def test_same_status_same_observed_skips_write(self):
        """Identical status + observed → skip write to avoid row bloat."""
        cluster = make_cluster()
        observed = "heap 91%"
        prior = make_verdict_row(HealthStatus.critical, observed)
        result = make_verdict_result(HealthStatus.critical, observed)

        mock_write = await self._run(cluster, prev_verdict=prior, analyzer_result=result)
        assert not mock_write.called

    @pytest.mark.asyncio
    async def test_status_change_degraded_to_critical_writes(self):
        """Status escalated from degraded to critical → must write."""
        cluster = make_cluster()
        observed = "heap 91%"
        prior = make_verdict_row(HealthStatus.degraded, observed)
        result = make_verdict_result(HealthStatus.critical, observed)

        mock_write = await self._run(cluster, prev_verdict=prior, analyzer_result=result)
        assert mock_write.called

    @pytest.mark.asyncio
    async def test_status_change_critical_to_healthy_writes(self):
        """Issue resolved — critical → healthy must write to capture recovery."""
        cluster = make_cluster()
        prior = make_verdict_row(HealthStatus.critical, "heap 91%")
        result = make_verdict_result(HealthStatus.healthy, "heap 55% — within normal range.")

        mock_write = await self._run(cluster, prev_verdict=prior, analyzer_result=result)
        assert mock_write.called

    @pytest.mark.asyncio
    async def test_observed_change_same_status_writes(self):
        """
        Status unchanged (both critical) but metric value shifted in observed text
        → must write to preserve the data point for the trend chart.
        """
        cluster = make_cluster()
        prior = make_verdict_row(HealthStatus.critical, "heap 91%")
        result = make_verdict_result(HealthStatus.critical, "heap 93.5%")  # value changed

        mock_write = await self._run(cluster, prev_verdict=prior, analyzer_result=result)
        assert mock_write.called

    @pytest.mark.asyncio
    async def test_healthy_unchanged_skips_write(self):
        """Stable healthy cluster running at 60s cadence — must not accumulate rows."""
        cluster = make_cluster()
        observed = "heap 55% — within normal range."
        prior = make_verdict_row(HealthStatus.healthy, observed)
        result = make_verdict_result(HealthStatus.healthy, observed)

        mock_write = await self._run(cluster, prev_verdict=prior, analyzer_result=result)
        assert not mock_write.called

    @pytest.mark.asyncio
    async def test_status_same_observed_whitespace_difference_writes(self):
        """
        Even a minor observed text difference (trailing space, rounding) counts as changed.
        We do exact string comparison — no normalisation.
        """
        cluster = make_cluster()
        prior = make_verdict_row(HealthStatus.critical, "heap 91.0%")
        result = make_verdict_result(HealthStatus.critical, "heap 91.1%")  # 0.1% shift

        mock_write = await self._run(cluster, prev_verdict=prior, analyzer_result=result)
        assert mock_write.called
