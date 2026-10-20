"""delete stored answers to survey questions no longer on the form

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-19 20:00:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0009'
down_revision: Union[str, Sequence[str], None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Data only: from now on saving the survey deletes answers to removed
    questions, so clear out the ones left by earlier saves.

    Earlier saves gave every question a new id, so an answer whose id is
    stale but whose label and type still match a current question is kept and
    re-linked to it. Everything else is permanently deleted; the responses
    themselves (name, email, date) stay.
    """
    bind = op.get_bind()
    questions = bind.execute(sa.text(
        "SELECT id, label, question_type FROM survey_questions"
    )).fetchall()
    if not questions:
        # Nothing configured yet (a new database is seeded after migrating).
        return
    current_ids = {q.id for q in questions}
    by_label_and_type = {(q.label, q.question_type): q.id for q in questions}

    responses = bind.execute(sa.text("SELECT id, answers FROM survey_responses")).fetchall()
    for response in responses:
        try:
            answers = json.loads(response.answers)
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(answers, list):
            continue
        kept, seen = [], set()
        for answer in answers:
            if not isinstance(answer, dict):
                continue
            question_id = answer.get("question_id")
            if question_id not in current_ids:
                question_id = by_label_and_type.get((answer.get("label"), answer.get("type")))
            if question_id is None or question_id in seen:
                continue
            seen.add(question_id)
            kept.append({**answer, "question_id": question_id})
        if kept != answers:
            bind.execute(
                sa.text("UPDATE survey_responses SET answers = :answers WHERE id = :id"),
                {"answers": json.dumps(kept, separators=(",", ":")), "id": response.id},
            )


def downgrade() -> None:
    """Deleted answers cannot be restored."""
