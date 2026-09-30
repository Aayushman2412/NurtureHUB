"""Load one project's records for the MASD engine.

Column-pruned queries only: the engine needs dates, types and a handful of
demographic fields, never names of mothers or children, so those are not read
(a mother's record ID is, for the pregnancies the dashboard flags). The one
JSON blob loaded is the growth form's answers, for weight and length.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app import models, projects
from app.masd import rules as R
from app.masd.engine import ActivityIn, ChildIn, GrowthIn, LearnerIn, MasdData, MotherIn


def settings_for(db: Session, project: models.ProgramDistrict) -> Optional[models.MasdProjectSettings]:
    return db.get(models.MasdProjectSettings, project.id)


EXPECTED_FORMS_KEY = "expected_forms"


def expected_forms_for(db: Session) -> Tuple[Dict[str, Any], bool]:
    """The cumulative expected-forms table: the admin's saved one, else the
    default (second value True). A saved table that no longer fits the rules'
    shape falls back to the default rather than breaking the dashboard."""
    row = db.get(models.MasdRuleTable, EXPECTED_FORMS_KEY)
    if row is not None and R.validate_expected_forms(row.value_json or {}) is None:
        return row.value_json, False
    return R.default_expected_forms(), True


def batches_for(db: Session, member_ids: List[int]) -> List[Dict[str, Any]]:
    return [
        {"id": b.id, "name": b.name, "end_date": b.end_date, "project_id": b.program_district_id}
        for b in db.query(models.MasdTrainingBatch)
        .filter(models.MasdTrainingBatch.program_district_id.in_(member_ids))
        .order_by(models.MasdTrainingBatch.end_date, models.MasdTrainingBatch.name)
    ]


def benchmarks_for(project: models.ProgramDistrict,
                   saved: Optional[models.MasdProjectSettings]) -> Optional[Dict]:
    if saved is not None and saved.benchmarks_json:
        return saved.benchmarks_json
    return R.DEFAULT_BENCHMARKS.get(project.slug)


def load(db: Session, project: models.ProgramDistrict) -> MasdData:
    from app.routers.growth import GROWTH_FORM_KEY, growth_metrics

    member_ids = projects.member_project_ids(db, project)

    # Learners of the project (a state covers its districts), with the
    # designation name and block name resolved.
    rows = (
        db.query(
            models.User.id, models.User.full_name, models.User.email, models.User.role,
            models.Designation.name, models.Block.name, models.Department.code,
        )
        .outerjoin(models.Designation, models.User.designation_id == models.Designation.id)
        .outerjoin(models.Block, models.User.block_id == models.Block.id)
        .outerjoin(models.Department, models.User.department_id == models.Department.id)
        .filter(models.User.program_district_id.in_(member_ids))
        .filter(models.User.is_admin.is_(False))
        .all()
    )
    learner_ids = [r[0] for r in rows]
    batches = batches_for(db, member_ids)
    batch_end = {b["id"]: b["end_date"] for b in batches}
    f2f = {
        uid: (role, batch_id) for uid, role, batch_id in
        db.query(models.FaceToFaceSelection.user_id, models.FaceToFaceSelection.trainer_role,
                 models.FaceToFaceSelection.batch_id)
        .filter(models.FaceToFaceSelection.user_id.in_(learner_ids))
        .all()
    } if learner_ids else {}
    learners = []
    for uid, full_name, email, role, designation, block, dept in rows:
        trainer_role, batch_id = f2f.get(uid, (None, None))
        learners.append(LearnerIn(
            id=uid, name=full_name or email, email=email or "",
            role=designation or role, block=block, department=dept,
            f2f=uid in f2f, trainer_role=trainer_role,
            batch_id=batch_id if batch_id in batch_end else None,
            training_end=batch_end.get(batch_id),
        ))

    mothers: List[MotherIn] = []
    for (mid, uid, learner_id, adoption_date, lmp, created_at, age, dob, ration, social) in (
        db.query(
            models.Mother.id, models.Mother.mother_uid, models.Mother.registered_by_user_id,
            models.Mother.adoption_date,
            models.Mother.lmp, models.Mother.created_at, models.Mother.mother_age,
            models.Mother.mother_dob, models.Mother.ration_card, models.Mother.social_category,
        )
        .filter(models.Mother.registered_by_user_id.in_(learner_ids))
        .all()
        if learner_ids else []
    ):
        anchor = adoption_date or (created_at.date() if created_at else None)
        if age is None and dob is not None and anchor is not None:
            age = anchor.year - dob.year - ((anchor.month, anchor.day) < (dob.month, dob.day))
        mothers.append(MotherIn(
            id=mid, uid=uid, learner_id=learner_id, adoption_date=adoption_date, lmp=lmp,
            created_on=created_at.date() if created_at else None, age=age,
            ration_card=ration, social_category=social,
        ))
    mother_ids = [m.id for m in mothers]

    children = [
        ChildIn(id=cid, mother_id=mid, dob=dob, adoption_date=adopted, gender=gender,
                birth_weight=bw, birth_length=bl, delivery_place=place, delivery_method=method)
        for (cid, mid, dob, adopted, gender, bw, bl, place, method) in (
            db.query(
                models.Child.id, models.Child.mother_id, models.Child.dob, models.Child.adoption_date,
                models.Child.gender, models.Child.birth_weight, models.Child.birth_length,
                models.Child.delivery_place, models.Child.delivery_method,
            )
            .filter(models.Child.mother_id.in_(mother_ids))
            .all()
            if mother_ids else []
        )
    ]
    child_ids = [c.id for c in children]

    activities: List[ActivityIn] = []
    growth_ids: List[int] = []
    growth_rows: Dict[int, tuple] = {}
    if mother_ids:
        q = db.query(
            models.FormResponse.id, models.FormResponse.form_key, models.FormResponse.submitted_by_user_id,
            models.FormResponse.assessment_date, models.FormResponse.mother_id, models.FormResponse.child_id,
        ).filter(
            models.FormResponse.status == "submitted",
            models.FormResponse.form_key.in_(tuple(R.ACTIVITY_FORMS.values())),
        )
        mothers_resp = q.filter(models.FormResponse.mother_id.in_(mother_ids)).all()
        children_resp = q.filter(models.FormResponse.child_id.in_(child_ids)).all() if child_ids else []
        seen = set()
        for rid, form_key, uid, on, mid, cid in list(mothers_resp) + list(children_resp):
            if rid in seen or on is None:
                continue
            seen.add(rid)
            activities.append(ActivityIn(form_key=form_key, learner_id=uid, on=on, mother_id=mid, child_id=cid))
            if form_key == GROWTH_FORM_KEY and cid is not None:
                growth_ids.append(rid)
                growth_rows[rid] = (cid, on)

    growth: List[GrowthIn] = []
    for rid, metrics in growth_metrics(db, growth_ids).items():
        cid, on = growth_rows[rid]
        growth.append(GrowthIn(child_id=cid, on=on, weight=metrics["weight"], length=metrics["length"]))

    saved = settings_for(db, project)
    table, table_default = expected_forms_for(db)
    return MasdData(
        project={"id": project.id, "slug": project.slug, "name": project.name,
                 "level": getattr(project, "level", None)},
        learners=learners,
        mothers=mothers,
        children=children,
        activities=activities,
        growth=growth,
        training_date=saved.training_date if saved else None,
        tranche2_start=saved.tranche2_start if saved else None,
        benchmarks=benchmarks_for(project, saved),
        calendar_saved=bool(saved and (saved.training_date or saved.tranche2_start)),
        batches=batches,
        targets=(saved.targets_json or None) if saved else None,
        expected_forms=table,
        expected_forms_default=table_default,
    )
