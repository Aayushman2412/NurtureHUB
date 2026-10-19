"""program_districts.selection_announced_at (review of 19 Oct 2026)

Revision ID: 8b4f2e6a1c93
Revises: 5d2a9c7e41f3
Create Date: 2026-10-19 02:30:00

When a project's face-to-face selection was announced to everyone. Until
then a learner who finished every video and test waits for the result;
after it, one not selected is told so. Null for every project: nothing is
announced until an admin says so, so no learner's dashboard changes.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "8b4f2e6a1c93"
down_revision: Union[str, Sequence[str], None] = "5d2a9c7e41f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("program_districts", sa.Column("selection_announced_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("program_districts", "selection_announced_at")
