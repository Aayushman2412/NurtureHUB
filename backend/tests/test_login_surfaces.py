"""An administrator's credentials must not open a learner session.

The learner sign-in form and the admin console are separate doors on purpose:
the audit trail records which surface a session came from, and an admin token
carries authority the learner UI was never scoped for. Before this was enforced,
typing an administrator's email and password into the learner form returned a
working admin session — the handler simply passed `is_admin` through.

The route is called directly rather than through TestClient: starlette's client
needs httpx, which is not a dependency of this project and has no business in
the production image for the sake of a test.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_login_surfaces.py -v
"""
from __future__ import annotations

import base64
import os
import tempfile

import pytest

# Test keys, installed before anything imports settings-derived state.
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

from app.auth import get_password_hash  # noqa: E402
from app.database import Base  # noqa: E402
from app.models import User  # noqa: E402
from app.routers.auth import login  # noqa: E402
from app.schemas import UserLogin  # noqa: E402
import app.models_live  # noqa: F401,E402
import app.models_security  # noqa: F401,E402

PASSWORD = "correct-horse-battery-staple"


def _request() -> Request:
    """The minimum scope the rate limiter and the audit layer read."""
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/api/auth/login",
        "raw_path": b"/api/auth/login",
        "root_path": "",
        "scheme": "http",
        "query_string": b"",
        "headers": [(b"host", b"testserver")],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    })


@pytest.fixture()
def db():
    """A throwaway SQLite database holding one learner and one administrator."""
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.add_all([
        User(email="learner@example.org", password_hash=get_password_hash(PASSWORD),
             full_name="A Learner", is_verified=True, is_admin=False,
             role="Anganwadi Worker (AWW)"),
        User(email="admin@example.org", password_hash=get_password_hash(PASSWORD),
             full_name="An Admin", is_verified=True, is_admin=True, role="Administrator"),
    ])
    session.commit()
    yield session
    session.close()
    engine.dispose()
    os.unlink(path)


def _login(db, email, password):
    return login(request=_request(),
                 credentials=UserLogin(email=email, password=password), db=db)


class TestLearnerSignIn:
    def test_learner_signs_in(self, db):
        out = _login(db, "learner@example.org", PASSWORD)
        assert out["access_token"]
        assert out["is_admin"] is False

    def test_admin_credentials_are_refused(self, db):
        """Correct password, wrong door."""
        with pytest.raises(HTTPException) as exc:
            _login(db, "admin@example.org", PASSWORD)
        assert exc.value.status_code == 401

    def test_refusal_does_not_reveal_that_the_account_is_an_admin(self, db):
        """A wrong password gets the same answer on an admin account as on a
        learner's — the learner form is no oracle for who the administrators
        are. Only the CORRECT admin password is told to use the admin door
        (review of 14 Oct 2026): whoever sees that already holds the password.
        """
        with pytest.raises(HTTPException) as admin_wrong:
            _login(db, "admin@example.org", "not-the-password")
        with pytest.raises(HTTPException) as learner_wrong:
            _login(db, "learner@example.org", "not-the-password")
        assert admin_wrong.value.status_code == learner_wrong.value.status_code == 401
        assert admin_wrong.value.detail == learner_wrong.value.detail
        with pytest.raises(HTTPException) as admin_right:
            _login(db, "admin@example.org", PASSWORD)
        assert admin_right.value.status_code == 401 and admin_right.value.detail == "use_admin_sign_in"

    def test_keyboard_debris_around_a_password_is_forgiven(self, db):
        """A trailing space from a word suggestion, a non-breaking space or a
        zero-width character from a paste: the password as the person meant it
        still signs in. The exact form is always tried first."""
        for typed in (PASSWORD + " ", " " + PASSWORD, PASSWORD + " ", "​" + PASSWORD):
            assert _login(db, "learner@example.org", typed)["access_token"]
        with pytest.raises(HTTPException):
            _login(db, "learner@example.org", PASSWORD.upper() if PASSWORD.upper() != PASSWORD else PASSWORD + "x")

    def test_unknown_account_refused(self, db):
        with pytest.raises(HTTPException) as exc:
            _login(db, "nobody@example.org", PASSWORD)
        assert exc.value.status_code == 401
