"""Tables that make the data-protection layer evidential rather than aspirational.

These are deliberately separate from `models.py`: nothing here is programme
content, and every table exists to answer a question an investigator, a
regulator or a counterparty under the Maharashtra MOU will actually ask.

  who touched this record, when, from where       -> AuditEvent
  can that log be trusted / was it edited          -> AuditEvent chain + AuditAnchor
  whose session was it, is it still live           -> AuthSession
  was the account being brute-forced               -> LoginAttempt
  did anything look wrong before the breach        -> SecurityAlert
  what did we do about it, and by when             -> BreachIncident / BreachNotification
  were we allowed to hold this data at all         -> ConsentRecord, ProcessingActivity
  did we honour the data principal's rights        -> DataSubjectRequest, ErasureRecord
  is the operator account itself protected         -> MfaEnrollment, PasswordHistory

`Base` is shared with the rest of the app so Alembic autogenerate sees these.
"""
from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.database import Base

# ─────────────────────────────────────────────────────────────────────────────
# Accountability: the audit trail
# ─────────────────────────────────────────────────────────────────────────────


class AuditEvent(Base):
    """One append-only, tamper-evident record of something that happened.

    Rows are never updated and never deleted except by the retention job, which
    prunes only whole expired periods and records that it did so.

    The chain
    ---------
    Each row carries `prev_hash` (the previous row's `entry_hash` within the same
    `chain_key`) and `entry_hash` = HMAC-SHA256(AUDIT_HMAC_KEY, prev_hash ||
    canonical payload). Editing or removing a row in the middle of a chain
    breaks every hash after it, and because the MAC is keyed, an attacker with
    write access to the database still cannot forge a consistent replacement
    without the key — which lives in the application's environment, not the DB.

    Chains are per-writer (`chain_key` = host:pid:boot) so appends need only an
    in-process lock, not a global database lock on the hot path. Every chain is
    verified independently; `AuditAnchor` closes the one gap a per-chain hash
    chain leaves open, namely truncation of a chain's tail.
    """

    __tablename__ = "audit_events"

    id = Column(Integer, primary_key=True)
    occurred_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    # ── who ──
    # actor_type: learner | admin | system | anonymous
    actor_type = Column(String(16), nullable=False, index=True)
    actor_id = Column(Integer, nullable=True, index=True)      # users.id when known
    actor_label = Column(String(320), nullable=True, index=True)  # email / service name
    session_jti = Column(String(64), nullable=True, index=True)

    # ── from where ── (custody attribution: the MOU apportions by control)
    source_ip = Column(String(64), nullable=True, index=True)
    forwarded_for = Column(String(255), nullable=True)   # full proxy chain, for hop attribution
    user_agent = Column(String(512), nullable=True)
    request_id = Column(String(64), nullable=True, index=True)

    # ── what ──
    action = Column(String(64), nullable=False, index=True)   # e.g. phi.read, phi.export
    resource_type = Column(String(64), nullable=True, index=True)  # mother, child, form_response…
    resource_id = Column(String(64), nullable=True, index=True)
    # The data principal the record belongs to, which is not always the
    # resource: a growth measurement's principal is the child.
    subject_type = Column(String(32), nullable=True, index=True)
    subject_id = Column(String(64), nullable=True, index=True)
    record_count = Column(Integer, nullable=False, default=1)
    is_phi = Column(Boolean, nullable=False, default=False, index=True)

    method = Column(String(8), nullable=True)
    path = Column(String(512), nullable=True)
    outcome = Column(String(16), nullable=False, default="success", index=True)  # success|denied|error
    status_code = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    detail = Column(Text, nullable=True)   # JSON, redacted — never raw PHI values

    # ── integrity ──
    chain_key = Column(String(96), nullable=False, index=True)
    sequence = Column(Integer, nullable=False)     # position within chain_key, 1-based
    prev_hash = Column(String(64), nullable=False)
    entry_hash = Column(String(64), nullable=False)

    __table_args__ = (
        UniqueConstraint("chain_key", "sequence", name="uq_audit_chain_sequence"),
        # The two shapes every investigation starts from: "everything this actor
        # did" and "everything that touched this record".
        Index("ix_audit_actor_time", "actor_label", "occurred_at"),
        Index("ix_audit_subject_time", "subject_type", "subject_id", "occurred_at"),
        Index("ix_audit_phi_time", "is_phi", "occurred_at"),
    )


class AuditAnchor(Base):
    """Periodic notarised snapshot of every audit chain's head.

    A hash chain proves nothing was *altered*; it cannot prove nothing was
    *removed from the end*. Anchors are written on a timer, each one recording
    where every chain stood, and each anchor chains to the previous anchor. To
    hide a deletion an attacker would have to rewrite every anchor since, which
    needs the audit key.
    """

    __tablename__ = "audit_anchors"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    chain_key = Column(String(96), nullable=False, index=True)
    last_event_id = Column(Integer, nullable=False)
    last_sequence = Column(Integer, nullable=False)
    last_entry_hash = Column(String(64), nullable=False)
    event_count = Column(Integer, nullable=False)
    prev_anchor_hash = Column(String(64), nullable=False)
    anchor_hash = Column(String(64), nullable=False)


# ─────────────────────────────────────────────────────────────────────────────
# Identity
# ─────────────────────────────────────────────────────────────────────────────


class AuthSession(Base):
    """A server-side record of an issued token, so it can be revoked.

    A bare JWT is valid until it expires — signing one out is a client-side
    fiction. Under the MOU, "the breach occurred in your system" cases usually
    start with a compromised credential, and the first containment step is
    killing the attacker's session. That requires the server to know the session
    exists. Every token now carries a `jti` that maps to one of these rows, and
    `get_current_user` refuses tokens whose row is revoked or expired.
    """

    __tablename__ = "auth_sessions"

    id = Column(Integer, primary_key=True)
    jti = Column(String(64), unique=True, nullable=False, index=True)
    principal = Column(String(320), nullable=False, index=True)   # email
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    is_admin = Column(Boolean, nullable=False, default=False, index=True)

    issued_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)

    source_ip = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)
    # Coarse device fingerprint (hash of UA + accept-language). A session
    # suddenly presenting a different one is a session-theft signal.
    device_hash = Column(String(64), nullable=True, index=True)

    revoked_at = Column(DateTime(timezone=True), nullable=True, index=True)
    revoked_reason = Column(String(64), nullable=True)     # logout|admin|breach|rotation|expiry
    revoked_by = Column(String(320), nullable=True)

    mfa_satisfied = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("ix_auth_sessions_principal_active", "principal", "revoked_at"),
    )


class LoginAttempt(Base):
    """Every authentication attempt, successful or not.

    Feeds two things: the account-lockout decision (which needs the count of
    recent failures per account *and* per source IP, since credential stuffing
    spreads across accounts) and the brute-force alert rule.
    """

    __tablename__ = "login_attempts"

    id = Column(Integer, primary_key=True)
    attempted_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    principal = Column(String(320), nullable=False, index=True)
    surface = Column(String(16), nullable=False, default="learner")  # learner|admin|otp|reset
    successful = Column(Boolean, nullable=False, default=False, index=True)
    failure_reason = Column(String(64), nullable=True)
    source_ip = Column(String(64), nullable=True, index=True)
    user_agent = Column(String(512), nullable=True)

    __table_args__ = (
        Index("ix_login_attempts_principal_time", "principal", "attempted_at"),
        Index("ix_login_attempts_ip_time", "source_ip", "attempted_at"),
    )


class AccountLockout(Base):
    """An account temporarily barred from authenticating after repeated failures."""

    __tablename__ = "account_lockouts"

    id = Column(Integer, primary_key=True)
    principal = Column(String(320), nullable=False, index=True)
    locked_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=False, index=True)
    reason = Column(String(64), nullable=False, default="failed_attempts")
    failure_count = Column(Integer, nullable=False, default=0)
    cleared_at = Column(DateTime(timezone=True), nullable=True)
    cleared_by = Column(String(320), nullable=True)


class MfaEnrollment(Base):
    """TOTP second factor for privileged accounts.

    Keyed by principal (email) rather than users.id because an administrator is
    not necessarily a learner row. Secrets are stored sealed with the PHI key
    ring; recovery codes are stored as bcrypt hashes and are single-use.
    """

    __tablename__ = "mfa_enrollments"

    id = Column(Integer, primary_key=True)
    principal = Column(String(320), unique=True, nullable=False, index=True)
    secret_encrypted = Column(Text, nullable=False)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    # Monotonic counter of the last accepted TOTP step, so a code cannot be
    # replayed inside its own 30-second window.
    last_step = Column(Integer, nullable=True)
    recovery_codes = Column(Text, nullable=True)   # JSON list of bcrypt hashes
    disabled_at = Column(DateTime(timezone=True), nullable=True)


class PasswordHistory(Base):
    """Hashes of previously-used passwords, so a reset cannot reuse one."""

    __tablename__ = "password_history"

    id = Column(Integer, primary_key=True)
    principal = Column(String(320), nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ─────────────────────────────────────────────────────────────────────────────
# Detection and incident response
# ─────────────────────────────────────────────────────────────────────────────


class SecurityAlert(Base):
    """Something the detection rules judged worth a human look.

    Alerts are the bridge between the audit trail and the breach register: an
    alert that turns out to be real is promoted to a `BreachIncident`, and the
    link is kept so the timeline reads end to end.
    """

    __tablename__ = "security_alerts"

    id = Column(Integer, primary_key=True)
    raised_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    rule = Column(String(64), nullable=False, index=True)
    severity = Column(String(16), nullable=False, default="medium", index=True)  # low|medium|high|critical
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    actor_label = Column(String(320), nullable=True, index=True)
    source_ip = Column(String(64), nullable=True)
    evidence = Column(Text, nullable=True)          # JSON: counts, window, sample audit ids
    audit_event_ids = Column(Text, nullable=True)   # JSON list

    status = Column(String(16), nullable=False, default="open", index=True)  # open|investigating|dismissed|confirmed
    acknowledged_by = Column(String(320), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    resolution_note = Column(Text, nullable=True)
    incident_id = Column(Integer, ForeignKey("breach_incidents.id", ondelete="SET NULL"), nullable=True)

    incident = relationship("BreachIncident", back_populates="alerts")

    __table_args__ = (
        Index("ix_alerts_status_severity", "status", "severity", "raised_at"),
        # One rule + actor + window should not raise a hundred identical alerts.
        Index("ix_alerts_rule_actor_time", "rule", "actor_label", "raised_at"),
    )


class BreachIncident(Base):
    """The breach register.

    This is the artefact the MOU clause is really about. Each incident records
    the determination the clause demands — in whose custody, control or
    technical system the breach occurred — and drives the statutory clocks:

      * CERT-In (Directions of 28 Apr 2022, para (ii)): report within **6 hours**
        of noticing a reportable cyber incident.
      * DPDP Act 2023 s.8(6) with the DPDP Rules: intimate affected Data
        Principals **without delay**, and the Data Protection Board, with the
        detailed report due within **72 hours** of becoming aware.

    Deadlines are computed from `discovered_at`, never from `occurred_at` — the
    law starts the clock at awareness.
    """

    __tablename__ = "breach_incidents"

    id = Column(Integer, primary_key=True)
    reference = Column(String(32), unique=True, nullable=False, index=True)  # NH-IR-2026-0001
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    title = Column(String(255), nullable=False)
    summary = Column(Text, nullable=True)
    severity = Column(String(16), nullable=False, default="medium", index=True)
    status = Column(String(24), nullable=False, default="open", index=True)
    # open | contained | notified | closed | false_positive

    occurred_at = Column(DateTime(timezone=True), nullable=True)
    discovered_at = Column(DateTime(timezone=True), nullable=False)
    contained_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)

    # ── the MOU determination ──
    # custody_party: which side's system. nurturehub | state_govt | shared | third_party | undetermined
    custody_party = Column(String(32), nullable=False, default="undetermined", index=True)
    custody_rationale = Column(Text, nullable=True)
    controlling_system = Column(String(255), nullable=True)  # the concrete system/component
    fault_assessment = Column(Text, nullable=True)
    joint_process = Column(Boolean, nullable=False, default=False)

    # ── scope ──
    categories = Column(Text, nullable=True)        # JSON: ["mother_contact","child_growth",…]
    affected_subject_count = Column(Integer, nullable=True)
    affected_subject_ids = Column(Text, nullable=True)   # JSON list of internal ids
    phi_involved = Column(Boolean, nullable=False, default=True)
    root_cause = Column(Text, nullable=True)
    remediation = Column(Text, nullable=True)

    reported_by = Column(String(320), nullable=True)
    owner = Column(String(320), nullable=True)

    alerts = relationship("SecurityAlert", back_populates="incident")
    notifications = relationship(
        "BreachNotification", back_populates="incident", cascade="all, delete-orphan"
    )


class BreachNotification(Base):
    """One statutory or contractual notification obligation for an incident.

    Rows are created automatically when an incident is opened (one per
    applicable authority) so the deadline exists before anyone remembers it,
    and are then filled in as each notification actually goes out.
    """

    __tablename__ = "breach_notifications"

    id = Column(Integer, primary_key=True)
    incident_id = Column(
        Integer, ForeignKey("breach_incidents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # cert_in | dpb_initial | dpb_detailed | data_principals | mou_counterparty | internal
    authority = Column(String(32), nullable=False)
    authority_label = Column(String(160), nullable=False)
    legal_basis = Column(String(255), nullable=True)
    due_at = Column(DateTime(timezone=True), nullable=False, index=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    channel = Column(String(64), nullable=True)
    reference_number = Column(String(128), nullable=True)   # acknowledgement from the authority
    content = Column(Text, nullable=True)
    sent_by = Column(String(320), nullable=True)
    # not_applicable is recorded rather than deleted, with the reason, so the
    # register shows a decision was taken.
    not_applicable = Column(Boolean, nullable=False, default=False)
    not_applicable_reason = Column(Text, nullable=True)

    incident = relationship("BreachIncident", back_populates="notifications")

    __table_args__ = (
        UniqueConstraint("incident_id", "authority", name="uq_incident_authority"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Governance: lawful basis, data-principal rights, retention
# ─────────────────────────────────────────────────────────────────────────────


class ConsentRecord(Base):
    """Consent of a Data Principal to processing, per DPDP Act 2023 s.6.

    Health data about mothers and children is collected in the field by a
    health worker, so consent is captured at registration and must be:
    specific, informed, unconditional, revocable, and — for a child (s.9) —
    given by a parent or lawful guardian, with no tracking or behavioural
    monitoring of the child permitted.

    A withdrawal does not delete the record of the consent; it stamps
    `withdrawn_at`. Erasure is a separate, logged act (`ErasureRecord`).
    """

    __tablename__ = "consent_records"

    id = Column(Integer, primary_key=True)
    subject_type = Column(String(16), nullable=False, index=True)   # mother | child | learner
    subject_id = Column(Integer, nullable=False, index=True)

    purpose = Column(String(64), nullable=False, index=True)
    # care_delivery | growth_monitoring | programme_analytics | research | training
    notice_version = Column(String(32), nullable=False)
    notice_language = Column(String(16), nullable=False, default="en")

    granted = Column(Boolean, nullable=False, default=True)
    granted_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    withdrawn_at = Column(DateTime(timezone=True), nullable=True, index=True)
    withdrawal_reason = Column(Text, nullable=True)

    # Who actually gave it. For a child this is the guardian; s.9 makes
    # verifiable guardian consent a precondition, so the relationship and the
    # verification method are both recorded.
    given_by = Column(String(160), nullable=True)
    given_by_relationship = Column(String(64), nullable=True)
    is_guardian_consent = Column(Boolean, nullable=False, default=False)
    verification_method = Column(String(64), nullable=True)  # in_person | otp | signature | thumbprint

    captured_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    evidence_ref = Column(String(255), nullable=True)   # media URL of a signed/thumbprinted form

    __table_args__ = (
        UniqueConstraint("subject_type", "subject_id", "purpose", name="uq_consent_subject_purpose"),
        Index("ix_consent_subject", "subject_type", "subject_id"),
    )


class ProcessingActivity(Base):
    """Record of Processing Activities — what we hold, why, on what basis, for how long.

    Seeded from `security/ropa.py` and editable by the Data Protection Officer.
    Exporting this is the fastest honest answer to "what data do you hold about
    our citizens", which is the first question any government counterparty asks.
    """

    __tablename__ = "processing_activities"

    id = Column(Integer, primary_key=True)
    key = Column(String(64), unique=True, nullable=False, index=True)
    name = Column(String(160), nullable=False)
    purpose = Column(Text, nullable=False)
    lawful_basis = Column(String(160), nullable=False)
    data_categories = Column(Text, nullable=False)      # JSON list
    special_category = Column(Boolean, nullable=False, default=False)
    subject_categories = Column(Text, nullable=False)   # JSON list
    recipients = Column(Text, nullable=True)            # JSON list
    storage_location = Column(String(160), nullable=True)
    cross_border = Column(Boolean, nullable=False, default=False)
    retention_months = Column(Integer, nullable=True)
    retention_rationale = Column(Text, nullable=True)
    security_measures = Column(Text, nullable=True)     # JSON list
    controller = Column(String(160), nullable=True)
    processor = Column(String(160), nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    updated_by = Column(String(320), nullable=True)


class DataSubjectRequest(Base):
    """A right exercised under DPDP Act 2023 ss.11-14.

    access (s.11) | correction (s.12) | erasure (s.12) | grievance (s.13) |
    nominate (s.14). The Act requires a published grievance route and a response
    within the prescribed period; the due date is set on creation so an
    unanswered request is visibly overdue rather than quietly lost.
    """

    __tablename__ = "data_subject_requests"

    id = Column(Integer, primary_key=True)
    reference = Column(String(32), unique=True, nullable=False, index=True)  # NH-DSR-2026-0001
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    request_type = Column(String(24), nullable=False, index=True)
    subject_type = Column(String(16), nullable=False)
    subject_id = Column(Integer, nullable=True, index=True)
    subject_identifier = Column(String(255), nullable=True)  # what the requester gave us

    requested_by = Column(String(160), nullable=True)
    requester_relationship = Column(String(64), nullable=True)
    identity_verified = Column(Boolean, nullable=False, default=False)
    verification_method = Column(String(64), nullable=True)

    details = Column(Text, nullable=True)
    status = Column(String(24), nullable=False, default="received", index=True)
    # received | verifying | in_progress | fulfilled | rejected | withdrawn
    due_at = Column(DateTime(timezone=True), nullable=False, index=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    outcome = Column(Text, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    handled_by = Column(String(320), nullable=True)
    # Where the response went, so fulfilment is provable.
    response_ref = Column(String(255), nullable=True)


class ErasureRecord(Base):
    """Proof that data was destroyed, kept after the data itself is gone.

    DPDP s.8(7) requires erasure once the purpose is served and consent is
    withdrawn. The obligation then inverts: you must be able to show the
    deletion happened without keeping the deleted data. These rows hold only
    identifiers, counts and a hash of what was removed.
    """

    __tablename__ = "erasure_records"

    id = Column(Integer, primary_key=True)
    performed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    trigger = Column(String(32), nullable=False)   # retention | dsr | consent_withdrawal | manual
    request_id = Column(Integer, ForeignKey("data_subject_requests.id", ondelete="SET NULL"), nullable=True)

    subject_type = Column(String(16), nullable=True)
    subject_id = Column(Integer, nullable=True, index=True)
    subject_uid = Column(String(64), nullable=True)  # human-facing MR-/CR- id, kept for the register

    scope = Column(Text, nullable=False)            # JSON: {table: rows_deleted}
    rows_deleted = Column(Integer, nullable=False, default=0)
    method = Column(String(24), nullable=False, default="hard_delete")  # hard_delete | anonymise
    content_digest = Column(String(64), nullable=True)  # SHA-256 of what was removed
    performed_by = Column(String(320), nullable=True)
    note = Column(Text, nullable=True)


class RetentionPolicy(Base):
    """How long each class of data lives, and what happens when it expires.

    The retention sweeper reads these rather than hard-coded constants, so the
    schedule can be aligned with whatever the signed MOU annexure ends up
    saying without a code change.
    """

    __tablename__ = "retention_policies"

    id = Column(Integer, primary_key=True)
    key = Column(String(64), unique=True, nullable=False, index=True)
    label = Column(String(160), nullable=False)
    description = Column(Text, nullable=True)
    retention_days = Column(Integer, nullable=False)
    action = Column(String(24), nullable=False, default="delete")  # delete | anonymise | review
    enabled = Column(Boolean, nullable=False, default=True)
    legal_basis = Column(String(255), nullable=True)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_run_rows = Column(Integer, nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    updated_by = Column(String(320), nullable=True)
