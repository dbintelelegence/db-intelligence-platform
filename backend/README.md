# DB Intelligence Platform - Backend

FastAPI backend for the DB Intelligence Platform.

## Tech Stack

- **Framework**: FastAPI
- **Database**: PostgreSQL with asyncpg
- **ORM**: SQLAlchemy 2.0 (async)
- **Migrations**: Alembic
- **Validation**: Pydantic v2

## Project Structure

```
backend/
├── app/
│   ├── api/
│   │   └── endpoints/     # API route handlers
│   ├── core/              # Configuration
│   ├── db/                # Database session
│   ├── models/            # SQLAlchemy models
│   ├── schemas/           # Pydantic schemas
│   └── services/          # Business logic
├── alembic/               # Database migrations
├── scripts/               # Utility scripts
└── tests/                 # Test files
```

## Setup

### Prerequisites

- Python 3.12+
- PostgreSQL 16+

### Local Development

1. Create virtual environment:
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Copy environment file:
```bash
cp .env.example .env
```

4. Start PostgreSQL (or use Docker):
```bash
# From project root
docker-compose up postgres -d
```

5. Run migrations:
```bash
alembic upgrade head
```

6. Seed the database:
```bash
python -m scripts.seed_data
```

7. Start the server:
```bash
uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`

## API Documentation

- Swagger UI: http://localhost:8000/api/docs
- ReDoc: http://localhost:8000/api/redoc

## API Endpoints

### Overview
- `GET /api/v1/overview/executive-summary` - Dashboard summary
- `GET /api/v1/overview/health` - Health summary

### Databases
- `GET /api/v1/databases` - List databases (with filtering)
- `GET /api/v1/databases/summary` - Database statistics
- `GET /api/v1/databases/{id}` - Get single database
- `POST /api/v1/databases` - Create database
- `PATCH /api/v1/databases/{id}` - Update database
- `DELETE /api/v1/databases/{id}` - Delete database

### Issues
- `GET /api/v1/issues` - List issues (with filtering)
- `GET /api/v1/issues/summary` - Issue statistics
- `GET /api/v1/issues/{id}` - Get single issue
- `POST /api/v1/issues` - Create issue
- `POST /api/v1/issues/{id}/acknowledge` - Acknowledge issue
- `POST /api/v1/issues/{id}/resolve` - Resolve issue

### Billing
- `GET /api/v1/billing/summary` - Cost summary with breakdowns
- `GET /api/v1/billing/databases/{id}` - Database billing history
- `GET /api/v1/billing/anomalies` - Cost anomalies

### Metrics
- `GET /api/v1/metrics/databases/{id}/current` - Current metrics
- `GET /api/v1/metrics/databases/{id}/timeseries/{name}` - Time series
- `POST /api/v1/metrics/ingest` - Ingest single metric
- `POST /api/v1/metrics/ingest/batch` - Batch ingest metrics

## Database Migrations

```bash
# Create a new migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1
```

## Running with Docker

From the project root:

```bash
docker-compose up
```

This starts:
- PostgreSQL on port 5432
- Backend on port 8000
- Frontend on port 5173
