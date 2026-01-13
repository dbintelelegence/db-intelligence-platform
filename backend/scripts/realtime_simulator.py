#!/usr/bin/env python3
"""
Real-time data simulator for DB Intelligence Platform.
Continuously updates metrics, creates issues, and generates billing data.
"""

import asyncio
import random
from datetime import datetime, timedelta, date
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.models.database import Database, DatabaseType, CloudProvider, Environment, HealthStatus
from app.models.issue import Issue, IssueSeverity, IssueCategory, IssueStatus
from app.models.billing import BillingRecord, CostAnomaly, CostAnomalyType
from app.models.metric import Metric


# Issue templates for random generation
ISSUE_TEMPLATES = [
    {
        "title": "High CPU Usage Detected",
        "description": "CPU utilization has exceeded 85% for over 5 minutes",
        "severity": IssueSeverity.WARNING,
        "category": IssueCategory.PERFORMANCE,
        "ai_explanation": "The database is experiencing elevated CPU load, likely due to complex queries or increased traffic.",
        "ai_recommendations": ["Review slow query log", "Consider query optimization", "Evaluate scaling options"],
    },
    {
        "title": "Connection Limit Approaching",
        "description": "Active connections at 90% of maximum capacity",
        "severity": IssueSeverity.WARNING,
        "category": IssueCategory.CAPACITY,
        "ai_explanation": "Connection pool is nearing exhaustion. This may cause new connections to be rejected.",
        "ai_recommendations": ["Increase max_connections", "Implement connection pooling", "Review connection lifecycle"],
    },
    {
        "title": "Storage Space Low",
        "description": "Available storage below 15% threshold",
        "severity": IssueSeverity.CRITICAL,
        "category": IssueCategory.CAPACITY,
        "ai_explanation": "Disk space is critically low. Database may become read-only if storage is exhausted.",
        "ai_recommendations": ["Expand storage immediately", "Archive old data", "Review data retention policies"],
    },
    {
        "title": "Replication Lag Detected",
        "description": "Replica is lagging behind primary by more than 30 seconds",
        "severity": IssueSeverity.WARNING,
        "category": IssueCategory.AVAILABILITY,
        "ai_explanation": "Data synchronization delay detected between primary and replica instances.",
        "ai_recommendations": ["Check network connectivity", "Review write throughput", "Consider replica scaling"],
    },
    {
        "title": "Deadlock Detected",
        "description": "Multiple deadlocks occurred in the last hour",
        "severity": IssueSeverity.CRITICAL,
        "category": IssueCategory.PERFORMANCE,
        "ai_explanation": "Concurrent transactions are blocking each other, causing performance degradation.",
        "ai_recommendations": ["Review transaction isolation levels", "Optimize lock ordering", "Consider query restructuring"],
    },
    {
        "title": "Backup Failure",
        "description": "Scheduled backup failed to complete",
        "severity": IssueSeverity.CRITICAL,
        "category": IssueCategory.AVAILABILITY,
        "ai_explanation": "The automated backup process failed. Data recovery capability may be compromised.",
        "ai_recommendations": ["Check backup storage availability", "Review backup logs", "Trigger manual backup"],
    },
    {
        "title": "Unusual Query Pattern",
        "description": "Detected anomalous query patterns that may indicate security concerns",
        "severity": IssueSeverity.WARNING,
        "category": IssueCategory.SECURITY,
        "ai_explanation": "Query patterns deviate significantly from baseline, potentially indicating unauthorized access attempts.",
        "ai_recommendations": ["Review query logs", "Check access credentials", "Enable additional monitoring"],
    },
    {
        "title": "Memory Pressure High",
        "description": "Memory usage consistently above 90%",
        "severity": IssueSeverity.WARNING,
        "category": IssueCategory.PERFORMANCE,
        "ai_explanation": "High memory utilization may lead to increased swap usage and degraded performance.",
        "ai_recommendations": ["Increase instance memory", "Review memory-intensive queries", "Optimize buffer pool settings"],
    },
]


async def update_database_metrics(session: AsyncSession):
    """Update metrics for all databases with realistic variations."""
    result = await session.execute(select(Database))
    databases = result.scalars().all()

    updated_count = 0
    for db in databases:
        # Simulate metric changes with some randomness
        cpu_change = random.uniform(-5, 5)
        memory_change = random.uniform(-3, 3)
        storage_change = random.uniform(0, 0.5)  # Storage tends to grow
        connection_change = random.randint(-10, 10)

        new_cpu = max(5, min(99, db.cpu_usage + cpu_change))
        new_memory = max(10, min(99, db.memory_usage + memory_change))
        new_storage = max(10, min(99, db.storage_usage + storage_change))
        new_connections = max(1, min(db.connections_max - 5, db.connections_active + connection_change))

        # Update health score based on metrics
        health_score = 100 - (
            (new_cpu * 0.3) +
            (new_memory * 0.3) +
            (new_storage * 0.2) +
            ((new_connections / db.connections_max) * 100 * 0.2)
        ) / 4
        health_score = max(0, min(100, health_score + random.uniform(-5, 5)))

        # Determine health status
        if health_score >= 80:
            health_status = HealthStatus.HEALTHY
        elif health_score >= 50:
            health_status = HealthStatus.WARNING
        else:
            health_status = HealthStatus.CRITICAL

        # Update database
        db.cpu_usage = round(new_cpu, 2)
        db.memory_usage = round(new_memory, 2)
        db.storage_usage = round(new_storage, 2)
        db.connections_active = new_connections
        db.health_score = round(health_score, 2)
        db.health_status = health_status
        db.last_seen_at = datetime.utcnow()

        # Also insert a metric record for time-series
        for metric_name, value in [
            ("cpu_usage", new_cpu),
            ("memory_usage", new_memory),
            ("storage_usage", new_storage),
            ("connections", new_connections),
        ]:
            metric = Metric(
                database_id=db.id,
                name=metric_name,
                value=value,
                unit="%" if "usage" in metric_name else "count",
                timestamp=datetime.utcnow(),
            )
            session.add(metric)

        updated_count += 1

    await session.commit()
    return updated_count


async def maybe_create_issue(session: AsyncSession):
    """Randomly create a new issue for a database."""
    if random.random() > 0.3:  # 30% chance to create an issue
        return None

    # Get a random database
    result = await session.execute(select(Database))
    databases = result.scalars().all()
    if not databases:
        return None

    db = random.choice(databases)
    template = random.choice(ISSUE_TEMPLATES)

    # Check if similar issue already exists and is active
    existing = await session.execute(
        select(Issue).where(
            Issue.database_id == db.id,
            Issue.title == template["title"],
            Issue.status == IssueStatus.ACTIVE,
        )
    )
    if existing.scalar_one_or_none():
        # Update occurrence count instead
        await session.execute(
            update(Issue)
            .where(Issue.database_id == db.id, Issue.title == template["title"])
            .values(
                occurrence_count=Issue.occurrence_count + 1,
                last_detected_at=datetime.utcnow(),
            )
        )
        await session.commit()
        return f"Updated existing issue: {template['title']} for {db.name}"

    # Create new issue
    issue = Issue(
        database_id=db.id,
        title=template["title"],
        description=template["description"],
        severity=template["severity"],
        category=template["category"],
        status=IssueStatus.ACTIVE,
        ai_explanation=template["ai_explanation"],
        ai_recommendations=template["ai_recommendations"],
        occurrence_count=1,
        first_detected_at=datetime.utcnow(),
        last_detected_at=datetime.utcnow(),
    )
    session.add(issue)

    # Update database issue count
    db.active_issues_count += 1

    await session.commit()
    return f"Created new issue: {template['title']} for {db.name}"


async def maybe_resolve_issue(session: AsyncSession):
    """Randomly resolve an existing issue."""
    if random.random() > 0.2:  # 20% chance to resolve an issue
        return None

    result = await session.execute(
        select(Issue).where(Issue.status == IssueStatus.ACTIVE)
    )
    issues = result.scalars().all()
    if not issues:
        return None

    issue = random.choice(issues)
    issue.status = IssueStatus.RESOLVED
    issue.resolved_at = datetime.utcnow()
    issue.resolved_by = "auto-remediation"

    # Update database issue count
    db_result = await session.execute(
        select(Database).where(Database.id == issue.database_id)
    )
    db = db_result.scalar_one_or_none()
    if db:
        db.active_issues_count = max(0, db.active_issues_count - 1)

    await session.commit()
    return f"Resolved issue: {issue.title}"


async def maybe_create_anomaly(session: AsyncSession):
    """Randomly create a cost anomaly."""
    if random.random() > 0.1:  # 10% chance to create an anomaly
        return None

    result = await session.execute(select(Database))
    databases = result.scalars().all()
    if not databases:
        return None

    db = random.choice(databases)
    anomaly_type = random.choice(list(CostAnomalyType))

    baseline = db.monthly_cost / 30
    deviation = random.uniform(20, 100)
    amount = baseline * (1 + deviation / 100)

    explanations = {
        CostAnomalyType.SPIKE: "Sudden cost increase detected, likely due to traffic surge or resource scaling.",
        CostAnomalyType.SUSTAINED_INCREASE: "Costs have been trending upward over the past several days.",
        CostAnomalyType.UNEXPECTED_CHARGE: "Unexpected charge detected that doesn't match normal patterns.",
    }

    anomaly = CostAnomaly(
        database_id=db.id,
        anomaly_type=anomaly_type,
        amount=round(amount, 2),
        baseline_amount=round(baseline, 2),
        deviation_percent=round(deviation, 2),
        explanation=explanations[anomaly_type],
        possible_causes=["Increased usage", "Scaling event", "Configuration change"],
        detected_at=datetime.utcnow(),
    )
    session.add(anomaly)
    await session.commit()

    return f"Created anomaly: {anomaly_type.value} for {db.name} (${amount:.2f})"


async def run_simulator(interval_seconds: int = 5):
    """Run the real-time simulator."""
    print(f"Starting real-time simulator (updating every {interval_seconds} seconds)")
    print("Press Ctrl+C to stop\n")

    iteration = 0
    while True:
        try:
            async with AsyncSessionLocal() as session:
                iteration += 1
                timestamp = datetime.now().strftime("%H:%M:%S")

                # Update metrics
                updated = await update_database_metrics(session)
                print(f"[{timestamp}] Updated metrics for {updated} databases")

                # Maybe create/resolve issues
                issue_result = await maybe_create_issue(session)
                if issue_result:
                    print(f"[{timestamp}] {issue_result}")

                resolve_result = await maybe_resolve_issue(session)
                if resolve_result:
                    print(f"[{timestamp}] {resolve_result}")

                # Maybe create anomaly (less frequent)
                if iteration % 3 == 0:  # Every 3rd iteration
                    anomaly_result = await maybe_create_anomaly(session)
                    if anomaly_result:
                        print(f"[{timestamp}] {anomaly_result}")

                print()

        except Exception as e:
            print(f"Error: {e}")

        await asyncio.sleep(interval_seconds)


if __name__ == "__main__":
    import sys

    interval = int(sys.argv[1]) if len(sys.argv) > 1 else 5

    try:
        asyncio.run(run_simulator(interval))
    except KeyboardInterrupt:
        print("\nSimulator stopped.")
