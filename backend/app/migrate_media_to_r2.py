"""One-shot copy of existing local media into the Cloudflare R2 bucket.

Uploads every file under backend/uploads/{learner_media,form_assets}/ to R2
with the SAME key (folder/name), so a stored relative URL and its future CDN
URL point at the same object. Existing DB rows keep their relative
`/uploads/...` URLs and keep being served by the app server — this script just
makes sure the bucket also has every historical file, so the app server's
uploads dir can eventually be retired.

Idempotent: objects already in the bucket (same key + size) are skipped.

Run (after setting the R2_* variables in backend/.env):

    cd backend && venv-win/Scripts/python.exe -m app.migrate_media_to_r2
"""
from __future__ import annotations

import os
import sys

from app import storage
from app.config import settings

SUBDIRS = ("learner_media", "form_assets", "demo")


def main() -> int:
    if not storage.r2_enabled():
        print("R2 is not configured — set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / "
              "R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_BASE_URL in backend/.env first.")
        return 1

    client = storage._r2_client()  # noqa: SLF001 — module-internal tool
    bucket = settings.R2_BUCKET

    existing: dict[str, int] = {}
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            existing[obj["Key"]] = obj["Size"]

    root = storage._uploads_root()  # noqa: SLF001
    uploaded = skipped = 0
    for subdir in SUBDIRS:
        base = os.path.join(root, subdir)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirs, files in os.walk(base):
            for name in files:
                path = os.path.join(dirpath, name)
                rel = os.path.relpath(path, root).replace(os.sep, "/")
                size = os.path.getsize(path)
                if existing.get(rel) == size:
                    skipped += 1
                    continue
                with open(path, "rb") as fh:
                    data = fh.read()
                client.put_object(
                    Bucket=bucket,
                    Key=rel,
                    Body=data,
                    ContentType=storage._content_type(name, None),  # noqa: SLF001
                    CacheControl="public, max-age=31536000, immutable",
                )
                uploaded += 1
                print(f"uploaded  {rel}  ({size:,} bytes)")

    print(f"\nDone: {uploaded} uploaded, {skipped} already in bucket.")
    print(f"Public base: {settings.R2_PUBLIC_BASE_URL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
