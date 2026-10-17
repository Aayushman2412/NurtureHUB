"""Registration by project (review of 17 Oct 2026).

Sir: "if I tell you tomorrow is the registration for Chandrapur, restrict all
the options in the registration page only to Chandrapur" — a learner who picks
the wrong state or district lands in the wrong project, sees the wrong
content and is counted in the wrong place, and "such errors may happen in
hardly 1 or 2%, but I don't want to allow even that when we have the
technology which can take care of it".

So an administrator gives a project its registration place (state + district)
and opens its registration:

* the project's own link (``/join/<slug>``) fills in the state and district
  and locks them;
* while any project is open, the plain registration form offers only the open
  projects' states and districts;
* a learner who completes registration in an open project's district is put
  in that project straight away, so their training is waiting for them.

With no project open, registration offers every place, as before, and an
administrator assigns projects by hand.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models


def open_projects(db: Session) -> List[models.ProgramDistrict]:
    return (db.query(models.ProgramDistrict)
            .filter(models.ProgramDistrict.is_active.is_(True),
                    models.ProgramDistrict.registration_open.is_(True),
                    models.ProgramDistrict.reg_district_id.isnot(None))
            .order_by(models.ProgramDistrict.name).all())


def _place(db: Session, p: models.ProgramDistrict) -> Dict[str, Any]:
    district = db.get(models.District, p.reg_district_id) if p.reg_district_id else None
    state_id = p.reg_state_id or (district.state_id if district else None)
    state = db.get(models.State, state_id) if state_id else None
    return {
        "project": {"slug": p.slug, "name": p.name},
        "state": {"id": state.id, "name": state.name} if state else None,
        "district": {"id": district.id, "name": district.name} if district else None,
    }


def scope(db: Session, project_slug: Optional[str] = None) -> Dict[str, Any]:
    """What the registration form may offer.

    ``locked`` — the place of the project whose link was used (fields fixed);
    ``places`` — every open project's place; ``state_ids`` / ``district_ids``
    — the allowed values, or None for "no restriction"."""
    if project_slug:
        p = (db.query(models.ProgramDistrict)
             .filter(models.ProgramDistrict.slug == project_slug.strip().lower()).first())
        if p is None or not p.is_active or not p.registration_open or not p.reg_district_id:
            return {"locked": None, "link_closed": True, "places": [], "state_ids": None, "district_ids": None}
        place = _place(db, p)
        return {
            "locked": place, "link_closed": False, "places": [place],
            "state_ids": [place["state"]["id"]] if place["state"] else None,
            "district_ids": [place["district"]["id"]],
        }
    places = [_place(db, p) for p in open_projects(db)]
    if not places:
        return {"locked": None, "link_closed": False, "places": [], "state_ids": None, "district_ids": None}
    return {
        "locked": None, "link_closed": False, "places": places,
        "state_ids": sorted({pl["state"]["id"] for pl in places if pl["state"]}),
        "district_ids": sorted({pl["district"]["id"] for pl in places if pl["district"]}),
    }


def assign(db: Session, user: models.User, join_slug: Optional[str]) -> Optional[models.ProgramDistrict]:
    """Put a newly registered learner in their project. An existing project
    (an administrator's assignment) is never changed."""
    if user.program_district_id:
        return None
    if join_slug:
        p = (db.query(models.ProgramDistrict)
             .filter(models.ProgramDistrict.slug == join_slug.strip().lower()).first())
        if p is None or not p.is_active or not p.registration_open or not p.reg_district_id:
            raise HTTPException(status_code=400, detail=(
                "This registration link is closed. Ask your trainer for the current link."))
        if user.district_id != p.reg_district_id:
            district = db.get(models.District, p.reg_district_id)
            raise HTTPException(status_code=400, detail=(
                f"This registration link is for {district.name if district else p.name} district."))
        user.program_district_id = p.id
        return p
    matches = [p for p in open_projects(db) if p.reg_district_id == user.district_id]
    if len(matches) == 1:
        user.program_district_id = matches[0].id
        return matches[0]
    return None
