"""
Seed script to populate the database with sample data for development/testing.
Run with: python -m scripts.seed_data
"""
from __future__ import annotations
import asyncio
import random
from datetime import datetime, timedelta, date
from typing import List
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.core.config import get_settings
from app.db.session import Base
from app.models.database import Database, DatabaseType, CloudProvider, Environment, HealthStatus
from app.models.issue import Issue, IssueSeverity, IssueCategory, IssueStatus
from app.models.billing import BillingRecord, CostAnomaly, CostAnomalyType
from app.models.change import ChangeEvent, ChangeType
from app.models.metric import Metric

settings = get_settings()

# Sample data
DB_NAMES = [
    "users-primary", "orders-db", "inventory-master", "analytics-warehouse",
    "sessions-cache", "payments-db", "notifications-db", "audit-logs",
    "products-catalog", "search-index", "metrics-store", "config-db",
    "auth-db", "billing-db", "reports-db", "events-stream",
]

REGIONS = {
    CloudProvider.AWS: ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"],
    CloudProvider.GCP: ["us-central1", "europe-west1", "asia-east1"],
    CloudProvider.AZURE: ["eastus", "westeurope", "southeastasia"],
}

ISSUE_TEMPLATES = [
    {
        "title": "High CPU utilization detected",
        "description": "CPU usage has exceeded 85% for the past 30 minutes",
        "severity": IssueSeverity.WARNING,
        "category": IssueCategory.PERFORMANCE,
        "ai_explanation": "The database is experiencing elevated CPU usage, likely due to increased query load or inefficient queries.",
        "ai_recommendations": ["Review slow query logs", "Consider adding read replicas", "Analyze query patterns"],
    },
    {
        "title": "Memory pressure warning",
        "description": "Available memory has dropped below 15%",
        "severity": IssueSeverity.WARNING,
        "category": IssueCategory.CAPACITY,
        "ai_explanation": "Memory is running low, which may cause performance degradation or OOM errors.",
        "ai_recommendations": ["Increase instance memory", "Review memory-intensive queries", "Check for memory leaks"],
    },
    {
        "title": "Connection pool exhaustion",
        "description": "Active connections are at 95% of maximum capacity",
        "severity": IssueSeverity.CRITICAL,
        "category": IssueCategory.AVAILABILITY,
        "ai_explanation": "The connection pool is nearly exhausted, which will prevent new connections.",
        "ai_recommendations": ["Increase max connections", "Implement connection pooling", "Review connection leaks"],
    },
    {
        "title": "Storage capacity warning",
        "description": "Storage usage has exceeded 80% of allocated capacity",
        "severity": IssueSeverity.WARNING,
        "category": IssueCategory.CAPACITY,
        "ai_explanation": "Storage is filling up. Without action, the database may run out of space.",
        "ai_recommendations": ["Increase storage allocation", "Archive old data", "Review large tables"],
    },
    {
        "title": "Replication lag detected",
        "description": "Replica is lagging behind primary by more than 60 seconds",
        "severity": IssueSeverity.CRITICAL,
        "category": IssueCategory.AVAILABILITY,
        "ai_explanation": "The replica is significantly behind the primary, which affects data consistency.",
        "ai_recommendations": ["Check network connectivity", "Review write load", "Consider replica sizing"],
    },
    {
        "title": "Unexpected cost increase",
        "description": "Daily cost has increased by 45% compared to baseline",
        "severity": IssueSeverity.WARNING,
        "category": IssueCategory.COST,
        "ai_explanation": "Costs have spiked unexpectedly, possibly due to increased usage or configuration changes.",
        "ai_recommendations": ["Review recent scaling events", "Check for data transfer spikes", "Audit resource usage"],
    },
]


async def create_tables(engine):
    """Create all tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def seed_databases(session: AsyncSession) -> List[Database]:
    """Create sample databases."""
    databases = []

    for i, name in enumerate(DB_NAMES):
        cloud = random.choice(list(CloudProvider))
        region = random.choice(REGIONS[cloud])
        db_type = random.choice(list(DatabaseType))
        env = random.choices(
            list(Environment),
            weights=[0.4, 0.3, 0.3],  # 40% production
        )[0]

        # Health distribution: 60% healthy, 25% warning, 15% critical
        health_roll = random.random()
        if health_roll < 0.60:
            health_status = HealthStatus.HEALTHY
            health_score = random.uniform(85, 100)
            cpu = random.uniform(10, 50)
            memory = random.uniform(20, 60)
            storage = random.uniform(20, 60)
        elif health_roll < 0.85:
            health_status = HealthStatus.WARNING
            health_score = random.uniform(60, 85)
            cpu = random.uniform(50, 80)
            memory = random.uniform(60, 85)
            storage = random.uniform(60, 80)
        else:
            health_status = HealthStatus.CRITICAL
            health_score = random.uniform(20, 60)
            cpu = random.uniform(80, 98)
            memory = random.uniform(85, 98)
            storage = random.uniform(80, 95)

        # Cost based on type and environment
        base_cost = {
            DatabaseType.POSTGRES: 150,
            DatabaseType.MYSQL: 120,
            DatabaseType.MONGODB: 180,
            DatabaseType.REDIS: 80,
            DatabaseType.DYNAMODB: 200,
            DatabaseType.AURORA: 250,
        }[db_type]

        env_multiplier = {
            Environment.PRODUCTION: 2.0,
            Environment.STAGING: 1.0,
            Environment.DEVELOPMENT: 0.5,
        }[env]

        monthly_cost = base_cost * env_multiplier * random.uniform(0.8, 1.5)
        cost_trend = random.uniform(-15, 20)

        database = Database(
            id=uuid4(),
            name=f"{name}-{i+1:02d}",
            type=db_type,
            cloud_provider=cloud,
            region=region,
            environment=env,
            health_status=health_status,
            health_score=health_score,
            cpu_usage=cpu,
            memory_usage=memory,
            storage_usage=storage,
            connections_active=random.randint(10, 90),
            connections_max=100,
            monthly_cost=monthly_cost,
            cost_trend=cost_trend,
            version=f"{random.randint(12, 16)}.{random.randint(0, 9)}",
            instance_type=f"db.r5.{random.choice(['large', 'xlarge', '2xlarge'])}",
            storage_size_gb=random.choice([100, 200, 500, 1000]),
            active_issues_count=0,
            created_at=datetime.utcnow() - timedelta(days=random.randint(30, 365)),
            last_seen_at=datetime.utcnow() - timedelta(minutes=random.randint(0, 5)),
        )
        session.add(database)
        databases.append(database)

    await session.flush()
    return databases


async def seed_issues(session: AsyncSession, databases: List[Database]):
    """Create sample issues for databases."""
    for db in databases:
        # Critical databases get more issues
        if db.health_status == HealthStatus.CRITICAL:
            num_issues = random.randint(2, 4)
        elif db.health_status == HealthStatus.WARNING:
            num_issues = random.randint(1, 2)
        else:
            num_issues = random.randint(0, 1)

        for _ in range(num_issues):
            template = random.choice(ISSUE_TEMPLATES)
            issue = Issue(
                id=uuid4(),
                database_id=db.id,
                title=template["title"],
                description=template["description"],
                severity=template["severity"],
                category=template["category"],
                status=random.choices(
                    [IssueStatus.ACTIVE, IssueStatus.ACKNOWLEDGED],
                    weights=[0.7, 0.3],
                )[0],
                ai_explanation=template["ai_explanation"],
                ai_recommendations=template["ai_recommendations"],
                occurrence_count=random.randint(1, 20),
                first_detected_at=datetime.utcnow() - timedelta(hours=random.randint(1, 72)),
                last_detected_at=datetime.utcnow() - timedelta(minutes=random.randint(5, 60)),
            )
            session.add(issue)
            db.active_issues_count += 1

    await session.flush()


async def seed_billing(session: AsyncSession, databases: List[Database]):
    """Create billing records for the past 30 days."""
    today = date.today()

    for db in databases:
        daily_cost = db.monthly_cost / 30

        for days_ago in range(30):
            billing_date = today - timedelta(days=days_ago)
            # Add some daily variation
            variation = random.uniform(0.85, 1.15)
            total = daily_cost * variation

            record = BillingRecord(
                id=uuid4(),
                database_id=db.id,
                billing_date=billing_date,
                total_cost=total,
                compute_cost=total * 0.6,
                storage_cost=total * 0.25,
                backup_cost=total * 0.05,
                data_transfer_cost=total * 0.08,
                other_cost=total * 0.02,
                currency="USD",
                billing_source=db.cloud_provider.value,
            )
            session.add(record)

    # Add a few cost anomalies
    for _ in range(3):
        db = random.choice(databases)
        anomaly = CostAnomaly(
            id=uuid4(),
            database_id=db.id,
            anomaly_type=random.choice(list(CostAnomalyType)),
            amount=random.uniform(50, 200),
            baseline_amount=random.uniform(20, 80),
            deviation_percent=random.uniform(30, 150),
            explanation="Unexpected cost increase detected due to elevated usage.",
            possible_causes=["Increased query volume", "Data transfer spike", "Scaling event"],
            detected_at=datetime.utcnow() - timedelta(days=random.randint(0, 7)),
        )
        session.add(anomaly)

    await session.flush()


async def seed_changes(session: AsyncSession, databases: List[Database]):
    """Create sample change events."""
    change_templates = [
        ("Configuration update", ChangeType.CONFIG_CHANGE, "Updated max_connections parameter"),
        ("Version upgrade", ChangeType.VERSION_UPGRADE, "Upgraded database version"),
        ("Scaling event", ChangeType.SCALING, "Increased instance size due to load"),
        ("Maintenance window", ChangeType.MAINTENANCE, "Scheduled maintenance completed"),
        ("Failover event", ChangeType.FAILOVER, "Automatic failover to replica"),
    ]

    for db in databases:
        num_changes = random.randint(0, 3)
        for _ in range(num_changes):
            title, change_type, desc = random.choice(change_templates)
            change = ChangeEvent(
                id=uuid4(),
                database_id=db.id,
                change_type=change_type,
                title=title,
                description=desc,
                author=random.choice(["system", "admin@company.com", "devops@company.com"]),
                source=random.choice(["console", "api", "automation"]),
                executed_at=datetime.utcnow() - timedelta(days=random.randint(0, 14)),
                impact_score=random.choice(["low", "medium", "high"]),
            )
            session.add(change)

    await session.flush()


async def seed_metrics(session: AsyncSession, databases: List[Database]):
    """Create sample metric time series (last 24 hours)."""
    now = datetime.utcnow()
    metric_names = ["cpu_usage", "memory_usage", "storage_usage", "connections_active"]

    for db in databases:
        # Create hourly data points for last 24 hours
        for hours_ago in range(24):
            timestamp = now - timedelta(hours=hours_ago)

            for metric_name in metric_names:
                if metric_name == "cpu_usage":
                    base = db.cpu_usage
                    unit = "percent"
                elif metric_name == "memory_usage":
                    base = db.memory_usage
                    unit = "percent"
                elif metric_name == "storage_usage":
                    base = db.storage_usage
                    unit = "percent"
                else:
                    base = float(db.connections_active)
                    unit = "count"

                # Add some variation
                value = base * random.uniform(0.9, 1.1)
                if metric_name != "connections_active":
                    value = min(100, max(0, value))

                metric = Metric(
                    id=uuid4(),
                    database_id=db.id,
                    name=metric_name,
                    value=value,
                    unit=unit,
                    timestamp=timestamp,
                )
                session.add(metric)

    await session.flush()


async def main():
    """Main seed function."""
    print("Starting database seeding...")

    engine = create_async_engine(settings.database_url, echo=False)

    # Create tables
    print("Creating tables...")
    await create_tables(engine)

    # Create session
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        try:
            # Seed data
            print("Seeding databases...")
            databases = await seed_databases(session)
            print(f"  Created {len(databases)} databases")

            print("Seeding issues...")
            await seed_issues(session, databases)

            print("Seeding billing records...")
            await seed_billing(session, databases)

            print("Seeding change events...")
            await seed_changes(session, databases)

            print("Seeding metrics...")
            await seed_metrics(session, databases)

            await session.commit()
            print("\nSeeding completed successfully!")

        except Exception as e:
            await session.rollback()
            print(f"Error during seeding: {e}")
            raise

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
