"""
Maps seeded plan prices to Dodo product IDs and seat add-on IDs from env vars.

The plans, features and prices themselves are seeded by migrations:
Free (Chrome protection + 20 repo scans/month), Pro ($9/month or $90/year),
Team ($29 per seat, base product includes 3 seats; extra seats are a Dodo seat add-on).

Made by Yash Jain with passion.
"""

from app.core.config import Settings

PRO_MONTHLY, PRO_YEARLY, TEAM_MONTHLY, TEAM_YEARLY = 1, 2, 3, 4


def product_ids_from_settings(settings: Settings) -> dict[int, str | None]:
    """Map each seeded price ID to its Dodo subscription product ID."""
    return {
        PRO_MONTHLY: settings.dodo_product_pro_monthly,
        PRO_YEARLY: settings.dodo_product_pro_yearly,
        TEAM_MONTHLY: settings.dodo_product_team_monthly,
        TEAM_YEARLY: settings.dodo_product_team_yearly,
    }


def seat_addon_ids_from_settings(settings: Settings) -> dict[int, str | None]:
    """Map each per-seat price ID to its Dodo seat add-on ID."""
    return {
        TEAM_MONTHLY: settings.dodo_addon_team_seat_monthly,
        TEAM_YEARLY: settings.dodo_addon_team_seat_yearly,
    }
