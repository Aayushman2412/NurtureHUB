from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from sqlalchemy import inspect, text

from app.config import settings
from app.database import Base, engine, SessionLocal
from app.seed import seed_database
from app.rate_limit import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.routers import auth, users, tutorials, tests, results, notifications, dashboard, metadata, admin


def ensure_schema():
    """
    Lightweight, idempotent column reconciliation for columns added to models
    after their table already exists (create_all only creates missing tables,
    not missing columns). Adopt Alembic for real migrations before production.
    """
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("users")}
    if "otp_attempts" not in existing:
        print("Schema: adding users.otp_attempts")
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 0. Refuse to boot on insecure config when APP_ENV=production
    settings.validate_production()

    # 1. Create database tables automatically
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)

    # 2. Reconcile columns added after tables already existed
    try:
        ensure_schema()
    except Exception as e:
        print(f"Error reconciling schema on startup: {e}")

    # 3. Seed database
    db = SessionLocal()
    try:
        seed_database(db)
    except Exception as e:
        print(f"Error seeding database on startup: {e}")
    finally:
        db.close()

    yield
    # Cleanup if needed on shutdown


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


@app.get("/")
def read_root():
    return {"message": "Welcome to NurtureHUB API! Go to /docs for Swagger documentation."}
