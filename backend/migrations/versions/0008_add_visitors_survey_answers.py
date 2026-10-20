"""add visitors.affiliations and visitors.referral_sources

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-19 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0008'
down_revision: Union[str, Sequence[str], None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Answers from the check-in's Customer Survey step, stored comma-separated
    # like visitors.service_type. NULL = not answered (or checked in earlier).
    op.add_column('visitors', sa.Column('affiliations', sa.String(length=100), nullable=True))
    op.add_column('visitors', sa.Column('referral_sources', sa.String(length=200), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('visitors') as batch_op:
        batch_op.drop_column('referral_sources')
        batch_op.drop_column('affiliations')
