import json
import unittest

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend import app as app_module
from backend.database import Base
from backend.models import Location, SurveyQuestion, SurveyResponse
from backend.schemas import (
    BulkDeleteRequest,
    SurveyAnswerIn,
    SurveyQuestionConfig,
    SurveyQuestionIn,
    SurveyResponseRequest,
)


def _question(question_id: str, position: int, question_type: str, label: str, required: bool = False):
    return SurveyQuestion(
        id=question_id,
        position=position,
        question_type=question_type,
        label=label,
        required=required,
    )


class SurveyEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.sessionmaker() as db:
            db.add_all([
                Location(id="csc", name="CSC", password_hash="hash-csc"),
                Location(id="bookstore", name="Bookstore", password_hash="hash-bookstore"),
                _question("rating-1", 0, "rating", "How would you rate your overall experience?", required=True),
                _question("checkbox-1", 1, "checkbox", "Was our staff friendly and helpful?", required=True),
                _question("text-1", 2, "text", "How can we improve your experience?"),
            ])
            await db.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_get_questions_returns_configured_order(self):
        async with self.sessionmaker() as db:
            questions = await app_module.get_survey_questions(db=db)

        self.assertEqual(
            [(q.id, q.type, q.required) for q in questions],
            [
                ("rating-1", "rating", True),
                ("checkbox-1", "checkbox", True),
                ("text-1", "text", False),
            ],
        )

    async def test_update_questions_replaces_full_set(self):
        body = SurveyQuestionConfig(questions=[
            SurveyQuestionIn(question_type="text", label="What did you think?", required=True),
            SurveyQuestionIn(question_type="rating", label="Rate your visit"),
        ])

        async with self.sessionmaker() as db:
            saved = await app_module.update_survey_questions(body=body, db=db, _loc="csc")
            rows = (await db.execute(select(SurveyQuestion).order_by(SurveyQuestion.position))).scalars().all()

        self.assertEqual([q.label for q in saved], ["What did you think?", "Rate your visit"])
        self.assertEqual([q.position for q in rows], [0, 1])
        self.assertEqual([q.question_type for q in rows], ["text", "rating"])

    async def test_saving_keeps_ids_and_deletes_answers_to_removed_questions(self):
        async with self.sessionmaker() as db:
            db.add(SurveyResponse(
                id="r1", location_id="csc", name="Ada", email="ada@example.com",
                answers=json.dumps([
                    {"question_id": "rating-1", "type": "rating", "label": "Old label", "value": 5},
                    {"question_id": "checkbox-1", "type": "checkbox", "label": "Staff?", "value": True},
                    {"question_id": "gone", "type": "text", "label": "Older", "value": "hi"},
                ]),
            ))
            await db.commit()

        body = SurveyQuestionConfig(questions=[
            SurveyQuestionIn(id="rating-1", question_type="rating", label="Renamed rating", required=True),
            SurveyQuestionIn(question_type="text", label="Brand new"),
        ])
        async with self.sessionmaker() as db:
            saved = await app_module.update_survey_questions(body=body, db=db, _loc="csc")
            stored = (await db.execute(select(SurveyResponse))).scalars().one()

        self.assertEqual(saved[0].id, "rating-1")
        self.assertEqual(saved[0].label, "Renamed rating")
        self.assertNotIn(saved[1].id, {"rating-1", "checkbox-1", "text-1"})
        self.assertEqual([a["question_id"] for a in json.loads(stored.answers)], ["rating-1"])

    async def test_saving_rejects_duplicate_ids(self):
        body = SurveyQuestionConfig(questions=[
            SurveyQuestionIn(id="rating-1", question_type="rating", label="A"),
            SurveyQuestionIn(id="rating-1", question_type="text", label="B"),
        ])
        async with self.sessionmaker() as db:
            with self.assertRaises(HTTPException) as raised:
                await app_module.update_survey_questions(body=body, db=db, _loc="csc")
        self.assertEqual(raised.exception.status_code, 400)

    async def _add_multiselect(self, required: bool = False):
        async with self.sessionmaker() as db:
            question = _question("multi-1", 3, "multiselect", "How did you hear about us?", required=required)
            question.options = '["Website", "Friend", "Walked by"]'
            db.add(question)
            await db.commit()

    async def _submit(self, *answers: SurveyAnswerIn):
        body = SurveyResponseRequest(
            location_id="csc",
            name="Ada Lovelace",
            email="ada@example.com",
            answers=[
                SurveyAnswerIn(question_id="rating-1", value=5),
                SurveyAnswerIn(question_id="checkbox-1", value=True),
                *answers,
            ],
        )
        async with self.sessionmaker() as db:
            await app_module.submit_survey_response(body=body, db=db)
            stored = (await db.execute(select(SurveyResponse))).scalars().one()
        return {entry["question_id"]: entry["value"] for entry in json.loads(stored.answers)}

    async def test_update_questions_stores_multiselect_options(self):
        body = SurveyQuestionConfig(questions=[
            SurveyQuestionIn(question_type="multiselect", label="Pick some", options=[" A ", "B", ""]),
            SurveyQuestionIn(question_type="text", label="Anything else?", options=["ignored"]),
        ])

        async with self.sessionmaker() as db:
            saved = await app_module.update_survey_questions(body=body, db=db, _loc="csc")

        self.assertEqual([(q.type, q.options) for q in saved], [("multiselect", ["A", "B"]), ("text", [])])

    def test_multiselect_question_needs_an_option(self):
        with self.assertRaises(ValidationError):
            SurveyQuestionIn(question_type="multiselect", label="Pick some", options=["  "])

    def test_multiselect_options_must_be_distinct(self):
        with self.assertRaises(ValidationError):
            SurveyQuestionIn(question_type="multiselect", label="Pick some", options=["Web", "web"])

    async def test_multiselect_answer_is_stored_in_form_order(self):
        await self._add_multiselect()

        values = await self._submit(SurveyAnswerIn(question_id="multi-1", value=["Friend", "Website", "Friend"]))

        self.assertEqual(values["multi-1"], ["Website", "Friend"])

    async def test_multiselect_rejects_unknown_selection(self):
        await self._add_multiselect()

        with self.assertRaises(HTTPException) as raised:
            await self._submit(SurveyAnswerIn(question_id="multi-1", value=["Billboard"]))

        self.assertEqual(raised.exception.status_code, 400)

    async def test_required_multiselect_needs_a_selection(self):
        await self._add_multiselect(required=True)

        with self.assertRaises(HTTPException) as raised:
            await self._submit(SurveyAnswerIn(question_id="multi-1", value=[]))

        self.assertEqual(raised.exception.status_code, 400)

    async def test_submit_response_snapshots_all_questions(self):
        body = SurveyResponseRequest(
            location_id="csc",
            name="Ada Lovelace",
            email="ada@example.com",
            answers=[
                SurveyAnswerIn(question_id="rating-1", value=5),
                SurveyAnswerIn(question_id="checkbox-1", value=True),
            ],
        )

        async with self.sessionmaker() as db:
            result = await app_module.submit_survey_response(body=body, db=db)
            rows = (await db.execute(select(SurveyResponse))).scalars().all()

        self.assertTrue(result["ok"])
        self.assertEqual(len(rows), 1)
        stored = rows[0]
        self.assertEqual(stored.location_id, "csc")
        self.assertEqual(stored.name, "Ada Lovelace")
        snapshot = json.loads(stored.answers)
        self.assertEqual([entry["question_id"] for entry in snapshot], ["rating-1", "checkbox-1", "text-1"])
        self.assertEqual([entry["value"] for entry in snapshot], [5, True, None])
        self.assertEqual(snapshot[2]["label"], "How can we improve your experience?")

    async def test_submit_response_rejects_invalid_rating(self):
        body = SurveyResponseRequest(
            location_id="csc",
            name="Ada Lovelace",
            email="ada@example.com",
            answers=[
                SurveyAnswerIn(question_id="rating-1", value=6),
                SurveyAnswerIn(question_id="checkbox-1", value=True),
            ],
        )

        async with self.sessionmaker() as db:
            with self.assertRaises(HTTPException) as raised:
                await app_module.submit_survey_response(body=body, db=db)

        self.assertEqual(raised.exception.status_code, 400)

    async def test_submit_response_rejects_non_boolean_checkbox(self):
        body = SurveyResponseRequest(
            location_id="csc",
            name="Ada Lovelace",
            email="ada@example.com",
            answers=[
                SurveyAnswerIn(question_id="rating-1", value=4),
                SurveyAnswerIn(question_id="checkbox-1", value="yes"),
            ],
        )

        async with self.sessionmaker() as db:
            with self.assertRaises(HTTPException) as raised:
                await app_module.submit_survey_response(body=body, db=db)

        self.assertEqual(raised.exception.status_code, 400)

    async def test_submit_response_rejects_missing_required_answer(self):
        body = SurveyResponseRequest(
            location_id="csc",
            name="Ada Lovelace",
            email="ada@example.com",
            answers=[SurveyAnswerIn(question_id="checkbox-1", value=True)],
        )

        async with self.sessionmaker() as db:
            with self.assertRaises(HTTPException) as raised:
                await app_module.submit_survey_response(body=body, db=db)

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("How would you rate your overall experience?", str(raised.exception.detail))

    async def test_submit_response_rejects_unknown_question(self):
        body = SurveyResponseRequest(
            location_id="csc",
            name="Ada Lovelace",
            email="ada@example.com",
            answers=[SurveyAnswerIn(question_id="missing", value=5)],
        )

        async with self.sessionmaker() as db:
            with self.assertRaises(HTTPException) as raised:
                await app_module.submit_survey_response(body=body, db=db)

        # 409 tells an open form the survey was edited since it loaded.
        self.assertEqual(raised.exception.status_code, 409)

    async def test_get_responses_returns_parsed_answers_for_location(self):
        async with self.sessionmaker() as db:
            await app_module.submit_survey_response(body=SurveyResponseRequest(
                location_id="csc",
                name="Ada Lovelace",
                email="ada@example.com",
                answers=[
                    SurveyAnswerIn(question_id="rating-1", value=5),
                    SurveyAnswerIn(question_id="checkbox-1", value=True),
                    SurveyAnswerIn(question_id="text-1", value="Great service"),
                ],
            ), db=db)

            responses = await app_module.get_survey_responses(location="csc", db=db, _loc="csc")

        self.assertEqual(len(responses), 1)
        self.assertEqual(responses[0].name, "Ada Lovelace")
        self.assertEqual(responses[0].answers[2].value, "Great service")

    async def _add_response(self, response_id: str, location_id: str = "csc"):
        async with self.sessionmaker() as db:
            db.add(SurveyResponse(
                id=response_id, location_id=location_id,
                name="Ada Lovelace", email="ada@example.com", answers="[]",
            ))
            await db.commit()

    async def _response_ids(self) -> set[str]:
        async with self.sessionmaker() as db:
            return {r.id for r in (await db.execute(select(SurveyResponse))).scalars().all()}

    async def test_bulk_delete_removes_listed_responses(self):
        for response_id in ("r1", "r2", "r3"):
            await self._add_response(response_id)

        async with self.sessionmaker() as db:
            result = await app_module.bulk_delete_survey_responses(
                body=BulkDeleteRequest(ids=["r1", "r3"]), db=db, _loc="csc"
            )

        self.assertEqual(result, {"ok": True, "deleted": 2})
        self.assertEqual(await self._response_ids(), {"r2"})

    async def test_bulk_delete_rejects_other_locations_responses_without_deleting(self):
        await self._add_response("r1")
        await self._add_response("r2", location_id="bookstore")

        async with self.sessionmaker() as db:
            with self.assertRaises(HTTPException) as raised:
                await app_module.bulk_delete_survey_responses(
                    body=BulkDeleteRequest(ids=["r1", "r2"]), db=db, _loc="csc"
                )

        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(await self._response_ids(), {"r1", "r2"})

    async def test_bulk_delete_rejects_unknown_ids_without_deleting(self):
        await self._add_response("r1")

        async with self.sessionmaker() as db:
            with self.assertRaises(HTTPException) as raised:
                await app_module.bulk_delete_survey_responses(
                    body=BulkDeleteRequest(ids=["r1", "missing"]), db=db, _loc="csc"
                )

        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(await self._response_ids(), {"r1"})

    async def test_get_responses_rejects_location_mismatch(self):
        async with self.sessionmaker() as db:
            with self.assertRaises(HTTPException) as raised:
                await app_module.get_survey_responses(location="bookstore", db=db, _loc="csc")

        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
