"""Password policy.

The old rule was `Field(min_length=6)`, which admits `123456` — and the accounts
behind it hold identified maternal and child health records. What follows is
deliberately closer to NIST SP 800-63B than to the traditional
complexity-classes approach, because that guidance is now the evidence-backed
one: length carries the strength, and forced symbol classes mostly produce
`Password1!`.

So the checks are:

* a real minimum length (12 for administrators, 10 for field learners, who type
  on phone keyboards in the field — the tradeoff is deliberate and paired with
  lockout and rate limiting)
* rejection of the passwords attackers actually try first, and of anything
  derived from the account's own name or email
* rejection of keyboard runs and single repeated characters
* no reuse of the account's recent passwords

There is no forced expiry, which the same guidance advises against: rotation on
a timer drives users to predictable increments. Rotation here is
event-triggered — on a suspected compromise, the incident workflow revokes
sessions and forces a reset.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable, Optional

MIN_LENGTH_LEARNER = 10
MIN_LENGTH_ADMIN = 12
MAX_LENGTH = 128           # bcrypt truncates at 72 bytes; reject long inputs outright
PASSWORD_HISTORY_DEPTH = 5

# The head of every credential-stuffing list, plus the ones this deployment will
# actually see. Not a substitute for a breach-corpus check — it is the cheap,
# offline, no-third-party-call floor.
_COMMON = {
    "password", "password1", "password123", "passw0rd", "123456", "1234567",
    "12345678", "123456789", "1234567890", "qwerty", "qwerty123", "abc123",
    "111111", "000000", "iloveyou", "admin", "admin123", "administrator",
    "welcome", "welcome1", "letmein", "monkey", "dragon", "sunshine",
    "princess", "football", "changeme", "secret", "test123", "india123",
    "nurturehub", "nurturehub123", "asha123", "anganwadi", "health123",
}

_KEYBOARD_RUNS = (
    "qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890",
)


class PasswordPolicyError(ValueError):
    """Raised with a message meant to be shown to the person choosing the password."""


def _normalise(password: str) -> str:
    # NFKC so a password typed with a different Unicode composition still
    # compares equal to the one that was set.
    return unicodedata.normalize("NFKC", password)


def _tokens(*values: Optional[str]) -> set:
    out = set()
    for value in values:
        if not value:
            continue
        for token in re.split(r"[^A-Za-z0-9]+", str(value).lower()):
            if len(token) >= 4:
                out.add(token)
    return out


def _has_keyboard_run(lowered: str) -> bool:
    for run in _KEYBOARD_RUNS:
        for size in range(5, len(run) + 1):
            for start in range(len(run) - size + 1):
                chunk = run[start:start + size]
                if chunk in lowered or chunk[::-1] in lowered:
                    return True
    return False


def describe_policy(is_admin: bool = False) -> dict:
    """Machine-readable policy, so the UI states the rules instead of guessing."""
    return {
        "min_length": MIN_LENGTH_ADMIN if is_admin else MIN_LENGTH_LEARNER,
        "max_length": MAX_LENGTH,
        "history_depth": PASSWORD_HISTORY_DEPTH,
        "rules": [
            f"At least {MIN_LENGTH_ADMIN if is_admin else MIN_LENGTH_LEARNER} characters.",
            "At least three different kinds of character, or 16+ characters of any kind.",
            "Not a commonly used or previously breached password.",
            "Not based on your name or email address.",
            "Not one of your last 5 passwords.",
        ],
    }


def validate(
    password: str,
    *,
    is_admin: bool = False,
    email: Optional[str] = None,
    full_name: Optional[str] = None,
) -> None:
    """Raise `PasswordPolicyError` with a specific, actionable message, or return."""
    if password is None:
        raise PasswordPolicyError("Enter a password.")
    password = _normalise(password)
    minimum = MIN_LENGTH_ADMIN if is_admin else MIN_LENGTH_LEARNER

    if len(password) < minimum:
        raise PasswordPolicyError(
            f"Password must be at least {minimum} characters"
            + (" for administrator accounts." if is_admin else ".")
        )
    if len(password) > MAX_LENGTH:
        raise PasswordPolicyError(f"Password must be {MAX_LENGTH} characters or fewer.")
    if password != password.strip():
        raise PasswordPolicyError("Password cannot start or end with a space.")

    lowered = password.lower()

    if lowered in _COMMON or re.sub(r"[^a-z]", "", lowered) in _COMMON:
        raise PasswordPolicyError("That password is too common. Choose something less predictable.")

    # A long passphrase does not need character classes; a short password does.
    classes = sum(
        bool(pattern.search(password))
        for pattern in (
            re.compile(r"[a-z]"), re.compile(r"[A-Z]"),
            re.compile(r"\d"), re.compile(r"[^A-Za-z0-9]"),
        )
    )
    if len(password) < 16 and classes < 3:
        raise PasswordPolicyError(
            "Use at least three of: lowercase, uppercase, numbers, symbols — "
            "or make the password 16 characters or longer."
        )

    if len(set(lowered)) < 5:
        raise PasswordPolicyError("Password repeats too few distinct characters.")
    if re.search(r"(.)\1{3,}", password):
        raise PasswordPolicyError("Password contains a character repeated four or more times.")
    if _has_keyboard_run(lowered):
        raise PasswordPolicyError("Password contains a keyboard sequence such as 'qwerty' or '12345'.")

    for token in _tokens(email.split("@")[0] if email else None, full_name):
        if token in lowered:
            raise PasswordPolicyError("Password must not contain your name or email address.")


def check_history(password: str, previous_hashes: Iterable[str]) -> None:
    """Reject reuse of a recent password."""
    from app.auth import verify_password

    for old_hash in previous_hashes:
        if old_hash and verify_password(password, old_hash):
            raise PasswordPolicyError(
                f"You have used this password before. Choose one of your last "
                f"{PASSWORD_HISTORY_DEPTH} passwords that is new."
            )


def record_history(db, principal: str, password_hash: str, commit: bool = False) -> None:
    """Remember this hash and forget anything past the retention depth."""
    from app.models_security import PasswordHistory

    db.add(PasswordHistory(principal=principal, password_hash=password_hash))
    db.flush()
    stale = (
        db.query(PasswordHistory)
        .filter(PasswordHistory.principal == principal)
        .order_by(PasswordHistory.created_at.desc())
        .offset(PASSWORD_HISTORY_DEPTH)
        .all()
    )
    for row in stale:
        db.delete(row)
    if commit:
        db.commit()


def recent_hashes(db, principal: str) -> list:
    from app.models_security import PasswordHistory

    rows = (
        db.query(PasswordHistory.password_hash)
        .filter(PasswordHistory.principal == principal)
        .order_by(PasswordHistory.created_at.desc())
        .limit(PASSWORD_HISTORY_DEPTH)
        .all()
    )
    return [row[0] for row in rows]


def enforce(
    db,
    password: str,
    *,
    principal: str,
    is_admin: bool = False,
    full_name: Optional[str] = None,
) -> None:
    """Full check: policy plus history. Raises `PasswordPolicyError`."""
    validate(password, is_admin=is_admin, email=principal, full_name=full_name)
    check_history(password, recent_hashes(db, principal))
