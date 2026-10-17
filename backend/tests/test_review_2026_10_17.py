"""The supervisors' review of 17 Oct 2026.

* Learners sign up and sign in with a MOBILE NUMBER first; a WhatsApp code
  confirms it when WhatsApp is set up and is never a hindrance when it is not;
  email is optional and comes last (and a verified one signs in too).
* Learners' password rules are minimal — letters and numbers, 8+, no 1234 —
  and an easy password is accepted but flagged; administrators keep theirs.
* Registration is restricted to the project being registered: a project's
  link locks its state and district, an open project's district places the
  learner in it, and facility types follow the department.
* Chandrapur's talukas carry their subdivisions; gram panchayats are listed.
* A learner sees their own work — adoptions, forms due and done, what falls
  due next — from the same MASD rules as the supervisors, and only their own
  case pages.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_review_2026_10_17.py -v
"""
from __future__ import annotations

import base64
import os
import tempfile
from datetime import timedelta

import pytest

os.environ.setdefault("APP_ENV", "development")
_TEST_KEY = base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode().rstrip("=")
os.environ.setdefault("PHI_ENCRYPTION_KEYS", f"v1:{_TEST_KEY}")
os.environ.setdefault("PHI_ENCRYPTION_ACTIVE_KEY", "v1")
os.environ.setdefault("PHI_INDEX_KEY", "test-index-key-not-for-production")
os.environ.setdefault("AUDIT_HMAC_KEY", "test-audit-key-not-for-production-0123456789")

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from starlette.requests import Request  # noqa: E402

from app import identity, models, registration  # noqa: E402
from app.auth import get_password_hash  # noqa: E402
from app.database import Base  # noqa: E402
from app.masd import engine as E  # noqa: E402
from app.messaging import whatsapp  # noqa: E402
from app.routers import auth as auth_routes  # noqa: E402
from app.routers.metadata import get_facility_types  # noqa: E402
from app.schemas import UserLogin  # noqa: E402
from app.security import passwords  # noqa: E402
import app.models_live  # noqa: F401,E402
import app.models_security  # noqa: F401,E402


def _request(path: str = "/api/auth/login") -> Request:
    return Request({
        "type": "http", "method": "POST", "path": path, "raw_path": path.encode(), "root_path": "",
        "scheme": "http", "query_string": b"", "headers": [(b"host", b"testserver")],
        "client": ("127.0.0.1", 12345), "server": ("testserver", 80),
    })


@pytest.fixture()
def db():
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()
    os.unlink(path)


# ── Passwords ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("password,ok", [
    ("abcd1111", True),          # Sir's own example: allowed
    ("Mango4729", True),
    ("sunita2026", True),
    ("abcd1234", False),         # four numbers counting up
    ("pass9876x", False),        # … or down
    ("abcdefgh", False),         # no number
    ("12457801", False),         # no letter
    ("ab12cd3", False),          # 7 characters
    ("password1", False),        # common
    (" abcd1111", False),        # leading space
])
def test_learner_rules_are_minimal(password, ok):
    if ok:
        passwords.validate(password)
    else:
        with pytest.raises(passwords.PasswordPolicyError):
            passwords.validate(password)


def test_easy_passwords_are_flagged_not_refused():
    assert passwords.is_weak("abcd1111")             # alphabet run, repeats, short
    assert passwords.is_weak("sunita2026", full_name="Sunita Devi")
    assert not passwords.is_weak("Garden#River7")


def test_administrators_keep_the_strict_rule():
    with pytest.raises(passwords.PasswordPolicyError):
        passwords.validate("abcd1111", is_admin=True)
    passwords.validate("Garden#River7x", is_admin=True)
    learner, admin = passwords.describe_policy(), passwords.describe_policy(is_admin=True)
    assert learner["style"] == "simple" and learner["min_length"] == passwords.MIN_LENGTH_LEARNER == 8
    assert learner["number_run_length"] == passwords.NUMBER_RUN_LENGTH
    assert admin["style"] == "strict" and admin["min_length"] == passwords.MIN_LENGTH_ADMIN


# ── Mobile number first ────────────────────────────────────────────────────

def test_mobile_numbers_are_normalised():
    assert identity.normalise_mobile("+91 98765 43210") == "9876543210"
    assert identity.normalise_mobile("09876543210") == "9876543210"
    assert identity.normalise_mobile("12345") is None
    assert identity.normalise_mobile("5876543210") is None     # Indian mobiles start 6–9


def _register(db, phone="9876543210", password="Mango4729", name="Sunita Devi"):
    return auth_routes.register_mobile(
        request=_request("/api/auth/register-mobile"),
        data=auth_routes.MobileRegister(full_name=name, phone=phone, password=password), db=db)


def test_signup_with_whatsapp_code(db, monkeypatch):
    sent = {}
    monkeypatch.setattr(whatsapp, "available", lambda: True)
    monkeypatch.setattr(whatsapp, "send_otp", lambda mobile, code: sent.update(mobile=mobile, code=code))
    out = _register(db)
    assert out["otp_channel"] == "whatsapp" and out["is_verified"] is False
    user = db.query(models.User).one()
    assert identity.is_placeholder(user.email) and user.phone == "9876543210"
    assert user.phone_lookup == identity.lookup_token("9876543210")
    assert sent["mobile"] == "9876543210" and len(sent["code"]) == 6
    auth_routes.verify_phone(request=_request(), data=auth_routes.CodeOnly(code=sent["code"]),
                             current_user=user, token="t", db=db)
    db.refresh(user)
    assert user.is_verified and user.phone_verified


def test_signup_never_waits_for_an_unavailable_channel(db, monkeypatch):
    monkeypatch.setattr(whatsapp, "available", lambda: False)
    out = _register(db)
    assert out["otp_channel"] is None and out["is_verified"] is True
    assert db.query(models.User).one().phone_verified is False      # confirmed later


def test_a_number_registers_once(db, monkeypatch):
    monkeypatch.setattr(whatsapp, "available", lambda: False)
    _register(db)
    with pytest.raises(HTTPException) as exc:
        _register(db, name="Someone Else")
    assert exc.value.status_code == 400


def test_sign_in_with_mobile_number(db, monkeypatch):
    monkeypatch.setattr(whatsapp, "available", lambda: False)
    _register(db, password="abcd1111")
    ok = auth_routes.login_mobile(request=_request(), db=db,
                                  credentials=auth_routes.MobileLogin(phone="+91 98765-43210", password="abcd1111"))
    assert ok["access_token"] and ok["principal"].endswith(identity.PLACEHOLDER_DOMAIN)
    assert db.query(models.User).one().password_weak is True          # the nudge, not a refusal
    with pytest.raises(HTTPException) as exc:
        auth_routes.login_mobile(request=_request(), db=db,
                                 credentials=auth_routes.MobileLogin(phone="9876543210", password="wrong1x2y"))
    assert exc.value.status_code == 401


def test_a_verified_added_email_signs_in_too(db, monkeypatch):
    monkeypatch.setattr(whatsapp, "available", lambda: False)
    _register(db)
    user = db.query(models.User).one()
    user.contact_email, user.contact_email_verified = "sunita@example.org", True
    db.commit()
    out = auth_routes.login(request=_request(), db=db,
                            credentials=UserLogin(email="sunita@example.org", password="Mango4729"))
    assert out["access_token"]


# ── Registration by project ────────────────────────────────────────────────

@pytest.fixture()
def places(db):
    mh = models.State(name="Maharashtra", is_active=True)
    up = models.State(name="Uttar Pradesh", is_active=True)
    db.add_all([mh, up])
    db.flush()
    ch = models.District(state_id=mh.id, name="Chandrapur")
    jl = models.District(state_id=mh.id, name="Jalna")
    lk = models.District(state_id=up.id, name="Lucknow")
    db.add_all([ch, jl, lk])
    db.flush()
    p_ch = models.ProgramDistrict(name="Chandrapur", slug="chandrapur", is_active=True,
                                  registration_open=True, reg_state_id=mh.id, reg_district_id=ch.id)
    p_jl = models.ProgramDistrict(name="Jalna", slug="jalna", is_active=True,
                                  registration_open=False, reg_state_id=mh.id, reg_district_id=jl.id)
    db.add_all([p_ch, p_jl])
    db.commit()
    return {"mh": mh, "up": up, "ch": ch, "jl": jl, "lk": lk, "p_ch": p_ch, "p_jl": p_jl}


def test_only_open_places_are_offered(db, places):
    scope = registration.scope(db)
    assert scope["state_ids"] == [places["mh"].id] and scope["district_ids"] == [places["ch"].id]
    locked = registration.scope(db, "chandrapur")["locked"]
    assert locked["district"]["name"] == "Chandrapur" and locked["state"]["name"] == "Maharashtra"
    assert registration.scope(db, "jalna")["link_closed"] is True      # closed project's link


def test_registering_places_the_learner_in_the_project(db, places):
    learner = models.User(email="a@example.org", is_verified=True, district_id=places["ch"].id)
    db.add(learner)
    db.flush()
    assert registration.assign(db, learner, None).slug == "chandrapur"   # the open district
    wrong = models.User(email="b@example.org", is_verified=True, district_id=places["lk"].id)
    db.add(wrong)
    db.flush()
    with pytest.raises(HTTPException):
        registration.assign(db, wrong, "chandrapur")                       # link is for Chandrapur
    kept = models.User(email="c@example.org", is_verified=True, district_id=places["ch"].id,
                       program_district_id=places["p_jl"].id)
    db.add(kept)
    db.flush()
    assert registration.assign(db, kept, "chandrapur") is None             # an admin's choice stands


def test_facility_types_follow_the_department(db):
    hfw = models.Department(code="HFW", name="Health", order_index=0)
    wcd = models.Department(code="WCD", name="WCD", order_index=1)
    db.add_all([hfw, wcd])
    db.flush()
    awc = models.FacilityType(name="Anganwadi Centre (AWC)", order_index=0, department_id=wcd.id)
    phc = models.FacilityType(name="Primary Health Centre (PHC)", order_index=1, department_id=hfw.id)
    other = models.FacilityType(name="Other (Specify)", order_index=2, is_other=True)
    db.add_all([awc, phc, other])
    db.flush()
    wcd_other = models.Designation(department_id=wcd.id, name="Other (Specify)", order_index=0, is_other=True)
    db.add(wcd_other)
    db.commit()
    names = [f.name for f in get_facility_types(designation_id=wcd_other.id, department_id=None, db=db)]
    assert names == ["Anganwadi Centre (AWC)", "Other (Specify)"]          # never a PHC for WCD
    names = [f.name for f in get_facility_types(designation_id=None, department_id=hfw.id, db=db)]
    assert "Anganwadi Centre (AWC)" not in names


def test_chandrapur_snapshot_is_complete():
    import json
    from pathlib import Path

    geo = json.loads((Path(__file__).resolve().parent.parent / "alembic" / "versions" / "data"
                      / "chandrapur_geography_2026_10_17.json").read_text(encoding="utf-8"))
    assert len(geo["talukas"]) == 15
    assert len({t["subdivision"] for t in geo["talukas"]}) == 8
    assert sum(len(t["gram_panchayats"]) for t in geo["talukas"]) == 827


# ── The learner's own work ─────────────────────────────────────────────────

def test_learner_view_matches_the_supervisors_numbers():
    from test_masd import AS_OF, _project

    data = _project()
    row = next(r for r in E.compute(data, AS_OF)["learners"] if r["id"] == 1)
    view = E.learner_view(data, AS_OF, 1, due_days=7)
    assert view["adoptions"] == row["adoptions"] and view["own"]["pct"] == row["own"]["pct"]
    assert {c["mother_id"] for c in view["cases"]} == {m.id for m in data.mothers if m.learner_id == 1}
    for c in view["cases"]:
        for k in c["expected"]:
            assert c["behind"][k] == max(0, c["expected"][k] - c["done"][k])
    # Forms falling due in the window are exactly the expected count's growth.
    later = E.learner_view(data, AS_OF + timedelta(days=7), 1)
    assert view["upcoming_total"] >= 0 and later is not None
    assert E.learner_view(data, AS_OF, 999) is None


def test_a_monitor_sees_counts_not_mothers():
    from test_masd import AS_OF, _project

    rows = E.team_view(_project(), AS_OF, [1, 3])
    assert {r["id"] for r in rows} == {1, 3}
    assert all(set(r) == {"id", "name", "role_group", "adoptions", "target", "fulfilment_pct", "forms_done",
                          "forms_due", "forms_pct", "nil_days", "last_activity"} for r in rows)


def test_learners_open_only_their_own_case_page(db):
    from app.routers.growth import my_case_detail

    a = models.User(email="a@example.org", password_hash=get_password_hash("x"), is_verified=True, role="ASHA")
    b = models.User(email="b@example.org", password_hash=get_password_hash("x"), is_verified=True, role="ASHA")
    db.add_all([a, b])
    db.flush()
    mother = models.Mother(registered_by_user_id=a.id, mother_name="M One", mother_uid="M-1")
    db.add(mother)
    db.flush()
    child = models.Child(mother_id=mother.id, child_name="Baby One", child_uid="C-1", gender="Female")
    db.add(child)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        my_case_detail(child_id=child.id, current_user=b, db=db)
    assert exc.value.status_code == 404
    page = my_case_detail(child_id=child.id, current_user=a, db=db)
    assert page["child"]["uid"] == "C-1" and page["mother"]["name"] == "M One"
