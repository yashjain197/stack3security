"""
Seed the plan catalog: Free, Pro and Team plans, features, plan features and display prices.

Data is a snapshot inside the migration (not imported from app code) so history never changes.

Revision ID: a1c3e5f7b9d2
Revises: 37f8985d89db
Create Date: 2026-10-30 00:40:00

Made by Yash Jain with passion.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c3e5f7b9d2"
down_revision: str | None = "37f8985d89db"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "chrome"

PLANS = [
    {"id": 1, "code": "free", "name": "Free", "rank": 0, "is_paid": False, "min_seats": 1},
    {"id": 2, "code": "pro", "name": "Pro", "rank": 10, "is_paid": True, "min_seats": 1},
    {"id": 3, "code": "team", "name": "Team", "rank": 20, "is_paid": True, "min_seats": 3},
]

FEATURES = [
    {
        "id": 1,
        "code": "chrome_protection",
        "description": "Page scan, transaction review, phishing checks, GitHub banner",
    },
    {"id": 2, "code": "repo_scan_basic", "description": "Clone and scan safely, limited runs per month"},
    {"id": 3, "code": "repo_scan_unlimited", "description": "Unlimited Clone and scan safely"},
    {"id": 4, "code": "socket_scan", "description": "Socket package threat scanning"},
    {"id": 5, "code": "secret_scan", "description": "Hardcoded private key and seed phrase detection"},
    {"id": 6, "code": "ai_explain", "description": "Plain-English AI explanations of findings"},
    {
        "id": 7,
        "code": "workspace_guard",
        "description": "Warnings while working: file watcher, editor diagnostics",
    },
    {"id": 8, "code": "cli_private_repos", "description": "CLI scanning for private repositories"},
    {"id": 9, "code": "report_history", "description": "Scan report history"},
    {"id": 10, "code": "team_dashboard", "description": "Shared team dashboard"},
    {"id": 11, "code": "team_alerts", "description": "Team-wide threat alerts"},
    {
        "id": 12,
        "code": "org_policy",
        "description": "Organisation policies such as blocking critical dependencies",
    },
    {"id": 13, "code": "ci_tokens", "description": "CI and CLI automation tokens"},
    {"id": 14, "code": "seat_management", "description": "Invite and manage team seats"},
]

_PRO_FEATURE_IDS = [1, 3, 4, 5, 6, 7, 8, 9]
_TEAM_FEATURE_IDS = [*_PRO_FEATURE_IDS, 10, 11, 12, 13, 14]

PLAN_FEATURES = [
    {"plan_id": 1, "feature_id": 1, "monthly_limit": None},
    {"plan_id": 1, "feature_id": 2, "monthly_limit": 20},
    *({"plan_id": 2, "feature_id": f, "monthly_limit": None} for f in _PRO_FEATURE_IDS),
    *({"plan_id": 3, "feature_id": f, "monthly_limit": None} for f in _TEAM_FEATURE_IDS),
]

PRICES = [
    {"id": 1, "plan_id": 2, "interval": "month", "amount_cents": 900, "currency": "USD", "per_seat": False},
    {"id": 2, "plan_id": 2, "interval": "year", "amount_cents": 9000, "currency": "USD", "per_seat": False},
    {"id": 3, "plan_id": 3, "interval": "month", "amount_cents": 2900, "currency": "USD", "per_seat": True},
    {"id": 4, "plan_id": 3, "interval": "year", "amount_cents": 29000, "currency": "USD", "per_seat": True},
]


def _table(name: str, *columns: sa.Column) -> sa.Table:
    """Lightweight table handle for bulk inserts."""
    return sa.table(name, *columns, schema=SCHEMA)


def upgrade() -> None:
    """Insert the catalog rows."""
    op.bulk_insert(
        _table(
            "plans",
            sa.column("id"),
            sa.column("code"),
            sa.column("name"),
            sa.column("rank"),
            sa.column("is_paid"),
            sa.column("min_seats"),
        ),
        PLANS,
    )
    op.bulk_insert(_table("features", sa.column("id"), sa.column("code"), sa.column("description")), FEATURES)
    op.bulk_insert(
        _table("plan_features", sa.column("plan_id"), sa.column("feature_id"), sa.column("monthly_limit")),
        PLAN_FEATURES,
    )
    op.bulk_insert(
        _table(
            "plan_prices",
            sa.column("id"),
            sa.column("plan_id"),
            sa.column("interval"),
            sa.column("amount_cents"),
            sa.column("currency"),
            sa.column("per_seat"),
        ),
        PRICES,
    )


def downgrade() -> None:
    """Remove the catalog rows."""
    op.execute(f"DELETE FROM {SCHEMA}.plan_prices")
    op.execute(f"DELETE FROM {SCHEMA}.plan_features")
    op.execute(f"DELETE FROM {SCHEMA}.features")
    op.execute(f"DELETE FROM {SCHEMA}.plans")
