"""Standalone app to run/test JWT alone:  uvicorn app.main_jwt_demo:app --port 8000
In your real backend/main.py: call init_pool()/init_schema() in the lifespan and
app.include_router(auth.router)

Needs DATABASE_URL (see .env.example) and JWT_SECRET_KEY."""
from contextlib import asynccontextmanager

from fastapi import FastAPI

import db_utils
from app.api.v1 import auth


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_utils.init_pool()     # fails fast with a clear error if the database is unreachable
    await db_utils.init_schema()   # creates users / source / crawl_job if missing
    yield
    await db_utils.close_pool()


app = FastAPI(title="DarkTrace JWT auth", lifespan=lifespan)
app.include_router(auth.router)


@app.get("/health", tags=["system"])
async def health():
    return await db_utils.health_check()
