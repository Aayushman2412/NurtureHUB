"""
Chandrapur demo project (review of 17 Oct 2026).

Sir, for the presentation: "create a Chandrapur project with whatever forms we
have currently … drag out some of the dummies from other sheets to this sheet,
irrespective of whatever district, and show it as Chandrapur."

    # 1. The project itself — real, nothing invented:
    #    phases, tutorials and (draft) tests copied from the source project,
    #    the same form versions, its MASD calendar and targets, its training
    #    batches (without trainers), and registration opened for
    #    Maharashtra › Chandrapur (sign-up link /join/chandrapur).
    python -m scripts.chandrapur_demo setup [--source jalna]

    # 2. Demo learners — ONLY the synthetic @nurturehub.mock learners, with
    #    their synthetic mothers, babies and forms, MOVED (not copied) from the
    #    source project into Chandrapur and placed in Chandrapur's talukas.
    #    Their video progress and quiz answers move to the copied videos.
    python -m scripts.chandrapur_demo move-mock [--count 40] [--source jalna]

    # 3. Put every moved learner back exactly as they were.
    python -m scripts.chandrapur_demo undo-mock

    # 4. NEW synthetic learners for Chandrapur (learner.ch.NNN@nurturehub.mock),
    #    in its real talukas with a gram panchayat as their village, with video
    #    progress, quizzes and F2F training like the other demo projects, and —
    #    for the F2F ones — adoptions and forms on Jalna's programme calendar.
    #    Nothing is added to the village or facility lists.
    python -m scripts.chandrapur_demo add-new [--count 260]
    python -m scripts.chandrapur_demo remove-new      # deletes exactly those

    # 5. Batch monitors for the faltering-cases list (review of 18 Oct 2026:
    #    "give me the faltering cases under me in a break-up of batch
    #    monitors"): in each F2F batch the first synthetic learner becomes the
    #    batch monitor of the batch's other synthetic learners.
    python -m scripts.chandrapur_demo monitors
    python -m scripts.chandrapur_demo undo-monitors   # exactly those, back

    python -m scripts.chandrapur_demo status

What was moved, and where from, is kept in masd_rule_tables under
"demo.chandrapur.moved" so undo works after a redeploy. Real learners are
never touched: the script refuses any account that is not @nurturehub.mock.
Test attempts stay with the source project's tests (the copies are drafts).
"""
from __future__ import annotations

import argparse
import sys
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func

from app import models
from app.database import SessionLocal
from app.routers.admin import _clone_stage

SLUG = "chandrapur"
MOCK_DOMAIN = "@nurturehub.mock"
UNDO_KEY = "demo.chandrapur.moved"


def _project(db, slug: str) -> Optional[models.ProgramDistrict]:
    return db.query(models.ProgramDistrict).filter(models.ProgramDistrict.slug == slug).first()


def _place(db) -> Tuple[models.State, models.District]:
    district = (db.query(models.District).join(models.State)
                .filter(models.District.name.ilike("chandrapur"), models.State.name.ilike("maharashtra")).first())
    if district is None:
        sys.exit("Chandrapur district is missing — run the migrations first (5d2a9c7e41f3).")
    return district.state, district


def setup(db, source_slug: str) -> models.ProgramDistrict:
    source = _project(db, source_slug)
    if source is None:
        sys.exit(f"No project '{source_slug}'.")
    state, district = _place(db)
    project = _project(db, SLUG)
    if project is None:
        code = "CH" if not db.query(models.ProgramDistrict).filter(models.ProgramDistrict.code == "CH").first() else None
        project = models.ProgramDistrict(name="Chandrapur", slug=SLUG, is_active=True,
                                         level=models.ProgramDistrict.LEVEL_DISTRICT, code=code, state_prefix="MH")
        db.add(project)
        db.flush()
        print(f"created project Chandrapur (id {project.id})")

    if not db.query(models.Stage).filter(models.Stage.program_district_id == project.id).count():
        stages = (db.query(models.Stage).filter(models.Stage.program_district_id == source.content_source_id)
                  .order_by(models.Stage.order_index).all())
        for i, stage in enumerate(stages):
            _clone_stage(db, stage, project.id, i, include_tests=True)
        print(f"copied {len(stages)} phases from {source.name} (tests as drafts)")

    pinned = {a.form_key for a in db.query(models.FormDistrictAssignment)
              .filter(models.FormDistrictAssignment.program_district_id == project.id)}
    for a in db.query(models.FormDistrictAssignment).filter(
            models.FormDistrictAssignment.program_district_id == source.id):
        if a.form_key not in pinned:
            db.add(models.FormDistrictAssignment(form_key=a.form_key, program_district_id=project.id,
                                                 version_id=a.version_id, assigned_by="chandrapur_demo"))

    src_settings = db.get(models.MasdProjectSettings, source.id)
    if src_settings is not None and db.get(models.MasdProjectSettings, project.id) is None:
        db.add(models.MasdProjectSettings(
            program_district_id=project.id, training_date=src_settings.training_date,
            tranche2_start=src_settings.tranche2_start, targets_json=src_settings.targets_json,
            benchmarks_json=None, updated_by="chandrapur_demo"))   # NFHS figures are district-specific

    have = {b.name for b in db.query(models.MasdTrainingBatch)
            .filter(models.MasdTrainingBatch.program_district_id == project.id)}
    for b in db.query(models.MasdTrainingBatch).filter(models.MasdTrainingBatch.program_district_id == source.id):
        if b.name not in have:
            db.add(models.MasdTrainingBatch(program_district_id=project.id, name=b.name, start_date=b.start_date,
                                            end_date=b.end_date, trainers=None, updated_by="chandrapur_demo"))

    project.reg_state_id, project.reg_district_id, project.registration_open = state.id, district.id, True
    db.commit()
    print(f"registration open for Maharashtra › Chandrapur — link /join/{SLUG}")
    return project


def _tutorial_map(db, from_project: int, to_project: int) -> Dict[int, int]:
    """Source tutorial id → its copy, matched by phase order and video order."""
    def keyed(pid):
        out = {}
        for stage in db.query(models.Stage).filter(models.Stage.program_district_id == pid):
            for tut in db.query(models.Tutorial).filter(models.Tutorial.stage_id == stage.id):
                out[(stage.order_index, tut.order_index, tut.title)] = tut.id
        return out
    a, b = keyed(from_project), keyed(to_project)
    return {a[k]: b[k] for k in a if k in b}


def _question_map(db, tut_map: Dict[int, int]) -> Tuple[Dict[int, int], Dict[int, int]]:
    q_map, o_map = {}, {}
    for src, dst in tut_map.items():
        sq = {q.order_index: q for q in db.query(models.TutorialQuestion).filter(models.TutorialQuestion.tutorial_id == src)}
        dq = {q.order_index: q for q in db.query(models.TutorialQuestion).filter(models.TutorialQuestion.tutorial_id == dst)}
        for k, q in sq.items():
            if k in dq:
                q_map[q.id] = dq[k].id
                so = {o.label: o.id for o in q.options}
                do = {o.label: o.id for o in dq[k].options}
                o_map.update({so[l]: do[l] for l in so if l in do})
    return q_map, o_map


def _remap_training(db, user_ids: List[int], tut_map: Dict[int, int]) -> int:
    q_map, o_map = _question_map(db, tut_map)
    moved = 0
    for p in db.query(models.UserTutorialProgress).filter(models.UserTutorialProgress.user_id.in_(user_ids)):
        if p.tutorial_id in tut_map:
            p.tutorial_id = tut_map[p.tutorial_id]
            moved += 1
    for r in db.query(models.TutorialQuizResponse).filter(models.TutorialQuizResponse.user_id.in_(user_ids)):
        if r.tutorial_id in tut_map:
            r.tutorial_id = tut_map[r.tutorial_id]
            r.question_id = q_map.get(r.question_id, r.question_id)
            if r.selected_option_id is not None:
                r.selected_option_id = o_map.get(r.selected_option_id, r.selected_option_id)
    return moved


def move_mock(db, source_slug: str, count: int) -> None:
    source, project = _project(db, source_slug), _project(db, SLUG)
    if source is None or project is None:
        sys.exit("Run `setup` first.")
    state, district = _place(db)
    talukas = (db.query(models.Block).filter(models.Block.district_id == district.id)
               .order_by(models.Block.subdivision, models.Block.name).all())
    gps = {t.id: [g.name for g in db.query(models.GramPanchayat)
                  .filter(models.GramPanchayat.block_id == t.id).order_by(models.GramPanchayat.name)]
           for t in talukas}
    row = db.get(models.MasdRuleTable, UNDO_KEY)
    record = dict(row.value_json) if row else {}

    # The busiest synthetic learners first, so the dashboards have something to show.
    candidates = (db.query(models.User)
                  .filter(models.User.program_district_id == source.id,
                          models.User.email.like(f"%{MOCK_DOMAIN}"), models.User.is_admin.is_(False))
                  .all())
    adopted = {uid: n for uid, n in db.query(models.Mother.registered_by_user_id, func.count(models.Mother.id))
               .filter(models.Mother.registered_by_user_id.in_([u.id for u in candidates]))
               .group_by(models.Mother.registered_by_user_id)} if candidates else {}
    candidates.sort(key=lambda u: (-adopted.get(u.id, 0), u.id))
    chosen = [u for u in candidates if str(u.id) not in record][:count]
    if not chosen:
        print("no synthetic learners left to move")
        return
    batch_by_name = {b.name: b.id for b in db.query(models.MasdTrainingBatch)
                     .filter(models.MasdTrainingBatch.program_district_id == project.id)}
    src_batches = {b.id: b.name for b in db.query(models.MasdTrainingBatch)
                   .filter(models.MasdTrainingBatch.program_district_id == source.id)}

    for i, u in enumerate(chosen):
        assert u.email.endswith(MOCK_DOMAIN), u.email          # never a real learner
        taluka = talukas[i % len(talukas)]
        village = (gps.get(taluka.id) or [taluka.name])[i % max(1, len(gps.get(taluka.id) or [1]))]
        f2f = db.query(models.FaceToFaceSelection).filter(models.FaceToFaceSelection.user_id == u.id).first()
        mothers = db.query(models.Mother).filter(models.Mother.registered_by_user_id == u.id).all()
        record[str(u.id)] = {
            "source": source.slug,
            "user": {"program_district_id": u.program_district_id, "state_id": u.state_id,
                     "district_id": u.district_id, "block_id": u.block_id, "village_id": u.village_id,
                     "village_name": u.village_name, "district": u.district, "facility_id": u.facility_id,
                     "work_center_name": u.work_center_name},
            "f2f": {"program_district_id": f2f.program_district_id, "batch_id": f2f.batch_id} if f2f else None,
            "mothers": {str(m.id): {"state_id": m.state_id, "district_id": m.district_id,
                                    "taluk_id": m.taluk_id, "village": m.village} for m in mothers},
        }
        u.program_district_id = project.id
        u.state_id, u.district_id, u.block_id = state.id, district.id, taluka.id
        u.village_id, u.village_name, u.district, u.facility_id = None, village, "Chandrapur", None
        u.work_center_name = f"{village} {u.work_center_type or 'Centre'}"
        if f2f is not None:
            f2f.program_district_id = project.id
            f2f.batch_id = batch_by_name.get(src_batches.get(f2f.batch_id)) if f2f.batch_id else None
        for m in mothers:
            m.state_id, m.district_id, m.taluk_id, m.village = state.id, district.id, taluka.id, village

    remapped = _remap_training(db, [u.id for u in chosen], _tutorial_map(db, source.id, project.id))
    if row is None:
        db.add(models.MasdRuleTable(key=UNDO_KEY, value_json=record, updated_by="chandrapur_demo"))
    else:
        row.value_json = record
    db.commit()
    print(f"moved {len(chosen)} synthetic learners ({sum(len(r['mothers']) for k, r in record.items() if int(k) in {u.id for u in chosen})} mothers) "
          f"from {source.name} into Chandrapur; {remapped} video-progress rows moved to the copied videos")


def undo_mock(db) -> None:
    row = db.get(models.MasdRuleTable, UNDO_KEY)
    project = _project(db, SLUG)
    if row is None or project is None:
        print("nothing to undo")
        return
    record = row.value_json or {}
    by_source: Dict[str, List[int]] = {}
    for uid, saved in record.items():
        u = db.get(models.User, int(uid))
        if u is None or not u.email.endswith(MOCK_DOMAIN):
            continue
        for k, v in saved["user"].items():
            setattr(u, k, v)
        f2f = db.query(models.FaceToFaceSelection).filter(models.FaceToFaceSelection.user_id == u.id).first()
        if f2f is not None and saved.get("f2f"):
            f2f.program_district_id, f2f.batch_id = saved["f2f"]["program_district_id"], saved["f2f"]["batch_id"]
        for mid, geo in saved["mothers"].items():
            m = db.get(models.Mother, int(mid))
            if m is not None:
                m.state_id, m.district_id, m.taluk_id, m.village = geo["state_id"], geo["district_id"], geo["taluk_id"], geo["village"]
        by_source.setdefault(saved["source"], []).append(u.id)
    for slug, ids in by_source.items():
        source = _project(db, slug)
        if source is not None:
            _remap_training(db, ids, _tutorial_map(db, project.id, source.id))
    db.delete(row)
    db.commit()
    print(f"put back {sum(len(v) for v in by_source.values())} synthetic learners")


NEW_PREFIX = "learner.ch."
# Jalna's programme calendar and target steps: Chandrapur's MASD settings are
# copied from Jalna by `setup`, so its new cases follow the same tranches.
CHANDRAPUR_CONF = {"training": None, "tranche2": None, "targets_like": "jalna"}


def _gp_sample(db, district_id: int, n: int = 80) -> List[str]:
    from random import Random

    names = [g for (g,) in db.query(models.GramPanchayat.name).join(models.Block)
             .filter(models.Block.district_id == district_id).order_by(models.GramPanchayat.name)]
    return Random("chandrapur-villages").sample(names, min(n, len(names))) or ["Chandrapur"]


def add_new(db, count: int) -> None:
    from datetime import date

    from scripts import seed_masd_demo as masd
    from scripts import seed_mock_learners as mock

    project = _project(db, SLUG)
    settings = db.get(models.MasdProjectSettings, project.id) if project else None
    if project is None or settings is None or settings.training_date is None:
        sys.exit("Run `setup` first (it gives Chandrapur its programme calendar).")
    have = db.query(models.User).filter(models.User.email.like(f"{NEW_PREFIX}%")).count()
    if have:
        print(f"{have} new Chandrapur learners already exist; adding up to {count} in all")
    mock.seed_learners_for_district(db, SLUG, count=count)
    _, district = _place(db)
    conf = {**CHANDRAPUR_CONF, "training": settings.training_date, "tranche2": settings.tranche2_start}
    names = (masd.NAMES["mh"][0], masd.NAMES["mh"][1], _gp_sample(db, district.id))
    stats = masd.seed_project(db, SLUG, date.today(), conf=conf, names=names, only_new=True)
    print(f"cases for the new learners: {stats}")


def remove_new(db) -> None:
    users = db.query(models.User).filter(models.User.email.like(f"{NEW_PREFIX}%"),
                                         models.User.email.like(f"%{MOCK_DOMAIN}")).all()
    ids = [u.id for u in users]
    if not ids:
        print("no new Chandrapur learners to remove")
        return
    mothers = [m for (m,) in db.query(models.Mother.id).filter(models.Mother.registered_by_user_id.in_(ids))]
    kids = [c for (c,) in db.query(models.Child.id).filter(models.Child.mother_id.in_(mothers))] if mothers else []
    for chunk in (kids[i:i + 1000] for i in range(0, len(kids), 1000)):
        db.query(models.FormResponse).filter(models.FormResponse.child_id.in_(chunk)).delete(synchronize_session=False)
    for chunk in (mothers[i:i + 1000] for i in range(0, len(mothers), 1000)):
        db.query(models.FormResponse).filter(models.FormResponse.mother_id.in_(chunk)).delete(synchronize_session=False)
        db.query(models.Child).filter(models.Child.mother_id.in_(chunk)).delete(synchronize_session=False)
        db.query(models.Mother).filter(models.Mother.id.in_(chunk)).delete(synchronize_session=False)
    for model in (models.FaceToFaceSelection, models.Notification, models.TutorialQuizResponse,
                  models.UserTutorialProgress):
        db.query(model).filter(model.user_id.in_(ids)).delete(synchronize_session=False)
    db.query(models.User).filter(models.User.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    print(f"removed {len(ids)} new Chandrapur learners, {len(mothers)} mothers, {len(kids)} children")


MONITORS_KEY = "demo.chandrapur.monitors"


def set_monitors(db) -> None:
    if db.get(models.MasdRuleTable, MONITORS_KEY) is not None:
        print("batch monitors already set — run undo-monitors first")
        return
    project = _project(db, SLUG)
    if project is None:
        sys.exit("Run `setup` first.")
    rows = (db.query(models.FaceToFaceSelection.batch_id, models.User)
            .join(models.User, models.User.id == models.FaceToFaceSelection.user_id)
            .filter(models.User.program_district_id == project.id, models.User.email.like(f"%{MOCK_DOMAIN}"),
                    models.FaceToFaceSelection.batch_id.isnot(None))
            .order_by(models.FaceToFaceSelection.batch_id, models.User.id).all())
    by_batch: Dict[int, List[models.User]] = {}
    for batch_id, user in rows:
        by_batch.setdefault(batch_id, []).append(user)
    undo = {"monitors": [], "assigned": {}}
    for batch_id, users in by_batch.items():
        free = [u for u in users if not u.is_batch_monitor and u.batch_monitor_id is None]
        if len(free) < 2:
            continue
        monitor, team = free[0], free[1:]
        monitor.is_batch_monitor = True
        undo["monitors"].append(monitor.id)
        for u in team:
            u.batch_monitor_id = monitor.id
            undo["assigned"][str(u.id)] = monitor.id
    db.add(models.MasdRuleTable(key=MONITORS_KEY, value_json=undo, updated_by="scripts.chandrapur_demo"))
    db.commit()
    print(f"{len(undo['monitors'])} batch monitors set, {len(undo['assigned'])} learners given to them")


def undo_monitors(db) -> None:
    row = db.get(models.MasdRuleTable, MONITORS_KEY)
    if row is None:
        print("no demo batch monitors to undo")
        return
    info = row.value_json or {}
    ids = [int(k) for k in (info.get("assigned") or {})]
    if ids:
        db.query(models.User).filter(models.User.id.in_(ids), models.User.email.like(f"%{MOCK_DOMAIN}")).update(
            {models.User.batch_monitor_id: None}, synchronize_session=False)
    if info.get("monitors"):
        db.query(models.User).filter(models.User.id.in_(info["monitors"]),
                                     models.User.email.like(f"%{MOCK_DOMAIN}")).update(
            {models.User.is_batch_monitor: False}, synchronize_session=False)
    db.delete(row)
    db.commit()
    print(f"undid {len(info.get('monitors') or [])} batch monitors and {len(ids)} assignments")


def status(db) -> None:
    project = _project(db, SLUG)
    if project is None:
        print("no Chandrapur project yet")
        return
    learners = db.query(models.User).filter(models.User.program_district_id == project.id).count()
    row = db.get(models.MasdRuleTable, UNDO_KEY)
    new = db.query(models.User).filter(models.User.program_district_id == project.id,
                                       models.User.email.like(f"{NEW_PREFIX}%")).count()
    print(f"Chandrapur (id {project.id}): registration {'OPEN' if project.registration_open else 'closed'}, "
          f"{learners} learners — {len(row.value_json) if row else 0} moved synthetic, {new} new synthetic")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["setup", "move-mock", "undo-mock", "add-new", "remove-new",
                                       "monitors", "undo-monitors", "status"])
    ap.add_argument("--source", default="jalna", help="project to copy content / take synthetic learners from")
    ap.add_argument("--count", type=int, default=None, help="synthetic learners to move (40) or add (260)")
    a = ap.parse_args()
    db = SessionLocal()
    try:
        if a.action == "setup":
            setup(db, a.source)
        elif a.action == "move-mock":
            move_mock(db, a.source, a.count or 40)
        elif a.action == "undo-mock":
            undo_mock(db)
        elif a.action == "add-new":
            add_new(db, a.count or 260)
        elif a.action == "remove-new":
            remove_new(db)
        elif a.action == "monitors":
            set_monitors(db)
        elif a.action == "undo-monitors":
            undo_monitors(db)
        status(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
