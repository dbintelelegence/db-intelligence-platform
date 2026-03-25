# DB Intelligence Platform — Backend

Python/FastAPI backend. Deterministic analyzers find the truth. LLM explains it.

## Architecture principle

```
Metrics (Prometheus remote_write)  ──►  Ingestion API
Log signals (stream processor)     ──►  Ingestion API
                                              │
                                    Baseline Engine (nightly)
                                              │
                                    Analyzer Workers (per cluster)
                                              │
                                    Verdict Storage (Postgres)
                                              │
                               LLM Layer (on status change only)
                                              │
                                    REST API  ──►  Frontend
```

## Setup

### 1. Prerequisites

- Python 3.12+
- PostgreSQL 15+

### 2. Install dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL
```

### 4. Create database and run migrations

```bash
createdb db_intelligence
alembic upgrade head
```

### 5. Seed analyzer definitions

```bash
python scripts/seed_analyzers.py
```

### 6. Run the API

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs available at: http://localhost:8000/docs

## Running tests

```bash
# All tests
python -m pytest tests/ -v

# Just analyzer tests (no DB needed)
python -m pytest tests/test_analyzers/ -v
```

## Key endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ingest/metrics` | Prometheus remote_write receiver |
| POST | `/ingest/logs` | Log signal ingestion |
| GET | `/clusters/` | List all clusters with current status |
| GET | `/clusters/{id}` | Single cluster detail |
| GET | `/verdicts/cluster/{id}` | All verdicts for a cluster |
| GET | `/baselines/cluster/{id}` | Baseline profiles for a cluster |

## Project structure

```
backend/
  app/
    api/routes/       — FastAPI route handlers
    analyzers/        — Analyzer implementations (one per failure mode)
      elasticsearch/  — ES-specific analyzers
    baseline/         — Baseline computation engine
    core/             — Config, settings
    db/               — SQLAlchemy session setup
    ingestion/        — Metric normalisation helpers
    models/           — ORM models (all tables)
    schemas/          — Pydantic schemas (API contracts)
  migrations/         — Alembic migration files
  scripts/            — One-off scripts (seed, etc.)
  tests/
    test_analyzers/   — Analyzer logic tests (no DB required)
    test_api/         — API integration tests
    test_baseline/    — Baseline engine tests
```

## Analyzer pattern

Every analyzer:
1. Declares `REQUIRED_METRICS` and `OPTIONAL_LOG_SIGNALS`
2. Implements `analyze(metrics, baselines, log_signals, metric_ts) → VerdictResult`
3. Never calls the LLM — that happens in the verdict writer on status change
4. Is tested in isolation without a database

See `app/analyzers/elasticsearch/jvm_heap_pressure.py` as the reference implementation.
