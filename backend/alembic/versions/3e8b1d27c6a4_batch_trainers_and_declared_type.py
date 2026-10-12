"""batch start date and trainers, declared adoption type

Revision ID: 3e8b1d27c6a4
Revises: babdf8f9b510
Create Date: 2026-10-12 20:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3e8b1d27c6a4'
down_revision: Union[str, Sequence[str], None] = 'babdf8f9b510'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('masd_training_batches', sa.Column('start_date', sa.Date(), nullable=True))
    op.add_column('masd_training_batches', sa.Column('trainers', sa.String(), nullable=True))
    op.add_column('mothers', sa.Column('declared_adoption_type', sa.String(length=16), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('mothers', 'declared_adoption_type')
    op.drop_column('masd_training_batches', 'trainers')
    op.drop_column('masd_training_batches', 'start_date')
