"""Many check-ins and staff actions at the same moment, against a real SQLite file.

An in-memory database cannot show locking problems, so these tests use a
temporary file and a separate session per request, as the running app does.
"""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend import app as app_module
from backend.database import Base
from backend.models import Location, Visitor
from backend.schemas import BulkDeleteRequest, CheckinRequest, StatusUpdate

CONCURRENT_CHECKINS = 60


def _checkin(i: int) -> CheckinRequest:
    services = ["passports", "notary", "photo-only", "passports,photo-only"][i % 4]
    fields = dict(
        location_id="csc" if i % 2 else "bookstore",
        first_name=f"Visitor{i}",
        last_name="Concurrent",
        email=f"visitor{i}@example.com",
        phone=f"858555{i:04d}",
        party_size=1,
        visit_type="walk-in" if i % 3 else "appointment",
        service_type=services,
        affiliations="student" if i % 2 else "na",
        referral_sources="web",
    )
    if "passports" in services:
        fields.update(app_complete=True, checklist=json.dumps({"photo": True, "id": False}))
    if "photo-only" in services:
        fields.update(photo_format="digital")
    return CheckinRequest(**fields)


class ConcurrentCheckinTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        url = f"sqlite+aiosqlite:///{Path(tmp.name) / 'passports.db'}"
        self.engine = create_async_engine(url, connect_args={"check_same_thread": False})
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

    async def _with_session(self, handler, *args, **kwargs):
        # One session per request, as FastAPI's get_db dependency gives each request.
        async with self.sessionmaker() as db:
            return await handler(*args, db=db, **kwargs)

    async def _count(self) -> int:
        async with self.sessionmaker() as db:
            return (await db.execute(select(func.count()).select_from(Visitor))).scalar_one()

    async def test_simultaneous_checkins_are_all_saved(self):
        results = await asyncio.gather(*(
            self._with_session(app_module.checkin, body=_checkin(i)) for i in range(CONCURRENT_CHECKINS)
        ))

        self.assertEqual(len({r.id for r in results}), CONCURRENT_CHECKINS)
        self.assertEqual(await self._count(), CONCURRENT_CHECKINS)

    async def test_dashboard_reads_during_a_rush_of_checkins(self):
        writes = [self._with_session(app_module.checkin, body=_checkin(i)) for i in range(CONCURRENT_CHECKINS)]
        reads = [
            self._with_session(app_module.get_stats, location="csc", start=None, end=None, _loc="csc")
            for _ in range(20)
        ]

        await asyncio.gather(*writes, *reads)

        stats = await self._with_session(app_module.get_stats, location="csc", start=None, end=None, _loc="csc")
        self.assertEqual(stats.total, CONCURRENT_CHECKINS // 2)

    async def test_simultaneous_sign_out_and_undo_leave_a_consistent_record(self):
        visitor = await self._with_session(app_module.checkin, body=_checkin(1))

        await asyncio.gather(*(
            self._with_session(
                app_module.update_visitor_status,
                visitor_id=visitor.id,
                body=StatusUpdate(status="Signed Out" if i % 2 else "Checked In"),
                _loc="csc",
            )
            for i in range(30)
        ))

        async with self.sessionmaker() as db:
            row = (await db.execute(select(Visitor).where(Visitor.id == visitor.id))).scalar_one()
        self.assertEqual(row.status == "Signed Out", row.sign_out_at is not None)

    async def test_overlapping_bulk_deletes_remove_every_targeted_row(self):
        created = [await self._with_session(app_module.checkin, body=_checkin(2 * i + 1)) for i in range(10)]
        ids = [c.id for c in created]

        outcomes = await asyncio.gather(
            self._with_session(app_module.bulk_delete_visitors, body=BulkDeleteRequest(ids=ids[:7]), _loc="csc"),
            self._with_session(app_module.bulk_delete_visitors, body=BulkDeleteRequest(ids=ids[3:]), _loc="csc"),
            return_exceptions=True,
        )

        # Each request either deletes its rows or, when the other got there
        # first, is refused with 404 so the dashboard refreshes. Anything else
        # (such as a database error) fails the test.
        failed_batches = []
        for batch, outcome in zip((ids[:7], ids[3:]), outcomes):
            if isinstance(outcome, Exception):
                self.assertEqual(getattr(outcome, "status_code", None), 404, outcome)
                failed_batches.append(set(batch))
        async with self.sessionmaker() as db:
            survivors = set((await db.execute(select(Visitor.id))).scalars().all())
        # A row can only survive if every request that targeted it was refused.
        for row_id in survivors:
            self.assertTrue(any(row_id in batch for batch in failed_batches), row_id)

if __name__ == "__main__":
    unittest.main()
