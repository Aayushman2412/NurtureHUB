"""Second factor for administrator accounts.

An administrator token in this system reads every mother and child in the
programme. A password alone is the wrong protection for that: it is phishable,
reusable and the one credential that is guaranteed to also exist on some other
site. TOTP is not perfect — it is phishable in real time — but it removes the
entire class of attack that starts with a password from a breach corpus, which
is how these accounts are actually taken.

Field learners are deliberately *not* required to enrol. They work on shared or
low-end phones, often without a second device, and their access is already
scoped to their own registrations. Forcing TOTP there would produce shared
accounts, which is strictly worse. The requirement is scoped to privilege.

Storage
-------
The TOTP secret is sealed with the PHI key ring, so a database dump does not
yield working second factors. Recovery codes are bcrypt hashes, single-use, and
shown exactly once.
"""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Optional

from app.config import settings
from app.security import audit, totp
from app.security.crypto import decrypt, encrypt

RECOVERY_CODE_COUNT = 10
_AAD = "mfa_enrollments.secret"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_recovery_codes() -> list:
    # Grouped digits+letters, easy to read off paper, no ambiguous characters.
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return [
        "-".join(
            "".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(2)
        )
        for _ in range(RECOVERY_CODE_COUNT)
    ]


def get_enrollment(db, principal: str):
    from app.models_security import MfaEnrollment

    return (
        db.query(MfaEnrollment)
        .filter(MfaEnrollment.principal == (principal or "").strip().lower())
        .first()
    )


def is_enrolled(db, principal: str) -> bool:
    row = get_enrollment(db, principal)
    return bool(row and row.confirmed_at and not row.disabled_at)


def required_for(principal: str, is_admin: bool) -> bool:
    """Whether this principal must present a second factor.

    `MFA_REQUIRED_FOR_ADMINS` is a setting rather than a constant so a
    deployment can enrol its administrators first and then switch enforcement
    on — turning it on before anyone has enrolled would lock every
    administrator out of the console at once.
    """
    return bool(is_admin and settings.MFA_REQUIRED_FOR_ADMINS)


def begin_enrollment(db, principal: str, commit: bool = True) -> dict:
    """Create (or replace) an unconfirmed enrolment and return what the UI shows.

    The secret is not usable until `confirm_enrollment` sees a valid code from
    it, so an interrupted enrolment cannot leave an account with a second factor
    nobody holds.
    """
    from app.models_security import MfaEnrollment

    principal = (principal or "").strip().lower()
    secret = totp.generate_secret()
    row = get_enrollment(db, principal)
    if row is None:
        row = MfaEnrollment(principal=principal, secret_encrypted="")
        db.add(row)
    row.secret_encrypted = encrypt(secret, aad=_AAD)
    row.confirmed_at = None
    row.disabled_at = None
    row.last_step = None
    row.recovery_codes = None
    db.flush()
    if commit:
        db.commit()
    return {
        "secret": secret,
        "secret_formatted": totp.format_secret(secret),
        "otpauth_uri": totp.provisioning_uri(secret, principal, settings.MFA_ISSUER),
        "issuer": settings.MFA_ISSUER,
        "account": principal,
        "digits": totp.DIGITS,
        "period": totp.STEP_SECONDS,
    }


def confirm_enrollment(db, principal: str, code: str, commit: bool = True) -> dict:
    """Verify the first code, activate the enrolment, and issue recovery codes."""
    principal = (principal or "").strip().lower()
    row = get_enrollment(db, principal)
    if row is None or not row.secret_encrypted:
        raise ValueError("Start enrolment before confirming it.")
    secret = decrypt(row.secret_encrypted, aad=_AAD)
    step = totp.verify(secret, code)
    if step is None:
        audit.record_sync(
            audit.Action.MFA_CHALLENGE_FAILED,
            db=db,
            resource_type="mfa",
            resource_id=principal,
            outcome="denied",
            is_phi=False,
            detail={"principal": principal, "stage": "enrollment"},
        )
        raise ValueError("That code is not correct. Check your authenticator app and try again.")

    codes = _generate_recovery_codes()
    from app.auth import get_password_hash

    row.recovery_codes = json.dumps([get_password_hash(c) for c in codes])
    row.confirmed_at = _now()
    row.last_step = step
    row.last_used_at = _now()
    db.flush()

    audit.record_sync(
        audit.Action.MFA_ENROLLED,
        db=db,
        resource_type="mfa",
        resource_id=principal,
        is_phi=False,
        detail={"principal": principal, "recovery_codes_issued": len(codes)},
    )
    if commit:
        db.commit()
    return {"recovery_codes": codes, "confirmed_at": row.confirmed_at.isoformat()}


def verify(db, principal: str, code: str, commit: bool = True) -> bool:
    """Check a code (or a recovery code) at sign-in.

    Replay is refused: a code from a step already accepted will not be accepted
    again, so shoulder-surfing or a phished code has one shot in a 30-second
    window rather than the whole window.
    """
    principal = (principal or "").strip().lower()
    row = get_enrollment(db, principal)
    if row is None or not row.confirmed_at or row.disabled_at:
        return False

    secret = decrypt(row.secret_encrypted, aad=_AAD)
    step = totp.verify(secret, code, last_step=row.last_step)
    if step is not None:
        row.last_step = step
        row.last_used_at = _now()
        if commit:
            db.commit()
        return True

    if _consume_recovery_code(db, row, code):
        audit.record_sync(
            audit.Action.MFA_CHALLENGE_FAILED,
            db=db,
            resource_type="mfa",
            resource_id=principal,
            outcome="success",
            is_phi=False,
            detail={"principal": principal, "used": "recovery_code",
                    "remaining": _remaining_recovery_codes(row)},
        )
        if commit:
            db.commit()
        return True

    audit.record_sync(
        audit.Action.MFA_CHALLENGE_FAILED,
        db=db,
        resource_type="mfa",
        resource_id=principal,
        outcome="denied",
        is_phi=False,
        detail={"principal": principal, "stage": "login"},
    )
    if commit:
        db.commit()
    return False


def _remaining_recovery_codes(row) -> int:
    try:
        return len(json.loads(row.recovery_codes or "[]"))
    except Exception:  # noqa: BLE001
        return 0


def _consume_recovery_code(db, row, submitted: str) -> bool:
    from app.auth import verify_password

    try:
        hashes = json.loads(row.recovery_codes or "[]")
    except Exception:  # noqa: BLE001
        return False
    cleaned = (submitted or "").strip().upper()
    if not cleaned:
        return False
    for stored in list(hashes):
        if verify_password(cleaned, stored):
            hashes.remove(stored)   # single use
            row.recovery_codes = json.dumps(hashes)
            row.last_used_at = _now()
            return True
    return False


def disable(db, principal: str, *, by: str, commit: bool = True) -> bool:
    """Turn off a second factor. Recorded, because it lowers an account's protection."""
    principal = (principal or "").strip().lower()
    row = get_enrollment(db, principal)
    if row is None or row.disabled_at:
        return False
    row.disabled_at = _now()
    audit.record_sync(
        audit.Action.MFA_DISABLED,
        db=db,
        resource_type="mfa",
        resource_id=principal,
        is_phi=False,
        detail={"principal": principal, "disabled_by": by},
    )
    if commit:
        db.commit()
    return True


def status(db, principal: str) -> dict:
    row = get_enrollment(db, principal)
    return {
        "principal": principal,
        "enrolled": bool(row and row.confirmed_at and not row.disabled_at),
        "pending": bool(row and not row.confirmed_at and not row.disabled_at),
        "confirmed_at": row.confirmed_at.isoformat() if row and row.confirmed_at else None,
        "last_used_at": row.last_used_at.isoformat() if row and row.last_used_at else None,
        "recovery_codes_remaining": _remaining_recovery_codes(row) if row else 0,
        "required": settings.MFA_REQUIRED_FOR_ADMINS,
    }
