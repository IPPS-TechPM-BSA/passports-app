"""add form_questions.required

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-19 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0007'
down_revision: Union[str, Sequence[str], None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Every existing check-in question was required, so they stay required.
    op.add_column(
        'form_questions',
        sa.Column('required', sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('form_questions') as batch_op:
        batch_op.drop_column('required')
