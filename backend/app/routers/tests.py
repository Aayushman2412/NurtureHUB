from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
from app.database import get_db
from app.models import Test, Question, QuestionOption, TestAttempt, TestAnswer, Tutorial, UserTutorialProgress, Notification
from app.schemas import TestOut, StartAttemptResponse, TestSubmitRequest, TestSubmitResponse, QuestionOut, QuestionOptionOut
from app.dependencies import get_current_user
from app.models import User

router = APIRouter(prefix="/api/tests", tags=["tests"])

@router.get("", response_model=List[TestOut])
def get_tests(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tests = db.query(Test).all()
    
    # Get completed tutorial IDs for the current user
    completed_progress = db.query(UserTutorialProgress).filter(
        UserTutorialProgress.user_id == current_user.id,
        UserTutorialProgress.is_completed == True
    ).all()
    completed_tutorial_ids = {p.tutorial_id for p in completed_progress}
    
    response = []
    for test in tests:
        # Get all tutorials for the test's stage
        stage_tutorials = db.query(Tutorial).filter(Tutorial.stage_id == test.stage_id).all()
        stage_tutorial_ids = {t.id for t in stage_tutorials}
        
        # Test is locked if there are tutorials in the stage and the user hasn't completed all of them
        is_locked = False
        if stage_tutorial_ids:
            completed_in_stage = stage_tutorial_ids.intersection(completed_tutorial_ids)
            if len(completed_in_stage) < len(stage_tutorial_ids):
                is_locked = True
                
        # If the stage itself is locked (depends on previous stage's test pass), then the test is also locked
        # Find if there is a previous stage test
        prev_test = db.query(Test).join(Test.stage).filter(Test.stage_id < test.stage_id).order_by(Test.stage_id.desc()).first()
        if prev_test:
            prev_passed = db.query(TestAttempt).filter(
                TestAttempt.user_id == current_user.id,
                TestAttempt.test_id == prev_test.id,
                TestAttempt.is_passed == True
            ).first()
            if not prev_passed:
                is_locked = True
                
        # Get attempts statistics
        attempts = db.query(TestAttempt).filter(
            TestAttempt.user_id == current_user.id,
            TestAttempt.test_id == test.id,
            TestAttempt.submitted_at.isnot(None)
        ).all()
        
        attempts_count = len(attempts)
        is_passed = any(att.is_passed for att in attempts)
        best_score = max([att.score for att in attempts]) if attempts else None
        
        response.append(
            TestOut(
                id=test.id,
                stage_id=test.stage_id,
                title=test.title,
                description=test.description,
                total_questions=test.total_questions,
                duration_minutes=test.duration_minutes,
                passing_score_pct=test.passing_score_pct,
                max_attempts=test.max_attempts,
                is_locked=is_locked,
                best_score=best_score,
                attempts_count=attempts_count,
                is_passed=is_passed
            )
        )
        
    return response

@router.get("/{id}", response_model=TestOut)
def get_test_details(id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    test = db.query(Test).filter(Test.id == id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
        
    # Standard metadata calculations
    attempts = db.query(TestAttempt).filter(
        TestAttempt.user_id == current_user.id,
        TestAttempt.test_id == test.id,
        TestAttempt.submitted_at.isnot(None)
    ).all()
    
    attempts_count = len(attempts)
    is_passed = any(att.is_passed for att in attempts)
    best_score = max([att.score for att in attempts]) if attempts else None
    
    return TestOut(
        id=test.id,
        stage_id=test.stage_id,
        title=test.title,
        description=test.description,
        total_questions=test.total_questions,
        duration_minutes=test.duration_minutes,
        passing_score_pct=test.passing_score_pct,
        max_attempts=test.max_attempts,
        is_locked=False, # Lock check is done in list or endpoint-level
        best_score=best_score,
        attempts_count=attempts_count,
        is_passed=is_passed
    )

@router.post("/{id}/start", response_model=StartAttemptResponse)
def start_test_attempt(id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    test = db.query(Test).filter(Test.id == id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
        
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
    
    # Fetch questions and options
    questions = db.query(Question).filter(Question.test_id == id).order_by(Question.order_index).all()
    
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
        "questions": questions_out
    }

@router.post("/attempts/{attempt_id}/submit", response_model=TestSubmitResponse)
def submit_test_attempt(
    attempt_id: int,
    submission: TestSubmitRequest,
    current_user: User = Depends(get_current_user),
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
        
    test = db.query(Test).filter(Test.id == attempt.test_id).first()
    questions = db.query(Question).filter(Question.test_id == test.id).all()
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
    
    # Update attempt
    attempt.submitted_at = datetime.utcnow()
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
