# DarkTrace development setup

This repository includes a minimal development API so the frontend can run without a database or crawler. It uses Redis for alerts; accounts, sessions, sources, and queued jobs remain in memory and are cleared when the API restarts.

## Requirements

- Node.js 18+
- Python 3.11+

## Run locally

Open two PowerShell terminals from the repository root.

### 1. Start Redis and the development API

```powershell
docker run --name darktrace-redis -p 6379:6379 -d redis:7-alpine
cd backend
Copy-Item .env.example .env
python -m pip install -r requirements-dev.txt
uvicorn dev_server:app --reload --port 8000
```

The development API reads `REDIS_URL` from `backend\.env`. If Redis is already running elsewhere, update that value before starting the API.

Check that it is running:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

### 2. Start the frontend

```powershell
cd frontend
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), create an account, and sign in. The Vite development server automatically forwards `/api/*` requests to `http://localhost:8000`.

## What works in development

- Register, sign in, sign out, and session validation
- Dashboard reads for alerts, summary, sources, and crawl jobs
- Threat Intelligence reads alerts stored in Redis
- Crawler page queues jobs against one safe, local development source

Queued jobs remain in `queued` state. No URLs are fetched and no crawler is started.

## Deliberately not implemented

The production-oriented `backend/main.py` remains untouched and is not the local development entry point. It requires modules that are not present in this workspace.

Do **not** run `uvicorn main:app` for the minimal setup. Run `uvicorn dev_server:app` instead.

See [unimplimented.md](unimplimented.md) for every deferred module, where it will be used, the endpoints involved, and its expected inputs/outputs.

## Verify

```powershell
python -m py_compile backend\dev_server.py
cd frontend
npm run build
```

The development API has no database files or migrations. Only alerts survive API restarts; all other development records exist only while `dev_server.py` is running.
