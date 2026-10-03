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
    flagged = report["flags"]["items"]
    if flagged:
        # The follow-up flags name pregnancies by record ID, with their dates.
        phi.log_list(
            resource_type="masd_pregnancy_flags",
            count=len(flagged),
            subject_type=phi.MOTHER,
            detail={"project": project.slug, "as_of": report["as_of"],
                    "fields": ["mother_uid", "adoption_date", "lmp", "edd", "antenatal_check_dates"]},
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
    severe_stunting: Optional[float] = Field(None, ge=0, le=100)
    severe_underweight: Optional[float] = Field(None, ge=0, le=100)
    sam: Optional[float] = Field(None, ge=0, le=100)
    # The survey's sample size for this band, to weight the bands together.
    n: Optional[int] = Field(None, ge=0, le=10_000_000)


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
    # District NFHS fact sheets publish under-5 figures only.
    under5: Optional[BandValues] = None
    district_trend: Optional[DistrictTrend] = None


class TargetStep(BaseModel):
    """Expected adoptions per learner from `from` onwards — one tranche. Its
    follow-up counts after `buffer` days (None = the default: a week for the
    first tranche, four days for later ones)."""
    from_: date = Field(..., alias="from")
    anc: int = Field(0, ge=0, le=50)
    pnc_lt5: int = Field(0, ge=0, le=50)
    pnc_ge5: int = Field(0, ge=0, le=50)
    nurse: int = Field(0, ge=0, le=50)
    buffer: Optional[int] = Field(None, ge=0, le=60)

    model_config = {"populate_by_name": True}

    def stored(self) -> dict:
        return {"from": self.from_.isoformat(), "anc": self.anc, "pnc_lt5": self.pnc_lt5,
                "pnc_ge5": self.pnc_ge5, "nurse": self.nurse, "buffer": self.buffer}


class BatchIn(BaseModel):
    id: Optional[int] = None          # None = a new batch
    name: str = Field(..., min_length=1, max_length=80)
    end_date: date


class SettingsIn(BaseModel):
    training_date: Optional[date] = None
    tranche2_start: Optional[date] = None
    benchmarks: Optional[Benchmarks] = None
    # None = leave as they are (older clients); [] = back to the default.
    targets: Optional[List[TargetStep]] = Field(None, max_length=12)
    batches: Optional[List[BatchIn]] = Field(None, max_length=30)

    @model_validator(mode="after")
    def _order(self):
        if self.training_date and self.tranche2_start and self.tranche2_start <= self.training_date:
            raise ValueError("Tranche 2 must start after the training date")
        if self.targets:
            days = [t.from_ for t in self.targets]
            if len(set(days)) != len(days):
                raise ValueError("Two target steps start on the same date")
        if self.batches:
            names = [b.name.strip().lower() for b in self.batches]
            if len(set(names)) != len(names):
                raise ValueError("Two batches have the same name")
        return self


def _own_batches(db: Session, p: models.ProgramDistrict) -> List[models.MasdTrainingBatch]:
    return (db.query(models.MasdTrainingBatch)
            .filter(models.MasdTrainingBatch.program_district_id == p.id)
            .order_by(models.MasdTrainingBatch.end_date, models.MasdTrainingBatch.name).all())


def _settings_out(db: Session, p: models.ProgramDistrict, s: Optional[models.MasdProjectSettings]) -> dict:
    training = s.training_date if s else None
    tranche2 = s.tranche2_start if s else None
    counts = dict(
        db.query(models.FaceToFaceSelection.batch_id, func.count(models.FaceToFaceSelection.id))
        .filter(models.FaceToFaceSelection.batch_id.isnot(None))
        .group_by(models.FaceToFaceSelection.batch_id).all()
    )
    return {
        "project": p.slug,
        "training_date": training.isoformat() if training else None,
        "tranche2_start": tranche2.isoformat() if tranche2 else None,
        "benchmarks": masd_data.benchmarks_for(p, s),
        "benchmarks_are_default": not (s and s.benchmarks_json) and p.slug in R.DEFAULT_BENCHMARKS,
        "targets": (s.targets_json if s and s.targets_json else R.default_targets(p.slug, training, tranche2)),
        "targets_are_default": not (s and s.targets_json),
        "batches": [{"id": b.id, "name": b.name, "end_date": b.end_date.isoformat(),
                     "learners": counts.get(b.id, 0)} for b in _own_batches(db, p)],
        "updated_by": s.updated_by if s else None,
        "updated_at": s.updated_at.isoformat() if s and s.updated_at else None,
    }


@router.get("/settings")
def get_settings(project: str = Query(...), db: Session = Depends(get_db)):
    p = _project(db, project)
    return _settings_out(db, p, masd_data.settings_for(db, p))


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
    if payload.targets is not None:
        s.targets_json = sorted((t.stored() for t in payload.targets), key=lambda t: t["from"]) or None
    if payload.batches is not None:
        existing = {b.id: b for b in _own_batches(db, p)}
        keep = set()
        for b in payload.batches:
            row = existing.get(b.id) if b.id is not None else None
            if row is None:
                row = models.MasdTrainingBatch(program_district_id=p.id)
                db.add(row)
            row.name, row.end_date, row.updated_by = b.name.strip(), b.end_date, admin_email
            if b.id is not None:
                keep.add(b.id)
        for bid, row in existing.items():
            if bid not in keep:
                db.delete(row)        # its learners fall back to the project's training date
    s.updated_by = admin_email
    audit.record_sync(
        audit.Action.ADMIN_CONFIG_CHANGE,
        db=db,
        resource_type="masd_settings",
        resource_id=p.slug,
        is_phi=False,
        detail={"project": p.slug, "changes": payload.model_dump(mode="json", by_alias=True), "by": admin_email},
    )
    db.commit()
    db.refresh(s)
    return _settings_out(db, p, s)


# ── The expected-forms table (programme-wide) ──────────────────────────────


class ExpectedFormsIn(BaseModel):
    durations: List[int]
    rows: Dict[str, Dict[str, List[int]]]


@router.get("/expected-forms")
def get_expected_forms(db: Session = Depends(get_db)):
    table, is_default = masd_data.expected_forms_for(db)
    row = db.get(models.MasdRuleTable, masd_data.EXPECTED_FORMS_KEY)
    return {"table": table, "is_default": is_default, "default": R.default_expected_forms(),
            "rows": R.EXPECTED_ROWS,
            "updated_by": row.updated_by if row and not is_default else None,
            "updated_at": row.updated_at.isoformat() if row and row.updated_at and not is_default else None}


@router.put("/expected-forms")
def put_expected_forms(
    payload: ExpectedFormsIn,
    admin_email: str = Depends(get_admin_email),
    db: Session = Depends(get_db),
):
    """Replace the cumulative expected-forms table (e.g. with the analysts'
    revised LAP sheet). Every project's expected activity follows it."""
    table = payload.model_dump()
    problem = R.validate_expected_forms(table)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    row = db.get(models.MasdRuleTable, masd_data.EXPECTED_FORMS_KEY)
    if row is None:
        row = models.MasdRuleTable(key=masd_data.EXPECTED_FORMS_KEY, value_json=table)
        db.add(row)
    row.value_json, row.updated_by = table, admin_email
    audit.record_sync(
        audit.Action.ADMIN_CONFIG_CHANGE, db=db, resource_type="masd_rule_table",
        resource_id=masd_data.EXPECTED_FORMS_KEY, is_phi=False,
        detail={"table": masd_data.EXPECTED_FORMS_KEY, "by": admin_email},
    )
    db.commit()
    return get_expected_forms(db)


@router.delete("/expected-forms")
def reset_expected_forms(admin_email: str = Depends(get_admin_email), db: Session = Depends(get_db)):
    """Back to the default table."""
    row = db.get(models.MasdRuleTable, masd_data.EXPECTED_FORMS_KEY)
    if row is not None:
        db.delete(row)
        audit.record_sync(
            audit.Action.ADMIN_CONFIG_CHANGE, db=db, resource_type="masd_rule_table",
            resource_id=masd_data.EXPECTED_FORMS_KEY, is_phi=False,
            detail={"table": masd_data.EXPECTED_FORMS_KEY, "reset": True, "by": admin_email},
        )
        db.commit()
    return get_expected_forms(db)


# ── Which batch an F2F learner trained in ──────────────────────────────────


class BatchAssignIn(BaseModel):
    batch_id: Optional[int] = None


@router.put("/learners/{user_id}/batch")
def put_learner_batch(
    user_id: int,
    payload: BatchAssignIn,
    admin_email: str = Depends(get_admin_email),
    db: Session = Depends(get_db),
):
    """Put an F2F learner in a training batch (or none: the project's training
    date then starts their follow-up). The batch must belong to the learner's
    project, or to the state project it sits under."""
    selection = (db.query(models.FaceToFaceSelection)
                 .filter(models.FaceToFaceSelection.user_id == user_id).first())
    if selection is None:
        raise HTTPException(status_code=404, detail="This learner is not selected for face-to-face training")
    batch = None
    if payload.batch_id is not None:
        batch = db.get(models.MasdTrainingBatch, payload.batch_id)
        user = db.get(models.User, user_id)
        allowed = set()
        if user is not None and user.program_district_id is not None:
            allowed.add(user.program_district_id)
            pd = db.get(models.ProgramDistrict, user.program_district_id)
            if pd is not None and getattr(pd, "parent_id", None):
                allowed.add(pd.parent_id)
        if batch is None or batch.program_district_id not in allowed:
            raise HTTPException(status_code=404, detail="Batch not found for this learner's project")
    before = selection.batch_id
    selection.batch_id = payload.batch_id
    audit.record_sync(
        audit.Action.ADMIN_USER_CHANGE, db=db, resource_type="user", resource_id=user_id, is_phi=False,
        detail={"action": "f2f_batch", "from": before, "to": payload.batch_id, "by": admin_email},
    )
    db.commit()
    return {"user_id": user_id, "batch_id": selection.batch_id,
            "batch": batch.name if batch else None,
            "end_date": batch.end_date.isoformat() if batch else None}


@router.get("/batches")
def list_batches(project: str = Query(...), db: Session = Depends(get_db)):
    """A project's training batches (with those of the state it sits under),
    for the batch pickers on the Results and MASD pages."""
    p = _project(db, project)
    ids = [p.id] + ([p.parent_id] if getattr(p, "parent_id", None) else [])
    ids += projects.member_project_ids(db, p)
    rows = (db.query(models.MasdTrainingBatch)
            .filter(models.MasdTrainingBatch.program_district_id.in_(set(ids)))
            .order_by(models.MasdTrainingBatch.end_date, models.MasdTrainingBatch.name).all())
    return [{"id": b.id, "name": b.name, "end_date": b.end_date.isoformat()} for b in rows]


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
