"""care_alerts (launch review of 19 Oct 2026)

Revision ID: 7a1c4e2d9b60
Revises: 3c7d1e9a4b52
Create Date: 2026-10-23 18:00:00

The care prompts NurtureHUB sends about a learner's cases — a baby faltering
after a growth check, the day's visits, an escalation to the batch monitor —
one row per prompt, so none is ever sent twice. Empty to begin with.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "7a1c4e2d9b60"
down_revision: Union[str, Sequence[str], None] = "3c7d1e9a4b52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "care_alerts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("dedupe_key", sa.String(length=160), nullable=False),
        sa.Column("learner_id", sa.Integer(), nullable=False),
        sa.Column("recipient_id", sa.Integer(), nullable=False),
        sa.Column("child_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["learner_id"], ["users.id"], ondelete="CASCADE", name="care_alerts_learner_id_fkey"),
        sa.ForeignKeyConstraint(["recipient_id"], ["users.id"], ondelete="CASCADE", name="care_alerts_recipient_id_fkey"),
        sa.ForeignKeyConstraint(["child_id"], ["children.id"], ondelete="CASCADE", name="care_alerts_child_id_fkey"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key"),
    )
    op.create_index(op.f("ix_care_alerts_id"), "care_alerts", ["id"], unique=False)
    op.create_index(op.f("ix_care_alerts_learner_id"), "care_alerts", ["learner_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_care_alerts_learner_id"), table_name="care_alerts")
    op.drop_index(op.f("ix_care_alerts_id"), table_name="care_alerts")
    op.drop_table("care_alerts")
