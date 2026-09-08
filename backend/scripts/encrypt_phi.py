"""Seal existing plaintext identifiers, and build the blind indexes.

Run once after deploying the data-protection layer with `PHI_ENCRYPTION_KEYS`
and `PHI_INDEX_KEY` configured. Rows written after that deploy are already
sealed; this catches everything that existed before.

    cd backend
    venv/bin/python -m scripts.encrypt_phi --dry-run   # count what would change
    venv/bin/python -m scripts.encrypt_phi            # do it

Safe to interrupt and safe to run again. `EncryptedString.process_bind_param`
refuses to double-wrap a value that is already ciphertext, and reads tolerate
plaintext, so at every moment during the run the application can read every row
— there is no window where the platform is down or half-readable.

Key rotation
------------
Adding a new key version and re-running re-seals every row under the new key.
Keep the old version listed in `PHI_ENCRYPTION_KEYS` until the run finishes, or
rows written under it become unreadable:

    PHI_ENCRYPTION_KEYS=v1:<old>,v2:<new>
    PHI_ENCRYPTION_ACTIVE_KEY=v2
    venv/bin/python -m scripts.encrypt_phi --rewrap
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import bindparam, text

from app.config import settings
from app.database import SessionLocal
from app.models import Mother, User
from app.security import audit
from app.security.crypto import (
    active_key_version, decrypt, encrypt, encryption_enabled, is_ciphertext, phone_index,
)

# (model, [encrypted column names], blind-index column, source column, index domain)
TARGETS = (
    (Mother, ["mobile", "alternate_mobile", "email"], "mobile_lookup", "mobile", "mother.mobile"),
    (User, ["phone", "alternate_phone"], "phone_lookup", "phone", "user.phone"),
)

BATCH = 500


def _raw_values(db, table: str, columns: list, pk_values: list) -> dict:
    """Read the columns as stored, bypassing the TypeDecorator.

    Going through the ORM would decrypt on the way in and re-encrypt on the way
    out, which cannot tell an already-sealed value from a plaintext one. The
    decision of what needs work has to be made against the stored bytes.
    """
    if not pk_values:
        return {}
    cols = ", ".join(columns)
    stmt = text(f"SELECT id, {cols} FROM {table} WHERE id IN :ids").bindparams(
        bindparam("ids", expanding=True)
    )
    rows = db.execute(stmt, {"ids": pk_values}).fetchall()
    return {row[0]: dict(zip(columns, row[1:])) for row in rows}


def process(model, columns, index_column, index_source, domain, *, dry_run: bool, rewrap: bool) -> dict:
    """Seal one table's identifier columns, batch by batch.

    Writes go out as direct single-statement UPDATEs carrying the already-sealed
    value, deliberately bypassing the ORM. Round-tripping through the
    TypeDecorator would mean writing NULL and then the ciphertext, and an
    interruption between those two statements would destroy a mother's phone
    number. One statement per value means the row is either the old plaintext or
    the new ciphertext, never nothing.
    """
    db = SessionLocal()
    table = model.__tablename__
    stats = {"scanned": 0, "sealed": 0, "indexed": 0, "already_sealed": 0}
    active = active_key_version()
    try:
        last_id = 0
        while True:
            ids = [
                row[0]
                for row in db.execute(
                    text(f"SELECT id FROM {table} WHERE id > :last ORDER BY id LIMIT :n"),
                    {"last": last_id, "n": BATCH},
                ).fetchall()
            ]
            if not ids:
                break
            last_id = ids[-1]
            stats["scanned"] += len(ids)

            selected = columns + ([index_column] if index_column else [])
            stored = _raw_values(db, table, selected, ids)
            updates = []

            for row_id in ids:
                raw = stored.get(row_id, {})
                for column in columns:
                    stored_value = raw.get(column)
                    if stored_value is None:
                        continue
                    aad = f"{table}.{column}"
                    if is_ciphertext(stored_value):
                        version = stored_value.split(":", 2)[1] if stored_value.count(":") >= 2 else None
                        if not rewrap or version == active:
                            stats["already_sealed"] += 1
                            continue
                        plaintext = decrypt(stored_value, aad=aad)
                    else:
                        plaintext = stored_value
                    updates.append((column, row_id, encrypt(plaintext, aad=aad)))
                    stats["sealed"] += 1

                if index_column:
                    current_index = raw.get(index_column)
                    source_stored = raw.get(index_source)
                    plaintext_source = (
                        decrypt(source_stored, aad=f"{table}.{index_source}")
                        if is_ciphertext(source_stored) else source_stored
                    )
                    token = phone_index(plaintext_source, domain)
                    if token and token != current_index:
                        updates.append((index_column, row_id, token))
                        stats["indexed"] += 1

            if updates and not dry_run:
                for column, row_id, value in updates:
                    db.execute(
                        text(f"UPDATE {table} SET {column} = :v WHERE id = :id"),
                        {"v": value, "id": row_id},
                    )
                db.commit()
            else:
                db.rollback()
            print(f"  {table}: {stats['scanned']} scanned, {stats['sealed']} sealed, "
                  f"{stats['indexed']} indexed", end="\r", flush=True)
        print()
    finally:
        db.close()
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="count without writing")
    parser.add_argument("--rewrap", action="store_true",
                        help="re-seal rows under the current active key (key rotation)")
    args = parser.parse_args()

    if not encryption_enabled():
        print(
            "PHI_ENCRYPTION_KEYS is not configured — there is nothing to encrypt with.\n"
            "Generate a key with:\n"
            "  python -c \"from app.security.crypto import generate_key; print('v1:'+generate_key())\"\n"
            "then set PHI_ENCRYPTION_KEYS and PHI_INDEX_KEY and run this again."
        )
        return 1
    if not settings.PHI_INDEX_KEY:
        print("WARNING: PHI_INDEX_KEY is not set — identifiers will be sealed but not searchable.")

    print(f"Active key version: {active_key_version()}")
    print(f"Mode: {'dry run' if args.dry_run else ('re-wrap' if args.rewrap else 'seal plaintext')}\n")

    totals = {"scanned": 0, "sealed": 0, "indexed": 0, "already_sealed": 0}
    for model, columns, index_column, index_source, domain in TARGETS:
        print(f"{model.__tablename__}: {', '.join(columns)}")
        stats = process(model, columns, index_column, index_source, domain,
                        dry_run=args.dry_run, rewrap=args.rewrap)
        for key in totals:
            totals[key] += stats[key]

    print(
        f"\n{totals['scanned']} row(s) scanned · {totals['sealed']} value(s) "
        f"{'would be ' if args.dry_run else ''}sealed · {totals['indexed']} index(es) "
        f"{'would be ' if args.dry_run else ''}built · {totals['already_sealed']} already sealed"
    )

    if not args.dry_run and (totals["sealed"] or totals["indexed"]):
        db = SessionLocal()
        try:
            audit.record_sync(
                audit.Action.KEY_ROTATED if args.rewrap else "security.phi.encrypted",
                db=db,
                resource_type="database",
                record_count=totals["sealed"],
                is_phi=False,
                actor_override={"actor_type": "system", "actor_label": "encrypt_phi script"},
                detail={**totals, "key_version": active_key_version(), "rewrap": args.rewrap},
            )
            db.commit()
        finally:
            db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
