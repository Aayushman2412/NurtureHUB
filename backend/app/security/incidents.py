"""Breach register, statutory clocks, and the custody determination the MOU asks for.

The MOU clause says three things, and this module operationalises each:

1. *"responsibility ... shall lie with the Party in whose custody, control, or
   technical system such breach occurs"* — every incident must carry an explicit
   determination of which side's system it happened in, with the reasoning
   recorded. `custody_party` and `custody_rationale` are mandatory fields, and
   `custody_evidence()` assembles the audit facts that support the call.

2. *"where the breach arises from shared systems or joint processes,
   responsibility shall be determined mutually based on principles of fault,
   control, and applicable law"* — `joint_process` flags those, and a
   counterparty notification obligation is created automatically so the mutual
   determination actually starts rather than waiting for someone to remember.

3. *"Each Party shall comply with applicable data protection, cybersecurity, and
   reporting obligations under prevailing laws"* — opening an incident
   immediately creates the notification obligations with their deadlines
   computed, so the clock is visible from minute one instead of being
   reconstructed afterwards.

The clocks
----------
Deadlines run from `discovered_at`, never from when the breach happened: every
one of these obligations starts at awareness.

* **CERT-In** — Directions under s.70B(6) of the IT Act, 2000, dated 28 April
  2022, require specified cyber incidents (including data breaches, data leaks
  and unauthorised access to data) to be reported **within 6 hours** of noticing
  them.
* **Data Protection Board / Data Principals** — DPDP Act 2023 s.8(6) requires
  intimation of a personal data breach to the Board and to each affected Data
  Principal. Intimation is *without delay*; the detailed report to the Board is
  set here at **72 hours**.
* **MOU counterparty** — contractual, not statutory. Defaults to 24 hours and is
  configurable, because the signed annexure sets the real number.

Every window is a setting, precisely so the numbers can be aligned with the
notified Rules and the executed MOU without touching code. Confirm them against
the operative text at signature; the defaults are the conservative reading.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config import settings
from app.security import audit


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(moment):
    if moment is None:
        return None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment


CUSTODY_PARTIES = {
    "nurturehub": "NurtureHUB / Spoken Tutorial (this system)",
    "state_govt": "State Government counterparty",
    "shared": "Shared system or joint process",
    "third_party": "Third-party processor or vendor",
    "undetermined": "Not yet determined",
}

SEVERITIES = ("low", "medium", "high", "critical")
STATUSES = ("open", "contained", "notified", "closed", "false_positive")


class NotificationSpec:
    """One notification obligation, with where its deadline comes from."""

    def __init__(self, authority, label, hours_setting, legal_basis, applies):
        self.authority = authority
        self.label = label
        self.hours_setting = hours_setting
        self.legal_basis = legal_basis
        self.applies = applies

    def hours(self) -> float:
        return float(getattr(settings, self.hours_setting))


NOTIFICATION_SPECS = (
    NotificationSpec(
        "cert_in",
        "CERT-In (Indian Computer Emergency Response Team)",
        "BREACH_CERTIN_HOURS",
        "CERT-In Directions dated 28.04.2022 under s.70B(6), IT Act 2000 - report within 6 hours of noticing",
        lambda inc: True,
    ),
    NotificationSpec(
        "dpb_initial",
        "Data Protection Board of India - initial intimation",
        "BREACH_DPB_INITIAL_HOURS",
        "DPDP Act 2023 s.8(6) - intimate the Board without delay",
        lambda inc: inc.phi_involved or bool(inc.affected_subject_count),
    ),
    NotificationSpec(
        "dpb_detailed",
        "Data Protection Board of India - detailed report",
        "BREACH_DPB_DETAILED_HOURS",
        "DPDP Act 2023 s.8(6) with the DPDP Rules - detailed particulars",
        lambda inc: inc.phi_involved or bool(inc.affected_subject_count),
    ),
    NotificationSpec(
        "data_principals",
        "Affected Data Principals (mothers / guardians of children)",
        "BREACH_PRINCIPALS_HOURS",
        "DPDP Act 2023 s.8(6) - intimate each affected Data Principal",
        lambda inc: inc.phi_involved or bool(inc.affected_subject_count),
    ),
    NotificationSpec(
        "mou_counterparty",
        "MOU counterparty (Government of Maharashtra)",
        "BREACH_MOU_HOURS",
        "MOU data-privacy clause - mutual determination of responsibility",
        lambda inc: True,
    ),
)


def next_reference(db, prefix: str, model, column) -> str:
    """Sequential, human-quotable reference: NH-IR-2026-0001."""
    year = _now().year
    stem = f"{prefix}-{year}-"
    latest = (
        db.query(column)
        .filter(column.like(f"{stem}%"))
        .order_by(column.desc())
        .first()
    )
    counter = 1
    if latest and latest[0]:
        try:
            counter = int(str(latest[0]).rsplit("-", 1)[1]) + 1
        except (IndexError, ValueError):
            counter = 1
    return f"{stem}{counter:04d}"


def open_incident(
    db,
    *,
    title: str,
    discovered_at: Optional[datetime] = None,
    occurred_at: Optional[datetime] = None,
    severity: str = "medium",
    summary: Optional[str] = None,
    custody_party: str = "undetermined",
    custody_rationale: Optional[str] = None,
    controlling_system: Optional[str] = None,
    joint_process: bool = False,
    phi_involved: bool = True,
    categories: Optional[list] = None,
    affected_subject_count: Optional[int] = None,
    affected_subject_ids: Optional[list] = None,
    reported_by: Optional[str] = None,
    owner: Optional[str] = None,
    from_alert_id: Optional[int] = None,
    commit: bool = True,
):
    """Open an incident and create every notification obligation it triggers."""
    from app.models_security import BreachIncident, SecurityAlert

    if severity not in SEVERITIES:
        severity = "medium"
    if custody_party not in CUSTODY_PARTIES:
        custody_party = "undetermined"

    discovered = _aware(discovered_at) or _now()
    incident = BreachIncident(
        reference=next_reference(db, "NH-IR", BreachIncident, BreachIncident.reference),
        title=title[:255],
        summary=summary,
        severity=severity,
        status="open",
        occurred_at=_aware(occurred_at),
        discovered_at=discovered,
        custody_party=custody_party,
        custody_rationale=custody_rationale,
        controlling_system=controlling_system,
        joint_process=joint_process,
        phi_involved=phi_involved,
        categories=json.dumps(categories) if categories else None,
        affected_subject_count=affected_subject_count,
        affected_subject_ids=json.dumps(affected_subject_ids) if affected_subject_ids else None,
        reported_by=reported_by,
        owner=owner or reported_by,
    )
    db.add(incident)
    db.flush()

    create_notification_obligations(db, incident)

    if from_alert_id:
        alert = db.query(SecurityAlert).filter(SecurityAlert.id == from_alert_id).first()
        if alert:
            alert.incident_id = incident.id
            alert.status = "confirmed"

    audit.record_sync(
        audit.Action.INCIDENT_OPENED,
        db=db,
        resource_type="breach_incident",
        resource_id=incident.id,
        is_phi=False,
        detail={
            "reference": incident.reference,
            "severity": severity,
            "custody_party": custody_party,
            "joint_process": joint_process,
            "affected_subjects": affected_subject_count,
            "discovered_at": discovered.isoformat(),
        },
    )
    if commit:
        db.commit()
    return incident


def create_notification_obligations(db, incident) -> list:
    """Materialise the deadlines. Idempotent — safe to call again after an edit."""
    from app.models_security import BreachNotification

    existing = {
        row.authority
        for row in db.query(BreachNotification).filter(
            BreachNotification.incident_id == incident.id
        )
    }
    created = []
    base = _aware(incident.discovered_at) or _now()
    for spec in NOTIFICATION_SPECS:
        if spec.authority in existing:
            continue
        applicable = spec.applies(incident)
        row = BreachNotification(
            incident_id=incident.id,
            authority=spec.authority,
            authority_label=spec.label,
            legal_basis=spec.legal_basis,
            due_at=base + timedelta(hours=spec.hours()),
            not_applicable=not applicable,
            not_applicable_reason=(
                None if applicable else "No personal data was involved in this incident."
            ),
        )
        db.add(row)
        created.append(row)
    db.flush()
    return created


def deadline_state(notification, now: Optional[datetime] = None) -> dict:
    """How this obligation stands right now — the field the dashboard counts down."""
    now = now or _now()
    due = _aware(notification.due_at)
    sent = _aware(notification.sent_at)
    if notification.not_applicable:
        return {"state": "not_applicable", "seconds_remaining": None, "overdue_by": None}
    if sent:
        return {
            "state": "met" if sent <= due else "met_late",
            "seconds_remaining": None,
            "overdue_by": int((sent - due).total_seconds()) if sent > due else 0,
        }
    remaining = int((due - now).total_seconds())
    if remaining < 0:
        return {"state": "overdue", "seconds_remaining": 0, "overdue_by": -remaining}
    # "Due soon" is a quarter of the window or one hour, whichever is larger —
    # a 6-hour CERT-In clock needs warning long before a 72-hour one does.
    return {
        "state": "due_soon" if remaining <= max(3600, remaining // 3) else "pending",
        "seconds_remaining": remaining,
        "overdue_by": 0,
    }


def custody_evidence(db, incident, window_hours: int = 24) -> dict:
    """Assemble the audit facts that support (or contradict) the custody call.

    This is the material the MOU's "principles of fault, control" test is applied
    to: which accounts acted, from which addresses, against which records, in the
    window around discovery. It is assembled from the audit trail rather than
    typed by hand so the determination rests on evidence.
    """
    from sqlalchemy import func as sql_func

    from app.models_security import AuditEvent

    discovered = _aware(incident.discovered_at) or _now()
    start = (_aware(incident.occurred_at) or discovered) - timedelta(hours=window_hours)
    end = discovered + timedelta(hours=window_hours)

    actors = (
        db.query(
            AuditEvent.actor_type,
            AuditEvent.actor_label,
            sql_func.count(AuditEvent.id).label("events"),
            sql_func.sum(AuditEvent.record_count).label("records"),
            sql_func.count(sql_func.distinct(AuditEvent.source_ip)).label("addresses"),
        )
        .filter(
            AuditEvent.occurred_at >= start,
            AuditEvent.occurred_at <= end,
            AuditEvent.is_phi.is_(True),
        )
        .group_by(AuditEvent.actor_type, AuditEvent.actor_label)
        .order_by(sql_func.sum(AuditEvent.record_count).desc())
        .limit(25)
        .all()
    )
    addresses = (
        db.query(AuditEvent.source_ip, sql_func.count(AuditEvent.id).label("events"))
        .filter(
            AuditEvent.occurred_at >= start,
            AuditEvent.occurred_at <= end,
            AuditEvent.is_phi.is_(True),
            AuditEvent.source_ip.isnot(None),
        )
        .group_by(AuditEvent.source_ip)
        .order_by(sql_func.count(AuditEvent.id).desc())
        .limit(25)
        .all()
    )
    exports = (
        db.query(AuditEvent)
        .filter(
            AuditEvent.occurred_at >= start,
            AuditEvent.occurred_at <= end,
            AuditEvent.action == audit.Action.PHI_EXPORT,
        )
        .order_by(AuditEvent.record_count.desc())
        .limit(25)
        .all()
    )
    integrity = audit.verify_all(db, limit_per_chain=20000)

    return {
        "window": {"from": start.isoformat(), "to": end.isoformat()},
        "actors": [
            {
                "actor_type": a[0],
                "actor": a[1],
                "events": int(a[2] or 0),
                "records": int(a[3] or 0),
                "distinct_addresses": int(a[4] or 0),
            }
            for a in actors
        ],
        "source_addresses": [{"ip": ip, "events": int(n or 0)} for ip, n in addresses],
        "exports": [
            {
                "audit_event_id": e.id,
                "at": e.occurred_at.isoformat() if e.occurred_at else None,
                "actor": e.actor_label,
                "records": e.record_count,
                "path": e.path,
                "source_ip": e.source_ip,
            }
            for e in exports
        ],
        "audit_trail_intact": integrity["valid"],
        "audit_events_in_window": sum(int(a[2] or 0) for a in actors),
        "note": (
            "Custody follows the system the action executed in. Actions listed here executed "
            "inside NurtureHUB. Records exported to a file left this system's custody at the "
            "moment of export - custody of that copy follows the holder of the file."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Notification drafts
# ─────────────────────────────────────────────────────────────────────────────


def _subject_line(incident) -> str:
    return f"[{incident.reference}] Personal data breach notification - NurtureHUB ({incident.severity.upper()})"


def render_notification(incident, authority: str, organisation: Optional[str] = None) -> str:
    """A pre-filled draft for one authority.

    A draft, not a filing: someone accountable reads and sends it. Its value is
    that at hour one of a six-hour clock nobody is starting from a blank page,
    and the facts are drawn from the register rather than from memory.
    """
    org = organisation or settings.ORG_LEGAL_NAME
    dpo = settings.DPO_NAME
    dpo_email = settings.DPO_EMAIL
    dpo_phone = settings.DPO_PHONE
    discovered = _aware(incident.discovered_at)
    occurred = _aware(incident.occurred_at)
    categories = json.loads(incident.categories) if incident.categories else []
    affected = incident.affected_subject_count

    facts = f"""
Reference               : {incident.reference}
Reporting entity        : {org}
Platform                : NurtureHUB ({settings.PUBLIC_BASE_URL or 'production deployment'})
Incident title          : {incident.title}
Severity                : {incident.severity.upper()}
Time of occurrence      : {occurred.isoformat() if occurred else 'Under investigation'}
Time of discovery       : {discovered.isoformat() if discovered else 'n/a'}
System in custody/control: {CUSTODY_PARTIES.get(incident.custody_party, incident.custody_party)}
Affected component      : {incident.controlling_system or 'Under investigation'}
Shared/joint process    : {'Yes' if incident.joint_process else 'No'}
Personal data involved  : {'Yes' if incident.phi_involved else 'No'}
Categories of data      : {', '.join(categories) if categories else 'Under assessment'}
Data Principals affected: {affected if affected is not None else 'Under assessment'}
""".strip()

    summary = incident.summary or "Under investigation; this notification is filed within the statutory window on the facts known at this time."
    root_cause = incident.root_cause or "Under investigation."
    remediation = incident.remediation or "Containment in progress. Sessions revoked and access under review."
    contact = f"{dpo}, Data Protection Officer, {org}\nEmail: {dpo_email}\nPhone: {dpo_phone}"

    if authority == "cert_in":
        return f"""To: {settings.CERTIN_EMAIL}
Subject: Cyber incident report under CERT-In Directions dated 28.04.2022 - {incident.reference}

Sir/Madam,

This is a report of a cyber security incident under the Directions issued by CERT-In on
28 April 2022 under sub-section (6) of section 70B of the Information Technology Act, 2000.
It is being filed within six hours of the incident being noticed.

{facts}

Description of the incident
{summary}

Preliminary cause
{root_cause}

Action taken / proposed
{remediation}

Point of contact
{contact}

We will supplement this report as the investigation progresses.

{org}
"""

    if authority in ("dpb_initial", "dpb_detailed"):
        detailed = authority == "dpb_detailed"
        heading = "Detailed report" if detailed else "Initial intimation"
        extra = ""
        if detailed:
            extra = f"""
Broad facts and circumstances
{summary}

Measures implemented to remedy the breach
{remediation}

Findings on the person who caused the breach (if determined)
{incident.fault_assessment or 'Under investigation.'}

Measures taken to prevent recurrence
{incident.remediation or 'Under formulation.'}

Intimation to affected Data Principals
{'Completed - see the breach register for the record of intimation.' if incident.status in ('notified', 'closed') else 'In progress.'}
"""
        return f"""To: Data Protection Board of India
Subject: {heading} of personal data breach under section 8(6), Digital Personal Data Protection Act, 2023 - {incident.reference}

Sir/Madam,

{org}, in its capacity as Data Fiduciary for the NurtureHUB platform, gives intimation of a
personal data breach under section 8(6) of the Digital Personal Data Protection Act, 2023.

{facts}

Nature, extent and timing of the breach
{summary}

Likely consequences for affected Data Principals
{incident.fault_assessment or 'Under assessment. The data categories involved are listed above.'}
{extra}
Contact for further information
{contact}

{org}
"""

    if authority == "data_principals":
        return f"""Subject: An important notice about your information held by NurtureHUB

Namaste,

We are writing to tell you about a problem with the information we hold about you and your
child through the NurtureHUB programme. We are telling you because you have a right to know.

What happened
{summary}

When
We found out about this on {discovered.strftime('%d %B %Y') if discovered else 'a recent date'}.

What information was involved
{', '.join(categories) if categories else 'We are still confirming exactly which information was affected.'}

What we have done
{remediation}

What you can do
You do not need to do anything to keep using the programme. If you receive a call or message
asking for your details and claiming to be from NurtureHUB or the health department, please do
not share anything, and tell your health worker.

If you have questions, or if you want to know what information we hold about you, or want it
corrected or deleted, contact us:

{contact}

You may also complain to the Data Protection Board of India.

We are sorry this happened.

{org}
"""

    if authority == "mou_counterparty":
        return f"""To: Government of Maharashtra - designated nodal officer
Subject: Notification of a data incident under the NurtureHUB MOU data-privacy clause - {incident.reference}

Sir/Madam,

We notify you of a data incident affecting the NurtureHUB platform, in accordance with the
data-privacy clause of the Memorandum of Understanding between our organisations.

{facts}

Determination of custody and control
{incident.custody_rationale or 'Under determination. The evidence assembled from the platform audit trail is available for joint review.'}

{'This incident involves a shared system or joint process. In accordance with the MOU, we propose that responsibility be determined mutually on the principles of fault, control and applicable law. The complete audit evidence - accounts, network addresses, records accessed and exports - is available for joint examination, and its integrity can be independently verified.' if incident.joint_process else 'On the evidence to date, the incident occurred within the system identified above.'}

Statutory reporting
CERT-In  : reported under the Directions dated 28.04.2022 (6-hour window).
DPDP Act : intimation to the Data Protection Board and affected Data Principals under section 8(6).

Action taken
{remediation}

Point of contact
{contact}

{org}
"""

    return f"""Subject: {_subject_line(incident)}

{facts}

{summary}
"""


def mark_notified(db, notification, *, sent_by: str, channel: str = "email",
                  reference_number: Optional[str] = None, content: Optional[str] = None,
                  commit: bool = True):
    """Record that an obligation was discharged, and by whom."""
    notification.sent_at = _now()
    notification.sent_by = sent_by
    notification.channel = channel
    notification.reference_number = reference_number
    if content:
        notification.content = content
    audit.record_sync(
        audit.Action.NOTIFICATION_SENT,
        db=db,
        resource_type="breach_notification",
        resource_id=notification.id,
        is_phi=False,
        detail={
            "incident_id": notification.incident_id,
            "authority": notification.authority,
            "channel": channel,
            "reference_number": reference_number,
            "on_time": deadline_state(notification)["state"] == "met",
        },
    )
    if commit:
        db.commit()
    return notification


def open_obligations(db, only_overdue: bool = False) -> list:
    """Every unmet obligation across open incidents, soonest deadline first."""
    from app.models_security import BreachIncident, BreachNotification

    rows = (
        db.query(BreachNotification, BreachIncident)
        .join(BreachIncident, BreachNotification.incident_id == BreachIncident.id)
        .filter(
            BreachNotification.sent_at.is_(None),
            BreachNotification.not_applicable.is_(False),
            BreachIncident.status != "false_positive",
        )
        .order_by(BreachNotification.due_at.asc())
        .all()
    )
    out = []
    for notification, incident in rows:
        state = deadline_state(notification)
        if only_overdue and state["state"] != "overdue":
            continue
        out.append({"notification": notification, "incident": incident, "deadline": state})
    return out
