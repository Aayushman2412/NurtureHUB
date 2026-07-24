"""Refresh built-in form definitions so the DB matches the current code.

WHY THIS EXISTS
    ``seed_forms.ensure_form_definitions()`` only INSERTS missing form_keys and
    never overwrites an existing one ("never overwrites admin edits"). So when a
    ``build_*_schema`` changes in code (e.g. the text-questionnaires rewrite), any
    already-seeded database — INCLUDING PRODUCTION — keeps serving the OLD schema
    forever. The frontend reads ``schema_json`` from the DB, so the new
    questionnaires never appear after a deploy. This script force-refreshes the
    built-in forms whose stored schema differs from the code.

SAFETY
    * DRY-RUN by default: prints a diff summary and writes NOTHING. Pass ``--apply``.
    * Backs up every form it will change to a timestamped JSON file first.
    * Idempotent: only touches forms whose stored schema actually differs, so it is
      safe to re-run (a second run reports "nothing to refresh").
    * Flags forms with ``version > 1`` — those were edited by an admin in the UI,
      and ``--apply`` discards those edits (they are saved in the backup). Use
      ``--skip-edited`` to leave them alone, or ``--only`` to scope precisely.
    * ``--restore <backup.json>`` rolls the definitions back to a saved backup.

USAGE  (run inside the deployed backend env; DATABASE_URL comes from settings/.env)
    python -m app.refresh_form_definitions                      # dry-run: show what would change
    python -m app.refresh_form_definitions --apply              # back up + refresh all changed forms
    python -m app.refresh_form_definitions --apply --skip-edited
    python -m app.refresh_form_definitions --apply --only antenatal complementary_feeding
    python -m app.refresh_form_definitions --restore form_backups/forms-YYYYMMDD-HHMMSS.json

    Ephemeral container? Copy the printed backup file out (``docker cp``) or pass
    ``--backup-dir`` pointing at a mounted volume.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app import seed_forms
from app.models import FormDefinition

UPDATED_BY = "refresh_form_definitions script"

# (form_key, db row, freshly built code schema)
Changed = Tuple[str, FormDefinition, dict]


def _canonical(schema) -> str:
    """Stable serialization for equality comparison (key order independent)."""
    return json.dumps(schema, sort_keys=True, ensure_ascii=False)


def _rows_by_key(db: Session) -> Dict[str, FormDefinition]:
    return {r.form_key: r for r in db.query(FormDefinition).all()}


def plan(db: Session, only: Optional[List[str]]) -> Tuple[List[Changed], List[str], List[str]]:
    """Classify built-in forms into (changed, unchanged, missing)."""
    rows = _rows_by_key(db)
    changed: List[Changed] = []
    unchanged: List[str] = []
    missing: List[str] = []
    for form_key, (title, desc, btype, build) in seed_forms.FORM_SPECS.items():
        if only and form_key not in only:
            continue
        row = rows.get(form_key)
        if row is None:
            missing.append(form_key)
            continue
        code_schema = build()
        if _canonical(row.schema_json) == _canonical(code_schema):
            unchanged.append(form_key)
        else:
            changed.append((form_key, row, code_schema))
    return changed, unchanged, missing


def _print_table(changed: List[Changed], unchanged: List[str], missing: List[str]) -> None:
    print(f"{'form_key':<26}{'db_ver':<8}{'db_bytes':<10}{'code_bytes':<12}status")
    print("-" * 74)
    for form_key, row, code_schema in changed:
        edited = "  (ADMIN-EDITED)" if row.version > 1 else ""
        print(f"{form_key:<26}{row.version:<8}{len(_canonical(row.schema_json)):<10}"
              f"{len(_canonical(code_schema)):<12}CHANGED{edited}")
    for form_key in unchanged:
        print(f"{form_key:<26}{'-':<8}{'-':<10}{'-':<12}unchanged")
    for form_key in missing:
        print(f"{form_key:<26}{'-':<8}{'-':<10}{'-':<12}MISSING (normal seeding will create it)")


def refresh(db: Session, apply: bool, only: Optional[List[str]],
            skip_edited: bool, backup_dir: str) -> None:
    if only:
        unknown = [k for k in only if k not in seed_forms.FORM_SPECS]
        if unknown:
            print(f"Warning: unknown form_key(s) ignored: {', '.join(unknown)}")

    changed, unchanged, missing = plan(db, only)

    print(f"\nForm definitions: {len(changed)} changed, {len(unchanged)} unchanged, "
          f"{len(missing)} missing.\n")
    _print_table(changed, unchanged, missing)

    targets = [(k, r, s) for (k, r, s) in changed if not (skip_edited and r.version > 1)]
    skipped = [k for (k, r, _s) in changed if skip_edited and r.version > 1]
    if skipped:
        print(f"\n--skip-edited: leaving admin-edited form(s) untouched: {', '.join(skipped)}")

    if not targets:
        print("\nNothing to refresh.")
        return

    if not apply:
        print(f"\nDRY RUN: nothing written. {len(targets)} form(s) would be refreshed.")
        print("Re-run with --apply to back up and write.")
        return

    # 1) Back up the current state of everything we are about to overwrite.
    os.makedirs(backup_dir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = os.path.abspath(os.path.join(backup_dir, f"forms-{stamp}.json"))
    backup = {
        form_key: {
            "version": row.version,
            "title": row.title,
            "description": row.description,
            "builder_type": row.builder_type,
            "schema_json": row.schema_json,
        }
        for (form_key, row, _s) in targets
    }
    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump(backup, f, ensure_ascii=False, indent=2)
    print(f"\nBacked up {len(backup)} form(s) to:\n  {backup_path}")

    # 2) Overwrite from code and bump the version so the frontend refetches.
    for form_key, row, code_schema in targets:
        title, desc, btype, _build = seed_forms.FORM_SPECS[form_key]
        old_v = row.version
        row.title = title
        row.description = desc
        row.builder_type = btype
        row.schema_json = code_schema
        row.version = old_v + 1
        row.updated_by = UPDATED_BY
        print(f"  refreshed {form_key:<26} v{old_v} -> v{row.version}")
    db.commit()
    print(f"\nDone. Refreshed {len(targets)} form(s).")
    print(f"Roll back with:  python -m app.refresh_form_definitions --restore {backup_path}")


def restore(db: Session, backup_path: str) -> None:
    with open(backup_path, "r", encoding="utf-8") as f:
        backup = json.load(f)
    rows = _rows_by_key(db)
    restored = 0
    for form_key, saved in backup.items():
        row = rows.get(form_key)
        if row is None:
            print(f"  skip {form_key}: no longer in DB")
            continue
        row.title = saved["title"]
        row.description = saved["description"]
        row.builder_type = saved["builder_type"]
        row.schema_json = saved["schema_json"]
        row.version = saved["version"]
        row.updated_by = UPDATED_BY + " (restore)"
        print(f"  restored {form_key:<26} -> v{saved['version']}")
        restored += 1
    db.commit()
    print(f"\nDone. Restored {restored} form(s) from {os.path.abspath(backup_path)}.")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Refresh built-in form definitions to match the current code "
                    "(dry-run by default).")
    p.add_argument("--apply", action="store_true",
                   help="Write changes (default is a dry-run preview).")
    p.add_argument("--only", nargs="+", metavar="FORM_KEY",
                   help="Restrict to these form_keys.")
    p.add_argument("--skip-edited", action="store_true",
                   help="Leave forms with version > 1 (admin-edited) untouched.")
    p.add_argument("--backup-dir", default="form_backups",
                   help="Directory for the pre-change backup (default: ./form_backups).")
    p.add_argument("--restore", metavar="BACKUP_JSON",
                   help="Roll form definitions back from a backup file, then exit.")
    args = p.parse_args()

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        if args.restore:
            restore(db, args.restore)
        else:
            refresh(db, args.apply, args.only, args.skip_edited, args.backup_dir)
    finally:
        db.close()


if __name__ == "__main__":
    main()
