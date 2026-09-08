"""Brute-force and credential-stuffing defence.

The existing rate limiter caps requests *per IP*, which is the wrong axis on its
own for this deployment. An attacker spreading attempts across many IPs never
trips it, and — the more important direction — an entire ICDS block office often
sits behind one NAT address, so an IP-level block would sign out a whole
district because one person mistyped their password.

So the two axes are handled differently and deliberately:

* **Per account.** Repeated failures lock that account for a cooling-off period
  that lengthens with each repeat. This is the one that actually stops guessing.
* **Per source address.** Failures spread across *many distinct accounts* from
  one address is the signature of credential stuffing. That raises an alert for
  a human, and never a block — precisely because of the NAT problem above.

Lockouts are temporary and self-clearing. A permanent lock would hand an
attacker a denial-of-service against any account whose email they know.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config import settings
from app.security import audit


def _now() -> datetime:
    return datetime.now(timezone.utc)


def record_attempt(
    db,
    *,
    principal: str,
    successful: bool,
    surface: str = "learner",
    reason: Optional[str] = None,
    request=None,
    commit: bool = True,
):
    """Log one authentication attempt and, on failure, decide about a lockout.

    Returns the `AccountLockout` row if this attempt triggered one, else None.
    """
    from app.models_security import LoginAttempt
    from app.security.context import client_ip

    principal = (principal or "").strip().lower()[:320]
    ip = client_ip(request) if request is not None else None
    db.add(
        LoginAttempt(
            principal=principal,
            surface=surface,
            successful=successful,
            failure_reason=reason,
            source_ip=ip,
            user_agent=(request.headers.get("user-agent") or "")[:512] if request is not None else None,
        )
    )

    if successful:
        clear(db, principal, by="successful_login", commit=False)
        if commit:
            db.commit()
        return None

    triggered = _evaluate_account(db, principal, ip)
    _evaluate_source(db, ip)
    if commit:
        db.commit()
    return triggered


def _evaluate_account(db, principal: str, ip: Optional[str]):
    from app.models_security import AccountLockout, LoginAttempt

    window_start = _now() - timedelta(minutes=settings.LOCKOUT_WINDOW_MINUTES)
    failures = (
        db.query(LoginAttempt)
        .filter(
            LoginAttempt.principal == principal,
            LoginAttempt.successful.is_(False),
            LoginAttempt.attempted_at >= window_start,
        )
        .count()
    )
    if failures < settings.LOCKOUT_THRESHOLD:
        return None

    # Each lockout in the last day makes the next one longer, so a patient
    # attacker gets slower rather than getting unlimited retries at a fixed cost.
    day_ago = _now() - timedelta(days=1)
    prior = (
        db.query(AccountLockout)
        .filter(AccountLockout.principal == principal, AccountLockout.locked_at >= day_ago)
        .count()
    )
    minutes = min(
        settings.LOCKOUT_DURATION_MINUTES * (2 ** min(prior, 5)),
        settings.LOCKOUT_MAX_MINUTES,
    )
    lockout = AccountLockout(
        principal=principal,
        locked_until=_now() + timedelta(minutes=minutes),
        reason="failed_attempts",
        failure_count=failures,
    )
    db.add(lockout)
    audit.record_sync(
        audit.Action.ACCOUNT_LOCKED,
        db=db,
        resource_type="account",
        resource_id=principal,
        outcome="denied",
        actor_override={"actor_type": "system", "actor_label": "lockout-policy"},
        detail={
            "principal": principal,
            "failures_in_window": failures,
            "window_minutes": settings.LOCKOUT_WINDOW_MINUTES,
            "locked_minutes": minutes,
            "prior_lockouts_24h": prior,
            "source_ip": ip,
        },
    )
    from app.security.anomaly import raise_alert

    raise_alert(
        db,
        rule="account_lockout",
        severity="medium" if prior == 0 else "high",
        title=f"Account locked after {failures} failed sign-in attempts",
        description=(
            f"{principal} was locked for {minutes} minutes. "
            + ("This account has been locked before in the last 24 hours." if prior else "")
        ),
        actor_label=principal,
        source_ip=ip,
        evidence={"failures": failures, "locked_minutes": minutes, "prior_lockouts_24h": prior},
        commit=False,
    )
    return lockout


def _evaluate_source(db, ip: Optional[str]) -> None:
    """Many accounts failing from one address = credential stuffing. Alert only."""
    if not ip:
        return
    from sqlalchemy import func as sql_func

    from app.models_security import LoginAttempt

    window_start = _now() - timedelta(minutes=settings.LOCKOUT_WINDOW_MINUTES)
    distinct_accounts = (
        db.query(sql_func.count(sql_func.distinct(LoginAttempt.principal)))
        .filter(
            LoginAttempt.source_ip == ip,
            LoginAttempt.successful.is_(False),
            LoginAttempt.attempted_at >= window_start,
        )
        .scalar()
        or 0
    )
    if distinct_accounts < settings.STUFFING_ACCOUNT_THRESHOLD:
        return

    from app.security.anomaly import raise_alert

    raise_alert(
        db,
        rule="credential_stuffing",
        severity="high",
        title=f"Failed sign-ins against {distinct_accounts} different accounts from one address",
        description=(
            f"{ip} failed to sign in to {distinct_accounts} distinct accounts within "
            f"{settings.LOCKOUT_WINDOW_MINUTES} minutes. No IP block was applied — field "
            "offices share one address — so this needs a human decision."
        ),
        source_ip=ip,
        evidence={
            "distinct_accounts": distinct_accounts,
            "window_minutes": settings.LOCKOUT_WINDOW_MINUTES,
        },
        dedupe_minutes=60,
        commit=False,
    )


def active_lockout(db, principal: str):
    """The live lockout for this account, or None."""
    from app.models_security import AccountLockout

    principal = (principal or "").strip().lower()
    return (
        db.query(AccountLockout)
        .filter(
            AccountLockout.principal == principal,
            AccountLockout.cleared_at.is_(None),
            AccountLockout.locked_until > _now(),
        )
        .order_by(AccountLockout.locked_until.desc())
        .first()
    )


def seconds_remaining(lockout) -> int:
    until = lockout.locked_until
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return max(int((until - _now()).total_seconds()), 0)


def clear(db, principal: str, by: str = "admin", commit: bool = True) -> int:
    """Lift any live lockout on an account (a successful sign-in, or an admin unlocking)."""
    from app.models_security import AccountLockout

    principal = (principal or "").strip().lower()
    rows = (
        db.query(AccountLockout)
        .filter(AccountLockout.principal == principal, AccountLockout.cleared_at.is_(None))
        .all()
    )
    if not rows:
        return 0
    for row in rows:
        row.cleared_at = _now()
        row.cleared_by = by
    if by != "successful_login":
        audit.record_sync(
            audit.Action.ACCOUNT_UNLOCKED,
            db=db,
            resource_type="account",
            resource_id=principal,
            detail={"principal": principal, "cleared_by": by, "lockouts_cleared": len(rows)},
        )
    if commit:
        db.commit()
    return len(rows)
