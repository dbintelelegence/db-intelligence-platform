"""
Baseline Engine

Computes per-cluster, per-metric percentile profiles from ingested metric history.
Run nightly. Results stored in baseline_profiles table.

Key design decisions:
- Uses numpy for percentile computation — no ML, just statistics
- Supports time-aware windows: all | weekday | weekend | business_hours | off_hours
- Requires minimum sample count before a baseline is considered valid
- Sigma score is the primary comparison unit used by analyzers
"""

import numpy as np
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.models.models import BaselineProfile, Cluster
from app.core.config import get_settings

settings = get_settings()


# ── Window types ──────────────────────────────────────────────────────────────

WINDOW_ALL = "all"
WINDOW_WEEKDAY = "weekday"
WINDOW_WEEKEND = "weekend"
WINDOW_BUSINESS = "business_hours"   # Mon-Fri 08:00-18:00
WINDOW_OFF_HOURS = "off_hours"       # Everything else


def classify_window(ts: datetime) -> list[str]:
    """
    Returns all window types that a timestamp belongs to.
    A timestamp can belong to multiple windows simultaneously.
    """
    windows = [WINDOW_ALL]
    is_weekday = ts.weekday() < 5  # Mon=0, Fri=4

    if is_weekday:
        windows.append(WINDOW_WEEKDAY)
    else:
        windows.append(WINDOW_WEEKEND)

    if is_weekday and 8 <= ts.hour < 18:
        windows.append(WINDOW_BUSINESS)
    else:
        windows.append(WINDOW_OFF_HOURS)

    return windows


# ── Core percentile computation ───────────────────────────────────────────────

class BaselineResult:
    """Result of computing a baseline for one cluster + metric + window."""

    def __init__(
        self,
        canonical_metric_name: str,
        window_type: str,
        values: list[float],
        covers_from: datetime,
        covers_to: datetime,
    ):
        arr = np.array(values, dtype=float)
        self.canonical_metric_name = canonical_metric_name
        self.window_type = window_type
        self.sample_count = len(arr)
        self.p50 = float(np.percentile(arr, 50))
        self.p75 = float(np.percentile(arr, 75))
        self.p95 = float(np.percentile(arr, 95))
        self.p99 = float(np.percentile(arr, 99))
        self.mean = float(np.mean(arr))
        self.std_dev = float(np.std(arr))
        self.covers_from = covers_from
        self.covers_to = covers_to

    @property
    def is_valid(self) -> bool:
        """Baseline is only valid when we have enough samples."""
        return self.sample_count >= settings.baseline_min_samples

    def sigma_score(self, observed_value: float) -> float:
        """
        How many standard deviations is the observed value from the mean?
        Positive = above mean, negative = below mean.
        Returns 0.0 if std_dev is 0 (all values identical).
        """
        if self.std_dev == 0:
            return 0.0
        return (observed_value - self.mean) / self.std_dev

    def deviation_from_p50(self, observed_value: float) -> float:
        """Percentage deviation from the median."""
        if self.p50 == 0:
            return 0.0
        return ((observed_value - self.p50) / self.p50) * 100


def compute_baseline(
    canonical_metric_name: str,
    window_type: str,
    samples: list[tuple[datetime, float]],
    lookback_days: int = 30,
) -> BaselineResult | None:
    """
    Compute a baseline profile from a list of (timestamp, value) samples.
    Returns None if insufficient samples.

    Args:
        canonical_metric_name: The metric being baselined
        window_type: Which time window to compute for
        samples: List of (timestamp, value) tuples — all data in the lookback window
        lookback_days: How many days of data to use

    Returns:
        BaselineResult if enough samples, None otherwise
    """
    now = datetime.utcnow()
    cutoff = now - timedelta(days=lookback_days)

    # Filter to samples within the lookback window
    relevant = [
        (ts, v) for ts, v in samples
        if ts >= cutoff and window_type in classify_window(ts)
    ]

    if len(relevant) < settings.baseline_min_samples:
        return None

    timestamps = [ts for ts, _ in relevant]
    values = [v for _, v in relevant]

    return BaselineResult(
        canonical_metric_name=canonical_metric_name,
        window_type=window_type,
        values=values,
        covers_from=min(timestamps),
        covers_to=max(timestamps),
    )


# ── Database persistence ──────────────────────────────────────────────────────

async def upsert_baseline(
    db: AsyncSession,
    cluster_id: str,
    result: BaselineResult,
) -> BaselineProfile:
    """
    Insert or update a baseline profile in the database.
    Uses cluster_id + canonical_metric_name + window_type as the unique key.
    """
    # Try to find existing
    stmt = select(BaselineProfile).where(
        and_(
            BaselineProfile.cluster_id == cluster_id,
            BaselineProfile.canonical_metric_name == result.canonical_metric_name,
            BaselineProfile.window_type == result.window_type,
        )
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()

    if existing:
        existing.p50 = result.p50
        existing.p75 = result.p75
        existing.p95 = result.p95
        existing.p99 = result.p99
        existing.mean = result.mean
        existing.std_dev = result.std_dev
        existing.sample_count = result.sample_count
        existing.computed_at = datetime.utcnow()
        existing.covers_from = result.covers_from
        existing.covers_to = result.covers_to
        return existing
    else:
        profile = BaselineProfile(
            cluster_id=cluster_id,
            canonical_metric_name=result.canonical_metric_name,
            window_type=result.window_type,
            p50=result.p50,
            p75=result.p75,
            p95=result.p95,
            p99=result.p99,
            mean=result.mean,
            std_dev=result.std_dev,
            sample_count=result.sample_count,
            computed_at=datetime.utcnow(),
            covers_from=result.covers_from,
            covers_to=result.covers_to,
        )
        db.add(profile)
        return profile


async def get_baseline(
    db: AsyncSession,
    cluster_id: str,
    canonical_metric_name: str,
    window_type: str = WINDOW_ALL,
) -> BaselineProfile | None:
    """
    Fetch a baseline profile for a specific cluster + metric + window.
    Returns None if no baseline exists (analyzer will run at LOW confidence).
    """
    stmt = select(BaselineProfile).where(
        and_(
            BaselineProfile.cluster_id == cluster_id,
            BaselineProfile.canonical_metric_name == canonical_metric_name,
            BaselineProfile.window_type == window_type,
        )
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_baselines_for_cluster(
    db: AsyncSession,
    cluster_id: str,
    window_type: str = WINDOW_ALL,
) -> dict[str, BaselineProfile]:
    """
    Fetch all baseline profiles for a cluster as a dict keyed by metric name.
    Used by analyzers to look up all required baselines in one query.
    """
    stmt = select(BaselineProfile).where(
        and_(
            BaselineProfile.cluster_id == cluster_id,
            BaselineProfile.window_type == window_type,
        )
    )
    results = (await db.execute(stmt)).scalars().all()
    return {bp.canonical_metric_name: bp for bp in results}
