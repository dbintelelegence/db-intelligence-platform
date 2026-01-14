from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.session import get_db
from app.models.database import Database, HealthStatus
from app.models.issue import Issue, IssueStatus, IssueSeverity
from app.models.change import ChangeEvent
from app.schemas.common import ExecutiveSummary, HealthSummary

router = APIRouter()


@router.get("/executive-summary", response_model=ExecutiveSummary)
async def get_executive_summary(db: AsyncSession = Depends(get_db)):
    """Get executive summary for the dashboard overview."""

    # Total databases
    total_databases = await db.scalar(select(func.count(Database.id))) or 0

    # Health status counts
    health_counts = await db.execute(
        select(Database.health_status, func.count(Database.id))
        .group_by(Database.health_status)
    )
    health_map = {status.value: count for status, count in health_counts}

    healthy_count = health_map.get("healthy", 0)
    warning_count = health_map.get("warning", 0)
    critical_count = health_map.get("critical", 0)

    # Calculate overall health score
    if total_databases > 0:
        healthy_percentage = (healthy_count / total_databases) * 100
        # Weighted health score: healthy=100, warning=50, critical=0
        overall_health_score = (
            (healthy_count * 100 + warning_count * 50 + critical_count * 0)
            / total_databases
        )
    else:
        healthy_percentage = 100
        overall_health_score = 100

    # Total monthly cost
    total_cost_result = await db.scalar(select(func.sum(Database.monthly_cost)))
    total_monthly_cost = total_cost_result or 0

    # Cost trend (average of all database cost trends)
    avg_trend_result = await db.scalar(select(func.avg(Database.cost_trend)))
    cost_trend_percent = avg_trend_result or 0

    # Active issues count
    active_issues = await db.scalar(
        select(func.count(Issue.id)).where(Issue.status == IssueStatus.ACTIVE)
    ) or 0

    # Critical issues count
    critical_issues = await db.scalar(
        select(func.count(Issue.id)).where(
            Issue.status == IssueStatus.ACTIVE,
            Issue.severity == IssueSeverity.CRITICAL,
        )
    ) or 0

    # Databases by cloud
    cloud_counts = await db.execute(
        select(Database.cloud_provider, func.count(Database.id))
        .group_by(Database.cloud_provider)
    )
    databases_by_cloud = {provider.value: count for provider, count in cloud_counts}

    # Databases by type
    type_counts = await db.execute(
        select(Database.type, func.count(Database.id))
        .group_by(Database.type)
    )
    databases_by_type = {db_type.value: count for db_type, count in type_counts}

    # Top 5 issues (active, by severity)
    top_issues_query = select(Issue).where(
        Issue.status == IssueStatus.ACTIVE
    ).order_by(
        Issue.severity.desc(),
        Issue.last_detected_at.desc()
    ).limit(5)

    top_issues_result = await db.execute(top_issues_query)
    top_issues = [
        {
            "id": str(issue.id),
            "title": issue.title,
            "severity": issue.severity.value,
            "category": issue.category.value,
            "database_id": str(issue.database_id),
        }
        for issue in top_issues_result.scalars()
    ]

    # Recent changes (last 5)
    recent_changes_query = select(ChangeEvent).order_by(
        ChangeEvent.executed_at.desc()
    ).limit(5)

    recent_changes_result = await db.execute(recent_changes_query)
    recent_changes = [
        {
            "id": str(change.id),
            "title": change.title,
            "change_type": change.change_type.value,
            "database_id": str(change.database_id),
            "executed_at": change.executed_at.isoformat(),
        }
        for change in recent_changes_result.scalars()
    ]

    return ExecutiveSummary(
        health=HealthSummary(
            total_databases=total_databases,
            healthy_count=healthy_count,
            warning_count=warning_count,
            critical_count=critical_count,
            healthy_percentage=healthy_percentage,
            overall_health_score=overall_health_score,
        ),
        total_monthly_cost=total_monthly_cost,
        cost_trend_percent=cost_trend_percent,
        active_issues_count=active_issues,
        critical_issues_count=critical_issues,
        databases_by_cloud=databases_by_cloud,
        databases_by_type=databases_by_type,
        top_issues=top_issues,
        recent_changes=recent_changes,
    )


@router.get("/health", response_model=HealthSummary)
async def get_health_summary(db: AsyncSession = Depends(get_db)):
    """Get health summary only."""
    total_databases = await db.scalar(select(func.count(Database.id))) or 0

    health_counts = await db.execute(
        select(Database.health_status, func.count(Database.id))
        .group_by(Database.health_status)
    )
    health_map = {status.value: count for status, count in health_counts}

    healthy_count = health_map.get("healthy", 0)
    warning_count = health_map.get("warning", 0)
    critical_count = health_map.get("critical", 0)

    if total_databases > 0:
        healthy_percentage = (healthy_count / total_databases) * 100
        overall_health_score = (
            (healthy_count * 100 + warning_count * 50 + critical_count * 0)
            / total_databases
        )
    else:
        healthy_percentage = 100
        overall_health_score = 100

    return HealthSummary(
        total_databases=total_databases,
        healthy_count=healthy_count,
        warning_count=warning_count,
        critical_count=critical_count,
        healthy_percentage=healthy_percentage,
        overall_health_score=overall_health_score,
    )
