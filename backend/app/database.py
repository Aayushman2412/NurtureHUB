from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, sessionmaker
from app.config import settings

# Create engine
if settings.DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args={"check_same_thread": False}
    )

    # SQLite ignores foreign keys (and thus ON DELETE CASCADE) unless this pragma
    # is set per connection. Without it, deleting a tutorial/test/stage would
    # orphan child rows (quiz responses, live sessions) that our models rely on
    # cascading. Enable it so the declared cascades actually fire on SQLite too.
    @event.listens_for(Engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()
else:
    engine = create_engine(
        settings.DATABASE_URL,
        # Pool sizing is env-tunable so a single-instance deploy can raise its
        # ceiling and a multi-worker deploy can keep pool_size * workers under
        # Postgres max_connections. Defaults (20 + 40 = 60/process) replace the
        # old hard-coded 30, which was the empirically-observed capacity wall.
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_timeout=settings.DB_POOL_TIMEOUT,
        pool_recycle=1800,
        # Validate a pooled connection before handing it out so a DB blip or an
        # idle-timed-out connection surfaces as a transparent reconnect instead
        # of a burst of errors mid-run.
        pool_pre_ping=True,
    )

# Create session maker
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Declarative Base
Base = declarative_base()

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope():
    """Short-lived transactional session for non-request-scoped callers.

    Commits on success, rolls back on error, and always closes — which returns
    the pooled connection immediately. WebSocket handlers use this per event so
    a socket sitting idle between heartbeats holds ZERO pool connections,
    instead of pinning one for the socket's whole lifetime.
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
