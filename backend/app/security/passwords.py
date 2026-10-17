"""Password policy.

Two policies, because two very different people choose passwords here.

**Administrators** hold the keys to every identified maternal and child health
record, so their rule is deliberately closer to NIST SP 800-63B than to the
traditional complexity-classes approach — length carries the strength, and
forced symbol classes mostly produce `Password1!`:

* at least 12 characters, and three kinds of character unless 16+ long
* not a password attackers try first, nor built from the account's own name
  or email
* no keyboard runs, no single character repeated, enough distinct characters

**Learners** are field health workers typing on a shared phone, many of them
new to passwords. The supervisors' review of 17 Oct 2026 asked for "very
minimalistic rules — don't bring in too many rules because they tend to
forget it", e.g. four letters and four numbers, but "no sequential numbers".
So a learner's password needs only:

* at least 8 characters (NIST's own floor), with letters and numbers
* no run of 4+ consecutive numbers (1234, 9876)
* not one of the passwords attackers try first

…and everything the administrators' rule would have refused besides is not a
refusal but a nudge: the account is marked `password_weak` and the learner is
asked — on the form and again after signing in — to choose a harder one. The
trade-off is paired with lockout and rate limiting, which is what actually
stops guessing at this length.

Both: no reuse of the account's recent passwords, and no forced expiry (which
the same guidance advises against: rotation on a timer drives users to
predictable increments). Rotation is event-triggered — on a suspected
compromise the incident workflow revokes sessions and forces a reset.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable, Optional

MIN_LENGTH_LEARNER = 8
MIN_LENGTH_ADMIN = 12
MAX_LENGTH = 128           # bcrypt truncates at 72 bytes; reject long inputs outright
PASSWORD_HISTORY_DEPTH = 5
NUMBER_RUN_LENGTH = 4      # learners: 1234 / 9876 refused
# The administrators' rule — and, for learners, the "is this easy to guess?" test.
STRONG_MIN_LENGTH = 10
MIN_CHARACTER_KINDS = 3    # of: lowercase, uppercase, digits, symbols …
PASSPHRASE_LENGTH = 16     # … unless the password is at least this long
MIN_DISTINCT_CHARACTERS = 5
MAX_REPEAT = 3             # the same character 4+ times in a row
KEYBOARD_RUN_LENGTH = 5    # shortest keyboard/number run that counts
PERSONAL_TOKEN_LENGTH = 4  # name/email pieces this long or longer may not appear

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
# Also "easy" for a learner (never refused): the alphabet in order.
_EASY_RUNS = _KEYBOARD_RUNS + ("abcdefghijklmnopqrstuvwxyz",)


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
            if len(token) >= PERSONAL_TOKEN_LENGTH:
                out.add(token)
    return out


def _has_run(lowered: str, runs=_KEYBOARD_RUNS, length: int = KEYBOARD_RUN_LENGTH) -> bool:
    for run in runs:
        for size in range(length, len(run) + 1):
            for start in range(len(run) - size + 1):
                chunk = run[start:start + size]
                if chunk in lowered or chunk[::-1] in lowered:
                    return True
    return False


def _has_keyboard_run(lowered: str) -> bool:
    return _has_run(lowered)


def _has_number_run(password: str) -> bool:
    """1234, 2345 … 9876 — four or more numbers counting up or down by one."""
    run_up = run_down = 1
    for a, b in zip(password, password[1:]):
        if a.isdigit() and b.isdigit():
            run_up = run_up + 1 if int(b) == int(a) + 1 else 1
            run_down = run_down + 1 if int(b) == int(a) - 1 else 1
        else:
            run_up = run_down = 1
        if run_up >= NUMBER_RUN_LENGTH or run_down >= NUMBER_RUN_LENGTH:
            return True
    return False


def _is_common(lowered: str) -> bool:
    return lowered in _COMMON or re.sub(r"[^a-z]", "", lowered) in _COMMON


def describe_policy(is_admin: bool = False) -> dict:
    """Machine-readable policy, so the UI states — and checks as the person
    types — every rule `validate` enforces, with the same numbers.

    Everything here is built from the constants `validate` uses, so the two
    cannot drift (tests/test_password_policy.py holds them to that). The
    common-password list is included on purpose: it is the head of every
    public credential-stuffing list, so publishing it costs nothing, and it
    lets the form say "too common" before the person presses Create.
    """
    common = {
        "max_length": MAX_LENGTH,
        "history_depth": PASSWORD_HISTORY_DEPTH,
        "min_character_kinds": MIN_CHARACTER_KINDS,
        "passphrase_length": PASSPHRASE_LENGTH,
        "min_distinct_characters": MIN_DISTINCT_CHARACTERS,
        "max_repeat": MAX_REPEAT,
        "keyboard_run_length": KEYBOARD_RUN_LENGTH,
        "keyboard_runs": list(_KEYBOARD_RUNS),
        "personal_token_length": PERSONAL_TOKEN_LENGTH,
        "common_passwords": sorted(_COMMON),
    }
    if not is_admin:
        return {
            **common,
            "style": "simple",
            "min_length": MIN_LENGTH_LEARNER,
            "number_run_length": NUMBER_RUN_LENGTH,
            "strong_min_length": STRONG_MIN_LENGTH,
            "rules": [
                f"At least {MIN_LENGTH_LEARNER} characters, with letters and numbers "
                f"(or {PASSPHRASE_LENGTH}+ characters of any kind).",
                f"No {NUMBER_RUN_LENGTH} numbers in a row counting up or down, such as 1234 or 9876.",
                "Not a commonly used password.",
                "No space at the start or end.",
                f"Not one of your last {PASSWORD_HISTORY_DEPTH} passwords.",
            ],
        }
    return {
        **common,
        "style": "strict",
        "min_length": MIN_LENGTH_ADMIN,
        "rules": [
            f"Between {MIN_LENGTH_ADMIN} and {MAX_LENGTH} characters.",
            f"At least {MIN_CHARACTER_KINDS} kinds of character (lowercase, uppercase, numbers, "
            f"symbols), or {PASSPHRASE_LENGTH}+ characters of any kind.",
            "Not a commonly used password.",
            f"No keyboard runs such as 'qwerty' or '12345', no character {MAX_REPEAT + 1} or more "
            f"times in a row, and at least {MIN_DISTINCT_CHARACTERS} different characters.",
            "Not based on your name or email address.",
            "No space at the start or end.",
            f"Not one of your last {PASSWORD_HISTORY_DEPTH} passwords.",
        ],
    }


def _strict_problem(password: str, *, minimum: int, email: Optional[str],
                    full_name: Optional[str]) -> Optional[str]:
    """The administrators' rule: the first thing it would refuse, or None."""
    if len(password) < minimum:
        return f"Password must be at least {minimum} characters for administrator accounts."
    lowered = password.lower()
    if _is_common(lowered):
        return "That password is too common. Choose something less predictable."
    # A long passphrase does not need character classes; a short password does.
    classes = sum(
        bool(pattern.search(password))
        for pattern in (
            re.compile(r"[a-z]"), re.compile(r"[A-Z]"),
            re.compile(r"\d"), re.compile(r"[^A-Za-z0-9]"),
        )
    )
    if len(password) < PASSPHRASE_LENGTH and classes < MIN_CHARACTER_KINDS:
        return ("Use at least three of: lowercase, uppercase, numbers, symbols — "
                f"or make the password {PASSPHRASE_LENGTH} characters or longer.")
    if len(set(lowered)) < MIN_DISTINCT_CHARACTERS:
        return "Password repeats too few distinct characters."
    if re.search(r"(.)\1{%d,}" % MAX_REPEAT, password):
        return "Password contains a character repeated four or more times."
    if _has_keyboard_run(lowered):
        return "Password contains a keyboard sequence such as 'qwerty' or '12345'."
    for token in _tokens(email.split("@")[0] if email else None, full_name):
        if token in lowered:
            return "Password must not contain your name or email address."
    return None


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

    if len(password) > MAX_LENGTH:
        raise PasswordPolicyError(f"Password must be {MAX_LENGTH} characters or fewer.")
    if password != password.strip():
        raise PasswordPolicyError("Password cannot start or end with a space.")

    if is_admin:
        problem = _strict_problem(password, minimum=minimum, email=email, full_name=full_name)
        if problem:
            raise PasswordPolicyError(problem)
        return

    if len(password) < minimum:
        raise PasswordPolicyError(f"Password must be at least {minimum} characters.")
    # Letters and numbers — unless it is a long passphrase, where length
    # carries the strength (NIST SP 800-63B).
    if len(password) < PASSPHRASE_LENGTH and (
            not re.search(r"[^\W\d_]", password) or not re.search(r"\d", password)):
        raise PasswordPolicyError("Use both letters and numbers in your password.")
    if _has_number_run(password):
        raise PasswordPolicyError(
            f"Do not use {NUMBER_RUN_LENGTH} numbers in a row counting up or down, like 1234 or 9876.")
    if _is_common(password.lower()):
        raise PasswordPolicyError("That password is too common. Choose something less predictable.")


def is_weak(password: str, *, email: Optional[str] = None, full_name: Optional[str] = None) -> bool:
    """Accepted for a learner, but easy to guess: anything the stronger rule
    would refuse (short, one kind of character, repeats, "abcd", a name).
    Drives the "choose a harder password" nudge, never a refusal."""
    password = _normalise(password or "")
    if _strict_problem(password, minimum=STRONG_MIN_LENGTH, email=email, full_name=full_name):
        return True
    return _has_run(password.lower(), _EASY_RUNS, NUMBER_RUN_LENGTH)


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
