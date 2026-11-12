"""One image, several roles: what Kubernetes needs from the backend.

deploy/scale/ARCHITECTURE_300K.md §4.2. The behaviour that would fail quietly
in a cluster and nowhere else:

  * the schema — pods only CHECK it when a Job migrates; newer code than the
    database refuses to start, older code starts (so a rollback works), and
    the migration Job treats a newer database as nothing to do;
  * the leased jobs run in the web process by default and only in the worker
    when switched off; the per-process stale sweeper always runs;
  * only the pipeline-owning pod may fail "interrupted" pipeline runs;
  * probes — liveness checks nothing; readiness reports its reasons;
  * the client address behind a CDN comes from the header the edge overwrites,
    never from the forgeable X-Forwarded-For hop;
  * a Redis outage must not turn rate-limited routes (sign-in) into 500s.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_cluster_roles.py -v
"""
from __future__ import annotations

import asyncio
import json
import time
from types import SimpleNamespace

import pytest
from alembic.script import ScriptDirectory
from fastapi import FastAPI
from sqlalchemy.exc import OperationalError
from starlette.requests import Request

from app import background, bootstrap, health, main, migrate, worker
from app.config import settings
from app.rate_limit import build_limiter, client_key
from app.security import audit as security_audit
from app.security.context import client_ip, forwarded_client


@pytest.fixture(scope="module")
def script():
    return ScriptDirectory.from_config(bootstrap.alembic_config())


# ── schema ───────────────────────────────────────────────────────────────────

def test_schema_at_head_is_current(script):
    assert bootstrap.classify_schema(script.get_heads(), script) == "current"


def test_known_older_revision_is_behind(script):
    heads = set(script.get_heads())
    older = next(r.revision for r in script.walk_revisions() if r.revision not in heads)
    assert bootstrap.classify_schema([older], script) == "behind"


def test_empty_database_is_behind(script):
    assert bootstrap.classify_schema([], script) == "behind"


def test_unknown_revision_means_a_newer_release_migrated(script):
    assert bootstrap.classify_schema(["ffffffffffff"], script) == "ahead"


def _record_migrations(monkeypatch, state):
    calls = []
    monkeypatch.setattr(bootstrap, "migrate_and_seed_guarded", lambda: calls.append("migrated"))
    monkeypatch.setattr(bootstrap, "schema_state", lambda: state)
    return calls


def test_compose_default_still_migrates_at_boot(monkeypatch):
    calls = _record_migrations(monkeypatch, "behind")
    monkeypatch.setattr(settings, "RUN_MIGRATIONS_ON_START", True)
    bootstrap.prepare_database()
    assert calls == ["migrated"]


def test_pod_refuses_to_serve_code_newer_than_the_schema(monkeypatch):
    calls = _record_migrations(monkeypatch, "behind")
    monkeypatch.setattr(settings, "RUN_MIGRATIONS_ON_START", False)
    with pytest.raises(RuntimeError, match="python -m app.migrate"):
        bootstrap.prepare_database()
    assert calls == []


@pytest.mark.parametrize("state", ["current", "ahead"])
def test_pod_serves_a_current_or_newer_schema_without_migrating(monkeypatch, state):
    calls = _record_migrations(monkeypatch, state)
    monkeypatch.setattr(settings, "RUN_MIGRATIONS_ON_START", False)
    bootstrap.prepare_database()
    assert calls == []


@pytest.fixture
def quiet_process(monkeypatch):
    """Neutralise the process-wide side effects a boot would have."""
    # A method, so it lives on the class: pydantic refuses non-field instance attributes.
    monkeypatch.setattr(type(settings), "validate_production", lambda self: None)
    for module in (main, migrate, worker):
        monkeypatch.setattr(module, "install_log_redaction", lambda: None)
    monkeypatch.setattr(security_audit, "start_writer", lambda: None)
    monkeypatch.setattr(security_audit, "stop_writer", lambda: None)


def test_migration_job_is_a_no_op_on_a_newer_database(monkeypatch, quiet_process):
    calls = _record_migrations(monkeypatch, "ahead")
    assert migrate.main() == 0
    assert calls == []


def test_migration_job_migrates_and_confirms_head(monkeypatch, quiet_process):
    states = iter(["behind", "current"])
    calls = []
    monkeypatch.setattr(bootstrap, "schema_state", lambda: next(states))
    monkeypatch.setattr(bootstrap, "migrate_and_seed_guarded", lambda: calls.append("migrated"))
    assert migrate.main() == 0
    assert calls == ["migrated"]


def test_migration_job_fails_when_head_is_not_reached(monkeypatch, quiet_process):
    _record_migrations(monkeypatch, "behind")
    assert migrate.main() == 1


# ── background jobs and pipeline ownership ───────────────────────────────────

def _boot(monkeypatch, *, background_tasks: bool):
    """Run the real lifespan with its outside world stubbed; report what ran."""
    seen = {"singletons": 0, "cleanup": 0, "tasks": []}
    monkeypatch.setattr(settings, "RUN_BACKGROUND_TASKS", background_tasks)
    monkeypatch.setattr(bootstrap, "prepare_database", lambda: None)
    monkeypatch.setattr(main, "clean_up_interrupted_runs", lambda: seen.__setitem__("cleanup", 1))

    async def no_op():
        return None

    monkeypatch.setattr(main.manager, "start", no_op)
    monkeypatch.setattr(main.manager, "stop", no_op)

    def counted_start():
        seen["singletons"] += 1
        return []  # not the real loops: they would sleep for minutes

    monkeypatch.setattr(background, "start_singleton_jobs", counted_start)

    async def run():
        async with main.lifespan(main.app):
            seen["tasks"] = sorted(t.get_name() for t in asyncio.all_tasks() if not t.done())

    asyncio.run(run())
    return seen


def test_web_process_runs_leased_jobs_by_default(monkeypatch, quiet_process):
    seen = _boot(monkeypatch, background_tasks=True)
    assert seen["singletons"] == 1
    assert "stale_candidate_sweeper" in seen["tasks"]
    assert seen["cleanup"] == 1


def test_cluster_web_pod_leaves_leased_jobs_to_the_worker(monkeypatch, quiet_process):
    seen = _boot(monkeypatch, background_tasks=False)
    assert seen["singletons"] == 0
    # It still sweeps its OWN sockets: nobody else can see their heartbeats.
    assert "stale_candidate_sweeper" in seen["tasks"]


def test_only_the_pipeline_owner_fails_interrupted_runs(monkeypatch):
    calls = []
    monkeypatch.setattr(main, "fail_stale_runs", lambda: calls.append(1) or 2)
    monkeypatch.setattr(settings, "OWNS_PIPELINE_RUNS", False)
    assert main.clean_up_interrupted_runs() == 0
    assert calls == []
    monkeypatch.setattr(settings, "OWNS_PIPELINE_RUNS", True)
    assert main.clean_up_interrupted_runs() == 2
    assert calls == [1]


def test_pipeline_cleanup_never_blocks_boot(monkeypatch):
    def broken():
        raise RuntimeError("db down")

    monkeypatch.setattr(main, "fail_stale_runs", broken)
    monkeypatch.setattr(settings, "OWNS_PIPELINE_RUNS", True)
    assert main.clean_up_interrupted_runs() == 0


def test_worker_runs_the_jobs_and_unwinds_on_stop(monkeypatch, quiet_process, tmp_path):
    events = []

    async def start():
        events.append("redis up")

    async def stop():
        events.append("redis down")

    monkeypatch.setattr(worker.manager, "start", start)
    monkeypatch.setattr(worker.manager, "stop", stop)
    # Same schema rule as the serving pods, checked before any job starts.
    monkeypatch.setattr(bootstrap, "prepare_database", lambda: events.append("schema checked"))
    heartbeat = tmp_path / "worker.heartbeat"
    monkeypatch.setattr(worker, "HEARTBEAT_FILE", str(heartbeat))

    async def run():
        jobs = []

        def fake_jobs():
            jobs.extend(asyncio.create_task(asyncio.sleep(3600)) for _ in range(3))
            return list(jobs)

        monkeypatch.setattr(background, "start_singleton_jobs", fake_jobs)
        stop_event = asyncio.Event()
        stop_event.set()
        await worker.run(stop_event)
        return jobs

    jobs = asyncio.run(run())
    assert events == ["schema checked", "redis up", "redis down"]
    assert len(jobs) == 3 and all(job.cancelled() for job in jobs)
    # The liveness probe has something to read from the first moment.
    assert heartbeat.read_text(encoding="ascii").isdigit()


def test_every_leased_job_is_started():
    names = {job.__name__ for job in background.SINGLETON_JOBS}
    assert names == {"security_sweeper", "attempt_finalizer", "care_sweeper"}


# ── probes ───────────────────────────────────────────────────────────────────

def test_liveness_checks_nothing():
    assert asyncio.run(main.healthz()) == {"status": "ok"}


def _probe(**overrides):
    values = dict(database_error=None, database_ms=1.0, redis_configured=True,
                  redis_ok=True, audit_queued=0, audit_capacity=health.AUDIT_QUEUE_CAPACITY)
    values.update(overrides)
    return health.Probe(**values)


def test_readiness_reports_its_reasons(monkeypatch):
    async def probe():
        return _probe()

    monkeypatch.setattr(health, "gather_probe", probe)
    monkeypatch.setattr(health, "readiness_problems", lambda p: [])
    assert asyncio.run(main.readyz()) == {"ready": True}

    monkeypatch.setattr(health, "readiness_problems", lambda p: ["database: timeout"])
    response = asyncio.run(main.readyz())
    assert response.status_code == 503
    assert json.loads(response.body) == {"ready": False, "problems": ["database: timeout"]}


def test_ready_when_database_answers_and_audit_is_draining():
    assert health.readiness_problems(_probe()) == []


def test_database_failure_takes_the_pod_out():
    assert health.readiness_problems(_probe(database_error="timeout")) == ["database: timeout"]
    assert health.readiness_problems(_probe(database_error="OperationalError")) == ["database: OperationalError"]


def test_redis_down_and_a_slow_database_keep_the_pod_in():
    assert health.readiness_problems(_probe(redis_ok=False)) == []
    assert health.readiness_problems(_probe(database_ms=2500.0)) == []


def test_audit_backlog_near_capacity_sheds_this_pod_only():
    near = int(health.AUDIT_QUEUE_CAPACITY * health.AUDIT_SHED_RATIO)
    assert health.readiness_problems(_probe(audit_queued=near - 1)) == []
    assert health.readiness_problems(_probe(audit_queued=near)) == ["audit: writer backlog near capacity"]


def test_probe_capacity_matches_the_audit_queue():
    assert health.AUDIT_QUEUE_CAPACITY == security_audit._queue.maxsize


def _gather(monkeypatch, ping, redis=None):
    async def redis_ping():
        return redis

    monkeypatch.setattr(health, "_ping_database", ping)
    monkeypatch.setattr(health, "_inflight", None)
    monkeypatch.setattr(health.manager, "redis_ping", redis_ping)
    return asyncio.run(health.gather_probe())


def test_probe_names_the_database_error_class_only(monkeypatch):
    def refused():
        raise OperationalError("SELECT 1", {}, Exception("could not connect to db.internal:5432"))

    probe = _gather(monkeypatch, refused, redis=False)
    assert probe.database_error == "OperationalError"  # no hostname leaks out
    assert probe.database_ms is None
    assert probe.redis_configured and not probe.redis_ok


def test_probe_answers_when_the_database_hangs(monkeypatch):
    monkeypatch.setattr(health, "DB_PING_TIMEOUT_SECONDS", 0.05)
    probe = _gather(monkeypatch, lambda: time.sleep(0.5) or 1.0)
    assert probe.database_error == "timeout"
    assert not probe.redis_configured


def test_a_hung_check_is_waited_on_not_joined_by_another_thread(monkeypatch):
    calls = []

    def hung():
        calls.append(1)
        time.sleep(0.4)
        return 1.0

    async def redis_ping():
        return None

    monkeypatch.setattr(health, "DB_PING_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(health, "_ping_database", hung)
    monkeypatch.setattr(health, "_inflight", None)
    monkeypatch.setattr(health.manager, "redis_ping", redis_ping)

    async def three_probes():
        return [await health.gather_probe() for _ in range(3)]

    probes = asyncio.run(three_probes())
    assert [p.database_error for p in probes] == ["timeout"] * 3
    assert calls == [1]  # one thread stuck, however many probes ask


def test_probe_never_borrows_from_the_request_pool(monkeypatch):
    from sqlalchemy.pool import NullPool

    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://probe@127.0.0.1:1/eduposhan")
    monkeypatch.setattr(health, "_probe_engine", None)
    assert isinstance(health._engine().pool, NullPool)  # pool exhaustion is not "database down"


# ── the client address behind a CDN ──────────────────────────────────────────

def _request(headers, peer="10.0.0.9"):
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=peer))


def test_edge_header_wins_over_a_planted_forwarded_for(monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "CF-Connecting-IP")
    request = _request({"cf-connecting-ip": "49.36.1.2", "x-forwarded-for": "1.1.1.1, 49.36.1.2"})
    assert client_ip(request) == "49.36.1.2"
    assert client_key(request) == "49.36.1.2"


def test_without_the_edge_header_forwarded_for_is_not_trusted(monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "cf-connecting-ip")
    request = _request({"x-forwarded-for": "1.1.1.1"})
    assert forwarded_client(request.headers) is None
    assert client_ip(request) == "10.0.0.9"


def test_forwarded_for_behaviour_is_unchanged_by_default(monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "")
    request = _request({"x-forwarded-for": "49.36.1.2, 10.0.0.1"})
    assert client_ip(request) == "49.36.1.2"
    assert client_key(request) == "49.36.1.2"


@pytest.mark.parametrize("header,forged", [
    ("cf-connecting-ip", "admin'); --"),
    ("cf-connecting-ip", "x" * 64),
    ("", "not-an-address, 10.0.0.1"),
])
def test_a_reported_address_must_be_an_address(monkeypatch, header, forged):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", header)
    request = _request({"cf-connecting-ip": forged, "x-forwarded-for": forged})
    # Free text never reaches the audit trail or mints a rate-limit bucket.
    assert client_ip(request) == "10.0.0.9"
    assert client_key(request) == "10.0.0.9"


def test_ipv6_addresses_are_accepted(monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "cf-connecting-ip")
    assert client_ip(_request({"cf-connecting-ip": "2401:4900:1c0e::1"})) == "2401:4900:1c0e::1"


def test_headers_are_ignored_without_a_trusted_proxy(monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", False)
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "cf-connecting-ip")
    assert client_ip(_request({"cf-connecting-ip": "49.36.1.2"})) == "10.0.0.9"


# ── rate limits when Redis is gone ───────────────────────────────────────────

def test_rate_limited_route_survives_unreachable_limit_storage():
    limiter = build_limiter("redis://127.0.0.1:1/0")  # nothing listens on port 1
    app = FastAPI()
    app.state.limiter = limiter

    @limiter.limit("5/minute")
    async def sign_in(request: Request):
        return {"ok": True}

    def call():
        scope = {"type": "http", "method": "POST", "path": "/sign-in", "headers": [],
                 "query_string": b"", "client": ("49.36.1.2", 5000), "app": app}
        return asyncio.run(sign_in(Request(scope)))

    assert call() == {"ok": True}  # fell back to counting in this process
    for _ in range(4):
        call()
    with pytest.raises(Exception, match="5 per 1 minute"):
        call()  # and the fallback still enforces the ceiling
