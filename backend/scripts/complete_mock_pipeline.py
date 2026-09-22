"""
Take every mock learner of a project through the whole learner pipeline, the
way the app does it, so the admin Results page shows the finished picture:

  1. VIDEOS — any video a learner has not finished is watched to the end, with
     the same watch heartbeats the video player sends; post-video quizzes that
     are still pending are answered.
  2. TESTS — the formative test, then the screening test (in phase order),
     started and submitted through the real test endpoints. So the site's own
     rules decide who may start (videos before tests, attempt limits) and its
     own scoring marks the papers. Abilities differ: some candidates fail and
     retake, some fail outright.
  3. SELECTION — everyone who passed the screening test is selected for
     face-to-face training through the same upload the admin uses. The demo
     selections made before anyone had taken a test are cleared first.

Each test is opened (admin "Start") for the run and closed (admin "End") after.

Re-running is safe: finished videos, and tests a learner has already written,
are skipped.

Only learners with @nurturehub.mock addresses are touched. The admin actions
are recorded under the principal "pipeline-script@nurturehub.mock", never a
real admin's name.

Usage (on the server):
  docker compose exec backend python -m scripts.complete_mock_pipeline --projects jalna,ujjain,khasi --api http://localhost:8000
"""
from __future__ import annotations

import argparse
import http.client
import json
import random
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from sqlalchemy import func

from app import projects
from app.database import SessionLocal
from app.models import (
    Notification, ProgramDistrict, Question, Stage, Test, TestAttempt, Tutorial,
    TutorialQuestion, User, UserTutorialProgress,
)
from app.security import sessions

MOCK_SUFFIX = "@nurturehub.mock"
SCRIPT_PRINCIPAL = "pipeline-script@nurturehub.mock"
F2F_TITLE = "Selected for Face-to-Face Training"
BEAT_SECONDS = 30          # the server credits at most 30s per heartbeat


# ─────────────────────────────────────────────────────────────────────────────
# HTTP (stdlib)
# ─────────────────────────────────────────────────────────────────────────────

class ApiError(Exception):
    pass


_local = threading.local()


def _connection(api: str) -> http.client.HTTPConnection:
    """One kept-alive connection per worker thread. Tens of thousands of watch
    heartbeats on a fresh connection each would run the machine out of local
    ports (every closed connection lingers in TIME_WAIT for a minute)."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        u = urlsplit(api)
        cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
        conn = cls(u.hostname, u.port, timeout=120)
        _local.conn = conn
    return conn


def call(api: str, method: str, path: str, token: str, body: Optional[dict] = None):
    payload = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    full_path = urlsplit(api).path.rstrip("/") + path
    for attempt in range(4):
        conn = _connection(api)
        try:
            conn.request(method, full_path, body=payload, headers=headers)
            resp = conn.getresponse()
            raw = resp.read().decode()
        except (http.client.HTTPException, OSError) as e:
            # Typically the server closed an idle kept-alive connection: reconnect.
            conn.close()
            _local.conn = None
            if attempt < 3:
                time.sleep(0.5 + attempt)
                continue
            raise ApiError(f"{method} {path} -> {e}")
        if resp.status in (429, 502, 503, 504) and attempt < 3:
            time.sleep(1 + attempt * 2)
            continue
        if resp.status >= 400:
            raise ApiError(f"{method} {path} -> {resp.status}: {raw[:200]}")
        return json.loads(raw) if raw else {}


# ─────────────────────────────────────────────────────────────────────────────
# One learner
# ─────────────────────────────────────────────────────────────────────────────

class Learner:
    def __init__(self, user: User, token: str, ability: float):
        self.user_id = user.id
        self.email = user.email
        self.token = token
        self.ability = ability
        self.videos_watched = 0
        self.quizzes = 0
        self.tests: Dict[int, List[Tuple[float, bool]]] = {}   # test_id -> [(score, passed)]
        self.skipped_tests: List[int] = []
        self.error = ""


def _video_seconds(t: dict) -> float:
    start, end = t.get("start_seconds") or 0, t.get("end_seconds") or 0
    if end > start:
        return float(end - start)
    return float((t.get("duration_minutes") or 5) * 60)


def _watch(api: str, L: Learner, t: dict, rng: random.Random) -> None:
    duration = _video_seconds(t)
    target = rng.uniform(96.0, 100.0)
    position = float(t.get("last_position_seconds") or 0)
    pct = float(t.get("watch_pct") or 0)
    for _ in range(int(duration / BEAT_SECONDS) + 12):
        position = min(duration, position + BEAT_SECONDS)
        r = call(api, "POST", f"/api/tutorials/{t['id']}/progress", L.token, {
            "position_seconds": position,
            "watched_delta_seconds": BEAT_SECONDS,
            "duration_seconds": duration,
        })
        pct = r.get("watch_pct", pct)
        if r.get("is_completed") and pct >= target:
            break
    L.videos_watched += 1


def _quiz(api: str, L: Learner, t: dict, correct: Dict[int, int], rng: random.Random) -> None:
    quiz = call(api, "GET", f"/api/tutorials/{t['id']}/quiz", L.token)
    if not quiz.get("quiz_available") or not quiz.get("questions"):
        return
    answers = []
    for q in quiz["questions"]:
        opts = [o["id"] for o in q["options"]]
        right = correct.get(q["id"])
        pick = right if (right and rng.random() < L.ability + 0.08) else rng.choice(
            [o for o in opts if o != right] or opts)
        answers.append({"question_id": q["id"], "selected_option_id": pick})
    call(api, "POST", f"/api/tutorials/{t['id']}/quiz/submit", L.token, {"answers": answers})
    L.quizzes += 1


def _write_test(api: str, L: Learner, test: dict, correct: Dict[int, int],
                rng: random.Random, retake_chances: List[float], ability_shift: float) -> None:
    ability = max(0.2, min(0.98, L.ability + ability_shift))
    results = []
    for attempt in range(test["max_attempts"]):
        if attempt > 0 and rng.random() >= retake_chances[min(attempt - 1, len(retake_chances) - 1)]:
            break
        paper = call(api, "POST", f"/api/tests/{test['id']}/start", L.token)
        answers = []
        for q in paper["questions"]:
            opts = [o["id"] for o in q["options"]]
            right = correct.get(q["id"])
            pick = right if (right and rng.random() < ability) else rng.choice(
                [o for o in opts if o != right] or opts)
            answers.append({"question_id": q["id"], "selected_option_id": pick,
                            "is_marked_for_review": False})
        seconds = test["duration_minutes"] * 60
        result = call(api, "POST", f"/api/tests/attempts/{paper['attempt_id']}/submit", L.token, {
            "answers": answers,
            "time_used_seconds": rng.randint(int(seconds * 0.35), int(seconds * 0.9)),
        })
        results.append((result["score"], bool(result["is_passed"])))
        if result["is_passed"]:
            break
        ability = min(0.98, ability + 0.1)     # revised before trying again
    L.tests[test["id"]] = results


def run_learner(api: str, L: Learner, tests: Dict[int, dict],
                correct: Tuple[Dict[int, int], Dict[int, int]], seed: int) -> Learner:
    papers, quizzes = correct
    rng = random.Random(seed * 1_000_003 + L.user_id)
    try:
        for stage in sorted(call(api, "GET", "/api/stages", L.token), key=lambda s: s["order_index"]):
            if stage["stage_type"] == "tutorials":
                for t in sorted(stage["tutorials"], key=lambda t: t["order_index"]):
                    if not t["is_completed"]:
                        _watch(api, L, t, rng)
                    if t.get("quiz_available") and t.get("quiz_status") == "pending":
                        _quiz(api, L, t, quizzes, rng)
            elif stage.get("test") and stage["test"]["id"] in tests:
                info = stage["test"]
                test = tests[info["id"]]
                if info["is_submitted"]:
                    L.skipped_tests.append(test["id"])
                    continue
                if test["test_type"] == "screening":
                    _write_test(api, L, test, papers, rng, [0.5, 0.3], -0.15)
                else:
                    _write_test(api, L, test, papers, rng, [0.7, 0.5], 0.0)
    except ApiError as e:
        L.error = str(e)
    return L


# ─────────────────────────────────────────────────────────────────────────────
# One project
# ─────────────────────────────────────────────────────────────────────────────

def _project_tests(db, pd: ProgramDistrict) -> List[Test]:
    """The project's real tests: those in dedicated test phases, in phase order."""
    content_id = projects.content_project_id(pd)
    return (
        db.query(Test).join(Stage, Test.stage_id == Stage.id)
        .filter(Stage.program_district_id == content_id, Stage.stage_type == "test")
        .order_by(Stage.order_index, Test.id).all()
    )


def _correct_options(db, test_ids: List[int], content_id: int) -> Tuple[Dict[int, int], Dict[int, int]]:
    """(test question id -> correct option id, video-quiz question id -> correct
    option id). Two maps: the two kinds of question are numbered independently,
    so in one map a quiz question would overwrite a test question's answer."""
    papers: Dict[int, int] = {}
    for q in db.query(Question).filter(Question.test_id.in_(test_ids)).all():
        right = next((o for o in q.options if o.is_correct), None)
        if right:
            papers[q.id] = right.id
    quizzes: Dict[int, int] = {}
    stage_ids = [s.id for s in db.query(Stage).filter(Stage.program_district_id == content_id)]
    tut_ids = [t.id for t in db.query(Tutorial).filter(Tutorial.stage_id.in_(stage_ids))]
    for q in db.query(TutorialQuestion).filter(TutorialQuestion.tutorial_id.in_(tut_ids)).all():
        right = next((o for o in q.options if o.is_correct), None)
        if right:
            quizzes[q.id] = right.id
    return papers, quizzes


def run_project(slug: str, api: str, workers: int, seed: int) -> bool:
    db = SessionLocal()
    try:
        pd = db.query(ProgramDistrict).filter(ProgramDistrict.slug == slug).first()
        if not pd:
            print(f"\n[{slug}] no such project - skipped.")
            return False
        content_id = projects.content_project_id(pd)
        name = pd.name
        tests = _project_tests(db, pd)
        if not tests:
            print(f"\n[{slug}] has no tests in a test phase - skipped.")
            return False
        users = (db.query(User).filter(User.program_district_id == pd.id,
                                       User.email.like(f"%{MOCK_SUFFIX}"),
                                       User.is_admin == False)  # noqa: E712
                 .order_by(User.id).all())
        if not users:
            print(f"\n[{slug}] has no mock learners - skipped.")
            return False
        test_info = {t.id: {"id": t.id, "title": t.title, "test_type": t.test_type,
                            "max_attempts": t.max_attempts or 1,
                            "duration_minutes": t.duration_minutes or 15}
                     for t in tests}
        correct = _correct_options(db, [t.id for t in tests], content_id)

        # Learners who had already finished every video were the seed's top
        # performers; they carry that into the tests.
        stage_ids = [s.id for s in db.query(Stage).filter(Stage.program_district_id == content_id)]
        n_videos = db.query(Tutorial).filter(Tutorial.stage_id.in_(stage_ids)).count()
        done_before = {uid for (uid, n) in db.query(UserTutorialProgress.user_id, func.count())
                       .filter(UserTutorialProgress.user_id.in_([u.id for u in users]),
                               UserTutorialProgress.is_completed == True)  # noqa: E712
                       .group_by(UserTutorialProgress.user_id).all() if n >= n_videos}
        rng = random.Random(seed + pd.id)
        learners = []
        for u in users:
            token, _ = sessions.issue(db, principal=u.email, is_admin=False, user_id=u.id, commit=False)
            ability = rng.gauss(0.74, 0.12) + (0.04 if u.id in done_before else 0.0)
            learners.append(Learner(u, token, max(0.35, min(0.97, ability))))
        admin_token, _ = sessions.issue(db, principal=SCRIPT_PRINCIPAL, is_admin=True,
                                        mfa_satisfied=True, commit=False)
        db.commit()
    finally:
        db.close()

    print(f"\n{'=' * 78}\n  {name} ({slug}): {len(learners)} learners, tests: "
          + ", ".join(f"'{t['title']}'" for t in test_info.values()) + f"\n{'=' * 78}", flush=True)

    # 1+2. Open the tests, run everyone through, close the tests.
    for tid in test_info:
        call(api, "POST", f"/api/admin/tests/{tid}/start?district={slug}", admin_token)
    t0 = time.monotonic()
    done: List[Learner] = []
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for i, L in enumerate(pool.map(lambda L: run_learner(api, L, test_info, correct, seed),
                                           learners), 1):
                done.append(L)
                if i % 50 == 0 or i == len(learners):
                    print(f"  {i:>4}/{len(learners)} learners through  ({time.monotonic() - t0:.0f}s)", flush=True)
    finally:
        for tid in test_info:
            call(api, "POST", f"/api/admin/tests/{tid}/end?district={slug}", admin_token)

    # 3. Face-to-face: clear the pre-test demo selections, select screening passers.
    screening = [t for t in test_info.values() if t["test_type"] == "screening"]
    selected = 0
    if screening:
        sid = screening[-1]["id"]
        mine = {L.user_id for L in learners}
        current = call(api, "GET", f"/api/admin/results/face-to-face?district={slug}", admin_token)
        for row in current:
            if row["user_id"] in mine:
                call(api, "DELETE", f"/api/admin/results/face-to-face/{row['user_id']}", admin_token)
        db = SessionLocal()
        try:
            # Removing a selection in the app leaves the learner's "you have been
            # selected" message behind; for these demo learners, take it away too
            # so nobody de-selected still reads that they were chosen.
            db.query(Notification).filter(Notification.user_id.in_(list(mine)),
                                          Notification.title == F2F_TITLE).delete(synchronize_session=False)
            db.commit()
            passers = [e for (e,) in db.query(User.email).join(TestAttempt, TestAttempt.user_id == User.id)
                       .filter(TestAttempt.test_id == sid, TestAttempt.is_passed == True,  # noqa: E712
                               User.id.in_(list(mine))).distinct().all()]
        finally:
            db.close()
        if passers:
            r = call(api, "POST", f"/api/admin/results/face-to-face/upload?district={slug}",
                     admin_token, {"emails": passers, "notify": True})
            selected = len(r.get("matched", passers)) if isinstance(r, dict) else len(passers)

    # Summary
    failed = [L for L in done if L.error]
    print(f"\n  Videos finished now: {sum(L.videos_watched for L in done)}  |  "
          f"quizzes answered now: {sum(L.quizzes for L in done)}")
    print(f"  {'Test':<44}{'wrote':>7}{'passed':>8}{'retook':>8}{'avg best':>10}")
    for t in test_info.values():
        rs = [L.tests[t["id"]] for L in done if t["id"] in L.tests]
        wrote = len(rs)
        passed = sum(any(p for _, p in r) for r in rs)
        retook = sum(len(r) > 1 for r in rs)
        avg = sum(max(s for s, _ in r) for r in rs) / wrote if wrote else 0
        already = sum(t["id"] in L.skipped_tests for L in done)
        note = f"  (+{already} had already written it)" if already else ""
        print(f"  {t['title'][:43]:<44}{wrote:>7}{passed:>8}{retook:>8}{avg:>9.1f}%{note}")
    print(f"  Selected for face-to-face (passed screening): {selected}")
    if failed:
        print(f"\n  {len(failed)} learner(s) hit an error, e.g. {failed[0].email}: {failed[0].error}")
        print(f"  Top reasons: {Counter(L.error.split(':')[0] for L in failed).most_common(3)}")
    print(f"  Results:  Admin > Results > project '{name}'", flush=True)
    return not failed


def main():
    ap = argparse.ArgumentParser(description="Take every mock learner through the whole pipeline.")
    ap.add_argument("--projects", default="jalna,ujjain,khasi", help="comma-separated project slugs")
    ap.add_argument("--api", default="http://127.0.0.1:8010", help="backend base URL")
    ap.add_argument("--workers", type=int, default=24, help="learners in flight at once")
    ap.add_argument("--seed", type=int, default=2026, help="random seed (repeatable scores)")
    args = ap.parse_args()

    ok = True
    for slug in [s.strip().lower() for s in args.projects.split(",") if s.strip()]:
        ok = run_project(slug, args.api, args.workers, args.seed) and ok
    print("\nRESULT:", "PASS - open Admin > Results to see the finished pipeline." if ok
          else "some learners hit errors - see above.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
