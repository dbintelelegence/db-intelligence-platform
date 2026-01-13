from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional

from app.db.session import get_db
from app.models.database import Database, DatabaseType, CloudProvider, Environment, HealthStatus
from app.schemas.database import (
    DatabaseCreate,
    DatabaseUpdate,
    DatabaseResponse,
    DatabaseListResponse,
    DatabaseSummary,
)

router = APIRouter()


@router.get("", response_model=DatabaseListResponse)
async def list_databases(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    cloud_provider: Optional[CloudProvider] = None,
    database_type: Optional[DatabaseType] = None,
    environment: Optional[Environment] = None,
    health_status: Optional[HealthStatus] = None,
    region: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List all databases with filtering and pagination."""
    query = select(Database)

    # Apply filters
    if cloud_provider:
        query = query.where(Database.cloud_provider == cloud_provider)
    if database_type:
        query = query.where(Database.type == database_type)
    if environment:
        query = query.where(Database.environment == environment)
    if health_status:
        query = query.where(Database.health_status == health_status)
    if region:
        query = query.where(Database.region == region)
    if search:
        query = query.where(Database.name.ilike(f"%{search}%"))

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query)

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size).order_by(Database.name)

    result = await db.execute(query)
    databases = result.scalars().all()

    total_pages = (total + page_size - 1) // page_size

    return DatabaseListResponse(
        databases=[DatabaseResponse.model_validate(d) for d in databases],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/summary", response_model=DatabaseSummary)
async def get_database_summary(db: AsyncSession = Depends(get_db)):
    """Get summary statistics for all databases."""
    # Total count
    total = await db.scalar(select(func.count(Database.id)))

    # Health status counts
    health_counts = await db.execute(
        select(Database.health_status, func.count(Database.id))
        .group_by(Database.health_status)
    )
    health_map = {status.value: count for status, count in health_counts}

    # Cloud provider counts
    cloud_counts = await db.execute(
        select(Database.cloud_provider, func.count(Database.id))
        .group_by(Database.cloud_provider)
    )
    cloud_map = {provider.value: count for provider, count in cloud_counts}

    # Type counts
    type_counts = await db.execute(
        select(Database.type, func.count(Database.id))
        .group_by(Database.type)
    )
    type_map = {db_type.value: count for db_type, count in type_counts}

    # Environment counts
    env_counts = await db.execute(
        select(Database.environment, func.count(Database.id))
        .group_by(Database.environment)
    )
    env_map = {env.value: count for env, count in env_counts}

    return DatabaseSummary(
        total_databases=total or 0,
        healthy_count=health_map.get("healthy", 0),
        warning_count=health_map.get("warning", 0),
        critical_count=health_map.get("critical", 0),
        by_cloud=cloud_map,
        by_type=type_map,
        by_environment=env_map,
    )


@router.get("/{database_id}", response_model=DatabaseResponse)
async def get_database(database_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get a specific database by ID."""
    result = await db.execute(select(Database).where(Database.id == database_id))
    database = result.scalar_one_or_none()

    if not database:
        raise HTTPException(status_code=404, detail="Database not found")

    return DatabaseResponse.model_validate(database)


@router.post("", response_model=DatabaseResponse, status_code=201)
async def create_database(data: DatabaseCreate, db: AsyncSession = Depends(get_db)):
    """Create a new database entry."""
    database = Database(**data.model_dump())
    db.add(database)
    await db.flush()
    await db.refresh(database)
    return DatabaseResponse.model_validate(database)


@router.patch("/{database_id}", response_model=DatabaseResponse)
async def update_database(
    database_id: UUID,
    data: DatabaseUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a database entry."""
    result = await db.execute(select(Database).where(Database.id == database_id))
    database = result.scalar_one_or_none()

    if not database:
        raise HTTPException(status_code=404, detail="Database not found")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(database, field, value)

    await db.flush()
    await db.refresh(database)
    return DatabaseResponse.model_validate(database)


@router.delete("/{database_id}", status_code=204)
async def delete_database(database_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete a database entry."""
    result = await db.execute(select(Database).where(Database.id == database_id))
    database = result.scalar_one_or_none()

    if not database:
        raise HTTPException(status_code=404, detail="Database not found")

    await db.delete(database)
