"""Detection rules over the audit trail.

The audit trail answers questions after the fact. These rules are what turn it
into something that notices at the time — which matters because both statutory
clocks that apply here start at *awareness*: six hours to CERT-In, and the DPDP
intimation to affected Data Principals and the Board. A breach nobody noticed
for a month is not a smaller problem, it is a larger one.

The rules look for the shapes that real misuse of a health record system takes:

  bulk_phi_read        one account reading far more patients than a caseload
  bulk_export          a large export of identified records
  off_hours_access     patient records opened outside working hours
  new_admin_location   an administrator acting from an address never seen before
  denied_access_burst  repeated refusals, i.e. someone probing for records
                       belonging to other health workers
  mass_erasure         a large deletion, whether malicious or mistaken
  audit_integrity      the trail itself failed verification

Every rule is a *signal*, not a verdict. A supervisor legitimately reviewing a
block's caseload before a meeting will trip `bulk_phi_read`, and that is the
correct behaviour: it is recorded, a human confirms it was expected, and the
dismissal is itself logged. Rules that block on their own would be turned off
within a week, which is the actual failure mode of most such systems.

Thresholds live in settings so they can be tuned to the deployment's real
caseload rather than guessed here.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config import settings
from app.security import audit


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _local_hour(moment: datetime) -> int:
    """Hour of day in the deployment's own timezone (IST by default)."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    shifted = moment + timedelta(minutes=settings.SECURITY_TZ_OFFSET_MINUTES)
    return shifted.hour


def raise_alert(
    db,
    *,
    rule: str,
    severity: str,
    title: str,
    description: str = "",
    actor_label: Optional[str] = None,
    source_ip: Optional[str] = None,
    evidence: Optional[dict] = None,
    audit_event_ids: Optional[list] = None,
    dedupe_minutes: Optional[int] = None,
    commit: bool = True,
):
    """Create an alert unless an identical one is already open in the dedupe window.

    Deduplication is what keeps this usable. Without it, one long export session
    produces a hundred alerts and the operator learns to ignore the list — the
    single most common way a detection system stops working.
    """
    from app.models_security import SecurityAlert

    window = dedupe_minutes if dedupe_minutes is not None else settings.ALERT_DEDUPE_MINUTES
    if window > 0:
        query = db.query(SecurityAlert).filter(
            SecurityAlert.rule == rule,
            SecurityAlert.raised_at >= _now() - timedelta(minutes=window),
            SecurityAlert.status.in_(("open", "investigating")),
        )
        query = (
            query.filter(SecurityAlert.actor_label == actor_label)
            if actor_label
            else query.filter(SecurityAlert.actor_label.is_(None))
        )
        existing = query.first()
        if existing:
            # Fold the new evidence into the open alert rather than adding noise.
            try:
                merged = json.loads(existing.evidence) if existing.evidence else {}
                merged["occurrences"] = int(merged.get("occurrences", 1)) + 1
                merged["last_seen"] = _now().isoformat()
                if evidence:
                    merged["latest"] = evidence
                existing.evidence = json.dumps(merged, default=str)
            except Exception:  # noqa: BLE001
                pass
            if commit:
                db.commit()
            return existing

    alert = SecurityAlert(
        rule=rule,
        severity=severity,
        title=title[:255],
        description=description or None,
        actor_label=actor_label,
        source_ip=source_ip,
        evidence=json.dumps({**(evidence or {}), "occurrences": 1}, default=str),
        audit_event_ids=json.dumps(audit_event_ids) if audit_event_ids else None,
    )
    db.add(alert)
    db.flush()
    audit.record_sync(
        audit.Action.ALERT_RAISED,
        db=db,
        resource_type="security_alert",
        resource_id=alert.id,
        outcome="success",
        actor_override={"actor_type": "system", "actor_label": f"rule:{rule}"},
        detail={"rule": rule, "severity": severity, "title": title, "actor": actor_label},
    )
    if commit:
        db.commit()
    return alert


# ─────────────────────────────────────────────────────────────────────────────
# Rules
# ─────────────────────────────────────────────────────────────────────────────


def _window_start(minutes: int) -> datetime:
    return _now() - timedelta(minutes=minutes)


def check_bulk_phi_read(db) -> int:
    """One account touching far more patient records than a caseload explains."""
    from sqlalchemy import func as sql_func

    from app.models_security import AuditEvent

    since = _window_start(settings.BULK_READ_WINDOW_MINUTES)
    rows = (
        db.query(
            AuditEvent.actor_label,
            sql_func.count(sql_func.distinct(AuditEvent.subject_id)).label("subjects"),
            sql_func.sum(AuditEvent.record_count).label("records"),
        )
        .filter(
            AuditEvent.is_phi.is_(True),
            AuditEvent.occurred_at >= since,
            AuditEvent.outcome == "success",
            AuditEvent.action.in_((audit.Action.PHI_READ, audit.Action.PHI_LIST)),
            AuditEvent.actor_label.isnot(None),
        )
        .group_by(AuditEvent.actor_label)
        .having(sql_func.count(sql_func.distinct(AuditEvent.subject_id)) >= settings.BULK_READ_SUBJECT_THRESHOLD)
        .all()
    )
    for actor, subjects, records in rows:
        raise_alert(
            db,
            rule="bulk_phi_read",
            severity="high" if subjects >= settings.BULK_READ_SUBJECT_THRESHOLD * 3 else "medium",
            title=f"{actor} opened {subjects} patient records in {settings.BULK_READ_WINDOW_MINUTES} minutes",
            description=(
                "Volume well above a normal caseload. Expected for a supervisor doing a "
                "review; worth confirming that is what happened."
            ),
            actor_label=actor,
            evidence={
                "distinct_subjects": int(subjects or 0),
                "records": int(records or 0),
                "window_minutes": settings.BULK_READ_WINDOW_MINUTES,
            },
            commit=False,
        )
    return len(rows)


def check_bulk_export(db) -> int:
    """A single export carrying a large number of identified records."""
    from app.models_security import AuditEvent

    since = _window_start(settings.BULK_READ_WINDOW_MINUTES)
    rows = (
        db.query(AuditEvent)
        .filter(
            AuditEvent.action == audit.Action.PHI_EXPORT,
            AuditEvent.occurred_at >= since,
            AuditEvent.record_count >= settings.EXPORT_RECORD_THRESHOLD,
        )
        .all()
    )
    for row in rows:
        raise_alert(
            db,
            rule="bulk_export",
            severity="high",
            title=f"{row.actor_label or 'Someone'} exported {row.record_count} patient records",
            description=(
                "Exports leave the system's custody the moment the file is downloaded. Under "
                "the MOU, data in an exported file is in the custody of whoever holds the file."
            ),
            actor_label=row.actor_label,
            source_ip=row.source_ip,
            evidence={"records": row.record_count, "path": row.path, "audit_event_id": row.id},
            audit_event_ids=[row.id],
            commit=False,
        )
    return len(rows)


def check_off_hours(db) -> int:
    """Patient records opened outside the working day."""
    from sqlalchemy import func as sql_func

    from app.models_security import AuditEvent

    since = _window_start(settings.OFF_HOURS_WINDOW_MINUTES)
    rows = (
        db.query(
            AuditEvent.actor_label,
            sql_func.count(AuditEvent.id).label("events"),
            sql_func.min(AuditEvent.occurred_at).label("first"),
            sql_func.max(AuditEvent.occurred_at).label("last"),
        )
        .filter(
            AuditEvent.is_phi.is_(True),
            AuditEvent.occurred_at >= since,
            AuditEvent.outcome == "success",
            AuditEvent.actor_label.isnot(None),
        )
        .group_by(AuditEvent.actor_label)
        .all()
    )
    raised = 0
    for actor, events, first, last in rows:
        if events < settings.OFF_HOURS_EVENT_THRESHOLD:
            continue
        hour = _local_hour(last)
        if settings.WORK_HOURS_START <= hour < settings.WORK_HOURS_END:
            continue
        raise_alert(
            db,
            rule="off_hours_access",
            severity="medium",
            title=f"{actor} accessed patient records at {hour:02d}:00 local time",
            description=(
                f"{events} patient-record accesses outside the configured working window "
                f"({settings.WORK_HOURS_START:02d}:00-{settings.WORK_HOURS_END:02d}:00)."
            ),
            actor_label=actor,
            evidence={
                "events": int(events or 0),
                "local_hour": hour,
                "first": first.isoformat() if first else None,
                "last": last.isoformat() if last else None,
            },
            dedupe_minutes=360,
            commit=False,
        )
        raised += 1
    return raised


def check_new_admin_location(db) -> int:
    """An administrator acting from an address not seen for them before.

    The baseline is the audit trail itself: every address that principal has
    used before this window. New address plus administrative privilege is the
    classic first visible sign of a stolen admin credential.
    """
    from app.models_security import AuditEvent

    since = _window_start(settings.NEW_LOCATION_WINDOW_MINUTES)
    recent = (
        db.query(AuditEvent.actor_label, AuditEvent.source_ip)
        .filter(
            AuditEvent.actor_type == "admin",
            AuditEvent.occurred_at >= since,
            AuditEvent.source_ip.isnot(None),
            AuditEvent.actor_label.isnot(None),
        )
        .distinct()
        .all()
    )
    raised = 0
    for actor, ip in recent:
        seen_before = (
            db.query(AuditEvent.id)
            .filter(
                AuditEvent.actor_label == actor,
                AuditEvent.source_ip == ip,
                AuditEvent.occurred_at < since,
            )
            .first()
        )
        if seen_before:
            continue
        # A brand-new administrator has no history at all; that is a first
        # sign-in, not an anomaly.
        has_history = (
            db.query(AuditEvent.id)
            .filter(AuditEvent.actor_label == actor, AuditEvent.occurred_at < since)
            .first()
        )
        if not has_history:
            continue
        raise_alert(
            db,
            rule="new_admin_location",
            severity="high",
            title=f"Administrator {actor} is acting from a new address ({ip})",
            description=(
                "This administrator has never used this network address before. Confirm it is "
                "them; if not, revoke their sessions and force a password reset."
            ),
            actor_label=actor,
            source_ip=ip,
            evidence={"new_source_ip": ip},
            dedupe_minutes=1440,
            commit=False,
        )
        raised += 1
    return raised


def check_denied_burst(db) -> int:
    """Repeated refusals — someone walking record ids that are not theirs."""
    from sqlalchemy import func as sql_func

    from app.models_security import AuditEvent

    since = _window_start(settings.DENIED_WINDOW_MINUTES)
    rows = (
        db.query(AuditEvent.actor_label, sql_func.count(AuditEvent.id).label("denials"))
        .filter(
            AuditEvent.occurred_at >= since,
            AuditEvent.outcome == "denied",
        )
        .group_by(AuditEvent.actor_label)
        .having(sql_func.count(AuditEvent.id) >= settings.DENIED_THRESHOLD)
        .all()
    )
    for actor, denials in rows:
        raise_alert(
            db,
            rule="denied_access_burst",
            severity="high",
            title=f"{actor or 'An unauthenticated caller'} was refused {denials} times",
            description=(
                "Repeated authorisation failures in a short window. Consistent with probing "
                "for records belonging to other health workers."
            ),
            actor_label=actor,
            evidence={"denials": int(denials or 0), "window_minutes": settings.DENIED_WINDOW_MINUTES},
            commit=False,
        )
    return len(rows)


def check_mass_erasure(db) -> int:
    from app.models_security import AuditEvent

    since = _window_start(settings.BULK_READ_WINDOW_MINUTES)
    rows = (
        db.query(AuditEvent)
        .filter(
            AuditEvent.action.in_((audit.Action.PHI_DELETE, audit.Action.ERASURE)),
            AuditEvent.occurred_at >= since,
            AuditEvent.record_count >= settings.ERASURE_THRESHOLD,
        )
        .all()
    )
    for row in rows:
        raise_alert(
            db,
            rule="mass_erasure",
            severity="critical",
            title=f"{row.record_count} patient records were deleted",
            description="Large deletion of patient data. Confirm this was an authorised retention or erasure action.",
            actor_label=row.actor_label,
            source_ip=row.source_ip,
            evidence={"records": row.record_count, "action": row.action, "audit_event_id": row.id},
            audit_event_ids=[row.id],
            commit=False,
        )
    return len(rows)


def check_audit_integrity(db) -> int:
    """Verify the trail and alert loudly if it does not hold.

    A failure here is the most serious signal the system can produce: it means
    either the database was written to outside the application, or the audit key
    changed. Both are incidents in their own right.
    """
    result = audit.verify_all(db, limit_per_chain=20000)
    if result["valid"]:
        return 0
    broken = [c for c in result["chains"] if not c["valid"]]
    raise_alert(
        db,
        rule="audit_integrity",
        severity="critical",
        title="The audit trail failed integrity verification",
        description=(
            "One or more audit chains no longer verify against their message authentication "
            "codes. Either audit rows were altered or removed outside the application, or the "
            "audit key was changed. Treat as an incident until explained."
        ),
        evidence={
            "broken_chains": [c["chain_key"] for c in broken][:20],
            "anchor_issues": result["anchors"].get("issues", [])[:10],
            "total_events": result["total_events"],
        },
        dedupe_minutes=60,
        commit=False,
    )
    return 1


RULES = (
    ("bulk_phi_read", check_bulk_phi_read),
    ("bulk_export", check_bulk_export),
    ("off_hours_access", check_off_hours),
    ("new_admin_location", check_new_admin_location),
    ("denied_access_burst", check_denied_burst),
    ("mass_erasure", check_mass_erasure),
    ("audit_integrity", check_audit_integrity),
)


def run_detections(db) -> dict:
    """Run every rule once. Called on a timer by the security sweeper."""
    results = {}
    for name, rule in RULES:
        try:
            results[name] = rule(db)
        except Exception as exc:  # noqa: BLE001 — one broken rule must not stop the rest
            db.rollback()
            results[name] = f"error: {exc}"
    try:
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
    return results
