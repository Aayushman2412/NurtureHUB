"""Form version history + per-district version assignments.

Adds the git-style form versioning tables and backfills every existing
form_definitions row as version 1 ("first creation"), which also becomes the
form's default version — so behaviour is unchanged until an admin starts
creating versions and pinning districts.

Revision ID: b3d1a7c9e4f2
Revises: 86f85c40fff5
Create Date: 2026-08-04
"""
import json
from datetime import date

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b3d1a7c9e4f2"
down_revision = "86f85c40fff5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "form_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("form_key", sa.String(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("created_on", sa.Date(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("schema_json", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("form_key", "version_number", name="uq_form_versions_key_number"),
    )
    op.create_index(op.f("ix_form_versions_id"), "form_versions", ["id"], unique=False)
    op.create_index(op.f("ix_form_versions_form_key"), "form_versions", ["form_key"], unique=False)

    op.create_table(
        "form_district_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("form_key", sa.String(), nullable=False),
        sa.Column("program_district_id", sa.Integer(), nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=False),
        sa.Column("assigned_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["program_district_id"], ["program_districts.id"],
            name="form_district_assignments_program_district_id_fkey", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["version_id"], ["form_versions.id"],
            name="form_district_assignments_version_id_fkey", ondelete="CASCADE",
        ),
        sa.UniqueConstraint("form_key", "program_district_id", name="uq_form_district_assignment"),
    )
    op.create_index(op.f("ix_form_district_assignments_id"), "form_district_assignments", ["id"], unique=False)
    op.create_index(op.f("ix_form_district_assignments_form_key"), "form_district_assignments", ["form_key"], unique=False)

    op.add_column("form_definitions", sa.Column("default_version_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "form_definitions_default_version_id_fkey",
        "form_definitions", "form_versions",
        ["default_version_id"], ["id"], ondelete="SET NULL",
    )

    # ── Backfill: each existing definition becomes version 1 + the default ──
    bind = op.get_bind()
    definitions = bind.execute(sa.text(
        "SELECT id, form_key, schema_json, updated_by FROM form_definitions"
    )).fetchall()
    for row in definitions:
        result = bind.execute(
            sa.text(
                "INSERT INTO form_versions (form_key, version_number, created_on, description, schema_json, created_by) "
                "VALUES (:form_key, 1, :created_on, :description, :schema_json, :created_by) RETURNING id"
            ),
            {
                "form_key": row.form_key,
                "created_on": date.today(),
                "description": "First creation (migrated from the pre-versioning form)",
                # schema_json comes back as a dict (psycopg2 json) — re-serialise;
                # the unknown-typed text parameter is coerced to json on insert.
                "schema_json": row.schema_json if isinstance(row.schema_json, str) else json.dumps(row.schema_json or {}),
                "created_by": row.updated_by,
            },
        )
        version_id = result.scalar_one()
        bind.execute(
            sa.text("UPDATE form_definitions SET default_version_id = :vid WHERE id = :did"),
            {"vid": version_id, "did": row.id},
        )


def downgrade() -> None:
    op.drop_constraint("form_definitions_default_version_id_fkey", "form_definitions", type_="foreignkey")
    op.drop_column("form_definitions", "default_version_id")
    op.drop_index(op.f("ix_form_district_assignments_form_key"), table_name="form_district_assignments")
    op.drop_index(op.f("ix_form_district_assignments_id"), table_name="form_district_assignments")
    op.drop_table("form_district_assignments")
    op.drop_index(op.f("ix_form_versions_form_key"), table_name="form_versions")
    op.drop_index(op.f("ix_form_versions_id"), table_name="form_versions")
    op.drop_table("form_versions")
