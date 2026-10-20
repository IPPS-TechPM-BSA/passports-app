import unittest
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend import app as app_module
from backend.database import Base
from backend.models import FormQuestion, Location, Visitor
from backend.schemas import BulkDeleteRequest, StatusUpdate


def _visitor(visitor_id: str, location_id: str = "csc") -> Visitor:
    return Visitor(
        id=visitor_id,
        location_id=location_id,
        first_name="Ada",
        last_name="Lovelace",
        phone="8585550100",
        visit_type="walk-in",
        service_type="passports",
        status="Checked In",
    )


class VisitorDeleteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.sessionmaker() as db:
            db.add_all([
                Location(id="csc", name="CSC", password_hash="hash-csc"),
                Location(id="bookstore", name="Bookstore", password_hash="hash-bookstore"),
            ])
            await db.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_delete_visitor_removes_record(self):
        async with self.sessionmaker() as db:
            db.add(_visitor("v1"))
            await db.commit()

            result = await app_module.delete_visitor(visitor_id="v1", db=db, _loc="csc")
            remaining = (await db.execute(select(Visitor))).scalars().all()

        self.assertEqual(result, {"ok": True})
        self.assertEqual(remaining, [])

    async def test_delete_visitor_rejects_unknown_id(self):
        async with self.sessionmaker() as db:
            with self.assertRaises(HTTPException) as raised:
                await app_module.delete_visitor(visitor_id="missing", db=db, _loc="csc")

        self.assertEqual(raised.exception.status_code, 404)

    async def test_delete_visitor_rejects_location_mismatch(self):
        async with self.sessionmaker() as db:
            db.add(_visitor("v1", location_id="bookstore"))
            await db.commit()

            with self.assertRaises(HTTPException) as raised:
                await app_module.delete_visitor(visitor_id="v1", db=db, _loc="csc")

        self.assertEqual(raised.exception.status_code, 403)

    async def test_bulk_delete_removes_all_listed_visitors(self):
        async with self.sessionmaker() as db:
            db.add_all([_visitor("v1"), _visitor("v2"), _visitor("v3")])
            await db.commit()

            result = await app_module.bulk_delete_visitors(
                body=BulkDeleteRequest(ids=["v1", "v2"]),
                db=db,
                _loc="csc",
            )
            remaining = (await db.execute(select(Visitor))).scalars().all()

        self.assertEqual(result, {"ok": True, "deleted": 2})
        self.assertEqual([v.id for v in remaining], ["v3"])

    async def test_bulk_delete_rejects_cross_location_ids_without_deleting(self):
        async with self.sessionmaker() as db:
            db.add_all([_visitor("v1"), _visitor("v2", location_id="bookstore")])
            await db.commit()

            with self.assertRaises(HTTPException) as raised:
                await app_module.bulk_delete_visitors(
                    body=BulkDeleteRequest(ids=["v1", "v2"]),
                    db=db,
                    _loc="csc",
                )
            remaining = (await db.execute(select(Visitor))).scalars().all()

        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(len(remaining), 2)

    async def test_bulk_delete_rejects_unknown_ids_without_deleting(self):
        async with self.sessionmaker() as db:
            db.add(_visitor("v1"))
            await db.commit()

            with self.assertRaises(HTTPException) as raised:
                await app_module.bulk_delete_visitors(
                    body=BulkDeleteRequest(ids=["v1", "missing"]),
                    db=db,
                    _loc="csc",
                )
            remaining = (await db.execute(select(Visitor))).scalars().all()

        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(len(remaining), 1)

    async def test_bulk_delete_deduplicates_ids(self):
        async with self.sessionmaker() as db:
            db.add(_visitor("v1"))
            await db.commit()

            result = await app_module.bulk_delete_visitors(
                body=BulkDeleteRequest(ids=["v1", "v1"]),
                db=db,
                _loc="csc",
            )
            remaining = (await db.execute(select(Visitor))).scalars().all()

        self.assertEqual(result, {"ok": True, "deleted": 1})
        self.assertEqual(remaining, [])


class UndoSignOutTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.sessionmaker() as db:
            db.add_all([
                Location(id="csc", name="CSC", password_hash="hash-csc"),
                _visitor("v1"),
            ])
            await db.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_undo_sign_out_clears_timestamp(self):
        async with self.sessionmaker() as db:
            await app_module.update_visitor_status(
                visitor_id="v1",
                body=StatusUpdate(status="Signed Out"),
                db=db,
                _loc="csc",
            )
            signed_out = (await db.execute(select(Visitor).where(Visitor.id == "v1"))).scalar_one()
            self.assertEqual(signed_out.status, "Signed Out")
            self.assertIsNotNone(signed_out.sign_out_at)

            await app_module.update_visitor_status(
                visitor_id="v1",
                body=StatusUpdate(status="Checked In"),
                db=db,
                _loc="csc",
            )
            restored = (await db.execute(select(Visitor).where(Visitor.id == "v1"))).scalar_one()

        self.assertEqual(restored.status, "Checked In")
        self.assertIsNone(restored.sign_out_at)


class VisitorDateFilterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.sessionmaker() as db:
            db.add(Location(id="csc", name="CSC", password_hash="hash-csc"))
            # Stored as naive UTC. Oct 21 is PDT (UTC-7).
            for visitor_id, check_in_at in [
                ("morning", datetime(2026, 10, 21, 16, 0)),      # Oct 21, 9:00 am PT
                ("evening", datetime(2026, 10, 22, 0, 30)),      # Oct 21, 5:30 pm PT
                ("next-day", datetime(2026, 10, 22, 16, 0)),     # Oct 22, 9:00 am PT
                ("prev-night", datetime(2026, 10, 21, 6, 59)),   # Oct 20, 11:59 pm PT
            ]:
                visitor = _visitor(visitor_id)
                visitor.check_in_at = check_in_at
                db.add(visitor)
            await db.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def _ids(self, date: str | None) -> set[str]:
        async with self.sessionmaker() as db:
            visitors = await app_module.get_visitors(
                location="csc", date=date, start=None, end=None, search=None, db=db, _loc="csc"
            )
        return {v.id for v in visitors}

    async def test_date_filter_uses_the_pacific_calendar_day(self):
        self.assertEqual(await self._ids("2026-10-21"), {"morning", "evening"})
        self.assertEqual(await self._ids("2026-10-22"), {"next-day"})
        self.assertEqual(await self._ids("2026-10-20"), {"prev-night"})

    async def test_no_date_returns_every_visitor(self):
        self.assertEqual(len(await self._ids(None)), 4)

    async def test_invalid_date_is_rejected(self):
        async with self.sessionmaker() as db:
            with self.assertRaises(HTTPException) as raised:
                await app_module.get_visitors(
                    location="csc", date="not-a-date", start=None, end=None, search=None, db=db, _loc="csc"
                )

        self.assertEqual(raised.exception.status_code, 400)


class VisitorRangeFilterTests(VisitorDateFilterTests):
    """The visitor log's From/To range. Reuses the four check-ins from
    VisitorDateFilterTests (Oct 20 to 22 PT)."""

    async def _range_ids(self, start: str | None, end: str | None, date: str | None = None) -> set[str]:
        async with self.sessionmaker() as db:
            visitors = await app_module.get_visitors(
                location="csc", date=date, start=start, end=end, search=None, db=db, _loc="csc"
            )
        return {v.id for v in visitors}

    async def _rejects(self, start: str | None, end: str | None, date: str | None = None) -> None:
        with self.assertRaises(HTTPException) as raised:
            await self._range_ids(start, end, date)
        self.assertEqual(raised.exception.status_code, 400)

    async def test_range_is_inclusive_pacific_days(self):
        self.assertEqual(await self._range_ids("2026-10-21", "2026-10-21"), {"morning", "evening"})
        self.assertEqual(await self._range_ids("2026-10-20", "2026-10-21"), {"prev-night", "morning", "evening"})
        self.assertEqual(await self._range_ids("2026-10-20", "2026-10-22"), {"prev-night", "morning", "evening", "next-day"})

    async def test_open_ended_ranges(self):
        self.assertEqual(await self._range_ids("2026-10-22", None), {"next-day"})
        self.assertEqual(await self._range_ids(None, "2026-10-20"), {"prev-night"})
        self.assertEqual(len(await self._range_ids(None, None)), 4)

    async def test_range_with_no_check_ins_is_empty(self):
        self.assertEqual(await self._range_ids("2026-09-01", "2026-09-30"), set())

    async def test_backwards_range_is_rejected(self):
        await self._rejects("2026-10-22", "2026-10-20")

    async def test_date_cannot_be_combined_with_a_range(self):
        await self._rejects("2026-10-20", None, date="2026-10-21")
        await self._rejects(None, "2026-10-22", date="2026-10-21")

    async def test_unpadded_or_malformed_days_are_rejected(self):
        # strptime alone accepts "2026-1-5", and "2026-10-01" < "2026-9-30" as
        # strings, so a backwards range could slip through unnoticed.
        await self._rejects("2026-9-30", "2026-10-01")
        await self._rejects("2026-10-01", "2026-10-1")
        await self._rejects("2026-02-30", None)
        await self._rejects("2026-10-21T00:00", None)
        await self._rejects("２０２６-１０-２１", None)

    async def test_extreme_days_do_not_crash(self):
        self.assertEqual(len(await self._range_ids("0001-01-01", "9999-12-31")), 4)


class VisitorRangeDstTests(unittest.IsolatedAsyncioTestCase):
    """Pacific days are 25 hours when DST ends (Nov 1, 2026) and 23 hours when
    it starts (Mar 8, 2026); a range must end at the next local midnight."""

    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.sessionmaker = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.sessionmaker() as db:
            db.add(Location(id="csc", name="CSC", password_hash="hash-csc"))
            for visitor_id, check_in_at in [
                ("fall-late", datetime(2026, 11, 2, 7, 30)),     # Nov 1, 11:30 pm PST
                ("fall-next", datetime(2026, 11, 2, 8, 30)),     # Nov 2, 12:30 am PST
                ("spring-late", datetime(2026, 3, 9, 6, 30)),    # Mar 8, 11:30 pm PDT
                ("spring-next", datetime(2026, 3, 9, 7, 30)),    # Mar 9, 12:30 am PDT
            ]:
                visitor = _visitor(visitor_id)
                visitor.check_in_at = check_in_at
                db.add(visitor)
            await db.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def _range_ids(self, start: str, end: str) -> set[str]:
        async with self.sessionmaker() as db:
            visitors = await app_module.get_visitors(
                location="csc", date=None, start=start, end=end, search=None, db=db, _loc="csc"
            )
        return {v.id for v in visitors}

    async def test_day_dst_ends(self):
        self.assertEqual(await self._range_ids("2026-11-01", "2026-11-01"), {"fall-late"})
        self.assertEqual(await self._range_ids("2026-11-02", "2026-11-02"), {"fall-next"})

    async def test_day_dst_starts(self):
        self.assertEqual(await self._range_ids("2026-03-08", "2026-03-08"), {"spring-late"})
        self.assertEqual(await self._range_ids("2026-03-09", "2026-03-09"), {"spring-next"})


class VisitorRangeExportTests(VisitorDateFilterTests):
    """The Export button sends the visitor log's range. Reuses the four
    check-ins from VisitorDateFilterTests (Oct 20 to 22 PT)."""

    async def _export(self, start: str | None, end: str | None) -> tuple[str, list[str]]:
        async with self.sessionmaker() as db:
            response = await app_module.export_visitors(location="csc", start=start, end=end, db=db, _loc="csc")
        body = "".join([chunk async for chunk in response.body_iterator])
        _header, *rows = body.strip().splitlines()
        return response.headers["content-disposition"], [row.split(",")[0] for row in rows]

    async def test_export_only_includes_the_range(self):
        disposition, ids = await self._export("2026-10-20", "2026-10-21")
        self.assertEqual(ids, ["evening", "morning", "prev-night"])
        self.assertEqual(disposition, 'attachment; filename="visitors_csc_2026-10-20_to_2026-10-21.csv"')

    async def test_export_names_the_file_after_the_range(self):
        self.assertEqual((await self._export(None, None))[0], 'attachment; filename="visitors_csc.csv"')
        self.assertEqual((await self._export("2026-10-21", "2026-10-21"))[0], 'attachment; filename="visitors_csc_2026-10-21.csv"')
        self.assertEqual((await self._export("2026-10-21", None))[0], 'attachment; filename="visitors_csc_2026-10-21_to_now.csv"')
        self.assertEqual((await self._export(None, "2026-10-21"))[0], 'attachment; filename="visitors_csc_start_to_2026-10-21.csv"')

    async def test_empty_range_exports_just_the_header(self):
        self.assertEqual((await self._export("2026-09-01", "2026-09-30"))[1], [])

    async def test_export_rejects_a_backwards_range(self):
        with self.assertRaises(HTTPException) as raised:
            await self._export("2026-10-22", "2026-10-20")
        self.assertEqual(raised.exception.status_code, 400)

    async def test_export_rejects_another_location(self):
        async with self.sessionmaker() as db:
            with self.assertRaises(HTTPException) as raised:
                await app_module.export_visitors(location="other", start=None, end=None, db=db, _loc="csc")
        self.assertEqual(raised.exception.status_code, 403)


class StatsDateRangeTests(VisitorDateFilterTests):
    """Reuses the four check-ins from VisitorDateFilterTests (Oct 20 to 22 PT)."""

    async def _total(self, start: str | None, end: str | None) -> int:
        async with self.sessionmaker() as db:
            stats = await app_module.get_stats(location="csc", start=start, end=end, db=db, _loc="csc")
        return stats.total

    async def test_no_range_counts_every_visit(self):
        self.assertEqual(await self._total(None, None), 4)

    async def test_range_is_inclusive_pacific_days(self):
        self.assertEqual(await self._total("2026-10-21", "2026-10-21"), 2)
        self.assertEqual(await self._total("2026-10-20", "2026-10-21"), 3)
        self.assertEqual(await self._total("2026-10-21", "2026-10-22"), 3)

    async def test_open_ended_ranges(self):
        self.assertEqual(await self._total("2026-10-22", None), 1)
        self.assertEqual(await self._total(None, "2026-10-20"), 1)

    async def test_backwards_range_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            await self._total("2026-10-22", "2026-10-20")
        self.assertEqual(raised.exception.status_code, 400)


class VisitorExportTests(unittest.TestCase):
    QUESTIONS = [
        FormQuestion(key="id", position=0, title="Photo Identification", description=""),
        FormQuestion(key="photo", position=1, title="Passport Photo", description=""),
    ]

    def _export(self, *visitors: Visitor) -> list[dict]:
        header, *rows = app_module._visitor_export_rows(list(visitors), self.QUESTIONS)
        return [dict(zip(header, row)) for row in rows]

    def test_each_checklist_question_gets_a_one_zero_column(self):
        visitor = _visitor("v1")
        visitor.app_complete = False
        visitor.checklist = '{"photo":true,"id":false}'

        header = app_module._visitor_export_rows([visitor], self.QUESTIONS)[0]
        row = self._export(visitor)[0]

        self.assertEqual(
            header[9:12], ["Application Complete", "Photo Identification", "Passport Photo"]
        )
        self.assertEqual(row["Application Complete"], 0)
        self.assertEqual(row["Photo Identification"], 0)
        self.assertEqual(row["Passport Photo"], 1)
        self.assertNotIn("Checklist", header)
        self.assertNotIn("Subscribe", header)

    def test_survey_answers_are_exported_as_labels(self):
        visitor = _visitor("v1")
        visitor.affiliations = "student,staff"
        visitor.referral_sources = "passport_site"

        row = self._export(visitor)[0]

        self.assertEqual(row["UC San Diego Affiliation"], "Student, Staff")
        self.assertEqual(row["Heard About Us"], "Passport Site")

    def test_unasked_questions_are_blank(self):
        notary = _visitor("v1")
        notary.service_type = "notary"

        row = self._export(notary)[0]

        self.assertEqual(row["Application Complete"], "")
        self.assertEqual(row["Photo Identification"], "")
        self.assertEqual(row["Passport Photo"], "")

    def test_deleted_question_with_answers_keeps_a_column(self):
        old = _visitor("v1")
        old.checklist = '{"photo":true,"marriage_certificate":false}'
        new = _visitor("v2")
        new.checklist = '{"photo":false,"id":true}'

        rows = self._export(old, new)

        self.assertEqual(rows[0]["Marriage Certificate"], 0)
        self.assertEqual(rows[1]["Marriage Certificate"], "")
        self.assertEqual(rows[0]["Photo Identification"], "")


if __name__ == "__main__":
    unittest.main()
