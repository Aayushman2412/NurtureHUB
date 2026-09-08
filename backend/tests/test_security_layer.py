"""The data-protection layer's load-bearing claims, tested rather than asserted.

Every claim NurtureHUB makes under the MOU's data-privacy clause reduces to one
of the things checked here:

  * identifiers really are ciphertext in the database, and still readable by the app
  * the audit trail really does detect being edited, deleted from, or truncated
  * a rolled-back transaction does NOT make the trail look tampered with
  * the statutory clocks are computed from discovery, with the right windows
  * the password, lockout, second-factor and consent rules behave as documented

    cd backend && venv/bin/python -m pytest tests/test_security_layer.py -v
    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_security_layer.py -v

The audit and consent tests need a database; they use a temporary SQLite file so
they never touch a real one. The pure-logic tests need nothing.
"""
from __future__ import annotations

import base64
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

import pytest

# ── Test keys, installed before anything imports settings-derived state ──────
os.environ.setdefault("APP_ENV", "development")
_TEST_KEY = base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode().rstrip("=")
os.environ["PHI_ENCRYPTION_KEYS"] = f"v1:{_TEST_KEY}"
os.environ["PHI_ENCRYPTION_ACTIVE_KEY"] = "v1"
os.environ["PHI_INDEX_KEY"] = "test-index-key-not-for-production"
os.environ["AUDIT_HMAC_KEY"] = "test-audit-key-not-for-production-0123456789"

from app.config import settings  # noqa: E402
from app.security import audit, consent, incidents, lockout, passwords, totp  # noqa: E402
from app.security import crypto, redaction  # noqa: E402

settings.PHI_ENCRYPTION_KEYS = os.environ["PHI_ENCRYPTION_KEYS"]
settings.PHI_ENCRYPTION_ACTIVE_KEY = "v1"
settings.PHI_INDEX_KEY = os.environ["PHI_INDEX_KEY"]
settings.AUDIT_HMAC_KEY = os.environ["AUDIT_HMAC_KEY"]
crypto._keyring.cache_clear()


# ═══════════════════════════════════════════════════════════════════════════
# Encryption
# ═══════════════════════════════════════════════════════════════════════════


class TestFieldEncryption:
    def test_round_trip(self):
        sealed = crypto.encrypt("9876543210", aad="mothers.mobile")
        assert sealed.startswith("enc:v1:")
        assert "9876543210" not in sealed
        assert crypto.decrypt(sealed, aad="mothers.mobile") == "9876543210"

    def test_nondeterministic(self):
        """Two seals of the same value must differ, or the ciphertext itself
        leaks which mothers share a phone number."""
        a = crypto.encrypt("9876543210", aad="mothers.mobile")
        b = crypto.encrypt("9876543210", aad="mothers.mobile")
        assert a != b
        assert crypto.decrypt(a, aad="mothers.mobile") == crypto.decrypt(b, aad="mothers.mobile")

    def test_context_binding(self):
        """A ciphertext lifted from one column must not open in another."""
        sealed = crypto.encrypt("9876543210", aad="mothers.mobile")
        with pytest.raises(Exception):
            crypto.decrypt(sealed, aad="mothers.email")

    def test_plaintext_passes_through_on_read(self):
        """Pre-migration rows must stay readable, or switching the column type
        would leave a window where the app cannot read its own data."""
        assert crypto.decrypt("9876543210", aad="mothers.mobile") == "9876543210"

    def test_never_double_wraps(self):
        once = crypto.encrypt("9876543210", aad="mothers.mobile")
        twice = crypto.encrypt(once, aad="mothers.mobile")
        assert once == twice

    def test_none_stays_none(self):
        assert crypto.encrypt(None, aad="x") is None
        assert crypto.decrypt(None, aad="x") is None


class TestBlindIndex:
    def test_matches_across_formatting(self):
        """Field workers type numbers inconsistently; the index must not care."""
        canonical = crypto.phone_index("9876543210", "mother.mobile")
        for variant in ("+91 98765 43210", "098765-43210", "  9876543210  ", "+919876543210"):
            assert crypto.phone_index(variant, "mother.mobile") == canonical

    def test_domain_separated(self):
        """The same number indexed for a mother and a learner must not collide,
        or the index alone reveals that they are the same person."""
        assert crypto.phone_index("9876543210", "mother.mobile") != crypto.phone_index(
            "9876543210", "user.phone"
        )

    def test_is_one_way(self):
        token = crypto.phone_index("9876543210", "mother.mobile")
        assert "9876543210" not in token
        assert len(token) < 30

    def test_different_numbers_differ(self):
        assert crypto.phone_index("9876543210", "m") != crypto.phone_index("9876543211", "m")


# ═══════════════════════════════════════════════════════════════════════════
# Audit trail
# ═══════════════════════════════════════════════════════════════════════════


@pytest.fixture()
def db():
    """A throwaway SQLite database with the security tables."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.database import Base
    import app.models  # noqa: F401
    import app.models_live  # noqa: F401
    import app.models_security  # noqa: F401

    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Each test gets its own chain, so one test's rows cannot fail another's
    # verification.
    original_chain = audit._CHAIN_KEY
    audit._CHAIN_KEY = f"test:{os.urandom(4).hex()}"
    audit._chain_state["prev_hash"] = None
    audit._chain_state["sequence"] = 0
    try:
        yield session
    finally:
        audit._CHAIN_KEY = original_chain
        audit._chain_state["prev_hash"] = None
        audit._chain_state["sequence"] = 0
        session.close()
        engine.dispose()
        try:
            os.unlink(path)
        except OSError:
            pass


def _write(db, n=5, action=None):
    for i in range(n):
        audit.record_sync(
            action or audit.Action.PHI_READ,
            db=db,
            resource_type="mother",
            resource_id=i,
            subject_type="mother",
            subject_id=i,
            actor_override={"actor_type": "learner", "actor_label": f"worker{i}@example.org"},
        )
    db.commit()


class TestAuditChain:
    def test_clean_chain_verifies(self, db):
        _write(db, 5)
        result = audit.verify_all(db)
        assert result["valid"] is True
        assert result["total_events"] == 5

    def test_detects_an_edited_row(self, db):
        """The core claim: someone with database access cannot quietly rewrite
        who did what."""
        from sqlalchemy import text

        _write(db, 5)
        db.execute(
            text("UPDATE audit_events SET actor_label = 'someone.else@example.org' WHERE sequence = 3")
        )
        db.commit()

        result = audit.verify_all(db)
        assert result["valid"] is False
        issues = [i for c in result["chains"] for i in c["issues"]]
        assert any(i["type"] == "content_modified" for i in issues)

    def test_detects_a_deleted_row(self, db):
        from sqlalchemy import text

        _write(db, 5)
        db.execute(text("DELETE FROM audit_events WHERE sequence = 3"))
        db.commit()

        result = audit.verify_all(db)
        assert result["valid"] is False
        types = {i["type"] for c in result["chains"] for i in c["issues"]}
        assert "sequence_gap" in types or "broken_link" in types

    def test_detects_a_truncated_tail_via_anchors(self, db):
        """A hash chain alone cannot see rows removed from its END — the chain
        just looks shorter. Anchors are what close that."""
        from sqlalchemy import text

        _write(db, 5)
        assert audit.write_anchors(db) == 1

        db.execute(text("DELETE FROM audit_events WHERE sequence >= 4"))
        db.commit()

        result = audit.verify_all(db)
        assert result["valid"] is False
        assert any(i["type"] == "chain_truncated" for i in result["anchors"]["issues"])

    def test_reports_a_missing_chain_head_distinctly(self, db):
        """Losing the OLDEST events (retention, or a truncation) is a different
        finding from an edit in the middle, and must not be reported as every
        surviving row following nothing."""
        from sqlalchemy import text

        _write(db, 6)
        db.execute(text("DELETE FROM audit_events WHERE sequence <= 2"))
        db.commit()

        result = audit.verify_all(db)
        assert result["valid"] is False
        issues = [i for c in result["chains"] for i in c["issues"]]
        head = [i for i in issues if i["type"] == "chain_head_missing"]
        assert len(head) == 1, issues
        assert head[0]["missing_before"] == 2
        # The rows that DO survive still verify against each other — the report
        # points at the gap, not at every remaining row.
        assert not [i for i in issues if i["type"] == "content_modified"]

    def test_rollback_does_not_corrupt_the_chain(self, db):
        """The regression this layer shipped with once: an event recorded and
        then rolled back consumed a sequence number, leaving a gap that looked
        exactly like someone deleting rows. A trail that cries wolf is worse
        than no trail."""
        _write(db, 3)

        audit.record_sync(
            audit.Action.MFA_CHALLENGE_FAILED,
            db=db,
            resource_type="mfa",
            resource_id="admin@example.org",
            outcome="denied",
        )
        db.rollback()          # the request failed after recording

        _write(db, 2)

        result = audit.verify_all(db)
        assert result["valid"] is True, [i for c in result["chains"] for i in c["issues"]]

    def test_hash_covers_every_field(self, db):
        """Changing any hashed field must break the signature — otherwise an
        attacker edits the one field the hash happens to ignore."""
        from app.models_security import AuditEvent

        _write(db, 1)
        row = db.query(AuditEvent).first()
        for field, value in (
            ("actor_label", "other@example.org"),
            ("source_ip", "10.0.0.1"),
            ("action", "phi.list"),
            ("subject_id", "999"),
            ("record_count", 500),
            ("outcome", "denied"),
        ):
            original = getattr(row, field)
            setattr(row, field, value)
            recomputed = audit.compute_hash(row.prev_hash, {
                c.name: getattr(row, c.name) for c in AuditEvent.__table__.columns
            })
            assert recomputed != row.entry_hash, f"{field} is not covered by the signature"
            setattr(row, field, original)

    def test_key_change_invalidates(self, db):
        """Verification is keyed, not just hashed: without the key an attacker
        cannot recompute a consistent chain."""
        _write(db, 3)
        assert audit.verify_all(db)["valid"] is True

        original = settings.AUDIT_HMAC_KEY
        settings.AUDIT_HMAC_KEY = "a-different-key-entirely-0123456789"
        try:
            assert audit.verify_all(db)["valid"] is False
        finally:
            settings.AUDIT_HMAC_KEY = original

    def test_a_failed_commit_leaves_no_gap(self, db):
        """Positions are handed out in before_commit, so a commit that fails
        AFTER that — a burst exhausting the connection pool, say — would consume
        one for nothing and leave a hole that verification reports as deleted
        rows. Found by load-testing a mass sign-in."""
        from sqlalchemy import event as sa_event

        _write(db, 3)

        # Make the next commit fail at flush time, the way a pool timeout does.
        def explode(session, flush_context, instances):
            raise RuntimeError("simulated failure during commit")

        audit.record_sync(
            audit.Action.LOGIN_SUCCESS, db=db, resource_type="account", resource_id="a@b.org"
        )
        sa_event.listen(db, "before_flush", explode)
        try:
            with pytest.raises(Exception):
                db.commit()
        finally:
            sa_event.remove(db, "before_flush", explode)
        db.rollback()

        _write(db, 2)

        result = audit.verify_all(db)
        assert result["valid"] is True, [i for c in result["chains"] for i in c["issues"]]

    def test_spooled_events_verify_after_recovery(self, db, tmp_path):
        """Events that survive a database outage go to disk and are re-ingested.
        They must verify afterwards — an earlier version serialised the
        timestamp one way and read it back another, so every event recovered
        from an outage was reported as tampered."""
        spool = tmp_path / "audit_spool.jsonl"
        original = settings.AUDIT_SPOOL_PATH
        settings.AUDIT_SPOOL_PATH = str(spool)
        try:
            _write(db, 2)

            pending = [
                audit._build(
                    audit.Action.PHI_READ,
                    resource_type="mother",
                    resource_id=99,
                    actor_override={"actor_type": "learner", "actor_label": "spooled@example.org"},
                )
            ]
            audit._spill(pending, "db_error:test")
            assert spool.exists()

            assert audit._drain_spool(db) == 1
            db.commit()

            result = audit.verify_all(db)
            assert result["valid"] is True, [i for c in result["chains"] for i in c["issues"]]
            assert result["total_events"] == 3
        finally:
            settings.AUDIT_SPOOL_PATH = original

    def test_details_never_carry_identifier_values(self, db):
        """An audit row records THAT a phone number was read, never the number.
        A log that copies what it protects is a second breach surface."""
        from app.models_security import AuditEvent

        audit.record_sync(
            audit.Action.PHI_READ,
            db=db,
            resource_type="mother",
            resource_id=1,
            detail={"mobile": "9876543210", "note": "called her on 9876543210"},
        )
        db.commit()

        stored = db.query(AuditEvent).first().detail
        assert "9876543210" not in stored
        assert redaction.REDACTED in stored


# ═══════════════════════════════════════════════════════════════════════════
# Redaction
# ═══════════════════════════════════════════════════════════════════════════


class TestRedaction:
    def test_masks_indian_mobiles_in_free_text(self):
        out = redaction.redact_text("call the mother on +91 98765 43210 today")
        assert "9876543210" not in out
        assert "98765" not in out

    def test_masks_emails(self):
        assert "sunita.kamble" not in redaction.redact_text("sunita.kamble@example.org")

    def test_masks_aadhaar_shaped_numbers(self):
        out = redaction.redact_text("id 1234 5678 9012")
        assert "1234 5678 9012" not in out
        assert "9012" in out  # last four kept for reconciliation

    def test_sensitive_keys_are_dropped_entirely(self):
        out = redaction.redact({"password": "hunter2", "otp": "123456", "village": "Kolhapur"})
        assert out["password"] == redaction.REDACTED
        assert out["otp"] == redaction.REDACTED
        assert out["village"] == "Kolhapur"

    def test_suffix_keys_are_caught(self):
        out = redaction.redact({"mother_mobile": "9876543210", "alternate_email": "a@b.org"})
        assert out["mother_mobile"] == redaction.REDACTED
        assert out["alternate_email"] == redaction.REDACTED

    def test_masks_keep_enough_to_reconcile(self):
        assert redaction.mask_phone("9876543210").endswith("210")
        assert redaction.mask_name("Sunita Kamble") == "S. K."
        assert redaction.mask_email("sunita@example.org").endswith("@example.org")

    def test_depth_is_bounded(self):
        deep = current = {}
        for _ in range(50):
            current["next"] = {}
            current = current["next"]
        assert redaction.redact(deep) is not None  # does not recurse forever


# ═══════════════════════════════════════════════════════════════════════════
# Passwords
# ═══════════════════════════════════════════════════════════════════════════


class TestPasswordPolicy:
    @pytest.mark.parametrize("bad", [
        "123456", "password", "admin123", "qwerty123", "Passw0rd",
        "aaaaaaaaaaaa", "1234567890ab", "nurturehub",
    ])
    def test_rejects_what_attackers_try_first(self, bad):
        with pytest.raises(passwords.PasswordPolicyError):
            passwords.validate(bad)

    def test_rejects_too_short(self):
        with pytest.raises(passwords.PasswordPolicyError, match="at least 10"):
            passwords.validate("Ab3$xyz")

    def test_admins_need_more_length(self):
        passwords.validate("Kolhapur#42x")            # 12 chars, fine for a learner
        with pytest.raises(passwords.PasswordPolicyError, match="at least 12"):
            passwords.validate("Kolhapur#4", is_admin=True)

    def test_rejects_password_built_from_the_account(self):
        with pytest.raises(passwords.PasswordPolicyError, match="name or email"):
            passwords.validate("Sunita#Kamble99", email="sunita@example.org", full_name="Sunita Kamble")

    def test_long_passphrase_needs_no_symbols(self):
        """Length carries the strength — forcing symbol classes mostly produces
        'Password1!'."""
        passwords.validate("correct horse battery staple")

    def test_accepts_a_reasonable_password(self):
        passwords.validate("Anganwadi#Pune42")

    def test_rejects_keyboard_runs(self):
        with pytest.raises(passwords.PasswordPolicyError, match="keyboard sequence"):
            passwords.validate("Asdfghjkl#9")


# ═══════════════════════════════════════════════════════════════════════════
# TOTP
# ═══════════════════════════════════════════════════════════════════════════


class TestTotp:
    def test_current_code_verifies(self):
        secret = totp.generate_secret()
        assert totp.verify(secret, totp.code(secret)) is not None

    def test_wrong_code_rejected(self):
        secret = totp.generate_secret()
        assert totp.verify(secret, "000000") is None

    def test_tolerates_clock_drift(self):
        """Phone clocks are not exact; ±1 step is the usual tolerance."""
        secret = totp.generate_secret()
        drifted = totp.code(secret, at=__import__("time").time() - 25)
        assert totp.verify(secret, drifted) is not None

    def test_rejects_replay(self):
        """A 6-digit code stays valid for its whole window, so a shoulder-surfed
        code could otherwise be reused seconds later."""
        secret = totp.generate_secret()
        code = totp.code(secret)
        step = totp.verify(secret, code)
        assert step is not None
        assert totp.verify(secret, code, last_step=step) is None

    def test_provisioning_uri_is_well_formed(self):
        secret = totp.generate_secret()
        uri = totp.provisioning_uri(secret, "admin@example.org", "NurtureHUB")
        assert uri.startswith("otpauth://totp/")
        assert f"secret={secret}" in uri
        assert "issuer=NurtureHUB" in uri


# ═══════════════════════════════════════════════════════════════════════════
# Breach clocks
# ═══════════════════════════════════════════════════════════════════════════


class TestStatutoryClocks:
    def _notification(self, hours_from_now, sent_at=None, not_applicable=False):
        from app.models_security import BreachNotification

        return BreachNotification(
            incident_id=1,
            authority="cert_in",
            authority_label="CERT-In",
            due_at=datetime.now(timezone.utc) + timedelta(hours=hours_from_now),
            sent_at=sent_at,
            not_applicable=not_applicable,
        )

    def test_certin_window_is_six_hours(self):
        spec = next(s for s in incidents.NOTIFICATION_SPECS if s.authority == "cert_in")
        assert spec.hours() == 6, "CERT-In Directions 28.04.2022 require 6 hours"

    def test_every_statutory_authority_is_covered(self):
        authorities = {s.authority for s in incidents.NOTIFICATION_SPECS}
        assert {"cert_in", "dpb_initial", "dpb_detailed", "data_principals",
                "mou_counterparty"} <= authorities

    def test_pending_then_due_soon_then_overdue(self):
        assert incidents.deadline_state(self._notification(5))["state"] == "pending"
        assert incidents.deadline_state(self._notification(0.4))["state"] == "due_soon"
        overdue = incidents.deadline_state(self._notification(-2))
        assert overdue["state"] == "overdue"
        assert overdue["overdue_by"] > 7000

    def test_late_notification_is_recorded_as_late(self):
        sent = datetime.now(timezone.utc)
        state = incidents.deadline_state(self._notification(-3, sent_at=sent))
        assert state["state"] == "met_late"

    def test_not_applicable_has_no_clock(self):
        assert incidents.deadline_state(self._notification(-99, not_applicable=True))["state"] \
            == "not_applicable"

    def test_drafts_cite_the_right_law(self):
        from app.models_security import BreachIncident

        incident = BreachIncident(
            reference="NH-IR-2026-0001",
            title="Test",
            severity="high",
            status="open",
            discovered_at=datetime.now(timezone.utc),
            custody_party="shared",
            joint_process=True,
            phi_involved=True,
            affected_subject_count=12,
            categories=json.dumps(["mother_contact"]),
        )
        certin = incidents.render_notification(incident, "cert_in")
        assert "70B" in certin and "28 April 2022" in certin

        dpb = incidents.render_notification(incident, "dpb_initial")
        assert "8(6)" in dpb and "Digital Personal Data Protection Act, 2023" in dpb

        mou = incidents.render_notification(incident, "mou_counterparty")
        assert "fault, control and applicable law" in mou

        principals = incidents.render_notification(incident, "data_principals")
        assert "Namaste" in principals  # written for the reader, not for a lawyer


# ═══════════════════════════════════════════════════════════════════════════
# Consent
# ═══════════════════════════════════════════════════════════════════════════


class TestConsent:
    def test_essential_and_optional_are_separated(self):
        """s.6 requires consent to be specific and unconditional — optional
        purposes must not be bundled with the service."""
        assert "care_delivery" in consent.ESSENTIAL_PURPOSES
        assert "research" not in consent.ESSENTIAL_PURPOSES
        assert consent.PURPOSES["research"]["essential"] is False

    def test_registration_grants_only_the_essential_purposes(self, db):
        rows = consent.grant_defaults(db, subject_type="mother", subject_id=1)
        assert {r.purpose for r in rows} == set(consent.ESSENTIAL_PURPOSES)
        assert consent.has_consent(db, "mother", 1, "research") is False

    def test_withdrawal_keeps_the_record(self, db):
        """Withdrawal must not erase the evidence that processing up to that
        moment had a lawful basis."""
        consent.grant(db, subject_type="mother", subject_id=2, purpose="care_delivery")
        row = consent.withdraw(db, subject_type="mother", subject_id=2, purpose="care_delivery")
        assert row is not None
        assert row.withdrawn_at is not None
        assert row.granted_at is not None
        assert consent.has_consent(db, "mother", 2, "care_delivery") is False

    def test_child_consent_records_the_guardian_and_the_verification(self, db):
        """s.9 makes verifiable guardian consent the obligation, so the method
        has to be recorded, not just the fact."""
        rows = consent.grant_defaults(
            db, subject_type="child", subject_id=3,
            given_by="Sunita Kamble", given_by_relationship="mother",
            is_guardian_consent=True, verification_method="in_person",
        )
        assert all(r.is_guardian_consent for r in rows)
        assert all(r.verification_method == "in_person" for r in rows)

    def test_missing_essential_is_reported(self, db):
        assert set(consent.missing_essential(db, "mother", 99)) == set(consent.ESSENTIAL_PURPOSES)

    def test_notice_matches_the_purposes_in_use(self):
        """A notice describing purposes the system does not use, or omitting
        ones it does, is worse than no notice."""
        notice = consent.notice_text()
        assert {p["purpose"] for p in notice["purposes"]} == set(consent.PURPOSES)
        assert notice["version"] == consent.NOTICE_VERSION
        assert "children" in notice and notice["children"]


# ═══════════════════════════════════════════════════════════════════════════
# Retention floor
# ═══════════════════════════════════════════════════════════════════════════


class TestRetention:
    def test_log_retention_cannot_go_below_the_certin_floor(self, db):
        from app.models_security import RetentionPolicy
        from app.security import retention

        retention.ensure_policies(db)
        policy = db.query(RetentionPolicy).filter(RetentionPolicy.key == "audit_events").first()
        policy.retention_days = 30
        db.commit()

        result = retention.run(db, dry_run=True)
        assert "refusing to run" in str(result["policies"]["audit_events"].get("error", ""))

    def test_patient_records_are_never_auto_deleted(self, db):
        from app.security import retention

        retention.ensure_policies(db)
        result = retention.run(db, dry_run=False)
        for key in ("mother_records", "child_records"):
            assert result["policies"][key]["action"] == "review"
            assert result["policies"][key]["deleted"] == 0

    def test_defaults_exceed_the_certin_minimum(self):
        from app.security import retention

        for spec in retention.DEFAULT_POLICIES:
            if spec["key"] in ("audit_events", "login_attempts"):
                assert spec["retention_days"] >= retention.CERT_IN_LOG_FLOOR_DAYS


# ═══════════════════════════════════════════════════════════════════════════
# Lockout
# ═══════════════════════════════════════════════════════════════════════════


class TestLockout:
    def test_locks_after_the_threshold(self, db):
        for _ in range(settings.LOCKOUT_THRESHOLD):
            lockout.record_attempt(db, principal="worker@example.org", successful=False)
        assert lockout.active_lockout(db, "worker@example.org") is not None

    def test_does_not_lock_below_the_threshold(self, db):
        for _ in range(settings.LOCKOUT_THRESHOLD - 1):
            lockout.record_attempt(db, principal="worker2@example.org", successful=False)
        assert lockout.active_lockout(db, "worker2@example.org") is None

    def test_success_clears_the_counter(self, db):
        for _ in range(settings.LOCKOUT_THRESHOLD - 1):
            lockout.record_attempt(db, principal="worker3@example.org", successful=False)
        lockout.record_attempt(db, principal="worker3@example.org", successful=True)
        assert lockout.active_lockout(db, "worker3@example.org") is None

    def test_repeat_lockouts_last_longer(self, db):
        from app.models_security import AccountLockout

        for _ in range(settings.LOCKOUT_THRESHOLD * 2 + 1):
            lockout.record_attempt(db, principal="worker4@example.org", successful=False)
        rows = (
            db.query(AccountLockout)
            .filter(AccountLockout.principal == "worker4@example.org")
            .order_by(AccountLockout.id)
            .all()
        )
        assert len(rows) >= 2
        first = rows[0].locked_until - rows[0].locked_at
        last = rows[-1].locked_until - rows[-1].locked_at
        assert last > first

    def test_an_admin_can_unlock(self, db):
        for _ in range(settings.LOCKOUT_THRESHOLD):
            lockout.record_attempt(db, principal="worker5@example.org", successful=False)
        assert lockout.clear(db, "worker5@example.org", by="admin@example.org") >= 1
        assert lockout.active_lockout(db, "worker5@example.org") is None


# ═══════════════════════════════════════════════════════════════════════════
# Production configuration guard
# ═══════════════════════════════════════════════════════════════════════════


class TestProductionGuard:
    def _prod(self, **overrides):
        from app.config import Settings

        base = dict(
            APP_ENV="production",
            JWT_SECRET_KEY="a" * 40,
            DATABASE_URL="postgresql://u:p@db/nurturehub",
            SMTP_USER="a@b.org",
            SMTP_PASSWORD="x",
            AUDIT_HMAC_KEY="b" * 40,
            PHI_ENCRYPTION_KEYS=f"v1:{_TEST_KEY}",
            PHI_INDEX_KEY="c" * 40,
            ALLOWED_HOSTS="nurturehub.example.org",
            SEED_DEMO_DATA=False,
            RAW_EXPORT_MOCK=False,
            ALLOW_DEV_ADMIN=False,
            ADMIN_BOOTSTRAP_PASSWORD="",
            DPO_EMAIL="dpo@example.org",
        )
        base.update(overrides)
        return Settings(**base)

    def test_a_correct_production_config_boots(self):
        self._prod().validate_production()

    @pytest.mark.parametrize("override,expected", [
        ({"AUDIT_HMAC_KEY": ""}, "AUDIT_HMAC_KEY"),
        ({"PHI_ENCRYPTION_KEYS": ""}, "PHI_ENCRYPTION_KEYS"),
        ({"PHI_INDEX_KEY": ""}, "PHI_INDEX_KEY"),
        ({"ALLOW_DEV_ADMIN": True}, "ALLOW_DEV_ADMIN"),
        ({"ALLOWED_HOSTS": ""}, "ALLOWED_HOSTS"),
        ({"SEED_DEMO_DATA": True}, "SEED_DEMO_DATA"),
        ({"RAW_EXPORT_MOCK": True}, "RAW_EXPORT_MOCK"),
        ({"DPO_EMAIL": "privacy@nurturehub.org"}, "DPO_EMAIL"),
    ])
    def test_refuses_to_boot_without_a_control(self, override, expected):
        """Booting without one of these means the platform cannot honestly claim
        the protection, so it refuses rather than claiming it silently."""
        with pytest.raises(RuntimeError, match=expected):
            self._prod(**override).validate_production()

    def test_audit_key_must_differ_from_the_token_secret(self):
        shared = "d" * 40
        with pytest.raises(RuntimeError, match="different from JWT_SECRET_KEY"):
            self._prod(JWT_SECRET_KEY=shared, AUDIT_HMAC_KEY=shared).validate_production()

    def test_development_is_not_constrained(self):
        from app.config import Settings

        Settings(APP_ENV="development").validate_production()  # no raise
