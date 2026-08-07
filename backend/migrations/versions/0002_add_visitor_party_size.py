"""add visitors.party_size

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-07

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_party_size() -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(c["name"] == "party_size" for c in inspector.get_columns("visitors"))


def upgrade() -> None:
    """Upgrade schema."""
    # ONE-TIME CONCESSION -- do not copy this guard into new migrations.
    #
    # Databases bootstrapped by the old create_all path AFTER 2026-08-04
    # (commit 1c87869) already have this column, yet they still get stamped at
    # 0001, because stamping answers only "is this database under Alembic
    # control", not "which columns exist". This guard reconciles the two. It
    # also makes the migration re-runnable after a crash between the DDL and
    # the alembic_version UPDATE, which SQLite's non-transactional DDL allows.
    #
    # Every migration from 0003 on starts from an Alembic-managed schema and
    # must be written as a plain, unguarded operation.
    if _has_party_size():
        return
    # SQLite supports native ALTER TABLE ADD COLUMN, so no batch_alter_table
    # here -- a batch rewrite would needlessly copy the whole visitors table
    # and push the churn to the Litestream replica.
    op.add_column("visitors", sa.Column("party_size", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    if not _has_party_size():
        return
    # DROP COLUMN is only native on SQLite >= 3.35; batch mode recreates the
    # table so this works anywhere. Destroys existing party_size values.
    with op.batch_alter_table("visitors") as batch_op:
        batch_op.drop_column("party_size")
