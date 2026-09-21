"""
Presentation-grade live test simulation: a whole district writing a test at once.

Drives the real candidate protocol end to end, the same way the learner app
does, so what the live monitor shows is what it would show on the day:

  * each candidate connects its own WebSocket and streams QUESTION_VIEWED /
    ANSWER_SELECTED / ANSWER_CHANGED / HEARTBEAT events,
  * a realistic mix of behaviours — honest, slow, tab switching, fullscreen
    exits, copy/paste, speed-clicking, question hopping, network drop-outs and
    going idle — each producing the flags and risk the server's own detection
    rules assign,
  * every candidate finally SUBMITS THROUGH THE REST ENDPOINT, which is the only
    path that scores an attempt. (A WebSocket TEST_SUBMITTED alone just marks
    the live card; without the REST submit, the results page would show every
    candidate as "not attempted".)

It also honours the two things an admin can do from the monitor, exactly as the
learner app does:
  * WARN  — a warned candidate stops misbehaving for the rest of the test;
  * FORCE SUBMIT — the candidate submits immediately with what they have.

What it deliberately does NOT do: react to "End test". The real learner app
does not either — ending a test blocks new starts, but anyone already writing
carries on until they submit or their own timer runs out. Force-submit the
stragglers (or let them finish) before you end the test.

Usage (from backend/):
  # Rehearsal or live run — clears the previous simulated run first
  venv-win/Scripts/python.exe -m scripts.simulate_live_demo --reset

  # Shorter run for a quick check
  venv-win/Scripts/python.exe -m scripts.simulate_live_demo --reset --count 60 --minutes 2

  # After the presentation: remove the simulated attempts, restore the test
  venv-win/Scripts/python.exe -m scripts.simulate_live_demo --cleanup

Only learners with @nurturehub.mock addresses (created by seed_mock_learners)
are ever used or deleted. Real accounts are never touched.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import websockets

from app.database import SessionLocal
from app.models import ProgramDistrict, Question, Stage, Test, TestAnswer, TestAttempt, User
from app.models_live import ActivityEvent, AdminAction, LiveSession, SuspiciousFlag
from app.security import sessions

MOCK_SUFFIX = "@nurturehub.mock"


# ─────────────────────────────────────────────────────────────────────────────
# Behaviour profiles
# ─────────────────────────────────────────────────────────────────────────────
# weight      share of the cohort (normalised, so they need not sum to 100)
# pace        multiplier on the base time per question (1.0 = typical)
# accuracy    chance of picking the correct option
# The event counts are totals across the whole paper, spread over questions.

@dataclass
class Profile:
    key: str
    label: str
    weight: float
    pace: tuple              # (min, max) multiplier on base seconds/question
    accuracy: float
    tab_switches: tuple = (0, 0)
    fullscreen_exits: tuple = (0, 0)
    copy_pastes: tuple = (0, 0)
    blurs: tuple = (0, 0)
    rapid: bool = False      # answers in under 2s -> RAPID_ANSWERING
    hopper: bool = False     # 20+ views before answering -> RAPID_NAVIGATION
    dropout: bool = False    # socket drops mid-test, reconnects later
    idle: bool = False       # goes silent long enough for the server to mark idle
    changes_answers: float = 0.1  # chance of changing an answer once


PROFILES: List[Profile] = [
    Profile("honest", "Honest, steady", 40, (0.6, 1.3), 0.78, blurs=(0, 1)),
    Profile("slow", "Slow (still writing at the end)", 8, (1.5, 2.0), 0.66, changes_answers=0.35),
    Profile("tab", "Tab switcher", 12, (0.6, 1.2), 0.70, tab_switches=(3, 11), blurs=(1, 3)),
    Profile("fullscreen", "Leaves fullscreen", 8, (0.6, 1.2), 0.70, fullscreen_exits=(1, 4)),
    Profile("copy", "Copy / paste", 7, (0.5, 1.0), 0.92, copy_pastes=(1, 2), tab_switches=(1, 2)),
    Profile("rapid", "Speed-clicker", 8, (0.01, 0.03), 0.35, rapid=True),
    Profile("hopper", "Question hopper", 3, (0.8, 1.3), 0.50, hopper=True),
    Profile("cheater", "Serial cheater (everything)", 5, (0.3, 0.6), 0.95,
            tab_switches=(6, 12), fullscreen_exits=(2, 3), copy_pastes=(2, 3),
            blurs=(2, 4), rapid=True),
    Profile("dropout", "Network drop-out", 5, (0.7, 1.2), 0.72, dropout=True),
    Profile("idle", "Goes idle", 4, (0.7, 1.1), 0.70, idle=True),
]


# ─────────────────────────────────────────────────────────────────────────────
# Candidate state
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Candidate:
    user_id: int
    name: str
    email: str
    attempt_id: int
    token: str
    profile: Profile
    join_at: float                          # seconds after the run starts
    seq: int = 0
    answers: Dict[int, Optional[int]] = field(default_factory=dict)
    warned: bool = False
    forced: bool = False
    status: str = "waiting"                 # waiting|writing|submitted|failed
    submit_kind: str = ""                   # manual|auto|forced
    score: Optional[float] = None
    passed: Optional[bool] = None
    started_monotonic: float = 0.0
    error: str = ""


@dataclass
class Shared:
    t0: float
    duration_s: int
    candidates: List[Candidate]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────────────────────────
# REST (stdlib, run in a thread so the event loop keeps streaming)
# ─────────────────────────────────────────────────────────────────────────────

def _post_json(url: str, token: str, body: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode() or "{}")


# ─────────────────────────────────────────────────────────────────────────────
# One candidate
# ─────────────────────────────────────────────────────────────────────────────

class Session:
    """A candidate's socket plus the two background loops the learner app runs:
    a heartbeat, and a listener for the admin's WARN / FORCE SUBMIT."""

    def __init__(self, cand: Candidate, ws_base: str):
        self.c = cand
        self.url = f"{ws_base}/ws/candidate/{cand.attempt_id}?token={cand.token}"
        self.ws = None
        self._tasks: List[asyncio.Task] = []
        self.heartbeats_on = True

    async def open(self):
        self.ws = await websockets.connect(self.url, open_timeout=30, ping_interval=None)
        self._tasks = [asyncio.create_task(self._listen()), asyncio.create_task(self._beat())]

    async def close(self):
        for t in self._tasks:
            t.cancel()
        self._tasks = []
        if self.ws is not None:
            try:
                await self.ws.close()
            except Exception:
                pass
        self.ws = None

    async def send(self, etype: str, payload: Optional[dict] = None):
        if self.ws is None:
            return
        self.c.seq += 1
        await self.ws.send(json.dumps({
            "type": etype,
            "sequence": self.c.seq,
            "timestamp": _now_iso(),
            "payload": payload or {},
        }))

    async def _listen(self):
        try:
            async for raw in self.ws:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if msg.get("type") == "ADMIN_WARNING":
                    self.c.warned = True
                elif msg.get("type") == "FORCE_SUBMIT":
                    self.c.forced = True
        except (websockets.exceptions.ConnectionClosed, asyncio.CancelledError):
            pass

    async def _beat(self):
        # The learner app beats every 30s; a little faster keeps well clear of
        # the 90s idle threshold for everyone who is NOT meant to go idle.
        try:
            while True:
                await asyncio.sleep(20)
                if self.heartbeats_on:
                    await self.send("HEARTBEAT")
        except (websockets.exceptions.ConnectionClosed, asyncio.CancelledError):
            pass


async def _wait(cand: Candidate, seconds: float, deadline: float):
    """Sleep in small steps so a force-submit or the time limit interrupts it."""
    end = time.monotonic() + max(0.0, seconds)
    while time.monotonic() < end:
        if cand.forced or time.monotonic() >= deadline:
            return
        await asyncio.sleep(min(0.5, end - time.monotonic()))


def _spread(total: int, slots: int) -> List[int]:
    """Distribute `total` events across `slots` questions, unevenly."""
    counts = [0] * max(1, slots)
    for _ in range(total):
        counts[random.randrange(len(counts))] += 1
    return counts


async def run_candidate(cand: Candidate, questions: list, base_s: float,
                        api: str, ws_base: str, shared: Shared):
    p = cand.profile
    await asyncio.sleep(cand.join_at)
    cand.status = "writing"
    cand.started_monotonic = time.monotonic()
    deadline = cand.started_monotonic + shared.duration_s

    n = len(questions)
    tabs = _spread(random.randint(*p.tab_switches), n)
    fulls = _spread(random.randint(*p.fullscreen_exits), n)
    copies = _spread(random.randint(*p.copy_pastes), n)
    blurs = _spread(random.randint(*p.blurs), n)
    drop_at = random.randrange(1, n) if (p.dropout and n > 1) else -1
    idle_at = random.randrange(0, n) if p.idle else -1

    sess = Session(cand, ws_base)
    try:
        await sess.open()
        await sess.send("HEARTBEAT")

        # Question hopping: flick through the paper many times before settling.
        if p.hopper:
            for i in range(26):
                q = questions[i % n]
                await sess.send("QUESTION_VIEWED", {"question_id": q["id"], "question_number": (i % n) + 1})
                await _wait(cand, random.uniform(0.3, 0.9), deadline)

        for idx, q in enumerate(questions):
            if cand.forced or time.monotonic() >= deadline:
                break
            await sess.send("QUESTION_VIEWED", {"question_id": q["id"], "question_number": idx + 1})
            think = base_s * random.uniform(*p.pace)
            if p.rapid:
                think = random.uniform(0.4, 1.7)
            q_start = time.monotonic()

            # Misbehaviour happens while "reading" the question — unless the
            # admin has warned them, in which case they straighten up.
            cheats = []
            if not cand.warned:
                cheats += ["TAB_SWITCH"] * tabs[idx]
                cheats += ["FULLSCREEN_EXIT"] * fulls[idx]
                cheats += ["COPY_PASTE_DETECTED"] * copies[idx]
                cheats += ["WINDOW_BLUR"] * blurs[idx]
            random.shuffle(cheats)
            slice_s = think / (len(cheats) + 1)
            for ev in cheats:
                await _wait(cand, slice_s, deadline)
                if cand.warned:
                    break
                if ev == "TAB_SWITCH":
                    await sess.send("WINDOW_BLUR")
                    await sess.send("TAB_SWITCH", {"count": 1})
                    await _wait(cand, random.uniform(1.0, 3.0), deadline)
                    await sess.send("WINDOW_FOCUS")
                elif ev == "WINDOW_BLUR":
                    await sess.send("WINDOW_BLUR")
                    await _wait(cand, random.uniform(1.0, 2.5), deadline)
                    await sess.send("WINDOW_FOCUS")
                else:
                    await sess.send(ev)
            await _wait(cand, slice_s, deadline)

            # Going idle: fall silent long enough for the server's stale-sweep
            # (90s without a heartbeat, checked every 15s) to mark the card idle.
            if idx == idle_at:
                sess.heartbeats_on = False
                await _wait(cand, 115, deadline)
                sess.heartbeats_on = True

            if cand.forced or time.monotonic() >= deadline:
                break

            # Answer.
            opts = q["options"]
            correct = next((o for o in opts if o["is_correct"]), None)
            wrong = [o for o in opts if not o["is_correct"]]
            pick = correct if (correct and (random.random() < p.accuracy or not wrong)) else random.choice(wrong or opts)
            spent_ms = int((time.monotonic() - q_start) * 1000)
            if p.rapid:
                spent_ms = int(random.uniform(400, 1800))
            await sess.send("ANSWER_SELECTED", {
                "question_id": q["id"], "selected_option_id": pick["id"], "time_on_question_ms": spent_ms,
            })
            cand.answers[q["id"]] = pick["id"]

            # Second thoughts.
            if random.random() < p.changes_answers and len(opts) > 1:
                await _wait(cand, random.uniform(2, 6), deadline)
                alt = random.choice([o for o in opts if o["id"] != pick["id"]])
                await sess.send("ANSWER_CHANGED", {
                    "question_id": q["id"], "selected_option_id": alt["id"],
                    "time_on_question_ms": spent_ms + 3000,
                })
                cand.answers[q["id"]] = alt["id"]

            # Network drop: the socket goes away (card turns "disconnected"),
            # then the app reconnects and carries on — same sequence numbers.
            if idx == drop_at:
                await sess.close()
                await _wait(cand, random.uniform(20, 40), deadline)
                await sess.open()
                await sess.send("WINDOW_FOCUS")

        # Review before submitting (not for the ones being hurried along).
        if not cand.forced and time.monotonic() < deadline and not p.rapid:
            await _wait(cand, random.uniform(3, 10), deadline)

        if cand.forced:
            cand.submit_kind = "forced"
            await sess.send("TEST_SUBMITTED")
        elif time.monotonic() >= deadline:
            cand.submit_kind = "auto"
            await sess.send("TEST_AUTO_SUBMITTED")
        else:
            cand.submit_kind = "manual"
            await sess.send("TEST_SUBMITTED")

        # The REST submit is what actually scores the attempt.
        body = {
            "answers": [
                {"question_id": q["id"], "selected_option_id": cand.answers.get(q["id"]),
                 "is_marked_for_review": False}
                for q in questions
            ],
            "time_used_seconds": int(time.monotonic() - cand.started_monotonic),
        }
        result = await asyncio.to_thread(
            _post_json, f"{api}/api/tests/attempts/{cand.attempt_id}/submit", cand.token, body)
        cand.score = result.get("score")
        cand.passed = result.get("is_passed")
        cand.status = "submitted"
        await asyncio.sleep(1.0)
    except urllib.error.HTTPError as e:
        cand.status, cand.error = "failed", f"submit HTTP {e.code}: {e.read().decode()[:120]}"
    except Exception as e:  # noqa: BLE001 — one candidate must never stop the run
        cand.status, cand.error = "failed", f"{type(e).__name__}: {e}"
    finally:
        await sess.close()


# ─────────────────────────────────────────────────────────────────────────────
# Setup / reset / cleanup
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_test(db, district: str, test_id: Optional[int]) -> Test:
    if test_id:
        test = db.query(Test).filter(Test.id == test_id).first()
        if not test:
            sys.exit(f"No test with id {test_id}.")
        return test
    pd = db.query(ProgramDistrict).filter(ProgramDistrict.slug == district).first()
    if not pd:
        sys.exit(f"No project with slug '{district}'.")
    tests = (
        db.query(Test).join(Stage, Test.stage_id == Stage.id)
        .filter(Stage.program_district_id == pd.id)
        .order_by(Stage.order_index, Test.id).all()
    )
    if not tests:
        sys.exit(f"Project '{district}' has no tests.")
    return next((t for t in tests if t.test_type == "formative"), tests[0])


def _mock_attempt_ids(db, test_id: int) -> List[int]:
    return [a.id for a in (
        db.query(TestAttempt.id).join(User, TestAttempt.user_id == User.id)
        .filter(TestAttempt.test_id == test_id, User.email.like(f"%{MOCK_SUFFIX}")).all()
    )]


def _purge_simulated(db, test_id: int) -> int:
    """Delete the simulated attempts for this test — mock learners ONLY."""
    attempt_ids = _mock_attempt_ids(db, test_id)
    if not attempt_ids:
        return 0
    session_ids = [s.id for s in db.query(LiveSession.id).filter(LiveSession.attempt_id.in_(attempt_ids)).all()]
    if session_ids:
        for model in (AdminAction, SuspiciousFlag, ActivityEvent):
            db.query(model).filter(model.session_id.in_(session_ids)).delete(synchronize_session=False)
        db.query(LiveSession).filter(LiveSession.id.in_(session_ids)).delete(synchronize_session=False)
    db.query(TestAnswer).filter(TestAnswer.attempt_id.in_(attempt_ids)).delete(synchronize_session=False)
    db.query(TestAttempt).filter(TestAttempt.id.in_(attempt_ids)).delete(synchronize_session=False)
    db.commit()
    return len(attempt_ids)


def prepare(args) -> tuple:
    db = SessionLocal()
    try:
        test = _resolve_test(db, args.district, args.test_id)
        existing = _mock_attempt_ids(db, test.id)
        if existing and not args.reset:
            sys.exit(
                f"'{test.title}' already has {len(existing)} simulated attempt(s) from an earlier run.\n"
                f"Add --reset to clear them first (mock learners only), or --cleanup to just remove them."
            )
        if existing:
            print(f"Cleared {_purge_simulated(db, test.id)} simulated attempt(s) from the previous run.")

        questions = (
            db.query(Question).filter(Question.test_id == test.id)
            .order_by(Question.order_index, Question.id).all()
        )
        if not questions:
            sys.exit(f"'{test.title}' has no questions.")
        q_data = [{
            "id": q.id,
            "options": [{"id": o.id, "label": o.label, "is_correct": o.is_correct}
                        for o in sorted(q.options, key=lambda o: o.label or "")],
        } for q in questions]

        pd_id = test.stage.program_district_id
        learners = (
            db.query(User)
            .filter(User.program_district_id == pd_id, User.email.like(f"%{MOCK_SUFFIX}"),
                    User.is_admin == False)  # noqa: E712
            .order_by(User.id).limit(args.count).all()
        )
        if not learners:
            sys.exit("No mock learners in this project — run scripts.seed_mock_learners first.")

        # Open the test for writing (the admin would press Start).
        test.status = "active"
        test.started_at = datetime.now(timezone.utc)
        test.ended_at = None
        db.commit()

        # Deal profiles by weight, then shuffle so the cohorts are interleaved
        # on the monitor rather than arriving in blocks.
        total_w = sum(p.weight for p in PROFILES)
        deck: List[Profile] = []
        for p in PROFILES:
            deck += [p] * round(len(learners) * p.weight / total_w)
        while len(deck) < len(learners):
            deck.append(PROFILES[0])
        deck = deck[:len(learners)]
        random.shuffle(deck)

        now = datetime.now(timezone.utc)
        cands: List[Candidate] = []
        for user, profile in zip(learners, deck):
            join_at = random.uniform(0, args.ramp)
            attempt = TestAttempt(
                test_id=test.id, user_id=user.id, attempt_number=1,
                # The moment they "press Start" — keeps their elapsed time honest.
                started_at=now + timedelta(seconds=join_at),
            )
            db.add(attempt)
            db.flush()
            token, _ = sessions.issue(db, principal=user.email, is_admin=False,
                                      user_id=user.id, commit=False)
            cands.append(Candidate(
                user_id=user.id, name=user.full_name or user.email, email=user.email,
                attempt_id=attempt.id, token=token, profile=profile, join_at=join_at,
            ))
        db.commit()
        info = {"id": test.id, "title": test.title, "duration": test.duration_minutes,
                "pass": test.passing_score_pct}
        return info, q_data, cands
    finally:
        db.close()


def cleanup(args):
    db = SessionLocal()
    try:
        test = _resolve_test(db, args.district, args.test_id)
        removed = _purge_simulated(db, test.id)
        test.status = "scheduled" if test.scheduled_at else "draft"
        test.started_at = None
        test.ended_at = None
        db.commit()
        print(f"Removed {removed} simulated attempt(s) from '{test.title}' and set it back to '{test.status}'.")
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# Run
# ─────────────────────────────────────────────────────────────────────────────

async def _ticker(shared: Shared, total: int):
    while True:
        await asyncio.sleep(5)
        c = shared.candidates
        writing = sum(x.status == "writing" for x in c)
        done = sum(x.status == "submitted" for x in c)
        forced = sum(x.submit_kind == "forced" for x in c)
        auto = sum(x.submit_kind == "auto" for x in c)
        warned = sum(x.warned for x in c)
        failed = sum(x.status == "failed" for x in c)
        joined = sum(x.status != "waiting" for x in c)
        m, s = divmod(int(time.monotonic() - shared.t0), 60)
        print(f"  [{m:02d}:{s:02d}] joined {joined:>3}/{total} | writing {writing:>3} | "
              f"submitted {done:>3} (forced {forced}, timed-out {auto}) | warned {warned} | failed {failed}",
              flush=True)
        if done + failed >= total:
            return


async def run(args):
    info, questions, cands = prepare(args)
    n = len(questions)
    # Base seconds per question so a typical candidate finishes near --minutes.
    base_s = (args.minutes * 60 * 0.8) / max(1, n)

    mix = {}
    for c in cands:
        mix[c.profile.label] = mix.get(c.profile.label, 0) + 1
    print("\n" + "=" * 78)
    print(f"  '{info['title']}'  —  {len(cands)} candidates, {n} questions, "
          f"{info['duration']}-min limit, pass {info['pass']}%")
    print(f"  Typical finish ~{args.minutes} min; joins ramp in over {args.ramp:.0f}s.")
    print("  Behaviour mix:")
    for label, k in sorted(mix.items(), key=lambda kv: -kv[1]):
        print(f"    {k:>4}  {label}")
    print(f"\n  Live monitor:  http://localhost:5173/admin/tests/{info['id']}/monitor")
    print("=" * 78 + "\n", flush=True)

    shared = Shared(t0=time.monotonic(), duration_s=info["duration"] * 60, candidates=cands)
    ticker = asyncio.create_task(_ticker(shared, len(cands)))
    await asyncio.gather(*(run_candidate(c, questions, base_s, args.api, args.ws, shared) for c in cands))
    await ticker

    # ── Summary ──
    print("\n" + "=" * 78)
    print(f"  {'Profile':<32}{'n':>5}{'submitted':>11}{'avg score':>11}{'passed':>9}")
    for p in PROFILES:
        group = [c for c in cands if c.profile.key == p.key]
        if not group:
            continue
        sub = [c for c in group if c.status == "submitted"]
        avg = sum(c.score or 0 for c in sub) / len(sub) if sub else 0
        passed = sum(1 for c in sub if c.passed)
        print(f"  {p.label:<32}{len(group):>5}{len(sub):>11}{avg:>10.1f}%{passed:>9}")
    failures = [c for c in cands if c.status == "failed"]
    if failures:
        print(f"\n  {len(failures)} candidate(s) failed, e.g.: {failures[0].name}: {failures[0].error}")
    print("\n  Everyone has submitted. Now press 'End test', then open Results.")
    print("=" * 78, flush=True)


def main():
    ap = argparse.ArgumentParser(description="Simulate a district writing a test live, for the monitor demo.")
    ap.add_argument("--district", default="jalna", help="project slug (default: jalna)")
    ap.add_argument("--test-id", type=int, default=None, help="default: the project's formative test")
    ap.add_argument("--count", type=int, default=300, help="candidates (default: 300)")
    ap.add_argument("--minutes", type=float, default=6.0, help="typical time to finish (default: 6)")
    ap.add_argument("--ramp", type=float, default=45.0, help="seconds over which people join (default: 45)")
    ap.add_argument("--api", default="http://127.0.0.1:8010", help="backend base URL")
    ap.add_argument("--ws", default="ws://127.0.0.1:8010", help="backend WebSocket base URL")
    ap.add_argument("--seed", type=int, default=None, help="random seed, for a repeatable run")
    ap.add_argument("--reset", action="store_true", help="clear the previous simulated run first")
    ap.add_argument("--cleanup", action="store_true", help="remove simulated attempts and restore the test, then exit")
    args = ap.parse_args()

    if args.seed is not None:
        random.seed(args.seed)
    if args.cleanup:
        cleanup(args)
        return
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        print("\nStopped. Re-run with --reset to start over, or --cleanup to tidy up.")


if __name__ == "__main__":
    main()
