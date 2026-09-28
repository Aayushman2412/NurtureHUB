"""Load one project's records for the MASD engine.

Column-pruned queries only: the engine needs dates, types and a handful of
demographic fields, never names of mothers or children, so those are not read.
The one JSON blob loaded is the growth form's answers, for weight and length.
"""
from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app import models, projects
from app.masd import rules as R
from app.masd.engine import ActivityIn, ChildIn, GrowthIn, LearnerIn, MasdData, MotherIn


def settings_for(db: Session, project: models.ProgramDistrict) -> Optional[models.MasdProjectSettings]:
    return db.get(models.MasdProjectSettings, project.id)


def benchmarks_for(project: models.ProgramDistrict,
                   saved: Optional[models.MasdProjectSettings]) -> Optional[Dict]:
    if saved is not None and saved.benchmarks_json:
        return saved.benchmarks_json
    return R.DEFAULT_BENCHMARKS.get(project.slug)


def load(db: Session, project: models.ProgramDistrict) -> MasdData:
    from app.routers.growth import GROWTH_FORM_KEY, _extract_metrics

    member_ids = projects.member_project_ids(db, project)

    # Learners of the project (a state covers its districts), with the
    # designation name and block name resolved.
    rows = (
        db.query(
            models.User.id, models.User.full_name, models.User.email, models.User.role,
            models.Designation.name, models.Block.name,
        )
        .outerjoin(models.Designation, models.User.designation_id == models.Designation.id)
        .outerjoin(models.Block, models.User.block_id == models.Block.id)
        .filter(models.User.program_district_id.in_(member_ids))
        .filter(models.User.is_admin.is_(False))
        .all()
    )
    learner_ids = [r[0] for r in rows]
    f2f = {
        uid: role for uid, role in
        db.query(models.FaceToFaceSelection.user_id, models.FaceToFaceSelection.trainer_role)
        .filter(models.FaceToFaceSelection.user_id.in_(learner_ids))
        .all()
    } if learner_ids else {}
    learners = [
        LearnerIn(
            id=uid, name=full_name or email, email=email or "",
            role=designation or role, block=block,
            f2f=uid in f2f, trainer_role=f2f.get(uid),
        )
        for uid, full_name, email, role, designation, block in rows
    ]

    mothers: List[MotherIn] = []
    for (mid, learner_id, adoption_date, lmp, created_at, age, dob, ration, social) in (
        db.query(
            models.Mother.id, models.Mother.registered_by_user_id, models.Mother.adoption_date,
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
            id=mid, learner_id=learner_id, adoption_date=adoption_date, lmp=lmp,
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
    for start in range(0, len(growth_ids), 2000):
        chunk = growth_ids[start:start + 2000]
        for rid, answers in (
            db.query(models.FormResponse.id, models.FormResponse.answers_json)
            .filter(models.FormResponse.id.in_(chunk))
            .all()
        ):
            metrics = _extract_metrics(answers)
            cid, on = growth_rows[rid]
            growth.append(GrowthIn(child_id=cid, on=on, weight=metrics["weight"], length=metrics["length"]))

    saved = settings_for(db, project)
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
    )
