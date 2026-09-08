"""Consent capture and withdrawal, under the DPDP Act 2023.

Section 6 requires consent that is free, specific, informed, unconditional and
unambiguous, given for a stated purpose, and as easy to withdraw as to give.
Section 9 adds that a child's personal data may be processed only with
verifiable consent of a parent or lawful guardian, and forbids tracking or
behavioural monitoring of children and targeted advertising directed at them.

Every mother and child in NurtureHUB is registered in the field by a health
worker, which shapes how this is implemented:

* Consent is captured *per purpose*, not once for everything. Care delivery and
  programme analytics are different purposes and a mother can agree to the first
  without the second — which is what "specific" and "unconditional" mean.
* A child's record inherits guardian consent from the mother's registration and
  records the relationship and how it was verified, because s.9 makes the
  verification, not just the consent, the obligation.
* Withdrawal never deletes the consent record. It stamps `withdrawn_at`, so the
  register can still show that processing up to that moment had a lawful basis.
  Deletion of the *data* is a separate, separately-logged act.

`NOTICE_VERSION` is bumped whenever the notice text changes. Consent is only
meaningful against the notice the person actually saw, so the version is stored
with every record.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from app.security import audit

NOTICE_VERSION = "2026-08-v1"

# Purposes are a closed set. An open-ended "any programme use" purpose would not
# be specific, and would not survive the s.6 test.
PURPOSES = {
    "care_delivery": {
        "label": "Care and counselling",
        "description": (
            "So your health worker can record your details and your child's measurements, "
            "and give you advice about feeding and growth."
        ),
        "essential": True,   # withdrawing this ends participation in the programme
        "retention_months": 84,
        "legal_basis": "DPDP Act 2023 s.6 - consent for the stated purpose of care delivery",
    },
    "growth_monitoring": {
        "label": "Growth monitoring",
        "description": (
            "So your child's weight and height can be plotted against WHO growth standards "
            "and your health worker can be alerted if your child needs attention."
        ),
        "essential": True,
        "retention_months": 84,
        "legal_basis": "DPDP Act 2023 s.6 - consent for the stated purpose of growth monitoring",
    },
    "programme_analytics": {
        "label": "Programme reporting",
        "description": (
            "So the programme can count how many families were reached and how well it is "
            "working. Reports do not contain your name or phone number."
        ),
        "essential": False,
        "retention_months": 60,
        "legal_basis": "DPDP Act 2023 s.6 - consent for the stated purpose of programme evaluation",
    },
    "research": {
        "label": "Research",
        "description": (
            "So anonymised information can be used to study what helps mothers and children. "
            "You can say no to this and still take part in everything else."
        ),
        "essential": False,
        "retention_months": 120,
        "legal_basis": "DPDP Act 2023 s.6 - separate, optional consent for research",
    },
}

ESSENTIAL_PURPOSES = tuple(k for k, v in PURPOSES.items() if v["essential"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def grant(
    db,
    *,
    subject_type: str,
    subject_id: int,
    purpose: str,
    given_by: Optional[str] = None,
    given_by_relationship: Optional[str] = None,
    is_guardian_consent: bool = False,
    verification_method: str = "in_person",
    captured_by_user_id: Optional[int] = None,
    evidence_ref: Optional[str] = None,
    notice_language: str = "en",
    commit: bool = True,
):
    """Record consent for one purpose. Re-granting a withdrawn consent revives it."""
    from app.models_security import ConsentRecord

    if purpose not in PURPOSES:
        raise ValueError(f"Unknown consent purpose '{purpose}'")

    row = (
        db.query(ConsentRecord)
        .filter(
            ConsentRecord.subject_type == subject_type,
            ConsentRecord.subject_id == subject_id,
            ConsentRecord.purpose == purpose,
        )
        .first()
    )
    if row is None:
        row = ConsentRecord(subject_type=subject_type, subject_id=subject_id, purpose=purpose)
        db.add(row)

    row.granted = True
    row.granted_at = _now()
    row.withdrawn_at = None
    row.withdrawal_reason = None
    row.notice_version = NOTICE_VERSION
    row.notice_language = notice_language
    row.given_by = given_by
    row.given_by_relationship = given_by_relationship
    row.is_guardian_consent = is_guardian_consent
    row.verification_method = verification_method
    row.captured_by_user_id = captured_by_user_id
    row.evidence_ref = evidence_ref
    db.flush()

    audit.record(
        audit.Action.CONSENT_GRANTED,
        resource_type="consent",
        resource_id=row.id,
        subject_type=subject_type,
        subject_id=subject_id,
        is_phi=False,
        detail={
            "purpose": purpose,
            "notice_version": NOTICE_VERSION,
            "guardian_consent": is_guardian_consent,
            "verification_method": verification_method,
        },
    )
    if commit:
        db.commit()
    return row


def grant_defaults(db, *, subject_type: str, subject_id: int, captured_by_user_id=None,
                   given_by=None, is_guardian_consent=False, given_by_relationship=None,
                   verification_method="in_person", commit: bool = True) -> list:
    """Record the essential purposes at registration.

    Only the essential ones. The optional purposes must be asked separately —
    bundling them would make the consent conditional on the service, which s.6
    does not permit.
    """
    rows = [
        grant(
            db,
            subject_type=subject_type,
            subject_id=subject_id,
            purpose=purpose,
            captured_by_user_id=captured_by_user_id,
            given_by=given_by,
            given_by_relationship=given_by_relationship,
            is_guardian_consent=is_guardian_consent,
            verification_method=verification_method,
            commit=False,
        )
        for purpose in ESSENTIAL_PURPOSES
    ]
    if commit:
        db.commit()
    return rows


def _fetch(db, subject_type: str, subject_id: int) -> list:
    from app.models_security import ConsentRecord

    return (
        db.query(ConsentRecord)
        .filter(
            ConsentRecord.subject_type == subject_type,
            ConsentRecord.subject_id == subject_id,
        )
        .all()
    )


def withdraw(db, *, subject_type: str, subject_id: int, purpose: str,
             reason: Optional[str] = None, commit: bool = True):
    """Withdraw consent for one purpose.

    s.6(6) makes withdrawal as easy as giving; s.8(7) then requires erasure once
    the purpose no longer holds. Withdrawing an essential purpose therefore ends
    participation, and the return value says so, so the caller can tell the
    person that plainly rather than silently degrading their record.
    """
    from app.models_security import ConsentRecord

    row = (
        db.query(ConsentRecord)
        .filter(
            ConsentRecord.subject_type == subject_type,
            ConsentRecord.subject_id == subject_id,
            ConsentRecord.purpose == purpose,
        )
        .first()
    )
    if row is None or row.withdrawn_at is not None:
        return None
    row.granted = False
    row.withdrawn_at = _now()
    row.withdrawal_reason = reason
    db.flush()

    audit.record_sync(
        audit.Action.CONSENT_WITHDRAWN,
        db=db,
        resource_type="consent",
        resource_id=row.id,
        subject_type=subject_type,
        subject_id=subject_id,
        is_phi=False,
        detail={
            "purpose": purpose,
            "essential": PURPOSES.get(purpose, {}).get("essential", False),
            "reason": reason,
        },
    )
    if commit:
        db.commit()
    return row


def has_consent(db, subject_type: str, subject_id: int, purpose: str) -> bool:
    from app.models_security import ConsentRecord

    row = (
        db.query(ConsentRecord)
        .filter(
            ConsentRecord.subject_type == subject_type,
            ConsentRecord.subject_id == subject_id,
            ConsentRecord.purpose == purpose,
            ConsentRecord.granted.is_(True),
            ConsentRecord.withdrawn_at.is_(None),
        )
        .first()
    )
    return row is not None


def status(db, subject_type: str, subject_id: int) -> dict:
    """Everything the register knows about one data principal's consents."""
    rows = _fetch(db, subject_type, subject_id)
    by_purpose = {row.purpose: row for row in rows}
    return {
        "subject_type": subject_type,
        "subject_id": subject_id,
        "notice_version": NOTICE_VERSION,
        "purposes": [
            {
                "purpose": key,
                "label": spec["label"],
                "description": spec["description"],
                "essential": spec["essential"],
                "legal_basis": spec["legal_basis"],
                "granted": bool(
                    by_purpose.get(key)
                    and by_purpose[key].granted
                    and by_purpose[key].withdrawn_at is None
                ),
                "granted_at": (
                    by_purpose[key].granted_at.isoformat()
                    if by_purpose.get(key) and by_purpose[key].granted_at
                    else None
                ),
                "withdrawn_at": (
                    by_purpose[key].withdrawn_at.isoformat()
                    if by_purpose.get(key) and by_purpose[key].withdrawn_at
                    else None
                ),
                "notice_version": by_purpose[key].notice_version if by_purpose.get(key) else None,
                "guardian_consent": bool(
                    by_purpose.get(key) and by_purpose[key].is_guardian_consent
                ),
                "verification_method": (
                    by_purpose[key].verification_method if by_purpose.get(key) else None
                ),
            }
            for key, spec in PURPOSES.items()
        ],
    }


def missing_essential(db, subject_type: str, subject_id: int) -> list:
    """Essential purposes with no live consent — the register's gap list."""
    return [p for p in ESSENTIAL_PURPOSES if not has_consent(db, subject_type, subject_id, p)]


def notice_text(language: str = "en") -> dict:
    """The notice a data principal is shown before consenting (s.5).

    Kept here beside the purposes so the two cannot drift apart: a notice that
    describes purposes the system does not actually use, or omits ones it does,
    is worse than no notice.
    """
    from app.config import settings

    return {
        "version": NOTICE_VERSION,
        "language": language,
        "collector": settings.ORG_LEGAL_NAME,
        "contact": {"officer": settings.DPO_NAME, "email": settings.DPO_EMAIL, "phone": settings.DPO_PHONE},
        "purposes": [
            {"purpose": k, "label": v["label"], "description": v["description"], "essential": v["essential"]}
            for k, v in PURPOSES.items()
        ],
        "rights": [
            "You can ask what information we hold about you and your child.",
            "You can ask us to correct anything that is wrong.",
            "You can ask us to delete your information, and withdraw your consent at any time.",
            "You can nominate someone to act for you if you are unable to.",
            "You can complain to us first, and then to the Data Protection Board of India.",
        ],
        "children": (
            "Information about a child is collected only with the consent of a parent or "
            "guardian. We do not track children or use their information to advertise to them."
        ),
        "sharing": (
            "Information is shared with the health department for the running of the programme. "
            "Reports and research use information that does not identify you."
        ),
        "how_to_exercise": (
            f"Speak to your health worker, or contact {settings.DPO_EMAIL}."
        ),
    }
