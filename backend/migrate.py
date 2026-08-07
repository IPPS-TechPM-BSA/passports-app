"""Alembic migration runner and operator CLI.

Migrations are applied automatically at app startup (see backend/app.py). This
module is also runnable for inspection and recovery:

    python -m backend.migrate current
    python -m backend.migrate history
    python -m backend.migrate upgrade head

All paths resolve from __file__, so uvicorn running from /app, the module CLI,
and `kubectl exec` all see the same alembic.ini and versions/ directory.
"""

import argparse
import asyncio
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from .database import sync_database_url

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent
ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"
SCRIPT_LOCATION = _BACKEND_DIR / "migrations"

# Revision describing the schema as Base.metadata.create_all built it before
# visitors.party_size was added (commit 1c87869, 2026-08-04).
BASELINE_REVISION = "0001"

# Tables the pre-Alembic create_all bootstrap produced. Finding any of them
# without an alembic_version table means we are adopting a legacy database.
_LEGACY_TABLES = frozenset({"locations", "visitors", "form_questions"})


def make_alembic_config(url: str | None = None) -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(SCRIPT_LOCATION))
    # Passed via attributes, not sqlalchemy.url: main options go through
    # configparser interpolation, which would choke on a '%' in a password.
    cfg.attributes["sqlalchemy_url"] = url or sync_database_url()
    cfg.attributes["configure_logger"] = False
    return cfg


def stamp_target(url: str | None = None) -> str | None:
    """Revision to adopt a pre-Alembic database at, or None if not needed.

    Returns None both for databases already under Alembic control and for empty
    databases -- the latter simply upgrade from scratch.
    """
    engine = create_engine(url or sync_database_url())
    try:
        with engine.connect() as conn:
            tables = set(inspect(conn).get_table_names())
    finally:
        engine.dispose()

    if "alembic_version" in tables:
        return None
    if tables & _LEGACY_TABLES:
        return BASELINE_REVISION
    return None


def upgrade_to_head(url: str | None = None) -> None:
    """Adopt a legacy database if needed, then upgrade to head. Idempotent."""
    url = url or sync_database_url()
    cfg = make_alembic_config(url)

    target = stamp_target(url)
    if target is not None:
        logger.info(
            "No alembic_version table but application tables exist; adopting "
            "this database at baseline revision %s",
            target,
        )
        command.stamp(cfg, target)

    command.upgrade(cfg, "head")


async def run_migrations(url: str | None = None) -> None:
    """Run migrations off the event loop -- Alembic's command API is sync."""
    await asyncio.to_thread(upgrade_to_head, url)


def _current(args) -> None:
    command.current(make_alembic_config(), verbose=args.verbose)


def _history(args) -> None:
    command.history(make_alembic_config(), verbose=args.verbose)


def _heads(args) -> None:
    command.heads(make_alembic_config(), verbose=args.verbose)


def _upgrade(args) -> None:
    if args.revision == "head":
        upgrade_to_head()  # includes legacy adoption
    else:
        command.upgrade(make_alembic_config(), args.revision)


def _downgrade(args) -> None:
    command.downgrade(make_alembic_config(), args.revision)


def _stamp(args) -> None:
    command.stamp(make_alembic_config(), args.revision)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(
        description="Inspect and apply passports-app database migrations."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    for name, func, helptext in (
        ("current", _current, "Show the revision the database is stamped at."),
        ("history", _history, "Show the revision history."),
        ("heads", _heads, "Show the head revision(s)."),
    ):
        p = sub.add_parser(name, help=helptext)
        p.add_argument("-v", "--verbose", action="store_true")
        p.set_defaults(func=func)

    up = sub.add_parser("upgrade", help="Upgrade the database.")
    up.add_argument("revision", nargs="?", default="head")
    up.set_defaults(func=_upgrade)

    down = sub.add_parser("downgrade", help="Downgrade the database. Destroys data.")
    down.add_argument("revision")
    down.set_defaults(func=_downgrade)

    stamp = sub.add_parser(
        "stamp", help="Record a revision without running it. Recovery use only."
    )
    stamp.add_argument("revision")
    stamp.set_defaults(func=_stamp)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
