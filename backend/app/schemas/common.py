from __future__ import annotations
from typing import Optional, Dict, List
from pydantic import BaseModel, Field

from app.models.database import DatabaseType, CloudProvider, Environment, HealthStatus
from app.models.issue import IssueSeverity, IssueCategory, IssueStatus


class PaginationParams(BaseModel):
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)


class FilterParams(BaseModel):
    cloud_provider: Optional[CloudProvider] = None
    database_type: Optional[DatabaseType] = None
    environment: Optional[Environment] = None
    health_status: Optional[HealthStatus] = None
    region: Optional[str] = None
    search: Optional[str] = None


class IssueFilterParams(BaseModel):
    severity: Optional[IssueSeverity] = None
    category: Optional[IssueCategory] = None
    status: Optional[IssueStatus] = None
    database_id: Optional[str] = None


class HealthSummary(BaseModel):
    total_databases: int
    healthy_count: int
    warning_count: int
    critical_count: int
    healthy_percentage: float
    overall_health_score: float


class ExecutiveSummary(BaseModel):
    health: HealthSummary
    total_monthly_cost: float
    cost_trend_percent: float
    active_issues_count: int
    critical_issues_count: int
    databases_by_cloud: dict[str, int]
    databases_by_type: dict[str, int]
    top_issues: list[dict]
    recent_changes: list[dict]
    ai_summary: Optional[str] = None


class TimeRangeParams(BaseModel):
    start_time: Optional[str] = None  # ISO format
    end_time: Optional[str] = None    # ISO format
    time_window: Optional[str] = "24h"  # 1h, 6h, 24h, 7d, 30d
