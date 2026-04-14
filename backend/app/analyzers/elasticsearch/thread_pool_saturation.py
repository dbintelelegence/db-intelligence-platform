"""
Analyzer: Thread Pool Saturation (Elasticsearch)

Failure mode: Write thread pool exhausted, causing indexing rejections and
client-visible 429 errors.

What it watches:
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
  Rejected counter is cumulative — we check whether the current value exceeds
  baseline p95. Any increase vs baseline p50 = degraded. Any new rejections
  on a zero baseline = critical (the cluster has never had rejections before).

  Critical:
    - rejected > 0 AND baseline std_dev == 0 (never rejected before)
    - OR rejected sigma > critical_sigma_threshold

  Degraded:
    - rejected > baseline p95
    - OR queue > baseline p95
    - OR rejected sigma > degraded_sigma_threshold
    - OR queue sigma > degraded_sigma_threshold

  Healthy:
    - All metrics within baseline bounds

Confidence:
  Base: MEDIUM if both rejected and queue are anomalous
  Base: LOW if only one signal fires
  Healthy with baselines → HIGH
  +1 if bulk_rejection log signal present
  +1 if indexing_pressure_high corroborates
  Maximum: HIGH   Minimum: LOW
"""

from datetime import datetime

from app.analyzers.base import BaseAnalyzer, EvidenceItem, VerdictResult
from app.core.config import get_settings
from app.models.models import ConfidenceLevel, HealthStatus

settings = get_settings()


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
    ) -> VerdictResult:

        rejected = metrics["thread_pool.write.rejected"]
        queue = metrics["thread_pool.write.queue"]
        active = metrics.get("thread_pool.write.active")

        rejected_baseline = baselines.get("thread_pool.write.rejected")
        queue_baseline = baselines.get("thread_pool.write.queue")
        active_baseline = baselines.get("thread_pool.write.active")

        evidence: list[EvidenceItem] = []

        # ── Compute deviations ────────────────────────────────────────────────
        rejected_sigma = 0.0
        queue_sigma = 0.0
        rejected_vs_p95 = False
        queue_vs_p95 = False
        zero_baseline_rejection = False   # any rejection on a never-rejected cluster

        # Rejected
        if rejected_baseline and rejected_baseline.std_dev > 0:
            rejected_sigma = (rejected - rejected_baseline.mean) / rejected_baseline.std_dev
            rejected_vs_p95 = rejected > rejected_baseline.p95
            evidence.append(EvidenceItem(
                text=(
                    f"thread_pool.write.rejected={rejected:.0f} "
                    f"vs baseline p50={rejected_baseline.p50:.0f} "
                    f"p95={rejected_baseline.p95:.0f} "
                    f"(sigma={rejected_sigma:+.1f})"
                ),
                source_type="metric",
                confidence_delta=0,
            ))
        elif rejected_baseline and rejected_baseline.std_dev == 0:
            # Baseline is all-zeros — any rejection is unprecedented
            zero_baseline_rejection = rejected > 0
            if rejected > 0:
                rejected_sigma = settings.critical_sigma_threshold + 1
                rejected_vs_p95 = True
            evidence.append(EvidenceItem(
                text=(
                    f"thread_pool.write.rejected={rejected:.0f} "
                    f"(baseline always 0 — any rejection is unprecedented)"
                ),
                source_type="metric",
                confidence_delta=0,
            ))
        else:
            evidence.append(EvidenceItem(
                text=f"thread_pool.write.rejected={rejected:.0f} (no baseline yet)",
                source_type="metric",
                confidence_delta=0,
            ))

        # Queue
        if queue_baseline and queue_baseline.std_dev > 0:
            queue_sigma = (queue - queue_baseline.mean) / queue_baseline.std_dev
            queue_vs_p95 = queue > queue_baseline.p95
            evidence.append(EvidenceItem(
                text=(
                    f"thread_pool.write.queue={queue:.0f} "
                    f"vs baseline p50={queue_baseline.p50:.0f} "
                    f"p95={queue_baseline.p95:.0f} "
                    f"(sigma={queue_sigma:+.1f})"
                ),
                source_type="metric",
                confidence_delta=0,
            ))
        elif queue_baseline and queue_baseline.std_dev == 0:
            if queue > 0:
                queue_sigma = settings.degraded_sigma_threshold + 1
                queue_vs_p95 = True
            evidence.append(EvidenceItem(
                text=(
                    f"thread_pool.write.queue={queue:.0f} "
                    f"(baseline always 0 — any queue depth is anomalous)"
                ),
                source_type="metric",
                confidence_delta=0,
            ))
        else:
            evidence.append(EvidenceItem(
                text=f"thread_pool.write.queue={queue:.0f} (no baseline yet)",
                source_type="metric",
                confidence_delta=0,
            ))

        # Active threads (corroborating)
        if active is not None:
            if active_baseline and active_baseline.p95 > 0:
                active_vs_p95 = active > active_baseline.p95
                evidence.append(EvidenceItem(
                    text=(
                        f"thread_pool.write.active={active:.0f} "
                        f"vs baseline p95={active_baseline.p95:.0f}"
                        + (" (above p95 — thread pool saturated)" if active_vs_p95 else "")
                    ),
                    source_type="metric",
                    confidence_delta=0,
                ))
            else:
                evidence.append(EvidenceItem(
                    text=f"thread_pool.write.active={active:.0f}",
                    source_type="metric",
                    confidence_delta=0,
                ))

        # ── Determine status ──────────────────────────────────────────────────
        is_critical = (
            zero_baseline_rejection  # new rejections on cluster that never had them
            or rejected_sigma > settings.critical_sigma_threshold
        )

        is_degraded = (
            rejected_vs_p95
            or queue_vs_p95
            or rejected_sigma > settings.degraded_sigma_threshold
            or queue_sigma > settings.degraded_sigma_threshold
        )

        if is_critical:
            status = HealthStatus.critical
        elif is_degraded:
            status = HealthStatus.degraded
        else:
            status = HealthStatus.healthy

        # ── Base confidence ───────────────────────────────────────────────────
        has_rejected_baseline = rejected_baseline is not None
        has_queue_baseline = queue_baseline is not None

        both_anomalous = (
            rejected_sigma > settings.degraded_sigma_threshold
            and queue_sigma > settings.degraded_sigma_threshold
        )

        if not has_rejected_baseline:
            confidence_level = 0  # LOW
        elif status == HealthStatus.healthy:
            confidence_level = 2  # HIGH
        elif both_anomalous or zero_baseline_rejection:
            confidence_level = 1  # MEDIUM — two signals agree, or clear novel event
        else:
            confidence_level = 0  # LOW — only one signal firing

        # ── Log signal corroboration ──────────────────────────────────────────
        bulk_rejection_count = log_signals.get("bulk_rejection", 0)
        indexing_pressure_count = log_signals.get("indexing_pressure_high", 0)
        circuit_breaker_count = log_signals.get("es_circuit_breaker_open", 0)

        if bulk_rejection_count > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"bulk_rejection: {bulk_rejection_count} events — confirms clients receiving 429 errors",
                source_type="log_signal",
                confidence_delta=1,
            ))

        if indexing_pressure_count > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"indexing_pressure_high: {indexing_pressure_count} events — memory pressure driving rejection",
                source_type="log_signal",
                confidence_delta=1,
            ))

        if circuit_breaker_count > 0:
            evidence.append(EvidenceItem(
                text=f"es_circuit_breaker_open: {circuit_breaker_count} events — circuit breaker tripped under write load",
                source_type="log_signal",
                confidence_delta=0,
            ))

        confidence_map = {0: ConfidenceLevel.low, 1: ConfidenceLevel.medium, 2: ConfidenceLevel.high}
        confidence = confidence_map[confidence_level]

        # ── Human-readable fields ─────────────────────────────────────────────
        if status == HealthStatus.healthy:
            observed = (
                f"Write thread pool healthy: "
                f"{rejected:.0f} rejected, {queue:.0f} queued"
                + (f", {active:.0f} active" if active is not None else "")
            )
            root_cause = "No thread pool saturation detected"
            recommendation = "No action required"
        else:
            observed = (
                f"Write thread pool under pressure: "
                f"{rejected:.0f} rejected tasks, {queue:.0f} in queue"
                + (f", {active:.0f} active threads" if active is not None else "")
            )

            if zero_baseline_rejection:
                root_cause = (
                    "Write rejections have appeared for the first time on this cluster. "
                    "The write thread pool queue is full and Elasticsearch is dropping "
                    "incoming bulk requests. Likely cause: sudden indexing surge, "
                    "slow shard writes due to I/O pressure, or under-provisioned thread pool size."
                )
            elif bulk_rejection_count > 0:
                root_cause = (
                    f"Write thread pool saturated with {rejected:.0f} rejected tasks. "
                    "Bulk indexing requests are being dropped — clients will receive 429 errors. "
                    "The queue filled before threads could drain it, indicating sustained "
                    "write throughput exceeding thread pool capacity."
                )
            else:
                root_cause = (
                    f"Write thread pool queue depth ({queue:.0f}) and rejection count ({rejected:.0f}) "
                    "are above baseline. The thread pool is approaching saturation. "
                    "Common causes: high bulk indexing rate, slow shard flush due to I/O, "
                    "or merge pressure holding threads."
                )

            recommendation = (
                "Immediate: check indexing throughput and reduce bulk request rate or batch size. "
                "Check I/O wait on data nodes — slow disks block thread pool drainage. "
                "Short-term: review thread_pool.write.size setting "
                "(default = CPU count, max recommended = 2× CPU). "
                "Review merge policy if merges are competing with indexing threads."
            )

        if rejected_baseline:
            baseline_summary = (
                f"Write rejections normally {rejected_baseline.p50:.0f}–{rejected_baseline.p95:.0f}, "
                f"queue {queue_baseline.p50:.0f}–{queue_baseline.p95:.0f} "
                f"(p50–p95 over baseline window)"
                if queue_baseline else
                f"Write rejections normally {rejected_baseline.p50:.0f}–{rejected_baseline.p95:.0f} "
                f"(p50–p95 over baseline window)"
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
        )
