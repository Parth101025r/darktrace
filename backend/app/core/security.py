"""Password hashing + JWT create/verify. No FastAPI imports here (easy to unit test)."""
import base64
import hashlib
import hmac
import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt  # PyJWT

from app.core.config import get_settings

ACCESS = "access"
REFRESH = "refresh"


class TokenError(Exception):
    """Any invalid / expired / revoked / wrong-type token."""


# ---------- passwords (scrypt, stdlib only) ----------
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_b64, dk_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(dk_b64)
        dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P)
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


# ---------- revocation (swap with Redis/DB table in production) ----------
_revoked_jti: set[str] = set()


def revoke_token(jti: str) -> None:
    _revoked_jti.add(jti)


def is_revoked(jti: str) -> bool:
    return jti in _revoked_jti


# ---------- JWT ----------
def _create_token(subject: str, token_type: str, expires: timedelta, extra: dict | None = None) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    claims = {"sub", "type", "iss", "iat", "nbf", "exp", "jti"}
    if extra and claims.intersection(extra):
        raise ValueError("extra claims cannot override reserved token claims")
    payload = {
        "sub": subject,
        "type": token_type,
        "iss": s.jwt_issuer,
        "iat": now,
        "nbf": now,
        "exp": now + expires,
        "jti": uuid.uuid4().hex,
        **(extra or {}),
    }
    return jwt.encode(payload, s.jwt_secret_key, algorithm=s.jwt_algorithm)


def create_access_token(subject: str, extra: dict | None = None) -> str:
    return _create_token(subject, ACCESS, timedelta(minutes=get_settings().access_token_expire_minutes), extra)


def create_refresh_token(subject: str) -> str:
    return _create_token(subject, REFRESH, timedelta(days=get_settings().refresh_token_expire_days))


def decode_token(token: str, expected_type: str = ACCESS) -> dict:
    s = get_settings()
    try:
        payload = jwt.decode(
            token,
            s.jwt_secret_key,
            algorithms=[s.jwt_algorithm],  # pinned: blocks alg=none / alg confusion
            issuer=s.jwt_issuer,
            options={"require": ["exp", "iat", "sub", "jti", "type"]},
        )
    except jwt.PyJWTError as e:
        raise TokenError(str(e)) from e
    if payload.get("type") != expected_type:
        raise TokenError("wrong token type")
    if not isinstance(payload.get("sub"), str) or not payload["sub"]:
        raise TokenError("invalid token subject")
    jti = payload.get("jti")
    if not isinstance(jti, str) or not jti:
        raise TokenError("invalid token identifier")
    if is_revoked(jti):
        raise TokenError("token revoked")
    return payload
