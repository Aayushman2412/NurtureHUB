import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os

from alembic import command
from alembic.config import Config

from sqlalchemy import text
from sqlalchemy.exc import TimeoutError as SQLTimeoutError

from app.config import settings
from app.database import SessionLocal, engine
from app.seed import seed_database
from app.rate_limit import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.routers import auth, users, tutorials, tests, results, notifications, dashboard, metadata, admin
from app.routers import ws_routes, mothers, admin_forms, forms, growth, admin_pipelines, push, admin_rawdata
from app.routers import admin_security
from app.pipeline_service import PipelineError, fail_stale_runs
from app.notify import wire_session_events
import app.models_live  # noqa: F401 — registers live monitoring tables with Base
import app.models_security  # noqa: F401 — registers the data-protection tables with Base
from app.security import audit
from app.security import audit as security_audit
from app.security import anomaly, ropa
from app.security import retention as security_retention
from app.security.middleware import (
    RequestContextMiddleware, SecurityHeadersMiddleware, allowed_hosts,
)
from app.security.redaction import install_log_redaction
from app.models_live import LiveSession
from app.ws_manager import manager
from app.event_processor import build_candidate_state_from_session

# How often the sweeper runs, and how long a candidate can be silent before we
# downgrade its live status. Heartbeats arrive every 30s, so 90s = 3 missed beats.
STALE_SWEEP_INTERVAL_SECONDS = 15
STALE_TIMEOUT_SECONDS = 90


async def _stale_candidate_sweeper():
    """
    Background task: periodically downgrade the status of LiveSessions whose
    candidate has stopped sending heartbeats. Sessions still socket-connected but
    silent become `idle`; sessions whose socket is gone become `disconnected`.
    Any subsequent event flips them back to `active` (see event_processor).
    """
    while True:
        try:
            await asyncio.sleep(STALE_SWEEP_INTERVAL_SECONDS)
            stale_attempt_ids = manager.get_stale_candidates(timeout_seconds=STALE_TIMEOUT_SECONDS)
            if not stale_attempt_ids:
                continue

            db = SessionLocal()
            try:
                for attempt_id in stale_attempt_ids:
                    session = db.query(LiveSession).filter(
                        LiveSession.attempt_id == attempt_id
                    ).first()
                    if not session or session.status in ("submitted", "auto_submitted"):
                        continue

                    new_status = "idle" if manager.is_candidate_connected(attempt_id) else "disconnected"
                    if session.status != new_status:
                        session.status = new_status
                        db.commit()
                        await manager.broadcast_to_admins(session.test_id, {
                            "type": "CANDIDATE_UPDATE",
                            "data": build_candidate_state_from_session(session),
                        })
            finally:
                db.close()
        except asyncio.CancelledError:
            break
        except Exception as e:  # never let the sweeper kill the loop
            print(f"[stale_sweeper] error: {e}")


async def _security_sweeper():
    """Notarise the audit chains and run the detection rules on a timer.

    Two jobs on one loop, at different cadences:

    * **Anchoring.** A hash chain proves nothing was altered but cannot prove
      nothing was removed from its end. Periodically recording where each chain
      stood closes that gap (see security/audit.py:write_anchors).
    * **Detection.** The rules in security/anomaly.py look for the shapes misuse
      of a health record system takes. They run here rather than inline on the
      request path so a heavy query never slows down a field worker's device.

    Both statutory clocks that apply here start at *awareness*, which is what
    this loop is for. Set SECURITY_SWEEP_INTERVAL_SECONDS=0 to disable it.
    """
    interval = settings.SECURITY_SWEEP_INTERVAL_SECONDS
    if interval <= 0:
        print("[security] sweeper disabled (SECURITY_SWEEP_INTERVAL_SECONDS=0)")
        return
    last_anchor = 0.0
    while True:
        try:
            await asyncio.sleep(interval)
            db = SessionLocal()
            try:
                anomaly.run_detections(db)
                now = asyncio.get_event_loop().time()
                if now - last_anchor >= settings.AUDIT_ANCHOR_INTERVAL_SECONDS:
                    security_audit.write_anchors(db)
                    last_anchor = now
            finally:
                db.close()
        except asyncio.CancelledError:
            break
        except Exception as exc:  # never let the sweeper kill the loop
            print(f"[security_sweeper] error: {exc}")


def run_migrations() -> None:
    """Bring the database schema up to date by applying all Alembic migrations.

    Alembic is the single source of truth for the schema (see backend/alembic/).
    Paths resolve relative to this file so it works regardless of the CWD the app
    is launched from. Runs synchronously at startup and fails fast — the app must
    not serve requests against a broken or half-migrated schema.
    """
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    alembic_cfg = Config(os.path.join(backend_dir, "alembic.ini"))
    alembic_cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    command.upgrade(alembic_cfg, "head")


# Arbitrary constant identifying the migrate+seed critical section for
# pg_advisory_lock. Any integer works; it just has to be the same across workers.
_INIT_LOCK_KEY = 0x4E555254  # "NURT"


def _run_migrate_and_seed():
    """Apply migrations then seed. Safe to call once the init lock is held."""
    print("Applying database migrations (alembic upgrade head)...")
    run_migrations()
    db = SessionLocal()
    try:
        seed_database(db)
    except Exception as e:
        print(f"Error seeding database on startup: {e}")
    # The data-protection reference data is seeded separately and never blocks
    # boot: a platform that cannot start because its retention schedule failed
    # to seed is a worse outcome than one that starts and reports the gap.
    try:
        created_policies = security_retention.ensure_policies(db)
        created_activities = ropa.seed(db)
        bootstrapped = _bootstrap_admin(db)
        if created_policies or created_activities:
            print(
                f"Seeded {created_policies} retention policy(ies) and "
                f"{created_activities} processing activity record(s)."
            )
        if bootstrapped:
            print(bootstrapped)
    except Exception as e:
        db.rollback()
        print(f"WARNING: could not seed data-protection reference data: {e}")
    finally:
        db.close()


def _bootstrap_admin(db) -> str:
    """Create the first administrator from ADMIN_BOOTSTRAP_PASSWORD, if asked.

    This replaces the credentials that used to be literals in admin.py. It runs
    only when the setting is present AND no administrator row exists, so it
    cannot silently reset a real account, and production refuses to boot while
    the setting is still configured.
    """
    from app.auth import get_password_hash
    from app.models import User
    from app.security import passwords

    if not settings.ADMIN_BOOTSTRAP_PASSWORD:
        return ""
    if db.query(User).filter(User.is_admin.is_(True)).first():
        return (
            "ADMIN_BOOTSTRAP_PASSWORD is set but an administrator already exists — "
            "no account created. Unset the variable."
        )
    email = settings.ADMIN_BOOTSTRAP_EMAIL.strip().lower()
    try:
        passwords.validate(settings.ADMIN_BOOTSTRAP_PASSWORD, is_admin=True, email=email)
    except passwords.PasswordPolicyError as exc:
        return f"ADMIN_BOOTSTRAP_PASSWORD rejected: {exc}"
    admin = User(
        email=email,
        password_hash=get_password_hash(settings.ADMIN_BOOTSTRAP_PASSWORD),
        full_name="Administrator",
        is_admin=True,
        is_verified=True,
        avatar_initials="AD",
    )
    db.add(admin)
    db.commit()
    return (
        f"Created the first administrator ({email}). "
        "Unset ADMIN_BOOTSTRAP_PASSWORD now — production will not boot while it is set."
    )


def migrate_and_seed_guarded():
    """Run migrate+seed under a Postgres advisory lock so multiple workers /
    replicas booting together serialize instead of racing Alembic's version
    table and the seed's read-then-insert count guards. On SQLite (dev) there
    are no advisory locks and no multi-worker boot, so just run directly.
    """
    if settings.DATABASE_URL.startswith("sqlite"):
        _run_migrate_and_seed()
        return
    # A dedicated connection holds the session-level lock across the whole
    # critical section; other workers block here until it is released.
    with engine.connect() as conn:
        conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": _INIT_LOCK_KEY})
        try:
            _run_migrate_and_seed()
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _INIT_LOCK_KEY})


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 0. Refuse to boot on insecure config when APP_ENV=production
    settings.validate_production()

    # 0a. Mask identifier-shaped text on its way into container logs. Installed
    # before anything else logs, because the point is that nothing gets to leak
    # a phone number into `docker logs` in the first place.
    install_log_redaction()

    # 0b. Start the audit writer. Patient-record access is recorded through a
    # bounded queue drained by this thread; without it every audit call would
    # spill straight to the on-disk spool.
    security_audit.start_writer()

    if not settings.is_production:
        posture = [c for c in settings.security_posture() if not c["ok"]]
        if posture:
            print("[security] controls not active in this environment:")
            for check in posture:
                print(f"  - {check['label']}: {check['detail']}")

    # 1-2. Migrate + seed, serialized across workers via an advisory lock.
    migrate_and_seed_guarded()

    # 2b. Pipeline runs that were queued/running when the previous process
    # died can never finish (their worker thread is gone) — fail them so the
    # admin UI doesn't show a phantom in-progress run forever.
    try:
        stale_runs = fail_stale_runs()
        if stale_runs:
            print(f"Marked {stale_runs} interrupted pipeline run(s) as failed.")
    except Exception as exc:  # never block boot on housekeeping
        print(f"WARNING: could not clean up stale pipeline runs: {exc}")

    # 3. Start the live-monitoring stale-candidate sweeper
    sweeper_task = asyncio.create_task(_stale_candidate_sweeper())

    # 4. Start the security sweeper (audit anchoring + detection rules)
    security_task = asyncio.create_task(_security_sweeper())

    yield

    # Cleanup on shutdown
    for task in (sweeper_task, security_task):
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    # Flush queued audit events before the process exits. Anything still in
    # flight goes to the spool and is re-ingested on next boot, so a restart
    # never costs evidence.
    security_audit.stop_writer()


# The interactive docs enumerate every endpoint and its schema to anyone who can
# reach them. Useful in development, an unnecessary map of the attack surface in
# production — so they are switchable and default off there.
_docs_enabled = settings.ENABLE_API_DOCS and not settings.is_production

app = FastAPI(
    title="NurtureHUB API",
    description="Backend API for NurtureHUB training & assessment platform",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

# Rate limiting (slowapi)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Middleware ───────────────────────────────────────────────────────────────
# Starlette runs middleware in reverse registration order, so the LAST one added
# is the outermost. The order that matters:
#
#   TrustedHost      (outermost) reject a forged Host before anything reads it
#   SecurityHeaders  wrap every response, including error responses raised inside
#   CORS
#   RequestContext   (innermost) publish request identity for the audit layer
#
# RequestContext must be inside SecurityHeaders so the header middleware can read
# the request id it generated.
app.add_middleware(RequestContextMiddleware)

# Configure CORS from settings (comma-separated CORS_ORIGINS env var)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    # Named explicitly rather than "*": with allow_credentials a wildcard is
    # ignored by browsers anyway, and listing them documents what the SPA sends.
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "X-Request-Id"],
    expose_headers=["X-Request-Id", "X-MFA-Required"],
    max_age=600,
)

app.add_middleware(SecurityHeadersMiddleware)

# Host-header pinning. OTP and reset mails are built from the request host, so a
# forged Host can point a verification link at an attacker's server.
_allowed = list(allowed_hosts())
if _allowed != ["*"]:
    from starlette.middleware.trustedhost import TrustedHostMiddleware

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_allowed)

# Include Routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(tutorials.router)
app.include_router(tests.router)
app.include_router(results.router)
app.include_router(notifications.router)
app.include_router(dashboard.router)
app.include_router(metadata.router)
app.include_router(admin.auth_router)  # public: /api/admin/login
app.include_router(admin.router)       # guarded: all other /api/admin/*
app.include_router(admin_forms.router) # guarded: /api/admin/forms* (form builder)
app.include_router(ws_routes.router)
app.include_router(mothers.router)
app.include_router(forms.router)       # learner: /api/forms/* (BF/CF assessments)
app.include_router(growth.router)       # growth charts: /api/growth/* (LAP monitoring)
app.include_router(growth.admin_router) # admin growth monitor: /api/admin/growth/*
app.include_router(admin_pipelines.router)  # guarded: /api/admin/pipelines/* (Database section)
app.include_router(admin_rawdata.router)    # guarded: /api/admin/rawdata/* (Database → Raw Data)
app.include_router(push.router)             # learner: /api/push/* (web-push subscriptions)
app.include_router(admin_security.router)   # guarded: /api/admin/security/* (data protection)
app.include_router(admin_security.public_router)  # public: privacy notice + grievance intake

# After-commit web-push dispatch for every notification created via
# app.notify.create_notification (see that module for the batching rules).
wire_session_events(SessionLocal)


@app.exception_handler(SQLTimeoutError)
async def _db_pool_exhausted_handler(request, exc: SQLTimeoutError):
    """Answer 503 + Retry-After when every database connection is busy.

    This is what a burst larger than the box can absorb looks like — a few
    hundred health workers hitting sign-in in the same instant when a test goes
    live. Left alone SQLAlchemy raises after DB_POOL_TIMEOUT and the caller sees
    an opaque 500, which tells a client nothing and invites an immediate retry
    that makes it worse. A 503 with Retry-After says "we are full, come back
    shortly", which is both true and actionable.
    """
    from fastapi.responses import JSONResponse

    audit.record(
        "http.overloaded",
        resource_type="endpoint",
        resource_id=request.url.path[:64],
        outcome="error",
        status_code=503,
        is_phi=False,
        record_count=0,
        detail={"reason": "db_pool_exhausted"},
    )
    return JSONResponse(
        status_code=503,
        content={"detail": "The service is busy right now. Please try again in a few seconds."},
        headers={"Retry-After": "5"},
    )


@app.exception_handler(PipelineError)
async def _pipeline_error_handler(request, exc: PipelineError):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})

# Uploaded form-builder assets (option images/GIFs, action videos) are served
# statically; files live outside the repo's tracked tree in backend/uploads/.
_uploads_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")
os.makedirs(_uploads_dir, exist_ok=True)
if settings.SERVE_LOCAL_UPLOADS:
    # This mount is unauthenticated: anyone holding a URL reads the file. That is
    # acceptable for form-builder assets, and NOT for the growth measurement
    # photographs that also land here when R2 is unconfigured. In production,
    # media belongs on R2 (app/storage.py) and this should be off — the security
    # dashboard reports it as a finding while it is on.
    app.mount("/uploads", StaticFiles(directory=_uploads_dir), name="uploads")


@app.get("/")
def read_root():
    return {"message": "Welcome to NurtureHUB API! Go to /docs for Swagger documentation."}
