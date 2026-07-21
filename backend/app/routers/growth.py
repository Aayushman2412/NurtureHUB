"""Growth-monitoring (LAP) chart endpoints.

Derives per-child visit series from submitted form responses: a *visit* is the
set of responses sharing (child, assessment_date). Weight/length come from the
``growth_monitoring`` flat form; the breastfeeding / complementary_feeding
responses filed the same day determine the visit's "sources" combination, which
the charts color-code. Percentile backgrounds come from the WHO standards
tables (see app/who_growth.py).

Endpoints:
- GET /api/growth/standards            → WHO percentile curves (public reference data)
- GET /api/growth/my-cases             → the logged-in learner's cases
- GET /api/admin/growth/monitor        → all learner-mother-child cases (admin, ?district=)
- GET /api/admin/growth/responses/{id} → response detail for the visit modal (admin;
                                         learners use GET /api/forms/responses/{id})

Admin endpoints live under /api/admin/* because the frontend axios client
attaches the admin JWT only to that prefix.
"""

from collections import defaultdict
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.dependencies import get_current_admin, get_verified_user
from app.routers.forms import _serialize_detail
from app.who_growth import percentile_curves

router = APIRouter(prefix="/api/growth", tags=["growth"])
admin_router = APIRouter(prefix="/api/admin/growth", tags=["growth"])

GROWTH_FORM_KEY = "growth_monitoring"
VISIT_FORM_KEYS = ("growth_monitoring", "breastfeeding", "complementary_feeding")

# Plausible measurement ranges (kg / cm) — reject a mis-matched number field
# (the admin can rename/re-create fields, so extraction is heuristic).
WEIGHT_RANGE = (0.5, 35.0)
LENGTH_RANGE = (25.0, 130.0)


# ── Visit-series assembly ────────────────────────────────────────────────────

def _extract_metrics(answers_json: Any) -> Dict[str, Optional[float]]:
    """Pull the weight/length measurements out of a growth response's answer
    snapshots. The growth form is admin-editable, so fields are matched by
    id/label (contains "weight" / "length"|"height") with a range sanity check
    rather than by a hardcoded field id."""
    metrics: Dict[str, Optional[float]] = {"weight": None, "length": None}
    for snap in answers_json or []:
        if not isinstance(snap, dict) or not snap.get("value"):
            continue
        if snap.get("questionType") not in (None, "number"):
            continue
        key = f"{snap.get('nodeId') or ''} {snap.get('question') or ''}".lower()
        try:
            value = float(snap["value"])
        except (TypeError, ValueError):
            continue
        if "weight" in key and metrics["weight"] is None:
            if WEIGHT_RANGE[0] <= value <= WEIGHT_RANGE[1]:
                metrics["weight"] = value
        elif ("length" in key or "height" in key) and metrics["length"] is None:
            if LENGTH_RANGE[0] <= value <= LENGTH_RANGE[1]:
                metrics["length"] = value
    return metrics


def _build_cases(
    db: Session,
    *,
    user_id: Optional[int] = None,
    district_slug: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """One case per child: identity of the learner-mother-child triple plus the
    chronological visit series. Children without visits are included (they show
    as empty cases and let the UI offer the pair in filters).

    The learner is LEFT-joined: a mother's registered_by_user_id is nullable
    (ondelete=SET NULL), so a child whose registering account was removed still
    appears — as an orphaned case with learner=None — rather than silently
    vanishing from the admin monitor.
    """
    rows = (
        db.query(
            models.Child.id, models.Child.child_uid, models.Child.child_name,
            models.Child.gender, models.Child.dob, models.Child.birth_weight,
            models.Child.birth_length,
            models.Mother.id, models.Mother.mother_uid, models.Mother.mother_name,
            models.User.id, models.User.full_name, models.User.email,
            models.ProgramDistrict.name,
        )
        .join(models.Mother, models.Child.mother_id == models.Mother.id)
        .outerjoin(models.User, models.Mother.registered_by_user_id == models.User.id)
        .outerjoin(models.ProgramDistrict, models.User.program_district_id == models.ProgramDistrict.id)
    )
    if user_id is not None:
        # scope by the FK column so my-cases semantics are unchanged
        rows = rows.filter(models.Mother.registered_by_user_id == user_id)
    if district_slug:
        pd = (
            db.query(models.ProgramDistrict)
            .filter(models.ProgramDistrict.slug == district_slug)
            .first()
        )
        if not pd:
            return []
        rows = rows.filter(models.User.program_district_id == pd.id)
    rows = rows.order_by(models.User.full_name, models.Mother.mother_name, models.Child.id).all()

    cases: Dict[int, Dict[str, Any]] = {}
    for (child_id, child_uid, child_name, gender, dob, birth_weight, birth_length,
         mother_id, mother_uid, mother_name,
         learner_id, learner_name, learner_email, district_name) in rows:
        cases[child_id] = {
            "child": {
                "id": child_id,
                "uid": child_uid,
                "name": child_name,
                "gender": gender,
                "dob": dob.isoformat() if dob else None,
                "birth_weight": birth_weight,
                "birth_length": birth_length,
            },
            "mother": {"id": mother_id, "uid": mother_uid, "name": mother_name},
            "learner": (
                {
                    "id": learner_id,
                    "name": learner_name or learner_email,
                    "email": learner_email,
                    "district": district_name,
                }
                if learner_id is not None
                else {"id": None, "name": None, "email": None, "district": district_name}
            ),
            "visits": [],
        }
    if not cases:
        return []

    child_ids = list(cases.keys())

    # Visit skeleton: which forms were filed per (child, date). Column-pruned —
    # the JSON answer blobs are NOT loaded here (they can be large, and BF/CF
    # blobs are never parsed for the chart).
    visit_rows = (
        db.query(
            models.FormResponse.child_id,
            models.FormResponse.assessment_date,
            models.FormResponse.form_key,
            models.FormResponse.id,
        )
        .filter(
            models.FormResponse.child_id.in_(child_ids),
            models.FormResponse.form_key.in_(VISIT_FORM_KEYS),
            models.FormResponse.status == "submitted",
        )
        .order_by(models.FormResponse.assessment_date, models.FormResponse.id)
        .all()
    )

    # Weight/length come only from growth responses, so load answers_json for
    # just those rows (one narrow query) instead of every visit form.
    metrics_by_response: Dict[int, Dict[str, Optional[float]]] = {}
    growth_ids = [rid for (_, _, fk, rid) in visit_rows if fk == GROWTH_FORM_KEY]
    if growth_ids:
        for rid, answers in (
            db.query(models.FormResponse.id, models.FormResponse.answers_json)
            .filter(models.FormResponse.id.in_(growth_ids))
            .all()
        ):
            metrics_by_response[rid] = _extract_metrics(answers)

    # visit key = (child_id, assessment_date)
    visits: Dict[tuple, Dict[str, Any]] = defaultdict(lambda: {"forms": {}, "weight": None, "length": None})
    for child_id, assessment_date, form_key, response_id in visit_rows:
        if not assessment_date:
            continue
        visit = visits[(child_id, assessment_date)]
        visit["forms"][form_key] = response_id
        if form_key == GROWTH_FORM_KEY:
            metrics = metrics_by_response.get(response_id, {"weight": None, "length": None})
            visit["weight"] = metrics["weight"]
            visit["length"] = metrics["length"]

    for (child_id, visit_date), visit in sorted(visits.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        case = cases.get(child_id)
        if case is None:
            continue
        dob_iso = case["child"]["dob"]
        age_days = None
        if dob_iso:
            age_days = (visit_date - date.fromisoformat(dob_iso)).days
        case["visits"].append({
            "date": visit_date.isoformat(),
            "age_days": age_days,
            "weight": visit["weight"],
            "length": visit["length"],
            "sources": sorted(visit["forms"].keys()),
            "forms": visit["forms"],
        })

    return list(cases.values())


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/standards")
def get_standards():
    """WHO percentile curves for all indicators/sexes — public reference data
    (published WHO tables, nothing user-specific); the frontend caches this."""
    return percentile_curves()


@router.get("/my-cases")
def my_growth_cases(
    current_user: models.User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    return {"cases": _build_cases(db, user_id=current_user.id)}


@admin_router.get("/monitor")
def admin_growth_monitor(
    district: str = Query("", description="Program-district slug; empty = all districts"),
    admin: dict = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return {"cases": _build_cases(db, district_slug=district or None)}


@admin_router.get("/responses/{response_id}")
def admin_response_detail(
    response_id: int,
    admin: dict = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    response = (
        db.query(models.FormResponse)
        .filter(models.FormResponse.id == response_id)
        .first()
    )
    if not response:
        raise HTTPException(status_code=404, detail="Response not found")
    child = db.query(models.Child).filter(models.Child.id == response.child_id).first()
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")
    return _serialize_detail(response, child)
