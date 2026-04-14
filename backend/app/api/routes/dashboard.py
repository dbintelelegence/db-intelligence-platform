"""
Dashboard summary endpoint.

Returns exactly the shape the frontend OverviewPage and IssuesPage need:
  - clusters: Database[] — one entry per cluster with health status + verdict summary
  - issues:   Issue[]   — one entry per non-healthy verdict

Frontend vocabulary mapping:
  Backend status   → Frontend healthStatus
  healthy          → good
  degraded         → warning
  critical         → critical
  unknown          → unknown

  Frontend also has "excellent" — used when healthy AND all baselines show
  metrics well below their p50. We emit "good" only for now; excellent is
  reserved for future metric quality scoring.

Layer 3 (stacks, adapters) is never exposed. The frontend sees only:
  cluster name, db type, region, status, issues.
"""

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.adapters.grafana_cloud.adapter import GrafanaCloudAdapter
from app.core.config import get_settings
from app.db.session import get_db
from app.models.models import Cluster, Stack, Tenant, Verdict, HealthStatus

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()

# ── Status vocabulary translation ────────────────────────────────────────────

_STATUS_MAP = {
    "healthy":  "good",
    "degraded": "warning",
    "critical": "critical",
    "unknown":  "unknown",
}

_SEVERITY_MAP = {
    "critical": "critical",
    "degraded": "warning",
    "healthy":  "info",
    "unknown":  "info",
}

_CATEGORY_MAP = {
    "jvm_heap_pressure":                  "performance",
    "shard_allocation_failure":           "availability",
    "thread_pool_saturation":             "performance",
    "mysql_connection_pool_saturation":   "availability",
    "mysql_replication_lag":              "replication",
    "mysql_innodb_buffer_pool_pressure":  "performance",
}


def _cluster_to_database(
    cluster: Cluster,
    latest_verdicts: list[Verdict],
    live_metrics: dict[str, float],
) -> dict[str, Any]:
    """
    Map a Cluster ORM row + latest verdicts + live Grafana metrics → frontend Database shape.
    """
    raw_status = cluster.current_status.value if cluster.current_status else "unknown"
    health_status = _STATUS_MAP.get(raw_status, "unknown")

    score_map = {"healthy": 85, "degraded": 45, "critical": 10, "unknown": 50}
    health_score = score_map.get(raw_status, 50)

    active_issues = sum(
        1 for v in latest_verdicts
        if v.status.value in ("degraded", "critical")
    )

    region = cluster.region or "us-east1"
    cloud = "gcp"

    db_type_map = {
        "elasticsearch": "elasticsearch",
        "mysql": "mysql",
        "mongodb": "mongodb",
        "cassandra": "cassandra",
        "postgres": "postgres",
    }
    db_type = db_type_map.get(cluster.db_type.value, "elasticsearch")

    # ── Build metrics from live Grafana values ────────────────────────────────

    if cluster.db_type.value == "mysql":
        # MySQL-specific metrics
        connection_pct = live_metrics.get("mysql.connection.pct", 0.0)
        cpu_pct = live_metrics.get("mysql.os.cpu.percent", 0.0)
        disk_total = live_metrics.get("mysql.disk.total.bytes", 0.0)
        disk_avail = live_metrics.get("mysql.disk.available.bytes", 0.0)
        storage_pct = ((disk_total - disk_avail) / disk_total * 100.0) if disk_total > 0 else 0.0
        replication_lag = live_metrics.get("mysql.replication.lag.seconds", 0.0)
        buffer_pool_pct = live_metrics.get("mysql.buffer.pool.pressure.pct", 0.0)

        metrics = {
            "cpu":            round(cpu_pct, 1),
            "memory":         round(buffer_pool_pct, 1),  # buffer pool pressure as memory proxy
            "storage":        round(storage_pct, 1),
            "connections":    round(connection_pct, 1),   # connection pool % used
            "maxConnections": 100,                        # represents 100% scale
            "latency":        round(replication_lag * 1000, 1),  # lag in ms as latency proxy
            "throughput":     0,
        }
    else:
        # Elasticsearch metrics
        jvm_heap_pct = live_metrics.get("jvm.heap.used.percent", 0.0)
        cpu_pct = live_metrics.get("os.cpu.percent", 0.0)
        fs_total = live_metrics.get("fs.total.total.bytes", 0.0)
        fs_avail = live_metrics.get("fs.total.available.bytes", 0.0)
        storage_pct = ((fs_total - fs_avail) / fs_total * 100.0) if fs_total > 0 else 0.0

        # Search latency: avg ms per query = query_time_seconds / query_total * 1000
        search_time_s = live_metrics.get("search.query.time.ms", 0.0)
        search_total = live_metrics.get("search.query.total", 0.0)
        latency_ms = (search_time_s / search_total * 1000.0) if search_total > 0 else 0.0
        throughput = search_total / 3600.0

        metrics = {
            "cpu":            round(cpu_pct, 1),
            "memory":         round(jvm_heap_pct, 1),
            "storage":        round(storage_pct, 1),
            "connections":    0,
            "maxConnections": 100,
            "latency":        round(latency_ms, 1),
            "throughput":     round(throughput, 1),
        }

    # Verdict age — how long ago the most recent analyzer run completed.
    # None if no verdicts exist yet (cluster was never analyzed).
    last_run_at = latest_verdicts[0].run_at if latest_verdicts else None
    now_utc = datetime.now(timezone.utc)
    verdict_age_seconds = int((now_utc - last_run_at).total_seconds()) if last_run_at else None

    # Stale if last run was more than 30 minutes ago — analyzer may not be running
    is_stale = verdict_age_seconds is not None and verdict_age_seconds > 1800

    return {
        "id": str(cluster.id),             # UUID — safe for use as URL route param
        "name": cluster.display_name,
        "type": db_type,
        "cloud": cloud,
        "region": region,
        "environment": "staging",
        "healthScore": health_score,
        "healthStatus": health_status,
        "healthTrend": "stable",
        "metrics": metrics,
        "typeSpecificMetrics": {},
        "activeIssues": active_issues,
        "recentChanges": 0,
        "monthlyCost": 0,
        "costTrend": "stable",
        "createdAt": cluster.created_at.isoformat() if cluster.created_at else now_utc.isoformat(),
        "lastChecked": last_run_at.isoformat() if last_run_at else None,
        "verdictAgeSeconds": verdict_age_seconds,
        "isStale": is_stale,
        "tags": {},
    }


def _verdict_to_issue(verdict: Verdict, cluster: Cluster) -> dict[str, Any]:
    """
    Map a non-healthy Verdict → frontend Issue shape.
    """
    severity = _SEVERITY_MAP.get(verdict.status.value, "warning")
    category = _CATEGORY_MAP.get(verdict.analyzer_name, "performance")

    # Use LLM explanation as the long-form explanation if available
    explanation = verdict.root_cause
    if verdict.llm_explanation:
        explanation = verdict.llm_explanation.explanation_text

    # Build relatedMetrics from evidence items
    related_metrics = [
        ev.evidence_text.split("=")[0].strip()
        for ev in (verdict.evidence or [])
        if ev.source_type == "metric"
    ]

    return {
        "id": str(verdict.id),
        "databaseId": str(cluster.id),
        "databaseName": cluster.display_name,
        "instanceId": verdict.instance_id,
        "severity": severity,
        "category": category,
        "status": "active",
        "title": _analyzer_title(verdict.analyzer_name, verdict.status.value, verdict.instance_id),
        "description": verdict.observed,
        "explanation": explanation,
        "recommendation": verdict.recommendation,
        "detectedAt": verdict.run_at.isoformat(),
        "firstSeen": verdict.run_at.isoformat(),
        "lastSeen": verdict.run_at.isoformat(),
        "occurrences": 1,
        "relatedMetrics": related_metrics,
        "relatedLogs": [],
        "relatedChanges": [],
        "affectedServices": [],
    }


def _analyzer_title(analyzer_name: str, status: str, instance_id: str | None = None) -> str:
    titles = {
        "jvm_heap_pressure": {
            "critical": "JVM heap exhaustion — GC unable to reclaim memory",
            "degraded": "JVM heap pressure elevated above baseline",
        },
        "shard_allocation_failure": {
            "critical": "Unassigned shards — cluster data at risk",
            "degraded": "Shard allocation degraded — cluster not fully green",
        },
        "thread_pool_saturation": {
            "critical": "Write thread pool saturated — indexing rejections active",
            "degraded": "Write thread pool approaching saturation",
        },
        "mysql_connection_pool_saturation": {
            "critical": "Connection pool exhausted — new connections being refused",
            "degraded": "Connection pool elevated above baseline",
        },
        "mysql_replication_lag": {
            "critical": "Replication thread stopped or lag critically high",
            "degraded": "Replication lag elevated above baseline",
        },
        "mysql_innodb_buffer_pool_pressure": {
            "critical": "InnoDB buffer pool consuming critical share of available RAM",
            "degraded": "InnoDB buffer pool pressure elevated above baseline",
        },
    }
    title = titles.get(analyzer_name, {}).get(status, f"{analyzer_name} — {status}")
    if instance_id:
        title = f"{title} ({instance_id})"
    return title


# ── Endpoint ──────────────────────────────────────────────────────────────────

# Metrics to fetch live from Grafana per db_type
_ES_LIVE_METRICS = [
    "jvm.heap.used.percent",      # derived
    "os.cpu.percent",             # cpu % used (custom PromQL via rate on node_cpu_seconds_total)
    "fs.total.total.bytes",       # storage total (/liveperson mountpoint)
    "fs.total.available.bytes",   # storage available (/liveperson mountpoint)
    "search.query.time.ms",       # latency numerator (seconds, converted to ms in code)
    "search.query.total",         # latency denominator + throughput
]

_MYSQL_LIVE_METRICS = [
    "mysql.connection.pct",           # CUSTOM_QUERY: threads_connected/max_connections*100
    "mysql.os.cpu.percent",           # CUSTOM_QUERY: node_cpu idle rate
    "mysql.disk.total.bytes",         # node_exporter: root mountpoint
    "mysql.disk.available.bytes",     # node_exporter: root mountpoint
    "mysql.replication.lag.seconds",  # CUSTOM_QUERY: max across channels
    "mysql.buffer.pool.pressure.pct", # CUSTOM_QUERY: buffer_pool/mem_total*100
    "mysql.buffer.pool.bytes",        # raw buffer pool size
    "mysql.memory.total.bytes",       # node_exporter: total host RAM
]


async def _resolve_tenant_id(db: AsyncSession, x_tenant_id: str | None) -> uuid.UUID | None:
    """
    Resolve the tenant UUID from the X-Tenant-ID header.
    Falls back to the single prototype tenant when no header is provided,
    so existing single-tenant deployments work without any header.
    Returns None only when an explicit header is provided but not found.
    """
    if x_tenant_id:
        try:
            return uuid.UUID(x_tenant_id)
        except ValueError:
            return None

    # Fallback: use the first (prototype) tenant
    row = (await db.execute(select(Tenant).limit(1))).scalar_one_or_none()
    return row.id if row else None


@router.get("/summary")
async def dashboard_summary(
    db: AsyncSession = Depends(get_db),
    x_tenant_id: str | None = Header(default=None),
) -> dict[str, Any]:
    """
    Single endpoint for the dashboard. Returns:
      - clusters: Database[] shaped for the frontend with live Grafana metrics
      - issues:   Issue[] shaped for the frontend (non-healthy verdicts only)

    Tenant isolation: clusters are scoped to the tenant resolved from
    X-Tenant-ID header. Falls back to the prototype tenant when not provided.
    """
    tenant_id = await _resolve_tenant_id(db, x_tenant_id)
    if tenant_id is None:
        return {"clusters": [], "issues": []}

    # Load clusters scoped to this tenant via stack_id → stacks.tenant_id
    cluster_stmt = (
        select(Cluster)
        .join(Stack, Cluster.stack_id == Stack.id)
        .where(Stack.tenant_id == tenant_id)
        .order_by(Cluster.current_status, Cluster.display_name)
    )
    clusters = (await db.execute(cluster_stmt)).scalars().all()

    if not clusters:
        return {"clusters": [], "issues": []}

    all_cluster_uuids = [c.id for c in clusters]

    # Latest verdict per (analyzer, instance) per cluster.
    # instance_id is None for cluster-level verdicts and a hostname string for per-instance ones.
    #
    # Migration guard: when an analyzer transitions from cluster-level (instance_id=NULL) to
    # per-instance verdicts, old NULL rows linger in the DB. Suppress cluster-level (NULL)
    # verdicts for any analyzer that already has per-instance verdicts in the same cluster.
    # This prevents stale cluster-level verdicts from showing alongside correct per-instance ones.
    latest_subq = (
        select(
            Verdict.cluster_id,
            Verdict.analyzer_name,
            Verdict.instance_id,
            func.max(Verdict.run_at).label("max_run_at"),
        )
        .where(Verdict.cluster_id.in_(all_cluster_uuids))
        .group_by(Verdict.cluster_id, Verdict.analyzer_name, Verdict.instance_id)
        .subquery()
    )

    # Sub-select: which (cluster_id, analyzer_name) pairs have any per-instance verdicts?
    has_instance_subq = (
        select(
            Verdict.cluster_id,
            Verdict.analyzer_name,
        )
        .where(
            Verdict.cluster_id.in_(all_cluster_uuids),
            Verdict.instance_id.is_not(None),
        )
        .distinct()
        .subquery()
    )

    verdict_stmt = (
        select(Verdict)
        .join(
            latest_subq,
            and_(
                Verdict.cluster_id == latest_subq.c.cluster_id,
                Verdict.analyzer_name == latest_subq.c.analyzer_name,
                # NULL-safe comparison required — plain == fails when both sides are NULL.
                Verdict.instance_id.is_not_distinct_from(latest_subq.c.instance_id),
                Verdict.run_at == latest_subq.c.max_run_at,
            ),
        )
        # Exclude stale cluster-level (NULL instance_id) verdicts when per-instance ones exist
        .outerjoin(
            has_instance_subq,
            and_(
                Verdict.cluster_id == has_instance_subq.c.cluster_id,
                Verdict.analyzer_name == has_instance_subq.c.analyzer_name,
            ),
        )
        .where(
            # Keep verdict if: it has a real instance_id, OR no per-instance verdicts exist for this analyzer
            (Verdict.instance_id.is_not(None)) | (has_instance_subq.c.cluster_id.is_(None))
        )
        .options(
            selectinload(Verdict.evidence),
            selectinload(Verdict.llm_explanation),
        )
    )
    all_verdicts = (await db.execute(verdict_stmt)).scalars().all()

    verdicts_by_cluster: dict[uuid.UUID, list[Verdict]] = {}
    for v in all_verdicts:
        verdicts_by_cluster.setdefault(v.cluster_id, []).append(v)

    # Build one adapter per db_type — different role label and normalisation map
    from app.models.models import DbType as _DbType
    es_adapter = GrafanaCloudAdapter(
        prometheus_url=settings.grafana_gcp_prod_url,
        instance_id=settings.grafana_gcp_prod_instance_id,
        api_key=settings.grafana_gcp_prod_api_key,
        db=db,
        db_type=_DbType.elasticsearch,
    )
    mysql_adapter = GrafanaCloudAdapter(
        prometheus_url=settings.grafana_gcp_prod_url,
        instance_id=settings.grafana_gcp_prod_instance_id,
        api_key=settings.grafana_gcp_prod_api_key,
        db=db,
        db_type=_DbType.mysql,
    )

    live_metrics_by_cluster: dict[str, dict[str, float]] = {}
    for cluster in clusters:
        adapter = mysql_adapter if cluster.db_type == _DbType.mysql else es_adapter
        live_metrics_list = _MYSQL_LIVE_METRICS if cluster.db_type == _DbType.mysql else _ES_LIVE_METRICS
        try:
            metrics = await adapter.get_latest_metrics(
                cluster_id=cluster.cluster_id,
                canonical_names=live_metrics_list,
            )
            live_metrics_by_cluster[cluster.cluster_id] = metrics
        except Exception as e:
            logger.warning(f"Failed to fetch live metrics for {cluster.cluster_id}: {e}")
            live_metrics_by_cluster[cluster.cluster_id] = {}

    # Build response
    databases_out = []
    issues_out = []

    for cluster in clusters:
        cluster_verdicts = verdicts_by_cluster.get(cluster.id, [])
        live = live_metrics_by_cluster.get(cluster.cluster_id, {})
        databases_out.append(_cluster_to_database(cluster, cluster_verdicts, live))

        for verdict in cluster_verdicts:
            if verdict.status.value in ("degraded", "critical"):
                issues_out.append(_verdict_to_issue(verdict, cluster))

    issues_out.sort(key=lambda i: 0 if i["severity"] == "critical" else 1)

    return {"clusters": databases_out, "issues": issues_out}
