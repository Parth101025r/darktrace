"""
db_utils.py - PostgreSQL utility layer for the Dark Web Monitoring & Threat
Intelligence Platform.

Covers the three tables in the Database Schema Report:
    users  ->  source  ->  crawl_job
    (source.created_by -> users.usr_id,  crawl_job.source_id -> source.source_id)

Install:
    pip install asyncpg

Configuration (environment variables):
    DATABASE_URL     full DSN, e.g. postgresql://user:pass@localhost:5432/darktrace
                     (a SQLAlchemy-style "postgresql+asyncpg://" prefix is accepted)
  or the individual parts:
    POSTGRES_HOST (localhost)  POSTGRES_PORT (5432)  POSTGRES_USER (postgres)
    POSTGRES_PASSWORD ("")     POSTGRES_DB (darktrace)

Typical use:
    await init_pool()
    await init_schema()                      # once: tables, indexes, id sequences
    user = await create_user("nikhil", "nikhil@example.com", password_hash)
    src  = await create_source("Test Forum", "forum", "auth_rec_001", user["usr_id"])
    job  = await create_crawl_job("ci_001", src["source_id"], "scheduled")
    await close_pool()

FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        await init_pool(); await init_schema()
        yield
        await close_pool()
    app = FastAPI(lifespan=lifespan)

Every function takes an optional `conn=` argument. Pass a connection from
`transaction()` to run several calls atomically:
    async with transaction() as conn:
        u = await create_user(..., conn=conn)
        s = await create_source(..., created_by=u["usr_id"], conn=conn)

Password hashing is NOT done here - hash in the auth layer and pass `password_hash`.
Rows are returned as plain dicts. `password_hash` is only returned when you ask
for it with `include_hash=True`.

CLI:
    python db_utils.py init      # create tables, indexes, sequences
    python db_utils.py health    # connectivity check
"""

from __future__ import annotations

import functools
import json
import os
import re
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Dict, List, Optional
from urllib.parse import quote_plus

import asyncpg

# ---------------------------------------------------------------------------
# Allowed values (mirror the CHECK constraints in the schema report)
# ---------------------------------------------------------------------------

USER_ROLES = ("sysadmin", "analyst", "investigator", "supervisor", "auditor", "readonly")
USER_STATUSES = ("active", "disabled")
SOURCE_TYPES = ("onion_site", "forum", "marketplace", "paste", "blog", "i2p_site")
SOURCE_STATUSES = ("active", "paused", "dead")
JOB_KINDS = ("scheduled", "incremental", "manual")
JOB_STATES = ("queued", "running", "done", "failed", "dead")

# state -> states it may be entered from
_JOB_TRANSITIONS = {
    "running": ("queued",),
    "done": ("running",),
    "failed": ("running",),
    "queued": ("failed",),  # retry
    "dead": ("queued", "running", "failed"),
}

Row = Dict[str, Any]

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class DatabaseError(Exception):
    """Base class for every error raised by this module."""


class DatabaseConnectionError(DatabaseError):
    """Could not connect to PostgreSQL, or the pool is not initialised."""


class NotFoundError(DatabaseError):
    """The requested row does not exist."""


class DuplicateError(DatabaseError):
    """A UNIQUE / PRIMARY KEY constraint was violated (e.g. username already taken)."""

    def __init__(self, message: str, constraint: Optional[str] = None):
        super().__init__(message)
        self.constraint = constraint


class ReferenceViolationError(DatabaseError):
    """A FOREIGN KEY constraint was violated (missing parent row, or row still referenced)."""

    def __init__(self, message: str, constraint: Optional[str] = None):
        super().__init__(message)
        self.constraint = constraint


class InvalidValueError(DatabaseError, ValueError):
    """A value failed validation (bad enum value, empty auth_ref, CHECK/NOT NULL violation)."""


class InvalidStateTransition(DatabaseError):
    """The crawl job is not in a state that allows the requested change."""


def _detail(exc: asyncpg.PostgresError) -> str:
    return (getattr(exc, "detail", None) or str(exc)).strip()


def _db_errors(fn):
    """Translate asyncpg exceptions into this module's exceptions."""

    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except asyncpg.UniqueViolationError as exc:
            raise DuplicateError(_detail(exc), getattr(exc, "constraint_name", None)) from exc
        except asyncpg.ForeignKeyViolationError as exc:
            raise ReferenceViolationError(_detail(exc), getattr(exc, "constraint_name", None)) from exc
        except (asyncpg.CheckViolationError, asyncpg.NotNullViolationError) as exc:
            raise InvalidValueError(_detail(exc)) from exc
        except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError, OSError) as exc:
            raise DatabaseConnectionError(f"Database connection problem: {exc}") from exc

    return wrapper


# ---------------------------------------------------------------------------
# Configuration + connection pool
# ---------------------------------------------------------------------------

_pool: Optional[asyncpg.Pool] = None


def build_dsn() -> str:
    """DSN from DATABASE_URL, or assembled from POSTGRES_* variables."""
    dsn = os.getenv("DATABASE_URL")
    if dsn:
        return dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    user = quote_plus(os.getenv("POSTGRES_USER", "postgres"))
    password = quote_plus(os.getenv("POSTGRES_PASSWORD", ""))
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    name = os.getenv("POSTGRES_DB", "darktrace")
    auth = f"{user}:{password}@" if password else f"{user}@"
    return f"postgresql://{auth}{host}:{port}/{name}"


async def _init_connection(conn: asyncpg.Connection) -> None:
    # JSON/JSONB columns <-> Python dict/list, automatically
    for typename in ("json", "jsonb"):
        await conn.set_type_codec(typename, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def init_pool(
    dsn: Optional[str] = None,
    *,
    min_size: int = 1,
    max_size: int = 10,
    command_timeout: float = 30,
    **kwargs: Any,
) -> asyncpg.Pool:
    """Create the shared connection pool (no-op if it already exists)."""
    global _pool
    if _pool is not None:
        return _pool
    try:
        _pool = await asyncpg.create_pool(
            dsn or build_dsn(),
            min_size=min_size,
            max_size=max_size,
            command_timeout=command_timeout,
            init=_init_connection,
            **kwargs,
        )
    except (OSError, asyncpg.PostgresError, asyncpg.InterfaceError) as exc:
        raise DatabaseConnectionError(f"Could not connect to PostgreSQL: {exc}") from exc
    return _pool


async def close_pool() -> None:
    """Close the shared pool (safe to call twice)."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise DatabaseConnectionError("Pool not initialised - call `await init_pool()` first")
    return _pool


@asynccontextmanager
async def connection(conn: Optional[asyncpg.Connection] = None) -> AsyncIterator[asyncpg.Connection]:
    """Yield `conn` if given, otherwise borrow a connection from the pool."""
    if conn is not None:
        yield conn
    else:
        async with get_pool().acquire() as acquired:
            yield acquired


@asynccontextmanager
async def transaction() -> AsyncIterator[asyncpg.Connection]:
    """Run several calls atomically: pass the yielded connection as `conn=`."""
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            yield conn


async def health_check() -> Row:
    """Never raises - returns {"ok": bool, ...} so it can back a /health endpoint."""
    started = time.perf_counter()
    try:
        async with connection() as conn:
            version = await conn.fetchval("SHOW server_version")
        return {"ok": True, "server_version": version, "latency_ms": round((time.perf_counter() - started) * 1000, 2)}
    except Exception as exc:  # noqa: BLE001 - a health probe must not raise
        return {"ok": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# Schema (exactly the DDL from the report, made idempotent) + readable ids
# ---------------------------------------------------------------------------

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    usr_id        TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'analyst'
                  CHECK (role IN ('sysadmin','analyst','investigator',
                                  'supervisor','auditor','readonly')),
    mfa_enabled   BOOLEAN NOT NULL DEFAULT false,
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS source (
    source_id    TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    source_type  TEXT NOT NULL
                 CHECK (source_type IN ('onion_site','forum','marketplace',
                                        'paste','blog','i2p_site')),
    onion_addr   TEXT,
    auth_ref     TEXT NOT NULL,
    crawl_policy JSONB NOT NULL DEFAULT '{}',
    health       JSONB NOT NULL DEFAULT '{}',
    status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','paused','dead')),
    created_by   TEXT NOT NULL REFERENCES users(usr_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_status ON source(status);

CREATE TABLE IF NOT EXISTS crawl_job (
    job_id      TEXT PRIMARY KEY,
    intent_id   TEXT NOT NULL,
    source_id   TEXT NOT NULL REFERENCES source(source_id),
    kind        TEXT NOT NULL
                CHECK (kind IN ('scheduled','incremental','manual')),
    state       TEXT NOT NULL DEFAULT 'queued'
                CHECK (state IN ('queued','running','done','failed','dead')),
    attempt     INT NOT NULL DEFAULT 0,
    stats       JSONB NOT NULL DEFAULT '{}',
    error       TEXT,
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_crawl_job_source ON crawl_job(source_id);
CREATE INDEX IF NOT EXISTS idx_crawl_job_state  ON crawl_job(state);

CREATE SEQUENCE IF NOT EXISTS usr_id_seq;
CREATE SEQUENCE IF NOT EXISTS src_id_seq;
CREATE SEQUENCE IF NOT EXISTS job_id_seq;
"""

# prefix -> (table, id column); whitelist, also guards the f-strings below
_ID_SPECS = {
    "usr": ("users", "usr_id"),
    "src": ("source", "source_id"),
    "job": ("crawl_job", "job_id"),
}


@_db_errors
async def init_schema(conn: Optional[asyncpg.Connection] = None) -> None:
    """Create tables, indexes and id sequences if missing, then sync the sequences."""
    async with connection(conn) as c:
        await c.execute(SCHEMA_SQL)
        await sync_id_sequences(conn=c)


@_db_errors
async def sync_id_sequences(conn: Optional[asyncpg.Connection] = None) -> None:
    """Move each id sequence past the highest existing id (e.g. after hand-inserted
    rows like 'usr_001'), so generated ids never collide."""
    async with connection(conn) as c:
        for prefix, (table, column) in _ID_SPECS.items():
            await c.execute(
                f"""
                SELECT setval('{prefix}_id_seq', GREATEST(m, 1), m > 0)
                FROM (SELECT COALESCE(MAX(substring({column} from '^{prefix}_([0-9]+)$')::bigint), 0) AS m
                      FROM {table}) t
                """
            )


@_db_errors
async def next_id(prefix: str, conn: Optional[asyncpg.Connection] = None) -> str:
    """Next prefixed id such as 'usr_001', 'src_014', 'job_1203' (race-safe: uses a sequence)."""
    if prefix not in _ID_SPECS:
        raise InvalidValueError(f"Unknown id prefix {prefix!r}; expected one of {sorted(_ID_SPECS)}")
    async with connection(conn) as c:
        n = await c.fetchval(f"SELECT nextval('{prefix}_id_seq')")
    return f"{prefix}_{n:03d}"


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _row(record: Optional[asyncpg.Record]) -> Optional[Row]:
    return dict(record) if record is not None else None


def _rows(records: List[asyncpg.Record]) -> List[Row]:
    return [dict(r) for r in records]


def _check_choice(label: str, value: Optional[str], allowed: tuple) -> None:
    if value is not None and value not in allowed:
        raise InvalidValueError(f"Invalid {label} {value!r}; allowed: {', '.join(allowed)}")


def _check_page(limit: int, offset: int) -> None:
    if limit < 1 or limit > 1000 or offset < 0:
        raise InvalidValueError("limit must be 1-1000 and offset >= 0")


def _where(filters: Dict[str, Any]) -> tuple:
    """Build 'WHERE a = $1 AND b = $2' from non-None filters (column names come from code, not users)."""
    clauses, args = [], []
    for column, value in filters.items():
        if value is not None:
            args.append(value)
            clauses.append(f"{column} = ${len(args)}")
    return ("WHERE " + " AND ".join(clauses) if clauses else ""), args


async def _update_row(
    conn: asyncpg.Connection, table: str, pk_col: str, pk: str, fields: Dict[str, Any], columns: str, label: str
) -> Row:
    """UPDATE the given columns of one row and return it; no fields -> just fetch it."""
    if not fields:
        record = await conn.fetchrow(f"SELECT {columns} FROM {table} WHERE {pk_col} = $1", pk)
    else:
        sets = ", ".join(f"{col} = ${i}" for i, col in enumerate(fields, start=1))
        record = await conn.fetchrow(
            f"UPDATE {table} SET {sets} WHERE {pk_col} = ${len(fields) + 1} RETURNING {columns}",
            *fields.values(),
            pk,
        )
    if record is None:
        raise NotFoundError(f"{label} {pk!r} not found")
    return dict(record)


class _Unset:
    def __repr__(self) -> str:
        return "UNSET"


UNSET: Any = _Unset()  # "argument not provided" (so None can mean "clear the column")

# ---------------------------------------------------------------------------
# USERS
# ---------------------------------------------------------------------------

_USER_COLS = "usr_id, username, email, role, mfa_enabled, status, created_at, last_login_at"
_USER_COLS_HASH = "usr_id, username, email, password_hash, role, mfa_enabled, status, created_at, last_login_at"


@_db_errors
async def create_user(
    username: str,
    email: str,
    password_hash: str,
    role: str = "analyst",
    *,
    mfa_enabled: bool = False,
    status: str = "active",
    usr_id: Optional[str] = None,
    conn: Optional[asyncpg.Connection] = None,
) -> Row:
    """Insert a user. `password_hash` must already be hashed. Raises DuplicateError if
    the username or email is taken."""
    _check_choice("role", role, USER_ROLES)
    _check_choice("status", status, USER_STATUSES)
    if not username.strip() or not email.strip() or not password_hash:
        raise InvalidValueError("username, email and password_hash are required")
    async with connection(conn) as c:
        usr_id = usr_id or await next_id("usr", c)
        record = await c.fetchrow(
            f"""INSERT INTO users (usr_id, username, email, password_hash, role, mfa_enabled, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING {_USER_COLS}""",
            usr_id, username.strip(), email.strip(), password_hash, role, mfa_enabled, status,
        )
    return dict(record)


@_db_errors
async def get_user(usr_id: str, *, include_hash: bool = False, conn: Optional[asyncpg.Connection] = None) -> Optional[Row]:
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"SELECT {_USER_COLS_HASH if include_hash else _USER_COLS} FROM users WHERE usr_id = $1", usr_id
        )
    return _row(record)


@_db_errors
async def get_user_by_username(
    username: str, *, include_hash: bool = False, conn: Optional[asyncpg.Connection] = None
) -> Optional[Row]:
    """Use include_hash=True for login checks."""
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"SELECT {_USER_COLS_HASH if include_hash else _USER_COLS} FROM users WHERE username = $1", username
        )
    return _row(record)


@_db_errors
async def get_user_by_email(
    email: str, *, include_hash: bool = False, conn: Optional[asyncpg.Connection] = None
) -> Optional[Row]:
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"SELECT {_USER_COLS_HASH if include_hash else _USER_COLS} FROM users WHERE email = $1", email
        )
    return _row(record)


@_db_errors
async def list_users(
    *,
    role: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    conn: Optional[asyncpg.Connection] = None,
) -> List[Row]:
    _check_choice("role", role, USER_ROLES)
    _check_choice("status", status, USER_STATUSES)
    _check_page(limit, offset)
    where, args = _where({"role": role, "status": status})
    async with connection(conn) as c:
        records = await c.fetch(
            f"SELECT {_USER_COLS} FROM users {where} ORDER BY created_at, usr_id "
            f"LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}",
            *args, limit, offset,
        )
    return _rows(records)


@_db_errors
async def update_user(
    usr_id: str,
    *,
    email: Optional[str] = None,
    role: Optional[str] = None,
    mfa_enabled: Optional[bool] = None,
    status: Optional[str] = None,
    conn: Optional[asyncpg.Connection] = None,
) -> Row:
    """Change any of email / role / mfa_enabled / status (None = leave unchanged)."""
    _check_choice("role", role, USER_ROLES)
    _check_choice("status", status, USER_STATUSES)
    fields = {k: v for k, v in {"email": email, "role": role, "mfa_enabled": mfa_enabled, "status": status}.items()
              if v is not None}
    async with connection(conn) as c:
        return await _update_row(c, "users", "usr_id", usr_id, fields, _USER_COLS, "User")


@_db_errors
async def set_password_hash(usr_id: str, password_hash: str, *, conn: Optional[asyncpg.Connection] = None) -> None:
    if not password_hash:
        raise InvalidValueError("password_hash is required")
    async with connection(conn) as c:
        result = await c.execute("UPDATE users SET password_hash = $1 WHERE usr_id = $2", password_hash, usr_id)
    if result == "UPDATE 0":
        raise NotFoundError(f"User {usr_id!r} not found")


@_db_errors
async def record_login(usr_id: str, *, conn: Optional[asyncpg.Connection] = None) -> Row:
    """Stamp last_login_at = now() after a successful login."""
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"UPDATE users SET last_login_at = now() WHERE usr_id = $1 RETURNING {_USER_COLS}", usr_id
        )
    if record is None:
        raise NotFoundError(f"User {usr_id!r} not found")
    return dict(record)


async def disable_user(usr_id: str, *, conn: Optional[asyncpg.Connection] = None) -> Row:
    return await update_user(usr_id, status="disabled", conn=conn)


async def enable_user(usr_id: str, *, conn: Optional[asyncpg.Connection] = None) -> Row:
    return await update_user(usr_id, status="active", conn=conn)


@_db_errors
async def delete_user(usr_id: str, *, conn: Optional[asyncpg.Connection] = None) -> bool:
    """Hard delete. Raises ReferenceViolationError if the user registered sources -
    prefer disable_user() to keep the accountability trail."""
    async with connection(conn) as c:
        result = await c.execute("DELETE FROM users WHERE usr_id = $1", usr_id)
    return result == "DELETE 1"


@_db_errors
async def count_users_by_role(*, conn: Optional[asyncpg.Connection] = None) -> Dict[str, int]:
    async with connection(conn) as c:
        records = await c.fetch("SELECT role, count(*) AS n FROM users GROUP BY role")
    counts = {r: 0 for r in USER_ROLES}
    counts.update({rec["role"]: rec["n"] for rec in records})
    return counts


# ---------------------------------------------------------------------------
# SOURCE
# ---------------------------------------------------------------------------

_SOURCE_COLS = "source_id, name, source_type, onion_addr, auth_ref, crawl_policy, health, status, created_by, created_at"


@_db_errors
async def create_source(
    name: str,
    source_type: str,
    auth_ref: str,
    created_by: str,
    *,
    onion_addr: Optional[str] = None,
    crawl_policy: Optional[Dict[str, Any]] = None,
    health: Optional[Dict[str, Any]] = None,
    status: str = "active",
    source_id: Optional[str] = None,
    conn: Optional[asyncpg.Connection] = None,
) -> Row:
    """Register a source. `auth_ref` (the legal authorization record) is mandatory and
    `created_by` must be an existing usr_id (else ReferenceViolationError)."""
    _check_choice("source_type", source_type, SOURCE_TYPES)
    _check_choice("status", status, SOURCE_STATUSES)
    if not name.strip():
        raise InvalidValueError("name is required")
    if not auth_ref or not auth_ref.strip():
        raise InvalidValueError("auth_ref is required - no source can be added without a legal authorization record")
    async with connection(conn) as c:
        source_id = source_id or await next_id("src", c)
        record = await c.fetchrow(
            f"""INSERT INTO source (source_id, name, source_type, onion_addr, auth_ref,
                                    crawl_policy, health, status, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING {_SOURCE_COLS}""",
            source_id, name.strip(), source_type, onion_addr, auth_ref.strip(),
            crawl_policy or {}, health or {}, status, created_by,
        )
    return dict(record)


@_db_errors
async def get_source(source_id: str, *, conn: Optional[asyncpg.Connection] = None) -> Optional[Row]:
    async with connection(conn) as c:
        record = await c.fetchrow(f"SELECT {_SOURCE_COLS} FROM source WHERE source_id = $1", source_id)
    return _row(record)


@_db_errors
async def list_sources(
    *,
    status: Optional[str] = None,
    source_type: Optional[str] = None,
    created_by: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    conn: Optional[asyncpg.Connection] = None,
) -> List[Row]:
    _check_choice("status", status, SOURCE_STATUSES)
    _check_choice("source_type", source_type, SOURCE_TYPES)
    _check_page(limit, offset)
    where, args = _where({"status": status, "source_type": source_type, "created_by": created_by})
    async with connection(conn) as c:
        records = await c.fetch(
            f"SELECT {_SOURCE_COLS} FROM source {where} ORDER BY created_at, source_id "
            f"LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}",
            *args, limit, offset,
        )
    return _rows(records)


@_db_errors
async def update_source(
    source_id: str,
    *,
    name: Optional[str] = None,
    source_type: Optional[str] = None,
    onion_addr: Any = UNSET,
    auth_ref: Optional[str] = None,
    crawl_policy: Optional[Dict[str, Any]] = None,
    status: Optional[str] = None,
    conn: Optional[asyncpg.Connection] = None,
) -> Row:
    """Change fields (None = leave unchanged). `onion_addr=None` clears the address;
    `crawl_policy` REPLACES the whole policy - use merge_crawl_policy() to patch it."""
    _check_choice("source_type", source_type, SOURCE_TYPES)
    _check_choice("status", status, SOURCE_STATUSES)
    if auth_ref is not None and not auth_ref.strip():
        raise InvalidValueError("auth_ref cannot be empty")
    fields = {k: v for k, v in {"name": name, "source_type": source_type, "auth_ref": auth_ref,
                                "crawl_policy": crawl_policy, "status": status}.items() if v is not None}
    if onion_addr is not UNSET:
        fields["onion_addr"] = onion_addr
    async with connection(conn) as c:
        return await _update_row(c, "source", "source_id", source_id, fields, _SOURCE_COLS, "Source")


async def set_source_status(source_id: str, status: str, *, conn: Optional[asyncpg.Connection] = None) -> Row:
    return await update_source(source_id, status=status, conn=conn)


async def _merge_json(conn: Optional[asyncpg.Connection], source_id: str, column: str, patch: Dict[str, Any]) -> Row:
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"UPDATE source SET {column} = {column} || $1::jsonb WHERE source_id = $2 RETURNING {_SOURCE_COLS}",
            patch, source_id,
        )
    if record is None:
        raise NotFoundError(f"Source {source_id!r} not found")
    return dict(record)


@_db_errors
async def merge_source_health(source_id: str, patch: Dict[str, Any], *, conn: Optional[asyncpg.Connection] = None) -> Row:
    """Shallow-merge keys into the `health` JSONB (e.g. {"last_seen": "...", "uptime_pct": 97.5})."""
    return await _merge_json(conn, source_id, "health", patch)


@_db_errors
async def merge_crawl_policy(source_id: str, patch: Dict[str, Any], *, conn: Optional[asyncpg.Connection] = None) -> Row:
    """Shallow-merge keys into the `crawl_policy` JSONB (e.g. {"rate_limit_per_min": 10})."""
    return await _merge_json(conn, source_id, "crawl_policy", patch)


@_db_errors
async def delete_source(source_id: str, *, conn: Optional[asyncpg.Connection] = None) -> bool:
    """Hard delete. Raises ReferenceViolationError while crawl jobs reference it -
    set status to 'dead' instead to keep history."""
    async with connection(conn) as c:
        result = await c.execute("DELETE FROM source WHERE source_id = $1", source_id)
    return result == "DELETE 1"


@_db_errors
async def count_sources_by_status(*, conn: Optional[asyncpg.Connection] = None) -> Dict[str, int]:
    async with connection(conn) as c:
        records = await c.fetch("SELECT status, count(*) AS n FROM source GROUP BY status")
    counts = {s: 0 for s in SOURCE_STATUSES}
    counts.update({rec["status"]: rec["n"] for rec in records})
    return counts


# ---------------------------------------------------------------------------
# CRAWL_JOB
# ---------------------------------------------------------------------------
# crawl_job has no created_at column, so "oldest/newest" means id order:
# ORDER BY length(job_id), job_id sorts job_999 before job_1000 correctly.

_JOB_COLS = "job_id, intent_id, source_id, kind, state, attempt, stats, error, started_at, finished_at"
_JOB_COLS_C = ", ".join(f"c.{col.strip()}" for col in _JOB_COLS.split(","))


@_db_errors
async def create_crawl_job(
    intent_id: str,
    source_id: str,
    kind: str = "scheduled",
    *,
    job_id: Optional[str] = None,
    conn: Optional[asyncpg.Connection] = None,
) -> Row:
    """Queue a crawl job. `source_id` must exist (else ReferenceViolationError)."""
    _check_choice("kind", kind, JOB_KINDS)
    if not intent_id.strip():
        raise InvalidValueError("intent_id is required")
    async with connection(conn) as c:
        job_id = job_id or await next_id("job", c)
        record = await c.fetchrow(
            f"INSERT INTO crawl_job (job_id, intent_id, source_id, kind) VALUES ($1, $2, $3, $4) RETURNING {_JOB_COLS}",
            job_id, intent_id.strip(), source_id, kind,
        )
    return dict(record)


@_db_errors
async def get_crawl_job(job_id: str, *, conn: Optional[asyncpg.Connection] = None) -> Optional[Row]:
    async with connection(conn) as c:
        record = await c.fetchrow(f"SELECT {_JOB_COLS} FROM crawl_job WHERE job_id = $1", job_id)
    return _row(record)


@_db_errors
async def list_crawl_jobs(
    *,
    source_id: Optional[str] = None,
    state: Optional[str] = None,
    kind: Optional[str] = None,
    intent_id: Optional[str] = None,
    newest_first: bool = True,
    limit: int = 100,
    offset: int = 0,
    conn: Optional[asyncpg.Connection] = None,
) -> List[Row]:
    _check_choice("state", state, JOB_STATES)
    _check_choice("kind", kind, JOB_KINDS)
    _check_page(limit, offset)
    where, args = _where({"source_id": source_id, "state": state, "kind": kind, "intent_id": intent_id})
    direction = "DESC" if newest_first else "ASC"
    async with connection(conn) as c:
        records = await c.fetch(
            f"SELECT {_JOB_COLS} FROM crawl_job {where} ORDER BY length(job_id) {direction}, job_id {direction} "
            f"LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}",
            *args, limit, offset,
        )
    return _rows(records)


async def _transition_error(c: asyncpg.Connection, job_id: str, target: str) -> DatabaseError:
    current = await c.fetchval("SELECT state FROM crawl_job WHERE job_id = $1", job_id)
    if current is None:
        return NotFoundError(f"Crawl job {job_id!r} not found")
    allowed = ", ".join(_JOB_TRANSITIONS[target])
    return InvalidStateTransition(f"Job {job_id!r} is '{current}'; it can only become '{target}' from: {allowed}")


@_db_errors
async def claim_next_job(
    *,
    source_id: Optional[str] = None,
    kind: Optional[str] = None,
    only_active_sources: bool = True,
    conn: Optional[asyncpg.Connection] = None,
) -> Optional[Row]:
    """Atomically take the oldest queued job and mark it running (attempt + 1).
    Safe with many workers (FOR UPDATE SKIP LOCKED). Returns None when the queue is empty.
    By default jobs for paused/dead sources are skipped."""
    _check_choice("kind", kind, JOB_KINDS)
    conditions, args = ["state = 'queued'"], []
    if source_id is not None:
        args.append(source_id)
        conditions.append(f"source_id = ${len(args)}")
    if kind is not None:
        args.append(kind)
        conditions.append(f"kind = ${len(args)}")
    if only_active_sources:
        conditions.append("source_id IN (SELECT source_id FROM source WHERE status = 'active')")
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"""
            WITH next AS (
                SELECT job_id FROM crawl_job
                WHERE {' AND '.join(conditions)}
                ORDER BY length(job_id), job_id
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE crawl_job c
               SET state = 'running', attempt = c.attempt + 1,
                   started_at = now(), finished_at = NULL, error = NULL
              FROM next
             WHERE c.job_id = next.job_id
         RETURNING {_JOB_COLS_C}
            """,
            *args,
        )
    return _row(record)


@_db_errors
async def start_job(job_id: str, *, conn: Optional[asyncpg.Connection] = None) -> Row:
    """queued -> running (attempt + 1, started_at = now())."""
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"""UPDATE crawl_job SET state = 'running', attempt = attempt + 1,
                       started_at = now(), finished_at = NULL, error = NULL
                 WHERE job_id = $1 AND state = 'queued' RETURNING {_JOB_COLS}""",
            job_id,
        )
        if record is None:
            raise await _transition_error(c, job_id, "running")
    return dict(record)


@_db_errors
async def finish_job(job_id: str, stats: Optional[Dict[str, Any]] = None, *, conn: Optional[asyncpg.Connection] = None) -> Row:
    """running -> done. `stats` (pages fetched, bytes, ...) is merged into the existing stats."""
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"""UPDATE crawl_job SET state = 'done', finished_at = now(), error = NULL,
                       stats = stats || $2::jsonb
                 WHERE job_id = $1 AND state = 'running' RETURNING {_JOB_COLS}""",
            job_id, stats or {},
        )
        if record is None:
            raise await _transition_error(c, job_id, "done")
    return dict(record)


@_db_errors
async def fail_job(
    job_id: str,
    error: str,
    stats: Optional[Dict[str, Any]] = None,
    *,
    dead: bool = False,
    conn: Optional[asyncpg.Connection] = None,
) -> Row:
    """running -> failed (retryable), or -> dead when dead=True (gave up)."""
    target = "dead" if dead else "failed"
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"""UPDATE crawl_job SET state = $2, finished_at = now(), error = $3,
                       stats = stats || $4::jsonb
                 WHERE job_id = $1 AND state = ANY($5::text[]) RETURNING {_JOB_COLS}""",
            job_id, target, error, stats or {}, list(_JOB_TRANSITIONS[target]),
        )
        if record is None:
            raise await _transition_error(c, job_id, target)
    return dict(record)


@_db_errors
async def retry_job(job_id: str, *, conn: Optional[asyncpg.Connection] = None) -> Row:
    """failed -> queued (keeps the attempt count and the last error until it runs again)."""
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"""UPDATE crawl_job SET state = 'queued', started_at = NULL, finished_at = NULL
                 WHERE job_id = $1 AND state = 'failed' RETURNING {_JOB_COLS}""",
            job_id,
        )
        if record is None:
            raise await _transition_error(c, job_id, "queued")
    return dict(record)


@_db_errors
async def mark_job_dead(job_id: str, error: Optional[str] = None, *, conn: Optional[asyncpg.Connection] = None) -> Row:
    """queued / running / failed -> dead (permanently abandoned)."""
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"""UPDATE crawl_job SET state = 'dead', finished_at = now(), error = COALESCE($2, error)
                 WHERE job_id = $1 AND state = ANY($3::text[]) RETURNING {_JOB_COLS}""",
            job_id, error, list(_JOB_TRANSITIONS["dead"]),
        )
        if record is None:
            raise await _transition_error(c, job_id, "dead")
    return dict(record)


@_db_errors
async def update_job_stats(job_id: str, patch: Dict[str, Any], *, conn: Optional[asyncpg.Connection] = None) -> Row:
    """Merge progress metrics into `stats` at any time (e.g. {"pages_fetched": 120})."""
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"UPDATE crawl_job SET stats = stats || $2::jsonb WHERE job_id = $1 RETURNING {_JOB_COLS}", job_id, patch
        )
    if record is None:
        raise NotFoundError(f"Crawl job {job_id!r} not found")
    return dict(record)


@_db_errors
async def delete_crawl_job(job_id: str, *, conn: Optional[asyncpg.Connection] = None) -> bool:
    async with connection(conn) as c:
        result = await c.execute("DELETE FROM crawl_job WHERE job_id = $1", job_id)
    return result == "DELETE 1"


@_db_errors
async def count_jobs_by_state(*, source_id: Optional[str] = None, conn: Optional[asyncpg.Connection] = None) -> Dict[str, int]:
    """{'queued': n, 'running': n, 'done': n, 'failed': n, 'dead': n} - zero-filled."""
    where, args = _where({"source_id": source_id})
    async with connection(conn) as c:
        records = await c.fetch(f"SELECT state, count(*) AS n FROM crawl_job {where} GROUP BY state", *args)
    counts = {s: 0 for s in JOB_STATES}
    counts.update({rec["state"]: rec["n"] for rec in records})
    return counts


# ---------------------------------------------------------------------------
# Cross-table: the traceability chain from the report (job -> source -> user)
# ---------------------------------------------------------------------------


@_db_errors
async def get_job_trace(job_id: str, *, conn: Optional[asyncpg.Connection] = None) -> Optional[Row]:
    """One job plus the source it targeted and the user who registered that source."""
    async with connection(conn) as c:
        record = await c.fetchrow(
            f"""SELECT {_JOB_COLS_C},
                       s.name AS source_name, s.source_type, s.auth_ref, s.status AS source_status,
                       u.usr_id AS created_by, u.username AS created_by_username
                  FROM crawl_job c
                  JOIN source s ON c.source_id = s.source_id
                  JOIN users u  ON s.created_by = u.usr_id
                 WHERE c.job_id = $1""",
            job_id,
        )
    return _row(record)


@_db_errors
async def dashboard_counts(*, conn: Optional[asyncpg.Connection] = None) -> Row:
    """Everything a dashboard header needs in one call."""
    async with connection(conn) as c:
        return {
            "users_by_role": await count_users_by_role(conn=c),
            "sources_by_status": await count_sources_by_status(conn=c),
            "jobs_by_state": await count_jobs_by_state(conn=c),
        }


# ---------------------------------------------------------------------------
# CLI:  python db_utils.py init | health
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import asyncio
    import sys

    async def _main(command: str) -> int:
        try:
            await init_pool()
            if command == "init":
                await init_schema()
                print("Schema ready (users, source, crawl_job + id sequences).")
            elif command == "health":
                print(await health_check())
            else:
                print(__doc__)
                return 2
        except DatabaseError as exc:
            print(f"ERROR: {exc}")
            return 1
        finally:
            await close_pool()
        return 0

    sys.exit(asyncio.run(_main(sys.argv[1] if len(sys.argv) > 1 else "")))
