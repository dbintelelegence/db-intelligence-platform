from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload
from app.db.session import get_db
from app.models.models import Verdict, Cluster
from app.schemas.schemas import VerdictResponse

router = APIRouter()


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
