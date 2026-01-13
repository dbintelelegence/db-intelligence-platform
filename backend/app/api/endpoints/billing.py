from __future__ import annotations
from uuid import UUID
from datetime import date, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.session import get_db
from app.models.billing import BillingRecord, CostAnomaly
from app.models.database import Database
from app.schemas.billing import (
    BillingRecordCreate,
    BillingRecordResponse,
    CostSummary,
    CostBreakdown,
    CostByCloud,
    CostByType,
    CostByRegion,
    CostTimeSeries,
    CostAnomalyResponse,
    BillingSummaryResponse,
)

router = APIRouter()


@router.get("/summary", response_model=BillingSummaryResponse)
async def get_billing_summary(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
):
    """Get comprehensive billing summary with breakdowns."""
    # Default to last 30 days
    if not end_date:
        end_date = date.today()
    if not start_date:
        start_date = end_date - timedelta(days=30)

    # Previous period for comparison
    period_length = (end_date - start_date).days
    prev_end_date = start_date - timedelta(days=1)
    prev_start_date = prev_end_date - timedelta(days=period_length)

    # Current period totals
    current_query = select(
        func.sum(BillingRecord.total_cost),
        func.sum(BillingRecord.compute_cost),
        func.sum(BillingRecord.storage_cost),
        func.sum(BillingRecord.backup_cost),
        func.sum(BillingRecord.data_transfer_cost),
        func.sum(BillingRecord.other_cost),
    ).where(
        BillingRecord.billing_date >= start_date,
        BillingRecord.billing_date <= end_date,
    )
    current_result = await db.execute(current_query)
    current_totals = current_result.one()

    # Previous period total
    prev_query = select(func.sum(BillingRecord.total_cost)).where(
        BillingRecord.billing_date >= prev_start_date,
        BillingRecord.billing_date <= prev_end_date,
    )
    prev_total = await db.scalar(prev_query) or 0

    current_total = current_totals[0] or 0
    cost_change = ((current_total - prev_total) / prev_total * 100) if prev_total > 0 else 0

    # Cost by cloud provider
    cloud_query = select(
        Database.cloud_provider,
        func.sum(BillingRecord.total_cost),
        func.count(func.distinct(Database.id)),
    ).join(Database).where(
        BillingRecord.billing_date >= start_date,
        BillingRecord.billing_date <= end_date,
    ).group_by(Database.cloud_provider)

    cloud_result = await db.execute(cloud_query)
    by_cloud = [
        CostByCloud(
            cloud_provider=row[0].value,
            total_cost=row[1] or 0,
            database_count=row[2],
            percentage=(row[1] / current_total * 100) if current_total > 0 else 0,
        )
        for row in cloud_result
    ]

    # Cost by database type
    type_query = select(
        Database.type,
        func.sum(BillingRecord.total_cost),
        func.count(func.distinct(Database.id)),
    ).join(Database).where(
        BillingRecord.billing_date >= start_date,
        BillingRecord.billing_date <= end_date,
    ).group_by(Database.type)

    type_result = await db.execute(type_query)
    by_type = [
        CostByType(
            database_type=row[0].value,
            total_cost=row[1] or 0,
            database_count=row[2],
            percentage=(row[1] / current_total * 100) if current_total > 0 else 0,
        )
        for row in type_result
    ]

    # Cost by region
    region_query = select(
        Database.region,
        func.sum(BillingRecord.total_cost),
        func.count(func.distinct(Database.id)),
    ).join(Database).where(
        BillingRecord.billing_date >= start_date,
        BillingRecord.billing_date <= end_date,
    ).group_by(Database.region)

    region_result = await db.execute(region_query)
    by_region = [
        CostByRegion(
            region=row[0],
            total_cost=row[1] or 0,
            database_count=row[2],
            percentage=(row[1] / current_total * 100) if current_total > 0 else 0,
        )
        for row in region_result
    ]

    # Time series (daily costs)
    ts_query = select(
        BillingRecord.billing_date,
        func.sum(BillingRecord.total_cost),
    ).where(
        BillingRecord.billing_date >= start_date,
        BillingRecord.billing_date <= end_date,
    ).group_by(BillingRecord.billing_date).order_by(BillingRecord.billing_date)

    ts_result = await db.execute(ts_query)
    time_series = [
        CostTimeSeries(
            date=row[0],
            total_cost=row[1] or 0,
            by_cloud={},
            by_type={},
        )
        for row in ts_result
    ]

    # Cost anomalies
    anomaly_query = select(CostAnomaly).where(
        CostAnomaly.detected_at >= start_date,
    ).order_by(CostAnomaly.detected_at.desc()).limit(10)

    anomaly_result = await db.execute(anomaly_query)
    anomalies = [
        CostAnomalyResponse.model_validate(a)
        for a in anomaly_result.scalars()
    ]

    # Simple forecast (average daily * 30)
    avg_daily = current_total / period_length if period_length > 0 else 0
    forecast = avg_daily * 30

    return BillingSummaryResponse(
        summary=CostSummary(
            total_cost=current_total,
            previous_period_cost=prev_total,
            cost_change_percent=cost_change,
            breakdown=CostBreakdown(
                compute=current_totals[1] or 0,
                storage=current_totals[2] or 0,
                backup=current_totals[3] or 0,
                data_transfer=current_totals[4] or 0,
                other=current_totals[5] or 0,
            ),
            forecast_next_month=forecast,
            forecast_confidence=0.75,
        ),
        by_cloud=by_cloud,
        by_type=by_type,
        by_region=by_region,
        time_series=time_series,
        anomalies=anomalies,
    )


@router.get("/databases/{database_id}", response_model=list[BillingRecordResponse])
async def get_database_billing(
    database_id: UUID,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
):
    """Get billing records for a specific database."""
    # Verify database exists
    result = await db.execute(select(Database).where(Database.id == database_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Database not found")

    query = select(BillingRecord).where(BillingRecord.database_id == database_id)

    if start_date:
        query = query.where(BillingRecord.billing_date >= start_date)
    if end_date:
        query = query.where(BillingRecord.billing_date <= end_date)

    query = query.order_by(BillingRecord.billing_date.desc())

    result = await db.execute(query)
    records = result.scalars().all()

    return [BillingRecordResponse.model_validate(r) for r in records]


@router.post("/records", response_model=BillingRecordResponse, status_code=201)
async def create_billing_record(
    data: BillingRecordCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new billing record."""
    # Verify database exists
    result = await db.execute(select(Database).where(Database.id == data.database_id))
    database = result.scalar_one_or_none()
    if not database:
        raise HTTPException(status_code=404, detail="Database not found")

    record = BillingRecord(**data.model_dump())
    db.add(record)

    # Update database monthly cost (simplified - just use latest record)
    database.monthly_cost = data.total_cost * 30  # Approximate monthly

    await db.flush()
    await db.refresh(record)
    return BillingRecordResponse.model_validate(record)


@router.get("/anomalies", response_model=list[CostAnomalyResponse])
async def list_cost_anomalies(
    acknowledged: Optional[bool] = None,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List cost anomalies."""
    query = select(CostAnomaly)

    if acknowledged is not None:
        query = query.where(CostAnomaly.is_acknowledged == acknowledged)

    query = query.order_by(CostAnomaly.detected_at.desc()).limit(limit)

    result = await db.execute(query)
    anomalies = result.scalars().all()

    return [CostAnomalyResponse.model_validate(a) for a in anomalies]


@router.post("/anomalies/{anomaly_id}/acknowledge", response_model=CostAnomalyResponse)
async def acknowledge_anomaly(
    anomaly_id: UUID,
    acknowledged_by: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Acknowledge a cost anomaly."""
    result = await db.execute(select(CostAnomaly).where(CostAnomaly.id == anomaly_id))
    anomaly = result.scalar_one_or_none()

    if not anomaly:
        raise HTTPException(status_code=404, detail="Anomaly not found")

    from datetime import datetime
    anomaly.is_acknowledged = True
    anomaly.acknowledged_by = acknowledged_by
    anomaly.acknowledged_at = datetime.utcnow()

    await db.flush()
    await db.refresh(anomaly)
    return CostAnomalyResponse.model_validate(anomaly)
