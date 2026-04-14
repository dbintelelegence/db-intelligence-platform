"""
Add the remaining 4 Alpha Elasticsearch clusters to the DB.

Assumes the prototype tenant + stack + normalisation_map already exist
(run seed_normalisation.py first).

Run from backend/ directory:
  python scripts/seed_alpha_clusters.py
"""

import asyncio
from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.models.models import Cluster, Stack, DbType, HealthStatus

ALPHA_CLUSTERS = [
    {"cluster_id": "Alpha|us-east1|els_shrdegt_alpha_va", "display_name": "els_shrdegt_alpha_va (Alpha)"},
    {"cluster_id": "Alpha|us-east1|els_shrdsix_alpha_va", "display_name": "els_shrdsix_alpha_va (Alpha)"},
    {"cluster_id": "Alpha|us-east1|els_shrdsvn_alpha_va", "display_name": "els_shrdsvn_alpha_va (Alpha)"},
    {"cluster_id": "Alpha|us-east1|els_sixna_alpha_va",   "display_name": "els_sixna_alpha_va (Alpha)"},
]

async def main():
    async with AsyncSessionLocal() as db:
        # Find the existing stack
        stack = (await db.execute(
            select(Stack).where(Stack.display_name == "GCP Prod DB — Elasticsearch")
        )).scalars().first()

        if not stack:
            print("ERROR: Stack not found. Run seed_normalisation.py first.")
            return

        added = 0
        for c in ALPHA_CLUSTERS:
            existing = (await db.execute(
                select(Cluster).where(Cluster.cluster_id == c["cluster_id"])
            )).scalars().first()

            if existing:
                print(f"  SKIP (already exists): {c['cluster_id']}")
                continue

            cluster = Cluster(
                stack_id=stack.id,
                cluster_id=c["cluster_id"],
                db_type=DbType.elasticsearch,
                display_name=c["display_name"],
                region="us-east1",
                current_status=HealthStatus.unknown,
            )
            db.add(cluster)
            added += 1
            print(f"  ADD: {c['cluster_id']}")

        await db.commit()
        print(f"\nDone — {added} cluster(s) added.")

asyncio.run(main())
