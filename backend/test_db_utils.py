"""
Tests for db_utils.py - run against a REAL PostgreSQL (use a throwaway database,
the fixture DROPS users / source / crawl_job before every test).

    pip install pytest pytest-asyncio asyncpg
    set TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/darktrace_test    (Windows cmd)
    export TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/darktrace_test (Mac/Linux)
    pytest test_db_utils.py -v
"""

import asyncio
import os

import pytest
import pytest_asyncio

import db_utils as db

TEST_DSN = os.getenv("TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(not TEST_DSN, reason="set TEST_DATABASE_URL to run the database tests"),
]


@pytest_asyncio.fixture
async def pool():
    await db.init_pool(TEST_DSN, max_size=5)
    async with db.get_pool().acquire() as conn:
        await conn.execute(
            "DROP TABLE IF EXISTS crawl_job, source, users CASCADE;"
            "DROP SEQUENCE IF EXISTS usr_id_seq, src_id_seq, job_id_seq;"
        )
    await db.init_schema()
    yield
    await db.close_pool()


@pytest_asyncio.fixture
async def user(pool):
    return await db.create_user("nikhil", "nikhil@example.com", "hashed_pw_here")


@pytest_asyncio.fixture
async def source(user):
    return await db.create_source("Test Forum", "forum", "auth_rec_001", user["usr_id"], onion_addr="xyz123.onion")


# ---- connection / schema ---------------------------------------------------


async def test_health_check_ok(pool):
    result = await db.health_check()
    assert result["ok"] is True and "server_version" in result


async def test_health_check_never_raises_when_pool_missing():
    await db.close_pool()
    result = await db.health_check()
    assert result["ok"] is False


async def test_get_pool_before_init_raises():
    await db.close_pool()
    with pytest.raises(db.DatabaseConnectionError):
        db.get_pool()


async def test_init_pool_bad_port_raises_connection_error():
    await db.close_pool()
    with pytest.raises(db.DatabaseConnectionError):
        await db.init_pool("postgresql://nobody@127.0.0.1:1/nope")


async def test_init_schema_is_idempotent(pool):
    await db.init_schema()
    await db.init_schema()


async def test_build_dsn_variants(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:1/d")
    assert db.build_dsn() == "postgresql://u:p@h:1/d"
    monkeypatch.delenv("DATABASE_URL")
    monkeypatch.setenv("POSTGRES_USER", "a b")
    monkeypatch.setenv("POSTGRES_PASSWORD", "p@ss/word")
    monkeypatch.setenv("POSTGRES_HOST", "db")
    monkeypatch.setenv("POSTGRES_PORT", "5433")
    monkeypatch.setenv("POSTGRES_DB", "x")
    assert db.build_dsn() == "postgresql://a+b:p%40ss%2Fword@db:5433/x"


# ---- ids -------------------------------------------------------------------


async def test_ids_are_prefixed_and_sequential(pool):
    assert await db.next_id("usr") == "usr_001"
    assert await db.next_id("usr") == "usr_002"
    assert await db.next_id("src") == "src_001"
    assert await db.next_id("job") == "job_001"


async def test_next_id_rejects_unknown_prefix(pool):
    with pytest.raises(db.InvalidValueError):
        await db.next_id("evil'; DROP TABLE users;--")


async def test_sync_sequences_after_manual_inserts(pool):
    # the report's sample data inserts hand-written ids
    await db.create_user("manual", "m@example.com", "h", usr_id="usr_007")
    await db.sync_id_sequences()
    assert await db.next_id("usr") == "usr_008"


async def test_ids_unique_under_concurrency(pool):
    ids = await asyncio.gather(*[db.next_id("job") for _ in range(40)])
    assert len(set(ids)) == 40


# ---- users -----------------------------------------------------------------


async def test_create_user_defaults_and_no_hash_leak(user):
    assert user["usr_id"] == "usr_001"
    assert user["role"] == "analyst" and user["status"] == "active" and user["mfa_enabled"] is False
    assert "password_hash" not in user and user["created_at"] is not None


async def test_get_user_variants_and_include_hash(user):
    assert (await db.get_user("usr_001"))["username"] == "nikhil"
    assert (await db.get_user_by_username("nikhil"))["usr_id"] == "usr_001"
    assert (await db.get_user_by_email("nikhil@example.com"))["usr_id"] == "usr_001"
    assert "password_hash" not in await db.get_user("usr_001")
    assert (await db.get_user_by_username("nikhil", include_hash=True))["password_hash"] == "hashed_pw_here"
    assert await db.get_user("usr_999") is None


async def test_duplicate_username_and_email(user):
    with pytest.raises(db.DuplicateError):
        await db.create_user("nikhil", "other@example.com", "h")
    with pytest.raises(db.DuplicateError):
        await db.create_user("other", "nikhil@example.com", "h")


async def test_user_validation(pool):
    with pytest.raises(db.InvalidValueError):
        await db.create_user("a", "a@example.com", "h", role="god")
    with pytest.raises(db.InvalidValueError):
        await db.create_user("  ", "a@example.com", "h")
    with pytest.raises(db.InvalidValueError):
        await db.create_user("a", "a@example.com", "")


async def test_list_users_filters_and_paging(pool):
    await db.create_user("a", "a@example.com", "h", "analyst")
    await db.create_user("b", "b@example.com", "h", "auditor")
    await db.create_user("c", "c@example.com", "h", "analyst", status="disabled")
    assert len(await db.list_users()) == 3
    assert {u["username"] for u in await db.list_users(role="analyst")} == {"a", "c"}
    assert [u["username"] for u in await db.list_users(role="analyst", status="active")] == ["a"]
    assert len(await db.list_users(limit=2)) == 2
    assert len(await db.list_users(limit=2, offset=2)) == 1
    with pytest.raises(db.InvalidValueError):
        await db.list_users(limit=0)


async def test_update_user_and_missing(user):
    updated = await db.update_user("usr_001", role="supervisor", mfa_enabled=True)
    assert updated["role"] == "supervisor" and updated["mfa_enabled"] is True
    assert (await db.update_user("usr_001"))["role"] == "supervisor"  # no-op returns the row
    with pytest.raises(db.NotFoundError):
        await db.update_user("usr_999", role="analyst")
    with pytest.raises(db.InvalidValueError):
        await db.update_user("usr_001", status="banned")


async def test_password_login_disable_enable(user):
    await db.set_password_hash("usr_001", "new_hash")
    assert (await db.get_user("usr_001", include_hash=True))["password_hash"] == "new_hash"
    assert user["last_login_at"] is None
    assert (await db.record_login("usr_001"))["last_login_at"] is not None
    assert (await db.disable_user("usr_001"))["status"] == "disabled"
    assert (await db.enable_user("usr_001"))["status"] == "active"
    with pytest.raises(db.NotFoundError):
        await db.set_password_hash("usr_999", "x")
    with pytest.raises(db.NotFoundError):
        await db.record_login("usr_999")


async def test_delete_user_blocked_while_referenced(source, user):
    with pytest.raises(db.ReferenceViolationError):
        await db.delete_user(user["usr_id"])
    other = await db.create_user("temp", "t@example.com", "h")
    assert await db.delete_user(other["usr_id"]) is True
    assert await db.delete_user(other["usr_id"]) is False


async def test_count_users_by_role(user):
    counts = await db.count_users_by_role()
    assert counts["analyst"] == 1 and counts["sysadmin"] == 0 and set(counts) == set(db.USER_ROLES)


# ---- sources ---------------------------------------------------------------


async def test_create_source(source, user):
    assert source["source_id"] == "src_001" and source["created_by"] == user["usr_id"]
    assert source["crawl_policy"] == {} and source["health"] == {} and source["status"] == "active"


async def test_source_requires_auth_ref_valid_type_and_real_creator(user):
    with pytest.raises(db.InvalidValueError):
        await db.create_source("x", "forum", "", user["usr_id"])
    with pytest.raises(db.InvalidValueError):
        await db.create_source("x", "forum", "   ", user["usr_id"])
    with pytest.raises(db.InvalidValueError):
        await db.create_source("x", "darknet", "auth", user["usr_id"])
    with pytest.raises(db.ReferenceViolationError):
        await db.create_source("x", "forum", "auth", "usr_999")


async def test_source_jsonb_roundtrip_and_merge(user):
    s = await db.create_source(
        "Market", "marketplace", "auth_2", user["usr_id"],
        crawl_policy={"schedule": "0 * * * *", "rate_limit": {"per_min": 10}},
    )
    assert s["crawl_policy"]["rate_limit"]["per_min"] == 10
    merged = await db.merge_crawl_policy(s["source_id"], {"depth": 3})
    assert merged["crawl_policy"]["schedule"] == "0 * * * *" and merged["crawl_policy"]["depth"] == 3
    health = await db.merge_source_health(s["source_id"], {"uptime_pct": 97.5})
    health = await db.merge_source_health(s["source_id"], {"last_error": None})
    assert health["health"] == {"uptime_pct": 97.5, "last_error": None}
    with pytest.raises(db.NotFoundError):
        await db.merge_source_health("src_999", {"a": 1})


async def test_list_sources_filters(user, source):
    await db.create_source("Paste", "paste", "auth_3", user["usr_id"], status="paused")
    assert len(await db.list_sources()) == 2
    assert [s["name"] for s in await db.list_sources(status="paused")] == ["Paste"]
    assert [s["name"] for s in await db.list_sources(source_type="forum")] == ["Test Forum"]
    assert len(await db.list_sources(created_by=user["usr_id"])) == 2
    assert await db.list_sources(created_by="usr_999") == []


async def test_update_source_clear_onion_and_replace_policy(source):
    cleared = await db.update_source(source["source_id"], onion_addr=None)
    assert cleared["onion_addr"] is None
    kept = await db.update_source(source["source_id"], name="Renamed")
    assert kept["name"] == "Renamed" and kept["onion_addr"] is None  # UNSET leaves it alone
    replaced = await db.update_source(source["source_id"], crawl_policy={"only": "this"})
    assert replaced["crawl_policy"] == {"only": "this"}
    assert (await db.set_source_status(source["source_id"], "paused"))["status"] == "paused"
    with pytest.raises(db.InvalidValueError):
        await db.update_source(source["source_id"], auth_ref="")
    with pytest.raises(db.NotFoundError):
        await db.update_source("src_999", name="x")


async def test_delete_source_blocked_by_jobs(source):
    job = await db.create_crawl_job("ci_1", source["source_id"])
    with pytest.raises(db.ReferenceViolationError):
        await db.delete_source(source["source_id"])
    assert await db.delete_crawl_job(job["job_id"]) is True
    assert await db.delete_source(source["source_id"]) is True
    assert await db.get_source(source["source_id"]) is None


async def test_count_sources_by_status(source):
    assert (await db.count_sources_by_status()) == {"active": 1, "paused": 0, "dead": 0}


# ---- crawl jobs ------------------------------------------------------------


async def test_create_job_defaults_and_validation(source):
    job = await db.create_crawl_job("ci_001", source["source_id"], "scheduled")
    assert job["job_id"] == "job_001" and job["state"] == "queued" and job["attempt"] == 0
    assert job["stats"] == {} and job["started_at"] is None
    with pytest.raises(db.ReferenceViolationError):
        await db.create_crawl_job("ci_2", "src_999")
    with pytest.raises(db.InvalidValueError):
        await db.create_crawl_job("ci_2", source["source_id"], "weird")
    with pytest.raises(db.InvalidValueError):
        await db.create_crawl_job("", source["source_id"])


async def test_job_lifecycle_done(source):
    job = await db.create_crawl_job("ci_1", source["source_id"])
    running = await db.start_job(job["job_id"])
    assert running["state"] == "running" and running["attempt"] == 1 and running["started_at"] is not None
    await db.update_job_stats(job["job_id"], {"pages_fetched": 10})
    done = await db.finish_job(job["job_id"], {"bytes": 2048})
    assert done["state"] == "done" and done["finished_at"] is not None
    assert done["stats"] == {"pages_fetched": 10, "bytes": 2048}


async def test_job_failure_retry_and_dead(source):
    job = await db.create_crawl_job("ci_1", source["source_id"])
    await db.start_job(job["job_id"])
    failed = await db.fail_job(job["job_id"], "timeout", {"pages_fetched": 3})
    assert failed["state"] == "failed" and failed["error"] == "timeout"
    queued = await db.retry_job(job["job_id"])
    assert queued["state"] == "queued" and queued["attempt"] == 1 and queued["started_at"] is None
    again = await db.start_job(job["job_id"])
    assert again["attempt"] == 2 and again["error"] is None
    dead = await db.fail_job(job["job_id"], "gave up", dead=True)
    assert dead["state"] == "dead"


async def test_invalid_state_transitions(source):
    job = await db.create_crawl_job("ci_1", source["source_id"])
    jid = job["job_id"]
    with pytest.raises(db.InvalidStateTransition):
        await db.finish_job(jid)  # queued -> done not allowed
    with pytest.raises(db.InvalidStateTransition):
        await db.fail_job(jid, "x")
    with pytest.raises(db.InvalidStateTransition):
        await db.retry_job(jid)
    await db.start_job(jid)
    with pytest.raises(db.InvalidStateTransition):
        await db.start_job(jid)  # already running
    await db.finish_job(jid)
    with pytest.raises(db.InvalidStateTransition):
        await db.mark_job_dead(jid)  # done is final
    with pytest.raises(db.NotFoundError):
        await db.start_job("job_999")
    with pytest.raises(db.NotFoundError):
        await db.update_job_stats("job_999", {"a": 1})


async def test_mark_job_dead_from_queued(source):
    job = await db.create_crawl_job("ci_1", source["source_id"])
    dead = await db.mark_job_dead(job["job_id"], "source taken down")
    assert dead["state"] == "dead" and dead["error"] == "source taken down"


async def test_list_jobs_filters_and_numeric_order(source):
    for i in range(3):
        await db.create_crawl_job(f"ci_{i}", source["source_id"], "manual" if i == 2 else "scheduled")
    await db.create_crawl_job("ci_x", source["source_id"], job_id="job_999")
    await db.create_crawl_job("ci_y", source["source_id"], job_id="job_1000")
    ids = [j["job_id"] for j in await db.list_crawl_jobs(newest_first=False)]
    assert ids[-2:] == ["job_999", "job_1000"]  # job_1000 sorts AFTER job_999
    assert (await db.list_crawl_jobs())[0]["job_id"] == "job_1000"
    assert len(await db.list_crawl_jobs(kind="manual")) == 1
    assert len(await db.list_crawl_jobs(intent_id="ci_1")) == 1
    assert len(await db.list_crawl_jobs(source_id=source["source_id"], state="queued")) == 5
    assert await db.list_crawl_jobs(state="done") == []


async def test_claim_next_job_fifo_filters_and_empty_queue(user, source):
    other = await db.create_source("Other", "blog", "auth_o", user["usr_id"])
    j1 = await db.create_crawl_job("ci_1", source["source_id"], "scheduled")
    j2 = await db.create_crawl_job("ci_2", other["source_id"], "manual")
    j3 = await db.create_crawl_job("ci_3", source["source_id"], "scheduled")
    first = await db.claim_next_job()
    assert first["job_id"] == j1["job_id"] and first["state"] == "running" and first["attempt"] == 1
    assert (await db.claim_next_job(kind="manual"))["job_id"] == j2["job_id"]
    assert (await db.claim_next_job(source_id=source["source_id"]))["job_id"] == j3["job_id"]
    assert await db.claim_next_job() is None


async def test_claim_skips_paused_sources_unless_told_otherwise(source):
    await db.create_crawl_job("ci_1", source["source_id"])
    await db.set_source_status(source["source_id"], "paused")
    assert await db.claim_next_job() is None
    assert (await db.claim_next_job(only_active_sources=False))["state"] == "running"


async def test_concurrent_claims_never_hand_out_the_same_job(source):
    for i in range(12):
        await db.create_crawl_job(f"ci_{i}", source["source_id"])
    claimed = await asyncio.gather(*[db.claim_next_job() for _ in range(12)])
    ids = [j["job_id"] for j in claimed if j]
    assert len(ids) == 12 and len(set(ids)) == 12


async def test_counts_and_dashboard(source):
    await db.create_crawl_job("ci_1", source["source_id"])
    await db.create_crawl_job("ci_2", source["source_id"])
    await db.claim_next_job()
    counts = await db.count_jobs_by_state()
    assert counts == {"queued": 1, "running": 1, "done": 0, "failed": 0, "dead": 0}
    assert (await db.count_jobs_by_state(source_id="src_999"))["queued"] == 0
    dash = await db.dashboard_counts()
    assert set(dash) == {"users_by_role", "sources_by_status", "jobs_by_state"}


# ---- the report's own verification query -----------------------------------


async def test_report_sample_data_and_trace(pool):
    """Sections 7 of the schema report, using its hand-written ids."""
    async with db.get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO users (usr_id, username, email, password_hash, role)
                VALUES ('usr_001', 'nikhil', 'nikhil@example.com', 'hashed_pw_here', 'analyst');
            INSERT INTO source (source_id, name, source_type, onion_addr, auth_ref, created_by)
                VALUES ('src_001', 'Test Forum', 'forum', 'xyz123.onion', 'auth_rec_001', 'usr_001');
            INSERT INTO crawl_job (job_id, intent_id, source_id, kind)
                VALUES ('job_001', 'ci_001', 'src_001', 'scheduled');
            """
        )
    trace = await db.get_job_trace("job_001")
    assert trace["state"] == "queued"
    assert trace["source_name"] == "Test Forum" and trace["created_by_username"] == "nikhil"
    assert await db.get_job_trace("job_404") is None


# ---- transactions -----------------------------------------------------------


async def test_transaction_commits_together(pool):
    async with db.transaction() as conn:
        u = await db.create_user("t", "t@example.com", "h", conn=conn)
        s = await db.create_source("S", "paste", "auth", u["usr_id"], conn=conn)
        await db.create_crawl_job("ci_t", s["source_id"], conn=conn)
    assert await db.get_user_by_username("t") is not None
    assert len(await db.list_crawl_jobs()) == 1


async def test_transaction_rolls_back_on_error(pool):
    with pytest.raises(db.ReferenceViolationError):
        async with db.transaction() as conn:
            await db.create_user("rolled", "r@example.com", "h", conn=conn)
            await db.create_source("S", "paste", "auth", "usr_999", conn=conn)  # bad FK
    assert await db.get_user_by_username("rolled") is None
