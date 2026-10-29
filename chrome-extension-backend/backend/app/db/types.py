"""
Shared column helpers: schema-qualified foreign keys and string-backed enums with CHECK constraints.

Made by Yash Jain with passion.
"""

from enum import StrEnum

from sqlalchemy import Enum, ForeignKey

from app.core.config import get_settings


def fk(target: str, ondelete: str | None = None) -> ForeignKey:
    """Foreign key qualified with this service's schema, e.g. fk("users.id")."""
    return ForeignKey(f"{get_settings().db_schema}.{target}", ondelete=ondelete)


def str_enum(enum_cls: type[StrEnum], name: str) -> Enum:
    """Store enums as VARCHAR plus a CHECK constraint; easier to migrate than native Postgres enums."""
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=max(len(m.value) for m in enum_cls),
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )
