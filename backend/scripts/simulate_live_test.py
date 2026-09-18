"""
Live Test Simulation Runner.

Emulates concurrent candidate learners taking a live test via WebSockets
(/api/ws/candidate/{attempt_id}), streaming realistic real-time events:
  - QUESTION_VIEWED
  - ANSWER_SELECTED
  - TAB_SWITCH / WINDOW_BLUR (triggers suspicious behavior flags)
  - HEARTBEAT
  - TEST_SUBMITTED

This lets administrators test the real-time proctoring console
(/admin/tests/:testId/live) with real live-updating candidate cards,
risk score meters, progress bars, and proctor flags.

Usage:
  python -m scripts.simulate_live_test --test-id 4 --candidates 5 --speed 2.0
  python -m scripts.simulate_live_test --candidates 10 --speed 3.0
"""

import argparse
import asyncio
import json
import random
import time
from datetime import datetime, timezone
from typing import List, Optional

import websockets
from sqlalchemy.orm import joinedload

from app.database import SessionLocal
from app.models import ProgramDistrict, Question, Test, TestAttempt, User
from app.security import sessions


async def simulate_candidate(
    ws_url: str,
    attempt_id: int,
    token: str,
    user_name: str,
    user_email: str,
    questions: list,
    speed: float,
    is_suspicious: bool = False,
):
    """Simulates one candidate taking the test over WebSocket."""
    url = f"{ws_url}/ws/candidate/{attempt_id}?token={token}"
    seq = 1

    try:
        async with websockets.connect(url) as ws:
            print(f"  [CONNECTED] {user_name} ({user_email})")

            # 1. Heartbeat
            await ws.send(json.dumps({
                "type": "HEARTBEAT",
                "sequence": seq,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "payload": {},
            }))
            seq += 1
            await asyncio.sleep(1.0 / speed)

            # 2. Iterate through questions
            for q_idx, q in enumerate(questions, start=1):
                # QUESTION_VIEWED
                view_evt = {
                    "type": "QUESTION_VIEWED",
                    "sequence": seq,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "payload": {
                        "question_id": q["id"],
                        "question_number": q_idx,
                    },
                }
                await ws.send(json.dumps(view_evt))
                seq += 1

                # Behavior profile
                if is_suspicious:
                    # Suspicious candidate switches tabs and answers ultra-rapidly
                    await ws.send(json.dumps({
                        "type": "TAB_SWITCH",
                        "sequence": seq,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "payload": {"count": random.randint(1, 3)},
                    }))
                    seq += 1
                    think_time = random.uniform(0.3, 0.8) / speed
                    print(f"  ⚠️  [TAB SWITCH & RAPID] {user_name} viewing Q{q_idx}/{len(questions)}")
                else:
                    think_time = random.uniform(4.0, 10.0) / speed
                    print(f"  [READING Q{q_idx}/{len(questions)}] {user_name}")

                await asyncio.sleep(think_time)

                # Pick option
                options = q["options"]
                if options:
                    correct_opt = next((o for o in options if o["is_correct"]), None)
                    wrong_opts = [o for o in options if not o["is_correct"]]

                    # 80% chance pick correct
                    if (random.random() < 0.80 or not wrong_opts) and correct_opt:
                        selected = correct_opt
                    else:
                        selected = random.choice(wrong_opts) if wrong_opts else options[0]

                    ans_evt = {
                        "type": "ANSWER_SELECTED",
                        "sequence": seq,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "payload": {
                            "question_id": q["id"],
                            "selected_option_id": selected["id"],
                            "time_on_question_ms": int(think_time * 1000),
                        },
                    }
                    await ws.send(json.dumps(ans_evt))
                    seq += 1
                    print(f"  [ANSWERED Q{q_idx}] {user_name} picked Option {selected['label']}")

                # Occasional heartbeat
                if q_idx % 2 == 0:
                    await ws.send(json.dumps({
                        "type": "HEARTBEAT",
                        "sequence": seq,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "payload": {},
                    }))
                    seq += 1

                await asyncio.sleep(1.0 / speed)

            # 3. Final review & Submit
            await asyncio.sleep(2.0 / speed)
            submit_evt = {
                "type": "TEST_SUBMITTED",
                "sequence": seq,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "payload": {},
            }
            await ws.send(json.dumps(submit_evt))
            print(f"  ✅ [SUBMITTED] {user_name} finished all questions.")
            await asyncio.sleep(1.0 / speed)

    except websockets.exceptions.ConnectionClosed as e:
        print(f"  [SOCKET CLOSED] {user_name}: code {e.code}, reason: {e.reason}")
    except Exception as e:
        print(f"  [ERROR] {user_name}: {e}")


async def run_simulation(
    test_id: Optional[int],
    candidates_count: int,
    speed: float,
    ws_url: str,
    flagged_count: int = 1,
):
    db = SessionLocal()
    try:
        # Find test
        if test_id:
            test = db.query(Test).filter(Test.id == test_id).first()
        else:
            test = db.query(Test).filter(Test.status.in_(["active", "scheduled"])).first()

        if not test:
            print("Error: No scheduled or active test found to simulate.")
            return

        # Ensure test is active
        if test.status != "active":
            test.status = "active"
            test.started_at = datetime.now(timezone.utc)
            db.commit()
            print(f"Activated test: '{test.title}' (ID: {test.id})")
        else:
            print(f"Target test: '{test.title}' (ID: {test.id}) [status: {test.status}]")

        # Load questions
        db_questions = db.query(Question).options(
            joinedload(Question.options)
        ).filter(Question.test_id == test.id).order_by(Question.order_index).all()

        if not db_questions:
            print(f"Error: Test {test.id} has no questions authored.")
            return

        questions_data = [
            {
                "id": q.id,
                "text": q.text,
                "options": [
                    {"id": o.id, "label": o.label, "text": o.text, "is_correct": o.is_correct}
                    for o in q.options
                ],
            }
            for q in db_questions
        ]
        print(f"Loaded {len(questions_data)} questions.")

        # Find candidates
        stage = test.stage
        pd_id = stage.program_district_id if stage else None

        q_users = db.query(User).filter(User.is_admin == False, User.is_verified == True)
        if pd_id:
            district_users = q_users.filter(User.program_district_id == pd_id).all()
            if len(district_users) >= candidates_count:
                candidates_pool = district_users[:candidates_count]
            else:
                candidates_pool = (district_users + q_users.all())[:candidates_count]
        else:
            candidates_pool = q_users.limit(candidates_count).all()

        if not candidates_pool:
            print("Error: No verified candidate users found in database.")
            return

        print(f"Preparing {len(candidates_pool)} candidate sessions...")

        candidate_tasks = []
        for idx, user in enumerate(candidates_pool):
            # Upsert attempt
            attempt = db.query(TestAttempt).filter(
                TestAttempt.test_id == test.id,
                TestAttempt.user_id == user.id,
                TestAttempt.submitted_at.is_(None),
            ).first()

            if not attempt:
                attempt = TestAttempt(
                    test_id=test.id,
                    user_id=user.id,
                    attempt_number=1,
                    started_at=datetime.now(timezone.utc),
                )
                db.add(attempt)
                db.flush()

            # Issue session token
            token, _ = sessions.issue(
                db,
                principal=user.email,
                is_admin=False,
                user_id=user.id,
                commit=True,
            )

            is_suspicious = (idx < flagged_count)
            task = simulate_candidate(
                ws_url=ws_url,
                attempt_id=attempt.id,
                token=token,
                user_name=user.full_name or user.email,
                user_email=user.email,
                questions=questions_data,
                speed=speed,
                is_suspicious=is_suspicious,
            )
            candidate_tasks.append(task)

        db.commit()

        print("\n========================================================")
        print(f"Starting Live Test Simulation ({len(candidate_tasks)} candidates, speed: {speed}x)")
        print(f"Open Admin Live Monitor in browser to watch:")
        print(f"  👉 http://localhost:5173/admin/tests/{test.id}/live")
        print("========================================================\n")

        await asyncio.gather(*candidate_tasks)

        print("\n========================================================")
        print("Live Test Simulation completed for all candidates!")
        print("========================================================")

    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Simulate live candidates taking a test via WebSockets.")
    parser.add_argument("--test-id", type=int, default=None, help="Target test ID (default: first scheduled/active test)")
    parser.add_argument("--candidates", type=int, default=5, help="Number of concurrent candidates to simulate (default: 5)")
    parser.add_argument("--speed", type=float, default=2.0, help="Simulation speed multiplier (default: 2.0)")
    parser.add_argument("--flagged", type=int, default=1, help="Number of candidates behaving suspiciously (default: 1)")
    parser.add_argument("--ws-url", type=str, default="ws://localhost:8000", help="WebSocket base URL (default: ws://localhost:8000)")

    args = parser.parse_args()

    asyncio.run(
        run_simulation(
            test_id=args.test_id,
            candidates_count=args.candidates,
            speed=args.speed,
            ws_url=args.ws_url,
            flagged_count=args.flagged,
        )
    )


if __name__ == "__main__":
    main()
