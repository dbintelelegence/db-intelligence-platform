"""
Abstract base class for all metrics adapters.

Every source system (Grafana Cloud, Datadog, etc.) implements this interface.
The intelligence pipeline only ever calls these methods — never source-specific code.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class ConnectionResult:
    success: bool
    error: Optional[str] = None          # human-readable, shown to customer


@dataclass
class DiscoveredMetric:
    raw_name: str
    canonical_name: Optional[str]        # None if unmapped
    category: Optional[str]
    unit: Optional[str]
    is_mapped: bool


@dataclass
class DiscoveredCluster:
    cluster_id: str                      # composite key: segment|dc|cluster
    display_name: str
    labels: dict                         # raw label set from source
    metrics_found: list[DiscoveredMetric] = field(default_factory=list)

    @property
    def mapped_count(self) -> int:
        return sum(1 for m in self.metrics_found if m.is_mapped)

    @property
    def unmapped_count(self) -> int:
        return sum(1 for m in self.metrics_found if not m.is_mapped)


@dataclass
class MetricPoint:
    timestamp: datetime
    value: float


@dataclass
class CanonicalMetricSeries:
    canonical_name: str
    cluster_id: str
    points: list[MetricPoint] = field(default_factory=list)


class BaseMetricsAdapter(ABC):

    @abstractmethod
    async def test_connection(self) -> ConnectionResult:
        """
        Test credentials and connectivity.
        Returns ConnectionResult with success=True or an error message.
        Never raises — all errors are captured in ConnectionResult.
        """

    @abstractmethod
    async def discover_clusters(self) -> list[DiscoveredCluster]:
        """
        Find all clusters visible through this connection.
        Checks each metric against the normalisation map.
        Returns list of DiscoveredCluster with mapped/unmapped breakdown.
        """

    @abstractmethod
    async def get_latest_metrics(
        self,
        cluster_id: str,
        canonical_names: list[str],
    ) -> dict[str, float]:
        """
        Fetch the most recent value for each canonical metric name.
        Returns {canonical_name: value}. Missing metrics are omitted.
        """

    @abstractmethod
    async def get_metrics(
        self,
        cluster_id: str,
        canonical_names: list[str],
        start: datetime,
        end: datetime,
        step_seconds: int = 60,
    ) -> list[CanonicalMetricSeries]:
        """
        Fetch time-series data for the given canonical metrics.
        Used by the baseline seeder and historical queries.
        Returns canonical series — raw metric names never leave the adapter.
        """
