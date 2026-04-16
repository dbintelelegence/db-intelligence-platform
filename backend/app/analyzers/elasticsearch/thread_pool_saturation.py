"""
Analyzer: Thread Pool Saturation (Elasticsearch) — per-node

Failure mode: Write thread pool exhausted on a node, causing indexing rejections
and client-visible 429 errors.

Thread pools are per-node — saturation on one node can be masked by averaging
across the cluster. This analyzer writes one verdict per node.

What it watches (per node via get_latest_metrics_per_instance):
  Metrics (required):
    - thread_pool.write.rejected  — cumulative rejected task count (counter)
    - thread_pool.write.queue     — current queue depth

  Metrics (corroborating):
    - thread_pool.write.active    — threads currently executing tasks

  Log signals (optional, boost confidence):
    - bulk_rejection              — explicit bulk rejection in logs
    - indexing_pressure_high      — indexing memory pressure signal
    - es_circuit_breaker_open     — circuit breaker opened under write load

Verdict logic:
  Critical:
    - rejected > 0 AND baseline std_dev == 0 (never rejected before)
    - OR rejected sigma > critical_sigma_threshold

  Degraded:
    - rejected > baseline p95
    - OR queue > baseline p95
    - OR sigma > degraded_sigma_threshold

  Healthy:
    - All metrics within baseline bounds

Returns list[VerdictResult] — one entry per ES node.
"""

from datetime import datetime
from app.analyzers.base import BaseAnalyzer, EvidenceItem, VerdictResult
from app.core.config import get_settings
from app.models.models import ConfidenceLevel, HealthStatus

settings = get_settings()

PER_INSTANCE_METRICS = [
    "thread_pool.write.rejected",
    "thread_pool.write.queue",
    "thread_pool.write.active",
]


class ThreadPoolSaturationAnalyzer(BaseAnalyzer):

    ANALYZER_NAME = "thread_pool_saturation"

    REQUIRED_METRICS = [
        "thread_pool.write.rejected",
        "thread_pool.write.queue",
    ]

    CORROBORATING_METRICS = [
        "thread_pool.write.active",
    ]

    OPTIONAL_LOG_SIGNALS = [
        "bulk_rejection",
        "indexing_pressure_high",
        "es_circuit_breaker_open",
    ]

    def analyze(
        self,
        metrics: dict[str, float],
        baselines: dict,
        log_signals: dict[str, int],
        metric_ts: datetime,
        per_instance_metrics: dict[str, dict[str, float]] | None = None,
    ) -> list[VerdictResult]:
        """
        Returns one VerdictResult per ES node.
        Falls back to single cluster-level verdict if per_instance_metrics not provided.
        """
        if not per_instance_metrics:
            return [self._analyze_node(
                instance_id=None,
                rejected=metrics["thread_pool.write.rejected"],
                queue=metrics["thread_pool.write.queue"],
                active=metrics.get("thread_pool.write.active"),
                baselines=baselines,
                log_signals=log_signals,
                metric_ts=metric_ts,
            )]

        results = []
        for node_id, node_metrics in per_instance_metrics.items():
            rejected = node_metrics.get("thread_pool.write.rejected")
            if rejected is None:
                continue
            results.append(self._analyze_node(
                instance_id=node_id,
                rejected=rejected,
                queue=node_metrics.get("thread_pool.write.queue", 0.0),
                active=node_metrics.get("thread_pool.write.active"),
                baselines=baselines,
                log_signals=log_signals,
                metric_ts=metric_ts,
            ))
        return results

    def _analyze_node(
        self,
        instance_id: str | None,
        rejected: float,
        queue: float,
        active: float | None,
        baselines: dict,
        log_signals: dict[str, int],
        metric_ts: datetime,
    ) -> VerdictResult:

        rejected_baseline = baselines.get("thread_pool.write.rejected")
        queue_baseline = baselines.get("thread_pool.write.queue")
        active_baseline = baselines.get("thread_pool.write.active")

        evidence: list[EvidenceItem] = []
        node_label = f" on {instance_id}" if instance_id else ""

        # ── Compute deviations ────────────────────────────────────────────────
        rejected_sigma = 0.0
        queue_sigma = 0.0
        rejected_vs_p95 = False
        queue_vs_p95 = False
        zero_baseline_rejection = False

        if rejected_baseline and rejected_baseline.std_dev > 0:
            rejected_sigma = (rejected - rejected_baseline.mean) / rejected_baseline.std_dev
            rejected_vs_p95 = rejected > rejected_baseline.p95
            evidence.append(EvidenceItem(
                text=f"thread_pool.write.rejected={rejected:.0f} vs p50={rejected_baseline.p50:.0f} p95={rejected_baseline.p95:.0f} (sigma={rejected_sigma:+.1f}){node_label}",
                source_type="metric",
                confidence_delta=0,
            ))
        elif rejected_baseline and rejected_baseline.std_dev == 0:
            zero_baseline_rejection = rejected > 0
            if rejected > 0:
                rejected_sigma = settings.critical_sigma_threshold + 1
                rejected_vs_p95 = True
            evidence.append(EvidenceItem(
                text=f"thread_pool.write.rejected={rejected:.0f} (baseline always 0 — any rejection is unprecedented){node_label}",
                source_type="metric",
                confidence_delta=0,
            ))
        else:
            evidence.append(EvidenceItem(
                text=f"thread_pool.write.rejected={rejected:.0f} (no baseline yet){node_label}",
                source_type="metric",
                confidence_delta=0,
            ))

        if queue_baseline and queue_baseline.std_dev > 0:
            queue_sigma = (queue - queue_baseline.mean) / queue_baseline.std_dev
            queue_vs_p95 = queue > queue_baseline.p95
            evidence.append(EvidenceItem(
                text=f"thread_pool.write.queue={queue:.0f} vs p50={queue_baseline.p50:.0f} p95={queue_baseline.p95:.0f} (sigma={queue_sigma:+.1f}){node_label}",
                source_type="metric",
                confidence_delta=0,
            ))
        elif queue_baseline and queue_baseline.std_dev == 0:
            if queue > 0:
                queue_sigma = settings.degraded_sigma_threshold + 1
                queue_vs_p95 = True
            evidence.append(EvidenceItem(
                text=f"thread_pool.write.queue={queue:.0f} (baseline always 0 — any queue depth is anomalous){node_label}",
                source_type="metric",
                confidence_delta=0,
            ))
        else:
            evidence.append(EvidenceItem(
                text=f"thread_pool.write.queue={queue:.0f} (no baseline yet){node_label}",
                source_type="metric",
                confidence_delta=0,
            ))

        if active is not None:
            if active_baseline and active_baseline.p95 > 0:
                active_vs_p95 = active > active_baseline.p95
                evidence.append(EvidenceItem(
                    text=f"thread_pool.write.active={active:.0f} vs p95={active_baseline.p95:.0f}{' (saturated)' if active_vs_p95 else ''}{node_label}",
                    source_type="metric",
                    confidence_delta=0,
                ))
            else:
                evidence.append(EvidenceItem(
                    text=f"thread_pool.write.active={active:.0f}{node_label}",
                    source_type="metric",
                    confidence_delta=0,
                ))

        # ── Status ────────────────────────────────────────────────────────────
        # Absolute fallback when no baseline exists.
        # Any write rejections are critical regardless of baseline — requests are being dropped.
        # Queue depth ≥ 50 is degraded — pool is backed up.
        no_rejected_baseline = rejected_baseline is None
        abs_critical_rejection = no_rejected_baseline and rejected > 0
        abs_degraded_queue = rejected_baseline is None and queue >= 50

        is_critical = (
            zero_baseline_rejection
            or rejected_sigma > settings.critical_sigma_threshold
            or abs_critical_rejection
        )
        is_degraded = (
            rejected_vs_p95
            or queue_vs_p95
            or rejected_sigma > settings.degraded_sigma_threshold
            or queue_sigma > settings.degraded_sigma_threshold
            or abs_degraded_queue
        )

        if is_critical:
            status = HealthStatus.critical
        elif is_degraded:
            status = HealthStatus.degraded
        else:
            status = HealthStatus.healthy

        # ── Confidence ────────────────────────────────────────────────────────
        has_rejected_baseline = rejected_baseline is not None
        both_anomalous = (
            rejected_sigma > settings.degraded_sigma_threshold
            and queue_sigma > settings.degraded_sigma_threshold
        )
        if not has_rejected_baseline:
            confidence_level = 0
        elif status == HealthStatus.healthy:
            confidence_level = 2
        elif both_anomalous or zero_baseline_rejection:
            confidence_level = 1
        else:
            confidence_level = 0

        # ── Log signals ───────────────────────────────────────────────────────
        bulk_rejection_count = log_signals.get("bulk_rejection", 0)
        indexing_pressure_count = log_signals.get("indexing_pressure_high", 0)
        circuit_breaker_count = log_signals.get("es_circuit_breaker_open", 0)

        if bulk_rejection_count > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"bulk_rejection: {bulk_rejection_count} events — clients receiving 429 errors",
                source_type="log_signal",
                confidence_delta=1,
            ))
        if indexing_pressure_count > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"indexing_pressure_high: {indexing_pressure_count} events",
                source_type="log_signal",
                confidence_delta=1,
            ))
        if circuit_breaker_count > 0:
            evidence.append(EvidenceItem(
                text=f"es_circuit_breaker_open: {circuit_breaker_count} events",
                source_type="log_signal",
                confidence_delta=0,
            ))

        confidence_map = {0: ConfidenceLevel.low, 1: ConfidenceLevel.medium, 2: ConfidenceLevel.high}
        confidence = confidence_map[confidence_level]

        # ── Human-readable fields ─────────────────────────────────────────────
        if status == HealthStatus.healthy:
            observed = (
                f"Write thread pool healthy: {rejected:.0f} rejected, {queue:.0f} queued"
                + (f", {active:.0f} active" if active is not None else "")
                + node_label
            )
            root_cause = f"No thread pool saturation detected{node_label}"
            recommendation = "No action required"
        else:
            observed = (
                f"Write thread pool under pressure: {rejected:.0f} rejected, {queue:.0f} queued"
                + (f", {active:.0f} active" if active is not None else "")
                + node_label
            )
            if zero_baseline_rejection:
                root_cause = (
                    f"Write rejections appeared for the first time{node_label}. "
                    "The write thread pool queue is full — bulk requests are being dropped. "
                    "Likely cause: sudden indexing surge or slow shard writes due to I/O pressure."
                )
            elif bulk_rejection_count > 0:
                root_cause = (
                    f"Write thread pool saturated with {rejected:.0f} rejected tasks{node_label}. "
                    "Bulk indexing requests are being dropped — clients receive 429 errors."
                )
            else:
                root_cause = (
                    f"Write thread pool queue ({queue:.0f}) and rejection count ({rejected:.0f}) "
                    f"above baseline{node_label}. "
                    "Common causes: high bulk indexing rate, slow shard flush, or merge pressure."
                )
            recommendation = (
                "Immediate: check indexing throughput and reduce bulk request rate or batch size. "
                "Check I/O wait on data nodes — slow disks block thread pool drainage. "
                "Short-term: review thread_pool.write.size setting "
                "(default = CPU count, max recommended = 2× CPU)."
            )

        if rejected_baseline:
            baseline_summary = (
                f"Write rejections normally {rejected_baseline.p50:.0f}–{rejected_baseline.p95:.0f}, "
                f"queue {queue_baseline.p50:.0f}–{queue_baseline.p95:.0f} (p50–p95)"
                if queue_baseline else
                f"Write rejections normally {rejected_baseline.p50:.0f}–{rejected_baseline.p95:.0f} (p50–p95)"
            )
        else:
            baseline_summary = "No baseline established yet — requires 100+ samples"

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
            instance_id=instance_id,
        )
