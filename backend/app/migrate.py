"""`python -m app.migrate` — apply migrations and seed, then exit.

Run once per release, before the rollout: the Helm chart's pre-install /
pre-upgrade hook Job (deploy/helm/eduposhan/templates/migrate-job.yaml), which
Argo CD runs as PreSync. Point DATABASE_URL and ALEMBIC_DATABASE_URL at the
primary directly, not at PgBouncer: the advisory lock and the DDL want a real
session. Exits non-zero on failure, so the release stops before any pod rolls.
"""
from __future__ import annotations

import sys

from app import bootstrap
from app.config import settings
from app.security import audit as security_audit
from app.security.redaction import install_log_redaction


def main() -> int:
    settings.validate_production()
    install_log_redaction()
    # A database newer than this code means a later release migrated it and
    # this is a rollback. `alembic upgrade head` would fail on the revision it
    # cannot locate and block the rollback; expand-first migrations are why the
    # older code can simply run.
    if bootstrap.schema_state() == "ahead":
        print("The database is newer than this code; nothing to migrate.")
        return 0
    security_audit.start_writer()
    try:
        bootstrap.migrate_and_seed_guarded()
    finally:
        security_audit.stop_writer()
    state = bootstrap.schema_state()
    if state != "current":
        print(f"Migrations ran but the schema is still {state}.", file=sys.stderr)
        return 1
    print("The database is at this code's head.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
