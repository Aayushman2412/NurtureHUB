"""registration by project, mobile sign-in, gram panchayats (review of 17 Oct 2026)

Revision ID: 5d2a9c7e41f3
Revises: 3e8b1d27c6a4
Create Date: 2026-10-17 21:00:00

Schema:
  * program_districts.registration_open / reg_state_id / reg_district_id —
    the place a project's learners register in, and whether its sign-up is
    open (the registration form then offers only the open projects' places).
  * facility_types.department_id — an Anganwadi Centre is never offered to
    Health staff, a PHC never to WCD staff.
  * blocks.subdivision, gram_panchayats, users.gram_panchayat_id/_name.
  * users.phone_verified / contact_email / contact_email_verified /
    password_weak — mobile-first sign-up, email last and optional.

Data (idempotent, by name):
  * each facility type's department (all but "Other (Specify)").
  * Chandrapur district, Maharashtra: its 15 talukas with their 8
    subdivisions and their gram panchayats (823 distinct names), from the district's own site
    (frozen in data/chandrapur_geography_2026_10_17.json so every database
    gets the same rows). Nothing that exists is changed except a taluka's
    missing subdivision.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "5d2a9c7e41f3"
down_revision: Union[str, Sequence[str], None] = "3e8b1d27c6a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

GEOGRAPHY = Path(__file__).parent / "data" / "chandrapur_geography_2026_10_17.json"

# Facility type → the department whose staff work there.
WCD_TYPES = ("Anganwadi Centre (AWC)", "ICDS Project Office (CDPO Office)", "District ICDS Office")
HFW_TYPES = (
    "Sub-centre (SC)", "Health & Wellness Centre (HWC)", "Primary Health Centre (PHC)",
    "Community Health Centre (CHC)", "Taluk Hospital (TH)", "District Hospital (DH)",
    "Medical College Hospital", "Taluk Health Office (THO)", "District Health Office (DHO)",
)


def upgrade() -> None:
    op.add_column("program_districts", sa.Column(
        "registration_open", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("program_districts", sa.Column("reg_state_id", sa.Integer(), nullable=True))
    op.add_column("program_districts", sa.Column("reg_district_id", sa.Integer(), nullable=True))
    op.create_foreign_key("program_districts_reg_state_id_fkey", "program_districts", "states",
                          ["reg_state_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("program_districts_reg_district_id_fkey", "program_districts", "districts",
                          ["reg_district_id"], ["id"], ondelete="SET NULL")

    op.add_column("facility_types", sa.Column("department_id", sa.Integer(), nullable=True))
    op.create_foreign_key("facility_types_department_id_fkey", "facility_types", "departments",
                          ["department_id"], ["id"], ondelete="SET NULL")

    op.add_column("blocks", sa.Column("subdivision", sa.String(), nullable=True))
    op.create_table(
        "gram_panchayats",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("block_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["block_id"], ["blocks.id"], name="gram_panchayats_block_id_fkey",
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_gram_panchayats_id"), "gram_panchayats", ["id"], unique=False)
    op.create_index(op.f("ix_gram_panchayats_block_id"), "gram_panchayats", ["block_id"], unique=False)

    op.add_column("users", sa.Column("gram_panchayat_id", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("gram_panchayat_name", sa.String(), nullable=True))
    op.create_foreign_key("users_gram_panchayat_id_fkey", "users", "gram_panchayats",
                          ["gram_panchayat_id"], ["id"], ondelete="SET NULL")
    op.add_column("users", sa.Column(
        "phone_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("users", sa.Column("contact_email", sa.String(), nullable=True))
    op.add_column("users", sa.Column(
        "contact_email_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("users", sa.Column(
        "password_weak", sa.Boolean(), nullable=False, server_default=sa.text("false")))

    bind = op.get_bind()
    _scope_facility_types(bind)
    _chandrapur(bind)


def _scope_facility_types(bind) -> None:
    for code, names in (("WCD", WCD_TYPES), ("HFW", HFW_TYPES)):
        dept = bind.execute(sa.text("SELECT id FROM departments WHERE code = :c"), {"c": code}).scalar()
        if dept is None:
            continue
        bind.execute(
            sa.text("UPDATE facility_types SET department_id = :d WHERE name IN :names AND department_id IS NULL")
            .bindparams(sa.bindparam("names", expanding=True)),
            {"d": dept, "names": list(names)},
        )


def _id(bind, sql: str, **params):
    return bind.execute(sa.text(sql), params).scalar()


def _chandrapur(bind) -> None:
    # A brand-new database has no geography yet; seeding adds Chandrapur
    # there (app/seed.py), after its own first states. Inserting a state
    # here would make that seeding think the work was already done.
    if not bind.execute(sa.text("SELECT 1 FROM states LIMIT 1")).first():
        return
    geo = json.loads(GEOGRAPHY.read_text(encoding="utf-8"))
    state_id = _id(bind, "SELECT id FROM states WHERE lower(name) = lower(:n) ORDER BY id LIMIT 1", n=geo["state"])
    if state_id is None:
        state_id = _id(bind, "INSERT INTO states (name, is_active) VALUES (:n, true) RETURNING id", n=geo["state"])
    district_id = _id(bind, "SELECT id FROM districts WHERE state_id = :s AND lower(name) = lower(:n) "
                            "ORDER BY id LIMIT 1", s=state_id, n=geo["district"])
    if district_id is None:
        district_id = _id(bind, "INSERT INTO districts (state_id, name) VALUES (:s, :n) RETURNING id",
                          s=state_id, n=geo["district"])
    for taluka in geo["talukas"]:
        block_id = _id(bind, "SELECT id FROM blocks WHERE district_id = :d AND lower(name) = lower(:n) "
                             "ORDER BY id LIMIT 1", d=district_id, n=taluka["name"])
        if block_id is None:
            block_id = _id(bind, "INSERT INTO blocks (district_id, name, subdivision) VALUES (:d, :n, :s) "
                                 "RETURNING id", d=district_id, n=taluka["name"], s=taluka["subdivision"])
        else:
            bind.execute(sa.text("UPDATE blocks SET subdivision = :s WHERE id = :b AND subdivision IS NULL"),
                         {"s": taluka["subdivision"], "b": block_id})
        have = {r[0].lower() for r in bind.execute(
            sa.text("SELECT name FROM gram_panchayats WHERE block_id = :b"), {"b": block_id})}
        for name in taluka["gram_panchayats"]:
            if name.lower() not in have:
                bind.execute(sa.text("INSERT INTO gram_panchayats (block_id, name) VALUES (:b, :n)"),
                             {"b": block_id, "n": name})
                have.add(name.lower())


def downgrade() -> None:
    # The Chandrapur rows stay: geography is reference data other records may
    # point at, and the columns below are what go.
    op.drop_column("users", "password_weak")
    op.drop_column("users", "contact_email_verified")
    op.drop_column("users", "contact_email")
    op.drop_column("users", "phone_verified")
    op.drop_constraint("users_gram_panchayat_id_fkey", "users", type_="foreignkey")
    op.drop_column("users", "gram_panchayat_name")
    op.drop_column("users", "gram_panchayat_id")
    op.drop_index(op.f("ix_gram_panchayats_block_id"), table_name="gram_panchayats")
    op.drop_index(op.f("ix_gram_panchayats_id"), table_name="gram_panchayats")
    op.drop_table("gram_panchayats")
    op.drop_column("blocks", "subdivision")
    op.drop_constraint("facility_types_department_id_fkey", "facility_types", type_="foreignkey")
    op.drop_column("facility_types", "department_id")
    op.drop_constraint("program_districts_reg_district_id_fkey", "program_districts", type_="foreignkey")
    op.drop_constraint("program_districts_reg_state_id_fkey", "program_districts", type_="foreignkey")
    op.drop_column("program_districts", "reg_district_id")
    op.drop_column("program_districts", "reg_state_id")
    op.drop_column("program_districts", "registration_open")
