"""
Dark Web Monitoring System — Module 1
Threat Intelligence Platform & Investigation

Config (.env loader), models, schemas, auth, ID sequences and every endpoint live in
this single file. Only DB session, security helpers, services and the investigation/
ingestion models stay in their own modules under app/. Run locally:

    uvicorn app.main:app --reload --port 8000
"""

import logging
import sys
import types
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile, File, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt  # if your project uses PyJWT: `import jwt` and catch jwt.PyJWTError
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Text, func, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

# =========================================================================
# Config — values come ONLY from the .env file (project root) / real env vars.
# Secrets have no defaults: if .env is missing, the app fails at startup.
# =========================================================================

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"  # <project-root>/.env


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    # --- App ---
    APP_ENV: str = "development"
    CORS_ORIGINS: list[str] = Field(default_factory=list)  # JSON list in .env

    # --- Auth / JWT ---
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # --- PostgreSQL ---
    DATABASE_URL: str

    # --- Service-to-service (Module 2 crawler -> ingestion) ---
    INGESTION_API_KEY: str

    # --- Elasticsearch ---
    ELASTICSEARCH_URL: str
    ELASTICSEARCH_USER: str = ""
    ELASTICSEARCH_PASSWORD: str = ""

    # --- Neo4j ---
    NEO4J_URI: str
    NEO4J_USER: str
    NEO4J_PASSWORD: str

    # --- Evidence store (MinIO / S3) ---
    MINIO_ENDPOINT: str
    MINIO_ACCESS_KEY: str
    MINIO_SECRET_KEY: str
    MINIO_BUCKET: str = "evidence"

    # --- SIEM ---
    SIEM_URL: str = ""
    SIEM_API_KEY: str = ""

    # --- Blockchain ---
    BLOCKCHAIN_RPC_URL: str = ""
    BLOCKCHAIN_PRIVATE_KEY: str = ""


settings = Settings()

# Other modules (core/database.py, core/security.py, services/*) still do
# `from app.core.config import settings`. Register this same object under that name so they
# keep working WITHOUT a separate config.py file. Must stay above the app.core imports below.
_config_shim = types.ModuleType("app.core.config")
_config_shim.settings = settings
_config_shim.Settings = Settings
sys.modules["app.core.config"] = _config_shim


from app.core.database import Base, get_db
from app.core.logging_config import setup_logging
from app.core.security import create_access_token, hash_password, verify_password
from app.core.service_auth import verify_ingestion_key
from app.models.investigation import Alert, Case, EvidenceRecord, Investigation
from app.schemas.ingestion import DocumentIngest, EntityIngest, RelationshipIngest
from app.schemas.investigation import (
    AlertCreate,
    AlertOut,
    CaseCreate,
    CaseOut,
    EvidenceOut,
    InvestigationCreate,
    InvestigationOut,
)
from app.services import blockchain_client, elasticsearch_client, evidence_store, neo4j_client, siem_client

setup_logging()


# =========================================================================
# Models  (users / source / crawl_job — Database Schema Report)
# =========================================================================

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "role IN ('sysadmin','analyst','investigator','supervisor','auditor','readonly')",
            name="users_role_check",
        ),
        CheckConstraint("status IN ('active','disabled')", name="users_status_check"),
        Index("idx_users_role", "role"),
    )

    usr_id: Mapped[str] = mapped_column(Text, primary_key=True)
    username: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="analyst")
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class Source(Base):
    __tablename__ = "source"
    __table_args__ = (
        CheckConstraint(
            "source_type IN ('onion_site','forum','marketplace','paste','blog','i2p_site')",
            name="source_source_type_check",
        ),
        CheckConstraint("status IN ('active','paused','dead')", name="source_status_check"),
        Index("idx_source_status", "status"),
    )

    source_id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(Text, nullable=False)
    onion_addr: Mapped[Optional[str]] = mapped_column(Text)
    auth_ref: Mapped[str] = mapped_column(Text, nullable=False)  # legal authorization record — mandatory
    crawl_policy: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    health: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="active")
    created_by: Mapped[str] = mapped_column(Text, ForeignKey("users.usr_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CrawlJob(Base):
    __tablename__ = "crawl_job"
    __table_args__ = (
        CheckConstraint("kind IN ('scheduled','incremental','manual')", name="crawl_job_kind_check"),
        CheckConstraint("state IN ('queued','running','done','failed','dead')", name="crawl_job_state_check"),
        Index("idx_crawl_job_source", "source_id"),
        Index("idx_crawl_job_state", "state"),
    )

    job_id: Mapped[str] = mapped_column(Text, primary_key=True)
    intent_id: Mapped[str] = mapped_column(Text, nullable=False)  # provenance root ID
    source_id: Mapped[str] = mapped_column(Text, ForeignKey("source.source_id"), nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(Text, nullable=False, server_default="queued")
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    stats: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    error: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


# =========================================================================
# Schemas
# =========================================================================

Role = Literal["sysadmin", "analyst", "investigator", "supervisor", "auditor", "readonly"]
SourceType = Literal["onion_site", "forum", "marketplace", "paste", "blog", "i2p_site"]
SourceStatus = Literal["active", "paused", "dead"]
JobKind = Literal["scheduled", "incremental", "manual"]
JobState = Literal["queued", "running", "done", "failed", "dead"]


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    usr_id: str
    username: str
    email: str
    role: Role
    mfa_enabled: bool
    status: Literal["active", "disabled"]
    created_at: datetime
    last_login_at: Optional[datetime] = None


class UserAdminUpdate(BaseModel):
    role: Optional[Role] = None
    mfa_enabled: Optional[bool] = None
    status: Optional[Literal["active", "disabled"]] = None


class SourceCreate(BaseModel):
    name: str = Field(min_length=1)
    source_type: SourceType
    onion_addr: Optional[str] = None
    auth_ref: str = Field(min_length=1, description="Legal authorization record — mandatory")
    crawl_policy: dict[str, Any] = Field(default_factory=dict)
    health: dict[str, Any] = Field(default_factory=dict)


class SourceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    onion_addr: Optional[str] = None
    crawl_policy: Optional[dict[str, Any]] = None
    health: Optional[dict[str, Any]] = None
    status: Optional[SourceStatus] = None


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source_id: str
    name: str
    source_type: SourceType
    onion_addr: Optional[str]
    auth_ref: str
    crawl_policy: dict[str, Any]
    health: dict[str, Any]
    status: SourceStatus
    created_by: str
    created_at: datetime


class CrawlJobCreate(BaseModel):
    intent_id: str = Field(min_length=1, description="Provenance root ID")
    source_id: str
    kind: JobKind = "manual"


class CrawlJobStateUpdate(BaseModel):
    state: JobState
    error: Optional[str] = None
    stats: Optional[dict[str, Any]] = None


class CrawlJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: str
    intent_id: str
    source_id: str
    kind: JobKind
    state: JobState
    attempt: int
    stats: dict[str, Any]
    error: Optional[str]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]


# =========================================================================
# ID sequences (usr_001 / src_001 / job_001) — created automatically at startup
# =========================================================================

logger = logging.getLogger(__name__)

# (sequence, table, id column) — names are constants, never user input
_ID_SEQUENCES = [
    ("usr_id_seq", "users", "usr_id"),
    ("source_id_seq", "source", "source_id"),
    ("job_id_seq", "crawl_job", "job_id"),
]


async def init_sequences(db: AsyncSession) -> None:
    """CREATE SEQUENCE IF NOT EXISTS; a brand-new sequence is moved past any existing IDs (e.g. sample rows)."""
    for seq, table, col in _ID_SEQUENCES:
        already = (await db.execute(text("SELECT to_regclass(:n) IS NOT NULL"), {"n": seq})).scalar_one()
        if already:
            continue
        await db.execute(text(f"CREATE SEQUENCE {seq}"))
        has_table = (await db.execute(text("SELECT to_regclass(:n) IS NOT NULL"), {"n": table})).scalar_one()
        if has_table:
            await db.execute(
                text(
                    f"SELECT setval('{seq}', "
                    f"COALESCE((SELECT MAX(SUBSTRING({col} FROM '[0-9]+$')::bigint) FROM {table}), 0) + 1, false)"
                )
            )
    await db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        async for db in get_db():
            await init_sequences(db)
    except Exception:  # DB down / tables not created yet — don't hide it, but let the app boot
        logger.exception("Sequence init failed (check DATABASE_URL and that users/source/crawl_job tables exist)")
    yield


# =========================================================================
# Auth dependency (JWT -> User)
# =========================================================================

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        usr_id = payload.get("sub")
    except JWTError:
        raise credentials_error
    if not usr_id:
        raise credentials_error

    user = await db.get(User, usr_id)
    if not user or user.status != "active":
        raise credentials_error
    return user

app = FastAPI(
    lifespan=lifespan,
    title="Dark Web Monitoring System — Module 1",
    description="Threat Intelligence Platform & Investigation backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_auth = Depends(get_current_user)


def require_roles(*roles: str):
    """Role gate based on users.role (sysadmin/analyst/investigator/supervisor/auditor/readonly)."""

    async def checker(user: User = _auth) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user

    return Depends(checker)


_ADMIN = require_roles("sysadmin")
_SOURCE_WRITE = require_roles("sysadmin", "supervisor")
_JOB_WRITE = require_roles("sysadmin", "supervisor", "investigator", "analyst")


async def _next_id(db: AsyncSession, prefix: str, sequence: str) -> str:
    """Prefixed human-readable IDs (usr_001, src_001, job_001) from a Postgres sequence."""
    n = (await db.execute(text(f"SELECT nextval('{sequence}')"))).scalar_one()
    return f"{prefix}_{n:03d}"


# =========================================================================
# System
# =========================================================================

@app.get("/", tags=["System"])
async def root():
    return {
        "service": "Dark Web Monitoring System — Module 1",
        "status": "running",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health", tags=["System"])
async def health_check():
    return {"status": "ok", "service": "dark-web-monitor-module1"}


# =========================================================================
# Auth  (open — issues the JWT everything else below requires)
# =========================================================================

@app.post("/api/v1/auth/register", response_model=UserOut, status_code=status.HTTP_201_CREATED, tags=["Auth"])
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(User).where((User.username == payload.username) | (User.email == payload.email))
    )
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="Username or email already registered")

    # role is NOT taken from the payload (no self-assigned privileges) -> DB default 'analyst'.
    # The first sysadmin is created directly in the DB; later role changes go through PATCH /users/{usr_id}.
    user = User(
        usr_id=await _next_id(db, "usr", "usr_id_seq"),
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@app.post("/api/v1/auth/token", response_model=Token, tags=["Auth"])
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == form_data.username))
    user = result.scalars().first()

    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    access_token = create_access_token(subject=user.usr_id)
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/api/v1/auth/me", response_model=UserOut, tags=["Auth"])
async def get_me(current_user: User = _auth):
    return current_user


# =========================================================================
# Investigator — cases, investigations, cross-source search  (JWT required)
# =========================================================================

@app.post("/api/v1/investigator/cases", response_model=CaseOut, tags=["Investigator"])
async def create_case(payload: CaseCreate, db: AsyncSession = Depends(get_db), user: User = _auth):
    case = Case(title=payload.title, description=payload.description)
    db.add(case)
    await db.commit()
    await db.refresh(case)
    return case


@app.get("/api/v1/investigator/cases", response_model=list[CaseOut], tags=["Investigator"])
async def list_cases(db: AsyncSession = Depends(get_db), user: User = _auth):
    result = await db.execute(select(Case))
    return result.scalars().all()


@app.get("/api/v1/investigator/cases/{case_id}", response_model=CaseOut, tags=["Investigator"])
async def get_case(case_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = _auth):
    case = await db.get(Case, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@app.post("/api/v1/investigator/investigations", response_model=InvestigationOut, tags=["Investigator"])
async def create_investigation(
    payload: InvestigationCreate, db: AsyncSession = Depends(get_db), user: User = _auth
):
    case = await db.get(Case, payload.case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    investigation = Investigation(case_id=payload.case_id, query=payload.query)
    db.add(investigation)
    await db.commit()
    await db.refresh(investigation)
    return investigation


@app.get("/api/v1/investigator/investigations/{investigation_id}/search", tags=["Investigator"])
async def cross_source_search(
    investigation_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = _auth
):
    """Runs the investigation's query against Elasticsearch and Neo4j, returns combined results."""
    investigation = await db.get(Investigation, investigation_id)
    if not investigation:
        raise HTTPException(status_code=404, detail="Investigation not found")

    content_hits = await elasticsearch_client.search_documents("posts", investigation.query)
    graph_hits = await neo4j_client.run_query(
        "MATCH (n) WHERE n.alias CONTAINS $q OR n.id = $q RETURN n LIMIT 25",
        {"q": investigation.query},
    )

    return {
        "investigation_id": investigation_id,
        "query": investigation.query,
        "content_matches": content_hits,
        "graph_matches": graph_hits,
    }


# =========================================================================
# Evidence Store  (JWT required)
# =========================================================================

@app.post(
    "/api/v1/evidence/investigations/{investigation_id}/upload",
    response_model=EvidenceOut,
    tags=["Evidence Store"],
)
async def upload_evidence(
    investigation_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = _auth,
):
    investigation = await db.get(Investigation, investigation_id)
    if not investigation:
        raise HTTPException(status_code=404, detail="Investigation not found")

    data = await file.read()
    object_key = f"{investigation_id}/{uuid.uuid4()}_{file.filename}"
    upload_result = evidence_store.upload_evidence(object_key, data, file.content_type)

    record = EvidenceRecord(
        investigation_id=investigation_id,
        object_key=upload_result["object_key"],
        sha256_hash=upload_result["sha256"],
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    # In production, move this to a background task/queue rather than inline
    anchor_result = blockchain_client.anchor_hash(record.sha256_hash, str(investigation.case_id))
    record.blockchain_status = anchor_result.get("status", "not_anchored")
    await db.commit()
    await db.refresh(record)

    return record


@app.get("/api/v1/evidence/{evidence_id}/url", tags=["Evidence Store"])
async def get_evidence_download_url(evidence_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = _auth):
    record = await db.get(EvidenceRecord, evidence_id)
    if not record:
        raise HTTPException(status_code=404, detail="Evidence not found")
    return {"url": evidence_store.get_evidence_url(record.object_key)}


# =========================================================================
# Alerting  (JWT required)
# =========================================================================

@app.post("/api/v1/alerts", response_model=AlertOut, tags=["Alerting"])
async def create_alert(payload: AlertCreate, db: AsyncSession = Depends(get_db), user: User = _auth):
    alert = Alert(**payload.model_dump())
    db.add(alert)
    await db.commit()
    await db.refresh(alert)

    if alert.severity in ("high", "critical"):
        await siem_client.forward_alert(alert)
        alert.sent_to_siem = True
        await db.commit()
        await db.refresh(alert)

    return alert


@app.get("/api/v1/alerts", response_model=list[AlertOut], tags=["Alerting"])
async def list_alerts(db: AsyncSession = Depends(get_db), user: User = _auth):
    result = await db.execute(select(Alert).order_by(Alert.created_at.desc()))
    return result.scalars().all()


# =========================================================================
# Reporting  (JWT required)
# =========================================================================

@app.get("/api/v1/reports/cases/{case_id}", tags=["Reporting"])
async def generate_case_report(case_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = _auth):
    case = await db.get(Case, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    investigations = (
        (await db.execute(select(Investigation).where(Investigation.case_id == case_id))).scalars().all()
    )

    investigation_blocks = []
    for inv in investigations:
        evidence = (
            (await db.execute(select(EvidenceRecord).where(EvidenceRecord.investigation_id == inv.id)))
            .scalars()
            .all()
        )
        investigation_blocks.append(
            {
                "investigation_id": inv.id,
                "query": inv.query,
                "findings_summary": inv.findings_summary,
                "evidence_count": len(evidence),
                "evidence": [
                    {"id": e.id, "sha256": e.sha256_hash, "blockchain_status": e.blockchain_status}
                    for e in evidence
                ],
            }
        )

    alerts = (await db.execute(select(Alert).where(Alert.case_id == case_id))).scalars().all()

    return {
        "case": {"id": case.id, "title": case.title, "status": case.status, "created_at": case.created_at},
        "investigations": investigation_blocks,
        "alerts": [{"id": a.id, "severity": a.severity, "title": a.title} for a in alerts],
    }


# =========================================================================
# SIEM Integration  (JWT required, except the inbound webhook)
# =========================================================================

@app.post("/api/v1/siem/forward/{alert_id}", tags=["SIEM Integration"])
async def forward_alert_to_siem(alert_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = _auth):
    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    result = await siem_client.forward_alert(alert)
    if result.get("status") == "forwarded":
        alert.sent_to_siem = True
        await db.commit()
    return result


@app.post("/api/v1/siem/webhook", tags=["SIEM Integration"])
async def receive_siem_event(request: Request):
    """Inbound endpoint for SIEM-originated events. Intentionally open — the SIEM calls this, not a user."""
    payload = await request.json()
    # TODO: validate payload schema and route into Investigator / Alerting as needed
    return {"status": "received", "payload_keys": list(payload.keys())}


# =========================================================================
# Blockchain / Chain of Custody  (JWT required)
# =========================================================================

@app.post("/api/v1/blockchain/anchor/{evidence_id}", tags=["Blockchain / Chain of Custody"])
async def anchor_evidence(evidence_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = _auth):
    record = await db.get(EvidenceRecord, evidence_id)
    if not record:
        raise HTTPException(status_code=404, detail="Evidence not found")

    investigation = await db.get(Investigation, record.investigation_id)
    result = blockchain_client.anchor_hash(record.sha256_hash, str(investigation.case_id))
    record.blockchain_status = result.get("status", record.blockchain_status)
    await db.commit()
    return result


@app.get("/api/v1/blockchain/verify/{evidence_id}", tags=["Blockchain / Chain of Custody"])
async def verify_evidence(evidence_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = _auth):
    record = await db.get(EvidenceRecord, evidence_id)
    if not record:
        raise HTTPException(status_code=404, detail="Evidence not found")

    investigation = await db.get(Investigation, record.investigation_id)
    return blockchain_client.verify_anchor(record.sha256_hash, str(investigation.case_id))


# =========================================================================
# Dashboard  (JWT required)
# =========================================================================

@app.get("/api/v1/dashboard/summary", tags=["Dashboard"])
async def get_dashboard_summary(db: AsyncSession = Depends(get_db), user: User = _auth):
    total_cases = (await db.execute(select(func.count()).select_from(Case))).scalar_one()
    open_cases = (
        await db.execute(select(func.count()).select_from(Case).where(Case.status == "open"))
    ).scalar_one()

    alert_counts_by_severity = (
        await db.execute(select(Alert.severity, func.count()).group_by(Alert.severity))
    ).all()

    return {
        "total_cases": total_cases,
        "open_cases": open_cases,
        "alerts_by_severity": {severity: count for severity, count in alert_counts_by_severity},
    }


# =========================================================================
# User administration  (sysadmin only)
# =========================================================================

@app.get("/api/v1/users", response_model=list[UserOut], tags=["Users"])
async def list_users(db: AsyncSession = Depends(get_db), user: User = _ADMIN):
    result = await db.execute(select(User).order_by(User.created_at))
    return result.scalars().all()


@app.patch("/api/v1/users/{usr_id}", response_model=UserOut, tags=["Users"])
async def update_user(
    usr_id: str, payload: UserAdminUpdate, db: AsyncSession = Depends(get_db), user: User = _ADMIN
):
    target = await db.get(User, usr_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.usr_id == user.usr_id and payload.status == "disabled":
        raise HTTPException(status_code=400, detail="You cannot disable your own account")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(target, field, value)
    await db.commit()
    await db.refresh(target)
    return target


# =========================================================================
# Sources — registry of monitored dark web sites  (JWT required)
# Writes: sysadmin / supervisor.  Reads: any authenticated user.
# =========================================================================

@app.post("/api/v1/sources", response_model=SourceOut, status_code=status.HTTP_201_CREATED, tags=["Sources"])
async def create_source(payload: SourceCreate, db: AsyncSession = Depends(get_db), user: User = _SOURCE_WRITE):
    source = Source(
        source_id=await _next_id(db, "src", "source_id_seq"),
        created_by=user.usr_id,
        **payload.model_dump(),
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return source


@app.get("/api/v1/sources", response_model=list[SourceOut], tags=["Sources"])
async def list_sources(
    status_filter: Optional[str] = None,
    source_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = _auth,
):
    query = select(Source).order_by(Source.created_at.desc())
    if status_filter:
        query = query.where(Source.status == status_filter)
    if source_type:
        query = query.where(Source.source_type == source_type)
    return (await db.execute(query)).scalars().all()


@app.get("/api/v1/sources/{source_id}", response_model=SourceOut, tags=["Sources"])
async def get_source(source_id: str, db: AsyncSession = Depends(get_db), user: User = _auth):
    source = await db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    return source


@app.patch("/api/v1/sources/{source_id}", response_model=SourceOut, tags=["Sources"])
async def update_source(
    source_id: str, payload: SourceUpdate, db: AsyncSession = Depends(get_db), user: User = _SOURCE_WRITE
):
    source = await db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(source, field, value)
    await db.commit()
    await db.refresh(source)
    return source


# =========================================================================
# Crawl Jobs — one row per crawl attempt against a source  (JWT required)
# Writes: sysadmin / supervisor / investigator / analyst.  Reads: any authenticated user.
# State updates coming from the crawler itself are under the Ingestion section (API key).
# =========================================================================

@app.post("/api/v1/crawl-jobs", response_model=CrawlJobOut, status_code=status.HTTP_201_CREATED, tags=["Crawl Jobs"])
async def create_crawl_job(payload: CrawlJobCreate, db: AsyncSession = Depends(get_db), user: User = _JOB_WRITE):
    source = await db.get(Source, payload.source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    if source.status != "active":
        raise HTTPException(status_code=409, detail=f"Source is {source.status}; cannot queue a crawl")

    job = CrawlJob(job_id=await _next_id(db, "job", "job_id_seq"), **payload.model_dump())
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


@app.get("/api/v1/crawl-jobs", response_model=list[CrawlJobOut], tags=["Crawl Jobs"])
async def list_crawl_jobs(
    source_id: Optional[str] = None,
    state: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = _auth,
):
    query = select(CrawlJob).order_by(CrawlJob.job_id.desc())
    if source_id:
        query = query.where(CrawlJob.source_id == source_id)
    if state:
        query = query.where(CrawlJob.state == state)
    return (await db.execute(query)).scalars().all()


@app.get("/api/v1/crawl-jobs/{job_id}", response_model=CrawlJobOut, tags=["Crawl Jobs"])
async def get_crawl_job(job_id: str, db: AsyncSession = Depends(get_db), user: User = _auth):
    job = await db.get(CrawlJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Crawl job not found")
    return job


@app.get("/api/v1/sources/{source_id}/trace", tags=["Sources"])
async def trace_source(source_id: str, db: AsyncSession = Depends(get_db), user: User = _auth):
    """Accountability chain: users -> source -> crawl_job (the verification query from the schema report)."""
    rows = (
        await db.execute(
            select(CrawlJob.job_id, CrawlJob.state, Source.name, User.username)
            .join(Source, CrawlJob.source_id == Source.source_id)
            .join(User, Source.created_by == User.usr_id)
            .where(Source.source_id == source_id)
        )
    ).all()
    return [
        {"job_id": job_id, "state": state, "source_name": name, "created_by": username}
        for job_id, state, name, username in rows
    ]


# =========================================================================
# Ingestion — Module 2 (crawler) feeds data in here.
# Protected by a shared API key, not user JWT — this is service-to-service.
# =========================================================================

@app.post("/api/v1/ingestion/document", tags=["Ingestion (Module 2)"])
async def ingest_document(payload: DocumentIngest, _=Depends(verify_ingestion_key)):
    document = payload.model_dump(exclude={"entity", "doc_id"})
    result = await elasticsearch_client.index_document(payload.entity, payload.doc_id, document)
    return {"status": "indexed", "entity": payload.entity, "doc_id": payload.doc_id, "es_result": result.get("result")}


@app.post("/api/v1/ingestion/document/batch", tags=["Ingestion (Module 2)"])
async def ingest_documents_batch(payloads: list[DocumentIngest], _=Depends(verify_ingestion_key)):
    results = []
    for payload in payloads:
        document = payload.model_dump(exclude={"entity", "doc_id"})
        result = await elasticsearch_client.index_document(payload.entity, payload.doc_id, document)
        results.append({"doc_id": payload.doc_id, "status": result.get("result")})
    return {"ingested": len(results), "results": results}


@app.post("/api/v1/ingestion/entity", tags=["Ingestion (Module 2)"])
async def ingest_entity(payload: EntityIngest, _=Depends(verify_ingestion_key)):
    result = await neo4j_client.upsert_entity(payload.label, payload.id, payload.properties)
    return {"status": "upserted", "label": payload.label, "id": payload.id, "result": result}


@app.post("/api/v1/ingestion/relationship", tags=["Ingestion (Module 2)"])
async def ingest_relationship(payload: RelationshipIngest, _=Depends(verify_ingestion_key)):
    result = await neo4j_client.link_entities(payload.source_id, payload.target_id, payload.relationship)
    return {"status": "linked", "result": result}


# Allowed crawl_job.state lifecycle: queued -> running -> done / failed / dead  (failed can be retried)
_JOB_TRANSITIONS = {
    "queued": {"running"},
    "running": {"done", "failed"},
    "failed": {"queued", "dead"},
    "done": set(),
    "dead": set(),
}


@app.patch("/api/v1/ingestion/crawl-job/{job_id}/state", response_model=CrawlJobOut, tags=["Ingestion (Module 2)"])
async def update_crawl_job_state(
    job_id: str, payload: CrawlJobStateUpdate, db: AsyncSession = Depends(get_db), _=Depends(verify_ingestion_key)
):
    job = await db.get(CrawlJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Crawl job not found")
    if payload.state not in _JOB_TRANSITIONS[job.state]:
        raise HTTPException(status_code=409, detail=f"Invalid transition {job.state} -> {payload.state}")

    now = datetime.now(timezone.utc)
    if payload.state == "running":
        job.attempt += 1
        job.started_at = now
        job.finished_at = None
        job.error = None
    elif payload.state in ("done", "failed", "dead"):
        job.finished_at = now
    if payload.state in ("failed", "dead") and payload.error:
        job.error = payload.error
    if payload.stats:
        job.stats = {**(job.stats or {}), **payload.stats}

    job.state = payload.state
    await db.commit()
    await db.refresh(job)
    return job
