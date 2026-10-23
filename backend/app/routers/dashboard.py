from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app import projects
from app.database import get_db
from app.models import Stage, Tutorial, UserTutorialProgress, Test, TestAttempt, UserAchievement, Achievement
from app.schemas import DashboardData, DashboardActivity, AchievementOut
from app.dependencies import get_verified_user, require_phi_access
from app.models import User
from app.routers.tutorials import get_stages

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

@router.get("", response_model=DashboardData)
def get_dashboard_data(current_user: User = Depends(get_verified_user), db: Session = Depends(get_db)):
    # Scope all queries to the user's program district
    # Content project: a district that inherits serves its state's phases.
    district_id = projects.content_project_id_for(db, current_user.program_district_id)

    # Get stage IDs for this district
    if district_id:
        district_stage_ids = {s.id for s in db.query(Stage).filter(
            Stage.program_district_id == district_id
        ).all()}
    else:
        district_stage_ids = set()

    # Get tutorial IDs scoped to district
    if district_stage_ids:
        district_tutorial_ids = {t.id for t in db.query(Tutorial).filter(
            Tutorial.stage_id.in_(district_stage_ids)
        ).all()}
        district_test_ids = {t.id for t in db.query(Test).filter(
            Test.stage_id.in_(district_stage_ids)
        ).all()}
    else:
        district_tutorial_ids = set()
        district_test_ids = set()

    # 1. Calculate overall progress metrics (scoped to district)
    total_tutorials = len(district_tutorial_ids)
    completed_tutorials = db.query(UserTutorialProgress).filter(
        UserTutorialProgress.user_id == current_user.id,
        UserTutorialProgress.is_completed == True,
        UserTutorialProgress.tutorial_id.in_(district_tutorial_ids) if district_tutorial_ids else False
    ).count() if district_tutorial_ids else 0
    
    total_tests = len(district_test_ids)
    if district_test_ids:
        passed_tests = db.query(TestAttempt).filter(
            TestAttempt.user_id == current_user.id,
            TestAttempt.is_passed == True,
            TestAttempt.test_id.in_(district_test_ids)
        ).distinct(TestAttempt.test_id).count()
    else:
        passed_tests = 0
    
    # Combined progress percentage: 60% weight to tutorials, 40% weight to tests passed
    if total_tutorials > 0 or total_tests > 0:
        tutorial_weight = 0.6
        test_weight = 0.4
        
        t_ratio = (completed_tutorials / total_tutorials) if total_tutorials > 0 else 1.0
        test_ratio = (passed_tests / total_tests) if total_tests > 0 else 1.0
        
        progress_pct = (t_ratio * tutorial_weight + test_ratio * test_weight) * 100
    else:
        progress_pct = 0.0
        
    # 2. Get user achievements
    achievements_db = db.query(UserAchievement).join(Achievement).filter(
        UserAchievement.user_id == current_user.id
    ).all()
    
    achievements_out = [
        AchievementOut(
            id=a.achievement.id,
            title=a.achievement.title,
            description=a.achievement.description,
            emoji_icon=a.achievement.emoji_icon,
            earned_at=a.earned_at
        ) for a in achievements_db
    ]
    
    # 3. Compile activities list (scoped to district)
    activities = []
    
    # Fetch tutorial progress items for activity feed
    tutorial_progress_query = db.query(UserTutorialProgress).filter(
        UserTutorialProgress.user_id == current_user.id,
        UserTutorialProgress.is_completed == True
    )
    if district_tutorial_ids:
        tutorial_progress_query = tutorial_progress_query.filter(
            UserTutorialProgress.tutorial_id.in_(district_tutorial_ids)
        )
    tutorial_progress_list = tutorial_progress_query.order_by(
        UserTutorialProgress.completed_at.desc()
    ).limit(5).all()
    
    for tp in tutorial_progress_list:
        tutorial = db.query(Tutorial).filter(Tutorial.id == tp.tutorial_id).first()
        if tutorial:
            activities.append(
                DashboardActivity(
                    id=f"tut_{tp.id}",
                    type="tutorial",
                    title=f"Completed {tutorial.title}",
                    timestamp=tp.completed_at,
                    status="Completed"
                )
            )
            
    # Fetch test attempts for activity feed
    test_attempts_query = db.query(TestAttempt).filter(
        TestAttempt.user_id == current_user.id,
        TestAttempt.submitted_at.isnot(None)
    )
    if district_test_ids:
        test_attempts_query = test_attempts_query.filter(
            TestAttempt.test_id.in_(district_test_ids)
        )
    test_attempts_list = test_attempts_query.order_by(
        TestAttempt.submitted_at.desc()
    ).limit(5).all()
    
    for att in test_attempts_list:
        test = db.query(Test).filter(Test.id == att.test_id).first()
        if test:
            status_str = "Passed" if att.is_passed else "Failed"
            activities.append(
                DashboardActivity(
                    id=f"test_{att.id}",
                    type="test",
                    title=f"Attempted {test.title}",
                    timestamp=att.submitted_at,
                    status=f"{status_str} ({att.score:.0f}%)"
                )
            )
            
    # Sort activities by timestamp descending
    activities.sort(key=lambda x: x.timestamp, reverse=True)
    activities = activities[:5] # Limit to 5 total recent activities
    
    # 4. Get stages and tutorials using our existing endpoint logic (already district-filtered)
    stages_out = get_stages(current_user=current_user, db=db)

    # 5. Where the learner is in the selection pipeline, and so which view
    # the dashboard opens on: training until she is selected for
    # face-to-face training, adoptions from then on.
    from app.flow import selection_state

    state = selection_state(db, current_user)
    selected = state == "selected"
    
    return DashboardData(
        progress_percentage=progress_pct,
        tutorials_completed=completed_tutorials,
        total_tutorials=total_tutorials,
        tests_passed=passed_tests,
        total_tests=total_tests,
        awaiting_results=state == "awaiting",
        selected_for_f2f=selected,
        adoptions_open=selected,
        selection_state=state,
        achievements=achievements_out,
        activities=activities,
        stages=stages_out
    )


# ── My work (review of 17 Oct 2026) ───────────────────────────────────────
#
# Sir: "for the user it must be as easy as possible, and it must be easy for
# them to track their own activities and adoptions — clues must be there to
# indicate what percentage of work is done, or what is expected of them in
# the next few days." The learner's own numbers from the MASD rules, the same
# ones the supervisors' dashboard shows for them: never anyone else's.

def _masd_project(db: Session, user: User):
    """The project whose MASD calendar and targets apply to this learner: their
    own, or — for a district inside a state that holds the settings — the state."""
    from app.models import MasdProjectSettings, ProgramDistrict

    if not user.program_district_id:
        return None
    project = db.get(ProgramDistrict, user.program_district_id)
    if project is None:
        return None
    if db.get(MasdProjectSettings, project.id) is None and project.parent_id:
        parent = db.get(ProgramDistrict, project.parent_id)
        if parent is not None and db.get(MasdProjectSettings, parent.id) is not None:
            return parent
    return project


@router.get("/my-work", dependencies=[Depends(require_phi_access)])
def my_work(due_days: int = 7, current_user: User = Depends(get_verified_user), db: Session = Depends(get_db)):
    from datetime import date
    from app.masd import data as D, engine as E
    from app.models import Child, Mother
    from app.security import phi

    due_days = max(1, min(int(due_days), 30))
    project = _masd_project(db, current_user)
    if project is None:
        return {"available": False, "reason": "no_project"}
    data = D.load(db, project, only_learners=[current_user.id], with_growth=False)
    view = E.learner_view(data, date.today(), current_user.id, due_days=due_days)
    if view is None:
        return {"available": False, "reason": "not_in_project"}

    # Name the learner's own mothers and babies on her own list — she
    # registered them. Recorded like any other listing of patient records.
    mother_ids = [c["mother_id"] for c in view["cases"]]
    names = {mid: (name, uid) for mid, name, uid in db.query(Mother.id, Mother.mother_name, Mother.mother_uid)
             .filter(Mother.id.in_(mother_ids), Mother.registered_by_user_id == current_user.id)} if mother_ids else {}
    kids = {}
    for cid, mid, cname in (db.query(Child.id, Child.mother_id, Child.child_name)
                            .filter(Child.mother_id.in_(list(names))) if names else []):
        kids.setdefault(mid, []).append({"id": cid, "name": cname})
    # A baby whose latest measurement is moderately or severely low is
    # flagged so the dashboard can make it stand out ("blink, like a flash" —
    # review of 17 Oct 2026). Real z-scores only; never the demo layer.
    from app.routers.growth import Z_CATEGORY_NAMES, _build_cases, _rules_context, _summary_rows

    alerts = {}
    gcases = _build_cases(db, user_id=current_user.id)
    for row in _summary_rows(gcases, _rules_context(db, gcases), allow_mock=False):
        found = []
        for metric, labels in Z_CATEGORY_NAMES.items():
            latest = (row.get("categories") or {}).get(metric, {}).get("lv")
            if latest in (labels[2], labels[3]):
                found.append({"metric": metric, "label": latest, "severe": latest == labels[3]})
        if found:
            alerts[row["case_id"]] = found

    cases = []
    for c in view["cases"]:
        if c["mother_id"] not in names:
            continue
        name, uid = names[c["mother_id"]]
        children = [{**k, "alerts": alerts.get(k["id"], [])} for k in kids.get(c["mother_id"], [])]
        severe = any(a["severe"] for k in children for a in k["alerts"])
        growth_alert = any(k["alerts"] for k in children)
        cases.append({**c, "mother_name": name, "mother_uid": uid, "children": children,
                      "severe": severe, "growth_alert": growth_alert,
                      # Faltering: anything a supervisor would call about.
                      "faltering": bool(severe or growth_alert or c["warnings"] or c["behind_total"])})
    cases.sort(key=lambda c: (not c["severe"], not c["growth_alert"], -len(c["warnings"]),
                              -c["behind_total"], -c["upcoming_total"]))
    view["faltering_total"] = sum(1 for c in cases if c["faltering"])
    view["cases"] = cases
    if cases:
        phi.log_list(
            resource_type="mother", count=len(cases), subject_type=phi.MOTHER,
            subject_ids=[c["mother_id"] for c in cases],
            detail={"scope": "own_cases", "view": "my_work", "fields": ["mother_name", "mother_uid", "child_name"]},
        )
    return {"available": True, "project": {"name": project.name, "slug": project.slug}, **view}


@router.get("/today", dependencies=[Depends(require_phi_access)])
def today(current_user: User = Depends(get_verified_user), db: Session = Depends(get_db)):
    """The health worker's home: what to do today, this week, what to finish,
    and her mothers and babies with a status in words (launch review of 19
    Oct 2026). Only her own cases — see app/fieldplan.py."""
    from app.fieldplan import today_view
    from app.security import phi

    view = today_view(db, current_user)
    ids = [c["mother_id"] for c in view["cases"]]
    if ids:
        phi.log_list(
            resource_type="mother", count=len(ids), subject_type=phi.MOTHER, subject_ids=ids,
            detail={"scope": "own_cases", "view": "today",
                    "fields": ["mother_name", "mother_uid", "child_name", "child_uid", "weight", "length"]},
        )
    return view


@router.get("/my-team")
def my_team(current_user: User = Depends(get_verified_user), db: Session = Depends(get_db)):
    """A batch monitor's learners and how each is doing (review of 6 Oct and
    17 Oct 2026). Only the learners given to this monitor; counts only."""
    from datetime import date
    from app.masd import data as D, engine as E

    if not current_user.is_batch_monitor:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only batch monitors have a team.")
    ids = [uid for (uid,) in db.query(User.id).filter(User.batch_monitor_id == current_user.id)]
    project = _masd_project(db, current_user)
    if not ids or project is None:
        return {"learners": []}
    data = D.load(db, project, only_learners=ids, with_growth=False)
    today_d = date.today()
    rows = E.team_view(data, today_d, ids)
    # Who needs hand-holding now (launch review of 19 Oct 2026: "when monitors
    # log in they should get all the information — who are the learners who
    # need hand-holding right away"): visits late or due today, and babies to
    # be seen within 2 days. Counts only — the monitor calls the learner.
    from app.fieldplan import baby_status
    from app.routers.growth import _build_cases

    urgent = defaultdict(int)
    for case in _build_cases(db, learner_ids=ids):
        if baby_status(case).get("see_within_days"):
            urgent[case["learner"]["id"]] += 1
    # The monitor's job here is to ring the learner ("kindly give a call"), so
    # the learner's own number comes with the row — her colleague's, not a
    # mother's: no patient identifier is in this view.
    phones = {uid: phone for uid, phone in db.query(User.id, User.phone).filter(User.id.in_(ids))}
    for r in rows:
        r["phone"] = phones.get(r["id"])
        plan = E.field_plan(data, today_d, r["id"], 0)
        r["late_visits"] = sum(1 for items in plan.values() if any(i["late_days"] > 0 for i in items))
        r["due_today"] = sum(1 for items in plan.values() if items)
        r["urgent_babies"] = urgent.get(r["id"], 0)
        r["needs_call"] = bool(r["urgent_babies"] or r["late_visits"] or (r["nil_days"] or 0) > 7)
    rows.sort(key=lambda r: (not r["needs_call"], -r["urgent_babies"], -r["late_visits"],
                             r["forms_pct"] if r["forms_pct"] is not None else -1, r["name"] or ""))
    return {"learners": rows}
