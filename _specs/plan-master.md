# DB Intelligence Platform
## Master Planning Document v1.0 — April 2026

---

## 0. How to use this document

This is the authoritative planning document for the DB Intelligence Platform.
It is written to be consumed by Claude Code in plan mode.

### Before writing any code in every session:

1. Read `_specs/STATUS.md` first — it tells you exactly where the last
   session ended and what the next action is
2. Read this entire document
3. Check the build sequence in Section 9 — follow it exactly
4. Check constraints in Section 4 before every implementation decision

### During every session:

- Update `_specs/STATUS.md` whenever a component is completed
- Update `_specs/STATUS.md` whenever something unexpected is discovered
- Update `_specs/STATUS.md` before stopping for any reason

### When stopping a session:

Write to `_specs/STATUS.md` with enough detail that a completely fresh
Claude Code session can resume without asking any questions.

If something in this document conflicts with existing code, flag the
conflict in `_specs/STATUS.md` and do not silently resolve it.

---

## 1. Product vision

A database optimization and health intelligence platform that produces
evidence-backed, design-aware verdicts about why a database cluster or
instance is behaving poorly and what to do about it — providing a single
pane of glass across all database deployments across edge, multi-cloud,
self-managed, and DBaaS environments.

**The Database Hub** provides a unified database management experience
that brings together databases across edge, multi-cloud, self-managed,
and DBaaS. Teams have one place to explore, observe, and optimize their
entire database estate:

- **NoSQL:** Elasticsearch, MongoDB, Cassandra, Couchbase, Redis
- **RDBMS:** MySQL, PostgreSQL, Oracle, SQL Server, RDS and other
  managed services
- **Deployment models:** Edge, multi-cloud (AWS/GCP/Azure),
  self-managed, DBaaS

**Prototype scope (what is being built now):**
- Engine: Elasticsearch only
- Source systems: Grafana Cloud and Datadog
- Deployment: Self-hosted Elasticsearch on GCP
- Customer profile: Mid-size company, 50+ databases, GCP and
  self-hosted
- Input layers: Metrics only (logs and metadata come later)

**Future engines (not in this plan):**
- Phase 2: Self-hosted MySQL
- Phase 3+: PostgreSQL, MongoDB, Redis, Cassandra, Couchbase,
  Oracle, SQL Server

## 1.1 Core Mantra.
What this platform does is that when there is an issue the DBA oncall can login to this portal and look for what they need to check, this guides and potentially recommends a fix for the onging issue reducing the MTTR. 

Customer can login to dashboard 
  - look for a specific time period 
  - Help me understand what is wrong with my cluster or node. 
  - Product runs analyzers and provides insights on the data gathered either through push or pull based 
---

## 2. The one-line principle

**Deterministic analyzers find the truth. The LLM explains the truth.**

The LLM never diagnoses. Analyzers produce structured verdicts.
The LLM converts them to plain English on status change only.

---

## 3. What this product is NOT

- Not a monitoring tool — we do not collect metrics ourselves
- Not a dashboard — users have Grafana, Datadog, Kibana for charts
- Not an automation tool — we never modify, restart, or reconfigure
  a customer's database
- Not a replacement for Grafana or Datadog — we sit above them and
  read what they already collect

**We take the customer's existing monitoring platform as-is and provide
intelligence on top of the data they are already collecting.**

---

## 4. Constraints — never violate these

These are hard constraints. No implementation decision may contradict
them regardless of how convenient it would be.

| Constraint | What it means in code |
|------------|----------------------|
| Advisory-first | No code that modifies, restarts, or reconfigures a customer database. Ever. |
| Read-only | The platform only calls GET/read endpoints on source systems. Never POST/PUT/DELETE on customer infrastructure. |
| Deterministic analyzers find truth | No LLM calls inside any analyzer. LLM only in verdict writer on status change. |
| LLM on status change only | Check new_status != prev_status before every LLM call. Never call on every run. |
| No raw metrics storage | Metric values held in memory during run cycle only. Only baselines and verdicts persisted. Raw values discarded after baseline computation. |
| No raw log storage | Out of scope for prototype. When built: signals only, raw content never stored. |
| Append-only verdicts | Never UPDATE the verdicts table. Always INSERT new row. |
| Engine abstraction | Elasticsearch never hardcoded outside ES-specific modules. All platform logic operates on canonical schemas only. |
| Tenant isolation | Every database query includes tenant_id filter. No exceptions. |
| No stack exposure | The stack concept is internal only. Never appears in API responses or UI. |

---

## 5. Architecture — three layers

The architecture has three clean layers. The customer only ever sees
Layer 1. Layer 3 is entirely internal.

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1 — PRESENTATION                                         │
│  What the customer sees                                         │
│  Database names, health status, verdicts, recommendations       │
│  Completely source-agnostic and engine-agnostic                 │
│  React frontend + FastAPI REST API                              │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2 — INTELLIGENCE                                         │
│  What the platform computes                                     │
│  Baseline engine → Analyzers → [Metadata enrichment] →         │
│  Verdict writer → LLM explanation                               │
│  Engine-specific but source-agnostic                            │
│  Operates on canonical schemas only                             │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3 — INGESTION (internal only, never exposed)             │
│  Source adapters + Normalisation maps + Stack management        │
│  Source-specific and engine-specific                            │
│  Resolves metric names, pulls data, normalises to canonical     │
│  Customer never sees: stacks, source types, normalisation maps  │
└─────────────────────────────────────────────────────────────────┘
```

**Layer 1 never talks to Layer 3 directly. This boundary is sacred.**

---

## 6. Intelligence pipeline

The pipeline processes data through stages. Each stage is independent.
Each stage degrades gracefully when its input is absent.

```
┌──────────────┐
│    METRICS   │ ← mandatory, analyzer cannot run without this
│  (canonical) │
└──────┬───────┘
       │
       ▼
┌──────────────┐    ┌──────────────┐
│  LOG SIGNALS │    │   BASELINES  │
│  (optional)  │    │ (computed    │
│              │    │  nightly)    │
└──────┬───────┘    └──────┬───────┘
       │                   │
       └─────────┬─────────┘
                 ▼
        ┌─────────────────┐
        │    ANALYZERS    │
        │ Detects anomaly │
        │ Computes sigma  │
        │ Scores evidence │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │    METADATA     │ ← optional enrichment stage
        │   ENRICHMENT    │   only runs if metadata present
        │ Sharpens root   │   never blocks verdict
        │ cause and recs  │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │    VERDICTS     │
        │ Always written  │
        │ regardless of   │
        │ layers present  │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │  LLM EXPLANATION│ ← only on status change
        │ Plain English   │   never on every run
        └─────────────────┘
```

### Layer combinations and what they produce

| Metrics | Logs | Metadata | Verdict quality | Confidence ceiling |
|---------|------|----------|----------------|-------------------|
| ✓ | ✗ | ✗ | Generic root cause | MEDIUM |
| ✓ | ✓ | ✗ | Directional root cause | HIGH |
| ✓ | ✗ | ✓ | Specific root cause | HIGH |
| ✓ | ✓ | ✓ | Definitive root cause | HIGH |
| ✗ | any | any | Cannot run | — |

**Metrics are the only hard requirement. Everything else is additive.**

---

## 7. Stack model — internal isolation unit

A **stack** is an internal concept that groups a customer's databases
by engine and source system. The customer never sees this word.

### What a stack is

```
Stack = one engine type + one source system + one customer

Examples (internal only, never shown to customer):
  tenant_a + elasticsearch + grafana_cloud
  tenant_a + mysql + datadog
  tenant_b + elasticsearch + datadog
```

### Why stacks exist

- **Data isolation:** Each stack's metrics, baselines, verdicts, and
  normalisation maps are isolated per tenant. Structural isolation,
  not just access control.
- **Per-stack normalisation:** Customer A's Grafana Cloud uses
  `elasticsearch_jvm_memory_heap_used_percent`. Customer B's Datadog
  uses `elasticsearch.jvm.mem.heap_used_percent`. Each stack has its
  own normalisation map. They never conflict.
- **Multi-source per customer:** Customer A can have Elasticsearch
  metrics in Grafana Cloud and MySQL metrics in Datadog. Two stacks,
  one customer, clean separation.

### Stack data model

```sql
stacks (
    id                    UUID PRIMARY KEY,
    tenant_id             UUID NOT NULL,         -- which customer
    db_type               VARCHAR(32) NOT NULL,  -- elasticsearch | mysql
    source_type           VARCHAR(32) NOT NULL,  -- grafana_cloud | datadog
    display_name          VARCHAR(255),          -- internal label only
    api_endpoint          TEXT NOT NULL,
    api_key_ref           TEXT NOT NULL,         -- reference to secret store
    cluster_label_key     VARCHAR(128),          -- which label = cluster ID
    has_metrics_adapter   BOOLEAN DEFAULT true,
    has_log_adapter       BOOLEAN DEFAULT false,
    has_metadata_adapter  BOOLEAN DEFAULT false,
    is_active             BOOLEAN DEFAULT true,
    last_successful_pull  TIMESTAMPTZ,
    created_at            TIMESTAMPTZ DEFAULT NOW()
)
```

### What the customer sees instead of stacks

When a customer adds a database connection, they see:

```
What type of database?
  ○ Elasticsearch
  ○ MySQL
  ○ PostgreSQL

Where are your metrics?
  ○ Grafana Cloud
  ○ Datadog
  ○ Amazon CloudWatch
  ○ Google Cloud Monitoring

Connection details
  API Endpoint: ________________
  API Key:      ________________

[Connect]
```

Behind the scenes this creates a stack. The customer never knows.

---

## 8. Normalisation architecture

### The problem

The same metric can arrive with completely different names depending
on which exporter the customer deployed and which source system
they use:

```
prometheus-community/elasticsearch_exporter:
  elasticsearch_jvm_memory_heap_used_percent

Official Elastic exporter:
  elastic_jvm_memory_heap_used_percent

Datadog Elasticsearch integration:
  elasticsearch.jvm.mem.heap_used_percent

Custom or older exporters:
  es_jvm_heap_used_percent
  elasticsearch_jvm_mem_heap_used_percent_v2
```

### The solution — source-type layered normalisation

Normalisation is per source type. Each source type has its own
naming conventions, separators, and abbreviations. A single flat
map cannot handle them correctly.

```
source_type: GRAFANA_CLOUD (Prometheus format)
  elasticsearch_jvm_memory_heap_used_percent → jvm.heap.used.percent
  elastic_jvm_memory_heap_used_percent       → jvm.heap.used.percent
  es_jvm_heap_used_percent                   → jvm.heap.used.percent

source_type: DATADOG
  elasticsearch.jvm.mem.heap_used_percent    → jvm.heap.used.percent
  elasticsearch.jvm.mem.heap_used            → jvm.heap.used.percent
```

### Normalisation map in the database

The normalisation map is NOT a static Python file. It lives in the
database so the product team can update it without deployment:

```sql
normalisation_map (
    id                UUID PRIMARY KEY,
    source_type       VARCHAR(32) NOT NULL,  -- grafana_cloud | datadog
    db_type           VARCHAR(32) NOT NULL,  -- elasticsearch | mysql
    raw_metric_name   TEXT NOT NULL,         -- what the source sends
    canonical_name    VARCHAR(255) NOT NULL, -- what analyzers use
    category          VARCHAR(64) NOT NULL,
    unit              VARCHAR(32) NOT NULL,
    is_active         BOOLEAN DEFAULT true,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_type, db_type, raw_metric_name)
)
```

Seeded at deployment with all known variants. Updated through the
internal admin UI when new variants are discovered.

**Caching:** Loaded into memory at startup with a 5-minute TTL.
Product team updates take effect within 5 minutes without restart.

### Unmapped metrics — feedback loop to product team

When a metric arrives that has no entry in the normalisation map:

```sql
unmapped_metrics (
    id                UUID PRIMARY KEY,
    tenant_id         UUID NOT NULL,
    stack_id          UUID NOT NULL,
    source_type       VARCHAR(32) NOT NULL,
    db_type           VARCHAR(32) NOT NULL,
    raw_metric_name   TEXT NOT NULL,
    sample_value      FLOAT,
    first_seen_at     TIMESTAMPTZ DEFAULT NOW(),
    occurrence_count  INTEGER DEFAULT 1,
    status            VARCHAR(32) DEFAULT 'new', -- new|reviewed|mapped|rejected
    canonical_name    TEXT,   -- filled by product team when resolved
    resolved_at       TIMESTAMPTZ,
    resolved_by       TEXT
)
```

Product team reviews this table via the internal admin UI. When
resolved, the normalisation_map table is updated and all future
metrics with that name are recognised automatically.

**The occurrence_count matters:** A metric seen once from one
customer may be noise. A metric seen 847 times across 12 customers
is an exporter variant that needs immediate mapping.

### Prototype normalisation approach

For the prototype (one customer, Grafana Cloud, Elasticsearch):

1. Run discovery against the real Grafana Cloud instance first
2. Record actual metric names in DISCOVERY_NOTES.md
3. Seed normalisation_map from real names found
4. Do not guess metric names — only map what is confirmed real

---

## 9. Push vs Pull metric collection model

### Overview

The platform currently uses a **pull-based** model for all sources —
the backend actively queries the customer's monitoring system on a
schedule. A push-based model exists for future self-hosted or
lightweight deployments where the customer sends metrics to us.

### Pull-based (current model)

```
Customer monitoring system ←── Backend adapter (scheduled pull)
  (Grafana Cloud, Datadog)          │
                                    ▼
                            Canonical metrics
                                    │
                                    ▼
                          Baseline engine / Analyzers
```

**How it works:**
- Adapter calls source system API on a cron schedule (e.g. every 5 min)
- Adapter fetches latest values for each required canonical metric
- Values are held in memory, passed to analyzers, then discarded
- No raw metric values are stored

**Source systems that support pull:**
| Source | Protocol | Auth | Cluster identity |
|--------|----------|------|-----------------|
| Grafana Cloud | Prometheus HTTP API (GET/POST) | Basic auth (instance_id + API key) | lp_segment\|datacenter\|lp_cluster |
| Datadog | Datadog Metrics API | API key + App key | tag-based |
| Amazon CloudWatch | AWS SDK | IAM role or access key | namespace + dimension |
| Google Cloud Monitoring | GCP API | Service account | resource labels |

**Characteristics:**
- Platform controls the pull interval — can tune freshness vs API quota
- Source system is the authority — platform only reads
- Requires outbound network access from backend to source API
- Auth credentials stored in the stack config (api_key_ref → secret store)
- Pre-aggregated metrics in Grafana Cloud require explicit PromQL aggregation (e.g. `max by (...)`) or queries fail

**Current pull cadence:**
- Analyzer runner: manual / cron (not yet automated in prototype)
- Baseline seeder: manual, run once then on significant schema change

---

### Push-based (planned — not yet built)

```
Customer infrastructure ──► Ingest endpoint (our API)
  (Prometheus, OTel,                │
   custom exporters)                ▼
                            Normalisation + store
                                    │
                                    ▼
                          Baseline engine / Analyzers
```

**How it would work:**
- Customer configures their exporter or collector to remote_write/push to our ingest endpoint
- We receive raw metric samples, normalise via the normalisation map, derive canonical values
- Canonical values trigger the analyzer pipeline in near-real-time

**Source systems that would support push:**
| Source | Protocol | Auth | Notes |
|--------|----------|------|-------|
| Prometheus remote_write | Protobuf over HTTPS | Bearer token | Most common self-hosted path |
| OpenTelemetry Collector | OTLP gRPC or HTTP | mTLS or bearer | Cloud-native deployments |
| Datadog Agent (forwarder) | Datadog wire protocol | API key | For customers migrating from Datadog |
| Custom exporters | JSON or Prometheus text format | API key | Lightweight agents |

**Why push matters:**
- Works for air-gapped or private network environments (no outbound from backend)
- Lower latency — metrics arrive as soon as scraped
- Eliminates API quota concerns — customer controls export rate
- Enables lightweight deployments: small agent, no monitoring platform needed

**Constraints for push model (when built):**
- Must still normalise via normalisation_map (same as pull)
- Raw metric values must NOT be persisted — normalise then discard
- Ingest endpoint must validate tenant and stack identity on every request
- Rate limiting and back-pressure handling required at ingest layer

---

### Comparison matrix

| Dimension | Pull | Push |
|-----------|------|------|
| Who initiates | Platform backend | Customer agent/exporter |
| Network direction | Backend → Source | Customer → Platform |
| Works air-gapped | No | Yes |
| Latency | Pull interval (minutes) | Near-real-time (seconds) |
| Requires monitoring platform | Yes | No |
| API quota exposure | Yes | No (we control ingest) |
| Customer setup complexity | Low (API key only) | Medium (configure exporter target) |
| Auth surface | Source system credentials | Per-tenant ingest token |
| Current status | **Built and running** | Planned — not built |
| Prototype uses | Grafana Cloud (pull) | — |

---

### Decision rule for new source systems

1. Does the customer already have a monitoring platform (Grafana, Datadog, CloudWatch)? → **Pull**
2. Is the deployment air-gapped or private-network? → **Push**
3. Does the customer want to minimise monitoring platform dependencies? → **Push**
4. Is the customer running Prometheus locally (not cloud-managed)? → **Push via remote_write**

---

## 10. Onboarding flow

### Customer-facing steps

```
Step 1 — Connect source system
  Customer enters: source type, API endpoint, API key
  Platform: tests connection, returns success or specific error

Step 2 — Discovery
  Platform: scans for clusters using the configured cluster_label_key
  Platform: checks each metric against normalisation map
  Platform: computes initial capability map per cluster
  Customer sees: list of clusters found with metric coverage summary

Step 3 — Cluster selection
  Customer: selects which clusters to monitor
  Platform: shows per-cluster coverage:
    ✓ prod-es-01    23 metrics recognised    Full analysis available
    ✓ prod-es-02    23 metrics recognised    Full analysis available
    ⚠ staging-es-01 18 metrics recognised    Reduced confidence
    ? es-archive    3 metrics recognised     Limited analysis

Step 4 — Baseline seeding
  Platform: pulls 30 days of historical data for selected clusters
  Platform: computes baseline profiles
  Customer sees: progress indicator
  Duration: depends on cluster count and data volume

Step 5 — First verdicts
  Platform: runs first analyzer cycle
  Customer: sees real health verdicts
  Time from Step 1 to first verdict: target < 15 minutes
```

### Onboarding state machine

```sql
onboarding_sessions (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    stack_id        UUID,
    state           VARCHAR(32) NOT NULL,
    -- States:
    -- PENDING_CONNECTION
    -- CONNECTING
    -- CONNECTION_FAILED
    -- DISCOVERING
    -- DISCOVERY_COMPLETE
    -- AWAITING_CONFIRMATION
    -- SEEDING_BASELINES
    -- READY
    -- PARTIALLY_READY (some clusters ready, some failed)
    error_message   TEXT,
    clusters_found  INTEGER,
    clusters_ready  INTEGER,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
)
```

### Onboarding failure messages — customer-facing language

| Technical error | Customer-facing message |
|----------------|------------------------|
| HTTP 401 | "We couldn't connect with that API key. Check that it has read access to metrics and hasn't expired." |
| HTTP 403 | "The API key connected but doesn't have permission to read metrics. Check the key's access scope." |
| HTTP 404 | "We couldn't find a metrics API at that endpoint. Double-check the URL." |
| No metrics found | "We connected successfully but couldn't find any Elasticsearch metrics. Is your exporter running and sending data?" |
| No clusters found | "We found metrics but couldn't identify any clusters. Which label identifies your clusters?" |
| Metrics found, none mapped | "We found metrics but couldn't automatically recognise them. Our team has been notified and will add support shortly." |
| Partial mapping | "We recognised N of your M metric types. Analysis will run at reduced confidence until full coverage is confirmed." |

---

## 11. Analyzer engine

### Metric roles — three levels, not two

Every metric in an analyzer has a role. This is critical for
correct confidence scoring when metrics are missing.

| Role | Meaning | Missing impact |
|------|---------|---------------|
| PRIMARY | The core signal. Without this, the analyzer cannot produce a meaningful verdict. | Analyzer does not run |
| CORROBORATING | Strengthens the verdict when present. | Confidence ceiling drops |
| OPTIONAL | Log signals or supplementary metrics. | Confidence ceiling drops slightly |

**Example for jvm_heap_pressure:**

```python
METRIC_ROLES = {
    "jvm.heap.used.percent":      "primary",       # missing = cannot run
    "gc.old.collection.seconds":  "primary",       # missing = cannot run
    "gc.old.collection.count":    "corroborating", # missing = confidence drops
}

OPTIONAL_LOG_SIGNALS = [
    "fielddata_eviction",    # +1 confidence level if present
    "gc_pause",              # +1 confidence level if present
    "circuit_breaker_trip",  # noted in evidence, no confidence change
]
```

### Analyzer interface

```python
class BaseAnalyzer(ABC):

    ANALYZER_NAME: str = ""
    DB_TYPE: str = ""

    # Metrics by role
    PRIMARY_METRICS: list[str] = []        # analyzer cannot run without these
    CORROBORATING_METRICS: list[str] = []  # confidence drops if missing
    OPTIONAL_LOG_SIGNALS: list[str] = []   # confidence boost if present

    def can_run(self, available_metrics: set[str]) -> bool:
        """Returns True only if all PRIMARY_METRICS are available."""
        return all(m in available_metrics for m in self.PRIMARY_METRICS)

    def confidence_ceiling(self, available_metrics: set[str]) -> str:
        """
        Returns maximum achievable confidence given available metrics.
        HIGH   = all primary + all corroborating present
        MEDIUM = all primary present, some corroborating missing
        LOW    = primary present, most corroborating missing
        """
        missing_corroborating = [
            m for m in self.CORROBORATING_METRICS
            if m not in available_metrics
        ]
        if not missing_corroborating:
            return "high"
        elif len(missing_corroborating) < len(self.CORROBORATING_METRICS):
            return "medium"
        else:
            return "low"

    @abstractmethod
    def analyze(
        self,
        metrics: dict[str, float],
        baselines: dict[str, BaselineProfile],
        log_signals: dict[str, int] = {},
        metric_ts: datetime = None,
    ) -> VerdictResult:
        """
        Produce a verdict from available inputs.
        Never call the LLM here.
        Never access raw metric names — only canonical names.
        """
```

### Metadata enrichment interface

Metadata enrichment runs after the analyzer, before the verdict
is written. It is optional. If metadata is not present, the
verdict passes through unchanged.

```python
class BaseMetadataEnricher(ABC):

    @abstractmethod
    def enrich(
        self,
        verdict: VerdictResult,
        metadata: ClusterMetadata,
    ) -> VerdictResult:
        """
        Takes a verdict and cluster metadata.
        Returns enriched verdict with:
        - Sharpened root_cause (specific field names, config values)
        - Sharpened recommendation (specific settings to change)
        - Additional evidence items tagged as source_type="metadata"
        - Potentially adjusted confidence
        Never blocks. If enrichment fails, return original verdict.
        """
```

### Confidence scoring rules

```
Base confidence from metrics:
  All primary + corroborating present     → MEDIUM base
  Primary present, corroborating missing  → LOW base

Adjustments:
  Log signal corroborates                 → +1 level
  Log signal identifies root cause        → +1 level
  Metadata confirms hypothesis            → +1 level
  Metadata identifies specific cause      → root cause sharpens
  Log signal contradicts metric           → -1 level
  No baseline yet (< 100 samples)         → LOW regardless

Maximum: HIGH. Minimum: LOW.
LLM explanation quality improves with each layer present.
```

### Elasticsearch Phase 1 analyzers

| # | Name | Primary metrics | Phase | Status |
|---|------|----------------|-------|--------|
| 1 | jvm_heap_pressure | jvm.heap.used.percent, gc.old.collection.seconds | 1 | Built ✓ |
| 2 | shard_allocation_failure | cluster.shards.unassigned, cluster.health.status | 1 | Not built |
| 3 | thread_pool_saturation | thread_pool.write.rejected, thread_pool.write.queue | 1 | Not built |
| 4 | shard_imbalance | node.shard.count, node.disk.used.percent | 2 | Not built |
| 5 | search_latency_degradation | search.query.time.ms, search.query.total | 2 | Not built |
| 6 | disk_watermark_pressure | fs.total.available.bytes, fs.total.total.bytes | 2 | Not built |
| 7 | ilm_policy_stall | ilm.indices.managed, index.age.hours | 3 | Not built |
| 8 | indexing_throughput_collapse | indices.indexing.index.total | 3 | Not built |

---

## 12. Full data model

### All tables

```sql
-- Tenant isolation anchor
tenants (
    id           UUID PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
)

-- Internal stack (never exposed to customer)
stacks (
    id                    UUID PRIMARY KEY,
    tenant_id             UUID NOT NULL REFERENCES tenants(id),
    db_type               VARCHAR(32) NOT NULL,
    source_type           VARCHAR(32) NOT NULL,
    display_name          VARCHAR(255),
    api_endpoint          TEXT NOT NULL,
    api_key_ref           TEXT NOT NULL,
    cluster_label_key     VARCHAR(128),
    has_metrics_adapter   BOOLEAN DEFAULT true,
    has_log_adapter       BOOLEAN DEFAULT false,
    has_metadata_adapter  BOOLEAN DEFAULT false,
    is_active             BOOLEAN DEFAULT true,
    last_successful_pull  TIMESTAMPTZ,
    created_at            TIMESTAMPTZ DEFAULT NOW()
)

-- Cluster registry (what the customer sees)
clusters (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),
    stack_id                    UUID NOT NULL REFERENCES stacks(id),
    cluster_id                  VARCHAR(255) NOT NULL, -- source label value
    db_type                     VARCHAR(32) NOT NULL,
    display_name                VARCHAR(255) NOT NULL,
    current_status              VARCHAR(32) DEFAULT 'unknown',
    last_metric_received_at     TIMESTAMPTZ,
    expected_metric_interval_s  INTEGER DEFAULT 60,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(stack_id, cluster_id)
)

-- Metric name normalisation (product team maintains this)
normalisation_map (
    id               UUID PRIMARY KEY,
    source_type      VARCHAR(32) NOT NULL,
    db_type          VARCHAR(32) NOT NULL,
    raw_metric_name  TEXT NOT NULL,
    canonical_name   VARCHAR(255) NOT NULL,
    category         VARCHAR(64) NOT NULL,
    unit             VARCHAR(32) NOT NULL,
    is_active        BOOLEAN DEFAULT true,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_type, db_type, raw_metric_name)
)

-- Metrics seen per cluster (auto-populated from ingestion)
cluster_metric_registry (
    id                  UUID PRIMARY KEY,
    cluster_id          UUID NOT NULL REFERENCES clusters(id),
    source_type         VARCHAR(32) NOT NULL,
    raw_metric_name     TEXT NOT NULL,
    canonical_name      VARCHAR(255),   -- null if unmapped
    category            VARCHAR(64),
    unit                VARCHAR(32),
    is_active           BOOLEAN DEFAULT true,
    first_seen_at       TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cluster_id, raw_metric_name)
)

-- Metrics that could not be normalised (product team feedback loop)
unmapped_metrics (
    id               UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    stack_id         UUID NOT NULL REFERENCES stacks(id),
    source_type      VARCHAR(32) NOT NULL,
    db_type          VARCHAR(32) NOT NULL,
    raw_metric_name  TEXT NOT NULL,
    sample_value     FLOAT,
    first_seen_at    TIMESTAMPTZ DEFAULT NOW(),
    occurrence_count INTEGER DEFAULT 1,
    status           VARCHAR(32) DEFAULT 'new',
    canonical_name   TEXT,
    resolved_at      TIMESTAMPTZ,
    resolved_by      TEXT
)

-- Computed capability per cluster per analyzer
analyzer_capability_map (
    id                  UUID PRIMARY KEY,
    cluster_id          UUID NOT NULL REFERENCES clusters(id),
    analyzer_name       VARCHAR(128) NOT NULL,
    runnable_status     VARCHAR(32) NOT NULL, -- runnable|reduced|blocked
    confidence_ceiling  VARCHAR(16) NOT NULL,
    missing_primary     TEXT,   -- JSON list of missing primary metrics
    missing_corroborating TEXT, -- JSON list of missing corroborating metrics
    missing_log_signals TEXT,   -- JSON list
    evaluated_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cluster_id, analyzer_name)
)

-- Baseline profiles (nightly computation)
baseline_profiles (
    id                    UUID PRIMARY KEY,
    cluster_id            UUID NOT NULL REFERENCES clusters(id),
    canonical_metric_name VARCHAR(255) NOT NULL,
    window_type           VARCHAR(32) NOT NULL,
    -- window_type: all | weekday | weekend | business_hours | off_hours
    p50                   FLOAT NOT NULL,
    p75                   FLOAT NOT NULL,
    p95                   FLOAT NOT NULL,
    p99                   FLOAT NOT NULL,
    mean                  FLOAT NOT NULL,
    std_dev               FLOAT NOT NULL,
    sample_count          INTEGER NOT NULL,
    computed_at           TIMESTAMPTZ DEFAULT NOW(),
    covers_from           TIMESTAMPTZ,
    covers_to             TIMESTAMPTZ,
    UNIQUE(cluster_id, canonical_metric_name, window_type)
)

-- Verdicts (append-only — never UPDATE)
verdicts (
    id                   UUID PRIMARY KEY,
    cluster_id           UUID NOT NULL REFERENCES clusters(id),
    analyzer_name        VARCHAR(128) NOT NULL,
    status               VARCHAR(32) NOT NULL, -- healthy|degraded|critical
    prev_status          VARCHAR(32),
    observed             TEXT NOT NULL,
    baseline_summary     TEXT NOT NULL,
    root_cause           TEXT NOT NULL,
    recommendation       TEXT NOT NULL,
    confidence           VARCHAR(16) NOT NULL,
    data_sources_used    TEXT NOT NULL, -- JSON: ["metrics","log_signals","metadata"]
    metric_ts            TIMESTAMPTZ NOT NULL, -- when source DB produced the data
    ingested_at          TIMESTAMPTZ NOT NULL, -- when we received it from source
    run_at               TIMESTAMPTZ NOT NULL, -- when analyzer ran
    data_freshness       VARCHAR(32) NOT NULL, -- fresh|delayed|gap|pending
    lag_seconds          INTEGER
)

-- Evidence items per verdict
verdict_evidence (
    id               UUID PRIMARY KEY,
    verdict_id       UUID NOT NULL REFERENCES verdicts(id),
    evidence_text    TEXT NOT NULL,
    source_type      VARCHAR(32) NOT NULL, -- metric|log_signal|metadata
    confidence_delta INTEGER DEFAULT 0     -- +1 | 0 | -1
)

-- LLM explanations (generated on status change only)
llm_explanations (
    id              UUID PRIMARY KEY,
    verdict_id      UUID NOT NULL REFERENCES verdicts(id) UNIQUE,
    explanation     TEXT NOT NULL,
    model_version   VARCHAR(64) NOT NULL,
    trigger_reason  VARCHAR(255),
    generated_at    TIMESTAMPTZ DEFAULT NOW(),
    input_tokens    INTEGER,
    output_tokens   INTEGER
)

-- Onboarding state tracking
onboarding_sessions (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    stack_id        UUID,
    state           VARCHAR(32) NOT NULL,
    error_message   TEXT,
    clusters_found  INTEGER,
    clusters_ready  INTEGER,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
)
```

---

## 13. Source adapters

### Adapter interface (both source types implement this)

```python
class BaseMetricsAdapter(ABC):

    @abstractmethod
    async def test_connection(self) -> ConnectionResult:
        """Test API credentials. Return success or specific error."""

    @abstractmethod
    async def discover_clusters(self) -> list[DiscoveredCluster]:
        """
        Find all clusters visible through this connection.
        Each cluster includes: cluster_id, raw metric names found,
        which are mapped, which are unmapped.
        """

    @abstractmethod
    async def get_metrics(
        self,
        cluster_id: str,
        canonical_names: list[str],
        start: datetime,
        end: datetime,
        step_seconds: int = 60,
    ) -> list[CanonicalMetric]:
        """Fetch metric time series. Returns canonical metrics only."""

    @abstractmethod
    async def get_latest_metrics(
        self,
        cluster_id: str,
        canonical_names: list[str],
    ) -> dict[str, float]:
        """Fetch most recent value per metric."""
```

### Grafana Cloud adapter specifics

- API: Prometheus-compatible (`/api/v1/query`, `/api/v1/query_range`)
- Auth: Bearer token via Authorization header
- Query language: PromQL
- Cluster identity: label value (configurable per stack)
- Metric format: `{__name__="metric_name", cluster="cluster_id"}`
- Rate limiting: Respect 429 with exponential backoff

### Datadog adapter specifics

- API: Datadog Metrics API v1/v2
- Auth: `DD-API-KEY` + `DD-APPLICATION-KEY` headers
- Query language: Datadog query syntax (`avg:metric.name{cluster:id}`)
- Cluster identity: tag value (configurable per stack)
- Metric format: dot-separated names, tags not labels
- Note: Datadog naming conventions differ fundamentally from
  Prometheus — separate normalisation map required

### Error handling (both adapters)

```
HTTP 401 → AdapterAuthError       "Check API key"
HTTP 403 → AdapterPermissionError "Key lacks read permissions"
HTTP 429 → Retry with backoff     Max 3 retries
HTTP 404 → AdapterNotFoundError   "Endpoint not found"
Timeout  → AdapterTimeoutError    "Connection timed out"
No data  → AdapterNoDataError     "No metrics found for cluster"
```

---

## 14. Verdict writer

The verdict writer is the bridge between the intelligence layer
and the storage layer.

### Responsibilities

1. Receive `VerdictResult` from analyzer runner
2. Fetch previous verdict for this cluster + analyzer
3. Detect status change
4. Write new verdict to `verdicts` table (always INSERT, never UPDATE)
5. Write evidence items to `verdict_evidence`
6. If status changed: call LLM, store in `llm_explanations`
7. Update `clusters.current_status` to worst across all analyzers

### Status change detection

```python
# Status changed if:
new_status != prev_status
# OR
prev_status is None  # first ever verdict for this cluster+analyzer
```

### LLM prompt structure

The LLM receives the structured verdict — never raw metrics:

```
You are explaining a database health verdict to an engineer.
Be specific, practical, and concise.

Cluster: {cluster_id} ({db_type}, {environment})
Analyzer: {analyzer_name}
Status changed: {prev_status} → {new_status}

What was observed:
{observed}

Normal baseline for this cluster:
{baseline_summary}

Root cause determined:
{root_cause}

Evidence:
{evidence_items}

Recommendation:
{recommendation}

Write a clear explanation (3-5 sentences) that:
1. States what happened in plain English
2. Explains why it matters for this specific cluster
3. Confirms the recommended action
Do not use jargon. Do not hedge. Be direct.
```

### Freshness computation

```python
def compute_freshness(metric_ts, run_at):
    lag = (run_at - metric_ts).total_seconds()
    if lag < 120:    return "fresh"
    if lag < 600:    return "delayed"
    return "gap"
# "pending" set externally when analyzer is queued but not run yet
```

---

## 15. Prototype build sequence

Follow this order exactly. Do not skip steps. Do not work ahead.

---

### STEP 1 — Run discovery (no code)

**Before writing any code**, run the discovery queries against
the real Grafana Cloud instance using credentials from `backend/.env`.

Commands to run:

```bash
# List all Elasticsearch metric names
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/v1/label/__name__/values" \
  | jq '.data[]' | grep -E "elastic|es_"

# Inspect labels on one metric (replace metric_name)
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/v1/series?match[]={__name__=\"metric_name\"}&start=$(date -d '1 hour ago' +%s)&end=$(date +%s)"

# Verify 30-day data volume
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/v1/query_range?query=metric_name&start=$(date -d '30 days ago' +%s)&end=$(date +%s)&step=60s"
```

Write findings to:
`backend/app/adapters/grafana_cloud/DISCOVERY_NOTES.md`

Include:
- Every ES metric name found
- Which label key = cluster identifier
- Sample label values (cluster names)
- Data point count for 30 days
- Any metric names that could not be found

**Done when:** DISCOVERY_NOTES.md exists with real data.
**Update STATUS.md when complete.**

---

### STEP 2 — Database schema and migrations

Create the full schema from Section 11.

Files to create:
```
backend/app/models/models.py     (update — add tenants, stacks tables)
backend/migrations/versions/     (generate migration with alembic)
```

Run migrations:
```bash
cd backend
alembic revision --autogenerate -m "add_tenants_stacks_normalisation"
alembic upgrade head
```

Seed normalisation map from DISCOVERY_NOTES.md findings:
```bash
python scripts/seed_normalisation.py
```

**Done when:** All tables exist. `alembic current` shows head.
Normalisation map has entries for all metrics found in discovery.
**Update STATUS.md when complete.**

---

### STEP 3 — Adapter interface and configuration

Files to create:
```
backend/app/adapters/__init__.py
backend/app/adapters/base.py           (BaseMetricsAdapter interface)
backend/app/adapters/exceptions.py     (AdapterAuthError etc.)
backend/app/adapters/grafana_cloud/
    __init__.py
    adapter.py                         (GrafanaCloudAdapter)
    normalisation.py                   (loads from DB, not hardcoded)
    DISCOVERY_NOTES.md                 (filled in Step 1)
```

Update:
```
backend/app/core/config.py     (add Grafana + Datadog + runner settings)
backend/.env.example           (document new env vars)
```

New env vars needed:
```
GRAFANA_CLOUD_PROMETHEUS_URL=
GRAFANA_CLOUD_API_KEY=
GRAFANA_CLOUD_CLUSTER_LABEL=cluster
DATADOG_API_KEY=
DATADOG_APP_KEY=
DATADOG_SITE=datadoghq.com
ANALYZER_RUN_INTERVAL_SECONDS=300
BASELINE_LOOKBACK_DAYS=30
BASELINE_MIN_SAMPLES=100
NORMALISATION_CACHE_TTL_SECONDS=300
```

**Done when:** GrafanaCloudAdapter imports cleanly. Unit tests
pass for connection test, cluster discovery, metric fetching.
**Update STATUS.md when complete.**

---

### STEP 4 — Baseline seeder

File to create:
```
backend/app/baseline/seeder.py
```

`seed_baseline_for_cluster(cluster_id, adapter, db)`:
- Pull 30 days via adapter
- Compute baselines for all window types
- Upsert into baseline_profiles
- Log warnings for metrics with < 100 samples
- Return seeding summary

**Done when:** Running seeder against real cluster produces
baseline rows with valid p50 < p75 < p95 < p99 values.
**Update STATUS.md when complete.**

---

### STEP 5 — Analyzer runner

File to create:
```
backend/app/runner/__init__.py
backend/app/runner/analyzer_runner.py
```

`run_cycle(adapter, db)`:
- Get all active clusters for this adapter's stack
- Seed baseline if this is the first run
- Check capability map
- Fetch latest metrics
- Run capable analyzers
- Call verdict writer

`start_runner(adapter)`:
- Run cycle on startup
- Repeat every ANALYZER_RUN_INTERVAL_SECONDS
- Catch exceptions per-cluster — one failure cannot crash others

Register as FastAPI lifespan task in `backend/app/main.py`.

**Done when:** `run_cycle()` completes against real Grafana Cloud.
At least one verdict in the verdicts table.
**Update STATUS.md when complete.**

---

### STEP 6 — Verdict writer

File to create:
```
backend/app/runner/verdict_writer.py
```

Implement as specified in Section 13.

Tests to write:
```
backend/tests/test_runner/test_verdict_writer.py
```

- Verify append-only (no UPDATE ever)
- Verify LLM called on status change only
- Verify LLM NOT called on same status
- Verify LLM failure does not block verdict write

**Done when:** All verdict writer tests pass. Status change
triggers LLM explanation in llm_explanations table.
**Update STATUS.md when complete.**

---

### STEP 7 — Shard allocation failure analyzer

File to create:
```
backend/app/analyzers/elasticsearch/shard_allocation_failure.py
backend/tests/test_analyzers/test_shard_allocation_failure.py
```

Follow the same pattern as `jvm_heap_pressure.py`.
Minimum 15 tests covering healthy, degraded, critical states
and confidence level combinations.

**Done when:** All tests pass. Analyzer produces correct verdicts
against known incident data.
**Update STATUS.md when complete.**

---

### STEP 8 — Thread pool saturation analyzer

File to create:
```
backend/app/analyzers/elasticsearch/thread_pool_saturation.py
backend/tests/test_analyzers/test_thread_pool_saturation.py
```

Minimum 15 tests.

**Done when:** All tests pass.
**Update STATUS.md when complete.**

---

### STEP 9 — Frontend API client

File to create:
```
src/services/api.ts
```

Functions needed:
```typescript
getClusters(): Promise<ClusterResponse[]>
getCluster(id: string): Promise<ClusterResponse>
getVerdicts(clusterId: string): Promise<VerdictResponse[]>
getBaselines(clusterId: string): Promise<BaselineResponse[]>
```

Update these components to use real API (remove mock data):
```
src/pages/OverviewPage.tsx
src/pages/DatabaseDetailPage.tsx
src/components/layout/CommandPalette.tsx
```

Add loading states and error states to all.

**Done when:** `npm run build` passes. Overview page shows real
cluster names and health statuses from real verdicts.
**Update STATUS.md when complete.**

---

### STEP 10 — Internal admin views

Files to create:
```
src/pages/admin/UnmappedMetricsPage.tsx
src/pages/admin/NormalisationMapPage.tsx
```

These are internal only — not customer-facing. Protected by
admin role check. Allow product team to:
- Review unmapped_metrics table
- Map raw metric names to canonical names
- See occurrence counts across customers

**Done when:** Product team can review and resolve unmapped
metrics through the UI without touching the database directly.
**Update STATUS.md when complete.**

---

### STEP 11 — End-to-end integration test

Work through every check:

```bash
# 1. Start stack
docker compose up

# 2. Health check
curl http://localhost:8000/health

# 3. Verify runner started
docker compose logs backend | grep "Analyzer runner"

# 4. Verify clusters
curl http://localhost:8000/clusters/

# 5. Verify verdicts
curl http://localhost:8000/verdicts/cluster/<id>

# 6. Verify baselines
curl http://localhost:8000/baselines/cluster/<id>

# 7. Verify frontend
open http://localhost:5173
# Confirm real cluster names visible

# 8. Verify LLM
# Check llm_explanations table has at least one row

# 9. Run full test suite
cd backend && python -m pytest tests/ -v
```

**Done when:** All checks pass. Full test suite green.
**Update STATUS.md with PHASE COMPLETE.**

---

## 16. What is out of scope for this plan

Do not build these. They have separate planning documents.

- Log signal extraction or ingestion
- Metadata agent or enrichment
- Prometheus remote_write push path
- MySQL adapter or analyzers
- Multi-tenant auth (Auth0/SAML)
- Customer-facing onboarding wizard UI (assisted onboarding for first customers)
- Notifications or alerting on status change
- Billing intelligence
- Postmortem report generation

---

## 17. Known risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| ES metric names in Grafana Cloud don't match expected variants | Medium | Step 1 discovery resolves before any code written |
| Datadog naming conventions require significant normalisation work | High | Separate Datadog adapter — does not block Grafana Cloud path |
| 30-day baseline seed too slow for clusters with many metrics | Medium | Seed one cluster at a time, async, API stays available |
| Grafana Cloud rate limits during baseline seeding | Medium | Respect 429, exponential backoff, seed off-peak |
| LLM explanation quality poor for first version | Medium | Iterate on prompt in verdict_writer.py before shipping |
| Duplicate cluster IDs from multiple exporters on same cluster | High | Deduplication logic in adapter.get_clusters() |

---

## 18. File map — complete list

### New files this plan creates

```
backend/app/adapters/__init__.py
backend/app/adapters/base.py
backend/app/adapters/exceptions.py
backend/app/adapters/grafana_cloud/__init__.py
backend/app/adapters/grafana_cloud/adapter.py
backend/app/adapters/grafana_cloud/normalisation.py
backend/app/adapters/grafana_cloud/DISCOVERY_NOTES.md
backend/app/adapters/datadog/__init__.py
backend/app/adapters/datadog/adapter.py
backend/app/adapters/datadog/normalisation.py
backend/app/baseline/seeder.py
backend/app/runner/__init__.py
backend/app/runner/analyzer_runner.py
backend/app/runner/verdict_writer.py
backend/app/analyzers/elasticsearch/shard_allocation_failure.py
backend/app/analyzers/elasticsearch/thread_pool_saturation.py
backend/scripts/seed_normalisation.py
backend/tests/test_adapters/__init__.py
backend/tests/test_adapters/test_grafana_cloud.py
backend/tests/test_runner/__init__.py
backend/tests/test_runner/test_verdict_writer.py
backend/tests/test_analyzers/test_shard_allocation_failure.py
backend/tests/test_analyzers/test_thread_pool_saturation.py
src/services/api.ts
src/pages/admin/UnmappedMetricsPage.tsx
src/pages/admin/NormalisationMapPage.tsx
_specs/STATUS.md                        ← session persistence file
```

### Modified files

```
backend/app/models/models.py       (add tenants, stacks, normalisation_map,
                                    unmapped_metrics, onboarding_sessions)
backend/app/core/config.py         (add adapter + runner settings)
backend/app/main.py                (register runner as lifespan task)
backend/.env.example               (document all new env vars)
src/pages/OverviewPage.tsx         (use API client)
src/pages/DatabaseDetailPage.tsx   (use API client)
src/components/layout/CommandPalette.tsx (use API client)
```

### Do not touch

```
backend/app/analyzers/elasticsearch/jvm_heap_pressure.py
backend/app/analyzers/base.py
backend/app/baseline/engine.py
backend/app/schemas/schemas.py
```

---

*DB Intelligence Platform — Master Planning Document v1.0 — April 2026*
*Feed this document to Claude Code before every session.*
*Always read _specs/STATUS.md first.*
