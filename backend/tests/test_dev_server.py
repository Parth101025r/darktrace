import os

os.environ.setdefault("REDIS_URL", "redis://localhost:6379")

from fastapi.testclient import TestClient

import dev_server
from dev_server import ALERTS_KEY, ALERT_ID_KEY, app


class FakeRedis:
    def __init__(self):
        self.values = []
        self.next_id = 0

    async def lrange(self, key, start, end):
        assert key == ALERTS_KEY
        return self.values[start:] if end == -1 else self.values[start : end + 1]

    async def incr(self, key):
        assert key == ALERT_ID_KEY
        self.next_id += 1
        return self.next_id

    async def lpush(self, key, value):
        assert key == ALERTS_KEY
        self.values.insert(0, value)

    async def ping(self):
        return True

    async def aclose(self):
        pass


def test_redis_alerts_and_dashboard_summary(monkeypatch):
    redis_client = FakeRedis()
    monkeypatch.setattr(dev_server.redis, "from_url", lambda *args, **kwargs: redis_client)
    with TestClient(app) as client:
        client.post(
            "/api/v1/auth/register",
            json={"username": "analyst", "email": "a@example.com", "password": "password123"},
        )
        token_response = client.post(
            "/api/v1/auth/token",
            data={"username": "analyst", "password": "password123"},
        )
        headers = {"Authorization": f"Bearer {token_response.json()['access_token']}"}

        created = client.post(
            "/api/v1/alerts",
            json={"title": "Test alert", "severity": "high"},
            headers=headers,
        )

        assert created.status_code == 201
        assert created.json()["id"] == "alert_dev_001"
        assert client.get("/api/v1/alerts", headers=headers).json() == [created.json()]
        assert client.get("/api/v1/dashboard/summary", headers=headers).json()[
            "alerts_by_severity"
        ] == {"critical": 0, "high": 1, "medium": 0, "low": 0}
