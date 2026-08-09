"""project levels: state/district hierarchy

Turns program districts into PROJECTS that are either district-level (analysis
by block, exactly today's behaviour) or state-level (analysis by district, with
child district projects nested underneath).

Existing rows keep working untouched: everything defaults to level='district'
with no parent, which is precisely the pre-change semantics. The data step only
stamps the analytics identity (code / state_prefix) on the three known program
districts and promotes Meghalaya to a state project, because the pipelines
already analysed it state-wide.

Revision ID: aa0f22f7722c
Revises: 6ce56e548ea1
Create Date: 2026-08-09 22:55:52.611992

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'aa0f22f7722c'
down_revision: Union[str, Sequence[str], None] = '6ce56e548ea1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# name -> (code, state_prefix, level) for the districts that already exist.
_KNOWN = (
    ("Ujjain", "UJ", "MP", "district"),
    ("Jalna", "JL", "MH", "district"),
    ("Meghalaya", "ML", "ML", "state"),
)


def upgrade() -> None:
    """Upgrade schema."""
    # server_default backfills the existing rows; dropped afterwards so the
    # column matches the ORM (which supplies the default on insert).
    op.add_column('program_districts',
                  sa.Column('level', sa.String(), nullable=False, server_default='district'))
    op.add_column('program_districts', sa.Column('parent_id', sa.Integer(), nullable=True))
    op.add_column('program_districts',
                  sa.Column('inherits_content', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('program_districts', sa.Column('code', sa.String(), nullable=True))
    op.add_column('program_districts', sa.Column('state_prefix', sa.String(), nullable=True))
    op.alter_column('program_districts', 'level', server_default=None)
    op.alter_column('program_districts', 'inherits_content', server_default=None)

    op.create_index(op.f('ix_program_districts_parent_id'), 'program_districts', ['parent_id'], unique=False)
    op.create_unique_constraint('program_districts_code_key', 'program_districts', ['code'])
    op.create_foreign_key('program_districts_parent_id_fkey', 'program_districts',
                          'program_districts', ['parent_id'], ['id'], ondelete='CASCADE')

    # Stamp the analytics identity the pipelines have always assumed.
    for name, code, prefix, level in _KNOWN:
        op.execute(sa.text(
            "UPDATE program_districts SET code = :code, state_prefix = :prefix, level = :level "
            "WHERE name = :name AND code IS NULL"
        ).bindparams(code=code, prefix=prefix, level=level, name=name))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('program_districts_parent_id_fkey', 'program_districts', type_='foreignkey')
    op.drop_constraint('program_districts_code_key', 'program_districts', type_='unique')
    op.drop_index(op.f('ix_program_districts_parent_id'), table_name='program_districts')
    op.drop_column('program_districts', 'state_prefix')
    op.drop_column('program_districts', 'code')
    op.drop_column('program_districts', 'inherits_content')
    op.drop_column('program_districts', 'parent_id')
    op.drop_column('program_districts', 'level')
