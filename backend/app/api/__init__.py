from fastapi import APIRouter

from app.api.endpoints import databases, issues, billing, metrics, overview

api_router = APIRouter()

api_router.include_router(overview.router, prefix="/overview", tags=["overview"])
api_router.include_router(databases.router, prefix="/databases", tags=["databases"])
api_router.include_router(issues.router, prefix="/issues", tags=["issues"])
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
api_router.include_router(metrics.router, prefix="/metrics", tags=["metrics"])
