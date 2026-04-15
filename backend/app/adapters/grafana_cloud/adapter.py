"""
Grafana Cloud Prometheus adapter.

Pulls metrics from a Grafana Cloud Prometheus-compatible endpoint using
Basic auth (instance_id:api_key).

Discovery findings (els_shrdone_alpha_va — see DISCOVERY_NOTES.md):
  - Cluster identity: composite key lp_segment|datacenter|lp_cluster
  - Engine filter:    lp_role="ElasticSearch"
  - GC label:         gc="old"  (not collector="old")
  - Thread pool:      type="bulk"  (pre-ES6 cluster, no "write" type)
  - jvm.heap.used.percent is DERIVED:
      jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"} * 100

Read-only. Only GET requests. Never modifies customer infrastructure.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import (
    BaseMetricsAdapter, CanonicalMetricSeries, ConnectionResult,
    DiscoveredCluster, DiscoveredMetric, MetricPoint,
)
from app.adapters.exceptions import (
    AdapterError, AdapterAuthError, AdapterNoDataError, AdapterNotFoundError,
    AdapterPermissionError, AdapterRateLimitError, AdapterServerError,
    AdapterTimeoutError,
)
from app.models.models import NormalisationMap, DbType, SourceType


logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

# Label that identifies the engine type in this fleet
ROLE_LABEL = "lp_role"
ROLE_VALUE = "ElasticSearch"

# Labels that together form the unique cluster identity
CLUSTER_LABELS = ["lp_segment", "datacenter", "lp_cluster"]

# Separator for composite cluster_id stored in DB
CLUSTER_ID_SEP = "|"

# Metrics that require label sub-filters beyond the cluster identity
# Format: canonical_name -> {label: value}
LABEL_FILTERS: dict[str, dict[str, str]] = {
    "jvm.heap.used.bytes":    {"area": "heap"},
    "jvm.heap.max.bytes":     {"area": "heap"},
    "jvm.memory.committed.bytes": {"area": "heap"},
    "gc.old.collection.seconds": {"gc": "old"},
    "gc.old.collection.count":   {"gc": "old"},
    "thread_pool.write.rejected": {"type": "bulk"},
    "thread_pool.write.queue":    {"type": "bulk"},
    "thread_pool.write.active":   {"type": "bulk"},
    # cluster health status: filter to color="green" only.
    # The exporter emits 3 series (green/yellow/red) per node, each 0 or 1.
    # max(color="green") = 1 if cluster is green, 0 if yellow or red.
    "cluster.health.status": {"color": "green"},
    # filesystem: filter to ES data mountpoint to measure actual ES data disk usage.
    # /liveperson is the data volume on this fleet; / is the OS root (always ~30%).
    "fs.total.total.bytes":     {"mountpoint": "/liveperson"},
    "fs.total.available.bytes": {"mountpoint": "/liveperson"},
    "fs.total.free.bytes":      {"mountpoint": "/liveperson"},
}

# Derived metrics: canonical_name -> (numerator_canonical, denominator_canonical, multiplier)
# Note: jvm.heap.used.percent moved to CUSTOM_QUERIES for per-node PromQL support.
DERIVED_METRICS: dict[str, tuple[str, str, float]] = {}

# Metrics that Grafana Cloud pre-aggregates and require an explicit aggregation
# function in the query, otherwise return HTTP 422.
# Format: canonical_name -> "aggfn by (label,...)"
REQUIRED_AGGREGATION: dict[str, str] = {
    # max across nodes: 1 = cluster is green, 0 = not green
    "cluster.health.status": "max by (lp_cluster)",
    # thread_pool and jvm metrics are now in CUSTOM_QUERIES — no aggregation needed here
}

# Custom PromQL templates for metrics that can't be expressed as a simple
# raw_metric{labels} query. {sel} is replaced with the cluster label selector.
# The query must return a scalar or a set of per-instance series; the adapter
# averages across instances after substitution.
CUSTOM_QUERIES: dict[str, str] = {
    # CPU % used = 100 - avg idle rate per instance, then averaged across cluster.
    "os.cpu.percent": (
        'avg by (instance) ('
        '  (1 - avg by (instance, cpu) ('
        '    rate(node_cpu_seconds_total{{mode="idle",{sel}}}[5m])'
        '  )) * 100'
        ')'
    ),
    # JVM heap % per node — returns one series per ES node (instance label).
    # Computed server-side so we get accurate per-node ratios.
    # Raw metric names have elasticsearch_ prefix (Prometheus ES exporter convention).
    # ES nodes use the `instance` label (hostname e.g. lpggce-a-elsshrd7-usea1-1).
    # jvm_memory_used/max_bytes can be queried bare — no pre-aggregation restriction.
    "jvm.heap.used.percent": (
        'avg by (instance, lp_cluster) (elasticsearch_jvm_memory_used_bytes{{area="heap",{sel}}}) '
        '/ avg by (instance, lp_cluster) (elasticsearch_jvm_memory_max_bytes{{area="heap",{sel}}}) '
        '* 100'
    ),
    # GC old-gen seconds per node — cumulative counter, can be queried bare.
    "gc.old.collection.seconds": (
        'avg by (instance, lp_cluster) (elasticsearch_jvm_gc_collection_seconds_sum{{gc="old",{sel}}})'
    ),
    # GC old-gen count per node — cumulative counter, can be queried bare.
    "gc.old.collection.count": (
        'avg by (instance, lp_cluster) (elasticsearch_jvm_gc_collection_seconds_count{{gc="old",{sel}}})'
    ),
    # Write thread pool rejected per node.
    # IMPORTANT: Grafana Cloud pre-aggregates thread pool metrics (host: <aggregated>).
    # Must use explicit aggregation or query fails. Type is "write" (not "bulk") on ES7+.
    "thread_pool.write.rejected": (
        'max by (instance, lp_cluster) (elasticsearch_thread_pool_rejected_count{{type="write",{sel}}})'
    ),
    # Write thread pool queue depth per node.
    "thread_pool.write.queue": (
        'max by (instance, lp_cluster) (elasticsearch_thread_pool_queue_count{{type="write",{sel}}})'
    ),
    # Write thread pool active threads per node.
    "thread_pool.write.active": (
        'max by (instance, lp_cluster) (elasticsearch_thread_pool_active_count{{type="write",{sel}}})'
    ),
}

# ── MySQL constants ───────────────────────────────────────────────────────────

MYSQL_ROLE_VALUE = "mysql"

MYSQL_LABEL_FILTERS: dict[str, dict[str, str]] = {
    # Disk: MySQL data lives on root mountpoint
    "mysql.disk.total.bytes":     {"mountpoint": "/"},
    "mysql.disk.available.bytes": {"mountpoint": "/"},
}

MYSQL_DERIVED_METRICS: dict[str, tuple[str, str, float]] = {}

MYSQL_REQUIRED_AGGREGATION: dict[str, str] = {}

MYSQL_CUSTOM_QUERIES: dict[str, str] = {
    # Connection saturation %: avg(threads_connected / max_connections * 100) across instances
    "mysql.connection.pct": (
        'avg by (lp_cluster) ('
        '  mysql_global_status_threads_connected{{{sel}}} / '
        '  mysql_global_variables_max_connections{{{sel}}} * 100'
        ')'
    ),
    # Slow query rate: irate of cumulative counter averaged across instances
    "mysql.slow.query.rate": (
        'avg by (lp_cluster) ('
        '  irate(mysql_global_status_slow_queries{{{sel}}}[5m])'
        ')'
    ),
    # Total query rate: irate of cumulative queries counter — used to distinguish
    # traffic surge (queries up) from connection leak (queries flat)
    "mysql.query.rate": (
        'avg by (lp_cluster) ('
        '  irate(mysql_global_status_queries{{{sel}}}[5m])'
        ')'
    ),
    # Average query execution latency in milliseconds.
    # perf_schema_events_statements_seconds_total / perf_schema_events_statements_total
    # gives avg seconds per statement; multiply by 1000 for ms.
    # Falls back to 0 when performance_schema is disabled or exporter doesn't expose it.
    "mysql.query.latency.ms": (
        'avg by (lp_cluster) ('
        '  rate(mysql_perf_schema_events_statements_seconds_total{{{sel}}}[5m])'
        ') / avg by (lp_cluster) ('
        '  rate(mysql_perf_schema_events_statements_total{{{sel}}}[5m])'
        ') * 1000'
    ),
    # Replication lag: max across all channels and instances (worst-case)
    "mysql.replication.lag.seconds": (
        'max by (lp_cluster) ('
        '  mysql_slave_status_seconds_behind_master{{{sel}}}'
        ')'
    ),
    # IO thread health: avg across instances (< 1.0 means at least one stopped)
    "mysql.replication.io.running": (
        'avg by (lp_cluster) ('
        '  mysql_slave_status_slave_io_running{{{sel}}}'
        ')'
    ),
    # SQL thread health: avg across instances
    "mysql.replication.sql.running": (
        'avg by (lp_cluster) ('
        '  mysql_slave_status_slave_sql_running{{{sel}}}'
        ')'
    ),
    # Buffer pool pressure per instance: buffer_pool_size / mem_total * 100.
    # Measures what fraction of total host RAM is allocated to the buffer pool —
    # the relevant question for configuration sizing (recommended ceiling: 75-80%).
    # mysqld_exporter runs on :14402, node_exporter on :14401 — instance labels differ by port.
    # label_replace strips the port to get a bare hostname, enabling per-host vector matching.
    # Returns one series per instance so the analyzer writes one verdict per node.
    "mysql.buffer.pool.pressure.pct": (
        'label_replace(mysql_global_variables_innodb_buffer_pool_size{{{sel}}}, "host", "$1", "instance", "(.+):\\\\d+") '
        '/ on(host) group_left(lp_instance) '
        'label_replace(node_memory_MemTotal_bytes{{{sel}}}, "host", "$1", "instance", "(.+):\\\\d+") '
        '* 100'
    ),
    # Raw buffer pool size per instance (for evidence text)
    "mysql.buffer.pool.bytes": (
        'mysql_global_variables_innodb_buffer_pool_size{{{sel}}}'
    ),
    # Total RAM per instance (for evidence text)
    "mysql.memory.total.bytes": (
        'node_memory_MemTotal_bytes{{{sel}}}'
    ),
    # Available RAM per instance (secondary signal — how much is currently free)
    "mysql.memory.available.bytes": (
        'node_memory_MemAvailable_bytes{{{sel}}}'
    ),
    # CPU for MySQL nodes (same formula as ES)
    "mysql.os.cpu.percent": (
        'avg by (instance) ('
        '  (1 - avg by (instance, cpu) ('
        '    rate(node_cpu_seconds_total{{mode="idle",{sel}}}[5m])'
        '  )) * 100'
        ')'
    ),
}

# Request timeout in seconds
REQUEST_TIMEOUT = 30.0

# Max retries on rate limit (429)
MAX_RETRIES = 3


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_cluster_id(labels: dict[str, str]) -> str:
    """Build composite cluster ID from the three identity labels."""
    return CLUSTER_ID_SEP.join(labels.get(k, "") for k in CLUSTER_LABELS)


def parse_cluster_id(cluster_id: str) -> dict[str, str]:
    """Reverse composite cluster_id back to label dict for PromQL."""
    parts = cluster_id.split(CLUSTER_ID_SEP)
    if len(parts) != 3:
        raise ValueError(f"Invalid cluster_id format: {cluster_id!r}")
    return dict(zip(CLUSTER_LABELS, parts))


def build_label_selector(labels: dict[str, str]) -> str:
    """Build PromQL label selector string from a dict. No spaces — avoids 422s."""
    parts = [f'{k}="{v}"' for k, v in labels.items()]
    return "{" + ",".join(parts) + "}"


def cluster_selector(cluster_id: str, extra: Optional[dict[str, str]] = None) -> str:
    """
    Build a PromQL label selector for a specific cluster.
    Always uses the full composite key (lp_segment + datacenter + lp_cluster)
    for safety and to minimise API response size.
    """
    labels = parse_cluster_id(cluster_id)
    if extra:
        labels.update(extra)
    return build_label_selector(labels)


# ── Adapter ───────────────────────────────────────────────────────────────────

class GrafanaCloudAdapter(BaseMetricsAdapter):
    """
    Grafana Cloud Prometheus-compatible metrics adapter.

    Args:
        prometheus_url: Base URL e.g. https://prometheus-us-central1.grafana.net/api/prom
        instance_id:    Grafana Cloud instance ID (used as Basic auth username)
        api_key:        Grafana Cloud API key (used as Basic auth password)
        db:             Async SQLAlchemy session (for normalisation map lookups)
    """

    def __init__(
        self,
        prometheus_url: str,
        instance_id: str,
        api_key: str,
        db: AsyncSession,
        db_type: DbType = DbType.elasticsearch,
    ) -> None:
        self._url = prometheus_url.rstrip("/")
        self._auth = (instance_id, api_key)
        self._db = db
        self._db_type = db_type
        self._norm_cache: Optional[dict[str, dict]] = None  # raw_name -> {canonical, category, unit}

        # Select the right constant sets for this db_type
        if db_type == DbType.mysql:
            self._role_value = MYSQL_ROLE_VALUE
            self._label_filters = MYSQL_LABEL_FILTERS
            self._derived_metrics = MYSQL_DERIVED_METRICS
            self._required_aggregation = MYSQL_REQUIRED_AGGREGATION
            self._custom_queries = MYSQL_CUSTOM_QUERIES
        else:
            self._role_value = ROLE_VALUE
            self._label_filters = LABEL_FILTERS
            self._derived_metrics = DERIVED_METRICS
            self._required_aggregation = REQUIRED_AGGREGATION
            self._custom_queries = CUSTOM_QUERIES

    # ── Normalisation map ─────────────────────────────────────────────────────

    async def _load_norm_map(self) -> dict[str, dict]:
        """Load normalisation map from DB. Cached for lifetime of adapter instance."""
        if self._norm_cache is not None:
            return self._norm_cache

        result = await self._db.execute(
            select(NormalisationMap).where(
                NormalisationMap.source_type == SourceType.grafana_cloud,
                NormalisationMap.db_type == self._db_type,
                NormalisationMap.is_active == True,
            )
        )
        self._norm_cache = {
            r.raw_metric_name: {
                "canonical_name": r.canonical_name,
                "category": r.category,
                "unit": r.unit,
            }
            for r in result.scalars()
        }
        logger.debug(f"Loaded {len(self._norm_cache)} normalisation entries")
        return self._norm_cache

    async def _canonical_to_raw(self, canonical_name: str) -> Optional[str]:
        """Reverse lookup: canonical name -> raw metric name."""
        norm = await self._load_norm_map()
        for raw, meta in norm.items():
            if meta["canonical_name"] == canonical_name:
                return raw
        return None

    # ── HTTP ──────────────────────────────────────────────────────────────────

    async def _get(self, path: str, params: dict, retries: int = MAX_RETRIES) -> dict:
        """
        Make authenticated request to Prometheus API.
        Uses POST with form data for query/query_range (avoids 422s from
        httpx double-encoding PromQL curly braces in GET params).
        Uses GET for metadata endpoints (labels, series).
        """
        url = f"{self._url}{path}"
        # Prometheus accepts POST with form data for all query endpoints
        use_post = any(p in path for p in ("/query", "/query_range"))
        for attempt in range(retries):
            try:
                async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                    if use_post:
                        resp = await client.post(url, data=params, auth=self._auth)
                    else:
                        resp = await client.get(url, params=params, auth=self._auth)
            except httpx.TimeoutException:
                raise AdapterTimeoutError(f"Request timed out: {url}")
            except httpx.RequestError as e:
                raise AdapterTimeoutError(f"Connection error: {e}")

            if resp.status_code == 200:
                return resp.json()
            elif resp.status_code == 401:
                raise AdapterAuthError("Invalid credentials. Check instance ID and API key.")
            elif resp.status_code == 403:
                raise AdapterPermissionError("API key lacks read permissions on metrics.")
            elif resp.status_code == 404:
                raise AdapterNotFoundError(f"Endpoint not found: {url}")
            elif resp.status_code == 429:
                if attempt < retries - 1:
                    wait = 2 ** attempt
                    logger.warning(f"Rate limited. Retrying in {wait}s (attempt {attempt + 1}/{retries})")
                    await asyncio.sleep(wait)
                    continue
                raise AdapterRateLimitError("Rate limited after max retries.")
            elif resp.status_code >= 500:
                raise AdapterServerError(f"Source system error: HTTP {resp.status_code}")
            else:
                raise AdapterError(f"Unexpected HTTP {resp.status_code}")  # type: ignore[name-defined]

        raise AdapterRateLimitError("Rate limited after max retries.")

    # ── Public interface ──────────────────────────────────────────────────────

    async def test_connection(self) -> ConnectionResult:
        """Test credentials by querying label names endpoint."""
        try:
            data = await self._get("/api/v1/labels", {})
            if data.get("status") == "success":
                return ConnectionResult(success=True)
            return ConnectionResult(success=False, error="Unexpected response from Prometheus API.")
        except AdapterAuthError as e:
            return ConnectionResult(success=False, error=str(e))
        except AdapterPermissionError as e:
            return ConnectionResult(success=False, error=str(e))
        except AdapterNotFoundError as e:
            return ConnectionResult(success=False, error=str(e))
        except AdapterTimeoutError as e:
            return ConnectionResult(success=False, error=str(e))
        except Exception as e:
            return ConnectionResult(success=False, error=f"Unexpected error: {e}")

    async def discover_clusters(self) -> list[DiscoveredCluster]:
        """
        Find all ElasticSearch clusters in this Grafana Cloud instance.
        Uses full composite key (lp_segment + datacenter + lp_cluster).
        Checks every metric against normalisation map.
        """
        norm = await self._load_norm_map()
        now = int(datetime.now(timezone.utc).timestamp())
        one_hour_ago = now - 3600

        # Find all series with the appropriate lp_role for this db_type
        data = await self._get("/api/v1/series", {
            "match[]": f'{{{ROLE_LABEL}="{self._role_value}"}}',
            "start": one_hour_ago,
            "end": now,
        })

        if data.get("status") != "success":
            raise AdapterNoDataError("Series discovery returned non-success status.")

        # Group series by composite cluster ID
        clusters_raw: dict[str, dict] = {}  # cluster_id -> {labels, metric_names}
        for series in data.get("data", []):
            # Skip series missing any identity label
            if not all(series.get(lbl) for lbl in CLUSTER_LABELS):
                continue
            cid = make_cluster_id(series)
            if cid not in clusters_raw:
                clusters_raw[cid] = {
                    "labels": {k: series[k] for k in CLUSTER_LABELS if k in series},
                    "metric_names": set(),
                }
            metric_name = series.get("__name__", "")
            if metric_name:
                clusters_raw[cid]["metric_names"].add(metric_name)

        # Build DiscoveredCluster objects with mapped/unmapped breakdown
        discovered = []
        for cid, info in clusters_raw.items():
            metrics = []
            for raw_name in sorted(info["metric_names"]):
                mapping = norm.get(raw_name)
                metrics.append(DiscoveredMetric(
                    raw_name=raw_name,
                    canonical_name=mapping["canonical_name"] if mapping else None,
                    category=mapping["category"] if mapping else None,
                    unit=mapping["unit"] if mapping else None,
                    is_mapped=mapping is not None,
                ))
            lp_cluster = info["labels"].get("lp_cluster", cid)
            discovered.append(DiscoveredCluster(
                cluster_id=cid,
                display_name=lp_cluster,
                labels=info["labels"],
                metrics_found=metrics,
            ))
            logger.info(
                f"Discovered cluster {cid}: "
                f"{sum(1 for m in metrics if m.is_mapped)}/{len(metrics)} metrics mapped"
            )

        return discovered

    async def get_latest_metrics(
        self,
        cluster_id: str,
        canonical_names: list[str],
    ) -> dict[str, float]:
        """
        Fetch the most recent value for each canonical metric.
        Handles derived metrics (jvm.heap.used.percent) and label filters.
        Returns {canonical_name: value}. Missing metrics are omitted silently.
        """
        result: dict[str, float] = {}

        # Separate derived from direct metrics
        direct_names = [n for n in canonical_names if n not in self._derived_metrics]
        derived_names = [n for n in canonical_names if n in self._derived_metrics]

        # Fetch all direct metrics (plus any raw inputs needed for derived)
        raw_inputs_needed: set[str] = set()
        for derived in derived_names:
            num_can, den_can, _ = self._derived_metrics[derived]
            raw_inputs_needed.add(num_can)
            raw_inputs_needed.add(den_can)

        all_direct = list(set(direct_names) | raw_inputs_needed)
        raw_values = await self._fetch_latest_direct(cluster_id, all_direct)

        # Populate direct results
        for name in direct_names:
            if name in raw_values:
                result[name] = raw_values[name]

        # Compute derived metrics
        for derived in derived_names:
            num_can, den_can, multiplier = self._derived_metrics[derived]
            num_val = raw_values.get(num_can)
            den_val = raw_values.get(den_can)
            if num_val is not None and den_val and den_val > 0:
                result[derived] = (num_val / den_val) * multiplier

        return result

    async def get_latest_metrics_per_instance(
        self,
        cluster_id: str,
        canonical_names: list[str],
        instance_label: str = "lp_instance",
    ) -> dict[str, dict[str, float]]:
        """
        Fetch the most recent value for each canonical metric, broken out per instance.
        Returns {instance_id: {canonical_name: value}}.

        Only works for custom queries that return per-instance series (i.e. do NOT
        aggregate with 'by (lp_cluster)'). Falls back to get_latest_metrics (cluster avg)
        for metrics without per-instance custom queries.
        """
        base_selector_inner = cluster_selector(cluster_id)[1:-1]
        per_instance: dict[str, dict[str, float]] = {}

        async def fetch_one(canonical: str) -> tuple[str, list[tuple[str, float]]]:
            custom_tmpl = self._custom_queries.get(canonical)
            if not custom_tmpl:
                return canonical, []
            query = custom_tmpl.format(sel=base_selector_inner)
            try:
                data = await self._get("/api/v1/query", {"query": query})
                results = data.get("data", {}).get("result", [])
                pairs = []
                for r in results:
                    if not r.get("value"):
                        continue
                    # Try lp_instance label first, fall back to stripping port from instance
                    iid = r["metric"].get(instance_label)
                    if not iid:
                        raw_inst = r["metric"].get("instance", "")
                        iid = raw_inst.rsplit(":", 1)[0] if ":" in raw_inst else raw_inst
                    if iid:
                        pairs.append((iid, float(r["value"][1])))
                return canonical, pairs
            except Exception as e:
                logger.warning(f"Failed per-instance fetch for {canonical}: {e}")
                return canonical, []

        tasks = [fetch_one(name) for name in canonical_names]
        for canonical, pairs in await asyncio.gather(*tasks):
            for iid, value in pairs:
                per_instance.setdefault(iid, {})[canonical] = value

        return per_instance

    async def _fetch_latest_direct(
        self,
        cluster_id: str,
        canonical_names: list[str],
    ) -> dict[str, float]:
        """Fetch latest values for direct (non-derived) canonical metrics."""
        result: dict[str, float] = {}
        norm = await self._load_norm_map()

        # Build reverse map: canonical -> raw for this request
        canonical_to_raw: dict[str, str] = {}
        for raw, meta in norm.items():
            if meta["canonical_name"] in canonical_names:
                canonical_to_raw[meta["canonical_name"]] = raw

        # Inner selector without extra filters (used for custom queries)
        base_selector_inner = cluster_selector(cluster_id)[1:-1]  # strip { }

        # Fire queries concurrently
        async def fetch_one(canonical: str) -> tuple[str, Optional[float]]:
            # Custom PromQL takes priority — no normalisation map lookup needed
            custom_tmpl = self._custom_queries.get(canonical)
            if custom_tmpl:
                query = custom_tmpl.format(sel=base_selector_inner)
                try:
                    data = await self._get("/api/v1/query", {"query": query})
                    results = data.get("data", {}).get("result", [])
                    if not results:
                        return canonical, None
                    values = [float(r["value"][1]) for r in results if r.get("value")]
                    return canonical, sum(values) / len(values) if values else None
                except (AdapterNoDataError, AdapterServerError) as e:
                    logger.warning(f"Failed to fetch custom {canonical}: {e}")
                    return canonical, None

            raw_name = canonical_to_raw.get(canonical)
            if not raw_name:
                return canonical, None

            extra_filters = self._label_filters.get(canonical, {})
            selector = cluster_selector(cluster_id, extra_filters)
            base = f'{raw_name}{selector}'
            agg = self._required_aggregation.get(canonical)
            query = f'{agg}({base})' if agg else base

            try:
                data = await self._get("/api/v1/query", {"query": query})
                results = data.get("data", {}).get("result", [])
                if not results:
                    return canonical, None
                # Aggregate across nodes: sum for counts/bytes/seconds, mean for gauges
                values = [float(r["value"][1]) for r in results if r.get("value")]
                if not values:
                    return canonical, None
                category = norm[raw_name]["category"]
                unit = norm[raw_name]["unit"]
                if unit in ("count", "bytes", "seconds", "ms") and category != "cpu":
                    return canonical, sum(values)
                else:
                    return canonical, sum(values) / len(values)
            except (AdapterNoDataError, AdapterServerError) as e:
                logger.warning(f"Failed to fetch {canonical}: {e}")
                return canonical, None

        tasks = [fetch_one(name) for name in canonical_names]
        for canonical, value in await asyncio.gather(*tasks):
            if value is not None:
                result[canonical] = value

        return result

    async def get_metrics(
        self,
        cluster_id: str,
        canonical_names: list[str],
        start: datetime,
        end: datetime,
        step_seconds: int = 60,
    ) -> list[CanonicalMetricSeries]:
        """
        Fetch time-series data for baseline seeding and historical queries.
        Returns one CanonicalMetricSeries per canonical metric.
        Values are aggregated across nodes (sum for counters, mean for gauges).
        """
        norm = await self._load_norm_map()
        start_ts = int(start.timestamp())
        end_ts = int(end.timestamp())
        series_out: list[CanonicalMetricSeries] = []

        async def fetch_range(canonical: str) -> Optional[CanonicalMetricSeries]:
            # Handle custom queries for range fetching
            custom_tmpl = self._custom_queries.get(canonical)
            if custom_tmpl:
                base_selector_inner = cluster_selector(cluster_id)[1:-1]
                query = custom_tmpl.format(sel=base_selector_inner)
                try:
                    data = await self._get("/api/v1/query_range", {
                        "query": query,
                        "start": start_ts,
                        "end": end_ts,
                        "step": f"{step_seconds}s",
                    })
                    results = data.get("data", {}).get("result", [])
                    if not results:
                        return None
                    points = [
                        MetricPoint(
                            timestamp=datetime.fromtimestamp(float(ts), tz=timezone.utc),
                            value=float(val),
                        )
                        for ts, val in results[0].get("values", [])
                    ]
                    return CanonicalMetricSeries(canonical_name=canonical, cluster_id=cluster_id, points=points)
                except Exception as e:
                    logger.warning(f"Failed to fetch custom range for {canonical}: {e}")
                    return None

            # Handle derived metrics
            if canonical in self._derived_metrics:
                return await self._fetch_derived_range(
                    cluster_id, canonical, start_ts, end_ts, step_seconds, norm
                )

            raw_name = next(
                (r for r, m in norm.items() if m["canonical_name"] == canonical), None
            )
            if not raw_name:
                logger.warning(f"No raw metric found for canonical: {canonical}")
                return None

            extra_filters = self._label_filters.get(canonical, {})
            selector = cluster_selector(cluster_id, extra_filters)
            unit = norm[raw_name]["unit"]
            category = norm[raw_name]["category"]
            agg = self._required_aggregation.get(canonical)

            if agg:
                # Metric requires a specific aggregation (e.g. pre-aggregated by Grafana Cloud)
                query = f'{agg}({raw_name}{selector})'
            elif unit in ("count", "bytes", "seconds") and category != "cpu":
                query = f'sum({raw_name}{selector})'
            else:
                query = f'avg({raw_name}{selector})'

            try:
                data = await self._get("/api/v1/query_range", {
                    "query": query,
                    "start": start_ts,
                    "end": end_ts,
                    "step": f"{step_seconds}s",
                })
                results = data.get("data", {}).get("result", [])
                if not results:
                    return None

                points = [
                    MetricPoint(
                        timestamp=datetime.fromtimestamp(float(ts), tz=timezone.utc),
                        value=float(val),
                    )
                    for ts, val in results[0].get("values", [])
                ]
                return CanonicalMetricSeries(
                    canonical_name=canonical,
                    cluster_id=cluster_id,
                    points=points,
                )
            except Exception as e:
                logger.warning(f"Failed to fetch range for {canonical}: {e}")
                return None

        tasks = [fetch_range(name) for name in canonical_names]
        for series in await asyncio.gather(*tasks):
            if series is not None:
                series_out.append(series)

        return series_out

    async def _fetch_derived_range(
        self,
        cluster_id: str,
        canonical: str,
        start_ts: int,
        end_ts: int,
        step_seconds: int,
        norm: dict,
    ) -> Optional[CanonicalMetricSeries]:
        """Fetch and compute a derived metric over a time range."""
        num_can, den_can, multiplier = self._derived_metrics[canonical]

        num_raw = next((r for r, m in norm.items() if m["canonical_name"] == num_can), None)
        den_raw = next((r for r, m in norm.items() if m["canonical_name"] == den_can), None)
        if not num_raw or not den_raw:
            return None

        num_filters = self._label_filters.get(num_can, {})
        den_filters = self._label_filters.get(den_can, {})
        num_sel = cluster_selector(cluster_id, num_filters)
        den_sel = cluster_selector(cluster_id, den_filters)

        # Use a single PromQL expression to compute the ratio server-side
        query = (
            f'avg({num_raw}{num_sel}) / avg({den_raw}{den_sel}) * {multiplier}'
        )

        try:
            data = await self._get("/api/v1/query_range", {
                "query": query,
                "start": start_ts,
                "end": end_ts,
                "step": f"{step_seconds}s",
            })
            results = data.get("data", {}).get("result", [])
            if not results:
                return None

            points = [
                MetricPoint(
                    timestamp=datetime.fromtimestamp(float(ts), tz=timezone.utc),
                    value=float(val),
                )
                for ts, val in results[0].get("values", [])
            ]
            return CanonicalMetricSeries(
                canonical_name=canonical,
                cluster_id=cluster_id,
                points=points,
            )
        except Exception as e:
            logger.warning(f"Failed to fetch derived range for {canonical}: {e}")
            return None
