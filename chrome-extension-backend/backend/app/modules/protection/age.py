"""
Turn a timestamp into a short phrase such as "yesterday" or "3 days ago".

Made by Yash Jain with passion.
"""

from datetime import datetime

from app.db.base import utcnow


def age_phrase(when: datetime | None, now: datetime | None = None, *, within_days: int = 30) -> str | None:
    """How long ago `when` was, or nothing when it is missing, in the future, or older than the window."""
    if when is None:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=utcnow().tzinfo)
    hours = ((now or utcnow()) - when).total_seconds() / 3600
    if hours < 0 or hours > within_days * 24:
        return None
    if hours < 1:
        return "less than an hour ago"
    if hours < 20:
        return f"{int(hours)} hours ago"
    if hours < 48:
        return "yesterday"
    days = max(int(hours / 24), 2)
    return f"{days} days ago"


def is_very_recent(phrase: str | None) -> bool:
    """True for a domain or contract that appeared within the last two days."""
    if not phrase:
        return False
    return phrase in {"yesterday", "less than an hour ago"} or phrase.endswith("hours ago")
