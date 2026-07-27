"""other-specify free-text columns for users and mothers

Revision ID: 86f85c40fff5
Revises: 3a97143974dd
Create Date: 2026-07-27 09:12:20.046210

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '86f85c40fff5'
down_revision: Union[str, Sequence[str], None] = '3a97143974dd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Free-text 'Other (specify)' values: HWC + ration card on mothers, designation + facility type on users."""
    op.add_column('mothers', sa.Column('hwc_other', sa.String(), nullable=True))
    op.add_column('mothers', sa.Column('ration_card_other', sa.String(), nullable=True))
    op.add_column('users', sa.Column('designation_other', sa.String(), nullable=True))
    op.add_column('users', sa.Column('facility_type_other', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'facility_type_other')
    op.drop_column('users', 'designation_other')
    op.drop_column('mothers', 'ration_card_other')
    op.drop_column('mothers', 'hwc_other')
