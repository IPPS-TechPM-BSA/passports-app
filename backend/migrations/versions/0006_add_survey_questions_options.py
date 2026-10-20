"""add survey_questions.options

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-13 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # The possible selections of a "select all that apply" question, as a
    # JSON list. NULL for every other question type.
    op.add_column('survey_questions', sa.Column('options', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('survey_questions') as batch_op:
        batch_op.drop_column('options')
