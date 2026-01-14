from __future__ import annotations
from datetime import datetime
from uuid import UUID
from typing import Optional, List
from pydantic import BaseModel, Field


class MetricBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    value: float
    unit: Optional[str] = None


class MetricCreate(MetricBase):
    database_id: UUID
    timestamp: Optional[datetime] = None


class MetricBatchCreate(BaseModel):
    database_id: UUID
    metrics: list[MetricBase]
    timestamp: Optional[datetime] = None


class MetricResponse(MetricBase):
    id: UUID
    database_id: UUID
    timestamp: datetime

    class Config:
        from_attributes = True


class MetricDataPoint(BaseModel):
    timestamp: datetime
    value: float


class MetricTimeSeriesResponse(BaseModel):
    database_id: UUID
    metric_name: str
    unit: Optional[str]
    data_points: list[MetricDataPoint]
    min_value: float
    max_value: float
    avg_value: float


class CurrentMetrics(BaseModel):
    cpu_usage: float
    memory_usage: float
    storage_usage: float
    connections_active: int
    connections_max: int
    latency_avg_ms: Optional[float] = None
    throughput_qps: Optional[float] = None
    replication_lag_ms: Optional[float] = None
