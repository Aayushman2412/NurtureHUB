"""Masking and redaction.

Used in three places, for three different reasons:

* **Audit details.** An audit row records *that* a phone number was read, never
  the number. A log that copies the data it protects is a second copy of the
  breach surface.
* **Application logs.** `print()`/`logging` output ends up in `docker logs`,
  which is readable by anyone with shell on the host and is shipped to whatever
  collects container output. `install_log_redaction()` puts a filter in front of
  the root logger so a stray f-string containing a mobile number is masked on
  the way out.
* **Role-scoped responses.** Not every operator needs the identifiers. An
  analyst reading growth trends needs the measurements, not the mother's phone;
  `mask_record()` applies that at the serialisation boundary.

Masks keep enough to be useful for reconciliation ("is this the same number I
have?") and lose enough not to be the number.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Iterable, Optional

# Keys whose values are direct or quasi identifiers. Matched case-insensitively
# against the *end* of a key too, so `mother_mobile` and `alternate_mobile` are
# both caught without listing every prefix.
SENSITIVE_KEYS = {
    "password", "password_hash", "new_password", "current_password", "otp",
    "otp_code", "token", "access_token", "id_token", "refresh_token", "secret",
    "secret_encrypted", "authorization", "api_key", "jwt", "recovery_codes",
    "mobile", "alternate_mobile", "phone", "alternate_phone", "email",
    "mother_name", "child_name", "full_name", "guardian_name", "given_by",
    "aadhaar", "aadhar", "abha", "ration_card", "address", "dob",
    "date_of_birth", "mother_dob", "lmp", "edd_lmp", "edd_records",
}

_SUFFIX_KEYS = ("_mobile", "_phone", "_email", "_name", "_dob", "_password", "_token")

REDACTED = "[redacted]"

# Value-level patterns, for free text where we do not control the key.
#
# Order matters: the Aadhaar pattern runs first so a 12-digit id is consumed
# whole rather than having part of it matched by something else.
#
# The mobile pattern allows a separator in the middle. People write numbers the
# way they say them — "+91 98765 43210" — and an earlier version that required
# ten consecutive digits left "98765" sitting in the log, which is most of the
# number.
_PATTERNS = (
    # Aadhaar-shaped 12-digit runs, grouped or not.
    (
        re.compile(r"(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)"),
        lambda m: "XXXX-XXXX-" + re.sub(r"\D", "", m.group(0))[-4:],
    ),
    # Indian mobile: optional +91/0 prefix, then 10 digits starting 6-9,
    # optionally split 5+5 or 4+6 the way they are usually written.
    (
        re.compile(r"(?<!\d)(?:\+?91[\-\s]?|0)?([6-9]\d{3,4})[\-\s]?(\d{5,6})(?!\d)"),
        lambda m: (
            "*" * 7 + (m.group(1) + m.group(2))[-3:]
            if len(m.group(1) + m.group(2)) == 10
            else m.group(0)
        ),
    ),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"), lambda m: _mask_email_value(m.group(0))),
)


def _mask_email_value(value: str) -> str:
    local, _, domain = value.partition("@")
    if not domain:
        return REDACTED
    keep = local[:1] if local else ""
    return f"{keep}{'*' * max(len(local) - 1, 2)}@{domain}"


def mask_email(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    return _mask_email_value(value)


def mask_phone(value: Optional[str]) -> Optional[str]:
    """Keep the last three digits — enough to confirm a match, not to dial."""
    if not value:
        return value
    digits = re.sub(r"\D", "", value)
    if len(digits) < 4:
        return REDACTED
    return "*" * (len(digits) - 3) + digits[-3:]


def mask_name(value: Optional[str]) -> Optional[str]:
    """Initials only: 'Sunita Kamble' -> 'S. K.'"""
    if not value:
        return value
    parts = [p for p in re.split(r"\s+", value.strip()) if p]
    if not parts:
        return REDACTED
    return " ".join(f"{p[0].upper()}." for p in parts[:3])


def is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    if lowered in SENSITIVE_KEYS:
        return True
    return any(lowered.endswith(suffix) for suffix in _SUFFIX_KEYS)


def redact_text(value: str) -> str:
    """Mask identifier-shaped substrings inside free text."""
    out = value
    for pattern, repl in _PATTERNS:
        out = pattern.sub(repl, out)
    return out


def redact(value: Any, _depth: int = 0) -> Any:
    """Deep-redact a JSON-ish structure for safe storage in an audit detail.

    Sensitive keys lose their values entirely; everything else is scanned for
    identifier-shaped text. Depth is capped so a cyclic or pathologically nested
    payload cannot spin here.
    """
    if _depth > 8:
        return "[truncated]"
    if isinstance(value, dict):
        return {
            k: (REDACTED if is_sensitive_key(str(k)) else redact(v, _depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [redact(v, _depth + 1) for v in list(value)[:50]]
    if isinstance(value, str):
        return redact_text(value[:2000])
    return value


def mask_record(record: dict, fields: Iterable[str] = ()) -> dict:
    """Return a copy with the named identifier fields masked rather than removed.

    Removing them changes the response shape and breaks clients; masking keeps
    the contract while withholding the value.
    """
    masked = dict(record)
    for name in fields:
        if name not in masked:
            continue
        value = masked[name]
        if value is None:
            continue
        lowered = name.lower()
        if "mobile" in lowered or "phone" in lowered:
            masked[name] = mask_phone(str(value))
        elif "email" in lowered:
            masked[name] = mask_email(str(value))
        elif "name" in lowered:
            masked[name] = mask_name(str(value))
        else:
            masked[name] = REDACTED
    return masked


class _RedactingFilter(logging.Filter):
    """Masks identifier-shaped text in every log record that passes through."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: D102
        try:
            if isinstance(record.msg, str) and record.msg:
                record.msg = redact_text(record.msg)
            if record.args:
                if isinstance(record.args, dict):
                    record.args = {k: redact(v) for k, v in record.args.items()}
                else:
                    record.args = tuple(redact(a) for a in record.args)
        except Exception:  # noqa: BLE001 — logging must never raise
            pass
        return True


_installed = False


def install_log_redaction() -> None:
    """Attach the redacting filter to the root logger and uvicorn's loggers.

    Filters on a logger only apply to records logged directly to it, not to
    records propagated from children — so it goes on the handlers, which every
    record passes through on its way out.
    """
    global _installed
    if _installed:
        return
    filt = _RedactingFilter()
    root = logging.getLogger()
    for handler in root.handlers:
        handler.addFilter(filt)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "nurturehub"):
        for handler in logging.getLogger(name).handlers:
            handler.addFilter(filt)
    _installed = True
