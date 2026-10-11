"""
login.py — standalone Login / SignUp service, everything in one file.

Owns the `users` table and is the only place that creates JWTs. Other
backends (e.g. Dark Web Monitor Module 1) just validate the token with
the same JWT_SECRET_KEY — they never call back into this file.

Setup:
    pip install fastapi "uvicorn[standard]" "sqlalchemy[asyncio]" asyncpg \
                python-jose[cryptography] passlib[bcrypt] pydantic-settings email-validator

Env vars (set these, e.g. in a .env file or your shell):
    POSTGRES_HOST=localhost
    POSTGRES_PORT=5433
    POSTGRES_USER=auth_user
    POSTGRES_PASSWORD=change_me
    POSTGRES_DB=auth_service
    JWT_SECRET_KEY=change_me_to_a_long_random_secret   # must match other services
    JWT_ALGORITHM=HS256
    ACCESS_TOKEN_EXPIRE_MINUTES=480
    REFRESH_TOKEN_EXPIRE_DAYS=7

Run:
    uvicorn login:app --reload --port 8001

First run only — create the users table (no Alembic in this single-file version):
    python -c "import asyncio; from login import engine, Base; asyncio.run(engine.begin().__anext__())" 2>/dev/null
    # simplest: just call create_tables() below once, see __main__ block at bottom
"""

import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import Boolean, DateTime, String, select
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# ---------------------------------------------------------------------------
# Config (env vars, with dev-friendly defaults)
# ---------------------------------------------------------------------------

POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5433")
POSTGRES_USER = os.getenv("POSTGRES_USER", "auth_user")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "change_me")
POSTGRES_DB = os.getenv("POSTGRES_DB", "auth_service")

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change_me_to_a_long_random_secret")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

POSTGRES_DSN = (
    f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}"
    f"@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
)

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

engine = create_async_engine(POSTGRES_DSN, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(50), default="analyst")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


async def create_tables():
    """Call once to create the users table (no Alembic in this single-file version)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ---------------------------------------------------------------------------
# Security — password hashing + JWT
# ---------------------------------------------------------------------------

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def _create_token(subject: str, expires_delta: timedelta, token_type: str, extra_claims: dict | None = None) -> str:
    expire = datetime.now(timezone.utc) + expires_delta
    payload = {"sub": subject, "exp": expire, "type": token_type, **(extra_claims or {})}
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_access_token(subject: str, username: str | None = None, role: str | None = None) -> str:
    claims = {k: v for k, v in {"username": username, "role": role}.items() if v is not None}
    return _create_token(subject, timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES), "access", claims)


def create_refresh_token(subject: str) -> str:
    return _create_token(subject, timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS), "refresh")


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])


async def get_current_user(authorization: str = Header(...), db: AsyncSession = Depends(get_db)) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.removeprefix("Bearer ").strip()

    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Not an access token")
        user_id = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = await db.get(User, uuid.UUID(user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SignUpRequest(BaseModel):
    username: str
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    email: str
    role: str
    is_active: bool

    class Config:
        from_attributes = True


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


# ---------------------------------------------------------------------------
# App + endpoints
# ---------------------------------------------------------------------------

app = FastAPI(title="Auth Service — Login / SignUp", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", tags=["System"])
async def root():
    return {"service": "auth-service", "status": "running", "docs": "/docs"}


@app.get("/health", tags=["System"])
async def health_check():
    return {"status": "ok", "service": "auth-service"}


@app.post("/api/v1/auth/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED, tags=["Auth"])
async def signup(payload: SignUpRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(User).where((User.username == payload.username) | (User.email == payload.email))
    )
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="Username or email already registered")

    user = User(
        username=payload.username,
        email=payload.email,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@app.post("/api/v1/auth/login", response_model=TokenPair, tags=["Auth"])
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Plain JSON login — send {"username": "...", "password": "..."}."""
    result = await db.execute(select(User).where(User.username == payload.username))
    user = result.scalars().first()

    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")

    return {
        "access_token": create_access_token(subject=str(user.id), username=user.username, role=user.role),
        "refresh_token": create_refresh_token(subject=str(user.id)),
    }


@app.post("/api/v1/auth/refresh", response_model=TokenPair, tags=["Auth"])
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        data = decode_token(payload.refresh_token)
        if data.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Not a refresh token")
        user_id = data.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    user = await db.get(User, uuid.UUID(user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return {
        "access_token": create_access_token(subject=str(user.id), username=user.username, role=user.role),
        "refresh_token": create_refresh_token(subject=str(user.id)),
    }


@app.get("/api/v1/auth/me", response_model=UserOut, tags=["Auth"])
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@app.post("/api/v1/auth/logout", tags=["Auth"])
async def logout(current_user: User = Depends(get_current_user)):
    """Stateless JWT — no server-side session to kill. Client should discard the token."""
    return {"status": "logged_out", "note": "Discard the token client-side."}


# ---------------------------------------------------------------------------
# One-time table creation helper — run `python login.py` once before first use
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import asyncio
    print("Creating users table if it doesn't exist...")
    asyncio.run(create_tables())
    print("Done. Now run: uvicorn login:app --reload --port 8001")
