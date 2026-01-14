from __future__ import annotations
from datetime import datetime, date
from uuid import UUID
from typing import Optional, List, Dict
from pydantic import BaseModel, Field

from app.models.billing import CostAnomalyType


class BillingRecordBase(BaseModel):
    billing_date: date
    total_cost: float = Field(..., ge=0)
    compute_cost: float = Field(0, ge=0)
    storage_cost: float = Field(0, ge=0)
    backup_cost: float = Field(0, ge=0)
    data_transfer_cost: float = Field(0, ge=0)
    other_cost: float = Field(0, ge=0)


class BillingRecordCreate(BillingRecordBase):
    database_id: UUID
    compute_hours: Optional[float] = None
    storage_gb: Optional[float] = None
    data_transfer_gb: Optional[float] = None
    currency: str = "USD"
    billing_source: Optional[str] = None


class BillingRecordResponse(BillingRecordBase):
    id: UUID
    database_id: UUID
    compute_hours: Optional[float]
    storage_gb: Optional[float]
    data_transfer_gb: Optional[float]
    currency: str
    billing_source: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class CostBreakdown(BaseModel):
    compute: float
    storage: float
    backup: float
    data_transfer: float
    other: float


class CostSummary(BaseModel):
    total_cost: float
    previous_period_cost: float
    cost_change_percent: float
    breakdown: CostBreakdown
    forecast_next_month: float
    forecast_confidence: float


class CostByCloud(BaseModel):
    cloud_provider: str
    total_cost: float
    database_count: int
    percentage: float


class CostByType(BaseModel):
    database_type: str
    total_cost: float
    database_count: int
    percentage: float


class CostByRegion(BaseModel):
    region: str
    total_cost: float
    database_count: int
    percentage: float


class CostTimeSeries(BaseModel):
    date: date
    total_cost: float
    by_cloud: dict[str, float]
    by_type: dict[str, float]


class CostAnomalyResponse(BaseModel):
    id: UUID
    database_id: Optional[UUID]
    anomaly_type: CostAnomalyType
    amount: float
    baseline_amount: float
    deviation_percent: float
    explanation: Optional[str]
    possible_causes: Optional[list[str]]
    detected_at: datetime
    period_start: Optional[date]
    period_end: Optional[date]
    is_acknowledged: bool
    acknowledged_by: Optional[str]
    acknowledged_at: Optional[datetime]

    class Config:
        from_attributes = True


class BillingSummaryResponse(BaseModel):
    summary: CostSummary
    by_cloud: list[CostByCloud]
    by_type: list[CostByType]
    by_region: list[CostByRegion]
    time_series: list[CostTimeSeries]
    anomalies: list[CostAnomalyResponse]
