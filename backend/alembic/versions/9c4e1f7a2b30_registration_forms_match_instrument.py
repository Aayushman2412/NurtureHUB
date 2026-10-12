"""registration forms in the Form Builder match the EP HST tools instrument

Revision ID: 9c4e1f7a2b30
Revises: 60d4e42dd7e0
Create Date: 2026-10-05 21:00:00

Data only. The learner, mother and child registration PAGES were built to
the EP HST tools instrument (30 / 38 / 19 questions), but the Form Builder's
copies of those three forms still held the placeholders they were created
with — 9 to 11, 8 and 6 questions — so the builder showed a "mother form"
missing most of its questions (review of 5 Oct 2026). Nothing reads those
copies: no response was ever filed against them.

This appends one new version per form holding the instrument as the
registration pages ask it (frozen in data/registration_instrument_2026_10_05.json
so the migration is the same on every database), makes it the default, and
moves projects pinned to an older version onto it. Earlier versions stay in
the history untouched. A database already showing the instrument (a fresh
install seeds it) is left alone.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "9c4e1f7a2b30"
down_revision: Union[str, Sequence[str], None] = "60d4e42dd7e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SNAPSHOT = Path(__file__).parent / "data" / "registration_instrument_2026_10_05.json"
DESCRIPTION = (
    "Matches the EP HST tools instrument — the questions the registration page asks "
    "(the builder copy had kept its first placeholder questions)."
)


def _labels(schema: dict) -> dict:
    return {f.get("id"): f.get("label") or f.get("id") for f in (schema or {}).get("fields") or []}


def _changes(old: dict, new: dict) -> list:
    before, after = _labels(old), _labels(new)
    added = [after[k] for k in after if k not in before]
    removed = [before[k] for k in before if k not in after]
    out = [f"Added field “{label}”" for label in added] + [f"Removed field “{label}”" for label in removed]
    # The builder's change list is capped at 200 entries (admin_forms validator).
    return out[:200]


def upgrade() -> None:
    bind = op.get_bind()
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    for form_key, schema in snapshot.items():
        definition = bind.execute(sa.text(
            "SELECT d.id, d.default_version_id, v.version_number, v.schema_json "
            "FROM form_definitions d LEFT JOIN form_versions v ON v.id = d.default_version_id "
            "WHERE d.form_key = :k"), {"k": form_key}).first()
        if definition is None:
            continue  # fresh database: the seed inserts the instrument itself
        current = definition.schema_json
        if isinstance(current, str):
            current = json.loads(current)
        if [f.get("id") for f in (current or {}).get("fields") or []] == [f["id"] for f in schema["fields"]]:
            continue  # already the instrument
        number = (bind.execute(sa.text(
            "SELECT COALESCE(MAX(version_number), 0) FROM form_versions WHERE form_key = :k"),
            {"k": form_key}).scalar() or 0) + 1
        version_id = bind.execute(sa.text(
            "INSERT INTO form_versions (form_key, version_number, created_on, description, "
            "detected_changes, diffed_from_version, schema_json, created_by) "
            "VALUES (:k, :n, :on, :d, CAST(:changes AS JSON), :frm, CAST(:s AS JSON), :by) RETURNING id"),
            {"k": form_key, "n": number, "on": date(2026, 10, 5), "d": DESCRIPTION,
             "changes": json.dumps(_changes(current or {}, schema), ensure_ascii=False),
             "frm": definition.version_number, "s": json.dumps(schema, ensure_ascii=False),
             "by": "instrument sync (migration 9c4e1f7a2b30)"}).scalar()
        bind.execute(sa.text(
            "UPDATE form_definitions SET default_version_id = :v, schema_json = CAST(:s AS JSON), version = :n "
            "WHERE id = :id"),
            {"v": version_id, "s": json.dumps(schema, ensure_ascii=False), "n": number, "id": definition.id})
        bind.execute(sa.text(
            "UPDATE form_district_assignments SET version_id = :v WHERE form_key = :k"),
            {"v": version_id, "k": form_key})


def downgrade() -> None:
    # Data only, and the older versions are still in the history: an admin can
    # point a project back at any of them from the Form Builder.
    pass
