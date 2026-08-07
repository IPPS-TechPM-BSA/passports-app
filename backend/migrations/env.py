"""Alembic environment for the passports backend.

Deliberately synchronous. Alembic's command API is synchronous, and its async
template ends in ``asyncio.run()``, which cannot be called from the running
FastAPI event loop. backend/migrate.py bridges the gap with asyncio.to_thread
instead, so this file talks to SQLite through the stdlib driver.
"""

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import create_engine, pool
from sqlalchemy.engine import Connection

# .../backend/migrations/env.py -> parents[1] is backend/, parents[2] the repo
# root. Needed so "import backend" works no matter the working directory.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from backend.database import Base, sync_database_url  # noqa: E402
from backend import models  # noqa: E402,F401  registers tables on Base.metadata

config = context.config

# Skipped when migrations run in-process at app startup: fileConfig would
# otherwise tear down uvicorn's already-installed logging handlers.
if config.config_file_name is not None and config.attributes.get(
    "configure_logger", True
):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _url() -> str:
    # Read from attributes rather than main options: Config values go through
    # configparser interpolation, where a '%' in a password would raise.
    return config.attributes.get("sqlalchemy_url") or sync_database_url()


def _configure(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite cannot ALTER most things in place, so autogenerate must render
        # alters as batch (table-rewrite) operations. Rendering only -- this
        # does not change how existing revisions execute.
        render_as_batch=connection.dialect.name == "sqlite",
        compare_type=True,
    )


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _configure(connection)
        with context.begin_transaction():
            context.run_migrations()
        return

    engine = create_engine(_url(), poolclass=pool.NullPool)
    try:
        with engine.connect() as conn:
            _configure(conn)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
