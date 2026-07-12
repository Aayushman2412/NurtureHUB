"""
Live monitoring models for real-time test tracking.

These models support the admin live monitoring dashboard:
- LiveSession: one per active test attempt, stores denormalized progress state
- ActivityEvent: granular event log for every user action during a test
- SuspiciousFlag: flagged behaviors detected by the rules engine
- AdminAction: admin interventions (flag, warn, force-submit, notes)
"""

from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Float, Text,
    ForeignKey, JSON, Index, BigInteger
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class LiveSession(Base):
    """
    Tracks an active candidate's real-time state during a test attempt.

    This is the single source of truth for the admin dashboard — each row
    is a denormalized snapshot of one candidate's progress, updated on every
    incoming event. This avoids expensive event aggregation queries.
    """
    __tablename__ = "live_sessions"

    id = Column(Integer, primary_key=True, index=True)
    attempt_id = Column(Integer, ForeignKey("test_attempts.id", ondelete="CASCADE"), nullable=False, unique=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    test_id = Column(Integer, ForeignKey("tests.id", ondelete="CASCADE"), nullable=False)

    # Connection metadata
    status = Column(String, nullable=False, default="not_started")
    # Possible statuses: not_started, started, active, idle, submitted,
    #                     disconnected, auto_submitted
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    device_fingerprint = Column(String, nullable=True)
    connected_at = Column(DateTime(timezone=True), nullable=True)
    disconnected_at = Column(DateTime(timezone=True), nullable=True)
    last_heartbeat = Column(DateTime(timezone=True), nullable=True)

    # Denormalized progress (updated on each event)
    current_question = Column(Integer, default=1)  # 1-indexed question number being viewed
    total_questions = Column(Integer, default=0)
    questions_attempted = Column(Integer, default=0)
    questions_unanswered = Column(Integer, default=0)
    questions_viewed = Column(Integer, default=0)  # viewed but not answered
    questions_skipped = Column(Integer, default=0)
    correct_answers = Column(Integer, default=0)
    wrong_answers = Column(Integer, default=0)
    accuracy_pct = Column(Float, default=0.0)

    # Time tracking
    test_started_at = Column(DateTime(timezone=True), nullable=True)
    time_spent_seconds = Column(Integer, default=0)
    remaining_seconds = Column(Integer, default=0)
    avg_time_per_question_ms = Column(Integer, default=0)
    fastest_question_ms = Column(Integer, nullable=True)
    slowest_question_ms = Column(Integer, nullable=True)

    # Behavioral metrics
    tab_switch_count = Column(Integer, default=0)
    fullscreen_exit_count = Column(Integer, default=0)
    window_blur_count = Column(Integer, default=0)
    copy_paste_count = Column(Integer, default=0)
    idle_periods = Column(Integer, default=0)  # count of idle periods > 3min
    question_switch_count = Column(Integer, default=0)

    # Risk scoring (0-100)
    risk_score = Column(Integer, default=0)
    is_flagged = Column(Boolean, default=False)
    flag_reason = Column(Text, nullable=True)

    # Navigation pattern (stored as JSON array of question IDs visited)
    navigation_pattern = Column(JSON, default=list)

    # Answer state (JSON map: question_id -> {selected_option_id, is_correct, time_ms})
    answer_state = Column(JSON, default=dict)

    # Sequence tracking for idempotent event processing
    last_sequence = Column(BigInteger, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    attempt = relationship("TestAttempt")
    user = relationship("User")
    test = relationship("Test")
    events = relationship("ActivityEvent", back_populates="session", cascade="all, delete-orphan")
    suspicious_flags = relationship("SuspiciousFlag", back_populates="session", cascade="all, delete-orphan")
    admin_actions = relationship("AdminAction", back_populates="session", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_live_sessions_test_id_status", "test_id", "status"),
        Index("ix_live_sessions_user_test", "user_id", "test_id"),
        Index("ix_live_sessions_risk", "test_id", "risk_score"),
    )


class ActivityEvent(Base):
    """
    Granular event log — every user action during a test is recorded here.
    Used for detailed timeline views and post-test analysis.
    """
    __tablename__ = "activity_events"

    # SQLite only auto-increments an INTEGER primary key (it aliases ROWID); a
    # BIGINT PK there inserts NULL and fails the NOT NULL constraint, which would
    # break the whole event pipeline. Use INTEGER on SQLite, BIGINT on Postgres.
    id = Column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True, index=True, autoincrement=True,
    )
    session_id = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String, nullable=False)
    # Event types: QUESTION_VIEWED, ANSWER_SELECTED, ANSWER_CHANGED,
    #   ANSWER_CLEARED, ANSWER_MARKED_REVIEW, TEST_SUBMITTED, TEST_AUTO_SUBMITTED,
    #   TAB_SWITCH, FULLSCREEN_EXIT, WINDOW_BLUR, WINDOW_FOCUS,
    #   HEARTBEAT, COPY_PASTE_DETECTED, CONNECTED, DISCONNECTED,
    #   WARNING_RECEIVED, FLAGGED_BY_ADMIN

    sequence_number = Column(BigInteger, nullable=False)
    question_id = Column(Integer, nullable=True)
    payload = Column(JSON, default=dict)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship
    session = relationship("LiveSession", back_populates="events")

    __table_args__ = (
        Index("ix_activity_events_session_type", "session_id", "event_type"),
        Index("ix_activity_events_session_ts", "session_id", "timestamp"),
    )


class SuspiciousFlag(Base):
    """
    Flagged suspicious behaviors detected by the rules engine.
    Each flag is linked to a specific session and has a severity level.
    """
    __tablename__ = "suspicious_flags"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    rule_name = Column(String, nullable=False)
    # Rule names: RAPID_ANSWERING, EXCESSIVE_TAB_SWITCHES, FULLSCREEN_EXIT,
    #   LONG_IDLE, MULTIPLE_DEVICES, RAPID_NAVIGATION, COPY_PASTE,
    #   ANSWER_PATTERN_ANOMALY
    severity = Column(String, nullable=False, default="medium")
    # Severity: low, medium, high, critical
    details = Column(Text, nullable=True)
    risk_contribution = Column(Integer, default=0)  # points added to risk_score
    detected_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship
    session = relationship("LiveSession", back_populates="suspicious_flags")

    __table_args__ = (
        Index("ix_suspicious_flags_session", "session_id", "detected_at"),
    )


class AdminAction(Base):
    """
    Records admin interventions during live monitoring.
    Provides an audit trail of all admin actions on candidates.
    """
    __tablename__ = "admin_actions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    admin_email = Column(String, nullable=False)
    action_type = Column(String, nullable=False)
    # Action types: FLAG, UNFLAG, ADD_NOTE, SEND_WARNING, FORCE_SUBMIT,
    #   PAUSE, RESUME, BLOCK
    notes = Column(Text, nullable=True)
    metadata_json = Column(JSON, default=dict)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship
    session = relationship("LiveSession", back_populates="admin_actions")

    __table_args__ = (
        Index("ix_admin_actions_session", "session_id", "timestamp"),
    )
