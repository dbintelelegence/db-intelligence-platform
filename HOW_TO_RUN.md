# How to run — DB Intelligence Platform

Three scenarios covered:
1. Frontend only (mock data) — run in 2 minutes, no setup
2. Full stack locally (Docker) — frontend + backend + Postgres
3. Host it publicly — frontend on Vercel, backend on Railway/Render

---

## Option 1 — Frontend only (mock data)

The frontend ships with 50 generated databases and realistic mock data.
No backend or database needed. This is what you use to demo the UI today.

### Prerequisites
- Node.js 18+  →  https://nodejs.org

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/dbintelelegence/db-intelligence-platform.git
cd db-intelligence-platform

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Open http://localhost:5173 — you should see the full dashboard.

---

## Option 2 — Full stack locally (Docker Compose)

Runs frontend + FastAPI backend + Postgres together.
This is what you use when testing real ingestion and analyzers.

### Prerequisites
- Docker Desktop  →  https://www.docker.com/products/docker-desktop

### Steps

```bash
# 1. Clone and enter the repo
git clone https://github.com/dbintelelegence/db-intelligence-platform.git
cd db-intelligence-platform

# 2. Create backend env file
cp backend/.env.example backend/.env
# Optional: add your ANTHROPIC_API_KEY to backend/.env for LLM explanations

# 3. Start everything
docker compose up

# First run takes ~2 minutes (pulls images, installs deps, runs migrations, seeds data)
```

Once running:
- Frontend:  http://localhost:5173
- Backend API: http://localhost:8000
- API docs:  http://localhost:8000/docs

### Useful Docker commands

```bash
# Run in background
docker compose up -d

# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Stop everything
docker compose down

# Stop and wipe the database
docker compose down -v

# Rebuild after code changes
docker compose up --build
```

### Test the backend is working

```bash
# Health check
curl http://localhost:8000/health

# List clusters (empty until you ingest metrics)
curl http://localhost:8000/clusters/

# API docs (interactive)
open http://localhost:8000/docs
```

---

## Option 3 — Host it publicly

### Frontend → Vercel (free, permanent URL)

The repo already has `vercel.json` configured. It deploys in one click.

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy from repo root
vercel

# Follow the prompts:
#   Set up and deploy? → Y
#   Which scope? → your account
#   Link to existing project? → N (first time)
#   Project name → db-intelligence-platform
#   Directory → ./  (repo root)
#   Override build settings? → N
```

Your frontend will be live at `https://db-intelligence-platform-xxx.vercel.app`

For every push to main branch, Vercel auto-deploys. No further config needed.

### Backend → Railway (easiest, ~$5/month)

Railway handles Postgres + Python backend in one place.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create a new project
railway init

# Provision Postgres
railway add --database postgres

# Deploy the backend
cd backend
railway up
```

Then set environment variables in Railway dashboard:
- `DATABASE_URL` → Railway auto-sets this when you add Postgres
- `ANTHROPIC_API_KEY` → your key (optional, for LLM explanations)

After deploy, Railway gives you a URL like `https://backend-production-xxxx.up.railway.app`

### Backend → Render (alternative, free tier available)

1. Go to https://render.com → New → Web Service
2. Connect your GitHub repo
3. Set:
   - Root directory: `backend`
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Add a Postgres database under New → PostgreSQL
5. Set `DATABASE_URL` environment variable to the Postgres internal URL

### Connect frontend to hosted backend

Once the backend is deployed, tell the frontend where it lives:

```bash
# In Vercel dashboard → your project → Settings → Environment Variables
VITE_API_URL=https://your-backend-url.railway.app
```

Or locally:

```bash
# .env.local (in repo root, not committed)
VITE_API_URL=http://localhost:8000
```

---

## Run backend tests

```bash
cd backend

# All tests (no database needed)
python -m pytest tests/ -v

# Just analyzer tests
python -m pytest tests/test_analyzers/ -v
```

---

## Manual backend setup (without Docker)

If you want to run the backend directly without Docker:

### Prerequisites
- Python 3.12+
- PostgreSQL 15+

```bash
# 1. Create and activate virtual environment
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create the database
createdb db_intelligence

# 4. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL if different from default

# 5. Run migrations
alembic upgrade head

# 6. Seed analyzer definitions
python scripts/seed_analyzers.py

# 7. Start the API
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API available at http://localhost:8000
Interactive docs at http://localhost:8000/docs

---

## Prometheus remote_write setup (send real metrics)

To send real Elasticsearch metrics to the platform, add this to your
Prometheus config (`prometheus.yml`):

```yaml
remote_write:
  - url: http://localhost:8000/ingest/metrics
    # For hosted backend:
    # url: https://your-backend.railway.app/ingest/metrics
```

Make sure your Elasticsearch exporter is scraping your cluster and
Prometheus is collecting those metrics. The platform will auto-register
any metrics it recognises from the normalisation map.

---

## Troubleshooting

**Frontend blank page**
→ Check browser console for errors
→ Run `npm install` again
→ Make sure you're on Node 18+

**Backend won't start**
→ Check `backend/.env` has a valid DATABASE_URL
→ Make sure Postgres is running: `pg_isready`
→ Check migrations ran: `alembic current`

**Docker compose port conflict**
→ Something else is on 5432, 8000, or 5173
→ Change the left side of the port mapping in docker-compose.yml
→ e.g. `"5433:5432"` to use 5433 locally

**Alembic migration fails**
→ Make sure the database exists: `createdb db_intelligence`
→ Check DATABASE_URL matches your local Postgres credentials
