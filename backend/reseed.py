"""
Dev helper: drop every table and rebuild + reseed from scratch.

    cd backend && python reseed.py

Destructive — wipes all data in the configured DATABASE_URL. Meant for local
development after schema/content changes (e.g. adopting the 4-phase flow).
"""

from app.database import Base, engine, SessionLocal
import app.models  # noqa: F401 — register core tables with Base
import app.models_live  # noqa: F401 — register live-monitoring tables with Base
from app.seed import seed_database


def main():
    print(f"Dropping and recreating all tables on {engine.url} ...")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()
    print("Reseed complete.")


if __name__ == "__main__":
    main()
