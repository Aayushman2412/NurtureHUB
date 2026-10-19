"""Four learner accounts for showing the learner's side (reviews of 18 and
19 Oct 2026) — one at each step of the selection pipeline.

  1  in_progress   a Chandrapur learner part-way through the videos.
  2  awaiting      a Jalna learner who finished every video and test; Jalna
                   has not announced its selection, so she waits for it.
  3  selected      a Chandrapur learner selected for face-to-face training and
                   about halfway through her adoptions. Selection means the
                   whole training is behind her, so any video, quiz or test the
                   synthetic data left open is completed (tests passed).
  4  not_selected  a Chandrapur learner who finished the videos and is given
                   test attempts below the pass mark; Chandrapur's selection is
                   marked announced, so she is told she was not selected.

    python -m scripts.demo_accounts pick       # who would be used (changes nothing)
    python -m scripts.demo_accounts prepare    # asks for a password, sets it on all four
    python -m scripts.demo_accounts undo       # puts everything back

Run `prepare` WITHOUT `docker compose exec -T` so the password is not shown.
`prepare` also gives the two projects' test questions a topic where they have
none (by keywords in the question), so the topic-wise scores have something to
show. Everything it adds or changes is recorded in masd_rule_tables
"demo.accounts" and `undo` reverses exactly that (it also undoes the earlier
two-account version). Only @nurturehub.mock learners are ever touched.
"""
from __future__ import annotations

import argparse
import getpass
import re
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func

from app import models, projects
from app.auth import get_password_hash
from app.database import SessionLocal
from app.flow import is_awaiting_results, selection_state

MOCK_DOMAIN = "@nurturehub.mock"
UNDO_KEY = "demo.accounts"
TRAINING_PROJECT = "jalna"        # results not announced: accounts 2
ADOPTION_PROJECT = "chandrapur"   # results announced: accounts 1, 3, 4

# First rule that matches wins, so "complementary feeding … continued
# breastfeeding" is complementary feeding.
TOPIC_RULES = [
    ("Complementary feeding", ["complementary", "solid food", "semi-solid", "weaning"]),
    ("Breastfeeding", ["breastfeed", "breast milk", "breastmilk", "colostrum", "latch"]),
    ("Malnutrition (SAM / MAM)", ["muac", "sam", "mam", "severe acute", "malnutrition", "oedema"]),
    ("Growth monitoring", ["growth", "weigh", "stunting", "wasting", "underweight", "height-for-age", "z-score"]),
    ("Micro-nutrients", ["vitamin", "iron", "ifa", "folic", "zinc", "micronutrient", "supplement"]),
    ("Immunization", ["vaccin", "immuni", "cold chain", "bcg", "polio", "measles"]),
    ("Antenatal care", ["antenatal", "anc", "pregnan", "birth prepared", "delivery"]),
    ("Child development", ["milestone", "development", "stimulation", "play"]),
    ("Counselling", ["counsel", "home visit"]),
]

LABELS = {
    "in_progress": "1 — part-way through the training (Adoptions locked)",
    "awaiting": "2 — finished, waiting for the selection result (Adoptions locked)",
    "selected": "3 — selected for F2F, halfway through adoptions (opens on Adoptions)",
    "not_selected": "4 — finished, results announced, not selected (Adoptions locked)",
}


def topic_for(text: str) -> str:
    low = (text or "").lower()
    for topic, words in TOPIC_RULES:
        if any(re.search(r"\b" + re.escape(w), low) for w in words):
            return topic
    return "General"


def _project(db, slug: str) -> models.ProgramDistrict:
    p = db.query(models.ProgramDistrict).filter(models.ProgramDistrict.slug == slug).first()
    if p is None:
        sys.exit(f"No project '{slug}'.")
    return p


def _content(db, user: models.User):
    """The phases' tutorials and tests the learner is trained on."""
    cid = projects.content_project_id_for(db, user.program_district_id)
    stage_ids = [s.id for s in db.query(models.Stage.id).filter(models.Stage.program_district_id == cid)]
    tutorials = db.query(models.Tutorial).filter(models.Tutorial.stage_id.in_(stage_ids)).all() if stage_ids else []
    tests = db.query(models.Test).filter(models.Test.stage_id.in_(stage_ids)).all() if stage_ids else []
    return tutorials, tests


def _mock_learners(db, slug: str):
    p = _project(db, slug)
    return (db.query(models.User).filter(models.User.program_district_id == p.id,
                                         models.User.email.like(f"%{MOCK_DOMAIN}"),
                                         models.User.phone.isnot(None))
            .order_by(models.User.id).all())


def _outside(db) -> tuple[set, set]:
    f2f = {uid for (uid,) in db.query(models.FaceToFaceSelection.user_id)}
    adopting = {uid for (uid,) in db.query(models.Mother.registered_by_user_id).distinct()}
    return f2f, adopting


def _videos_done(db, user, tutorials) -> int:
    ids = [t.id for t in tutorials]
    return db.query(models.UserTutorialProgress).filter(
        models.UserTutorialProgress.user_id == user.id, models.UserTutorialProgress.is_completed.is_(True),
        models.UserTutorialProgress.tutorial_id.in_(ids)).count() if ids else 0


def _tests_taken(db, user, tests) -> int:
    ids = [t.id for t in tests]
    return db.query(models.TestAttempt.test_id).filter(
        models.TestAttempt.user_id == user.id, models.TestAttempt.submitted_at.isnot(None),
        models.TestAttempt.test_id.in_(ids)).distinct().count() if ids else 0


def pick_in_progress(db) -> Optional[models.User]:
    """Part-way through the videos, no test taken: about two-thirds done."""
    f2f, adopting = _outside(db)
    best = None
    for u in _mock_learners(db, ADOPTION_PROJECT):
        if u.id in f2f or u.id in adopting:
            continue
        tutorials, tests = _content(db, u)
        done = _videos_done(db, u, tutorials)
        if 0 < done < len(tutorials) and _tests_taken(db, u, tests) == 0:
            score = abs(done / len(tutorials) - 2 / 3)
            if best is None or score < best[0]:
                best = (score, u)
    return best[1] if best else None


def pick_awaiting(db) -> Optional[models.User]:
    f2f, adopting = _outside(db)
    for u in _mock_learners(db, TRAINING_PROJECT):
        if u.id not in f2f and u.id not in adopting and is_awaiting_results(db, u):
            return u
    return None


def pick_selected(db) -> Optional[tuple]:
    """The F2F learner whose adoptions and forms are both nearest 60 % done."""
    from app.masd import data as D, engine as E
    from app.routers.dashboard import _masd_project

    p = _project(db, ADOPTION_PROJECT)
    ids = [uid for (uid,) in db.query(models.User.id)
           .join(models.FaceToFaceSelection, models.FaceToFaceSelection.user_id == models.User.id)
           .filter(models.User.program_district_id == p.id, models.User.email.like(f"%{MOCK_DOMAIN}"),
                   models.User.phone.isnot(None))]
    if not ids:
        return None
    project = _masd_project(db, db.get(models.User, ids[0]))
    data = D.load(db, project, only_learners=ids, with_growth=False)
    rows = [r for r in E.team_view(data, date.today(), ids)
            if r["adoptions"] and r["fulfilment_pct"] is not None and r["forms_pct"] is not None]
    if not rows:
        return None
    best = min(rows, key=lambda r: abs(r["fulfilment_pct"] - 60) + abs(r["forms_pct"] - 60))
    return db.get(models.User, best["id"]), best


def pick_not_selected(db, avoid: set) -> Optional[models.User]:
    """Finished every video, no test taken yet (the tests are given below)."""
    f2f, adopting = _outside(db)
    for u in _mock_learners(db, ADOPTION_PROJECT):
        if u.id in f2f or u.id in adopting or u.id in avoid:
            continue
        tutorials, tests = _content(db, u)
        if tutorials and _videos_done(db, u, tutorials) == len(tutorials) and _tests_taken(db, u, tests) == 0:
            return u
    return None


def picks(db) -> Dict[str, Any]:
    out: Dict[str, Any] = {"in_progress": pick_in_progress(db), "awaiting": pick_awaiting(db)}
    sel = pick_selected(db)
    out["selected"] = sel[0] if sel else None
    out["_selected_row"] = sel[1] if sel else None
    out["not_selected"] = pick_not_selected(db, {u.id for u in out.values() if isinstance(u, models.User)})
    return out


def show(db) -> Dict[str, Any]:
    chosen = picks(db)
    for key in ("in_progress", "awaiting", "selected", "not_selected"):
        u = chosen[key]
        print(LABELS[key])
        if u is None:
            print("   none found")
            continue
        project = db.get(models.ProgramDistrict, u.program_district_id)
        extra = ""
        if key == "selected" and chosen["_selected_row"]:
            r = chosen["_selected_row"]
            extra = (f" · adoptions {r['adoptions']}/{r['target']} ({r['fulfilment_pct']}%)"
                     f" · forms {r['forms_done']}/{r['forms_due']} ({r['forms_pct']}%)")
        print(f"   {u.full_name} · {project.slug if project else '—'} · mobile {u.phone}{extra}")
    return chosen


# ── changes, each recorded for undo ────────────────────────────────────────

def _set_topics(db, slugs: List[str]) -> List[int]:
    changed: List[int] = []
    for slug in slugs:
        cid = projects.content_project_id_for(db, _project(db, slug).id)
        stage_ids = [s.id for s in db.query(models.Stage.id).filter(models.Stage.program_district_id == cid)]
        test_ids = [t.id for t in db.query(models.Test.id).filter(models.Test.stage_id.in_(stage_ids))] if stage_ids else []
        for q in (db.query(models.Question).filter(models.Question.test_id.in_(test_ids),
                                                   models.Question.topic.is_(None)) if test_ids else []):
            q.topic = topic_for(q.text)
            changed.append(q.id)
    return changed


_PROGRESS_FIELDS = ("is_completed", "completed_at", "watch_time_seconds", "watch_pct", "last_position_seconds",
                    "quiz_status", "quiz_score", "quiz_total")


def _iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


def _finish_videos(db, user: models.User, undo: Dict[str, Any], when: datetime) -> None:
    tutorials, _tests = _content(db, user)
    quiz_counts = dict(db.query(models.TutorialQuestion.tutorial_id, func.count(models.TutorialQuestion.id))
                       .filter(models.TutorialQuestion.tutorial_id.in_([t.id for t in tutorials]))
                       .group_by(models.TutorialQuestion.tutorial_id).all()) if tutorials else {}
    for t in tutorials:
        p = db.query(models.UserTutorialProgress).filter_by(user_id=user.id, tutorial_id=t.id).first()
        if p is None:
            p = models.UserTutorialProgress(user_id=user.id, tutorial_id=t.id)
            db.add(p)
            db.flush()
            undo["progress_created"].append(p.id)
        elif (p.is_completed and (p.watch_pct or 0) >= 100
              and (p.quiz_status == "completed" or not quiz_counts.get(t.id))):
            continue
        else:
            undo["progress_changed"][str(p.id)] = {f: _iso(getattr(p, f)) for f in _PROGRESS_FIELDS}
        seconds = float(max(1, t.duration_minutes or 1) * 60)
        p.is_completed = True
        p.completed_at = p.completed_at or when
        p.watch_time_seconds = max(p.watch_time_seconds or 0, seconds)
        p.watch_pct = 100.0
        p.last_position_seconds = seconds
        n = quiz_counts.get(t.id, 0)
        if n and p.quiz_status != "completed":      # pending or skipped
            p.quiz_status, p.quiz_score, p.quiz_total = "completed", float(n), n


def _take_tests(db, user: models.User, undo: Dict[str, Any], passing: bool, when: datetime) -> None:
    """A submitted attempt for every test she has not taken. Passing: every
    answer right but the last of a long test (80 %+). Not passing: every
    other answer right (about half), so some topics are strong and some weak."""
    _tutorials, tests = _content(db, user)
    for i, test in enumerate(sorted(tests, key=lambda x: x.id)):
        if db.query(models.TestAttempt.id).filter(models.TestAttempt.user_id == user.id,
                                                  models.TestAttempt.test_id == test.id,
                                                  models.TestAttempt.submitted_at.isnot(None)).first():
            continue
        questions = db.query(models.Question).filter(models.Question.test_id == test.id).order_by(
            models.Question.order_index, models.Question.id).all()
        if not questions:
            continue
        right = [(j < len(questions) - 1 or len(questions) < 5) if passing else j % 2 == 0
                 for j in range(len(questions))]
        submitted = when + timedelta(days=5 * i)
        attempt = models.TestAttempt(user_id=user.id, test_id=test.id, attempt_number=1,
                                     started_at=submitted - timedelta(minutes=11), submitted_at=submitted,
                                     time_used_seconds=11 * 60)
        db.add(attempt)
        db.flush()
        undo["attempts_created"].append(attempt.id)
        marks = got = 0
        for q, ok in zip(questions, right):
            options = list(q.options)
            correct = next((o for o in options if o.is_correct), None)
            wrong = next((o for o in options if not o.is_correct), None)
            pick = correct if ok else (wrong or correct)
            db.add(models.TestAnswer(attempt_id=attempt.id, question_id=q.id,
                                     selected_option_id=pick.id if pick else None,
                                     is_correct=bool(ok and correct is not None)))
            marks += q.marks or 1
            got += (q.marks or 1) if (ok and correct is not None) else 0
        attempt.total_marks = float(marks)
        attempt.score = round(100.0 * got / marks, 1) if marks else 0.0
        attempt.is_passed = attempt.score >= float(test.passing_score_pct or 0)


def _announce(db, undo: Dict[str, Any], slug: str, announced: bool) -> None:
    p = _project(db, slug)
    undo["announced"][str(p.id)] = _iso(p.selection_announced_at)
    p.selection_announced_at = datetime.now(timezone.utc) if announced else None


def prepare(db) -> None:
    if db.get(models.MasdRuleTable, UNDO_KEY) is not None:
        sys.exit("Already prepared — run `undo` first, then `prepare` again.")
    chosen = show(db)
    users = [chosen[k] for k in ("in_progress", "awaiting", "selected", "not_selected") if chosen[k] is not None]
    if not users:
        sys.exit("No accounts to prepare.")
    if any(not u.email.endswith(MOCK_DOMAIN) for u in users):
        sys.exit("Refusing: only synthetic (@nurturehub.mock) learners are used.")
    pw = getpass.getpass("Password for the demo accounts (not shown): ")
    if len(pw) < 8 or pw != getpass.getpass("Again: "):
        sys.exit("Passwords did not match (or under 8 characters); nothing changed.")

    undo: Dict[str, Any] = {"users": {str(u.id): u.password_hash for u in users}, "progress_created": [],
                            "progress_changed": {}, "attempts_created": [], "notifications_created": [],
                            "announced": {}}
    hashed = get_password_hash(pw)
    for u in users:
        u.password_hash = hashed
    undo["questions"] = _set_topics(db, [TRAINING_PROJECT, ADOPTION_PROJECT])
    long_ago = datetime.now(timezone.utc) - timedelta(days=130)
    # Everyone past the end of the pipeline has done ALL of it: every video
    # watched through, every quiz answered, every test taken.
    for key in ("awaiting", "selected", "not_selected"):
        if chosen[key] is not None:
            _finish_videos(db, chosen[key], undo, long_ago)
    if chosen["selected"] is not None:          # selected ⇒ tests passed
        _take_tests(db, chosen["selected"], undo, passing=True, when=long_ago)
    if chosen["not_selected"] is not None:      # finished, below the pass mark
        _take_tests(db, chosen["not_selected"], undo, passing=False, when=long_ago)
        note = models.Notification(
            user_id=chosen["not_selected"].id, title="Selection result",
            message=("Thank you for completing the training and the tests. You were not selected for the "
                     "face-to-face training this time. The videos stay open for you to revise."),
            link="/dashboard")
        db.add(note)
        db.flush()
        undo["notifications_created"].append(note.id)
    _announce(db, undo, TRAINING_PROJECT, announced=False)
    _announce(db, undo, ADOPTION_PROJECT, announced=True)
    db.add(models.MasdRuleTable(key=UNDO_KEY, value_json=undo, updated_by="scripts.demo_accounts"))
    db.commit()

    print("\nWhat each one now shows:")
    for key in ("in_progress", "awaiting", "selected", "not_selected"):
        u = chosen[key]
        if u is not None:
            db.refresh(u)
            print(f"   {u.full_name:22} mobile {u.phone}  →  {selection_state(db, u)}")
    print(f"Password set on {len(users)} account(s); topics given to {len(undo['questions'])} question(s). "
          "Sign in on the learner page with a mobile number and that password.")


def undo(db) -> None:
    row = db.get(models.MasdRuleTable, UNDO_KEY)
    if row is None:
        print("Nothing to undo.")
        return
    info = row.value_json or {}
    if info.get("attempts_created"):
        db.query(models.TestAttempt).filter(models.TestAttempt.id.in_(info["attempts_created"])).delete(
            synchronize_session=False)
    if info.get("notifications_created"):
        db.query(models.Notification).filter(models.Notification.id.in_(info["notifications_created"])).delete(
            synchronize_session=False)
    if info.get("progress_created"):
        db.query(models.UserTutorialProgress).filter(
            models.UserTutorialProgress.id.in_(info["progress_created"])).delete(synchronize_session=False)
    for pid, before in (info.get("progress_changed") or {}).items():
        p = db.get(models.UserTutorialProgress, int(pid))
        if p is None:
            continue
        for field, value in before.items():
            if field == "completed_at" and value:
                value = datetime.fromisoformat(value)
            setattr(p, field, value)
    for pid, before in (info.get("announced") or {}).items():
        p = db.get(models.ProgramDistrict, int(pid))
        if p is not None:
            p.selection_announced_at = datetime.fromisoformat(before) if before else None
    for uid, old in (info.get("users") or {}).items():
        u = db.get(models.User, int(uid))
        if u is not None and u.email.endswith(MOCK_DOMAIN):
            u.password_hash = old
    qids = info.get("questions") or []
    if qids:
        db.query(models.Question).filter(models.Question.id.in_(qids)).update(
            {models.Question.topic: None}, synchronize_session=False)
    db.delete(row)
    db.commit()
    print(f"Restored {len(info.get('users') or {})} password(s), removed {len(info.get('attempts_created') or [])} "
          f"test attempt(s), put back {len(info.get('progress_created') or []) + len(info.get('progress_changed') or {})} "
          f"video record(s) and {len(info.get('announced') or {})} announcement flag(s); cleared {len(qids)} topic(s).")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["pick", "prepare", "undo"])
    a = ap.parse_args()
    db = SessionLocal()
    try:
        if a.action == "pick":
            show(db)
        elif a.action == "prepare":
            prepare(db)
        else:
            undo(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
