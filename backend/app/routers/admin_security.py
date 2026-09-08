"""Data-protection console API.

Everything the platform needs in order to *answer for* the patient data it
holds, rather than merely hold it:

  /overview        one screen an administrator can be asked to show a regulator
  /audit           who touched which record, searchable, plus chain verification
  /alerts          what the detection rules noticed, and what was done about it
  /incidents       the breach register, its statutory clocks, and the custody
                   determination the MOU clause requires
  /containment     end one session, one account's sessions, or all of them
  /sessions        what is currently signed in
  /mfa             second factor for administrator accounts
  /retention       the schedule, and the sweeper
  /ropa            what data is held, why, on what basis, for how long
  /consent         a data principal's consents
  /requests        access / correction / erasure / grievance, with due dates

Two routes are deliberately public and unauthenticated: the privacy notice and
the grievance intake. The DPDP Act gives people the right to know what is held
about them and a route to complain, and putting either behind a login makes the
right theoretical for exactly the people most likely to need it.
"""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import case
from sqlalchemy import func as sql_func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_admin_email, get_current_admin
from app.rate_limit import limiter, principal_key
from app.security import audit, consent, incidents, lockout, mfa, sessions
from app.security import retention as retention_module
from app.security.crypto import active_key_version, decryption_failure_counts, encryption_enabled, key_versions
from app.models_security import (
    AccountLockout,
    AuditEvent,
    AuthSession,
    BreachIncident,
    BreachNotification,
    ConsentRecord,
    DataSubjectRequest,
    ErasureRecord,
    ProcessingActivity,
    RetentionPolicy,
    SecurityAlert,
)

router = APIRouter(
    prefix="/api/admin/security",
    tags=["admin-security"],
    dependencies=[Depends(get_current_admin)],
)

public_router = APIRouter(prefix="/api/privacy", tags=["privacy"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _loads(value, default=None):
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


# ═════════════════════════════════════════════════════════════════════════════
# Overview
# ═════════════════════════════════════════════════════════════════════════════


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    """The compliance posture in one payload.

    Written to be showable as-is: it reports what is actually configured and
    what the trail actually contains, not what the deployment intends.
    """
    day_ago = _now() - timedelta(days=1)
    week_ago = _now() - timedelta(days=7)

    phi_reads_24h = (
        db.query(sql_func.count(AuditEvent.id))
        .filter(AuditEvent.is_phi.is_(True), AuditEvent.occurred_at >= day_ago)
        .scalar()
        or 0
    )
    denials_24h = (
        db.query(sql_func.count(AuditEvent.id))
        .filter(AuditEvent.outcome == "denied", AuditEvent.occurred_at >= day_ago)
        .scalar()
        or 0
    )
    exports_7d = (
        db.query(sql_func.coalesce(sql_func.sum(AuditEvent.record_count), 0))
        .filter(AuditEvent.action == audit.Action.PHI_EXPORT, AuditEvent.occurred_at >= week_ago)
        .scalar()
        or 0
    )
    total_events = db.query(sql_func.count(AuditEvent.id)).scalar() or 0
    oldest = db.query(sql_func.min(AuditEvent.occurred_at)).scalar()

    open_alerts = (
        db.query(SecurityAlert.severity, sql_func.count(SecurityAlert.id))
        .filter(SecurityAlert.status.in_(("open", "investigating")))
        .group_by(SecurityAlert.severity)
        .all()
    )
    open_incidents = (
        db.query(sql_func.count(BreachIncident.id))
        .filter(BreachIncident.status.in_(("open", "contained")))
        .scalar()
        or 0
    )
    obligations = incidents.open_obligations(db)
    overdue = [o for o in obligations if o["deadline"]["state"] == "overdue"]
    due_soon = [o for o in obligations if o["deadline"]["state"] == "due_soon"]

    overdue_requests = (
        db.query(sql_func.count(DataSubjectRequest.id))
        .filter(
            DataSubjectRequest.closed_at.is_(None),
            DataSubjectRequest.due_at < _now(),
        )
        .scalar()
        or 0
    )
    open_requests = (
        db.query(sql_func.count(DataSubjectRequest.id))
        .filter(DataSubjectRequest.closed_at.is_(None))
        .scalar()
        or 0
    )

    live_sessions = (
        db.query(sql_func.count(AuthSession.id))
        .filter(AuthSession.revoked_at.is_(None), AuthSession.expires_at > _now())
        .scalar()
        or 0
    )
    locked_accounts = (
        db.query(sql_func.count(AccountLockout.id))
        .filter(AccountLockout.cleared_at.is_(None), AccountLockout.locked_until > _now())
        .scalar()
        or 0
    )

    # Cheap integrity check on the recent tail. The full verification is a
    # deliberate action on /audit/verify, because it walks every chain.
    integrity = audit.verify_all(db, limit_per_chain=2000)

    return {
        "generated_at": _iso(_now()),
        "posture": settings.security_posture(),
        "encryption": {
            "enabled": encryption_enabled(),
            "active_key_version": active_key_version(),
            "key_versions": key_versions(),
            "decryption_failures": decryption_failure_counts(),
        },
        "audit": {
            "total_events": total_events,
            "oldest_event": _iso(oldest),
            "retention_floor_days": retention_module.CERT_IN_LOG_FLOOR_DAYS,
            "coverage_days": (
                (_now() - (oldest.replace(tzinfo=timezone.utc) if oldest and oldest.tzinfo is None else oldest)).days
                if oldest else 0
            ),
            "phi_accesses_24h": int(phi_reads_24h),
            "denials_24h": int(denials_24h),
            "records_exported_7d": int(exports_7d),
            "integrity_valid": integrity["valid"],
            "integrity_issue_count": sum(c.get("issue_count", 0) for c in integrity["chains"]),
            "writer": audit.stats(),
        },
        "alerts": {
            "open_total": sum(count for _, count in open_alerts),
            "by_severity": {severity: count for severity, count in open_alerts},
        },
        "incidents": {
            "open": int(open_incidents),
            "obligations_pending": len(obligations),
            "obligations_overdue": len(overdue),
            "obligations_due_soon": len(due_soon),
            "next_deadlines": [
                {
                    "incident_reference": o["incident"].reference,
                    "incident_title": o["incident"].title,
                    "authority": o["notification"].authority,
                    "authority_label": o["notification"].authority_label,
                    "due_at": _iso(o["notification"].due_at),
                    "state": o["deadline"]["state"],
                    "seconds_remaining": o["deadline"]["seconds_remaining"],
                }
                for o in obligations[:8]
            ],
        },
        "requests": {"open": int(open_requests), "overdue": int(overdue_requests)},
        "access": {"live_sessions": int(live_sessions), "locked_accounts": int(locked_accounts)},
        "contacts": {
            "organisation": settings.ORG_LEGAL_NAME,
            "dpo_name": settings.DPO_NAME,
            "dpo_email": settings.DPO_EMAIL,
            "dpo_phone": settings.DPO_PHONE,
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# Audit trail
# ═════════════════════════════════════════════════════════════════════════════


def _event_row(event: AuditEvent) -> dict:
    return {
        "id": event.id,
        "occurred_at": _iso(event.occurred_at),
        "actor_type": event.actor_type,
        "actor": event.actor_label,
        "actor_id": event.actor_id,
        "action": event.action,
        "resource_type": event.resource_type,
        "resource_id": event.resource_id,
        "subject_type": event.subject_type,
        "subject_id": event.subject_id,
        "record_count": event.record_count,
        "is_phi": event.is_phi,
        "outcome": event.outcome,
        "status_code": event.status_code,
        "method": event.method,
        "path": event.path,
        "source_ip": event.source_ip,
        "user_agent": event.user_agent,
        "request_id": event.request_id,
        "session_jti": event.session_jti,
        "detail": _loads(event.detail, {}),
        "chain_key": event.chain_key,
        "sequence": event.sequence,
        "entry_hash": event.entry_hash,
    }


def _audit_query(
    db: Session,
    *,
    actor: Optional[str],
    action: Optional[str],
    subject_type: Optional[str],
    subject_id: Optional[str],
    resource_type: Optional[str],
    outcome: Optional[str],
    phi_only: bool,
    source_ip: Optional[str],
    since: Optional[datetime],
    until: Optional[datetime],
):
    query = db.query(AuditEvent)
    if actor:
        query = query.filter(AuditEvent.actor_label.ilike(f"%{actor}%"))
    if action:
        query = query.filter(AuditEvent.action == action)
    if subject_type:
        query = query.filter(AuditEvent.subject_type == subject_type)
    if subject_id:
        query = query.filter(AuditEvent.subject_id == str(subject_id))
    if resource_type:
        query = query.filter(AuditEvent.resource_type == resource_type)
    if outcome:
        query = query.filter(AuditEvent.outcome == outcome)
    if phi_only:
        query = query.filter(AuditEvent.is_phi.is_(True))
    if source_ip:
        query = query.filter(AuditEvent.source_ip == source_ip)
    if since:
        query = query.filter(AuditEvent.occurred_at >= since)
    if until:
        query = query.filter(AuditEvent.occurred_at <= until)
    return query


@router.get("/audit")
def search_audit(
    actor: Optional[str] = None,
    action: Optional[str] = None,
    subject_type: Optional[str] = None,
    subject_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    outcome: Optional[str] = None,
    source_ip: Optional[str] = None,
    phi_only: bool = False,
    days: int = Query(default=7, ge=0, le=400),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    since = _now() - timedelta(days=days) if days else None
    query = _audit_query(
        db, actor=actor, action=action, subject_type=subject_type, subject_id=subject_id,
        resource_type=resource_type, outcome=outcome, phi_only=phi_only,
        source_ip=source_ip, since=since, until=None,
    )
    total = query.count()
    rows = query.order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "events": [_event_row(row) for row in rows],
        "actions": sorted({v for k, v in vars(audit.Action).items() if not k.startswith("_") and isinstance(v, str)}),
    }


@router.get("/audit/subject/{subject_type}/{subject_id}")
def subject_access_history(subject_type: str, subject_id: str, db: Session = Depends(get_db)):
    """Everything that touched one data principal's record.

    This is the query a DPDP access request and a breach investigation both
    start from, and it is the reason the trail is keyed by subject rather than
    only by endpoint.
    """
    rows = (
        db.query(AuditEvent)
        .filter(AuditEvent.subject_type == subject_type, AuditEvent.subject_id == str(subject_id))
        .order_by(AuditEvent.occurred_at.desc())
        .limit(1000)
        .all()
    )
    actors = {}
    for row in rows:
        key = row.actor_label or "unknown"
        entry = actors.setdefault(key, {"actor": key, "actor_type": row.actor_type, "accesses": 0, "last": None})
        entry["accesses"] += 1
        if entry["last"] is None:
            entry["last"] = _iso(row.occurred_at)
    return {
        "subject_type": subject_type,
        "subject_id": subject_id,
        "total_accesses": len(rows),
        "distinct_actors": len(actors),
        "actors": sorted(actors.values(), key=lambda a: -a["accesses"]),
        "events": [_event_row(row) for row in rows],
    }


@router.post("/audit/verify")
def verify_audit(db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Recompute every chain's message authentication codes.

    A clean result is the evidence that the access history has not been edited —
    which is what makes it usable in a fault-and-control determination. Running
    it is itself audited, so the verification has a provenance too.
    """
    result = audit.verify_all(db)
    audit.record_sync(
        audit.Action.AUDIT_VERIFIED,
        db=db,
        resource_type="audit_trail",
        record_count=result["total_events"],
        is_phi=False,
        outcome="success" if result["valid"] else "error",
        detail={
            "valid": result["valid"],
            "chains": result["chain_count"],
            "total_events": result["total_events"],
            "verified_by": admin_email,
        },
    )
    db.commit()
    return result


@router.get("/audit/export")
# Keyed by the signed-in ACCOUNT, not the source address, so a shared
# office connection is many buckets and a legitimate cohort is unaffected -
# while one stolen token cannot pull the database at machine speed. An
# export is the moment data leaves this system's custody (SECURITY.md).
@limiter.limit(lambda: settings.RATE_LIMIT_EXPORT, key_func=principal_key)
def export_audit(
    request: Request,
    actor: Optional[str] = None,
    action: Optional[str] = None,
    subject_type: Optional[str] = None,
    subject_id: Optional[str] = None,
    outcome: Optional[str] = None,
    phi_only: bool = False,
    days: int = Query(default=30, ge=1, le=400),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """CSV of the trail, for handing to an investigator or a regulator.

    The entry hash is included in every row so the recipient can verify the
    export against the live chain rather than taking it on trust.
    """
    since = _now() - timedelta(days=days)
    rows = (
        _audit_query(
            db, actor=actor, action=action, subject_type=subject_type, subject_id=subject_id,
            resource_type=None, outcome=outcome, phi_only=phi_only, source_ip=None,
            since=since, until=None,
        )
        .order_by(AuditEvent.occurred_at.asc())
        .limit(200000)
        .all()
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "id", "occurred_at_utc", "actor_type", "actor", "action", "outcome",
        "resource_type", "resource_id", "subject_type", "subject_id", "record_count",
        "is_phi", "method", "path", "status_code", "source_ip", "forwarded_for",
        "user_agent", "request_id", "session_jti", "detail",
        "chain_key", "sequence", "prev_hash", "entry_hash",
    ])
    for row in rows:
        writer.writerow([
            row.id, _iso(row.occurred_at), row.actor_type, row.actor_label, row.action,
            row.outcome, row.resource_type, row.resource_id, row.subject_type, row.subject_id,
            row.record_count, row.is_phi, row.method, row.path, row.status_code,
            row.source_ip, row.forwarded_for, row.user_agent, row.request_id, row.session_jti,
            row.detail, row.chain_key, row.sequence, row.prev_hash, row.entry_hash,
        ])

    audit.record_sync(
        audit.Action.AUDIT_EXPORTED,
        db=db,
        resource_type="audit_trail",
        record_count=len(rows),
        is_phi=False,
        detail={"days": days, "rows": len(rows), "exported_by": admin_email, "filters": {
            "actor": actor, "action": action, "subject_type": subject_type,
            "subject_id": subject_id, "outcome": outcome, "phi_only": phi_only,
        }},
    )
    db.commit()

    buffer.seek(0)
    filename = f"nurturehub-audit-{_now().strftime('%Y%m%d-%H%M%S')}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ═════════════════════════════════════════════════════════════════════════════
# Alerts
# ═════════════════════════════════════════════════════════════════════════════


def _alert_row(alert: SecurityAlert) -> dict:
    return {
        "id": alert.id,
        "raised_at": _iso(alert.raised_at),
        "rule": alert.rule,
        "severity": alert.severity,
        "title": alert.title,
        "description": alert.description,
        "actor": alert.actor_label,
        "source_ip": alert.source_ip,
        "evidence": _loads(alert.evidence, {}),
        "audit_event_ids": _loads(alert.audit_event_ids, []),
        "status": alert.status,
        "acknowledged_by": alert.acknowledged_by,
        "acknowledged_at": _iso(alert.acknowledged_at),
        "resolution_note": alert.resolution_note,
        "incident_id": alert.incident_id,
    }


@router.get("/alerts")
def list_alerts(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    severity: Optional[str] = None,
    days: int = Query(default=30, ge=1, le=400),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(SecurityAlert).filter(SecurityAlert.raised_at >= _now() - timedelta(days=days))
    if status_filter:
        query = query.filter(SecurityAlert.status == status_filter)
    if severity:
        query = query.filter(SecurityAlert.severity == severity)
    rows = query.order_by(SecurityAlert.raised_at.desc()).limit(limit).all()
    return {"alerts": [_alert_row(row) for row in rows], "total": query.count()}


class AlertUpdate(BaseModel):
    status: str = Field(pattern="^(open|investigating|dismissed|confirmed)$")
    note: Optional[str] = None


@router.patch("/alerts/{alert_id}")
def update_alert(
    alert_id: int,
    payload: AlertUpdate,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Triage an alert. Dismissal is recorded with who dismissed it and why —
    an unexplained dismissal is itself a finding after an incident."""
    alert = db.query(SecurityAlert).filter(SecurityAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if payload.status == "dismissed" and not (payload.note or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Say why this alert is being dismissed — it becomes part of the record.",
        )
    previous = alert.status
    alert.status = payload.status
    alert.resolution_note = payload.note
    alert.acknowledged_by = admin_email
    alert.acknowledged_at = _now()
    audit.record_sync(
        audit.Action.ALERT_UPDATED,
        db=db,
        resource_type="security_alert",
        resource_id=alert.id,
        is_phi=False,
        detail={"rule": alert.rule, "from": previous, "to": payload.status, "note": payload.note},
    )
    db.commit()
    return _alert_row(alert)


# ═════════════════════════════════════════════════════════════════════════════
# Breach register
# ═════════════════════════════════════════════════════════════════════════════


def _notification_row(notification: BreachNotification) -> dict:
    return {
        "id": notification.id,
        "authority": notification.authority,
        "authority_label": notification.authority_label,
        "legal_basis": notification.legal_basis,
        "due_at": _iso(notification.due_at),
        "sent_at": _iso(notification.sent_at),
        "channel": notification.channel,
        "reference_number": notification.reference_number,
        "sent_by": notification.sent_by,
        "not_applicable": notification.not_applicable,
        "not_applicable_reason": notification.not_applicable_reason,
        "deadline": incidents.deadline_state(notification),
    }


def _incident_row(incident: BreachIncident, with_notifications: bool = True) -> dict:
    data = {
        "id": incident.id,
        "reference": incident.reference,
        "created_at": _iso(incident.created_at),
        "title": incident.title,
        "summary": incident.summary,
        "severity": incident.severity,
        "status": incident.status,
        "occurred_at": _iso(incident.occurred_at),
        "discovered_at": _iso(incident.discovered_at),
        "contained_at": _iso(incident.contained_at),
        "closed_at": _iso(incident.closed_at),
        "custody_party": incident.custody_party,
        "custody_party_label": incidents.CUSTODY_PARTIES.get(incident.custody_party),
        "custody_rationale": incident.custody_rationale,
        "controlling_system": incident.controlling_system,
        "fault_assessment": incident.fault_assessment,
        "joint_process": incident.joint_process,
        "categories": _loads(incident.categories, []),
        "affected_subject_count": incident.affected_subject_count,
        "phi_involved": incident.phi_involved,
        "root_cause": incident.root_cause,
        "remediation": incident.remediation,
        "reported_by": incident.reported_by,
        "owner": incident.owner,
    }
    if with_notifications:
        data["notifications"] = [_notification_row(n) for n in incident.notifications]
    return data


class IncidentCreate(BaseModel):
    title: str
    summary: Optional[str] = None
    severity: str = "medium"
    discovered_at: Optional[datetime] = None
    occurred_at: Optional[datetime] = None
    custody_party: str = "undetermined"
    custody_rationale: Optional[str] = None
    controlling_system: Optional[str] = None
    joint_process: bool = False
    phi_involved: bool = True
    categories: Optional[list] = None
    affected_subject_count: Optional[int] = None
    from_alert_id: Optional[int] = None


@router.post("/incidents", status_code=status.HTTP_201_CREATED)
def create_incident(
    payload: IncidentCreate,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Open an incident. Every notification obligation is created with it.

    The clocks start at `discovered_at`, so the six-hour CERT-In window and the
    DPDP intimation are visible from the moment the incident exists rather than
    being reconstructed once someone remembers to ask.
    """
    incident = incidents.open_incident(
        db,
        title=payload.title,
        summary=payload.summary,
        severity=payload.severity,
        discovered_at=payload.discovered_at,
        occurred_at=payload.occurred_at,
        custody_party=payload.custody_party,
        custody_rationale=payload.custody_rationale,
        controlling_system=payload.controlling_system,
        joint_process=payload.joint_process,
        phi_involved=payload.phi_involved,
        categories=payload.categories,
        affected_subject_count=payload.affected_subject_count,
        reported_by=admin_email,
        from_alert_id=payload.from_alert_id,
    )
    db.refresh(incident)
    return _incident_row(incident)


@router.get("/incidents")
def list_incidents(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(BreachIncident)
    if status_filter:
        query = query.filter(BreachIncident.status == status_filter)
    rows = query.order_by(BreachIncident.discovered_at.desc()).limit(limit).all()
    return {
        "incidents": [_incident_row(row) for row in rows],
        "custody_parties": incidents.CUSTODY_PARTIES,
    }


@router.get("/incidents/{incident_id}")
def get_incident(incident_id: int, db: Session = Depends(get_db)):
    incident = db.query(BreachIncident).filter(BreachIncident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    data = _incident_row(incident)
    data["alerts"] = [_alert_row(a) for a in incident.alerts]
    return data


class IncidentUpdate(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    custody_party: Optional[str] = None
    custody_rationale: Optional[str] = None
    controlling_system: Optional[str] = None
    fault_assessment: Optional[str] = None
    joint_process: Optional[bool] = None
    categories: Optional[list] = None
    affected_subject_count: Optional[int] = None
    root_cause: Optional[str] = None
    remediation: Optional[str] = None
    owner: Optional[str] = None
    contained_at: Optional[datetime] = None


@router.patch("/incidents/{incident_id}")
def update_incident(
    incident_id: int,
    payload: IncidentUpdate,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    incident = db.query(BreachIncident).filter(BreachIncident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    changes = {}
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is None and field not in ("contained_at",):
            continue
        if field == "categories":
            incident.categories = json.dumps(value) if value else None
        elif field == "status":
            if value not in incidents.STATUSES:
                raise HTTPException(status_code=400, detail=f"Unknown status '{value}'")
            incident.status = value
            if value == "closed" and not incident.closed_at:
                incident.closed_at = _now()
        elif field == "custody_party":
            if value not in incidents.CUSTODY_PARTIES:
                raise HTTPException(status_code=400, detail=f"Unknown custody party '{value}'")
            incident.custody_party = value
        else:
            setattr(incident, field, value)
        changes[field] = value

    # Closing an incident with a statutory obligation still unmet would make the
    # register say the opposite of what happened.
    if incident.status == "closed":
        unmet = [
            n.authority for n in incident.notifications
            if not n.sent_at and not n.not_applicable
        ]
        if unmet:
            raise HTTPException(
                status_code=400,
                detail=(
                    "This incident still has unmet notification obligations: "
                    + ", ".join(unmet)
                    + ". Record them as sent, or mark them not applicable with a reason, first."
                ),
            )

    audit.record_sync(
        audit.Action.INCIDENT_UPDATED,
        db=db,
        resource_type="breach_incident",
        resource_id=incident.id,
        is_phi=False,
        detail={"reference": incident.reference, "changes": list(changes), "by": admin_email},
    )
    db.commit()
    db.refresh(incident)
    return _incident_row(incident)


@router.get("/incidents/{incident_id}/evidence")
def incident_evidence(
    incident_id: int,
    window_hours: int = Query(default=24, ge=1, le=720),
    db: Session = Depends(get_db),
):
    """The audit facts supporting the custody and fault determination."""
    incident = db.query(BreachIncident).filter(BreachIncident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incidents.custody_evidence(db, incident, window_hours=window_hours)


@router.get("/incidents/{incident_id}/notifications/{authority}/draft")
def notification_draft(incident_id: int, authority: str, db: Session = Depends(get_db)):
    incident = db.query(BreachIncident).filter(BreachIncident.id == incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    notification = next((n for n in incident.notifications if n.authority == authority), None)
    if not notification:
        raise HTTPException(status_code=404, detail="No such notification obligation")
    return {
        "authority": authority,
        "authority_label": notification.authority_label,
        "legal_basis": notification.legal_basis,
        "due_at": _iso(notification.due_at),
        "deadline": incidents.deadline_state(notification),
        "draft": incidents.render_notification(incident, authority),
    }


class NotificationSent(BaseModel):
    channel: str = "email"
    reference_number: Optional[str] = None
    content: Optional[str] = None


@router.post("/incidents/{incident_id}/notifications/{authority}/sent")
def record_notification_sent(
    incident_id: int,
    authority: str,
    payload: NotificationSent,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    notification = (
        db.query(BreachNotification)
        .filter(
            BreachNotification.incident_id == incident_id,
            BreachNotification.authority == authority,
        )
        .first()
    )
    if not notification:
        raise HTTPException(status_code=404, detail="No such notification obligation")
    if notification.sent_at:
        raise HTTPException(status_code=400, detail="Already recorded as sent")
    incidents.mark_notified(
        db, notification, sent_by=admin_email, channel=payload.channel,
        reference_number=payload.reference_number, content=payload.content,
    )
    return _notification_row(notification)


class NotificationNotApplicable(BaseModel):
    reason: str


@router.post("/incidents/{incident_id}/notifications/{authority}/not-applicable")
def mark_not_applicable(
    incident_id: int,
    authority: str,
    payload: NotificationNotApplicable,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Record a reasoned decision that an obligation does not apply.

    Kept rather than deleted: the register should show that the question was
    asked and answered, not that the row was never there.
    """
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Give the reason this does not apply.")
    notification = (
        db.query(BreachNotification)
        .filter(
            BreachNotification.incident_id == incident_id,
            BreachNotification.authority == authority,
        )
        .first()
    )
    if not notification:
        raise HTTPException(status_code=404, detail="No such notification obligation")
    notification.not_applicable = True
    notification.not_applicable_reason = payload.reason
    audit.record_sync(
        audit.Action.INCIDENT_UPDATED,
        db=db,
        resource_type="breach_notification",
        resource_id=notification.id,
        is_phi=False,
        detail={"authority": authority, "not_applicable": True, "reason": payload.reason, "by": admin_email},
    )
    db.commit()
    return _notification_row(notification)


# ═════════════════════════════════════════════════════════════════════════════
# Containment
# ═════════════════════════════════════════════════════════════════════════════


class ContainmentRequest(BaseModel):
    scope: str = Field(pattern="^(principal|all)$")
    principal: Optional[str] = None
    reason: str = "breach"
    incident_id: Optional[int] = None


@router.post("/containment/revoke-sessions")
def revoke_sessions(
    payload: ContainmentRequest,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """End sessions — one account's, or every one in the system.

    The system-wide option is the break-glass move for a confirmed compromise.
    It signs everyone out, including the administrator using it; that is the
    intended behaviour, and the reason it is a deliberate, audited action rather
    than a toggle.
    """
    if payload.scope == "principal":
        if not payload.principal:
            raise HTTPException(status_code=400, detail="Name the account.")
        count = sessions.revoke_all_for(
            db, payload.principal.strip().lower(), reason=payload.reason, by=admin_email
        )
    else:
        count = sessions.revoke_everything(db, reason=payload.reason, by=admin_email)

    if payload.incident_id:
        incident = db.query(BreachIncident).filter(BreachIncident.id == payload.incident_id).first()
        if incident and not incident.contained_at:
            incident.contained_at = _now()
            incident.status = "contained"
            db.commit()
    return {"sessions_ended": count, "scope": payload.scope}


@router.get("/sessions")
def list_sessions(
    principal: Optional[str] = None,
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    rows = sessions.active_sessions(db, principal=principal, limit=limit)
    return {
        "sessions": [
            {
                "id": row.id,
                "jti": row.jti,
                "principal": row.principal,
                "is_admin": row.is_admin,
                "issued_at": _iso(row.issued_at),
                "expires_at": _iso(row.expires_at),
                "last_seen_at": _iso(row.last_seen_at),
                "source_ip": row.source_ip,
                "user_agent": row.user_agent,
                "mfa_satisfied": row.mfa_satisfied,
            }
            for row in rows
        ]
    }


@router.delete("/sessions/{jti}")
def end_session(jti: str, db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    ended = sessions.revoke(db, jti, reason="admin", by=admin_email)
    if not ended:
        raise HTTPException(status_code=404, detail="No such live session")
    return {"ended": True}


@router.get("/lockouts")
def list_lockouts(db: Session = Depends(get_db)):
    rows = (
        db.query(AccountLockout)
        .filter(AccountLockout.cleared_at.is_(None), AccountLockout.locked_until > _now())
        .order_by(AccountLockout.locked_until.desc())
        .all()
    )
    return {
        "lockouts": [
            {
                "id": row.id,
                "principal": row.principal,
                "locked_at": _iso(row.locked_at),
                "locked_until": _iso(row.locked_until),
                "seconds_remaining": lockout.seconds_remaining(row),
                "failure_count": row.failure_count,
                "reason": row.reason,
            }
            for row in rows
        ]
    }


@router.post("/lockouts/{principal}/clear")
def clear_lockout(principal: str, db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    cleared = lockout.clear(db, principal, by=admin_email)
    return {"cleared": cleared}


# ═════════════════════════════════════════════════════════════════════════════
# Multi-factor
# ═════════════════════════════════════════════════════════════════════════════


@router.get("/mfa/status")
def mfa_status(db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    return mfa.status(db, admin_email)


@router.post("/mfa/enroll")
def mfa_enroll(db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Begin enrolment. The secret is not usable until a code from it is confirmed."""
    return mfa.begin_enrollment(db, admin_email)


class MfaConfirm(BaseModel):
    code: str


@router.post("/mfa/confirm")
def mfa_confirm(payload: MfaConfirm, db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    try:
        return mfa.confirm_enrollment(db, admin_email, payload.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class MfaDisable(BaseModel):
    principal: str


@router.post("/mfa/disable")
def mfa_disable(payload: MfaDisable, db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Turn off someone's second factor — for a lost device, with a record of who did it."""
    if settings.MFA_REQUIRED_FOR_ADMINS and payload.principal.strip().lower() == admin_email.lower():
        raise HTTPException(
            status_code=400,
            detail="You cannot remove your own second factor while it is required. Ask another administrator.",
        )
    ok = mfa.disable(db, payload.principal, by=admin_email)
    if not ok:
        raise HTTPException(status_code=404, detail="No active enrolment for that account")
    return {"disabled": True}


@router.get("/mfa/administrators")
def mfa_administrators(db: Session = Depends(get_db)):
    """Which administrator accounts have a second factor — the gap list."""
    from app.models import User

    admins = db.query(User).filter(User.is_admin.is_(True)).all()
    return {
        "required": settings.MFA_REQUIRED_FOR_ADMINS,
        "administrators": [
            {
                "email": user.email,
                "full_name": user.full_name,
                **{k: v for k, v in mfa.status(db, user.email).items() if k != "principal"},
            }
            for user in admins
        ],
    }


# ═════════════════════════════════════════════════════════════════════════════
# Retention & processing register
# ═════════════════════════════════════════════════════════════════════════════


@router.get("/retention")
def list_retention(db: Session = Depends(get_db)):
    retention_module.ensure_policies(db)
    rows = db.query(RetentionPolicy).order_by(RetentionPolicy.key).all()
    return {
        "cert_in_log_floor_days": retention_module.CERT_IN_LOG_FLOOR_DAYS,
        "policies": [
            {
                "id": row.id,
                "key": row.key,
                "label": row.label,
                "description": row.description,
                "retention_days": row.retention_days,
                "action": row.action,
                "enabled": row.enabled,
                "legal_basis": row.legal_basis,
                "last_run_at": _iso(row.last_run_at),
                "last_run_rows": row.last_run_rows,
            }
            for row in rows
        ],
    }


class RetentionUpdate(BaseModel):
    retention_days: Optional[int] = Field(default=None, ge=1, le=36500)
    action: Optional[str] = Field(default=None, pattern="^(delete|anonymise|review)$")
    enabled: Optional[bool] = None
    legal_basis: Optional[str] = None


@router.put("/retention/{key}")
def update_retention(
    key: str,
    payload: RetentionUpdate,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    policy = db.query(RetentionPolicy).filter(RetentionPolicy.key == key).first()
    if not policy:
        raise HTTPException(status_code=404, detail="No such retention policy")
    if (
        key in ("audit_events", "login_attempts")
        and payload.retention_days is not None
        and payload.retention_days < retention_module.CERT_IN_LOG_FLOOR_DAYS
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Log retention cannot go below {retention_module.CERT_IN_LOG_FLOOR_DAYS} days — "
                "the CERT-In Directions of 28.04.2022 set that floor."
            ),
        )
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(policy, field, value)
    policy.updated_by = admin_email
    audit.record_sync(
        audit.Action.ADMIN_CONFIG_CHANGE,
        db=db,
        resource_type="retention_policy",
        resource_id=key,
        is_phi=False,
        detail={"key": key, "changes": payload.model_dump(exclude_unset=True), "by": admin_email},
    )
    db.commit()
    return {"updated": True}


class RetentionRun(BaseModel):
    dry_run: bool = True
    only: Optional[str] = None


@router.post("/retention/run")
def run_retention(
    payload: RetentionRun,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Apply the schedule. Defaults to a dry run, which is what you want first."""
    return retention_module.run(
        db, dry_run=payload.dry_run, performed_by=admin_email, only=payload.only
    )


@router.get("/ropa")
def list_ropa(db: Session = Depends(get_db)):
    rows = db.query(ProcessingActivity).order_by(ProcessingActivity.key).all()
    return {
        "activities": [
            {
                "id": row.id,
                "key": row.key,
                "name": row.name,
                "purpose": row.purpose,
                "lawful_basis": row.lawful_basis,
                "data_categories": _loads(row.data_categories, []),
                "special_category": row.special_category,
                "subject_categories": _loads(row.subject_categories, []),
                "recipients": _loads(row.recipients, []),
                "storage_location": row.storage_location,
                "cross_border": row.cross_border,
                "retention_months": row.retention_months,
                "retention_rationale": row.retention_rationale,
                "security_measures": _loads(row.security_measures, []),
                "controller": row.controller,
                "processor": row.processor,
                "updated_at": _iso(row.updated_at),
                "updated_by": row.updated_by,
            }
            for row in rows
        ]
    }


class RopaUpdate(BaseModel):
    purpose: Optional[str] = None
    lawful_basis: Optional[str] = None
    retention_months: Optional[int] = None
    retention_rationale: Optional[str] = None
    storage_location: Optional[str] = None
    cross_border: Optional[bool] = None
    controller: Optional[str] = None
    processor: Optional[str] = None


@router.put("/ropa/{key}")
def update_ropa(
    key: str,
    payload: RopaUpdate,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    row = db.query(ProcessingActivity).filter(ProcessingActivity.key == key).first()
    if not row:
        raise HTTPException(status_code=404, detail="No such processing activity")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(row, field, value)
    row.updated_by = admin_email
    audit.record_sync(
        audit.Action.ADMIN_CONFIG_CHANGE,
        db=db,
        resource_type="processing_activity",
        resource_id=key,
        is_phi=False,
        detail={"key": key, "changes": payload.model_dump(exclude_unset=True), "by": admin_email},
    )
    db.commit()
    return {"updated": True}


# ═════════════════════════════════════════════════════════════════════════════
# Consent register
# ═════════════════════════════════════════════════════════════════════════════


@router.get("/consent/{subject_type}/{subject_id}")
def consent_status(subject_type: str, subject_id: int, db: Session = Depends(get_db)):
    return consent.status(db, subject_type, subject_id)


@router.get("/consent")
def consent_summary(db: Session = Depends(get_db)):
    """Programme-wide consent coverage — where the register has gaps."""
    from app.models import Child, Mother

    withdrawn_flag = case((ConsentRecord.withdrawn_at.isnot(None), 1), else_=0)
    rows = (
        db.query(
            ConsentRecord.subject_type,
            ConsentRecord.purpose,
            sql_func.count(ConsentRecord.id),
            sql_func.coalesce(sql_func.sum(withdrawn_flag), 0),
        )
        .group_by(ConsentRecord.subject_type, ConsentRecord.purpose)
        .all()
    )
    mothers = db.query(sql_func.count(Mother.id)).scalar() or 0
    children = db.query(sql_func.count(Child.id)).scalar() or 0
    return {
        "notice_version": consent.NOTICE_VERSION,
        "subjects": {"mothers": int(mothers), "children": int(children)},
        "records": [
            {
                "subject_type": subject_type,
                "purpose": purpose,
                "granted": int(total or 0) - int(withdrawn or 0),
                "withdrawn": int(withdrawn or 0),
                "total": int(total or 0),
            }
            for subject_type, purpose, total, withdrawn in rows
        ],
        "purposes": {
            key: {"label": spec["label"], "essential": spec["essential"]}
            for key, spec in consent.PURPOSES.items()
        },
    }


class ConsentChange(BaseModel):
    purpose: str
    reason: Optional[str] = None


@router.post("/consent/{subject_type}/{subject_id}/withdraw")
def withdraw_consent(
    subject_type: str,
    subject_id: int,
    payload: ConsentChange,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    row = consent.withdraw(
        db, subject_type=subject_type, subject_id=subject_id,
        purpose=payload.purpose, reason=payload.reason or f"withdrawn via console by {admin_email}",
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No live consent for that purpose")
    return consent.status(db, subject_type, subject_id)


# ═════════════════════════════════════════════════════════════════════════════
# Data-principal rights
# ═════════════════════════════════════════════════════════════════════════════

REQUEST_TYPES = ("access", "correction", "erasure", "grievance", "nominate")


def _request_row(row: DataSubjectRequest) -> dict:
    due = row.due_at.replace(tzinfo=timezone.utc) if row.due_at and row.due_at.tzinfo is None else row.due_at
    return {
        "id": row.id,
        "reference": row.reference,
        "created_at": _iso(row.created_at),
        "request_type": row.request_type,
        "subject_type": row.subject_type,
        "subject_id": row.subject_id,
        "subject_identifier": row.subject_identifier,
        "requested_by": row.requested_by,
        "requester_relationship": row.requester_relationship,
        "identity_verified": row.identity_verified,
        "verification_method": row.verification_method,
        "details": row.details,
        "status": row.status,
        "due_at": _iso(row.due_at),
        "overdue": bool(due and not row.closed_at and due < _now()),
        "days_remaining": (due - _now()).days if due and not row.closed_at else None,
        "closed_at": _iso(row.closed_at),
        "outcome": row.outcome,
        "rejection_reason": row.rejection_reason,
        "handled_by": row.handled_by,
        "response_ref": row.response_ref,
    }


class RequestCreate(BaseModel):
    request_type: str
    subject_type: str = "mother"
    subject_id: Optional[int] = None
    subject_identifier: Optional[str] = None
    requested_by: Optional[str] = None
    requester_relationship: Optional[str] = None
    details: Optional[str] = None


def _create_request(db: Session, payload: RequestCreate, source: str) -> DataSubjectRequest:
    if payload.request_type not in REQUEST_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown request type '{payload.request_type}'")
    row = DataSubjectRequest(
        reference=incidents.next_reference(db, "NH-DSR", DataSubjectRequest, DataSubjectRequest.reference),
        request_type=payload.request_type,
        subject_type=payload.subject_type,
        subject_id=payload.subject_id,
        subject_identifier=payload.subject_identifier,
        requested_by=payload.requested_by,
        requester_relationship=payload.requester_relationship,
        details=payload.details,
        due_at=_now() + timedelta(days=settings.DSR_RESPONSE_DAYS),
    )
    db.add(row)
    db.flush()
    audit.record_sync(
        audit.Action.DSR_CREATED,
        db=db,
        resource_type="data_subject_request",
        resource_id=row.id,
        subject_type=payload.subject_type,
        subject_id=payload.subject_id,
        is_phi=False,
        detail={
            "reference": row.reference,
            "request_type": payload.request_type,
            "source": source,
            "due_at": _iso(row.due_at),
        },
    )
    db.commit()
    return row


@router.post("/requests", status_code=status.HTTP_201_CREATED)
def create_request(payload: RequestCreate, db: Session = Depends(get_db)):
    return _request_row(_create_request(db, payload, source="console"))


@router.get("/requests")
def list_requests(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    overdue_only: bool = False,
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(DataSubjectRequest)
    if status_filter:
        query = query.filter(DataSubjectRequest.status == status_filter)
    if overdue_only:
        query = query.filter(
            DataSubjectRequest.closed_at.is_(None), DataSubjectRequest.due_at < _now()
        )
    rows = query.order_by(DataSubjectRequest.created_at.desc()).limit(limit).all()
    return {
        "requests": [_request_row(row) for row in rows],
        "response_days": settings.DSR_RESPONSE_DAYS,
        "types": list(REQUEST_TYPES),
    }


class RequestUpdate(BaseModel):
    status: Optional[str] = None
    subject_id: Optional[int] = None
    identity_verified: Optional[bool] = None
    verification_method: Optional[str] = None
    outcome: Optional[str] = None
    rejection_reason: Optional[str] = None
    response_ref: Optional[str] = None


@router.patch("/requests/{request_id}")
def update_request(
    request_id: int,
    payload: RequestUpdate,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    row = db.query(DataSubjectRequest).filter(DataSubjectRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(row, field, value)
    row.handled_by = admin_email
    if row.status in ("fulfilled", "rejected", "withdrawn") and not row.closed_at:
        row.closed_at = _now()
    audit.record_sync(
        audit.Action.DSR_UPDATED,
        db=db,
        resource_type="data_subject_request",
        resource_id=row.id,
        subject_type=row.subject_type,
        subject_id=row.subject_id,
        is_phi=False,
        detail={"reference": row.reference, "changes": payload.model_dump(exclude_unset=True), "by": admin_email},
    )
    db.commit()
    return _request_row(row)


@router.get("/requests/{request_id}/bundle")
def access_bundle(
    request_id: int,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Everything held about one data principal, for an access request (s.11).

    Includes the processing summary and the access history, because s.11 gives
    the right to know not only what is held but with whom it has been shared.
    Identity must be verified first — handing a mother's record to whoever asks
    would be the breach it is meant to prevent.
    """
    row = db.query(DataSubjectRequest).filter(DataSubjectRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    if not row.identity_verified:
        raise HTTPException(
            status_code=400,
            detail="Verify the requester's identity before assembling their data.",
        )
    if not row.subject_id:
        raise HTTPException(status_code=400, detail="Link the request to a record first.")
    return _build_bundle(db, row.subject_type, row.subject_id, request_ref=row.reference,
                         assembled_by=admin_email)


def _build_bundle(db: Session, subject_type: str, subject_id: int, *,
                  request_ref: Optional[str] = None, assembled_by: str = "") -> dict:
    from app.models import Child, FormResponse, Mother

    bundle: dict = {
        "assembled_at": _iso(_now()),
        "request_reference": request_ref,
        "subject_type": subject_type,
        "subject_id": subject_id,
        "controller": settings.ORG_LEGAL_NAME,
        "contact": settings.DPO_EMAIL,
    }

    if subject_type == "mother":
        mother = db.query(Mother).filter(Mother.id == subject_id).first()
        if not mother:
            raise HTTPException(status_code=404, detail="Record not found")
        bundle["personal_data"] = {
            column.name: getattr(mother, column.name) for column in Mother.__table__.columns
        }
        children = db.query(Child).filter(Child.mother_id == mother.id).all()
        bundle["children"] = [
            {column.name: getattr(child, column.name) for column in Child.__table__.columns}
            for child in children
        ]
        subject_ids = [str(mother.id)]
        responses = (
            db.query(FormResponse).filter(FormResponse.mother_id == mother.id).all()
        )
        bundle["assessments"] = [
            {"id": r.id, "form_key": r.form_key, "created_at": _iso(r.created_at)}
            for r in responses
        ]
    elif subject_type == "child":
        child = db.query(Child).filter(Child.id == subject_id).first()
        if not child:
            raise HTTPException(status_code=404, detail="Record not found")
        bundle["personal_data"] = {
            column.name: getattr(child, column.name) for column in Child.__table__.columns
        }
        subject_ids = [str(child.id)]
        responses = db.query(FormResponse).filter(FormResponse.child_id == child.id).all()
        bundle["assessments"] = [
            {"id": r.id, "form_key": r.form_key, "created_at": _iso(r.created_at)}
            for r in responses
        ]
    else:
        raise HTTPException(status_code=400, detail="Bundles are available for mother and child records.")

    bundle["consents"] = consent.status(db, subject_type, subject_id)
    history = (
        db.query(AuditEvent)
        .filter(AuditEvent.subject_type == subject_type, AuditEvent.subject_id.in_(subject_ids))
        .order_by(AuditEvent.occurred_at.desc())
        .limit(500)
        .all()
    )
    bundle["access_history"] = [
        {
            "at": _iso(e.occurred_at),
            "by": e.actor_label,
            "actor_type": e.actor_type,
            "action": e.action,
            "outcome": e.outcome,
        }
        for e in history
    ]
    bundle["processing_activities"] = [
        {"key": row.key, "name": row.name, "purpose": row.purpose, "lawful_basis": row.lawful_basis,
         "recipients": _loads(row.recipients, []), "retention_months": row.retention_months}
        for row in db.query(ProcessingActivity).all()
    ]

    audit.record_sync(
        audit.Action.PHI_EXPORT,
        db=db,
        resource_type="access_bundle",
        subject_type=subject_type,
        subject_id=subject_id,
        record_count=1,
        is_phi=True,
        detail={"reason": "data_principal_access_request", "reference": request_ref,
                "assembled_by": assembled_by, "format": "json"},
    )
    db.commit()
    return bundle


class ErasureRequestBody(BaseModel):
    method: str = Field(default="hard_delete", pattern="^(hard_delete|anonymise)$")
    confirm_reference: str
    note: Optional[str] = None


@router.post("/requests/{request_id}/erase")
def fulfil_erasure(
    request_id: int,
    payload: ErasureRequestBody,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Carry out an erasure request (s.12) and record the proof.

    Typing the request reference back is required, because this is irreversible
    and a mis-click here destroys a family's health record.
    """
    row = db.query(DataSubjectRequest).filter(DataSubjectRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    if row.request_type != "erasure":
        raise HTTPException(status_code=400, detail="This is not an erasure request.")
    if not row.identity_verified:
        raise HTTPException(status_code=400, detail="Verify the requester's identity first.")
    if payload.confirm_reference.strip().upper() != row.reference.upper():
        raise HTTPException(
            status_code=400,
            detail=f"Type the request reference ({row.reference}) to confirm this irreversible action.",
        )
    if row.subject_type != "mother" or not row.subject_id:
        raise HTTPException(
            status_code=400,
            detail="Erasure is performed at the mother record, which cascades to her children.",
        )

    result = retention_module.erase_mother(
        db, row.subject_id, performed_by=admin_email, request_id=row.id,
        method=payload.method, note=payload.note,
    )
    if not result.get("found"):
        raise HTTPException(status_code=404, detail="Record not found")

    row.status = "fulfilled"
    row.closed_at = _now()
    row.handled_by = admin_email
    row.outcome = (
        f"Erased by {payload.method} on {_now().date().isoformat()}: "
        f"{result['rows']} row(s), digest {result['digest'][:16]}…"
    )
    db.commit()
    return {"request": _request_row(row), "erasure": result}


@router.get("/erasures")
def list_erasures(limit: int = Query(default=200, ge=1, le=500), db: Session = Depends(get_db)):
    """The erasure register — proof of deletion, without the deleted data."""
    rows = (
        db.query(ErasureRecord)
        .order_by(ErasureRecord.performed_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "erasures": [
            {
                "id": row.id,
                "performed_at": _iso(row.performed_at),
                "trigger": row.trigger,
                "subject_type": row.subject_type,
                "subject_uid": row.subject_uid,
                "scope": _loads(row.scope, {}),
                "rows_deleted": row.rows_deleted,
                "method": row.method,
                "content_digest": row.content_digest,
                "performed_by": row.performed_by,
                "note": row.note,
            }
            for row in rows
        ]
    }


# ═════════════════════════════════════════════════════════════════════════════
# Public: privacy notice and grievance intake
# ═════════════════════════════════════════════════════════════════════════════


@public_router.get("/notice")
def privacy_notice(language: str = "en"):
    """The notice given before consent (DPDP s.5). Public by design."""
    return consent.notice_text(language)


class PublicRequest(BaseModel):
    request_type: str = Field(pattern="^(access|correction|erasure|grievance|nominate)$")
    subject_identifier: str = Field(min_length=3, max_length=255)
    requested_by: str = Field(min_length=2, max_length=160)
    requester_relationship: Optional[str] = None
    contact: str = Field(min_length=5, max_length=160)
    details: Optional[str] = Field(default=None, max_length=4000)


@public_router.post("/requests", status_code=status.HTTP_201_CREATED)
@limiter.limit(lambda: settings.RATE_LIMIT_PUBLIC_FORM)
def submit_public_request(request: Request, payload: PublicRequest, db: Session = Depends(get_db)):
    """Intake for a data principal exercising a right, or raising a grievance.

    Unauthenticated on purpose: s.13 requires a readily-available grievance
    route, and the people most likely to need one — a mother who no longer has
    the phone she registered with — are exactly the ones who cannot sign in.
    Nothing here reads or returns any record; it opens a ticket with a due date,
    and identity is verified by a human before anything is disclosed.
    """
    row = _create_request(
        db,
        RequestCreate(
            request_type=payload.request_type,
            subject_type="mother",
            subject_identifier=payload.subject_identifier,
            requested_by=f"{payload.requested_by} <{payload.contact}>",
            requester_relationship=payload.requester_relationship,
            details=payload.details,
        ),
        source="public_form",
    )
    return {
        "reference": row.reference,
        "due_at": _iso(row.due_at),
        "message": (
            "Your request has been recorded. Keep this reference. We will contact you to "
            "confirm your identity before we act on it."
        ),
        "contact": {"email": settings.DPO_EMAIL, "phone": settings.DPO_PHONE},
    }
