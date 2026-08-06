"""Store the auto-detected change list on a form version.

The builder diffs the edited schema against the version it was opened from and
sends the result alongside the admin's own description, so the history records
what actually changed even when the note is vague.

Revision ID: c41f6a2be703
Revises: 92d8e748a0b4
Create Date: 2026-08-05
"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c41f6a2be703"
down_revision = "92d8e748a0b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("form_versions", sa.Column("detected_changes", sa.JSON(), nullable=True))
    # Which version the diff was taken against — without it the change list
    # reads as "vs the previous version", which is wrong when an admin opens an
    # older version from the history and saves it forward.
    op.add_column("form_versions", sa.Column("diffed_from_version", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("form_versions", "diffed_from_version")
    op.drop_column("form_versions", "detected_changes")
