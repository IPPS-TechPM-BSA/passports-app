"""baseline schema

Captures the tables exactly as Base.metadata.create_all produced them before
visitors.party_size was added. Databases predating Alembic are STAMPED at this
revision rather than running it; see backend/migrate.py:stamp_target.

Columns whose models.py definition uses a Python-side ``default=`` are nullable
with no server default, because that is what create_all emitted.

Revision ID: 0001
Revises:
Create Date: 2026-08-07

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # locations first: visitors carries a foreign key to it.
    op.create_table(
        "locations",
        sa.Column("id", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "form_questions",
        sa.Column("key", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_table(
        "visitors",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("location_id", sa.String(length=20), nullable=False),
        sa.Column("first_name", sa.String(length=100), nullable=False),
        sa.Column("last_name", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=20), nullable=False),
        sa.Column("visit_type", sa.String(length=20), nullable=False),
        sa.Column("service_type", sa.String(length=20), nullable=True),
        sa.Column("photo_format", sa.String(length=20), nullable=True),
        sa.Column("app_complete", sa.Boolean(), nullable=True),
        sa.Column("checklist", sa.Text(), nullable=True),
        sa.Column("subscribe", sa.Boolean(), nullable=True),
        sa.Column("notes", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=True),
        sa.Column("check_in_at", sa.DateTime(), nullable=True),
        sa.Column("sign_out_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("visitors")
    op.drop_table("form_questions")
    op.drop_table("locations")
