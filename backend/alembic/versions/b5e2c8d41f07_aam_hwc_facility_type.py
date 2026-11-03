"""Sub-centre folded into Ayushman Arogya Mandir / HWC; ASHA Facilitator at AAM/HWC and PHC

Review of 29 Oct 2026: "remove sub center, retain Ayushman Arogya Mandir /
Health and Wellness Center — sub center is relatively outdated, the previous
name for health and wellness center … these are the three synonyms of the
same center"; "for ASHA facilitator give health and wellness center … and PHC
also should be visible".

Data only. Learners who chose Sub-centre point at the same place under its
current name, as do the designations that were mapped to it; the legacy text
copy on the learner row follows. The downgrade restores the old name but not
the Sub-centre row — once merged, who chose which cannot be told apart.

Revision ID: b5e2c8d41f07
Revises: 7a1c4e2d9b60
Create Date: 2026-11-03
"""
from typing import Optional

import sqlalchemy as sa
from alembic import op

revision = "b5e2c8d41f07"
down_revision = "7a1c4e2d9b60"
branch_labels = None
depends_on = None

SC = "Sub-centre (SC)"
HWC_OLD = "Health & Wellness Centre (HWC)"
AAM = "Ayushman Arogya Mandir / Health & Wellness Centre (AAM / HWC)"
PHC = "Primary Health Centre (PHC)"


def _id(conn, name: str) -> Optional[int]:
    return conn.execute(sa.text("SELECT id FROM facility_types WHERE name = :n ORDER BY id LIMIT 1"),
                        {"n": name}).scalar()


def _map(conn, designation_id: int, facility_type_id: int) -> None:
    found = conn.execute(sa.text(
        "SELECT 1 FROM designation_facility_types WHERE designation_id = :d AND facility_type_id = :f"),
        {"d": designation_id, "f": facility_type_id}).first()
    if not found:
        conn.execute(sa.text(
            "INSERT INTO designation_facility_types (designation_id, facility_type_id) VALUES (:d, :f)"),
            {"d": designation_id, "f": facility_type_id})


def upgrade() -> None:
    conn = op.get_bind()
    sc, hwc = _id(conn, SC), _id(conn, HWC_OLD)
    if hwc is None and sc is not None:          # only the old name exists: rename it in place
        hwc, sc = sc, None
    if hwc is not None:
        conn.execute(sa.text("UPDATE facility_types SET name = :n WHERE id = :i"), {"n": AAM, "i": hwc})
    if sc is not None and hwc is not None:
        conn.execute(sa.text("UPDATE users SET facility_type_id = :h WHERE facility_type_id = :s"),
                     {"h": hwc, "s": sc})
        for (designation_id,) in conn.execute(sa.text(
                "SELECT designation_id FROM designation_facility_types WHERE facility_type_id = :s"),
                {"s": sc}).fetchall():
            _map(conn, designation_id, hwc)
        conn.execute(sa.text("DELETE FROM designation_facility_types WHERE facility_type_id = :s"), {"s": sc})
        conn.execute(sa.text("DELETE FROM facility_types WHERE id = :s"), {"s": sc})
    conn.execute(sa.text("UPDATE users SET work_center_type = :n WHERE work_center_type IN (:a, :b)"),
                 {"n": AAM, "a": SC, "b": HWC_OLD})

    phc = _id(conn, PHC)
    for (designation_id,) in conn.execute(sa.text(
            "SELECT id FROM designations WHERE name = 'ASHA Facilitator'")).fetchall():
        for facility_type_id in (hwc, phc):
            if facility_type_id is not None:
                _map(conn, designation_id, facility_type_id)


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE facility_types SET name = :o WHERE name = :n"), {"o": HWC_OLD, "n": AAM})
    conn.execute(sa.text("UPDATE users SET work_center_type = :o WHERE work_center_type = :n"),
                 {"o": HWC_OLD, "n": AAM})
