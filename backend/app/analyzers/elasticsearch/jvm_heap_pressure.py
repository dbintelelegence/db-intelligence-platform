"""
Analyzer: JVM Heap Pressure (Elasticsearch)

Failure mode: JVM heap exhaustion driven by GC pressure.

What it watches:
  Metrics (required):
    - jvm.heap.used.percent       — heap utilization percentage
    - gc.old.collection.seconds   — time spent in old-gen GC per interval
    - gc.old.collection.count     — number of old-gen GC events

  Log signals (optional, boost confidence):
    - fielddata_eviction          — confirms fielddata cache is the driver
    - gc_pause                    — corroborates GC pressure from logs
    - circuit_breaker_trip        — secondary effect, confirms severity

Verdict logic:
  Status is determined by the WORST of heap deviation and GC deviation.

  Critical:
    - heap > p95 baseline AND gc frequency > 3x baseline frequency
    - OR heap sigma score > critical_sigma_threshold (3.5 by default)

  Degraded:
    - heap > p75 baseline OR gc frequency > 1.5x baseline
    - OR heap sigma score > degraded_sigma_threshold (2.0 by default)

  Healthy:
    - All metrics within baseline bounds

Confidence:
  Base: LOW if only one metric is anomalous
  Base: MEDIUM if both heap and GC are anomalous
  +1 level if fielddata_eviction log signal present
  +1 level if gc_pause log signal corroborates
  Maximum: HIGH
  Minimum: LOW
"""

from datetime import datetime
from app.analyzers.base import BaseAnalyzer, VerdictResult, EvidenceItem
from app.models.models import HealthStatus, ConfidenceLevel
from app.core.config import get_settings

settings = get_settings()


class JvmHeapPressureAnalyzer(BaseAnalyzer):

    ANALYZER_NAME = "jvm_heap_pressure"

    REQUIRED_METRICS = [
        "jvm.heap.used.percent",
        "gc.old.collection.seconds",
        "gc.old.collection.count",
    ]

    OPTIONAL_LOG_SIGNALS = [
        "fielddata_eviction",
        "gc_pause",
        "circuit_breaker_trip",
    ]

    def analyze(
        self,
        metrics: dict[str, float],
        baselines: dict,
        log_signals: dict[str, int],
        metric_ts: datetime,
    ) -> VerdictResult:

        heap_pct = metrics["jvm.heap.used.percent"]
        gc_seconds = metrics["gc.old.collection.seconds"]
        gc_count = metrics["gc.old.collection.count"]

        # ── Retrieve baselines ────────────────────────────────────────────────
        heap_baseline = baselines.get("jvm.heap.used.percent")
        gc_seconds_baseline = baselines.get("gc.old.collection.seconds")
        gc_count_baseline = baselines.get("gc.old.collection.count")

        evidence: list[EvidenceItem] = []

        # ── Compute deviations ────────────────────────────────────────────────
        heap_sigma = 0.0
        gc_seconds_sigma = 0.0
        heap_vs_p95 = False
        heap_vs_p75 = False
        gc_frequency_critical = False
        gc_frequency_elevated = False

        if heap_baseline and heap_baseline.std_dev > 0:
            heap_sigma = (heap_pct - heap_baseline.mean) / heap_baseline.std_dev
            heap_vs_p95 = heap_pct > heap_baseline.p95
            heap_vs_p75 = heap_pct > heap_baseline.p75

            pct_above_baseline = ((heap_pct - heap_baseline.p50) / heap_baseline.p50) * 100 if heap_baseline.p50 > 0 else 0
            evidence.append(EvidenceItem(
                text=f"jvm.heap.used.percent at {heap_pct:.1f}% vs baseline p50={heap_baseline.p50:.1f}%, p95={heap_baseline.p95:.1f}% ({pct_above_baseline:+.0f}% above median)",
                source_type="metric",
                confidence_delta=0,
            ))
        else:
            # No baseline — report raw value only, confidence will be LOW
            evidence.append(EvidenceItem(
                text=f"jvm.heap.used.percent at {heap_pct:.1f}% (no baseline yet — cannot determine deviation)",
                source_type="metric",
                confidence_delta=0,
            ))

        if gc_seconds_baseline and gc_seconds_baseline.std_dev > 0:
            gc_seconds_sigma = (gc_seconds - gc_seconds_baseline.mean) / gc_seconds_baseline.std_dev
            gc_seconds_vs_baseline_ratio = gc_seconds / gc_seconds_baseline.p50 if gc_seconds_baseline.p50 > 0 else 1.0
            gc_frequency_critical = gc_seconds_vs_baseline_ratio > 3.0
            gc_frequency_elevated = gc_seconds_vs_baseline_ratio > 1.5

            evidence.append(EvidenceItem(
                text=f"gc.old.collection.seconds at {gc_seconds:.2f}s vs baseline p50={gc_seconds_baseline.p50:.2f}s ({gc_seconds_vs_baseline_ratio:.1f}x baseline frequency)",
                source_type="metric",
                confidence_delta=0,
            ))
        else:
            evidence.append(EvidenceItem(
                text=f"gc.old.collection.seconds at {gc_seconds:.2f}s (no baseline yet)",
                source_type="metric",
                confidence_delta=0,
            ))

        # ── Determine status ──────────────────────────────────────────────────
        # Critical conditions
        is_critical = (
            (heap_vs_p95 and gc_frequency_critical)
            or heap_sigma > settings.critical_sigma_threshold
        )
        # Degraded conditions
        is_degraded = (
            heap_vs_p75
            or gc_frequency_elevated
            or heap_sigma > settings.degraded_sigma_threshold
            or gc_seconds_sigma > settings.degraded_sigma_threshold
        )

        if is_critical:
            status = HealthStatus.critical
        elif is_degraded:
            status = HealthStatus.degraded
        else:
            status = HealthStatus.healthy

        # ── Base confidence from metric corroboration ─────────────────────────
        # No baseline at all → LOW regardless of status.
        # Both baselines present and both metrics anomalous → MEDIUM.
        # Both baselines present and healthy → HIGH.
        # Only one metric anomalous → LOW.
        has_baselines = heap_baseline is not None and gc_seconds_baseline is not None

        both_metrics_anomalous = (
            heap_sigma > settings.degraded_sigma_threshold
            and gc_seconds_sigma > settings.degraded_sigma_threshold
        )

        if not has_baselines:
            confidence_level = 0  # LOW — cannot determine deviation without baseline
        elif status == HealthStatus.healthy:
            confidence_level = 2  # HIGH — both baselines present, nothing anomalous
        elif both_metrics_anomalous:
            confidence_level = 1  # MEDIUM — two metrics agree something is wrong
        else:
            confidence_level = 0  # LOW — only one signal firing

        # ── Log signal corroboration ──────────────────────────────────────────
        fielddata_count = log_signals.get("fielddata_eviction", 0)
        gc_pause_count = log_signals.get("gc_pause", 0)
        circuit_breaker_count = log_signals.get("circuit_breaker_trip", 0)

        if fielddata_count > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"fielddata_eviction: {fielddata_count} events in window — confirms fielddata cache growth as driver",
                source_type="log_signal",
                confidence_delta=1,
            ))

        if gc_pause_count > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"gc_pause: {gc_pause_count} log events corroborate GC pressure",
                source_type="log_signal",
                confidence_delta=1,
            ))

        if circuit_breaker_count > 0:
            evidence.append(EvidenceItem(
                text=f"circuit_breaker_trip: {circuit_breaker_count} events — secondary effect of heap pressure",
                source_type="log_signal",
                confidence_delta=0,
            ))

        confidence_map = {0: ConfidenceLevel.low, 1: ConfidenceLevel.medium, 2: ConfidenceLevel.high}
        confidence = confidence_map[confidence_level]

        # ── Build human-readable fields ───────────────────────────────────────
        if status == HealthStatus.healthy:
            observed = (
                f"Heap at {heap_pct:.1f}% and GC frequency within normal bounds"
            )
            root_cause = "No heap pressure detected"
            recommendation = "No action required"
        else:
            gc_desc = f"every {60 / gc_count:.0f}s" if gc_count > 0 else "elevated"
            observed = (
                f"Heap at {heap_pct:.1f}%, GC old-gen running {gc_desc}"
            )
            root_cause = (
                "Fielddata cache growth or large aggregation queries consuming heap. "
                "GC cannot reclaim memory fast enough, causing cascading pressure."
                if fielddata_count > 0
                else "Heap consumption exceeding GC reclaim rate. "
                     "Likely cause: fielddata cache growth, large aggregations, or mapping explosion."
            )
            recommendation = (
                "Immediate: clear fielddata cache and reduce indices.fielddata.cache.size. "
                "Short-term: identify and throttle aggregation queries driving fielddata growth. "
                "Review index mappings for high-cardinality fields that should use keyword not text."
            )

        if heap_baseline:
            baseline_summary = (
                f"Heap normally {heap_baseline.p50:.1f}–{heap_baseline.p95:.1f}% "
                f"(p50–p95 over last 30 days)"
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
