"""Who a learner is when they sign up with a mobile number (review of 17 Oct
2026: "let's not take email as the first step to login").

Every session, lockout and audit row in the platform is keyed on the account's
email, so a learner who has none still gets one: an internal placeholder under
a reserved, undeliverable domain (RFC 2606 ``.invalid``). It is never shown,
never mailed and never typed — the learner signs in with their mobile number.
An address they add later lives in ``users.contact_email`` until verified, and
then also works for email sign-in.
"""
from __future__ import annotations

import re
import secrets
from typing import List, Optional

from sqlalchemy.orm import Session

PLACEHOLDER_DOMAIN = "mobile.nurturehub.invalid"
PHONE_INDEX_DOMAIN = "user.phone"
# scripts/seed_mock_learners.py indexed with this domain until 17 Oct 2026;
# looked up too, so those demo accounts can sign in by mobile number.
_LEGACY_INDEX_DOMAINS = ("users.phone",)

# An Indian mobile number: ten digits starting 6–9, written with or without
# +91 / 91 / 0 in front and with any spaces or dashes.
_MOBILE = re.compile(r"^[6-9]\d{9}$")


def placeholder_email() -> str:
    return f"m-{secrets.token_hex(8)}@{PLACEHOLDER_DOMAIN}"


def is_placeholder(email: Optional[str]) -> bool:
    return bool(email) and email.lower().endswith("@" + PLACEHOLDER_DOMAIN)


def normalise_mobile(raw: Optional[str]) -> Optional[str]:
    """The ten-digit mobile number, or None when it is not one."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits if _MOBILE.match(digits) else None


def lookup_token(mobile: str) -> Optional[str]:
    from app.security.crypto import phone_index
    return phone_index(mobile, PHONE_INDEX_DOMAIN)


def users_with_mobile(db: Session, mobile: str, limit: int = 5) -> List:
    """Learner accounts holding this number (through the blind index — the
    number itself cannot be searched). Usually one; a shared facility phone
    can give a few, and sign-in then tells them apart by password."""
    from app.models import User

    from app.security.crypto import phone_index

    tokens = [t for t in [lookup_token(mobile)] + [phone_index(mobile, d) for d in _LEGACY_INDEX_DOMAINS] if t]
    if not tokens:
        return []
    return (db.query(User)
            .filter(User.phone_lookup.in_(tokens), User.is_admin.is_(False))
            .order_by(User.id).limit(limit).all())


def public_email(user) -> Optional[str]:
    """The address to show or mail for this account, if it has a real one."""
    if not is_placeholder(user.email):
        return user.email
    return user.contact_email or None
