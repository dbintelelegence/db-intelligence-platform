"""
SQLAlchemy ORM models for the DB Intelligence Platform.

Table inventory:
  tenants                    — tenant isolation anchor
  stacks                     — internal: one engine + one source system + one tenant
  clusters                   — topology registry, one row per cluster
  cluster_metric_registry    — auto-populated from ingestion; what metrics a cluster sends
  cluster_log_registry       — auto-populated from ingestion; what log signal types arrive
  normalisation_map          — raw metric name → canonical name, maintained by product team
  unmapped_metrics           — metrics the adapter could not normalise; feedback loop
  baseline_profiles          — nightly percentile computation per cluster per metric
  analyzer_definitions       — static seed data; one row per named failure-mode analyzer
  analyzer_metric_requirements — what metrics each analyzer needs (required vs optional)
  analyzer_log_requirements  — what log signal types each analyzer uses for confidence
  analyzer_capability_map    — computed join: can this analyzer run on this cluster?
  verdicts                   — append-only output of every analyzer run
  verdict_evidence           — individual evidence items backing each verdict
  log_signals                — extracted log signals (raw logs discarded at ingestion)
  llm_explanations           — plain-English explanations generated on status change only
  onboarding_sessions        — state machine for connect → discover → seed flow
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime, Text,
    ForeignKey, UniqueConstraint, Index, Enum as SAEnum
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base
import enum


# ── Enums ────────────────────────────────────────────────────────────────────

class DbType(str, enum.Enum):
    elasticsearch = "elasticsearch"
    mysql = "mysql"
    cassandra = "cassandra"
    postgres = "postgres"

class HealthStatus(str, enum.Enum):
    healthy = "healthy"
    degraded = "degraded"
    critical = "critical"
    unknown = "unknown"

class DataFreshness(str, enum.Enum):
    fresh = "fresh"
    delayed = "delayed"
    gap = "gap"
    pending = "pending"

class ConfidenceLevel(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"

class RunnableStatus(str, enum.Enum):
    runnable = "runnable"           # all required inputs present
    reduced = "reduced"             # missing optional log signals; confidence capped
    blocked = "blocked"             # missing required metrics; cannot run

class EvidenceSourceType(str, enum.Enum):
    metric = "metric"
    log_signal = "log_signal"

class SourceType(str, enum.Enum):
    grafana_cloud = "grafana_cloud"
    datadog = "datadog"
    push = "push"                # customer pushes metrics to our ingest endpoint


# ── tenants ───────────────────────────────────────────────────────────────────

class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    stacks: Mapped[list["Stack"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
    unmapped_metrics: Mapped[list["UnmappedMetric"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
    onboarding_sessions: Mapped[list["OnboardingSession"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")


# ── stacks ────────────────────────────────────────────────────────────────────

class Stack(Base):
    """
    Internal concept only — never exposed to customer.
    One stack = one engine type + one source system + one tenant.
    """
    __tablename__ = "stacks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    db_type: Mapped[DbType] = mapped_column(SAEnum(DbType), nullable=False)
    source_type: Mapped[SourceType] = mapped_column(SAEnum(SourceType), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    api_endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    api_key_ref: Mapped[str] = mapped_column(Text, nullable=False)  # env var name or secret ref
    # Which label combination identifies a unique cluster in this source system
    cluster_label_key: Mapped[str | None] = mapped_column(String(128))
    has_metrics_adapter: Mapped[bool] = mapped_column(Boolean, default=True)
    has_log_adapter: Mapped[bool] = mapped_column(Boolean, default=False)
    has_metadata_adapter: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_successful_pull: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    tenant: Mapped["Tenant"] = relationship(back_populates="stacks")
    clusters: Mapped[list["Cluster"]] = relationship(back_populates="stack", cascade="all, delete-orphan")
    unmapped_metrics: Mapped[list["UnmappedMetric"]] = relationship(back_populates="stack", cascade="all, delete-orphan")


# ── clusters ─────────────────────────────────────────────────────────────────

class Cluster(Base):
    __tablename__ = "clusters"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stack_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("stacks.id", ondelete="SET NULL"))
    cluster_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    db_type: Mapped[DbType] = mapped_column(SAEnum(DbType), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    cloud_provider: Mapped[str | None] = mapped_column(String(64))
    region: Mapped[str | None] = mapped_column(String(128))
    node_count: Mapped[int | None] = mapped_column(Integer)

    # Denormalised status — updated after each analyzer run for fast overview queries
    current_status: Mapped[HealthStatus] = mapped_column(
        SAEnum(HealthStatus), default=HealthStatus.unknown, nullable=False
    )

    # Freshness tracking
    last_metric_received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_log_received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Expected cadence from the customer's scrape config (seconds)
    expected_metric_interval_seconds: Mapped[int] = mapped_column(Integer, default=60)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    stack: Mapped["Stack | None"] = relationship(back_populates="clusters")
    metric_registry: Mapped[list["ClusterMetricRegistry"]] = relationship(back_populates="cluster", cascade="all, delete-orphan")
    log_registry: Mapped[list["ClusterLogRegistry"]] = relationship(back_populates="cluster", cascade="all, delete-orphan")
    # Note: baseline_profiles.cluster_id is a string composite key, not a UUID FK.
    # No ORM relationship — use engine.py functions to query by cluster_id string.
    verdicts: Mapped[list["Verdict"]] = relationship(back_populates="cluster", cascade="all, delete-orphan")
    log_signals: Mapped[list["LogSignal"]] = relationship(back_populates="cluster", cascade="all, delete-orphan")
    capability_map: Mapped[list["AnalyzerCapabilityMap"]] = relationship(back_populates="cluster", cascade="all, delete-orphan")


# ── cluster_metric_registry ───────────────────────────────────────────────────

class ClusterMetricRegistry(Base):
    __tablename__ = "cluster_metric_registry"
    __table_args__ = (
        UniqueConstraint("cluster_id", "source_metric_name", name="uq_cluster_source_metric"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=False)

    # What the analyzer engine calls it (canonical) vs what the customer sends
    canonical_name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_metric_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Category for grouping (jvm | shard | io | disk | search | indexing)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(32))  # percent | ms | bytes | count

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    cluster: Mapped["Cluster"] = relationship(back_populates="metric_registry")

    __table_args__ = (
        UniqueConstraint("cluster_id", "source_metric_name", name="uq_cluster_source_metric"),
        Index("ix_cmr_cluster_canonical", "cluster_id", "canonical_name"),
    )


# ── cluster_log_registry ──────────────────────────────────────────────────────

class ClusterLogRegistry(Base):
    __tablename__ = "cluster_log_registry"
    __table_args__ = (
        UniqueConstraint("cluster_id", "signal_type", name="uq_cluster_signal_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=False)

    # e.g. gc_pause | fielddata_eviction | shard_failure | slow_query | write_rejection
    signal_type: Mapped[str] = mapped_column(String(128), nullable=False)
    source_platform: Mapped[str] = mapped_column(String(64), nullable=False)  # elasticsearch | splunk | syslog

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Average events per hour — distinguishes "never seen" from "rare but real"
    avg_count_per_hour: Mapped[float] = mapped_column(Float, default=0.0)

    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    cluster: Mapped["Cluster"] = relationship(back_populates="log_registry")


# ── baseline_profiles ─────────────────────────────────────────────────────────

class BaselineProfile(Base):
    __tablename__ = "baseline_profiles"
    __table_args__ = (
        UniqueConstraint("cluster_id", "canonical_metric_name", "window_type", name="uq_baseline_cluster_metric_window"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Composite string key: lp_segment|datacenter|lp_cluster — matches cluster.cluster_id
    # NOT a UUID FK — the engine queries by this string, not by clusters.id
    cluster_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    canonical_metric_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Percentile distribution computed from historical data
    p50: Mapped[float] = mapped_column(Float, nullable=False)
    p75: Mapped[float] = mapped_column(Float, nullable=False)
    p95: Mapped[float] = mapped_column(Float, nullable=False)
    p99: Mapped[float] = mapped_column(Float, nullable=False)
    mean: Mapped[float] = mapped_column(Float, nullable=False)
    std_dev: Mapped[float] = mapped_column(Float, nullable=False)

    # window_type: all | weekday | weekend | business_hours | off_hours
    # Allows time-aware baseline comparison
    window_type: Mapped[str] = mapped_column(String(32), default="all", nullable=False)

    sample_count: Mapped[int] = mapped_column(Integer, nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    # Covers data from this window when computing
    covers_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    covers_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ── analyzer_definitions (static seed data) ───────────────────────────────────

class AnalyzerDefinition(Base):
    __tablename__ = "analyzer_definitions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Stable machine name — used as the key in code
    analyzer_name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    db_type: Mapped[DbType] = mapped_column(SAEnum(DbType), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text)
    # What confidence level is achievable without any log signals
    min_confidence_without_logs: Mapped[str] = mapped_column(String(16), default="medium")
    # Build phase: 1 | 2 | 3 — controls which analyzers are active
    phase: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    metric_requirements: Mapped[list["AnalyzerMetricRequirement"]] = relationship(back_populates="analyzer", cascade="all, delete-orphan")
    log_requirements: Mapped[list["AnalyzerLogRequirement"]] = relationship(back_populates="analyzer", cascade="all, delete-orphan")
    capability_map: Mapped[list["AnalyzerCapabilityMap"]] = relationship(back_populates="analyzer", cascade="all, delete-orphan")


class AnalyzerMetricRequirement(Base):
    __tablename__ = "analyzer_metric_requirements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analyzer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("analyzer_definitions.id", ondelete="CASCADE"), nullable=False)
    canonical_metric_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # True = analyzer cannot run without this metric
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)
    # Role of this metric in the verdict logic: primary | corroborating
    role: Mapped[str] = mapped_column(String(32), default="primary")

    analyzer: Mapped["AnalyzerDefinition"] = relationship(back_populates="metric_requirements")


class AnalyzerLogRequirement(Base):
    __tablename__ = "analyzer_log_requirements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analyzer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("analyzer_definitions.id", ondelete="CASCADE"), nullable=False)
    signal_type: Mapped[str] = mapped_column(String(128), nullable=False)
    # False = optional but boosts confidence when present
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    # +1 | -1 — effect on confidence level when this signal is present
    confidence_impact: Mapped[str] = mapped_column(String(8), default="+1")

    analyzer: Mapped["AnalyzerDefinition"] = relationship(back_populates="log_requirements")


# ── analyzer_capability_map ───────────────────────────────────────────────────

class AnalyzerCapabilityMap(Base):
    """
    Computed once at onboarding and refreshed whenever the metric or log
    registry changes. Answers: can this analyzer run on this cluster, and
    at what confidence ceiling?
    """
    __tablename__ = "analyzer_capability_map"
    __table_args__ = (
        UniqueConstraint("cluster_id", "analyzer_id", name="uq_capability_cluster_analyzer"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=False)
    analyzer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("analyzer_definitions.id", ondelete="CASCADE"), nullable=False)

    runnable_status: Mapped[RunnableStatus] = mapped_column(SAEnum(RunnableStatus), nullable=False)
    # Maximum confidence level this cluster can achieve for this analyzer
    confidence_ceiling: Mapped[str] = mapped_column(String(16), nullable=False)  # low | medium | high
    # JSON list of missing primary metric canonical names (missing = analyzer cannot run)
    missing_primary: Mapped[str | None] = mapped_column(Text)
    # JSON list of missing corroborating metric canonical names (missing = confidence drops)
    missing_corroborating: Mapped[str | None] = mapped_column(Text)
    # JSON list of missing log signal types
    missing_log_signals: Mapped[str | None] = mapped_column(Text)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    cluster: Mapped["Cluster"] = relationship(back_populates="capability_map")
    analyzer: Mapped["AnalyzerDefinition"] = relationship(back_populates="capability_map")


# ── verdicts ──────────────────────────────────────────────────────────────────

class Verdict(Base):
    """
    Append-only. One row per analyzer per cluster (or per instance) per run.
    Never update — always insert a new row.
    The timeline of status changes is reconstructed by querying this table
    ordered by run_at for a given cluster + analyzer (+ instance_id if set).
    """
    __tablename__ = "verdicts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=False)
    analyzer_name: Mapped[str] = mapped_column(String(128), nullable=False)
    # Set for per-instance verdicts (e.g. MySQL buffer pool per node). None = cluster-level.
    instance_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    status: Mapped[HealthStatus] = mapped_column(SAEnum(HealthStatus), nullable=False)
    # Previous status — used to detect status changes and trigger LLM
    prev_status: Mapped[HealthStatus | None] = mapped_column(SAEnum(HealthStatus))

    # Human-readable fields populated by the analyzer
    observed: Mapped[str] = mapped_column(Text)          # what the analyzer saw
    baseline_summary: Mapped[str] = mapped_column(Text)  # what normal looks like
    root_cause: Mapped[str] = mapped_column(Text)        # deterministic root cause
    recommendation: Mapped[str] = mapped_column(Text)    # what to do

    confidence: Mapped[ConfidenceLevel] = mapped_column(SAEnum(ConfidenceLevel), nullable=False)

    # Three timestamps — critical for understanding data freshness
    metric_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))     # when ES produced the data
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))   # when our API received it
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)  # when analyzer ran

    # Freshness flag set by ingestion layer
    data_freshness: Mapped[DataFreshness] = mapped_column(SAEnum(DataFreshness), default=DataFreshness.fresh)
    lag_seconds: Mapped[int | None] = mapped_column(Integer)  # metric_ts to run_at in seconds

    cluster: Mapped["Cluster"] = relationship(back_populates="verdicts")
    evidence: Mapped[list["VerdictEvidence"]] = relationship(back_populates="verdict", cascade="all, delete-orphan")
    llm_explanation: Mapped["LlmExplanation | None"] = relationship(back_populates="verdict", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_verdicts_cluster_analyzer_instance_run", "cluster_id", "analyzer_name", "instance_id", "run_at"),
        Index("ix_verdicts_cluster_status", "cluster_id", "status"),
    )


# ── verdict_evidence ──────────────────────────────────────────────────────────

class VerdictEvidence(Base):
    """
    Individual pieces of evidence backing a verdict.
    Each row is one data point: either a metric observation or a log signal.
    """
    __tablename__ = "verdict_evidence"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    verdict_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("verdicts.id", ondelete="CASCADE"), nullable=False)
    # Optional link to the log signal that corroborates
    log_signal_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("log_signals.id", ondelete="SET NULL"))

    # Human-readable description of this evidence item
    evidence_text: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[EvidenceSourceType] = mapped_column(SAEnum(EvidenceSourceType), nullable=False)
    # +1 increases confidence, -1 decreases, 0 = neutral (just informational)
    confidence_delta: Mapped[int] = mapped_column(Integer, default=0)

    verdict: Mapped["Verdict"] = relationship(back_populates="evidence")
    log_signal: Mapped["LogSignal | None"] = relationship(back_populates="evidence_links")


# ── log_signals ───────────────────────────────────────────────────────────────

class LogSignal(Base):
    """
    Extracted signal from log stream. Raw logs are discarded immediately.
    One row per signal type per time window per cluster.
    """
    __tablename__ = "log_signals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=False)

    signal_type: Mapped[str] = mapped_column(String(128), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)  # info | warn | error | critical
    count: Mapped[int] = mapped_column(Integer, nullable=False)

    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_platform: Mapped[str] = mapped_column(String(64), nullable=False)

    cluster: Mapped["Cluster"] = relationship(back_populates="log_signals")
    evidence_links: Mapped[list["VerdictEvidence"]] = relationship(back_populates="log_signal")

    __table_args__ = (
        Index("ix_log_signals_cluster_type_window", "cluster_id", "signal_type", "window_start"),
    )


# ── llm_explanations ─────────────────────────────────────────────────────────

class LlmExplanation(Base):
    """
    Plain-English explanation generated by the LLM.
    Only created when verdict status changes — not on every run.
    Stored permanently so postmortem mode reads history, not re-calls LLM.
    """
    __tablename__ = "llm_explanations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    verdict_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("verdicts.id", ondelete="CASCADE"), unique=True, nullable=False)

    explanation_text: Mapped[str] = mapped_column(Text, nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    # Why the LLM was triggered: e.g. "status changed from healthy to degraded"
    trigger_reason: Mapped[str] = mapped_column(String(255))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    # Token usage for cost tracking
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)

    verdict: Mapped["Verdict"] = relationship(back_populates="llm_explanation")


# ── normalisation_map ─────────────────────────────────────────────────────────

class NormalisationMap(Base):
    """
    Maps raw source metric names to canonical names.
    Maintained by product team via admin UI — not a static Python file.
    Loaded into memory at startup with a 5-minute TTL.
    """
    __tablename__ = "normalisation_map"
    __table_args__ = (
        UniqueConstraint("source_type", "db_type", "raw_metric_name", name="uq_norm_source_db_raw"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_type: Mapped[SourceType] = mapped_column(SAEnum(SourceType), nullable=False)
    db_type: Mapped[DbType] = mapped_column(SAEnum(DbType), nullable=False)
    raw_metric_name: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


# ── unmapped_metrics ──────────────────────────────────────────────────────────

class UnmappedMetric(Base):
    """
    Metrics the adapter received but could not normalise.
    Product team reviews this table to add new normalisation_map entries.
    occurrence_count distinguishes noise from real exporter variants.
    """
    __tablename__ = "unmapped_metrics"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    stack_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stacks.id", ondelete="CASCADE"), nullable=False)
    source_type: Mapped[SourceType] = mapped_column(SAEnum(SourceType), nullable=False)
    db_type: Mapped[DbType] = mapped_column(SAEnum(DbType), nullable=False)
    raw_metric_name: Mapped[str] = mapped_column(Text, nullable=False)
    sample_value: Mapped[float | None] = mapped_column(Float)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    occurrence_count: Mapped[int] = mapped_column(Integer, default=1)
    # new | reviewed | mapped | rejected
    status: Mapped[str] = mapped_column(String(32), default="new")
    canonical_name: Mapped[str | None] = mapped_column(Text)  # filled by product team when resolved
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[str | None] = mapped_column(Text)

    tenant: Mapped["Tenant"] = relationship(back_populates="unmapped_metrics")
    stack: Mapped["Stack"] = relationship(back_populates="unmapped_metrics")


# ── onboarding_sessions ───────────────────────────────────────────────────────

class OnboardingSession(Base):
    """
    State machine for the customer connect → discover → seed → ready flow.
    States: PENDING_CONNECTION | CONNECTING | CONNECTION_FAILED |
            DISCOVERING | DISCOVERY_COMPLETE | AWAITING_CONFIRMATION |
            SEEDING_BASELINES | READY | PARTIALLY_READY
    """
    __tablename__ = "onboarding_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    stack_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("stacks.id", ondelete="SET NULL"))
    state: Mapped[str] = mapped_column(String(32), nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    clusters_found: Mapped[int | None] = mapped_column(Integer)
    clusters_ready: Mapped[int | None] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    tenant: Mapped["Tenant"] = relationship(back_populates="onboarding_sessions")


# ── ingest_tokens ─────────────────────────────────────────────────────────────

class IngestToken(Base):
    """
    Bearer tokens issued to push-stack customers.
    Raw token is shown once at creation and never stored.
    Only SHA-256(raw_token) is persisted here.
    """
    __tablename__ = "ingest_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    stack_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stacks.id", ondelete="CASCADE"), nullable=False)
    # SHA-256 hex digest of the raw token — never store plaintext
    token_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    # Human label e.g. "prod-prometheus", "staging-otel"
    label: Mapped[str | None] = mapped_column(String(128))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    tenant: Mapped["Tenant"] = relationship()
    stack: Mapped["Stack"] = relationship()
