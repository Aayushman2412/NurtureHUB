"""Application-level cryptography for direct identifiers.

Two primitives, both keyed from configuration and both versioned so keys can be
rotated without a flag-day rewrite of the table:

`EncryptedString`
    A SQLAlchemy ``TypeDecorator``. Values are sealed with AES-256-GCM before
    they reach the database and opened on the way back, so a stolen dump, a
    replica, a backup tarball or a ``SELECT`` by a DBA yields ciphertext rather
    than a mother's phone number. Stored form::

        enc:<key_version>:<base64url(nonce || ciphertext || tag)>

    Reads tolerate plaintext. That is deliberate — it lets the column be
    switched to this type in one deploy and back-filled afterwards
    (``scripts/encrypt_phi.py``) with no window where the app cannot read its
    own rows, and it keeps a key-less development environment working.

`blind_index`
    A truncated HMAC-SHA256 over a normalised value. Ciphertext is
    non-deterministic (fresh nonce each write) so it cannot be searched; the
    blind index gives back exact-match lookup ("find the mother with this
    mobile") without storing the identifier itself.

Key material
------------
``PHI_ENCRYPTION_KEYS`` carries one or more versioned keys::

    PHI_ENCRYPTION_KEYS=v1:<base64url 32 bytes>,v2:<base64url 32 bytes>
    PHI_ENCRYPTION_ACTIVE_KEY=v2

Old versions stay listed so previously-written rows remain readable; the active
version is the one new writes use. ``PHI_INDEX_KEY`` keys the blind index and is
separate, so leaking one does not compromise the other.

With no keys configured the module degrades to pass-through. Production refuses
to boot in that state (see ``config.Settings.validate_production``) — the
degradation exists for local development, not as a supported deployment.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
from functools import lru_cache
from typing import Optional

from sqlalchemy import String
from sqlalchemy.types import TypeDecorator

from app.config import settings

_PREFIX = "enc"
_NONCE_BYTES = 12  # AES-GCM standard nonce length
_KEY_BYTES = 32    # AES-256


class CryptoConfigError(RuntimeError):
    """Key material is missing or malformed."""


def _b64d(value: str) -> bytes:
    """Decode base64url, tolerating stripped padding."""
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def generate_key() -> str:
    """A fresh base64url-encoded AES-256 key, for operators bootstrapping a deploy."""
    return _b64e(secrets.token_bytes(_KEY_BYTES))


@lru_cache(maxsize=1)
def _keyring() -> dict:
    """Parse PHI_ENCRYPTION_KEYS into {version: key_bytes}."""
    raw = (settings.PHI_ENCRYPTION_KEYS or "").strip()
    if not raw:
        return {}
    ring: dict = {}
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if ":" not in chunk:
            raise CryptoConfigError(
                "PHI_ENCRYPTION_KEYS entries must be '<version>:<base64url key>'"
            )
        version, encoded = chunk.split(":", 1)
        version = version.strip()
        try:
            key = _b64d(encoded.strip())
        except Exception as exc:  # noqa: BLE001 — surface as a config error
            raise CryptoConfigError(
                f"PHI encryption key '{version}' is not valid base64url"
            ) from exc
        if len(key) != _KEY_BYTES:
            raise CryptoConfigError(
                f"PHI encryption key '{version}' is {len(key)} bytes; AES-256 needs {_KEY_BYTES}"
            )
        ring[version] = key
    return ring


def _active_version():
    ring = _keyring()
    if not ring:
        return None
    preferred = (settings.PHI_ENCRYPTION_ACTIVE_KEY or "").strip()
    if preferred:
        if preferred not in ring:
            raise CryptoConfigError(
                f"PHI_ENCRYPTION_ACTIVE_KEY='{preferred}' is not present in PHI_ENCRYPTION_KEYS"
            )
        return preferred
    # No explicit choice: the highest version string wins, which is the natural
    # ordering for v1, v2, v3...
    return sorted(ring)[-1]


def encryption_enabled() -> bool:
    return bool(_keyring())


def key_versions() -> list:
    """Every key version the app can currently decrypt with."""
    return sorted(_keyring())


def active_key_version():
    return _active_version()


def _aesgcm(version: str):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    ring = _keyring()
    if version not in ring:
        raise CryptoConfigError(
            f"No key for version '{version}'. A row was written with a key that is no "
            f"longer configured - restore it to PHI_ENCRYPTION_KEYS to read this data."
        )
    return AESGCM(ring[version])


def is_ciphertext(value: object) -> bool:
    return isinstance(value, str) and value.startswith(_PREFIX + ":")


def encrypt(plaintext, aad=None):
    """Seal a value. Returns it unchanged when no key is configured.

    ``aad`` binds the ciphertext to a context (we pass the column identity), so a
    ciphertext lifted from ``mothers.mobile`` cannot be pasted into
    ``mothers.email`` and still decrypt.
    """
    if plaintext is None:
        return None
    if not isinstance(plaintext, str):
        plaintext = str(plaintext)
    version = _active_version()
    if version is None:
        return plaintext
    if is_ciphertext(plaintext):
        return plaintext  # already sealed - never double-wrap
    nonce = os.urandom(_NONCE_BYTES)
    sealed = _aesgcm(version).encrypt(
        nonce, plaintext.encode("utf-8"), aad.encode("utf-8") if aad else None
    )
    return "{}:{}:{}".format(_PREFIX, version, _b64e(nonce + sealed))


def decrypt(stored, aad=None):
    """Open a sealed value. Plaintext (pre-migration rows) passes through."""
    if stored is None:
        return None
    if not is_ciphertext(stored):
        return stored
    try:
        _, version, payload = stored.split(":", 2)
    except ValueError:
        return stored
    raw = _b64d(payload)
    nonce, sealed = raw[:_NONCE_BYTES], raw[_NONCE_BYTES:]
    opened = _aesgcm(version).decrypt(
        nonce, sealed, aad.encode("utf-8") if aad else None
    )
    return opened.decode("utf-8")


class EncryptedString(TypeDecorator):
    """Transparently AES-GCM-sealed text column.

    Declare with the context that binds the ciphertext, which should be stable
    for the life of the column::

        mobile = Column(EncryptedString("mothers.mobile"), nullable=True)

    The underlying column is TEXT because ciphertext is longer than the value it
    protects and length limits on the plaintext no longer apply at the DB layer.
    """

    impl = String
    cache_ok = True

    def __init__(self, context: str, *args, **kwargs):
        self.context = context
        super().__init__(*args, **kwargs)

    def process_bind_param(self, value, dialect):  # noqa: ANN001
        return encrypt(value, aad=self.context)

    def process_result_value(self, value, dialect):  # noqa: ANN001
        if value is None:
            return None
        try:
            return decrypt(value, aad=self.context)
        except CryptoConfigError:
            raise
        except Exception:  # noqa: BLE001
            # A row we cannot open must not take down the whole read. Surface
            # None (the UI shows an unreadable-field marker) rather than
            # crashing a list view; the counter below tells operators it
            # happened so a mis-rotated key is caught immediately.
            _note_decryption_failure(self.context)
            return None


# Decryption failures are counted in-process and surfaced on the security
# dashboard. They are almost always a key-rotation mistake, and the symptom
# (fields silently reading empty) is otherwise invisible.
_decryption_failures: dict = {}


def _note_decryption_failure(context: str) -> None:
    _decryption_failures[context] = _decryption_failures.get(context, 0) + 1
    # Imported lazily: audit imports config and redaction, and this module is
    # imported by models, so a top-level import here would close a cycle.
    try:
        from app.security.audit import note_decryption_failure

        note_decryption_failure(context)
    except Exception:  # noqa: BLE001 — telemetry must never break a read
        pass


def decryption_failure_counts() -> dict:
    return dict(_decryption_failures)


# ── Blind index ──────────────────────────────────────────────────────────────

_NON_DIGITS = re.compile(r"\D+")


def normalise_phone(value):
    """Reduce a phone number to comparable digits (last 10 = Indian subscriber part)."""
    if not value:
        return None
    digits = _NON_DIGITS.sub("", value)
    if not digits:
        return None
    return digits[-10:] if len(digits) > 10 else digits


def normalise_email(value):
    if not value:
        return None
    cleaned = value.strip().lower()
    return cleaned or None


def blind_index(value, domain: str):
    """Deterministic, keyed, one-way lookup token for an identifier.

    ``domain`` separates namespaces so the same phone number indexed for a
    mother and for a learner does not produce the same token - that would leak
    the fact that they are the same person to anyone holding only the index
    column.
    """
    if value is None:
        return None
    key = (settings.PHI_INDEX_KEY or "").strip()
    if not key:
        return None
    key_bytes = _b64d(key) if len(key) > 40 else key.encode("utf-8")
    mac = hmac.new(
        key_bytes,
        (domain + "\x00" + value).encode("utf-8"),
        hashlib.sha256,
    ).digest()
    # 128 bits is far beyond collision risk at this table size and keeps the
    # index column small.
    return _b64e(mac[:16])


def phone_index(value, domain: str):
    return blind_index(normalise_phone(value), domain)


def email_index(value, domain: str):
    return blind_index(normalise_email(value), domain)
