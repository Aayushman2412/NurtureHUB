"""add form_definitions + form_responses (dynamic form system)

Revision ID: e7a41c9f52b8
Revises: c1d1b325a402
Create Date: 2026-07-18 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7a41c9f52b8'
down_revision: Union[str, Sequence[str], None] = 'c1d1b325a402'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'form_definitions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('form_key', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('builder_type', sa.String(), nullable=False),
        sa.Column('schema_json', sa.JSON(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('updated_by', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_form_definitions_id'), 'form_definitions', ['id'], unique=False)
    op.create_index(op.f('ix_form_definitions_form_key'), 'form_definitions', ['form_key'], unique=True)

    op.create_table(
        'form_responses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('form_key', sa.String(), nullable=False),
        sa.Column('definition_version', sa.Integer(), nullable=False),
        sa.Column('child_id', sa.Integer(), nullable=False),
        sa.Column('submitted_by_user_id', sa.Integer(), nullable=True),
        sa.Column('assessment_date', sa.Date(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('answers_json', sa.JSON(), nullable=False),
        sa.Column('summary_json', sa.JSON(), nullable=False),
        sa.Column('actions_json', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['child_id'], ['children.id'], ondelete='CASCADE',
                                name='form_responses_child_id_fkey'),
        sa.ForeignKeyConstraint(['submitted_by_user_id'], ['users.id'], ondelete='SET NULL',
                                name='form_responses_submitted_by_user_id_fkey'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_form_responses_id'), 'form_responses', ['id'], unique=False)
    op.create_index(op.f('ix_form_responses_form_key'), 'form_responses', ['form_key'], unique=False)
    op.create_index('ix_form_responses_child_form', 'form_responses', ['child_id', 'form_key'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_form_responses_child_form', table_name='form_responses')
    op.drop_index(op.f('ix_form_responses_form_key'), table_name='form_responses')
    op.drop_index(op.f('ix_form_responses_id'), table_name='form_responses')
    op.drop_table('form_responses')
    op.drop_index(op.f('ix_form_definitions_form_key'), table_name='form_definitions')
    op.drop_index(op.f('ix_form_definitions_id'), table_name='form_definitions')
    op.drop_table('form_definitions')
