"""masd dashboard settings and trainer role

The MASD dashboard needs two things the schema did not hold:
  * each project's programme calendar (F2F training date, tranche-2 start) and
    its NFHS survey benchmarks — `masd_project_settings`;
  * which F2F learners became Master Trainers or Facilitators ("MT+FL"), whom
    the outcome analysis compares with everyone else —
    `face_to_face_selections.trainer_role`.

Both are additive and nullable, so existing rows need no backfill.

Revision ID: 4380d973b830
Revises: 6475cb7b2cf4
Create Date: 2026-09-29 00:27:58.992549

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4380d973b830'
down_revision: Union[str, Sequence[str], None] = '6475cb7b2cf4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'masd_project_settings',
        sa.Column('program_district_id', sa.Integer(), nullable=False),
        sa.Column('training_date', sa.Date(), nullable=True),
        sa.Column('tranche2_start', sa.Date(), nullable=True),
        sa.Column('benchmarks_json', sa.JSON(), nullable=True),
        sa.Column('updated_by', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(
            ['program_district_id'], ['program_districts.id'],
            name='masd_project_settings_program_district_id_fkey', ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('program_district_id'),
    )
    op.add_column('face_to_face_selections', sa.Column('trainer_role', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('face_to_face_selections', 'trainer_role')
    op.drop_table('masd_project_settings')
