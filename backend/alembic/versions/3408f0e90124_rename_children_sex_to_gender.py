"""rename children.sex to gender

Revision ID: 3408f0e90124
Revises: 06ebd51c1ea1
Create Date: 2026-07-13 20:06:36.569540

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3408f0e90124'
down_revision: Union[str, Sequence[str], None] = '06ebd51c1ea1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Rename children.sex -> children.gender (preserves data)."""
    op.alter_column("children", "sex", new_column_name="gender")


def downgrade() -> None:
    op.alter_column("children", "gender", new_column_name="sex")
