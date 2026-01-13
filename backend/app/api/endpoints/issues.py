from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from typing import Optional

from app.db.session import get_db
from app.models.issue import Issue, IssueSeverity, IssueCategory, IssueStatus
from app.models.database import Database
from app.schemas.issue import (
    IssueCreate,
    IssueUpdate,
    IssueResponse,
    IssueListResponse,
    IssueAcknowledge,
    IssueResolve,
    IssueSummary,
)

router = APIRouter()


@router.get("", response_model=IssueListResponse)
async def list_issues(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    severity: Optional[IssueSeverity] = None,
    category: Optional[IssueCategory] = None,
    status: Optional[IssueStatus] = None,
    database_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
):
    """List all issues with filtering and pagination."""
    query = select(Issue)

    # Apply filters
    if severity:
        query = query.where(Issue.severity == severity)
    if category:
        query = query.where(Issue.category == category)
    if status:
        query = query.where(Issue.status == status)
    if database_id:
        query = query.where(Issue.database_id == database_id)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query)

    # Apply pagination and ordering (critical first, then by date)
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size).order_by(
        Issue.severity.desc(),
        Issue.last_detected_at.desc()
    )

    result = await db.execute(query)
    issues = result.scalars().all()

    total_pages = (total + page_size - 1) // page_size

    return IssueListResponse(
        issues=[IssueResponse.model_validate(i) for i in issues],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/summary", response_model=IssueSummary)
async def get_issues_summary(db: AsyncSession = Depends(get_db)):
    """Get summary statistics for all issues."""
    # Total count
    total = await db.scalar(select(func.count(Issue.id)))

    # Severity counts
    severity_counts = await db.execute(
        select(Issue.severity, func.count(Issue.id))
        .group_by(Issue.severity)
    )
    severity_map = {sev.value: count for sev, count in severity_counts}

    # Status counts
    status_counts = await db.execute(
        select(Issue.status, func.count(Issue.id))
        .group_by(Issue.status)
    )
    status_map = {status.value: count for status, count in status_counts}

    # Category counts
    category_counts = await db.execute(
        select(Issue.category, func.count(Issue.id))
        .group_by(Issue.category)
    )
    category_map = {cat.value: count for cat, count in category_counts}

    return IssueSummary(
        total_issues=total or 0,
        critical_count=severity_map.get("critical", 0),
        warning_count=severity_map.get("warning", 0),
        info_count=severity_map.get("info", 0),
        active_count=status_map.get("active", 0),
        acknowledged_count=status_map.get("acknowledged", 0),
        resolved_count=status_map.get("resolved", 0),
        by_category=category_map,
    )


@router.get("/{issue_id}", response_model=IssueResponse)
async def get_issue(issue_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get a specific issue by ID."""
    result = await db.execute(select(Issue).where(Issue.id == issue_id))
    issue = result.scalar_one_or_none()

    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    return IssueResponse.model_validate(issue)


@router.post("", response_model=IssueResponse, status_code=201)
async def create_issue(data: IssueCreate, db: AsyncSession = Depends(get_db)):
    """Create a new issue."""
    # Verify database exists
    result = await db.execute(select(Database).where(Database.id == data.database_id))
    database = result.scalar_one_or_none()
    if not database:
        raise HTTPException(status_code=404, detail="Database not found")

    issue = Issue(**data.model_dump())
    db.add(issue)

    # Update database issue count
    database.active_issues_count += 1

    await db.flush()
    await db.refresh(issue)
    return IssueResponse.model_validate(issue)


@router.patch("/{issue_id}", response_model=IssueResponse)
async def update_issue(
    issue_id: UUID,
    data: IssueUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an issue."""
    result = await db.execute(select(Issue).where(Issue.id == issue_id))
    issue = result.scalar_one_or_none()

    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(issue, field, value)

    await db.flush()
    await db.refresh(issue)
    return IssueResponse.model_validate(issue)


@router.post("/{issue_id}/acknowledge", response_model=IssueResponse)
async def acknowledge_issue(
    issue_id: UUID,
    data: IssueAcknowledge,
    db: AsyncSession = Depends(get_db),
):
    """Acknowledge an issue."""
    result = await db.execute(select(Issue).where(Issue.id == issue_id))
    issue = result.scalar_one_or_none()

    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    if issue.status != IssueStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Issue is not active")

    issue.status = IssueStatus.ACKNOWLEDGED
    issue.acknowledged_at = datetime.utcnow()
    issue.acknowledged_by = data.acknowledged_by

    await db.flush()
    await db.refresh(issue)
    return IssueResponse.model_validate(issue)


@router.post("/{issue_id}/resolve", response_model=IssueResponse)
async def resolve_issue(
    issue_id: UUID,
    data: IssueResolve,
    db: AsyncSession = Depends(get_db),
):
    """Resolve an issue."""
    result = await db.execute(select(Issue).where(Issue.id == issue_id))
    issue = result.scalar_one_or_none()

    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    if issue.status == IssueStatus.RESOLVED:
        raise HTTPException(status_code=400, detail="Issue is already resolved")

    # Get the database to update issue count
    db_result = await db.execute(select(Database).where(Database.id == issue.database_id))
    database = db_result.scalar_one_or_none()
    if database:
        database.active_issues_count = max(0, database.active_issues_count - 1)

    issue.status = IssueStatus.RESOLVED
    issue.resolved_at = datetime.utcnow()
    issue.resolved_by = data.resolved_by

    await db.flush()
    await db.refresh(issue)
    return IssueResponse.model_validate(issue)


@router.delete("/{issue_id}", status_code=204)
async def delete_issue(issue_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete an issue."""
    result = await db.execute(select(Issue).where(Issue.id == issue_id))
    issue = result.scalar_one_or_none()

    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    # Update database issue count if issue was active
    if issue.status != IssueStatus.RESOLVED:
        db_result = await db.execute(select(Database).where(Database.id == issue.database_id))
        database = db_result.scalar_one_or_none()
        if database:
            database.active_issues_count = max(0, database.active_issues_count - 1)

    await db.delete(issue)
