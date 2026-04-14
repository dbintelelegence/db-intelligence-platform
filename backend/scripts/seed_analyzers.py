"""
Seed script: populates analyzer_definitions, analyzer_metric_requirements,
and analyzer_log_requirements for all Elasticsearch Phase 1 analyzers.

Run once after initial migration:
  cd backend && python scripts/seed_analyzers.py

This is static data that lives in the DB so the capability map engine
can compute what each cluster can and cannot run.
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import AsyncSessionLocal
from app.models.models import (
    AnalyzerDefinition, AnalyzerMetricRequirement, AnalyzerLogRequirement, DbType
)

ANALYZERS = [
    {
        "analyzer_name": "jvm_heap_pressure",
        "db_type": DbType.elasticsearch,
        "display_name": "JVM heap pressure",
        "description": "Detects heap exhaustion and GC storm patterns. Watches heap utilization and old-gen GC frequency against per-cluster baselines.",
        "min_confidence_without_logs": "medium",
        "phase": 1,
        "required_metrics": [
            {"name": "jvm.heap.used.percent",      "role": "primary"},
            {"name": "gc.old.collection.seconds",  "role": "primary"},
            {"name": "gc.old.collection.count",    "role": "corroborating"},
        ],
        "optional_metrics": [
            {"name": "jvm.heap.used.bytes",  "role": "corroborating"},
            {"name": "jvm.heap.max.bytes",   "role": "corroborating"},
        ],
        "log_signals": [
            {"signal_type": "fielddata_eviction", "is_required": False, "confidence_impact": "+1"},
            {"signal_type": "gc_pause",           "is_required": False, "confidence_impact": "+1"},
            {"signal_type": "circuit_breaker_trip","is_required": False, "confidence_impact": "0"},
        ],
    },
    {
        "analyzer_name": "shard_allocation_failure",
        "db_type": DbType.elasticsearch,
        "display_name": "Shard allocation failure",
        "description": "Detects unassigned shards causing cluster red/yellow state and data unavailability.",
        "min_confidence_without_logs": "high",
        "phase": 1,
        "required_metrics": [
            {"name": "cluster.shards.unassigned", "role": "primary"},
            {"name": "cluster.health.status",     "role": "primary"},
        ],
        "optional_metrics": [
            {"name": "cluster.shards.relocating",   "role": "corroborating"},
            {"name": "cluster.shards.initializing", "role": "corroborating"},
            {"name": "disk.watermark.percent",      "role": "corroborating"},
        ],
        "log_signals": [
            {"signal_type": "shard_failure",         "is_required": False, "confidence_impact": "+1"},
            {"signal_type": "shard_allocation_error","is_required": False, "confidence_impact": "+1"},
            {"signal_type": "node_left",             "is_required": False, "confidence_impact": "0"},
        ],
    },
    {
        "analyzer_name": "thread_pool_saturation",
        "db_type": DbType.elasticsearch,
        "display_name": "Thread pool saturation",
        "description": "Detects write or search thread pool queue saturation causing requests to be rejected.",
        "min_confidence_without_logs": "medium",
        "phase": 1,
        "required_metrics": [
            {"name": "thread_pool.write.rejected", "role": "primary"},
            {"name": "thread_pool.write.queue",    "role": "primary"},
        ],
        "optional_metrics": [
            {"name": "thread_pool.search.rejected", "role": "corroborating"},
            {"name": "thread_pool.search.queue",    "role": "corroborating"},
            {"name": "thread_pool.write.active",    "role": "corroborating"},
        ],
        "log_signals": [
            {"signal_type": "write_rejection",      "is_required": False, "confidence_impact": "+1"},
            {"signal_type": "circuit_breaker_trip", "is_required": False, "confidence_impact": "0"},
        ],
    },
]


async def seed(db: AsyncSession) -> None:
    for spec in ANALYZERS:
        # Check if already exists
        from sqlalchemy import select
        existing = (
            await db.execute(
                select(AnalyzerDefinition).where(
                    AnalyzerDefinition.analyzer_name == spec["analyzer_name"]
                )
            )
        ).scalar_one_or_none()

        if existing:
            print(f"  Already exists: {spec['analyzer_name']} — skipping")
            continue

        analyzer = AnalyzerDefinition(
            analyzer_name=spec["analyzer_name"],
            db_type=spec["db_type"],
            display_name=spec["display_name"],
            description=spec["description"],
            min_confidence_without_logs=spec["min_confidence_without_logs"],
            phase=spec["phase"],
            is_active=True,
        )
        db.add(analyzer)
        await db.flush()

        # Required metrics
        for m in spec["required_metrics"]:
            db.add(AnalyzerMetricRequirement(
                analyzer_id=analyzer.id,
                canonical_metric_name=m["name"],
                is_required=True,
                role=m["role"],
            ))

        # Optional metrics
        for m in spec.get("optional_metrics", []):
            db.add(AnalyzerMetricRequirement(
                analyzer_id=analyzer.id,
                canonical_metric_name=m["name"],
                is_required=False,
                role=m["role"],
            ))

        # Log signal requirements
        for ls in spec["log_signals"]:
            db.add(AnalyzerLogRequirement(
                analyzer_id=analyzer.id,
                signal_type=ls["signal_type"],
                is_required=ls["is_required"],
                confidence_impact=ls["confidence_impact"],
            ))

        print(f"  Seeded: {spec['analyzer_name']}")

    await db.commit()
    print("Seed complete.")


async def main():
    print("Seeding analyzer definitions...")
    async with AsyncSessionLocal() as db:
        await seed(db)


if __name__ == "__main__":
    asyncio.run(main())
