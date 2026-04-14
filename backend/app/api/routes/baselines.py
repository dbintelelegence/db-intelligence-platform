from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.models.models import BaselineProfile, Cluster
from app.schemas.schemas import BaselineProfileResponse

router = APIRouter()


@router.get("/cluster/{cluster_id}", response_model=list[BaselineProfileResponse])
async def get_baselines_for_cluster(
    cluster_id: str,
    window_type: str = "all",
    db: AsyncSession = Depends(get_db),
):
    cluster_stmt = select(Cluster).where(Cluster.cluster_id == cluster_id)
    cluster = (await db.execute(cluster_stmt)).scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    stmt = select(BaselineProfile).where(
        BaselineProfile.cluster_id == cluster.id,
        BaselineProfile.window_type == window_type,
    )
    results = (await db.execute(stmt)).scalars().all()
    return results
