"""add form_questions.position

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-12 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The order the kiosk hardcoded before questions became reorderable.
LEGACY_ORDER = ("photo", "citizenship", "id", "payment")


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'form_questions',
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
    )

    form_questions = sa.table(
        'form_questions',
        sa.column('key', sa.String()),
        sa.column('position', sa.Integer()),
    )
    for position, key in enumerate(LEGACY_ORDER):
        op.execute(
            form_questions.update()
            .where(form_questions.c.key == key)
            .values(position=position)
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('form_questions') as batch_op:
        batch_op.drop_column('position')
