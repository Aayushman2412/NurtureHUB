"""merge bf_reason and form-versioning heads

Revision ID: 92d8e748a0b4
Revises: 07f83433877c, b3d1a7c9e4f2
Create Date: 2026-08-04 17:12:57.271074

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '92d8e748a0b4'
down_revision: Union[str, Sequence[str], None] = ('07f83433877c', 'b3d1a7c9e4f2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
