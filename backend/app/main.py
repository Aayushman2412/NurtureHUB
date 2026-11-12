import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os

from sqlalchemy.exc import TimeoutError as SQLTimeoutError

from app import background, bootstrap, health
from app.config import settings
from app.database import SessionLocal
from app.rate_limit import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.routers import auth, users, tutorials, tests, results, notifications, dashboard, metadata, admin
from app.routers import ws_routes, mothers, admin_forms, forms, growth, admin_pipelines, push, admin_rawdata
from app.routers import admin_security, masd, visits, growth_status
from app.pipeline_service import PipelineError, fail_stale_runs
from app.notify import wire_session_events
import app.models_live  # noqa: F401 — registers live monitoring tables with Base
import app.models_security  # noqa: F401 — registers the data-protection tables with Base
from app.security import audit
from app.security import audit as security_audit
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


def clean_up_interrupted_runs() -> int:
    """Fail pipeline runs whose worker thread died with the previous process.

    Only the process that runs pipelines may do this (OWNS_PIPELINE_RUNS). The
    sweep fails every running run that was started on another host, which in a
    cluster means every other pod: an api pod scaling up mid-afternoon would
    otherwise kill the admin pod's crosstabs run half-way through.
    """
    if not settings.OWNS_PIPELINE_RUNS:
        return 0
    try:
        stale_runs = fail_stale_runs()
    except Exception as exc:  # never block boot on housekeeping
        print(f"WARNING: could not clean up stale pipeline runs: {exc}")
        return 0
    if stale_runs:
        print(f"Marked {stale_runs} interrupted pipeline run(s) as failed.")
    return stale_runs


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

    # 1-2. The schema. Migrate + seed, serialized across workers by an advisory
    # lock — or, in Kubernetes where a Job migrates before the rollout, only
    # check it (RUN_MIGRATIONS_ON_START; see app/bootstrap.py).
    bootstrap.prepare_database()

    # 2b. Pipeline runs that were queued/running when the previous process
    # died can never finish (their worker thread is gone) — fail them so the
    # admin UI doesn't show a phantom in-progress run forever.
    clean_up_interrupted_runs()

    # 3. Live monitoring: connect to Redis when configured (required with more
    # than one worker) and start the admin batch flusher.
    await manager.start()

    # 3b. The live-monitoring stale-candidate sweeper watches the sockets THIS
    # process holds, so it runs in every process.
    tasks = [asyncio.create_task(_stale_candidate_sweeper(), name="stale_candidate_sweeper")]

    # 4-6. The leased jobs — security sweeper (anchoring + detection), attempt
    # finalizer, care reminders — here, or in the dedicated worker
    # (`python -m app.worker`) when RUN_BACKGROUND_TASKS is off.
    if settings.RUN_BACKGROUND_TASKS:
        tasks += background.start_singleton_jobs()

    yield

    # Cleanup on shutdown
    await background.stop_tasks(tasks)
    await manager.stop()

    # Flush queued audit events before the process exits. Anything still in
    # flight goes to the spool and is re-ingested on next boot, so a restart
    # never costs evidence.
    security_audit.stop_writer()


# The interactive docs enumerate every endpoint and its schema to anyone who can
# reach them. Useful in development, an unnecessary map of the attack surface in
# production — so they are switchable and default off there.
_docs_enabled = settings.ENABLE_API_DOCS and not settings.is_production

app = FastAPI(
    title="EduPoshan API",
    description="Backend API for EduPoshan training & assessment platform",
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
    # Content-Disposition carries the server-chosen download filename. Without
    # it exposed, a cross-origin SPA cannot read the name and has to invent one,
    # so an export arrives called something other than what the server named it.
    expose_headers=["X-Request-Id", "X-MFA-Required", "Content-Disposition"],
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
app.include_router(growth_status.router)  # learner: /api/growth/my-babies, measurement checks
app.include_router(masd.router)          # admin MASD dashboard: /api/admin/masd/*
app.include_router(admin_pipelines.router)  # guarded: /api/admin/pipelines/* (Database section)
app.include_router(admin_rawdata.router)    # guarded: /api/admin/rawdata/* (Database → Raw Data)
app.include_router(push.router)             # learner: /api/push/* (web-push subscriptions)
app.include_router(visits.router)           # learner: /api/visits/* (November 2026 visit protocol)
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
    return {"message": "Welcome to EduPoshan API! Go to /docs for Swagger documentation."}


@app.get("/healthz", include_in_schema=False)
async def healthz():
    """Liveness: the process is up and its event loop answers.

    `async` so it runs on the loop rather than in the threadpool — a pod whose
    threads are all waiting on a slow database is busy, not dead, and must not
    be restarted for it. See app/health.py for why nothing else is checked.
    """
    return {"status": "ok"}


@app.get("/readyz", include_in_schema=False)
async def readyz():
    """Readiness: whether this pod should receive traffic right now."""
    problems = health.readiness_problems(await health.gather_probe())
    if problems:
        return JSONResponse(status_code=503, content={"ready": False, "problems": problems})
    return {"ready": True}
