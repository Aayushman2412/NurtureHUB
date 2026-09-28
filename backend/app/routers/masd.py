"""Admin MASD dashboard: /api/admin/masd/*.

The analysts' district report — adoption target fulfilment, activity
intensity, and malnutrition outcomes against NFHS — computed from the app's
own data (app/masd/). The report is aggregate: it names learners, never a
mother or child, but it is derived from their records, so the routes sit
behind the PHI emergency switch and every read and download is audited.
"""
from __future__ import annotations

from datetime import date
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, projects
from app.config import settings
from app.database import get_db
from app.dependencies import get_admin_email, get_current_admin, require_phi_access
from app.masd import data as masd_data
from app.masd import report as masd_report
from app.masd import rules as R
from app.rate_limit import limiter, principal_key
from app.security import audit, phi

router = APIRouter(
    prefix="/api/admin/masd",
    tags=["admin-masd"],
    dependencies=[Depends(get_current_admin), Depends(require_phi_access)],
)


def _project(db: Session, slug: str) -> models.ProgramDistrict:
    project = db.query(models.ProgramDistrict).filter(models.ProgramDistrict.slug == slug).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _dates(as_of: Optional[date], compare: Optional[date]) -> tuple:
    as_of = as_of or date.today()
    if compare is not None and compare >= as_of:
        raise HTTPException(status_code=422, detail="The comparison date must be before the report date")
    return as_of, compare


def _log_read(report: dict, project: models.ProgramDistrict) -> None:
    phi.log_list(
        resource_type="masd_report",
        count=report["outcomes"]["exclusions"]["total"]["total"],
        subject_type=phi.CHILD,
        detail={"scope": "aggregate_programme_report", "project": project.slug,
                "as_of": report["as_of"], "fields": ["z_scores", "dates", "demographic_categories"]},
    )


@router.get("/projects")
def masd_projects(db: Session = Depends(get_db)):
    """Projects for the picker, with how many F2F learners each has and
    whether its programme calendar has been set."""
    saved = {s.program_district_id: s for s in db.query(models.MasdProjectSettings).all()}
    out = []
    for p in db.query(models.ProgramDistrict).order_by(models.ProgramDistrict.name).all():
        ids = projects.member_project_ids(db, p)
        f2f = (
            db.query(func.count(models.FaceToFaceSelection.id))
            .join(models.User, models.User.id == models.FaceToFaceSelection.user_id)
            .filter(models.User.program_district_id.in_(ids))
            .scalar()
        )
        s = saved.get(p.id)
        out.append({
            "slug": p.slug, "name": p.name, "level": getattr(p, "level", None),
            "f2f_learners": f2f,
            "calendar_saved": bool(s and (s.training_date or s.tranche2_start)),
        })
    return out


@router.get("/report")
def masd_report_json(
    project: str = Query(...),
    as_of: Optional[date] = Query(None),
    compare: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    p = _project(db, project)
    as_of, compare = _dates(as_of, compare)
    report = masd_report.build(db, p, as_of, compare)
    _log_read(report, p)
    return report


def _download(db: Session, p: models.ProgramDistrict, as_of: date, compare: Optional[date],
              fmt: str, admin_email: str):
    report = masd_report.build(db, p, as_of, compare)
    if fmt == "pptx":
        from app.masd.pptx_export import build_deck
        buffer, media = build_deck(report), "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    else:
        from app.masd.xlsx_export import build_workbook
        buffer, media = build_workbook(report), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    # Synchronous and committed before the bytes go out: this is the moment the
    # figures leave the platform's custody (SECURITY.md).
    phi.log_export(
        resource_type="masd_report",
        record_count=report["outcomes"]["exclusions"]["total"]["total"],
        fmt=fmt,
        subject_type=phi.CHILD,
        db=db,
        detail={"project": p.slug, "as_of": report["as_of"], "by": admin_email,
                "contents": "aggregate programme report; learner names, no mother or child identifiers",
                "custody_note": "the exported file is in the custody of whoever holds it"},
    )
    db.commit()
    name = f"MASD_{p.name.replace(' ', '_')}_{as_of:%d%m%y}.{fmt}"
    return StreamingResponse(buffer, media_type=media,
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/report/pptx")
@limiter.limit(lambda: settings.RATE_LIMIT_EXPORT, key_func=principal_key)
def masd_report_pptx(
    request: Request,
    project: str = Query(...),
    as_of: Optional[date] = Query(None),
    compare: Optional[date] = Query(None),
    admin_email: str = Depends(get_admin_email),
    db: Session = Depends(get_db),
):
    """The report as a PowerPoint deck with native (editable) charts."""
    p = _project(db, project)
    as_of, compare = _dates(as_of, compare)
    return _download(db, p, as_of, compare, "pptx", admin_email)


@router.get("/report/xlsx")
@limiter.limit(lambda: settings.RATE_LIMIT_EXPORT, key_func=principal_key)
def masd_report_xlsx(
    request: Request,
    project: str = Query(...),
    as_of: Optional[date] = Query(None),
    compare: Optional[date] = Query(None),
    admin_email: str = Depends(get_admin_email),
    db: Session = Depends(get_db),
):
    """The learner-level MASD sheet plus the block, cadre and outcome tables."""
    p = _project(db, project)
    as_of, compare = _dates(as_of, compare)
    return _download(db, p, as_of, compare, "xlsx", admin_email)


# ── Programme calendar and benchmarks ──────────────────────────────────────


class BandValues(BaseModel):
    stunting: Optional[float] = Field(None, ge=0, le=100)
    underweight: Optional[float] = Field(None, ge=0, le=100)
    wasting: Optional[float] = Field(None, ge=0, le=100)


class DistrictTrend(BaseModel):
    label: str = Field("", max_length=120)
    rounds: List[str] = Field(default_factory=list, max_length=4)
    stunting: List[Optional[float]] = Field(default_factory=list, max_length=4)
    underweight: List[Optional[float]] = Field(default_factory=list, max_length=4)
    wasting: List[Optional[float]] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def _same_length(self):
        n = len(self.rounds)
        for name in ("stunting", "underweight", "wasting"):
            values = getattr(self, name)
            if len(values) != n:
                raise ValueError(f"{name} needs one value per survey round")
            if any(v is not None and not 0 <= v <= 100 for v in values):
                raise ValueError(f"{name} values must be percentages (0–100)")
        return self


class Benchmarks(BaseModel):
    label: str = Field("", max_length=120)
    age_bands: Dict[Literal["lt6", "m6_11"], BandValues] = Field(default_factory=dict)
    district_trend: Optional[DistrictTrend] = None


class SettingsIn(BaseModel):
    training_date: Optional[date] = None
    tranche2_start: Optional[date] = None
    benchmarks: Optional[Benchmarks] = None

    @model_validator(mode="after")
    def _order(self):
        if self.training_date and self.tranche2_start and self.tranche2_start <= self.training_date:
            raise ValueError("Tranche 2 must start after the training date")
        return self


def _settings_out(p: models.ProgramDistrict, s: Optional[models.MasdProjectSettings]) -> dict:
    return {
        "project": p.slug,
        "training_date": s.training_date.isoformat() if s and s.training_date else None,
        "tranche2_start": s.tranche2_start.isoformat() if s and s.tranche2_start else None,
        "benchmarks": masd_data.benchmarks_for(p, s),
        "benchmarks_are_default": not (s and s.benchmarks_json) and p.slug in R.DEFAULT_BENCHMARKS,
        "updated_by": s.updated_by if s else None,
        "updated_at": s.updated_at.isoformat() if s and s.updated_at else None,
    }


@router.get("/settings")
def get_settings(project: str = Query(...), db: Session = Depends(get_db)):
    p = _project(db, project)
    return _settings_out(p, masd_data.settings_for(db, p))


@router.put("/settings")
def put_settings(
    payload: SettingsIn,
    project: str = Query(...),
    admin_email: str = Depends(get_admin_email),
    db: Session = Depends(get_db),
):
    p = _project(db, project)
    s = masd_data.settings_for(db, p)
    if s is None:
        s = models.MasdProjectSettings(program_district_id=p.id)
        db.add(s)
    s.training_date = payload.training_date
    s.tranche2_start = payload.tranche2_start
    s.benchmarks_json = payload.benchmarks.model_dump() if payload.benchmarks else None
    s.updated_by = admin_email
    audit.record_sync(
        audit.Action.ADMIN_CONFIG_CHANGE,
        db=db,
        resource_type="masd_settings",
        resource_id=p.slug,
        is_phi=False,
        detail={"project": p.slug, "changes": payload.model_dump(mode="json"), "by": admin_email},
    )
    db.commit()
    db.refresh(s)
    return _settings_out(p, s)


class TrainerRoleIn(BaseModel):
    trainer_role: Optional[Literal["master_trainer", "facilitator"]] = None


@router.put("/learners/{user_id}/trainer-role")
def put_trainer_role(
    user_id: int,
    payload: TrainerRoleIn,
    admin_email: str = Depends(get_admin_email),
    db: Session = Depends(get_db),
):
    """Mark an F2F learner as a Master Trainer or Facilitator (or clear it).
    Only F2F-selected learners can hold the role — it is earned in F2F training."""
    selection = (
        db.query(models.FaceToFaceSelection)
        .filter(models.FaceToFaceSelection.user_id == user_id)
        .first()
    )
    if selection is None:
        raise HTTPException(status_code=404, detail="This learner is not selected for face-to-face training")
    before = selection.trainer_role
    selection.trainer_role = payload.trainer_role
    audit.record_sync(
        audit.Action.ADMIN_USER_CHANGE,
        db=db,
        resource_type="user",
        resource_id=user_id,
        is_phi=False,
        detail={"action": "trainer_role", "from": before, "to": payload.trainer_role, "by": admin_email},
    )
    db.commit()
    return {"user_id": user_id, "trainer_role": selection.trainer_role}
