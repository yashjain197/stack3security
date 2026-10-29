"""
Alembic environment: runs migrations with the async engine inside this service's own Postgres schema.

Made by Yash Jain with passion.
"""

import asyncio

from alembic import context
from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.db.models import Base

settings = get_settings()
target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to) -> bool:  # noqa: ANN001
    """Only manage objects in our schema; never touch Imran's `vscode` schema."""
    schema = getattr(obj, "schema", None)
    return type_ != "table" or schema == settings.db_schema


def _configure(connection: Connection | None = None, **kwargs) -> None:
    """Shared Alembic configuration for online and offline modes."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table_schema=settings.db_schema,
        include_schemas=True,
        include_object=include_object,
        compare_type=True,
        **kwargs,
    )


def run_migrations_offline() -> None:
    """Emit SQL without a database connection."""
    _configure(url=settings.database_url, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def _run_sync(connection: Connection) -> None:
    """Create the schema if needed, then run migrations."""
    connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{settings.db_schema}"'))
    _configure(connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations against the live database."""
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as connection:
        await connection.run_sync(_run_sync)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
