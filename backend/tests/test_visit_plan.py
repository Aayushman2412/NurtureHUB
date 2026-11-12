"""The November 2026 visit protocol in the database and the worker app:
which projects run it, Today and the baby's plan from app/visit_plan.py,
counselling and drop-out, and the legacy protocol left exactly as it was.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_visit_plan.py -v
"""
from __future__ import annotations

import base64
import importlib.util
import os
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

os.environ.setdefault("APP_ENV", "development")
_TEST_KEY = base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode().rstrip("=")
os.environ.setdefault("PHI_ENCRYPTION_KEYS", f"v1:{_TEST_KEY}")
os.environ.setdefault("PHI_ENCRYPTION_ACTIVE_KEY", "v1")
os.environ.setdefault("PHI_INDEX_KEY", "test-index-key-not-for-production")
os.environ.setdefault("AUDIT_HMAC_KEY", "test-audit-key-not-for-production-0123456789")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models, projects  # noqa: E402
from app import visit_protocol as VP  # noqa: E402
from app.database import Base  # noqa: E402
import app.models_live  # noqa: F401,E402
import app.models_security  # noqa: F401,E402

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


@pytest.fixture()
def db():
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    yield session
    session.close()
    engine.dispose()
    os.unlink(path)


# ── Which projects run the new protocol ────────────────────────────────────

def _migration(name: str):
    path = next(VERSIONS.glob(f"{name}_*.py"))
    spec = importlib.util.spec_from_file_location(f"migration_{name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_chandrapur_moves_to_the_new_protocol_and_no_other_project(db):
    db.add_all([
        models.ProgramDistrict(name="Jalna", slug="jalna"),
        models.ProgramDistrict(name="Chandrapur", slug="chandrapur"),
        models.ProgramDistrict(name="Ujjain", slug="ujjain"),
    ])
    db.commit()
    m = _migration("e3a9c4b7d218")
    with db.bind.begin() as conn:
        assert m.set_protocol(conn, *m.NEW) == 1
    db.expire_all()
    rows = {p.slug: (p.visit_protocol, p.pnc_split_days) for p in db.query(models.ProgramDistrict)}
    assert rows == {"chandrapur": ("lap_2026_11", 180), "jalna": ("lap_2025", 150), "ujjain": ("lap_2025", 150)}
    with db.bind.begin() as conn:                                    # the downgrade
        assert m.set_protocol(conn, *m.LEGACY) == 1
    db.expire_all()
    assert db.query(models.ProgramDistrict).filter_by(slug="chandrapur").one().visit_protocol == "lap_2025"


def test_chandrapur_is_found_by_name_and_absent_is_a_no_op(db):
    m = _migration("e3a9c4b7d218")
    with db.bind.begin() as conn:
        assert m.set_protocol(conn, *m.NEW) == 0                    # no such project yet
    db.add(models.ProgramDistrict(name="CHANDRAPUR", slug="chandrapur-district"))
    db.commit()
    with db.bind.begin() as conn:
        assert m.set_protocol(conn, *m.NEW) == 1
    db.expire_all()
    assert db.query(models.ProgramDistrict).one().pnc_split_days == 180


def test_existing_rows_default_to_the_legacy_protocol(db):
    db.add(models.ProgramDistrict(name="Old", slug="old"))
    db.commit()
    p = db.query(models.ProgramDistrict).one()
    assert (p.visit_protocol, p.pnc_split_days) == (VP.LAP_2025, VP.LEGACY_SPLIT_DAYS)


def test_new_projects_default_to_the_new_protocol():
    from app.routers.admin import _new_project_visit_settings

    assert _new_project_visit_settings(None, None, None) == {"visit_protocol": VP.LAP_2026_11, "pnc_split_days": 180}
    state = models.ProgramDistrict(name="State", slug="state", visit_protocol=VP.LAP_2025, pnc_split_days=150)
    assert _new_project_visit_settings(state, None, None) == {"visit_protocol": VP.LAP_2025, "pnc_split_days": 150}
    assert _new_project_visit_settings(None, VP.LAP_2025, 150) == {"visit_protocol": VP.LAP_2025, "pnc_split_days": 150}


def test_an_unknown_protocol_is_refused():
    from fastapi import HTTPException
    from app.routers.admin import _new_project_visit_settings

    with pytest.raises(HTTPException):
        _new_project_visit_settings(None, "lap_1999", None)


def test_a_district_following_its_state_follows_the_states_protocol(db):
    state = models.ProgramDistrict(name="Meghalaya", slug="meghalaya", level="state",
                                   visit_protocol=VP.LAP_2026_11, pnc_split_days=180)
    db.add(state)
    db.flush()
    follows = models.ProgramDistrict(name="Khasi", slug="khasi", parent_id=state.id, inherits_content=True)
    own = models.ProgramDistrict(name="Garo", slug="garo", parent_id=state.id, inherits_content=False)
    db.add_all([follows, own])
    db.commit()
    assert projects.visit_settings(follows) == (VP.LAP_2026_11, 180)
    assert projects.visit_settings(own) == (VP.LAP_2025, 150)
    assert projects.visit_settings_payload(follows)["inherited_from"] == "Meghalaya"
    assert projects.visit_settings(None)[0] == VP.LAP_2025
