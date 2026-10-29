"""
Seat-based Team billing via Dodo add-ons: prices get included_seats and a seat add-on ID.

Team base product includes 3 seats; every extra seat is one unit of the seat add-on.

Revision ID: b4d6f8a0c2e3
Revises: a1c3e5f7b9d2
Create Date: 2026-10-30 01:55:00

Made by Yash Jain with passion.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b4d6f8a0c2e3"
down_revision: str | None = "a1c3e5f7b9d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "chrome"


def upgrade() -> None:
    """Add seat columns and mark Team prices as including 3 seats."""
    op.add_column(
        "plan_prices",
        sa.Column("included_seats", sa.SmallInteger(), server_default=sa.text("1"), nullable=False),
        schema=SCHEMA,
    )
    op.add_column("plan_prices", sa.Column("dodo_seat_addon_id", sa.String(length=64), nullable=True), schema=SCHEMA)
    op.create_unique_constraint(
        op.f("uq_plan_prices_dodo_seat_addon_id"), "plan_prices", ["dodo_seat_addon_id"], schema=SCHEMA
    )
    op.create_check_constraint(
        op.f("ck_plan_prices_included_seats_positive"), "plan_prices", "included_seats >= 1", schema=SCHEMA
    )
    op.execute(f"UPDATE {SCHEMA}.plan_prices SET included_seats = 3 WHERE per_seat")


def downgrade() -> None:
    """Remove seat columns."""
    op.drop_constraint(op.f("ck_plan_prices_included_seats_positive"), "plan_prices", schema=SCHEMA, type_="check")
    op.drop_constraint(op.f("uq_plan_prices_dodo_seat_addon_id"), "plan_prices", schema=SCHEMA, type_="unique")
    op.drop_column("plan_prices", "dodo_seat_addon_id", schema=SCHEMA)
    op.drop_column("plan_prices", "included_seats", schema=SCHEMA)
