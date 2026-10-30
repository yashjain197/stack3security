"""
Declarative base for every table, pinned to this service's Postgres schema with stable constraint names.

Made by Yash Jain with passion.
"""

from datetime import UTC, datetime

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.config import get_settings

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def utcnow() -> datetime:
    """Timezone-aware current time in UTC."""
    return datetime.now(UTC)


class Base(DeclarativeBase):
    """Root of all ORM models; every table lives in the `chrome` schema owned by this service."""

    metadata = MetaData(schema=get_settings().db_schema, naming_convention=NAMING_CONVENTION)


class CreatedAtMixin:
    """Adds a server-side creation timestamp."""

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
