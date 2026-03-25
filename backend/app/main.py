from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import ingest, clusters, verdicts, baselines
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title="DB Intelligence Platform API",
    description="Database optimization and health intelligence. Deterministic analyzers find the truth — LLM explains it.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router,   prefix="/ingest",   tags=["ingestion"])
app.include_router(clusters.router, prefix="/clusters", tags=["clusters"])
app.include_router(verdicts.router, prefix="/verdicts", tags=["verdicts"])
app.include_router(baselines.router,prefix="/baselines",tags=["baselines"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}
