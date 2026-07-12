import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os

from alembic import command
from alembic.config import Config

from app.config import settings
from app.database import SessionLocal
from app.seed import seed_database
from app.rate_limit import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.routers import auth, users, tutorials, tests, results, notifications, dashboard, metadata, admin
from app.routers import ws_routes
import app.models_live  # noqa: F401 — registers live monitoring tables with Base
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 0. Refuse to boot on insecure config when APP_ENV=production
    settings.validate_production()

    # 1. Bring the schema up to date via Alembic (fail fast on error)
    print("Applying database migrations (alembic upgrade head)...")
    run_migrations()

    # 2. Seed database
    db = SessionLocal()
    try:
        seed_database(db)
    except Exception as e:
        print(f"Error seeding database on startup: {e}")
    finally:
        db.close()

    # 3. Start the live-monitoring stale-candidate sweeper
    sweeper_task = asyncio.create_task(_stale_candidate_sweeper())

    yield

    # Cleanup on shutdown
    sweeper_task.cancel()
    try:
        await sweeper_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="NurtureHUB API",
    description="Backend API for NurtureHUB training & assessment platform",
    version="1.0.0",
    lifespan=lifespan
)

# Rate limiting (slowapi)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Configure CORS from settings (comma-separated CORS_ORIGINS env var)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
app.include_router(ws_routes.router)


@app.get("/")
def read_root():
    return {"message": "Welcome to NurtureHUB API! Go to /docs for Swagger documentation."}
