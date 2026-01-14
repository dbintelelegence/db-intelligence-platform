from __future__ import annotations
from datetime import datetime
from uuid import UUID
from typing import Optional, List, Dict
from pydantic import BaseModel, Field

from app.models.issue import IssueSeverity, IssueCategory, IssueStatus


class IssueBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str
    severity: IssueSeverity
    category: IssueCategory


class IssueCreate(IssueBase):
    database_id: UUID
    ai_explanation: Optional[str] = None
    ai_recommendations: Optional[list[str]] = None
    related_metrics: Optional[list[dict]] = None
    affected_services: Optional[list[str]] = None


class IssueUpdate(BaseModel):
    status: Optional[IssueStatus] = None
    ai_explanation: Optional[str] = None
    ai_recommendations: Optional[list[str]] = None


class IssueAcknowledge(BaseModel):
    acknowledged_by: str


class IssueResolve(BaseModel):
    resolved_by: str


class IssueResponse(IssueBase):
    id: UUID
    database_id: UUID
    status: IssueStatus
    ai_explanation: Optional[str]
    ai_recommendations: Optional[list[str]]
    related_metrics: Optional[list[dict]]
    affected_services: Optional[list[str]]
    occurrence_count: int
    first_detected_at: datetime
    last_detected_at: datetime
    acknowledged_at: Optional[datetime]
    acknowledged_by: Optional[str]
    resolved_at: Optional[datetime]
    resolved_by: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class IssueListResponse(BaseModel):
    issues: list[IssueResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class IssueSummary(BaseModel):
    total_issues: int
    critical_count: int
    warning_count: int
    info_count: int
    active_count: int
    acknowledged_count: int
    resolved_count: int
    by_category: dict[str, int]
