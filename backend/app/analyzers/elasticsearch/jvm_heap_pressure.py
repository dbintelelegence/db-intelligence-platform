"""
Analyzer: JVM Heap Pressure (Elasticsearch) — per-node

Failure mode: JVM heap exhaustion driven by GC pressure.

JVM heap is per-node — each ES node has its own JVM. This analyzer writes one
verdict per node so the dashboard can pinpoint exactly which node is under pressure.

What it watches (per node via get_latest_metrics_per_instance):
  Metrics (required):
    - jvm.heap.used.percent       — heap utilization % for this node
    - gc.old.collection.seconds   — time spent in old-gen GC
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

Returns list[VerdictResult] — one entry per ES node.
"""

from datetime import datetime
from app.analyzers.base import BaseAnalyzer, VerdictResult, EvidenceItem
from app.models.models import HealthStatus, ConfidenceLevel
from app.core.config import get_settings

settings = get_settings()

# Metrics fetched per-node via get_latest_metrics_per_instance
PER_INSTANCE_METRICS = [
    "jvm.heap.used.percent",
    "gc.old.collection.seconds",
    "gc.old.collection.count",
]


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
        per_instance_metrics: dict[str, dict[str, float]] | None = None,
    ) -> list[VerdictResult]:
        """
        Returns one VerdictResult per ES node.
        per_instance_metrics: {node_name: {canonical_name: value}}
        Falls back to single cluster-level verdict if not provided.
        """
        if not per_instance_metrics:
            return [self._analyze_node(
                instance_id=None,
                heap_pct=metrics["jvm.heap.used.percent"],
                gc_seconds=metrics["gc.old.collection.seconds"],
                gc_count=metrics["gc.old.collection.count"],
                baselines=baselines,
                log_signals=log_signals,
                metric_ts=metric_ts,
            )]

        results = []
        for node_id, node_metrics in per_instance_metrics.items():
            heap_pct = node_metrics.get("jvm.heap.used.percent")
            if heap_pct is None:
                continue
            results.append(self._analyze_node(
                instance_id=node_id,
                heap_pct=heap_pct,
                gc_seconds=node_metrics.get("gc.old.collection.seconds", 0.0),
                gc_count=node_metrics.get("gc.old.collection.count", 0.0),
                baselines=baselines,
                log_signals=log_signals,
                metric_ts=metric_ts,
            ))
        return results

    def _analyze_node(
        self,
        instance_id: str | None,
        heap_pct: float,
        gc_seconds: float,
        gc_count: float,
        baselines: dict,
        log_signals: dict[str, int],
        metric_ts: datetime,
    ) -> VerdictResult:

        heap_baseline = baselines.get("jvm.heap.used.percent")
        gc_seconds_baseline = baselines.get("gc.old.collection.seconds")
        gc_count_baseline = baselines.get("gc.old.collection.count")

        evidence: list[EvidenceItem] = []
        node_label = f" on {instance_id}" if instance_id else ""

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
            pct_above = ((heap_pct - heap_baseline.p50) / heap_baseline.p50) * 100 if heap_baseline.p50 > 0 else 0
            evidence.append(EvidenceItem(
                text=f"jvm.heap.used.percent={heap_pct:.1f}% vs p50={heap_baseline.p50:.1f}% p95={heap_baseline.p95:.1f}% ({pct_above:+.0f}% above median){node_label}",
                source_type="metric",
                confidence_delta=0,
            ))
        else:
            evidence.append(EvidenceItem(
                text=f"jvm.heap.used.percent={heap_pct:.1f}% (no baseline yet){node_label}",
                source_type="metric",
                confidence_delta=0,
            ))

        if gc_seconds_baseline and gc_seconds_baseline.std_dev > 0:
            gc_seconds_sigma = (gc_seconds - gc_seconds_baseline.mean) / gc_seconds_baseline.std_dev
            gc_ratio = gc_seconds / gc_seconds_baseline.p50 if gc_seconds_baseline.p50 > 0 else 1.0
            gc_frequency_critical = gc_ratio > 3.0
            gc_frequency_elevated = gc_ratio > 1.5
            evidence.append(EvidenceItem(
                text=f"gc.old.collection.seconds={gc_seconds:.2f}s vs p50={gc_seconds_baseline.p50:.2f}s ({gc_ratio:.1f}x baseline){node_label}",
                source_type="metric",
                confidence_delta=0,
            ))
        else:
            evidence.append(EvidenceItem(
                text=f"gc.old.collection.seconds={gc_seconds:.2f}s (no baseline yet){node_label}",
                source_type="metric",
                confidence_delta=0,
            ))

        # ── Status ────────────────────────────────────────────────────────────
        # Absolute fallback thresholds used when no baseline exists.
        # Heap ≥ 85% is always critical regardless of baseline — GC cannot keep up.
        # Heap ≥ 70% is always degraded — approaching danger zone.
        no_baseline = heap_baseline is None or heap_baseline.std_dev == 0
        heap_abs_critical = heap_pct >= 85.0
        heap_abs_degraded = heap_pct >= 70.0

        is_critical = (
            (heap_vs_p95 and gc_frequency_critical)
            or heap_sigma > settings.critical_sigma_threshold
            or (no_baseline and heap_abs_critical)
        )
        is_degraded = (
            heap_vs_p75
            or gc_frequency_elevated
            or heap_sigma > settings.degraded_sigma_threshold
            or gc_seconds_sigma > settings.degraded_sigma_threshold
            or (no_baseline and heap_abs_degraded)
        )

        if is_critical:
            status = HealthStatus.critical
        elif is_degraded:
            status = HealthStatus.degraded
        else:
            status = HealthStatus.healthy

        # ── Confidence ────────────────────────────────────────────────────────
        has_baselines = heap_baseline is not None and gc_seconds_baseline is not None
        both_anomalous = (
            heap_sigma > settings.degraded_sigma_threshold
            and gc_seconds_sigma > settings.degraded_sigma_threshold
        )
        if not has_baselines:
            confidence_level = 0
        elif status == HealthStatus.healthy:
            confidence_level = 2
        elif both_anomalous:
            confidence_level = 1
        else:
            confidence_level = 0

        # ── Log signals ───────────────────────────────────────────────────────
        fielddata_count = log_signals.get("fielddata_eviction", 0)
        gc_pause_count = log_signals.get("gc_pause", 0)
        circuit_breaker_count = log_signals.get("circuit_breaker_trip", 0)

        if fielddata_count > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"fielddata_eviction: {fielddata_count} events — confirms fielddata cache growth",
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

        # ── Human-readable fields ─────────────────────────────────────────────
        if status == HealthStatus.healthy:
            observed = f"Heap at {heap_pct:.1f}%, GC frequency within normal bounds{node_label}"
            root_cause = f"No heap pressure detected{node_label}"
            recommendation = "No action required"
        else:
            gc_desc = f"every {60 / gc_count:.0f}s" if gc_count > 0 else "elevated"
            observed = f"Heap at {heap_pct:.1f}%, GC old-gen running {gc_desc}{node_label}"
            root_cause = (
                f"Fielddata cache growth or large aggregation queries consuming heap{node_label}. "
                "GC cannot reclaim memory fast enough, causing cascading pressure."
                if fielddata_count > 0
                else f"Heap consumption exceeding GC reclaim rate{node_label}. "
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
            instance_id=instance_id,
        )
