"""
Analyzer Scheduler

Runs all active clusters through the analysis pipeline automatically
every `analyzer_run_interval_seconds` (default: 300s / 5 minutes).

Lifecycle:
  - Started as a FastAPI lifespan background task on app startup
  - Runs until the app shuts down
  - One cluster failure does not stop the rest (error is caught per-cluster)
  - Logs show each run's start time, cluster count, and completion

Design constraints:
  - Uses asyncio — no Celery, no Redis, no new dependencies at this scale
  - At 10+ customers, swap the asyncio.Queue for Redis Streams (see plan-push-architecture.md)
  - The `run_all_active_clusters()` function it calls reads from the DB — no hardcoded cluster list
"""

import asyncio
import logging

from app.core.config import get_settings

logger = logging.getLogger(__name__)


async def scheduler_loop() -> None:
    """
    Long-running background coroutine. Sleeps for the configured interval
    between runs. Imported and started in main.py lifespan.
    """
    settings = get_settings()
    interval = settings.analyzer_run_interval_seconds

    # Import here to avoid circular imports at module load time
    from app.runner.analyzer_runner import run_all_active_clusters

    logger.info(
        f"Analyzer scheduler started — interval: {interval}s "
        f"({interval // 60}m {interval % 60}s)"
    )

    # Wait one interval before the first run so the app finishes starting up
    # and DB connections are fully established.
    await asyncio.sleep(interval)

    while True:
        try:
            await run_all_active_clusters()
        except asyncio.CancelledError:
            logger.info("Analyzer scheduler cancelled — shutting down cleanly")
            return
        except Exception as e:
            # Log and continue — scheduler must not crash the app
            logger.error(f"Scheduler top-level error: {e}", exc_info=True)

        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.info("Analyzer scheduler cancelled during sleep — shutting down")
            return
