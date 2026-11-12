"""Bringing the database to this code's schema — once per release.

Two ways to run it (deploy/scale/ARCHITECTURE_300K.md §4.2):

* **docker-compose** (RUN_MIGRATIONS_ON_START, the default): every backend
  worker runs migrate + seed at boot, serialized by a Postgres advisory lock.
* **Kubernetes**: a Job runs `python -m app.migrate` before the rollout and the
  serving pods only *check* the schema, so a pod start never waits on, or
  races, a migration — and a schema change never lands half-way through one.
"""
from __future__ import annotations

import os
from typing import Iterable, Literal

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.util import CommandError
from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal, engine
from app.seed import seed_database
from app.security import retention as security_retention
from app.security import ropa

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Arbitrary constant identifying the migrate+seed critical section for
# pg_advisory_lock. Any integer works; it just has to be the same across workers.
_INIT_LOCK_KEY = 0x4E555254  # "NURT"

SchemaState = Literal["current", "behind", "ahead"]


def alembic_config() -> Config:
    """Alembic's config with paths resolved from this file, not the CWD."""
    cfg = Config(os.path.join(_BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(_BACKEND_DIR, "alembic"))
    return cfg


def run_migrations() -> None:
    """Bring the database schema up to date by applying all Alembic migrations.

    Alembic is the single source of truth for the schema (see backend/alembic/).
    Runs synchronously and fails fast — the app must not serve requests against
    a broken or half-migrated schema.
    """
    command.upgrade(alembic_config(), "head")


def _run_migrate_and_seed() -> None:
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


def migrate_and_seed_guarded() -> None:
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


def classify_schema(db_heads: Iterable[str], script: ScriptDirectory) -> SchemaState:
    """Where the database stands against this code's migrations.

    * ``current`` — the database is at this code's head(s).
    * ``behind``  — every revision it holds is one this code knows, so the
      code's newer migrations have not been applied (an empty database too).
    * ``ahead``   — it holds a revision this code has never heard of: a newer
      release migrated it, and this pod is older code (a rollback, or an old
      pod still draining during a rollout).
    """
    db = set(db_heads)
    if db == set(script.get_heads()):
        return "current"
    for revision in db:
        try:
            script.get_revision(revision)
        except CommandError:
            return "ahead"
    return "behind"


def schema_state() -> SchemaState:
    """`classify_schema` for the configured database."""
    script = ScriptDirectory.from_config(alembic_config())
    with engine.connect() as conn:
        heads = MigrationContext.configure(conn).get_current_heads()
    return classify_schema(heads, script)


def prepare_database() -> None:
    """What a serving process does with the schema at boot.

    With RUN_MIGRATIONS_ON_START it migrates and seeds. Without it, it only
    checks: code newer than the database refuses to start (its queries would
    meet columns that do not exist yet), while code older than the database
    starts with a warning — migrations are expand-first, which is exactly what
    keeps a rollback, and the old pods of a rolling update, working.
    """
    if settings.RUN_MIGRATIONS_ON_START:
        migrate_and_seed_guarded()
        return
    state = schema_state()
    if state == "behind":
        raise RuntimeError(
            "The database schema is older than this code. Run the migration job "
            "(`python -m app.migrate`) first; refusing to serve against an "
            "unmigrated schema."
        )
    if state == "ahead":
        print(
            "WARNING: the database schema is newer than this code (a later release "
            "migrated it). Serving anyway: migrations are expand-first."
        )
