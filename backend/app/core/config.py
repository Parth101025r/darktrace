"""JWT settings, loaded from environment (.env via your existing loader)."""
import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    jwt_issuer: str = "darktrace"


def get_settings() -> Settings:
    secret = os.getenv("JWT_SECRET_KEY", "")
    if len(secret) < 32:
        raise RuntimeError(
            "JWT_SECRET_KEY missing or too short (min 32 chars). "
            "Generate: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    return Settings(
        jwt_secret_key=secret,
        jwt_algorithm=os.getenv("JWT_ALGORITHM", "HS256"),
        access_token_expire_minutes=int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15")),
        refresh_token_expire_days=int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7")),
        jwt_issuer=os.getenv("JWT_ISSUER", "darktrace"),
    )
