"""
Seed script for Step 2.

Creates:
  - One prototype tenant
  - One Grafana Cloud / Elasticsearch stack (GCP Prod)
  - One cluster row: els_shrdone_alpha_va (Alpha — prototype target)
  - normalisation_map entries for all confirmed ES metrics from DISCOVERY_NOTES.md

Run from backend/ directory:
  python scripts/seed_normalisation.py
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

# ── Prototype seed data ───────────────────────────────────────────────────────

TENANT_NAME = "prototype"

STACK = {
    "db_type": DbType.elasticsearch,
    "source_type": SourceType.grafana_cloud,
    "display_name": "GCP Prod DB — Elasticsearch",
    "api_endpoint": settings.grafana_gcp_prod_url,
    "api_key_ref": "env:GRAFANA_GCP_PROD_API_KEY",
    # Composite cluster identity: lp_segment + datacenter + lp_cluster
    # Stored as comma-separated label keys; adapter resolves to composite string
    "cluster_label_key": "lp_segment,datacenter,lp_cluster",
    "has_metrics_adapter": True,
    "has_log_adapter": False,
    "has_metadata_adapter": False,
}

# Single prototype cluster — els_shrdone_alpha_va (Alpha environment)
CLUSTER = {
    "cluster_id": "Alpha|us-east1|els_shrdone_alpha_va",
    "db_type": DbType.elasticsearch,
    "display_name": "els_shrdone_alpha_va (Alpha)",
    "region": "us-east1",
}

# ── Normalisation map — confirmed from DISCOVERY_NOTES.md ─────────────────────
# source_type: grafana_cloud | db_type: elasticsearch
# Exporter: prometheus-community/elasticsearch_exporter (prefix: elasticsearch_)
#
# NOTE: jvm.heap.used.percent is a DERIVED metric — not directly available.
# The adapter computes it from:
#   elasticsearch_jvm_memory_used_bytes{area="heap"} /
#   elasticsearch_jvm_memory_max_bytes{area="heap"} * 100
# Both raw metrics are mapped here so the adapter can fetch them.

NORMALISATION_ENTRIES = [
    # ── JVM Heap — raw inputs for derived jvm.heap.used.percent ──────────────
    {
        "raw_metric_name": "elasticsearch_jvm_memory_used_bytes",
        "canonical_name": "jvm.heap.used.bytes",
        "category": "jvm",
        "unit": "bytes",
        # label filter required: area="heap"
    },
    {
        "raw_metric_name": "elasticsearch_jvm_memory_max_bytes",
        "canonical_name": "jvm.heap.max.bytes",
        "category": "jvm",
        "unit": "bytes",
        # label filter required: area="heap"
    },
    # ── GC — filter by gc="old" (label is "gc", not "collector") ───────────────
    {
        "raw_metric_name": "elasticsearch_jvm_gc_collection_seconds_sum",
        "canonical_name": "gc.old.collection.seconds",
        "category": "jvm",
        "unit": "seconds",
    },
    {
        "raw_metric_name": "elasticsearch_jvm_gc_collection_seconds_count",
        "canonical_name": "gc.old.collection.count",
        "category": "jvm",
        "unit": "count",
    },
    # ── Shard allocation ─────────────────────────────────────────────────────
    {
        "raw_metric_name": "elasticsearch_cluster_health_unassigned_shards",
        "canonical_name": "cluster.shards.unassigned",
        "category": "shard",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_cluster_health_status",
        "canonical_name": "cluster.health.status",
        "category": "shard",
        "unit": "status",
    },
    {
        "raw_metric_name": "elasticsearch_cluster_health_relocating_shards",
        "canonical_name": "cluster.shards.relocating",
        "category": "shard",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_cluster_health_initializing_shards",
        "canonical_name": "cluster.shards.initializing",
        "category": "shard",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_cluster_health_active_shards",
        "canonical_name": "cluster.shards.active",
        "category": "shard",
        "unit": "count",
    },
    # ── Thread pool — filter by type="bulk" (cluster is pre-ES6, no "write" type) ──
    {
        "raw_metric_name": "elasticsearch_thread_pool_rejected_count",
        "canonical_name": "thread_pool.write.rejected",
        "category": "io",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_thread_pool_queue_count",
        "canonical_name": "thread_pool.write.queue",
        "category": "io",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_thread_pool_active_count",
        "canonical_name": "thread_pool.write.active",
        "category": "io",
        "unit": "count",
    },
    # ── Future analyzers (Phase 2+) — mapped now, not yet used ───────────────
    {
        "raw_metric_name": "elasticsearch_indices_fielddata_evictions",
        "canonical_name": "fielddata.evictions",
        "category": "cache",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_indices_fielddata_memory_size_bytes",
        "canonical_name": "fielddata.memory.bytes",
        "category": "cache",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "elasticsearch_indices_search_query_time_seconds",
        "canonical_name": "search.query.time.ms",
        "category": "search",
        "unit": "ms",
    },
    {
        "raw_metric_name": "elasticsearch_indices_search_query_total",
        "canonical_name": "search.query.total",
        "category": "search",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_indices_indexing_index_total",
        "canonical_name": "indexing.index.total",
        "category": "indexing",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_breakers_tripped",
        "canonical_name": "circuit_breaker.tripped",
        "category": "memory",
        "unit": "count",
    },
    {
        "raw_metric_name": "node_filesystem_avail_bytes",
        "canonical_name": "fs.total.available.bytes",
        "category": "disk",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_filesystem_size_bytes",
        "canonical_name": "fs.total.total.bytes",
        "category": "disk",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_cpu_seconds_total",
        "canonical_name": "cpu.seconds.total",
        "category": "cpu",
        "unit": "seconds",
    },
    # ── Cluster health — additional ───────────────────────────────────────────
    {
        "raw_metric_name": "elasticsearch_cluster_health_active_primary_shards",
        "canonical_name": "cluster.shards.active.primary",
        "category": "shard",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_cluster_health_delayed_unassigned_shards",
        "canonical_name": "cluster.shards.delayed.unassigned",
        "category": "shard",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_cluster_health_number_of_data_nodes",
        "canonical_name": "cluster.nodes.data",
        "category": "cluster",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_cluster_health_number_of_nodes",
        "canonical_name": "cluster.nodes.total",
        "category": "cluster",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_cluster_health_number_of_pending_tasks",
        "canonical_name": "cluster.pending.tasks",
        "category": "cluster",
        "unit": "count",
    },
    # ── Cluster info ──────────────────────────────────────────────────────────
    {
        "raw_metric_name": "elasticsearch_clusterinfo_version_info",
        "canonical_name": "cluster.version.info",
        "category": "cluster",
        "unit": "info",
    },
    {
        "raw_metric_name": "elasticsearch_node_stats_up",
        "canonical_name": "node.stats.up",
        "category": "cluster",
        "unit": "bool",
    },
    # ── JVM — additional ──────────────────────────────────────────────────────
    {
        "raw_metric_name": "elasticsearch_jvm_memory_committed_bytes",
        "canonical_name": "jvm.memory.committed.bytes",
        "category": "jvm",
        "unit": "bytes",
    },
    # ── Indices — docs and sizing ─────────────────────────────────────────────
    {
        "raw_metric_name": "elasticsearch_indices_docs",
        "canonical_name": "indices.docs.count",
        "category": "indexing",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_indices_store_size_bytes_total",
        "canonical_name": "indices.store.size.bytes",
        "category": "indexing",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "elasticsearch_indices_segments_count",
        "canonical_name": "indices.segments.count",
        "category": "indexing",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_indices_segments_memory_bytes",
        "canonical_name": "indices.segments.memory.bytes",
        "category": "indexing",
        "unit": "bytes",
    },
    # ── Indices — indexing ────────────────────────────────────────────────────
    {
        "raw_metric_name": "elasticsearch_indices_indexing_index_time_seconds_total",
        "canonical_name": "indexing.index.time.seconds",
        "category": "indexing",
        "unit": "seconds",
    },
    {
        "raw_metric_name": "elasticsearch_indices_indexing_delete_total",
        "canonical_name": "indexing.delete.total",
        "category": "indexing",
        "unit": "count",
    },
    # ── Indices — search ──────────────────────────────────────────────────────
    {
        "raw_metric_name": "elasticsearch_indices_search_fetch_time_seconds",
        "canonical_name": "search.fetch.time.seconds",
        "category": "search",
        "unit": "seconds",
    },
    {
        "raw_metric_name": "elasticsearch_indices_search_fetch_total",
        "canonical_name": "search.fetch.total",
        "category": "search",
        "unit": "count",
    },
    # ── Indices — merges ──────────────────────────────────────────────────────
    {
        "raw_metric_name": "elasticsearch_indices_merges_total",
        "canonical_name": "indices.merges.total",
        "category": "indexing",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_indices_merges_docs_total",
        "canonical_name": "indices.merges.docs.total",
        "category": "indexing",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_indices_merges_total_size_bytes_total",
        "canonical_name": "indices.merges.size.bytes",
        "category": "indexing",
        "unit": "bytes",
    },
    # ── Indices — refresh and flush ───────────────────────────────────────────
    {
        "raw_metric_name": "elasticsearch_indices_refresh_total",
        "canonical_name": "indices.refresh.total",
        "category": "indexing",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_indices_refresh_time_seconds_total",
        "canonical_name": "indices.refresh.time.seconds",
        "category": "indexing",
        "unit": "seconds",
    },
    {
        "raw_metric_name": "elasticsearch_indices_flush_total",
        "canonical_name": "indices.flush.total",
        "category": "indexing",
        "unit": "count",
    },
    # ── Indices — get ─────────────────────────────────────────────────────────
    {
        "raw_metric_name": "elasticsearch_indices_get_exists_total",
        "canonical_name": "indices.get.exists.total",
        "category": "search",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_indices_get_missing_total",
        "canonical_name": "indices.get.missing.total",
        "category": "search",
        "unit": "count",
    },
    # ── Indices — translog ────────────────────────────────────────────────────
    {
        "raw_metric_name": "elasticsearch_indices_translog_operations",
        "canonical_name": "indices.translog.operations",
        "category": "indexing",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_indices_translog_size_in_bytes",
        "canonical_name": "indices.translog.size.bytes",
        "category": "indexing",
        "unit": "bytes",
    },
    # ── Process ───────────────────────────────────────────────────────────────
    {
        "raw_metric_name": "elasticsearch_process_open_files_count",
        "canonical_name": "process.open.files",
        "category": "process",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_process_max_files_descriptors",
        "canonical_name": "process.max.files",
        "category": "process",
        "unit": "count",
    },
    {
        "raw_metric_name": "elasticsearch_os_load5",
        "canonical_name": "os.load.5m",
        "category": "cpu",
        "unit": "ratio",
    },
    {
        "raw_metric_name": "elasticsearch_snapshot_status",
        "canonical_name": "snapshot.status",
        "category": "cluster",
        "unit": "status",
    },
    # ── Node — disk ───────────────────────────────────────────────────────────
    {
        "raw_metric_name": "node_filesystem_free_bytes",
        "canonical_name": "fs.total.free.bytes",
        "category": "disk",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_disk_io_time_seconds_total",
        "canonical_name": "disk.io.time.seconds",
        "category": "disk",
        "unit": "seconds",
    },
    {
        "raw_metric_name": "node_disk_io_now",
        "canonical_name": "disk.io.now",
        "category": "disk",
        "unit": "count",
    },
    {
        "raw_metric_name": "node_disk_read_bytes_total",
        "canonical_name": "disk.read.bytes",
        "category": "disk",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_disk_written_bytes_total",
        "canonical_name": "disk.written.bytes",
        "category": "disk",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_disk_reads_completed_total",
        "canonical_name": "disk.reads.completed",
        "category": "disk",
        "unit": "count",
    },
    {
        "raw_metric_name": "node_disk_writes_completed_total",
        "canonical_name": "disk.writes.completed",
        "category": "disk",
        "unit": "count",
    },
    {
        "raw_metric_name": "node_disk_read_time_seconds_total",
        "canonical_name": "disk.read.time.seconds",
        "category": "disk",
        "unit": "seconds",
    },
    {
        "raw_metric_name": "node_disk_write_time_seconds_total",
        "canonical_name": "disk.write.time.seconds",
        "category": "disk",
        "unit": "seconds",
    },
    # ── Node — memory ─────────────────────────────────────────────────────────
    {
        "raw_metric_name": "node_memory_MemAvailable_bytes",
        "canonical_name": "memory.available.bytes",
        "category": "memory",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_memory_MemTotal_bytes",
        "canonical_name": "memory.total.bytes",
        "category": "memory",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_memory_MemFree_bytes",
        "canonical_name": "memory.free.bytes",
        "category": "memory",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_memory_Cached_bytes",
        "canonical_name": "memory.cached.bytes",
        "category": "memory",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_memory_Buffers_bytes",
        "canonical_name": "memory.buffers.bytes",
        "category": "memory",
        "unit": "bytes",
    },
    # ── Node — network ────────────────────────────────────────────────────────
    {
        "raw_metric_name": "node_network_receive_bytes_total",
        "canonical_name": "network.receive.bytes",
        "category": "network",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_network_transmit_bytes_total",
        "canonical_name": "network.transmit.bytes",
        "category": "network",
        "unit": "bytes",
    },
    {
        "raw_metric_name": "node_network_receive_drop_total",
        "canonical_name": "network.receive.drops",
        "category": "network",
        "unit": "count",
    },
    {
        "raw_metric_name": "node_network_transmit_drop_total",
        "canonical_name": "network.transmit.drops",
        "category": "network",
        "unit": "count",
    },
    {
        "raw_metric_name": "node_network_receive_errs_total",
        "canonical_name": "network.receive.errors",
        "category": "network",
        "unit": "count",
    },
    {
        "raw_metric_name": "node_network_transmit_errs_total",
        "canonical_name": "network.transmit.errors",
        "category": "network",
        "unit": "count",
    },
    # ── Node — system ─────────────────────────────────────────────────────────
    {
        "raw_metric_name": "node_systemd_unit_state",
        "canonical_name": "node.systemd.unit.state",
        "category": "process",
        "unit": "status",
    },
    {
        "raw_metric_name": "node_time_seconds",
        "canonical_name": "node.time.seconds",
        "category": "process",
        "unit": "seconds",
    },
    {
        "raw_metric_name": "up",
        "canonical_name": "scrape.up",
        "category": "cluster",
        "unit": "bool",
    },
]


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)

        # ── Tenant ────────────────────────────────────────────────────────────
        result = await db.execute(select(Tenant).where(Tenant.name == TENANT_NAME))
        tenant = result.scalar_one_or_none()
        if not tenant:
            tenant = Tenant(id=uuid.uuid4(), name=TENANT_NAME, created_at=now)
            db.add(tenant)
            await db.flush()
            print(f"Created tenant: {TENANT_NAME} ({tenant.id})")
        else:
            print(f"Tenant already exists: {TENANT_NAME} ({tenant.id})")

        # ── Stack ─────────────────────────────────────────────────────────────
        result = await db.execute(
            select(Stack).where(
                Stack.tenant_id == tenant.id,
                Stack.source_type == SourceType.grafana_cloud,
                Stack.db_type == DbType.elasticsearch,
            )
        )
        stack = result.scalar_one_or_none()
        if not stack:
            stack = Stack(
                id=uuid.uuid4(),
                tenant_id=tenant.id,
                created_at=now,
                **STACK,
            )
            db.add(stack)
            await db.flush()
            print(f"Created stack: {stack.display_name} ({stack.id})")
        else:
            print(f"Stack already exists: {stack.display_name} ({stack.id})")

        # ── Cluster ───────────────────────────────────────────────────────────
        result = await db.execute(
            select(Cluster).where(Cluster.cluster_id == CLUSTER["cluster_id"])
        )
        cluster = result.scalar_one_or_none()
        if not cluster:
            cluster = Cluster(
                id=uuid.uuid4(),
                stack_id=stack.id,
                current_status=HealthStatus.unknown,
                created_at=now,
                updated_at=now,
                **CLUSTER,
            )
            db.add(cluster)
            await db.flush()
            print(f"Created cluster: {cluster.display_name} ({cluster.id})")
        else:
            print(f"Cluster already exists: {cluster.display_name} ({cluster.id})")

        # ── Normalisation map ─────────────────────────────────────────────────
        inserted = 0
        skipped = 0
        for entry in NORMALISATION_ENTRIES:
            result = await db.execute(
                select(NormalisationMap).where(
                    NormalisationMap.source_type == SourceType.grafana_cloud,
                    NormalisationMap.db_type == DbType.elasticsearch,
                    NormalisationMap.raw_metric_name == entry["raw_metric_name"],
                )
            )
            existing = result.scalar_one_or_none()
            if not existing:
                db.add(NormalisationMap(
                    id=uuid.uuid4(),
                    source_type=SourceType.grafana_cloud,
                    db_type=DbType.elasticsearch,
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                    **entry,
                ))
                inserted += 1
            else:
                skipped += 1

        await db.commit()
        print(f"Normalisation map: {inserted} inserted, {skipped} already existed")
        print("\nSeed complete.")
        print(f"  Tenant ID : {tenant.id}")
        print(f"  Stack ID  : {stack.id}")
        print(f"  Cluster ID: {cluster.id}")


if __name__ == "__main__":
    asyncio.run(seed())
