"""Retention and erasure.

Two obligations pull in opposite directions and both have to be met:

* **Keep.** The CERT-In Directions of 28 April 2022 require logs to be retained
  for a rolling **180 days** and maintained within Indian jurisdiction. Losing
  the audit trail early would also destroy the evidence the MOU's
  fault-and-control determination depends on.
* **Delete.** DPDP Act 2023 s.8(7) requires personal data to be erased once the
  data principal withdraws consent or the purpose is no longer being served,
  unless retention is required by law.

So the sweeper is conservative in different directions for different data.
Operational logs expire on a schedule. Patient records never delete themselves:
the default action for anything about a mother or a child is `review`, which
surfaces the record for a human decision. A programme whose retention job
silently deleted a child's growth history because a date passed would be a worse
failure than keeping it a year too long.

Every deletion writes an `ErasureRecord` — identifiers, counts and a digest, but
not the data. Once the obligation is to prove deletion happened, keeping a copy
of what was deleted defeats the purpose.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config import settings
from app.security import audit

# Floor for anything log-shaped, from the CERT-In Directions. The sweeper
# refuses to configure a shorter window for these.
CERT_IN_LOG_FLOOR_DAYS = 180

DEFAULT_POLICIES = (
    {
        "key": "audit_events",
        "label": "Audit trail",
        "description": (
            "Every recorded access to patient data. Must outlive the CERT-In 180-day floor "
            "and any investigation window under the MOU."
        ),
        "retention_days": 400,
        "action": "delete",
        "legal_basis": "CERT-In Directions 28.04.2022 (180-day minimum); MOU evidence retention",
    },
    {
        "key": "login_attempts",
        "label": "Authentication attempts",
        "description": "Successful and failed sign-ins, used for lockout and brute-force detection.",
        "retention_days": 400,
        "action": "delete",
        "legal_basis": "CERT-In Directions 28.04.2022 (180-day minimum)",
    },
    {
        "key": "auth_sessions",
        "label": "Expired sessions",
        "description": "Session rows whose tokens expired long ago. The audit trail keeps the history.",
        "retention_days": 90,
        "action": "delete",
        "legal_basis": "Data minimisation - the audit trail is the durable record",
    },
    {
        "key": "security_alerts",
        "label": "Closed security alerts",
        "description": "Alerts that were dismissed or resolved and are not attached to an incident.",
        "retention_days": 730,
        "action": "delete",
        "legal_basis": "Operational retention",
    },
    {
        "key": "notifications",
        "label": "In-app notifications",
        "description": "Read notifications delivered to learners.",
        "retention_days": 365,
        "action": "delete",
        "legal_basis": "Data minimisation",
    },
    {
        "key": "activity_events",
        "label": "Live test monitoring events",
        "description": "Per-keystroke activity captured during live-monitored tests.",
        "retention_days": 180,
        "action": "delete",
        "legal_basis": "Purpose served once the test is assessed",
    },
    {
        "key": "pipeline_runs",
        "label": "Analytics pipeline runs",
        "description": "Workspaces and outputs of crosstabs/MASD runs.",
        "retention_days": 365,
        "action": "review",
        "legal_basis": "Programme reporting",
    },
    {
        "key": "mother_records",
        "label": "Mother registrations",
        "description": (
            "Identified maternal records. Never auto-deleted: flagged for a human decision "
            "once the retention period elapses."
        ),
        "retention_days": 2555,   # 7 years
        "action": "review",
        "legal_basis": "DPDP Act 2023 s.8(7); programme and public-health record-keeping",
    },
    {
        "key": "child_records",
        "label": "Child registrations and growth history",
        "description": (
            "Identified child records, including growth measurements. Never auto-deleted: "
            "a child's growth history has clinical value for years."
        ),
        "retention_days": 2555,
        "action": "review",
        "legal_basis": "DPDP Act 2023 s.8(7); paediatric record-keeping",
    },
    {
        "key": "withdrawn_consent",
        "label": "Records whose consent was withdrawn",
        "description": (
            "Data principals who withdrew an essential consent. s.8(7) requires erasure once "
            "the purpose no longer holds; surfaced for confirmation, not deleted automatically."
        ),
        "retention_days": 30,
        "action": "review",
        "legal_basis": "DPDP Act 2023 s.8(7) - erasure on withdrawal of consent",
    },
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_policies(db, commit: bool = True) -> int:
    """Seed any missing policy rows. Existing rows are never overwritten —
    an operator's tuning must survive a redeploy."""
    from app.models_security import RetentionPolicy

    existing = {row[0] for row in db.query(RetentionPolicy.key).all()}
    created = 0
    for spec in DEFAULT_POLICIES:
        if spec["key"] in existing:
            continue
        db.add(
            RetentionPolicy(
                key=spec["key"],
                label=spec["label"],
                description=spec["description"],
                retention_days=spec["retention_days"],
                action=spec["action"],
                legal_basis=spec["legal_basis"],
                enabled=True,
            )
        )
        created += 1
    if created and commit:
        db.commit()
    return created


def _digest(rows) -> str:
    """Stable digest of what was removed, so deletion is provable without a copy."""
    hasher = hashlib.sha256()
    for row in rows:
        hasher.update(str(row).encode("utf-8"))
    return hasher.hexdigest()


def _record_erasure(db, *, trigger: str, scope: dict, rows_deleted: int,
                    subject_type=None, subject_id=None, subject_uid=None,
                    performed_by=None, digest=None, note=None, method="hard_delete"):
    from app.models_security import ErasureRecord

    db.add(
        ErasureRecord(
            trigger=trigger,
            subject_type=subject_type,
            subject_id=subject_id,
            subject_uid=subject_uid,
            scope=json.dumps(scope, default=str),
            rows_deleted=rows_deleted,
            method=method,
            content_digest=digest,
            performed_by=performed_by,
            note=note,
        )
    )


# ─────────────────────────────────────────────────────────────────────────────
# Sweeps
# ─────────────────────────────────────────────────────────────────────────────


def _sweep_audit_events(db, cutoff, dry_run: bool) -> dict:
    from app.models_security import AuditAnchor, AuditEvent

    query = db.query(AuditEvent).filter(AuditEvent.occurred_at < cutoff)
    count = query.count()
    if dry_run or not count:
        return {"candidates": count, "deleted": 0}
    # Anchors covering pruned events would fail verification for a reason that
    # is not tampering, so they are pruned in step with the events they notarise.
    oldest_kept = (
        db.query(AuditEvent.id)
        .filter(AuditEvent.occurred_at >= cutoff)
        .order_by(AuditEvent.id.asc())
        .first()
    )
    boundary = oldest_kept[0] if oldest_kept else None
    deleted = query.delete(synchronize_session=False)
    if boundary is not None:
        db.query(AuditAnchor).filter(AuditAnchor.last_event_id < boundary).delete(
            synchronize_session=False
        )
    return {"candidates": count, "deleted": deleted}


def _sweep_simple(db, model, column, cutoff, dry_run: bool, extra_filter=None) -> dict:
    query = db.query(model).filter(column < cutoff)
    if extra_filter is not None:
        query = query.filter(extra_filter)
    count = query.count()
    if dry_run or not count:
        return {"candidates": count, "deleted": 0}
    deleted = query.delete(synchronize_session=False)
    return {"candidates": count, "deleted": deleted}


def _review_mothers(db, cutoff, dry_run: bool) -> dict:
    from app.models import Mother

    rows = db.query(Mother.id, Mother.mother_uid).filter(Mother.created_at < cutoff).limit(500).all()
    return {
        "candidates": len(rows),
        "deleted": 0,
        "action": "review",
        "sample": [{"id": r[0], "uid": r[1]} for r in rows[:25]],
    }


def _review_children(db, cutoff, dry_run: bool) -> dict:
    from app.models import Child

    rows = db.query(Child.id, Child.child_uid).filter(Child.created_at < cutoff).limit(500).all()
    return {
        "candidates": len(rows),
        "deleted": 0,
        "action": "review",
        "sample": [{"id": r[0], "uid": r[1]} for r in rows[:25]],
    }


def _review_withdrawn(db, cutoff, dry_run: bool) -> dict:
    """Data principals who withdrew an essential consent more than the grace period ago."""
    from app.models_security import ConsentRecord
    from app.security.consent import ESSENTIAL_PURPOSES

    rows = (
        db.query(ConsentRecord)
        .filter(
            ConsentRecord.withdrawn_at.isnot(None),
            ConsentRecord.withdrawn_at < cutoff,
            ConsentRecord.purpose.in_(ESSENTIAL_PURPOSES),
        )
        .limit(500)
        .all()
    )
    return {
        "candidates": len(rows),
        "deleted": 0,
        "action": "review",
        "sample": [
            {
                "subject_type": r.subject_type,
                "subject_id": r.subject_id,
                "purpose": r.purpose,
                "withdrawn_at": r.withdrawn_at.isoformat() if r.withdrawn_at else None,
            }
            for r in rows[:25]
        ],
    }


def _handlers():
    from app.models import Notification, PipelineRun
    from app.models_live import ActivityEvent
    from app.models_security import AuthSession, LoginAttempt, SecurityAlert

    return {
        "audit_events": lambda db, cutoff, dry: _sweep_audit_events(db, cutoff, dry),
        "login_attempts": lambda db, cutoff, dry: _sweep_simple(
            db, LoginAttempt, LoginAttempt.attempted_at, cutoff, dry
        ),
        "auth_sessions": lambda db, cutoff, dry: _sweep_simple(
            db, AuthSession, AuthSession.expires_at, cutoff, dry
        ),
        "security_alerts": lambda db, cutoff, dry: _sweep_simple(
            db, SecurityAlert, SecurityAlert.raised_at, cutoff, dry,
            extra_filter=(SecurityAlert.status == "dismissed") & (SecurityAlert.incident_id.is_(None)),
        ),
        "notifications": lambda db, cutoff, dry: _sweep_simple(
            db, Notification, Notification.created_at, cutoff, dry,
            extra_filter=Notification.is_read.is_(True),
        ),
        "activity_events": lambda db, cutoff, dry: _sweep_simple(
            db, ActivityEvent, ActivityEvent.timestamp, cutoff, dry
        ),
        "pipeline_runs": lambda db, cutoff, dry: {
            "candidates": db.query(PipelineRun).filter(PipelineRun.created_at < cutoff).count(),
            "deleted": 0,
            "action": "review",
        },
        "mother_records": _review_mothers,
        "child_records": _review_children,
        "withdrawn_consent": _review_withdrawn,
    }


def run(db, *, dry_run: bool = True, performed_by: Optional[str] = None,
        only: Optional[str] = None) -> dict:
    """Apply every enabled policy. Defaults to a dry run — deleting patient-adjacent
    data is not something a scheduled job should do without someone having looked."""
    from app.models_security import RetentionPolicy

    ensure_policies(db, commit=False)
    handlers = _handlers()
    policies = db.query(RetentionPolicy).filter(RetentionPolicy.enabled.is_(True)).all()
    results = {}
    total_deleted = 0

    for policy in policies:
        if only and policy.key != only:
            continue
        handler = handlers.get(policy.key)
        if handler is None:
            results[policy.key] = {"error": "no handler registered"}
            continue

        days = policy.retention_days
        if policy.key in ("audit_events", "login_attempts") and days < CERT_IN_LOG_FLOOR_DAYS:
            results[policy.key] = {
                "error": (
                    f"retention_days={days} is below the {CERT_IN_LOG_FLOOR_DAYS}-day CERT-In "
                    "log-retention floor; refusing to run"
                )
            }
            continue

        cutoff = _now() - timedelta(days=days)
        try:
            outcome = handler(db, cutoff, dry_run or policy.action == "review")
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            results[policy.key] = {"error": str(exc)}
            continue

        outcome.setdefault("action", policy.action)
        outcome["retention_days"] = days
        outcome["cutoff"] = cutoff.isoformat()
        results[policy.key] = outcome
        deleted = int(outcome.get("deleted") or 0)
        total_deleted += deleted

        if not dry_run:
            policy.last_run_at = _now()
            policy.last_run_rows = deleted
            if deleted:
                _record_erasure(
                    db,
                    trigger="retention",
                    scope={policy.key: deleted},
                    rows_deleted=deleted,
                    performed_by=performed_by or "retention-sweeper",
                    note=f"Retention policy '{policy.key}' ({days} days)",
                )

    audit.record_sync(
        audit.Action.RETENTION_RUN,
        db=db,
        resource_type="retention",
        record_count=total_deleted,
        is_phi=False,
        actor_override=(
            None if performed_by else {"actor_type": "system", "actor_label": "retention-sweeper"}
        ),
        detail={"dry_run": dry_run, "total_deleted": total_deleted, "policies": list(results)},
    )
    db.commit()
    return {"dry_run": dry_run, "total_deleted": total_deleted, "policies": results}


# ─────────────────────────────────────────────────────────────────────────────
# Targeted erasure (a data-principal request)
# ─────────────────────────────────────────────────────────────────────────────


def erase_mother(db, mother_id: int, *, performed_by: str, request_id: Optional[int] = None,
                 method: str = "hard_delete", note: Optional[str] = None) -> dict:
    """Erase a mother and everything cascading from her, and prove it happened.

    `hard_delete` removes the rows. `anonymise` keeps the clinical measurements
    — which have programme value with no person attached — and destroys every
    identifier, which is the option to reach for when the purpose that justified
    the identifiers has ended but the aggregate has not.
    """
    from app.models import Child, Mother
    from app.models_security import ConsentRecord

    mother = db.query(Mother).filter(Mother.id == mother_id).first()
    if mother is None:
        return {"found": False}

    children = db.query(Child).filter(Child.mother_id == mother.id).all()
    child_ids = [c.id for c in children]
    fingerprint = _digest(
        [mother.mother_uid, mother.mother_name, mother.mobile, mother.email]
        + [c.child_uid for c in children]
    )
    scope = {"mothers": 1, "children": len(children)}

    if method == "anonymise":
        mother.mother_name = f"[erased-{mother.id}]"
        mother.mobile = None
        mother.alternate_mobile = None
        mother.email = None
        mother.mother_dob = None
        mother.village = None
        for child in children:
            child.child_name = f"[erased-{child.id}]"
            child.dob = None
        rows = 1 + len(children)
    else:
        db.query(ConsentRecord).filter(
            ConsentRecord.subject_type == "child", ConsentRecord.subject_id.in_(child_ids or [-1])
        ).delete(synchronize_session=False)
        db.query(ConsentRecord).filter(
            ConsentRecord.subject_type == "mother", ConsentRecord.subject_id == mother.id
        ).delete(synchronize_session=False)
        db.delete(mother)   # children cascade
        rows = 1 + len(children)

    _record_erasure(
        db,
        trigger="dsr" if request_id else "manual",
        scope=scope,
        rows_deleted=rows,
        subject_type="mother",
        subject_id=mother_id,
        subject_uid=mother.mother_uid,
        performed_by=performed_by,
        digest=fingerprint,
        method=method,
        note=note,
    )
    audit.record_sync(
        audit.Action.ERASURE,
        db=db,
        resource_type="mother",
        resource_id=mother_id,
        subject_type="mother",
        subject_id=mother_id,
        record_count=rows,
        is_phi=True,
        detail={"method": method, "children": len(children), "request_id": request_id},
    )
    db.commit()
    return {"found": True, "rows": rows, "children": len(children), "method": method,
            "digest": fingerprint}
