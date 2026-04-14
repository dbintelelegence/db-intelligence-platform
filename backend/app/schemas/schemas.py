"""
Canonical schemas for ingestion validation.

These are the contracts between the customer's Prometheus remote_write
and our ingestion layer. All incoming data is validated against these
before touching the database.
"""
from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from typing import Literal


# ── Canonical metric schema ───────────────────────────────────────────────────

MetricCategory = Literal[
    "jvm", "shard", "io", "disk", "search", "indexing",
    "cpu", "memory", "network", "connections"
]

MetricUnit = Literal["percent", "ms", "bytes", "count", "tps", "seconds"]

DbType = Literal["elasticsearch", "mysql", "cassandra", "postgres"]


class CanonicalMetric(BaseModel):
    """
    Single metric data point after normalization.
    The ingestion adapter translates source metric names to canonical_name
    before this schema is used.
    """
    cluster_id: str = Field(..., description="Stable identifier for the cluster")
    db_type: DbType
    metric_category: MetricCategory
    # The raw name as sent by the customer (for registry)
    metric_name: str = Field(..., max_length=255)
    # The normalized name analyzers use
    canonical_name: str = Field(..., max_length=255)
    value: float
    unit: MetricUnit
    timestamp: datetime

    @field_validator("value")
    @classmethod
    def value_must_be_finite(cls, v: float) -> float:
        import math
        if math.isnan(v) or math.isinf(v):
            raise ValueError("metric value must be finite")
        return v


# ── Prometheus remote_write payload ──────────────────────────────────────────

class PrometheusLabel(BaseModel):
    name: str
    value: str


class PrometheusSample(BaseModel):
    value: float
    timestamp: int  # milliseconds since epoch


class PrometheusTimeSeries(BaseModel):
    labels: list[PrometheusLabel]
    samples: list[PrometheusSample]


class PrometheusWriteRequest(BaseModel):
    """
    Payload shape for Prometheus remote_write.
    Customers configure their Prometheus to POST this to /ingest/metrics.
    """
    timeseries: list[PrometheusTimeSeries]


# ── Canonical log signal schema ───────────────────────────────────────────────

LogSignalType = Literal[
    "gc_pause",
    "fielddata_eviction",
    "shard_failure",
    "shard_allocation_error",
    "slow_query",
    "circuit_breaker_trip",
    "write_rejection",
    "node_left",
    "node_high_disk",
    "ilm_error",
    "ilm_rollover_skip",
    "connection_retry",
    "slow_indexing",
    "merge_throttle",
]

LogSeverity = Literal["info", "warn", "error", "critical"]
LogSourcePlatform = Literal["elasticsearch", "splunk", "syslog", "cloudwatch"]


class CanonicalLogSignal(BaseModel):
    """
    Extracted signal from the log stream.
    Raw log lines are discarded — only this extracted signal is stored.
    """
    cluster_id: str
    db_type: DbType
    signal_type: LogSignalType
    severity: LogSeverity
    count: int = Field(..., ge=0)
    window_start: datetime
    window_end: datetime
    source_platform: LogSourcePlatform

    @field_validator("count")
    @classmethod
    def count_must_be_positive(cls, v: int) -> int:
        if v < 0:
            raise ValueError("count cannot be negative")
        return v


# ── API response schemas ──────────────────────────────────────────────────────

class ClusterResponse(BaseModel):
    id: str
    cluster_id: str
    db_type: str
    display_name: str
    cloud_provider: str | None
    region: str | None
    node_count: int | None
    current_status: str
    last_metric_received_at: datetime | None
    last_log_received_at: datetime | None

    class Config:
        from_attributes = True


class EvidenceResponse(BaseModel):
    evidence_text: str
    source_type: str
    confidence_delta: int

    class Config:
        from_attributes = True


class LlmExplanationResponse(BaseModel):
    explanation_text: str
    trigger_reason: str
    generated_at: datetime

    class Config:
        from_attributes = True


class VerdictResponse(BaseModel):
    id: str
    cluster_id: str
    analyzer_name: str
    status: str
    prev_status: str | None
    observed: str
    baseline_summary: str
    root_cause: str
    recommendation: str
    confidence: str
    metric_ts: datetime
    run_at: datetime
    data_freshness: str
    lag_seconds: int | None
    evidence: list[EvidenceResponse]
    llm_explanation: LlmExplanationResponse | None

    class Config:
        from_attributes = True


class BaselineProfileResponse(BaseModel):
    canonical_metric_name: str
    p50: float
    p75: float
    p95: float
    p99: float
    mean: float
    std_dev: float
    window_type: str
    sample_count: int
    computed_at: datetime

    class Config:
        from_attributes = True
