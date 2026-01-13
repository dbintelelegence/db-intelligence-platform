from __future__ import annotations
from datetime import datetime
from uuid import UUID
from typing import Optional, List, Dict
from pydantic import BaseModel, Field

from app.models.database import DatabaseType, CloudProvider, Environment, HealthStatus


class DatabaseBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    type: DatabaseType
    cloud_provider: CloudProvider
    region: str = Field(..., min_length=1, max_length=50)
    environment: Environment
    version: Optional[str] = None
    instance_type: Optional[str] = None
    storage_size_gb: Optional[int] = None
    tags: Optional[dict] = None


class DatabaseCreate(DatabaseBase):
    pass


class DatabaseUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    environment: Optional[Environment] = None
    version: Optional[str] = None
    instance_type: Optional[str] = None
    storage_size_gb: Optional[int] = None
    tags: Optional[dict] = None


class DatabaseMetrics(BaseModel):
    cpu_usage: float = Field(..., ge=0, le=100)
    memory_usage: float = Field(..., ge=0, le=100)
    storage_usage: float = Field(..., ge=0, le=100)
    connections_active: int = Field(..., ge=0)
    connections_max: int = Field(..., ge=1)


class DatabaseResponse(DatabaseBase):
    id: UUID
    health_status: HealthStatus
    health_score: float
    cpu_usage: float
    memory_usage: float
    storage_usage: float
    connections_active: int
    connections_max: int
    monthly_cost: float
    cost_trend: float
    active_issues_count: int
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime

    class Config:
        from_attributes = True


class DatabaseListResponse(BaseModel):
    databases: list[DatabaseResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class DatabaseSummary(BaseModel):
    total_databases: int
    healthy_count: int
    warning_count: int
    critical_count: int
    by_cloud: dict[str, int]
    by_type: dict[str, int]
    by_environment: dict[str, int]
