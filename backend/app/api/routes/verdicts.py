import re
import uuid
from datetime import datetime, timezone, timedelta
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, and_
from sqlalchemy.orm import selectinload
from app.db.session import get_db
from app.models.models import Verdict, Cluster, Stack, Tenant
from app.schemas.schemas import VerdictResponse
from app.baseline.engine import get_baseline

router = APIRouter()

# Primary metric per analyzer — drives which evidence value is extracted and
# which baseline row is fetched.
_PRIMARY_METRIC: dict[str, tuple[str, str]] = {
    "jvm_heap_pressure":               ("jvm.heap.used.percent",             "%"),
    "shard_allocation_failure":        ("shard.unassigned.count",            "count"),
    "thread_pool_saturation":          ("thread_pool.write.queue",           "count"),
    "fielddata_circuit_breaker":       ("circuit_breaker.tripped",           "count"),
    "disk_watermark":                  ("fs.disk.used.percent",              "%"),
    "mysql_connection_pool_saturation":("mysql.connection.pct",              "%"),
    "mysql_replication_lag":           ("mysql.replication.lag.seconds",     "s"),
    "mysql_innodb_buffer_pool_pressure":("mysql.buffer.pool.pressure.pct",   "%"),
    "mysql_disk_space":                ("mysql.disk.used.percent",           "%"),
}

# Matches: "metric.name=91.0 (sigma=+4.2)" or "metric.name=3"
_VALUE_RE = re.compile(r'^[^=]+=\s*([\d.]+)')


async def _resolve_tenant_id(db: AsyncSession, x_tenant_id: str | None) -> uuid.UUID | None:
    """Resolve tenant from header, falling back to the prototype tenant."""
    if x_tenant_id:
        stmt = select(Tenant).where(Tenant.id == x_tenant_id)
        tenant = (await db.execute(stmt)).scalar_one_or_none()
        return tenant.id if tenant else None
    # Prototype fallback: first tenant
    stmt = select(Tenant).limit(1)
    tenant = (await db.execute(stmt)).scalar_one_or_none()
    return tenant.id if tenant else None


@router.get("/cluster/{cluster_id}", response_model=list[VerdictResponse])
async def get_verdicts_for_cluster(
    cluster_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the most recent verdicts for a cluster, one per analyzer.
    This powers the cluster detail page — the user sees the current state
    of every analyzer that has run against this cluster.
    """
    # Resolve cluster_id string to internal UUID
    cluster_stmt = select(Cluster).where(Cluster.cluster_id == cluster_id)
    cluster = (await db.execute(cluster_stmt)).scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    stmt = (
        select(Verdict)
        .where(Verdict.cluster_id == cluster.id)
        .options(
            selectinload(Verdict.evidence),
            selectinload(Verdict.llm_explanation),
        )
        .order_by(desc(Verdict.run_at))
        .limit(limit)
    )
    results = (await db.execute(stmt)).scalars().all()
    return results


@router.get("/{cluster_uuid}/{analyzer_name}/trend")
async def get_verdict_trend(
    cluster_uuid: str,
    analyzer_name: str,
    hours: int = Query(default=24, ge=1, le=168),
    x_tenant_id: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns a time-series of the primary metric for the given cluster+analyzer
    over the last N hours, plus baseline p50/p95 reference values.

    Powers the real trend chart in the issue detail panel.
    Tenant isolation: cluster must belong to the resolved tenant.
    """
    # Resolve tenant
    tenant_id = await _resolve_tenant_id(db, x_tenant_id)
    if tenant_id is None:
        raise HTTPException(status_code=403, detail="Tenant not found")

    # Verify cluster exists and belongs to tenant
    try:
        cluster_id_uuid = uuid.UUID(cluster_uuid)
    except ValueError:
        raise HTTPException(status_code=404, detail="Cluster not found")

    cluster_stmt = (
        select(Cluster)
        .join(Stack, Cluster.stack_id == Stack.id)
        .where(
            and_(
                Cluster.id == cluster_id_uuid,
                Stack.tenant_id == tenant_id,
            )
        )
    )
    cluster = (await db.execute(cluster_stmt)).scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    # Determine primary metric for this analyzer
    if analyzer_name not in _PRIMARY_METRIC:
        raise HTTPException(status_code=400, detail=f"Unknown analyzer: {analyzer_name}")
    primary_metric_name, unit = _PRIMARY_METRIC[analyzer_name]

    # Fetch verdicts in time window, oldest first
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    verdict_stmt = (
        select(Verdict)
        .where(
            and_(
                Verdict.cluster_id == cluster_id_uuid,
                Verdict.analyzer_name == analyzer_name,
                Verdict.run_at >= since,
            )
        )
        .options(selectinload(Verdict.evidence))
        .order_by(Verdict.run_at.asc())
    )
    verdicts = (await db.execute(verdict_stmt)).scalars().all()

    points_collected = len(verdicts)

    # Determine current status and issue_started_at
    issue_started_at: str | None = None
    if verdicts:
        current_status = verdicts[-1].status
        # Earliest run_at where status equals current_status (contiguous from the end is ideal,
        # but min across all matching is a safe approximation for the progress marker)
        matching_run_ats = [v.run_at for v in verdicts if v.status == current_status]
        if matching_run_ats and len(matching_run_ats) < points_collected:
            # There are earlier points with a different status — onset is meaningful
            issue_started_at = min(matching_run_ats).isoformat()

    # Build per-instance series: {instance_id -> [{ts, value}]}
    series_map: dict[str | None, list[dict]] = defaultdict(list)
    for verdict in verdicts:
        value: float | None = None
        for ev in (verdict.evidence or []):
            if ev.source_type == "metric" and ev.evidence_text.startswith(primary_metric_name + "="):
                m = _VALUE_RE.match(ev.evidence_text)
                if m:
                    value = float(m.group(1))
                    break
        if value is not None:
            series_map[verdict.instance_id].append({
                "ts": verdict.run_at.isoformat(),
                "value": value,
            })

    series = [
        {"instance_id": inst_id, "points": pts}
        for inst_id, pts in series_map.items()
    ]

    # Fetch baseline (uses composite cluster_id string, not UUID)
    baseline_profile = await get_baseline(db, cluster.cluster_id, primary_metric_name)
    baseline = None
    if baseline_profile and baseline_profile.is_valid:
        baseline = {"p50": baseline_profile.p50, "p95": baseline_profile.p95}

    return {
        "series": series,
        "baseline": baseline,
        "unit": unit,
        "metric_name": primary_metric_name,
        "issue_started_at": issue_started_at,
        "points_collected": points_collected,
    }


@router.get("/{verdict_id}", response_model=VerdictResponse)
async def get_verdict(verdict_id: str, db: AsyncSession = Depends(get_db)):
    stmt = (
        select(Verdict)
        .where(Verdict.id == verdict_id)
        .options(
            selectinload(Verdict.evidence),
            selectinload(Verdict.llm_explanation),
        )
    )
    verdict = (await db.execute(stmt)).scalar_one_or_none()
    if not verdict:
        raise HTTPException(status_code=404, detail="Verdict not found")
    return verdict
