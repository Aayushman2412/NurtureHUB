"""stages.starts_on/finish_by and tests.answers_released (review of 19 Oct 2026)

Revision ID: 3c7d1e9a4b52
Revises: 8b4f2e6a1c93
Create Date: 2026-10-19 16:00:00

A phase's dates ("starts on 1 Nov, finish by 20 Nov") for the learner's
timeline — null everywhere until an admin sets them.

Whether learners may see a test's right answers. A test that has already
ended keeps showing them (released), as it did before this switch existed;
a test still running or yet to run starts closed, so its answers stay in
until the admin releases them.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "3c7d1e9a4b52"
down_revision: Union[str, Sequence[str], None] = "8b4f2e6a1c93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("stages", sa.Column("starts_on", sa.Date(), nullable=True))
    op.add_column("stages", sa.Column("finish_by", sa.Date(), nullable=True))
    op.add_column("tests", sa.Column("answers_released", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.execute("UPDATE tests SET answers_released = true WHERE status = 'ended'")


def downgrade() -> None:
    op.drop_column("tests", "answers_released")
    op.drop_column("stages", "finish_by")
    op.drop_column("stages", "starts_on")
