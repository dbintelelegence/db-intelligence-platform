"""
Seed script — MySQL normalisation map.

Creates:
  - One MySQL stack (GCP Prod DB — MySQL) under the existing prototype tenant
  - normalisation_map entries for all confirmed MySQL metrics
  - 4 Alpha MySQL cluster rows

Run from backend/ directory:
  python scripts/seed_mysql_normalisation.py
"""

import asyncio
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.models.models import (
    Tenant, Stack, Cluster, NormalisationMap,
    DbType, SourceType, HealthStatus,
)
from app.core.config import get_settings

settings = get_settings()

TENANT_NAME = "prototype"

MYSQL_STACK = {
    "db_type": DbType.mysql,
    "source_type": SourceType.grafana_cloud,
    "display_name": "GCP Prod DB — MySQL",
    "api_endpoint": settings.grafana_gcp_prod_url,
    "api_key_ref": "env:GRAFANA_GCP_PROD_API_KEY",
    "cluster_label_key": "lp_segment,datacenter,lp_cluster",
    "has_metrics_adapter": True,
    "has_log_adapter": False,
    "has_metadata_adapter": False,
}

MYSQL_ALPHA_CLUSTERS = [
    {"cluster_id": "Alpha|us-east1|mysql_aa_alpha",       "display_name": "mysql_aa_alpha (Alpha)",       "region": "us-east1"},
    {"cluster_id": "Alpha|us-east1|mysql_bigaa_alpha",    "display_name": "mysql_bigaa_alpha (Alpha)",    "region": "us-east1"},
    {"cluster_id": "Alpha|us-east1|mysql_mng_alpha",      "display_name": "mysql_mng_alpha (Alpha)",      "region": "us-east1"},
    {"cluster_id": "Alpha|us-east1|mysql_sharedaa_alpha", "display_name": "mysql_sharedaa_alpha (Alpha)", "region": "us-east1"},
]

# Exporter: prometheus-community/mysqld_exporter (prefix: mysql_) + node_exporter
# Confirmed on mysql_aa_alpha (Alpha environment)
NORMALISATION_ENTRIES = [
    # ── Connection pool saturation analyzer ───────────────────────────────────
    # NOTE: mysql.connection.pct is a CUSTOM_QUERY (ratio computed in PromQL).
    # The two raw metrics below are mapped so the seeder can fetch them for baselines.
    {
        "raw_metric_name": "mysql_global_status_threads_connected",
        "canonical_name": "mysql.connections.current",
        "category": "connections",
        "unit": "count",
    },
    {
        "raw_metric_name": "mysql_global_variables_max_connections",
        "canonical_name": "mysql.connections.max",
        "category": "connections",
        "unit": "count",
    },
    {
        "raw_metric_name": "mysql_global_status_threads_running",
        "canonical_name": "mysql.threads.running",
        "category": "connections",
        "unit": "count",
    },
    # ── Replication lag analyzer ───────────────────────────────────────────────
    # mysql.replication.lag.seconds is also a CUSTOM_QUERY (max across channels).
    {
        "raw_metric_name": "mysql_slave_status_seconds_behind_master",
        "canonical_name": "mysql.replication.lag.seconds",
        "category": "replication",
        "unit": "seconds",
    },
    {
        "raw_metric_name": "mysql_slave_status_slave_io_running",
        "canonical_name": "mysql.replication.io.running",
        "category": "replication",
        "unit": "bool",
    },
    {
        "raw_metric_name": "mysql_slave_status_slave_sql_running",
        "canonical_name": "mysql.replication.sql.running",
        "category": "replication",
        "unit": "bool",
    },
    # ── InnoDB buffer pool pressure analyzer ──────────────────────────────────
    # mysql.buffer.pool.pressure.pct is a CUSTOM_QUERY.
    {
        "raw_metric_name": "mysql_global_variables_innodb_buffer_pool_size",
        "canonical_name": "mysql.buffer.pool.bytes",
        "category": "memory",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_memory_MemAvailable_bytes",
        "canonical_name": "mysql.memory.available.bytes",
        "category": "memory",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_memory_MemTotal_bytes",
        "canonical_name": "mysql.memory.total.bytes",
        "category": "memory",
        "unit": "bytes",
    },
    # ── Corroborating / query quality signals ──────────────────────────────────
    {
        "raw_metric_name": "mysql_global_status_slow_queries",
        "canonical_name": "mysql.slow.queries.total",
        "category": "query",
        "unit": "count",
    },
    {
        "raw_metric_name": "mysql_global_status_queries",
        "canonical_name": "mysql.queries.total",
        "category": "query",
        "unit": "count",
    },
    {
        "raw_metric_name": "mysql_global_status_select_full_join",
        "canonical_name": "mysql.select.full.join",
        "category": "query",
        "unit": "count",
    },
    {
        "raw_metric_name": "mysql_global_status_created_tmp_disk_tables",
        "canonical_name": "mysql.tmp.disk.tables",
        "category": "query",
        "unit": "count",
    },
    {
        "raw_metric_name": "mysql_global_status_table_locks_waited",
        "canonical_name": "mysql.table.locks.waited",
        "category": "locks",
        "unit": "count",
    },
    {
        "raw_metric_name": "mysql_global_status_innodb_row_ops_total",
        "canonical_name": "mysql.innodb.row.ops.total",
        "category": "innodb",
        "unit": "count",
    },
    # ── Query latency (performance_schema — requires performance_schema=ON) ──────
    {
        "raw_metric_name": "mysql_perf_schema_events_statements_seconds_total",
        "canonical_name": "mysql.query.latency.ms",
        "category": "query",
        "unit": "ms",
    },
    # ── Disk (node_exporter — MySQL root mountpoint) ───────────────────────────
    {
        "raw_metric_name": "node_filesystem_size_bytes",
        "canonical_name": "mysql.disk.total.bytes",
        "category": "disk",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_filesystem_avail_bytes",
        "canonical_name": "mysql.disk.available.bytes",
        "category": "disk",
        "unit": "bytes",
    },
    # ── CPU (node_exporter — shared with ES but MySQL-scoped) ─────────────────
    {
        "raw_metric_name": "node_cpu_seconds_total",
        "canonical_name": "mysql.cpu.seconds.total",
        "category": "cpu",
        "unit": "seconds",
    },
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)

        # ── Tenant (must already exist from seed_normalisation.py) ────────────
        result = await db.execute(select(Tenant).where(Tenant.name == TENANT_NAME))
        tenant = result.scalar_one_or_none()
        if not tenant:
            print(f"ERROR: Tenant '{TENANT_NAME}' not found. Run seed_normalisation.py first.")
            return
        print(f"Tenant: {TENANT_NAME} ({tenant.id})")

        # ── MySQL Stack ───────────────────────────────────────────────────────
        result = await db.execute(
            select(Stack).where(
                Stack.tenant_id == tenant.id,
                Stack.source_type == SourceType.grafana_cloud,
                Stack.db_type == DbType.mysql,
            )
        )
        stack = result.scalar_one_or_none()
        if not stack:
            stack = Stack(id=uuid.uuid4(), tenant_id=tenant.id, created_at=now, **MYSQL_STACK)
            db.add(stack)
            await db.flush()
            print(f"Created MySQL stack: {stack.display_name} ({stack.id})")
        else:
            print(f"MySQL stack already exists: {stack.display_name} ({stack.id})")

        # ── Alpha MySQL clusters ───────────────────────────────────────────────
        for c in MYSQL_ALPHA_CLUSTERS:
            result = await db.execute(
                select(Cluster).where(Cluster.cluster_id == c["cluster_id"])
            )
            existing = result.scalar_one_or_none()
            if existing:
                print(f"  SKIP cluster (exists): {c['cluster_id']}")
                continue
            cluster = Cluster(
                id=uuid.uuid4(),
                stack_id=stack.id,
                db_type=DbType.mysql,
                current_status=HealthStatus.unknown,
                created_at=now,
                updated_at=now,
                **c,
            )
            db.add(cluster)
            print(f"  ADD cluster: {c['cluster_id']}")

        # ── Normalisation map ─────────────────────────────────────────────────
        inserted = 0
        skipped = 0
        for entry in NORMALISATION_ENTRIES:
            result = await db.execute(
                select(NormalisationMap).where(
                    NormalisationMap.source_type == SourceType.grafana_cloud,
                    NormalisationMap.db_type == DbType.mysql,
                    NormalisationMap.raw_metric_name == entry["raw_metric_name"],
                )
            )
            if result.scalar_one_or_none():
                skipped += 1
                continue
            db.add(NormalisationMap(
                id=uuid.uuid4(),
                source_type=SourceType.grafana_cloud,
                db_type=DbType.mysql,
                is_active=True,
                created_at=now,
                updated_at=now,
                **entry,
            ))
            inserted += 1

        await db.commit()
        print(f"\nNormalisation map: {inserted} inserted, {skipped} already existed")
        print("MySQL seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
