from __future__ import annotations
from uuid import UUID
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.session import get_db
from app.models.metric import Metric
from app.models.database import Database
from app.schemas.metric import (
    MetricCreate,
    MetricBatchCreate,
    MetricResponse,
    MetricTimeSeriesResponse,
    MetricDataPoint,
    CurrentMetrics,
)

router = APIRouter()


def parse_time_window(window: str) -> timedelta:
    """Parse time window string to timedelta."""
    mapping = {
        "1h": timedelta(hours=1),
        "6h": timedelta(hours=6),
        "24h": timedelta(hours=24),
        "7d": timedelta(days=7),
        "30d": timedelta(days=30),
    }
    return mapping.get(window, timedelta(hours=24))


@router.get("/databases/{database_id}/current", response_model=CurrentMetrics)
async def get_current_metrics(
    database_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get current metrics for a database (from denormalized fields)."""
    result = await db.execute(select(Database).where(Database.id == database_id))
    database = result.scalar_one_or_none()

    if not database:
        raise HTTPException(status_code=404, detail="Database not found")

    return CurrentMetrics(
        cpu_usage=database.cpu_usage,
        memory_usage=database.memory_usage,
        storage_usage=database.storage_usage,
        connections_active=database.connections_active,
        connections_max=database.connections_max,
    )


@router.get("/databases/{database_id}/timeseries/{metric_name}", response_model=MetricTimeSeriesResponse)
async def get_metric_timeseries(
    database_id: UUID,
    metric_name: str,
    time_window: str = Query("24h", regex="^(1h|6h|24h|7d|30d)$"),
    db: AsyncSession = Depends(get_db),
):
    """Get time series data for a specific metric."""
    # Verify database exists
    result = await db.execute(select(Database).where(Database.id == database_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Database not found")

    # Calculate time range
    end_time = datetime.utcnow()
    start_time = end_time - parse_time_window(time_window)

    # Query metrics
    query = select(Metric).where(
        Metric.database_id == database_id,
        Metric.name == metric_name,
        Metric.timestamp >= start_time,
        Metric.timestamp <= end_time,
    ).order_by(Metric.timestamp)

    result = await db.execute(query)
    metrics = result.scalars().all()

    if not metrics:
        return MetricTimeSeriesResponse(
            database_id=database_id,
            metric_name=metric_name,
            unit=None,
            data_points=[],
            min_value=0,
            max_value=0,
            avg_value=0,
        )

    data_points = [
        MetricDataPoint(timestamp=m.timestamp, value=m.value)
        for m in metrics
    ]

    values = [m.value for m in metrics]

    return MetricTimeSeriesResponse(
        database_id=database_id,
        metric_name=metric_name,
        unit=metrics[0].unit if metrics else None,
        data_points=data_points,
        min_value=min(values),
        max_value=max(values),
        avg_value=sum(values) / len(values),
    )


@router.post("/ingest", response_model=MetricResponse, status_code=201)
async def ingest_metric(
    data: MetricCreate,
    db: AsyncSession = Depends(get_db),
):
    """Ingest a single metric data point."""
    # Verify database exists
    result = await db.execute(select(Database).where(Database.id == data.database_id))
    database = result.scalar_one_or_none()
    if not database:
        raise HTTPException(status_code=404, detail="Database not found")

    metric = Metric(
        database_id=data.database_id,
        name=data.name,
        value=data.value,
        unit=data.unit,
        timestamp=data.timestamp or datetime.utcnow(),
    )
    db.add(metric)

    # Update denormalized metrics on database if applicable
    if data.name == "cpu_usage":
        database.cpu_usage = data.value
    elif data.name == "memory_usage":
        database.memory_usage = data.value
    elif data.name == "storage_usage":
        database.storage_usage = data.value

    await db.flush()
    await db.refresh(metric)
    return MetricResponse.model_validate(metric)


@router.post("/ingest/batch", status_code=201)
async def ingest_metrics_batch(
    data: MetricBatchCreate,
    db: AsyncSession = Depends(get_db),
):
    """Ingest multiple metrics at once."""
    # Verify database exists
    result = await db.execute(select(Database).where(Database.id == data.database_id))
    database = result.scalar_one_or_none()
    if not database:
        raise HTTPException(status_code=404, detail="Database not found")

    timestamp = data.timestamp or datetime.utcnow()

    for metric_data in data.metrics:
        metric = Metric(
            database_id=data.database_id,
            name=metric_data.name,
            value=metric_data.value,
            unit=metric_data.unit,
            timestamp=timestamp,
        )
        db.add(metric)

        # Update denormalized metrics
        if metric_data.name == "cpu_usage":
            database.cpu_usage = metric_data.value
        elif metric_data.name == "memory_usage":
            database.memory_usage = metric_data.value
        elif metric_data.name == "storage_usage":
            database.storage_usage = metric_data.value

    await db.flush()

    return {"status": "ok", "metrics_ingested": len(data.metrics)}


@router.get("/databases/{database_id}/available", response_model=list[str])
async def get_available_metrics(
    database_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get list of available metric names for a database."""
    # Verify database exists
    result = await db.execute(select(Database).where(Database.id == database_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Database not found")

    query = select(func.distinct(Metric.name)).where(Metric.database_id == database_id)
    result = await db.execute(query)
    metric_names = [row[0] for row in result]

    return metric_names
