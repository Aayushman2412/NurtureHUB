"""test question media + per-test default marks + form version change log

Revision ID: d5b71a3c9f04
Revises: 113e5337d31a
Create Date: 2026-08-17

Three unrelated-but-small additions, shipped together:

  * ``tests.default_marks``          — the marks a question gets when it does not
    state its own (previously hardcoded to 2 in the admin write path).
  * ``questions.image_url`` /
    ``question_options.image_url``   — picture-based questions and picture options.
  * ``form_versions.change_log``     — the "history of modifications" appended to
    when an admin amends a version in place instead of cutting a new one.
"""
from alembic import op
import sqlalchemy as sa


revision = "d5b71a3c9f04"
down_revision = "113e5337d31a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NOT NULL on a populated table needs a server_default to backfill; the ORM
    # carries no server default, so drop it again once the rows are filled.
    op.add_column(
        "tests",
        sa.Column("default_marks", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column("tests", "default_marks", server_default=None)

    op.add_column("questions", sa.Column("image_url", sa.String(), nullable=True))
    op.add_column("question_options", sa.Column("image_url", sa.String(), nullable=True))
    op.add_column("form_versions", sa.Column("change_log", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("form_versions", "change_log")
    op.drop_column("question_options", "image_url")
    op.drop_column("questions", "image_url")
    op.drop_column("tests", "default_marks")
