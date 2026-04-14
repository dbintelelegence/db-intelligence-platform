"""
Async analysis queue for push ingest.

Push metrics arrive faster than analysis can run synchronously.
This queue decouples HTTP acceptance (immediate 202) from analysis (async).

Architecture:
  - asyncio.Queue with maxsize=500 (back-pressure, not blocking)
  - N worker coroutines drain the queue concurrently
  - Workers are started in main.py lifespan alongside the pull scheduler
  - Each worker holds one DB session for the duration of one job

At 10+ customers, swap _queue for Redis Streams — only this file changes.
The AnalysisJob dataclass and enqueue() interface remain identical.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

from app.models.models import DbType

logger = logging.getLogger(__name__)

_queue: asyncio.Queue["AnalysisJob"] = asyncio.Queue(maxsize=500)


@dataclass
class AnalysisJob:
    tenant_id: UUID
    cluster_id: str                            # composite string key e.g. "Alpha|us-east1|els_shrdone_alpha_va"
    db_type: DbType
    metrics: dict[str, float]                  # cluster-level canonical metrics
    per_instance: dict[str, dict[str, float]]  # {instance_id: {canonical_name: value}}
    received_at: datetime
    stack_id: UUID | None = field(default=None)


async def enqueue(job: AnalysisJob) -> None:
    """
    Non-blocking put. If the queue is full, logs a warning and drops the job.
    The push sender already got 202 — this is a best-effort delivery guarantee.
    """
    try:
        _queue.put_nowait(job)
        logger.debug(f"Queued job for {job.cluster_id} — queue depth: {_queue.qsize()}")
    except asyncio.QueueFull:
        logger.warning(
            f"Analysis queue full ({_queue.maxsize} pending) — "
            f"dropping job for {job.cluster_id}"
        )


async def worker_loop(worker_id: int) -> None:
    """
    Long-running coroutine. Drains the queue until cancelled.
    Started by main.py lifespan; cancelled on shutdown.
    """
    # Import here to avoid circular imports at module load time
    from app.runner.analyzer_runner import run_cluster_from_metrics
    from app.db.session import AsyncSessionLocal

    logger.info(f"Push worker-{worker_id} started")

    while True:
        try:
            job = await _queue.get()
        except asyncio.CancelledError:
            logger.info(f"Push worker-{worker_id} cancelled — shutting down")
            return

        try:
            async with AsyncSessionLocal() as db:
                await run_cluster_from_metrics(
                    db=db,
                    cluster_composite_id=job.cluster_id,
                    metrics=job.metrics,
                    per_instance=job.per_instance,
                    run_at=job.received_at,
                )
        except asyncio.CancelledError:
            _queue.task_done()
            logger.info(f"Push worker-{worker_id} cancelled mid-job — shutting down")
            return
        except Exception as e:
            logger.error(
                f"[worker-{worker_id}] Failed to analyze {job.cluster_id}: {e}",
                exc_info=True,
            )
        finally:
            _queue.task_done()


def queue_depth() -> int:
    """Return the current number of pending jobs. Used by health/metrics endpoints."""
    return _queue.qsize()
