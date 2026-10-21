"""Pure unit tests: PyJWT + stdlib only."""
import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.core import security as sec
from app.core.config import get_settings


def test_password_hash_and_verify():
    h = sec.hash_password("S3cret!pass")
    assert h != "S3cret!pass" and h.startswith("scrypt$")
    assert sec.verify_password("S3cret!pass", h)
    assert not sec.verify_password("wrong", h)
    assert not sec.verify_password("x", "garbage")


def test_same_password_different_hashes():
    assert sec.hash_password("abc12345") != sec.hash_password("abc12345")


def test_access_token_roundtrip():
    p = sec.decode_token(sec.create_access_token("dhaval"), sec.ACCESS)
    assert p["sub"] == "dhaval" and p["type"] == "access" and p["iss"] == "darktrace"


def test_extra_claims_cannot_override_reserved_claims():
    with pytest.raises(ValueError, match="reserved token claims"):
        sec.create_access_token("dhaval", {"sub": "admin"})


def test_expired_token_rejected():
    s = get_settings()
    now = datetime.now(timezone.utc)
    t = jwt.encode({"sub": "u", "type": "access", "iss": s.jwt_issuer, "jti": "x1",
                    "iat": now - timedelta(hours=2), "exp": now - timedelta(hours=1)},
                   s.jwt_secret_key, algorithm=s.jwt_algorithm)
    with pytest.raises(sec.TokenError):
        sec.decode_token(t)


def test_tampered_token_rejected():
    t = sec.create_access_token("u")
    h, p, sig = t.split(".")
    with pytest.raises(sec.TokenError):
        sec.decode_token(f"{h}.{p}.{sig[:-2]}AA")


def test_wrong_secret_rejected():
    t = jwt.encode({"sub": "u", "type": "access", "iss": "darktrace", "jti": "j",
                    "iat": datetime.now(timezone.utc),
                    "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                   "another-secret-another-secret-another-1", algorithm="HS256")
    with pytest.raises(sec.TokenError):
        sec.decode_token(t)


def test_alg_none_rejected():
    t = jwt.encode({"sub": "admin", "type": "access", "iss": "darktrace", "jti": "j",
                    "iat": datetime.now(timezone.utc),
                    "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                   None, algorithm="none")
    with pytest.raises(sec.TokenError):
        sec.decode_token(t)


def test_wrong_issuer_rejected():
    s = get_settings()
    t = jwt.encode({"sub": "u", "type": "access", "iss": "evil", "jti": "j",
                    "iat": datetime.now(timezone.utc),
                    "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                   s.jwt_secret_key, algorithm=s.jwt_algorithm)
    with pytest.raises(sec.TokenError):
        sec.decode_token(t)


def test_refresh_token_cannot_be_used_as_access():
    with pytest.raises(sec.TokenError):
        sec.decode_token(sec.create_refresh_token("u"), sec.ACCESS)


def test_access_token_cannot_be_used_as_refresh():
    with pytest.raises(sec.TokenError):
        sec.decode_token(sec.create_access_token("u"), sec.REFRESH)


def test_revoked_token_rejected():
    t = sec.create_access_token("u")
    sec.revoke_token(sec.decode_token(t)["jti"])
    with pytest.raises(sec.TokenError):
        sec.decode_token(t)


def test_missing_required_claim_rejected():
    s = get_settings()
    t = jwt.encode({"sub": "u"}, s.jwt_secret_key, algorithm=s.jwt_algorithm)
    with pytest.raises(sec.TokenError):
        sec.decode_token(t)


def test_invalid_claim_types_rejected():
    s = get_settings()
    now = datetime.now(timezone.utc)
    t = jwt.encode(
        {
            "sub": "u",
            "type": "access",
            "iss": s.jwt_issuer,
            "jti": [],
            "iat": now,
            "exp": now + timedelta(minutes=5),
        },
        s.jwt_secret_key,
        algorithm=s.jwt_algorithm,
    )
    with pytest.raises(sec.TokenError):
        sec.decode_token(t)


def test_short_secret_refused(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "short")
    with pytest.raises(RuntimeError):
        get_settings()
