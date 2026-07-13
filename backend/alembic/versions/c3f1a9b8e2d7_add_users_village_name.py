"""add users.village_name (free-text village for LR)

Revision ID: c3f1a9b8e2d7
Revises: 3408f0e90124
Create Date: 2026-07-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3f1a9b8e2d7'
down_revision: Union[str, Sequence[str], None] = '3408f0e90124'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Free-text village name, used when the learner's village isn't in the master list."""
    op.add_column("users", sa.Column("village_name", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "village_name")
