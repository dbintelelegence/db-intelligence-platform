import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import ingest, clusters, verdicts, baselines, dashboard, ai
from app.core.config import get_settings
from app.ingest.queue import worker_loop
from app.scheduler.runner_scheduler import scheduler_loop

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Start the analyzer scheduler and push ingest workers on app startup.
    Cancel all cleanly on shutdown.

    Background tasks:
      - analyzer-scheduler: polls Grafana every analyzer_run_interval_seconds (pull)
      - push-worker-N:      drains the analysis queue for push ingest (push)
    """
    scheduler_task = asyncio.create_task(scheduler_loop(), name="analyzer-scheduler")
    logger.info("Analyzer scheduler task created")

    worker_count = settings.push_worker_count
    worker_tasks = [
        asyncio.create_task(worker_loop(i), name=f"push-worker-{i}")
        for i in range(worker_count)
    ]
    logger.info(f"Push ingest workers started — count: {worker_count}")

    try:
        yield
    finally:
        # Cancel all background tasks cleanly
        for task in [scheduler_task, *worker_tasks]:
            task.cancel()
        for task in [scheduler_task, *worker_tasks]:
            try:
                await task
            except asyncio.CancelledError:
                pass
        logger.info(f"Scheduler and {worker_count} push workers stopped")


app = FastAPI(
    title="DB Intelligence Platform API",
    description="Database optimization and health intelligence. Deterministic analyzers find the truth — LLM explains it.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router,    prefix="/ingest",    tags=["ingestion"])
app.include_router(clusters.router,  prefix="/clusters",  tags=["clusters"])
app.include_router(verdicts.router,  prefix="/verdicts",  tags=["verdicts"])
app.include_router(baselines.router, prefix="/baselines", tags=["baselines"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
app.include_router(ai.router,        prefix="/ai",        tags=["ai"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}
