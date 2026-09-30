"""Assemble the full MASD report for one project: now, the comparison date,
the then-vs-now progress and the findings. Shared by the JSON endpoint and
both downloads so every surface shows the same numbers."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app import models
from app.masd import data as D
from app.masd import engine as E
from app.masd import insights as I


def default_compare(report: Dict[str, Any]) -> Optional[date]:
    """The day before the targets were last raised — the review meeting, like
    the analysts' interim — else the day before tranche 2 opened."""
    as_of = date.fromisoformat(report["as_of"])
    raises = [date.fromisoformat(s["from"]) for s in report["calendar"]["targets"]["steps"][1:] if s.get("from")]
    raises = [d for d in raises if d <= as_of]
    if raises:
        d = max(raises) - timedelta(days=1)
        return d if d < as_of else None
    t2 = report["calendar"]["tranche2_start"]
    if not t2:
        return None
    d = date.fromisoformat(t2) - timedelta(days=1)
    return d if d < as_of else None


def build(db: Session, project: models.ProgramDistrict, as_of: date,
          compare: Optional[date] = None) -> Dict[str, Any]:
    data = D.load(db, project)
    now = E.compute(data, as_of)
    compare = compare or default_compare(now)
    cmp = None
    if compare and compare < as_of:
        cmp = E.comparison(E.compute(data, compare), now)
    now["comparison"] = cmp
    now["insights"] = I.all_findings(now, cmp)
    return now
