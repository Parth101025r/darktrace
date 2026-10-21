"""End-to-end API tests (needs fastapi + httpx)."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main_jwt_demo import app  # noqa: E402
from app.services import user_store  # noqa: E402

import os  # noqa: E402

pytestmark = pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="set TEST_DATABASE_URL to run API tests")
U = {"username": "dhaval", "email": "d@example.com", "password": "Str0ngPass!"}


client = None  # set by the fixture below (module-level so the helpers can use it)


@pytest.fixture(autouse=True)
def _api():
    global client
    with TestClient(app) as c:  # runs the lifespan: opens the pool, creates tables
        client = c
        c.portal.call(user_store.clear)
        yield
        c.portal.call(user_store.clear)


def _login(pw=U["password"]):
    return client.post("/api/v1/auth/token", data={"username": U["username"], "password": pw})


def _register_login():
    client.post("/api/v1/auth/register", json=U)
    return _login().json()


def test_register_ok_and_duplicate():
    assert client.post("/api/v1/auth/register", json=U).status_code == 201
    assert client.post("/api/v1/auth/register", json=U).status_code == 409


def test_register_weak_password_422():
    assert client.post("/api/v1/auth/register", json={**U, "password": "short"}).status_code == 422


def test_login_success_returns_tokens():
    client.post("/api/v1/auth/register", json=U)
    r = _login()
    assert r.status_code == 200
    b = r.json()
    assert b["token_type"] == "bearer" and b["access_token"] and b["refresh_token"]


def test_login_wrong_password_401():
    client.post("/api/v1/auth/register", json=U)
    assert _login("nope-nope").status_code == 401


def test_login_unknown_user_401():
    assert _login().status_code == 401


def test_me_requires_token():
    assert client.get("/api/v1/auth/me").status_code == 401


def test_me_with_valid_token():
    t = _register_login()
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {t['access_token']}"})
    assert r.status_code == 200 and r.json()["username"] == "dhaval"
    assert "password" not in r.text


def test_me_with_garbage_token_401():
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer abc.def.ghi"}).status_code == 401


def test_refresh_token_rejected_on_protected_route():
    t = _register_login()
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {t['refresh_token']}"})
    assert r.status_code == 401


def test_refresh_rotates_and_old_one_dies():
    t = _register_login()
    r1 = client.post("/api/v1/auth/refresh", json={"refresh_token": t["refresh_token"]})
    assert r1.status_code == 200
    assert client.get("/api/v1/auth/me",
                      headers={"Authorization": f"Bearer {r1.json()['access_token']}"}).status_code == 200
    # replay of old refresh token must fail
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": t["refresh_token"]}).status_code == 401


def test_access_token_cannot_refresh():
    t = _register_login()
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": t["access_token"]}).status_code == 401


def test_logout_revokes_both_tokens():
    t = _register_login()
    h = {"Authorization": f"Bearer {t['access_token']}"}
    assert client.post("/api/v1/auth/logout", json={"refresh_token": t["refresh_token"]}, headers=h).status_code == 204
    assert client.get("/api/v1/auth/me", headers=h).status_code == 401
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": t["refresh_token"]}).status_code == 401
