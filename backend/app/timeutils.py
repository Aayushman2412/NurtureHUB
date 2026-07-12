"""
Datetime helpers for consistent UTC handling across DB dialects.

SQLite stores DateTime values without timezone info even when the column is
declared timezone=True, so values read back are naive. If we then serialize them
with a bare .isoformat() (no offset), a browser's `new Date(iso)` parses them as
LOCAL time — shifting every displayed test schedule by the viewer's UTC offset.

These helpers coerce naive datetimes to UTC so serialized strings always carry an
explicit offset and clients interpret them correctly.
"""

from datetime import datetime, timezone
from typing import Optional


def to_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Return a timezone-aware UTC datetime (assume naive values are UTC)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso_utc(dt: Optional[datetime]) -> Optional[str]:
    """ISO-8601 string in UTC with an explicit offset, or None."""
    aware = to_utc(dt)
    return aware.isoformat() if aware else None


def utcnow() -> datetime:
    """Timezone-aware 'now' in UTC (replacement for the naive datetime.utcnow())."""
    return datetime.now(timezone.utc)
