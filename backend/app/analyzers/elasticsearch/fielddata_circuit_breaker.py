"""
Analyzer: Fielddata / Circuit Breaker Pressure (Elasticsearch)

Failure mode: Fielddata cache consuming excessive heap, triggering the circuit
breaker and causing search requests to fail with 429 errors.

Background:
  Fielddata is loaded into JVM heap when aggregations or sorting on text fields
  are performed. Once loaded it stays in heap — it is NOT evicted like the page
  cache. Heavy aggregation workloads grow fielddata until the circuit breaker
  trips and ES starts rejecting search requests.

  The circuit breaker prevents OOM but the user experience is:
    - Search queries return 429 / CircuitBreakerException
    - Aggregations fail silently or with errors
    - JVM heap climbs even without new indexing

What it watches:
  Metrics (required):
    - fielddata.evictions        — eviction events indicate cache pressure (counter)
    - fielddata.memory.bytes     — current cache size in bytes

  Metrics (corroborating):
    - circuit_breaker.tripped    — direct confirmation breaker fired
    - jvm.heap.used.bytes        — heap used (context for how much fielddata is consuming)
    - jvm.heap.max.bytes         — heap max (needed to compute fielddata as % of heap)

  Log signals (optional):
    - fielddata_eviction          — log events confirming eviction pressure
    - circuit_breaker_trip        — log events confirming breaker fired
    - gc_pause                    — GC pressure often accompanies fielddata growth

Verdict logic:
  Critical:
    - circuit_breaker.tripped > 0 (breaker has fired — searches are failing NOW)
    - OR fielddata.evictions sigma > critical_threshold AND fielddata memory high
    - OR fielddata memory > 40% of JVM heap

  Degraded:
    - fielddata.evictions sigma > degraded_threshold
    - OR fielddata memory > 20% of JVM heap
    - OR evictions > baseline p95

  Healthy:
    - evictions within baseline, fielddata memory low

Confidence:
  No baseline: LOW
  Evictions anomalous alone: MEDIUM
  circuit_breaker.tripped > 0: HIGH immediately (direct evidence)
  +1 if fielddata_eviction or circuit_breaker_trip log present
"""

from datetime import datetime

from app.analyzers.base import BaseAnalyzer, EvidenceItem, VerdictResult
from app.core.config import get_settings
from app.models.models import ConfidenceLevel, HealthStatus

settings = get_settings()

# Fielddata as a fraction of JVM heap — above these thresholds is a problem
DEGRADED_HEAP_FRACTION  = 0.20   # 20% of heap consumed by fielddata
CRITICAL_HEAP_FRACTION  = 0.40   # 40% of heap consumed by fielddata


class FielddataCircuitBreakerAnalyzer(BaseAnalyzer):

    ANALYZER_NAME = "fielddata_circuit_breaker"

    REQUIRED_METRICS = [
        "fielddata.evictions",
        "fielddata.memory.bytes",
    ]

    CORROBORATING_METRICS = [
        "circuit_breaker.tripped",
        "jvm.heap.used.bytes",
        "jvm.heap.max.bytes",
    ]

    OPTIONAL_LOG_SIGNALS = [
        "fielddata_eviction",
        "circuit_breaker_trip",
        "gc_pause",
    ]

    def analyze(
        self,
        metrics: dict[str, float],
        baselines: dict,
        log_signals: dict[str, int],
        metric_ts: datetime,
    ) -> VerdictResult:

        evictions       = metrics["fielddata.evictions"]
        fielddata_bytes = metrics["fielddata.memory.bytes"]
        cb_tripped      = metrics.get("circuit_breaker.tripped", 0.0)
        heap_used       = metrics.get("jvm.heap.used.bytes")
        heap_max        = metrics.get("jvm.heap.max.bytes")

        eviction_baseline  = baselines.get("fielddata.evictions")
        fielddata_baseline = baselines.get("fielddata.memory.bytes")

        evidence: list[EvidenceItem] = []

        # ── Compute fielddata as % of heap ────────────────────────────────────
        fielddata_heap_pct = None
        if heap_max and heap_max > 0:
            fielddata_heap_pct = (fielddata_bytes / heap_max) * 100.0

        fielddata_mb = fielddata_bytes / (1024 ** 2)

        # ── Primary evidence ──────────────────────────────────────────────────
        if fielddata_heap_pct is not None:
            evidence.append(EvidenceItem(
                text=(
                    f"fielddata.memory.bytes={fielddata_mb:.1f} MB "
                    f"({fielddata_heap_pct:.1f}% of JVM heap max)"
                ),
                source_type="metric",
                confidence_delta=0,
            ))
        else:
            evidence.append(EvidenceItem(
                text=f"fielddata.memory.bytes={fielddata_mb:.1f} MB",
                source_type="metric",
                confidence_delta=0,
            ))

        # ── Circuit breaker — direct failure signal ───────────────────────────
        breaker_fired = cb_tripped > 0
        if breaker_fired:
            evidence.append(EvidenceItem(
                text=(
                    f"circuit_breaker.tripped={cb_tripped:.0f} — "
                    "circuit breaker has fired; search requests are being rejected"
                ),
                source_type="metric",
                confidence_delta=1,
            ))

        # ── Eviction sigma scoring ────────────────────────────────────────────
        eviction_sigma = 0.0
        has_eviction_baseline = eviction_baseline is not None

        if has_eviction_baseline and eviction_baseline.std_dev > 0:
            eviction_sigma = (evictions - eviction_baseline.mean) / eviction_baseline.std_dev
            evidence.append(EvidenceItem(
                text=(
                    f"fielddata.evictions={evictions:.0f} "
                    f"vs baseline p50={eviction_baseline.p50:.0f} "
                    f"p95={eviction_baseline.p95:.0f} "
                    f"(sigma={eviction_sigma:+.1f})"
                ),
                source_type="metric",
                confidence_delta=0,
            ))
        elif has_eviction_baseline and eviction_baseline.std_dev == 0:
            # Baseline is always 0 — any eviction is an anomaly
            if evictions > 0:
                eviction_sigma = settings.critical_sigma_threshold + 1
            evidence.append(EvidenceItem(
                text=(
                    f"fielddata.evictions={evictions:.0f} "
                    "(baseline is always 0 — any eviction indicates cache pressure)"
                ),
                source_type="metric",
                confidence_delta=0,
            ))
        else:
            evidence.append(EvidenceItem(
                text=f"fielddata.evictions={evictions:.0f} (no baseline yet)",
                source_type="metric",
                confidence_delta=0,
            ))

        # Fielddata memory baseline
        if fielddata_baseline and fielddata_baseline.std_dev > 0:
            fd_sigma = (fielddata_bytes - fielddata_baseline.mean) / fielddata_baseline.std_dev
            evidence.append(EvidenceItem(
                text=(
                    f"fielddata vs baseline: "
                    f"p50={fielddata_baseline.p50 / (1024**2):.1f} MB "
                    f"p95={fielddata_baseline.p95 / (1024**2):.1f} MB "
                    f"(sigma={fd_sigma:+.1f})"
                ),
                source_type="metric",
                confidence_delta=0,
            ))

        # ── Status determination ──────────────────────────────────────────────
        heap_critical = fielddata_heap_pct is not None and fielddata_heap_pct >= CRITICAL_HEAP_FRACTION * 100
        heap_degraded = fielddata_heap_pct is not None and fielddata_heap_pct >= DEGRADED_HEAP_FRACTION * 100

        is_critical = (
            breaker_fired
            or eviction_sigma > settings.critical_sigma_threshold
            or heap_critical
        )
        is_degraded = (
            eviction_sigma > settings.degraded_sigma_threshold
            or heap_degraded
            or (has_eviction_baseline and evictions > eviction_baseline.p95)
        )

        if is_critical:
            status = HealthStatus.critical
        elif is_degraded:
            status = HealthStatus.degraded
        else:
            status = HealthStatus.healthy

        # ── Confidence ────────────────────────────────────────────────────────
        if breaker_fired:
            confidence_level = 2  # HIGH — direct evidence breaker fired
        elif not has_eviction_baseline:
            confidence_level = 0  # LOW
        elif status == HealthStatus.healthy:
            confidence_level = 2  # HIGH — clean
        else:
            confidence_level = 1  # MEDIUM

        # Log signals
        fd_eviction_logs = log_signals.get("fielddata_eviction", 0)
        cb_trip_logs     = log_signals.get("circuit_breaker_trip", 0)
        gc_pause_logs    = log_signals.get("gc_pause", 0)

        if fd_eviction_logs > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"fielddata_eviction: {fd_eviction_logs} log events — confirmed cache pressure",
                source_type="log_signal",
                confidence_delta=1,
            ))
        if cb_trip_logs > 0:
            confidence_level = min(confidence_level + 1, 2)
            evidence.append(EvidenceItem(
                text=f"circuit_breaker_trip: {cb_trip_logs} log events — confirmed breaker activation",
                source_type="log_signal",
                confidence_delta=1,
            ))
        if gc_pause_logs > 0:
            evidence.append(EvidenceItem(
                text=f"gc_pause: {gc_pause_logs} log events — GC pressure corroborates fielddata growth",
                source_type="log_signal",
                confidence_delta=0,
            ))

        confidence_map = {0: ConfidenceLevel.low, 1: ConfidenceLevel.medium, 2: ConfidenceLevel.high}
        confidence = confidence_map[confidence_level]

        # ── Baseline summary ──────────────────────────────────────────────────
        if has_eviction_baseline:
            baseline_summary = (
                f"Normal evictions: {eviction_baseline.p50:.0f}–{eviction_baseline.p95:.0f} "
                f"(p50–p95). Current: {evictions:.0f}."
            )
        else:
            baseline_summary = "No baseline yet — requires 100+ samples"

        # ── Human-readable fields ─────────────────────────────────────────────
        heap_pct_str = f" ({fielddata_heap_pct:.1f}% of heap)" if fielddata_heap_pct is not None else ""

        if status == HealthStatus.healthy:
            observed = (
                f"Fielddata cache {fielddata_mb:.1f} MB{heap_pct_str}. "
                f"Evictions {evictions:.0f} — within normal range. "
                "No circuit breaker activity."
            )
            root_cause = "No fielddata or circuit breaker pressure detected"
            recommendation = "No action required"

        elif status == HealthStatus.degraded:
            observed = (
                f"Fielddata cache growing: {fielddata_mb:.1f} MB{heap_pct_str}. "
                f"Evictions elevated at {evictions:.0f}."
            )
            root_cause = (
                f"Fielddata cache is consuming {fielddata_mb:.1f} MB{heap_pct_str} of JVM heap. "
                "Elevated evictions indicate aggregation or sorting on high-cardinality text fields. "
                "If this grows further the circuit breaker will fire and reject search requests."
            )
            recommendation = (
                "Identify which indices drive fielddata growth: "
                "GET /_nodes/stats/indices/fielddata?fields=*&human. "
                "Consider: mapping text fields as keyword instead of text for aggregations, "
                "enabling eager_global_ordinals for frequently aggregated fields, "
                "or limiting fielddata cache size via indices.fielddata.cache.size."
            )

        else:  # critical
            if breaker_fired:
                observed = (
                    f"CIRCUIT BREAKER TRIPPED: {cb_tripped:.0f} trips detected. "
                    f"Fielddata {fielddata_mb:.1f} MB{heap_pct_str}. "
                    "Search requests are being rejected with 429 errors."
                )
                root_cause = (
                    f"The Elasticsearch fielddata circuit breaker has fired {cb_tripped:.0f} time(s). "
                    f"Fielddata cache ({fielddata_mb:.1f} MB{heap_pct_str}) exceeded the breaker limit. "
                    "All search requests that require fielddata (aggregations, sorting on text fields) "
                    "are returning CircuitBreakerException. Customers are experiencing search failures."
                )
            else:
                observed = (
                    f"Fielddata cache critically high: {fielddata_mb:.1f} MB{heap_pct_str}. "
                    f"Evictions: {evictions:.0f} — circuit breaker trip imminent."
                )
                root_cause = (
                    f"Fielddata cache has grown to {fielddata_mb:.1f} MB{heap_pct_str}. "
                    f"With {evictions:.0f} evictions, the cache is under severe pressure. "
                    "The circuit breaker is at risk of tripping, which would reject all aggregation queries."
                )
            recommendation = (
                "Immediate: clear fielddata cache: POST /_cache/clear?fielddata=true. "
                "Identify the query pattern driving the growth: check slow logs and hot threads. "
                "If breaker has tripped, lower field load or increase heap (but clearing cache is faster). "
                "Long-term: avoid aggregations on text fields — use keyword mappings. "
                "Set indices.fielddata.cache.size=20% in elasticsearch.yml to cap future growth."
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
