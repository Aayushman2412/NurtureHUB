"""Alembic migration environment for NurtureHUB.

The database URL is sourced from the application settings (``app.config``) so
migrations always target the same database the app uses. Set ``ALEMBIC_DATABASE_URL``
to override — handy for generating the baseline against a throwaway empty DB.
"""
import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# The app package lives one level up from this file (backend/). ``prepend_sys_path = .``
# in alembic.ini puts backend/ on sys.path when alembic runs from that directory.
from app.config import settings
from app.database import Base

# Importing the models module registers every table on ``Base.metadata`` so that
# --autogenerate can see the full schema.
from app import models  # noqa: F401
from app import models_live  # noqa: F401 — registers live-monitoring tables on Base

# Alembic Config object — provides access to values in alembic.ini.
config = context.config

# Resolve the DB URL: explicit override wins, otherwise use the app's configured URL.
db_url = os.environ.get("ALEMBIC_DATABASE_URL") or settings.DATABASE_URL
config.set_main_option("sqlalchemy.url", db_url)

# Set up Python logging from the ini, if present. disable_existing_loggers=False
# so that running migrations in-process (app startup) doesn't silence app loggers.
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata

# SQLite can't ALTER most columns in place; batch mode rewrites the table instead.
# The app runs on Postgres, but this keeps migrations runnable against a sqlite DB too.
render_as_batch = db_url.startswith("sqlite")


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL, no DBAPI needed)."""
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        render_as_batch=render_as_batch,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode (against a live connection)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            render_as_batch=render_as_batch,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
