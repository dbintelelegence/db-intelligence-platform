"""
DB-backed metric normalisation for push ingest.

Replaces the hardcoded ES_METRIC_MAP in ingest.py.
Single source of truth: normalisation_map table.

TTL cache (5 minutes) avoids a DB round-trip on every push.
Cache is keyed by (source_type, db_type).

Usage:
    norm_map = await load_norm_map(db, SourceType.push, DbType.elasticsearch)
    canonical, unmapped_names = normalise_batch(raw_metrics, norm_map)
"""

import logging
import time
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import DbType, NormalisationMap, SourceType, UnmappedMetric

logger = logging.getLogger(__name__)

# ── TTL cache ─────────────────────────────────────────────────────────────────

_CACHE_TTL_SECONDS = 300  # 5 minutes


@dataclass
class NormEntry:
    canonical_name: str
    category: str
    unit: str


# {(source_type, db_type): (entries_dict, loaded_at)}
_cache: dict[tuple[str, str], tuple[dict[str, NormEntry], float]] = {}


async def load_norm_map(
    db: AsyncSession,
    source_type: SourceType,
    db_type: DbType,
) -> dict[str, NormEntry]:
    """
    Load normalisation map from DB for this (source_type, db_type) pair.
    For push stacks, source_type=SourceType.push — the norm map uses 'push'
    as source_type in the DB. Falls back to checking 'grafana_cloud' entries
    if no 'push'-specific mappings exist (allows reuse of existing mappings).
    Returns {raw_metric_name: NormEntry}.
    """
    cache_key = (source_type.value, db_type.value)
    cached = _cache.get(cache_key)
    if cached is not None:
        entries, loaded_at = cached
        if time.monotonic() - loaded_at < _CACHE_TTL_SECONDS:
            return entries

    # Load from DB — try source_type first, then fall back to grafana_cloud
    # so push stacks can reuse existing normalisation rows.
    stmt = (
        select(NormalisationMap)
        .where(
            NormalisationMap.db_type == db_type,
            NormalisationMap.is_active.is_(True),
            NormalisationMap.source_type.in_([source_type, SourceType.grafana_cloud]),
        )
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    entries: dict[str, NormEntry] = {}
    for row in rows:
        # source_type-specific entries take priority over grafana_cloud fallback
        if row.raw_metric_name not in entries or row.source_type == source_type:
            entries[row.raw_metric_name] = NormEntry(
                canonical_name=row.canonical_name,
                category=row.category,
                unit=row.unit,
            )

    _cache[cache_key] = (entries, time.monotonic())
    logger.debug(f"Loaded {len(entries)} norm entries for ({source_type.value}, {db_type.value})")
    return entries


def normalise_batch(
    raw_metrics: dict[str, float],
    norm_map: dict[str, NormEntry],
) -> tuple[dict[str, float], list[str]]:
    """
    Map raw metric names to canonical names.
    Returns:
      canonical_metrics: {canonical_name: value}  — successfully mapped
      unmapped_names:    [raw_metric_name, ...]    — could not map
    """
    canonical: dict[str, float] = {}
    unmapped: list[str] = []

    for raw_name, value in raw_metrics.items():
        entry = norm_map.get(raw_name)
        if entry is not None:
            canonical[entry.canonical_name] = value
        else:
            unmapped.append(raw_name)

    return canonical, unmapped


async def record_unmapped(
    db: AsyncSession,
    tenant_id: UUID,
    stack_id: UUID,
    source_type: SourceType,
    db_type: DbType,
    raw_name: str,
    sample_value: float,
) -> None:
    """
    Upsert into unmapped_metrics: increment occurrence_count if exists,
    insert with count=1 if new. Never raises — logs on failure only.
    """
    try:
        stmt = select(UnmappedMetric).where(
            UnmappedMetric.tenant_id == tenant_id,
            UnmappedMetric.stack_id == stack_id,
            UnmappedMetric.raw_metric_name == raw_name,
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing is not None:
            existing.occurrence_count += 1
            existing.sample_value = sample_value
        else:
            db.add(UnmappedMetric(
                tenant_id=tenant_id,
                stack_id=stack_id,
                source_type=source_type,
                db_type=db_type,
                raw_metric_name=raw_name,
                sample_value=sample_value,
            ))
    except Exception as e:
        logger.error(f"Failed to record unmapped metric '{raw_name}': {e}")


def invalidate_cache(source_type: SourceType | None = None, db_type: DbType | None = None) -> None:
    """Flush the norm map cache. Pass None for both to flush all entries."""
    if source_type is None and db_type is None:
        _cache.clear()
    else:
        key = (source_type.value if source_type else None, db_type.value if db_type else None)
        _cache.pop(key, None)
