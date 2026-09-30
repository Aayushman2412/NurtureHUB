"""masd expected activity: training batches, targets, rule tables

Sir's 2026-09-29 method: each F2F learner's follow-up starts after their own
batch's training (masd_training_batches + face_to_face_selections.batch_id),
adoption targets rise over time (masd_project_settings.targets_json), and the
cumulative expected-forms table is admin-editable (masd_rule_tables). All additive.

Revision ID: 60d4e42dd7e0
Revises: 4380d973b830
Create Date: 2026-09-30 22:59:25.792169

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '60d4e42dd7e0'
down_revision: Union[str, Sequence[str], None] = '4380d973b830'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('masd_rule_tables',
    sa.Column('key', sa.String(), nullable=False),
    sa.Column('value_json', sa.JSON(), nullable=False),
    sa.Column('updated_by', sa.String(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('masd_training_batches',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('program_district_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=False),
    sa.Column('updated_by', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['program_district_id'], ['program_districts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_masd_training_batches_id'), 'masd_training_batches', ['id'], unique=False)
    op.create_index(op.f('ix_masd_training_batches_program_district_id'), 'masd_training_batches', ['program_district_id'], unique=False)
    op.add_column('face_to_face_selections', sa.Column('batch_id', sa.Integer(), nullable=True))
    op.create_foreign_key('face_to_face_selections_batch_id_fkey', 'face_to_face_selections', 'masd_training_batches', ['batch_id'], ['id'], ondelete='SET NULL')
    op.add_column('masd_project_settings', sa.Column('targets_json', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('masd_project_settings', 'targets_json')
    op.drop_constraint('face_to_face_selections_batch_id_fkey', 'face_to_face_selections', type_='foreignkey')
    op.drop_column('face_to_face_selections', 'batch_id')
    op.drop_index(op.f('ix_masd_training_batches_program_district_id'), table_name='masd_training_batches')
    op.drop_index(op.f('ix_masd_training_batches_id'), table_name='masd_training_batches')
    op.drop_table('masd_training_batches')
    op.drop_table('masd_rule_tables')
