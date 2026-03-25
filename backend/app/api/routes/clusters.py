from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.db.session import get_db
from app.models.models import Cluster
from app.schemas.schemas import ClusterResponse

router = APIRouter()


@router.get("/", response_model=list[ClusterResponse])
async def list_clusters(db: AsyncSession = Depends(get_db)):
    stmt = select(Cluster).order_by(Cluster.current_status, Cluster.cluster_id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{cluster_id}", response_model=ClusterResponse)
async def get_cluster(cluster_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(Cluster).where(Cluster.cluster_id == cluster_id)
    cluster = (await db.execute(stmt)).scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    return cluster
