from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import TestAttempt, Test, Question, TestAnswer, QuestionOption
from app.schemas import TestAttemptOut, DetailedResultResponse, DetailedAnswerOut, QuestionOptionOut
from app.dependencies import get_verified_user
from app.models import User

router = APIRouter(prefix="/api/results", tags=["results"])

@router.get("", response_model=List[TestAttemptOut])
def get_results_list(current_user: User = Depends(get_verified_user), db: Session = Depends(get_db)):
    attempts = db.query(TestAttempt).filter(
        TestAttempt.user_id == current_user.id,
        TestAttempt.submitted_at.isnot(None)
    ).order_by(TestAttempt.submitted_at.desc()).all()
    return attempts

@router.get("/{attempt_id}", response_model=DetailedResultResponse)
def get_detailed_result(attempt_id: int, current_user: User = Depends(get_verified_user), db: Session = Depends(get_db)):
    attempt = db.query(TestAttempt).filter(
        TestAttempt.id == attempt_id,
        TestAttempt.user_id == current_user.id
    ).first()
    
    if not attempt:
        raise HTTPException(status_code=404, detail="Test attempt not found")
        
    test = db.query(Test).filter(Test.id == attempt.test_id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Associated test not found")
        
    # Get all questions
    questions = db.query(Question).filter(Question.test_id == test.id).order_by(Question.order_index).all()
    
    # Get all answers for this attempt
    answers = db.query(TestAnswer).filter(TestAnswer.attempt_id == attempt.id).all()
    answer_map = {ans.question_id: ans for ans in answers}
    
    correct_count = 0
    detailed_answers = []
    
    for q in questions:
        ans = answer_map.get(q.id)
        selected_opt_id = ans.selected_option_id if ans else None
        is_correct = ans.is_correct if ans else False
        
        if is_correct:
            correct_count += 1
            
        correct_option = next((opt for opt in q.options if opt.is_correct), None)
        correct_option_id = correct_option.id if correct_option else 0
        
        options_out = [
            QuestionOptionOut(id=opt.id, label=opt.label, text=opt.text)
            for opt in q.options
        ]
        
        detailed_answers.append(
            DetailedAnswerOut(
                question_id=q.id,
                question_text=q.text,
                selected_option_id=selected_opt_id,
                correct_option_id=correct_option_id,
                is_correct=is_correct,
                options=options_out
            )
        )
        
    return DetailedResultResponse(
        attempt=TestAttemptOut(
            id=attempt.id,
            test_id=attempt.test_id,
            attempt_number=attempt.attempt_number,
            started_at=attempt.started_at,
            submitted_at=attempt.submitted_at,
            score=attempt.score,
            total_marks=attempt.total_marks,
            is_passed=attempt.is_passed,
            time_used_seconds=attempt.time_used_seconds
        ),
        test_title=test.title,
        passing_score_pct=test.passing_score_pct,
        correct_count=correct_count,
        total_questions=len(questions),
        answers=detailed_answers
    )
