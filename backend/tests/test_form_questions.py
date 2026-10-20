import unittest

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend import app as app_module
from backend.database import Base
from backend.models import FormQuestion
from backend.schemas import CheckinRequest


class FormQuestionEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.sessionmaker() as db:
            db.add_all([
                FormQuestion(key="photo", position=0, title="Passport Photo", description="Photo?"),
                FormQuestion(key="citizenship", position=1, title="Proof of Citizenship", description="Proof?"),
                FormQuestion(key="id", position=2, title="Photo Identification", description="ID?"),
            ])
            await db.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_get_questions_returns_configured_order(self):
        async with self.sessionmaker() as db:
            questions = await app_module.get_questions(db=db)

        self.assertEqual([q.key for q in questions], ["photo", "citizenship", "id"])

    async def test_questions_cannot_be_changed_through_the_api(self):
        routes = {(route.path, method) for route in app_module.app.routes for method in getattr(route, "methods", ())}

        self.assertIn(("/api/questions", "GET"), routes)
        self.assertNotIn(("/api/questions", "PUT"), routes)


class CheckinServiceTypeTests(unittest.TestCase):
    def _checkin(self, **overrides) -> CheckinRequest:
        fields = dict(
            location_id="csc",
            first_name="Ada",
            last_name="Lovelace",
            phone="8585550100",
            email="ada@example.com",
            party_size=1,
            visit_type="walk-in",
            service_type="notary",
            affiliations="student",
            referral_sources="web",
        )
        fields.update(overrides)
        return CheckinRequest(**fields)

    def test_multiple_services_are_stored_in_a_fixed_order(self):
        body = self._checkin(service_type="photo-only, passports,photo-only")

        self.assertEqual(body.service_type, "passports,photo-only")

    def test_unknown_service_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._checkin(service_type="passports,haircut")

    def test_passport_and_photo_details_are_accepted_together(self):
        body = self._checkin(
            service_type="passports,photo-only",
            app_complete=True,
            checklist='{"photo": true}',
            photo_format="digital",
        )

        self.assertEqual(body.photo_format, "digital")

    def test_photo_format_needs_the_photo_service(self):
        with self.assertRaises(ValidationError):
            self._checkin(service_type="passports,notary", photo_format="digital")

    def test_checklist_needs_the_passport_service(self):
        with self.assertRaises(ValidationError):
            self._checkin(service_type="notary,photo-only", checklist='{"photo": true}')

    def test_email_is_required(self):
        with self.assertRaises(ValidationError):
            self._checkin(email="   ")
        with self.assertRaises(ValidationError):
            self._checkin(email=None)

    def test_a_service_is_always_required(self):
        with self.assertRaises(ValidationError):
            self._checkin(service_type="")
        with self.assertRaises(ValidationError):
            self._checkin(service_type=None)

    def test_returning_is_no_longer_a_visit_type(self):
        with self.assertRaises(ValidationError):
            self._checkin(visit_type="returning")

    def test_survey_answers_are_stored_in_form_order(self):
        body = self._checkin(affiliations="faculty, student", referral_sources="yelp,web,yelp")

        self.assertEqual(body.affiliations, "student,faculty")
        self.assertEqual(body.referral_sources, "web,yelp")

    def test_survey_answers_are_required(self):
        for missing in ({"affiliations": ""}, {"referral_sources": "  "}, {"affiliations": None}):
            with self.subTest(missing=missing), self.assertRaises(ValidationError):
                self._checkin(**missing)

    def test_na_and_other_are_accepted(self):
        body = self._checkin(affiliations="na", referral_sources="other,web")

        self.assertEqual(body.affiliations, "na")
        self.assertEqual(body.referral_sources, "web,other")

    def test_na_cannot_be_combined_with_an_affiliation(self):
        with self.assertRaises(ValidationError):
            self._checkin(affiliations="student,na")

    def test_unknown_survey_answer_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._checkin(referral_sources="web,billboard")


class CheckinChecklistTests(unittest.TestCase):
    def _checkin(self, checklist: str) -> CheckinRequest:
        return CheckinRequest(
            location_id="csc",
            first_name="Ada",
            last_name="Lovelace",
            phone="8585550100",
            email="ada@example.com",
            party_size=1,
            visit_type="walk-in",
            service_type="passports",
            app_complete=True,
            checklist=checklist,
            affiliations="na",
            referral_sources="other",
        )

    def test_checklist_accepts_staff_added_question_keys(self):
        body = self._checkin('{"photo": true, "marriage_certificate": false}')

        self.assertEqual(body.checklist, '{"photo":true,"marriage_certificate":false}')

    def test_checklist_rejects_malformed_keys(self):
        with self.assertRaises(ValidationError):
            self._checkin('{"Not A Key": true}')

    def test_checklist_rejects_non_boolean_values(self):
        with self.assertRaises(ValidationError):
            self._checkin('{"photo": "yes"}')


if __name__ == "__main__":
    unittest.main()
