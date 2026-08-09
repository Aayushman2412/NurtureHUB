"""Media storage for uploaded files: Cloudflare R2 (CDN) or local disk.

All user-uploaded media — learner assessment photos (Check Growth measurement
photos are a daily stream), admin form-builder option images/GIFs and action
videos — goes through `save_media()`:

- **R2 configured** (all five R2_* settings present): the file is stored in the
  Cloudflare R2 bucket via its S3-compatible API and the returned URL is the
  bucket's public CDN URL (`R2_PUBLIC_BASE_URL/<subdir>/<name>`). Cloudflare
  serves it worldwide with zero egress cost; the app server's disk stays flat
  no matter how many photos field workers upload.
- **R2 not configured** (dev default): the file lands in `backend/uploads/`
  exactly as before and is served by the StaticFiles mount at `/uploads`.

Previously-stored relative `/uploads/...` URLs keep working either way — this
module only decides where NEW uploads go. `migrate_media_to_r2.py` copies the
existing disk media into the bucket.

Uploads are keyed by a fresh UUID filename, so objects are immutable —
Cache-Control is set accordingly and Cloudflare/browser caches never need
revalidation.
"""
from __future__ import annotations

import logging
import mimetypes
import os
from typing import Optional

from app.config import settings

logger = logging.getLogger("nurturehub.storage")

_client = None  # cached boto3 client (thread-safe for use once created)


def r2_enabled() -> bool:
    return bool(
        settings.R2_ACCOUNT_ID
        and settings.R2_ACCESS_KEY_ID
        and settings.R2_SECRET_ACCESS_KEY
        and settings.R2_BUCKET
        and settings.R2_PUBLIC_BASE_URL
    )


def _r2_client():
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config

        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=Config(connect_timeout=10, read_timeout=60, retries={"max_attempts": 3}),
        )
    return _client


def _uploads_root() -> str:
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(backend_dir, "uploads")


def _content_type(filename: str, declared: Optional[str]) -> str:
    guessed = mimetypes.guess_type(filename)[0]
    return guessed or declared or "application/octet-stream"


def save_media(subdir: str, filename: str, data: bytes, declared_type: Optional[str] = None) -> str:
    """Store one media file; returns the URL to embed in answers/schemas.

    R2 failures fall back to local disk — a Cloudflare hiccup must never lose
    a field worker's measurement photo.
    """
    if r2_enabled():
        key = f"{subdir}/{filename}"
        try:
            _r2_client().put_object(
                Bucket=settings.R2_BUCKET,
                Key=key,
                Body=data,
                ContentType=_content_type(filename, declared_type),
                # UUID-named => immutable: cache as hard as possible.
                CacheControl="public, max-age=31536000, immutable",
            )
            return f"{settings.R2_PUBLIC_BASE_URL.rstrip('/')}/{key}"
        except Exception:  # noqa: BLE001 — any SDK/network failure
            logger.exception("R2 upload failed for %s — falling back to local disk", key)

    target_dir = os.path.join(_uploads_root(), subdir)
    os.makedirs(target_dir, exist_ok=True)
    with open(os.path.join(target_dir, filename), "wb") as fh:
        fh.write(data)
    return f"/uploads/{subdir}/{filename}"
