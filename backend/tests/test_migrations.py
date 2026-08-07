import logging
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from alembic.script import ScriptDirectory

from backend import migrate
from backend.database import sync_database_url
from backend.migrate import (
    BASELINE_REVISION,
    make_alembic_config,
    stamp_target,
    upgrade_to_head,
)
from backend.models import FormQuestion, Location, Visitor

# The schema exactly as Base.metadata.create_all produced it before commit
# 1c87869 added party_size. This is what is on the production volume today.
LEGACY_SCHEMA = """
CREATE TABLE locations (
    id VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    PRIMARY KEY (id)
);
CREATE TABLE form_questions (
    "key" VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    PRIMARY KEY ("key")
);
CREATE TABLE visitors (
    id VARCHAR(36) NOT NULL,
    location_id VARCHAR(20) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20) NOT NULL,
    visit_type VARCHAR(20) NOT NULL,
    service_type VARCHAR(20),
    photo_format VARCHAR(20),
    app_complete BOOLEAN,
    checklist TEXT,
    subscribe BOOLEAN,
    notes VARCHAR(100),
    status VARCHAR(20),
    check_in_at DATETIME,
    sign_out_at DATETIME,
    created_at DATETIME,
    PRIMARY KEY (id),
    FOREIGN KEY(location_id) REFERENCES locations (id)
);
"""

_INSERT_VISITOR = (
    "INSERT INTO visitors (id, location_id, first_name, last_name, phone, "
    "visit_type, subscribe, notes, status, check_in_at, created_at) VALUES "
    "('v1', 'csc', 'Ada', 'Lovelace', '8585550100', 'walk-in', 0, '', "
    "'Checked In', '2026-08-01 17:00:00', '2026-08-01 17:00:00')"
)


class _MigrationCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db_path = Path(tmp.name) / "passports.db"
        self.url = f"sqlite:///{self.db_path}"

        # backend.app installs an INFO handler on the "backend" logger at
        # import time; keep the adoption notice out of test output.
        migrate_logger = logging.getLogger("backend.migrate")
        previous_level = migrate_logger.level
        migrate_logger.setLevel(logging.WARNING)
        self.addCleanup(migrate_logger.setLevel, previous_level)

    def head(self) -> str:
        return ScriptDirectory.from_config(
            make_alembic_config(self.url)
        ).get_current_head()

    def columns(self, table: str) -> set[str]:
        with closing(sqlite3.connect(self.db_path)) as conn:
            return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}

    def tables(self) -> set[str]:
        with closing(sqlite3.connect(self.db_path)) as conn:
            return {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' "
                    "AND name NOT LIKE 'sqlite_%'"
                )
            }

    def stamped_revision(self) -> str | None:
        if "alembic_version" not in self.tables():
            return None
        with closing(sqlite3.connect(self.db_path)) as conn:
            return conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]

    def write_legacy_schema(self, with_party_size: bool = False) -> None:
        with closing(sqlite3.connect(self.db_path)) as conn:
            conn.executescript(LEGACY_SCHEMA)
            if with_party_size:
                conn.execute("ALTER TABLE visitors ADD COLUMN party_size INTEGER")
            conn.execute(
                "INSERT INTO locations VALUES ('csc', 'CSC', '$2b$04$stalehash')"
            )
            conn.execute(_INSERT_VISITOR)
            conn.commit()


class FreshDatabaseTests(_MigrationCase):
    def test_upgrade_creates_every_table_at_head(self):
        upgrade_to_head(self.url)

        self.assertEqual(
            self.tables(),
            {"locations", "visitors", "form_questions", "alembic_version"},
        )
        self.assertEqual(self.stamped_revision(), self.head())

    def test_migrated_columns_match_the_orm_models(self):
        """Guards against models.py changing without a matching revision.

        This is the check that would have caught commit 1c87869.
        """
        upgrade_to_head(self.url)

        for model in (Location, Visitor, FormQuestion):
            with self.subTest(table=model.__tablename__):
                self.assertEqual(
                    self.columns(model.__tablename__),
                    {c.name for c in model.__table__.columns},
                )

    def test_running_twice_is_a_no_op(self):
        upgrade_to_head(self.url)
        upgrade_to_head(self.url)

        self.assertEqual(self.stamped_revision(), self.head())


class LegacyDatabaseAdoptionTests(_MigrationCase):
    def test_pre_alembic_database_is_stamped_then_upgraded(self):
        """The exact state of production today."""
        self.write_legacy_schema()
        self.assertNotIn("party_size", self.columns("visitors"))
        self.assertIsNone(self.stamped_revision())
        self.assertEqual(stamp_target(self.url), BASELINE_REVISION)

        upgrade_to_head(self.url)

        self.assertIn("party_size", self.columns("visitors"))
        self.assertEqual(self.stamped_revision(), self.head())

    def test_adoption_preserves_existing_rows(self):
        self.write_legacy_schema()

        upgrade_to_head(self.url)

        with closing(sqlite3.connect(self.db_path)) as conn:
            row = conn.execute(
                "SELECT first_name, last_name, party_size FROM visitors WHERE id='v1'"
            ).fetchone()
        self.assertEqual(row, ("Ada", "Lovelace", None))

    def test_adoption_is_announced_once_and_not_repeated(self):
        """Operators rely on this line to confirm the one-time adoption ran."""
        self.write_legacy_schema()
        logger = "backend.migrate"

        with self.assertLogs(logger, level=logging.INFO) as first:
            upgrade_to_head(self.url)
        self.assertTrue(
            any("baseline revision 0001" in line for line in first.output),
            first.output,
        )

        with self.assertNoLogs(logger, level=logging.INFO):
            upgrade_to_head(self.url)

    def test_database_that_already_has_party_size_is_adopted_cleanly(self):
        """A create_all database bootstrapped after 2026-08-04."""
        self.write_legacy_schema(with_party_size=True)

        upgrade_to_head(self.url)  # must not raise "duplicate column name"

        self.assertEqual(self.stamped_revision(), self.head())
        self.assertIn("party_size", self.columns("visitors"))


class StampTargetTests(_MigrationCase):
    def test_empty_database_needs_no_stamp(self):
        self.assertIsNone(stamp_target(self.url))

    def test_already_managed_database_needs_no_stamp(self):
        upgrade_to_head(self.url)

        self.assertIsNone(stamp_target(self.url))


class SyncDatabaseUrlTests(unittest.TestCase):
    def _url_for(self, raw: str) -> str:
        with patch("backend.database.DATABASE_URL", raw):
            return sync_database_url()

    def test_absolute_aiosqlite_url_becomes_a_sync_sqlite_url(self):
        self.assertEqual(
            self._url_for("sqlite+aiosqlite:////data/passports.db"),
            "sqlite:////data/passports.db",
        )

    def test_relative_aiosqlite_url_is_preserved(self):
        self.assertEqual(
            self._url_for("sqlite+aiosqlite:///./passports.db"),
            "sqlite:///./passports.db",
        )

    def test_psycopg_url_is_already_synchronous(self):
        self.assertEqual(
            self._url_for("postgresql+psycopg://u:p@h:5432/db"),
            "postgresql+psycopg://u:p@h:5432/db",
        )


class RunMigrationsTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_migrations_dispatches_off_the_event_loop(self):
        with patch.object(migrate, "upgrade_to_head") as upgrade:
            await migrate.run_migrations()

        upgrade.assert_called_once_with(None)


if __name__ == "__main__":
    unittest.main()
