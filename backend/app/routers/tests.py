from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import update
from sqlalchemy.orm import Session, selectinload
from typing import List, Optional, Set
from datetime import datetime, timezone
from app.database import get_db
from app.models import Stage, Test, Question, QuestionOption, TestAttempt, TestAnswer, Tutorial, UserTutorialProgress, Notification
from app.schemas import TestOut, StartAttemptResponse, TestSubmitRequest, TestSubmitResponse, QuestionOut, QuestionOptionOut
from app.dependencies import get_verified_user
from app.flow import (
    ensure_awaiting_results_notification, test_lock_state, test_lock_state_precomputed,
)
from app.models import User
from app.timeutils import to_utc

router = APIRouter(prefix="/api/tests", tags=["tests"])


def _test_out_from_parts(
    test: Test, attempts: List[TestAttempt],
    is_locked: bool, lock_reason: Optional[str],
) -> TestOut:
    return TestOut(
        id=test.id,
        stage_id=test.stage_id,
        title=test.title,
        description=test.description,
        total_questions=test.total_questions,
        duration_minutes=test.duration_minutes,
        passing_score_pct=test.passing_score_pct,
        max_attempts=test.max_attempts,
        status=test.status,
        test_type=test.test_type,
        scheduled_at=to_utc(test.scheduled_at),
        is_locked=is_locked,
        lock_reason=lock_reason,
        best_score=max([att.score for att in attempts]) if attempts else None,
        attempts_count=len(attempts),
        is_passed=any(att.is_passed for att in attempts),
    )


def _test_out(db: Session, current_user: User, test: Test) -> TestOut:
    is_locked, lock_reason = test_lock_state(db, current_user, test)
    attempts = db.query(TestAttempt).filter(
        TestAttempt.user_id == current_user.id,
        TestAttempt.test_id == test.id,
        TestAttempt.submitted_at.isnot(None)
    ).all()
    return _test_out_from_parts(test, attempts, is_locked, lock_reason)


@router.get("", response_model=List[TestOut])
def get_tests(current_user: User = Depends(get_verified_user), db: Session = Depends(get_db)):
    # Filter tests by user's program district
    if not current_user.program_district_id:
        return []

    # Batched: compute eligibility once for the whole district instead of the
    # old ~4-queries-per-test path (this endpoint loads on every tests-page view).
    stages = db.query(Stage).filter(
        Stage.program_district_id == current_user.program_district_id
    ).order_by(Stage.order_index).all()
    if not stages:
        return []
    stage_ids = [s.id for s in stages]

    tutorials = db.query(Tutorial.id, Tutorial.stage_id).filter(
        Tutorial.stage_id.in_(stage_ids)
    ).all()
    tutorials_by_stage: dict[int, list[int]] = {}
    for tid, sid in tutorials:
        tutorials_by_stage.setdefault(sid, []).append(tid)

    completed_ids: Set[int] = {
        r[0] for r in db.query(UserTutorialProgress.tutorial_id).filter(
            UserTutorialProgress.user_id == current_user.id,
            UserTutorialProgress.is_completed == True,  # noqa: E712
        ).all()
    }

    tests = db.query(Test).filter(
        Test.stage_id.in_(stage_ids)
    ).order_by(Test.stage_id).all()
    attempts_by_test: dict[int, list[TestAttempt]] = {}
    test_ids = [t.id for t in tests]
    if test_ids:
        for a in db.query(TestAttempt).filter(
            TestAttempt.user_id == current_user.id,
            TestAttempt.test_id.in_(test_ids),
            TestAttempt.submitted_at.isnot(None),
        ).all():
            attempts_by_test.setdefault(a.test_id, []).append(a)

    stage_order = {s.id: s.order_index for s in stages}

    def required_before(order_index: int) -> Set[int]:
        req: Set[int] = set()
        for s in stages:
            if s.order_index <= order_index:
                req.update(tutorials_by_stage.get(s.id, []))
        return req

    # preserve original ordering (by stage order_index)
    tests_sorted = sorted(tests, key=lambda t: stage_order.get(t.stage_id, 0))
    out = []
    for test in tests_sorted:
        required = required_before(stage_order.get(test.stage_id, 0))
        is_locked, lock_reason = test_lock_state_precomputed(test, required, completed_ids)
        out.append(_test_out_from_parts(
            test, attempts_by_test.get(test.id, []), is_locked, lock_reason))
    return out

@router.get("/{id}", response_model=TestOut)
def get_test_details(id: int, current_user: User = Depends(get_verified_user), db: Session = Depends(get_db)):
    test = db.query(Test).filter(Test.id == id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    return _test_out(db, current_user, test)

@router.post("/{id}/start", response_model=StartAttemptResponse)
def start_test_attempt(id: int, current_user: User = Depends(get_verified_user), db: Session = Depends(get_db)):
    test = db.query(Test).filter(Test.id == id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    # Hard server-side gate: eligibility (required videos) + admin lifecycle.
    is_locked, lock_reason = test_lock_state(db, current_user, test)
    if is_locked:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=lock_reason)

    # Check attempts count limit
    past_attempts = db.query(TestAttempt).filter(
        TestAttempt.user_id == current_user.id,
        TestAttempt.test_id == id,
        TestAttempt.submitted_at.isnot(None)
    ).count()
    
    if past_attempts >= test.max_attempts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"You have reached the maximum number of attempts ({test.max_attempts}) for this test."
        )
        
    # Create new attempt
    attempt_num = past_attempts + 1
    new_attempt = TestAttempt(
        user_id=current_user.id,
        test_id=id,
        attempt_number=attempt_num,
        started_at=datetime.utcnow()
    )
    db.add(new_attempt)
    db.commit()
    db.refresh(new_attempt)
    
    # Fetch questions and options (eager-load options: one query for all option
    # rows instead of one lazy SELECT per question).
    questions = db.query(Question).options(
        selectinload(Question.options)
    ).filter(Question.test_id == id).order_by(Question.order_index).all()

    questions_out = []
    for q in questions:
        options_out = [
            QuestionOptionOut(id=opt.id, label=opt.label, text=opt.text)
            for opt in q.options
        ]
        questions_out.append(
            QuestionOut(
                id=q.id,
                text=q.text,
                marks=q.marks,
                order_index=q.order_index,
                options=options_out
            )
        )
        
    return {
        "attempt_id": new_attempt.id,
        "duration_minutes": test.duration_minutes,
        "started_at": new_attempt.started_at.isoformat(),
        "questions": questions_out
    }

@router.post("/attempts/{attempt_id}/submit", response_model=TestSubmitResponse)
def submit_test_attempt(
    attempt_id: int,
    submission: TestSubmitRequest,
    current_user: User = Depends(get_verified_user),
    db: Session = Depends(get_db)
):
    attempt = db.query(TestAttempt).filter(
        TestAttempt.id == attempt_id,
        TestAttempt.user_id == current_user.id
    ).first()

    if not attempt:
        raise HTTPException(status_code=404, detail="Test attempt not found")

    if attempt.submitted_at:
        raise HTTPException(status_code=400, detail="This test attempt has already been submitted")

    # Atomically claim the submit: stamp submitted_at only if it is still NULL.
    # This closes the double-submit race (two concurrent POSTs, or FORCE_SUBMIT +
    # user submit) that previously both passed the read-only check above and each
    # wrote a full set of answer rows + duplicate notifications. The loser here
    # updates 0 rows and is rejected.
    now = datetime.utcnow()
    claimed = db.execute(
        update(TestAttempt)
        .where(TestAttempt.id == attempt_id, TestAttempt.submitted_at.is_(None))
        .values(submitted_at=now)
    ).rowcount
    if not claimed:
        db.rollback()
        raise HTTPException(status_code=400, detail="This test attempt has already been submitted")

    test = db.query(Test).filter(Test.id == attempt.test_id).first()
    questions = db.query(Question).options(
        selectinload(Question.options)
    ).filter(Question.test_id == test.id).all()
    question_map = {q.id: q for q in questions}
    
    total_marks = sum(q.marks for q in questions)
    score_earned = 0.0
    correct_count = 0
    
    # Process answers
    submitted_answers_map = {ans.question_id: ans for ans in submission.answers}
    
    for q in questions:
        sub_ans = submitted_answers_map.get(q.id)
        selected_option_id = sub_ans.selected_option_id if sub_ans else None
        is_marked = sub_ans.is_marked_for_review if sub_ans else False
        
        is_correct = False
        correct_option = next((opt for opt in q.options if opt.is_correct), None)
        
        if selected_option_id and correct_option and selected_option_id == correct_option.id:
            is_correct = True
            score_earned += q.marks
            correct_count += 1
            
        # Create Answer record
        answer_record = TestAnswer(
            attempt_id=attempt.id,
            question_id=q.id,
            selected_option_id=selected_option_id,
            is_correct=is_correct,
            is_marked_for_review=is_marked
        )
        db.add(answer_record)
        
    # Calculate percentage score
    pct_score = (score_earned / total_marks * 100) if total_marks > 0 else 0.0
    is_passed = pct_score >= test.passing_score_pct
    
    # Update attempt (submitted_at already claimed atomically above)
    attempt.submitted_at = now
    attempt.score = pct_score
    attempt.total_marks = total_marks
    attempt.is_passed = is_passed
    attempt.time_used_seconds = submission.time_used_seconds
    
    # Send notification
    status_str = "Passed" if is_passed else "Failed"
    notif = Notification(
        user_id=current_user.id,
        title=f"Test Attempt Completed: {status_str}",
        message=f"You completed the test '{test.title}' with a score of {pct_score:.1f}% ({correct_count}/{len(questions)} correct)."
    )
    db.add(notif)

    # If this was the last outstanding item, tell the user to wait for results.
    ensure_awaiting_results_notification(db, current_user)

    db.commit()
    db.refresh(attempt)

    return {
        "attempt_id": attempt.id,
        "score": pct_score,
        "total_marks": total_marks,
        "is_passed": is_passed,
        "correct_answers_count": correct_count,
        "total_questions": len(questions)
    }
