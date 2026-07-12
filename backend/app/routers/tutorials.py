from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from app.database import get_db
from app.models import (
    Stage, Tutorial, TutorialQuestion, TutorialQuestionOption, TutorialQuizResponse,
    UserTutorialProgress, Test, TestAttempt, Notification, User,
)
from app.schemas import (
    StageOut, StageTestInfo, TutorialOut, TutorialProgressUpdate,
    TutorialQuizOut, TutorialQuizQuestionOut, TutorialQuizOptionOut,
    TutorialQuizSubmitRequest, TutorialQuizSubmitResponse,
)
from app.dependencies import get_verified_user
from app.flow import test_eligibility, test_lock_state
from app.timeutils import to_utc

router = APIRouter(prefix="/api", tags=["tutorials"])

# A video counts as fully watched once this share of it has actually played.
WATCH_COMPLETE_PCT = 90.0
# A player-reported duration below this is treated as untrustworthy (forged to farm
# instant completion) and ignored in favour of the clip range / admin metadata.
MIN_TRUSTWORTHY_DURATION = 3.0
# Cap a single heartbeat's contribution. Real beats are ~10s apart; this tolerates a
# missed beat or two but blocks a single request from claiming a whole video watched.
MAX_BEAT_SECONDS = 30.0


def _quiz_available(db: Session, tutorial: Tutorial, stage: Stage) -> bool:
    if not (stage.quiz_enabled and tutorial.quiz_enabled):
        return False
    return db.query(TutorialQuestion).filter(
        TutorialQuestion.tutorial_id == tutorial.id
    ).count() > 0


def _effective_duration_seconds(tutorial: Tutorial, progress: Optional[UserTutorialProgress]) -> float:
    """
    Completion denominator = the video's real length. We prefer the player-reported
    duration (the only source that knows the actual clip length, since admin
    duration_minutes is often just an estimate), but ignore an implausibly small
    reported value so a forged `duration_seconds` can't create instant completion —
    falling back to the clip range, then the admin estimate. A non-positive clip range
    (end_seconds defaults to 0 = "no clip") is treated as absent, not as 1 second.
    """
    clip = None
    if tutorial.end_seconds and tutorial.end_seconds > (tutorial.start_seconds or 0):
        clip = tutorial.end_seconds - (tutorial.start_seconds or 0)
    reported = progress.video_duration_seconds if progress else None
    if reported and reported >= MIN_TRUSTWORTHY_DURATION:
        return float(min(reported, clip) if clip else reported)
    if clip:
        return float(clip)
    if tutorial.duration_minutes:
        return float(tutorial.duration_minutes * 60)
    return 1.0


def _get_or_create_progress(db: Session, user_id: int, tutorial_id: int) -> UserTutorialProgress:
    progress = db.query(UserTutorialProgress).filter(
        UserTutorialProgress.user_id == user_id,
        UserTutorialProgress.tutorial_id == tutorial_id,
    ).first()
    if not progress:
        progress = UserTutorialProgress(user_id=user_id, tutorial_id=tutorial_id)
        db.add(progress)
        try:
            db.flush()
        except IntegrityError:
            # Concurrent create (video-end flush + complete): reuse the winning row.
            db.rollback()
            progress = db.query(UserTutorialProgress).filter(
                UserTutorialProgress.user_id == user_id,
                UserTutorialProgress.tutorial_id == tutorial_id,
            ).first()
    return progress


def _get_district_tutorial_or_404(db: Session, user: User, tutorial_id: int) -> Tutorial:
    """Fetch a tutorial, ensuring it belongs to the caller's program district."""
    tutorial = db.query(Tutorial).filter(Tutorial.id == tutorial_id).first()
    if not tutorial:
        raise HTTPException(status_code=404, detail="Tutorial not found")
    stage = db.query(Stage).filter(Stage.id == tutorial.stage_id).first()
    if not stage or stage.program_district_id != user.program_district_id:
        # Don't leak other districts' content or accept cross-district writes.
        raise HTTPException(status_code=404, detail="Tutorial not found")
    return tutorial


def _mark_completed(db: Session, user: User, tutorial: Tutorial, progress: UserTutorialProgress) -> bool:
    """Set completed once; returns True on the pending->completed transition."""
    if progress.is_completed:
        return False
    progress.is_completed = True
    progress.completed_at = datetime.utcnow()
    db.add(Notification(
        user_id=user.id,
        title="Tutorial Completed",
        message=f"You have successfully completed the tutorial: '{tutorial.title}'.",
    ))
    return True


@router.get("/stages", response_model=List[StageOut])
def get_stages(current_user: User = Depends(get_verified_user), db: Session = Depends(get_db)):
    if not current_user.program_district_id:
        return []

    stages = db.query(Stage).filter(
        Stage.program_district_id == current_user.program_district_id
    ).order_by(Stage.order_index).all()

    progress_rows = db.query(UserTutorialProgress).filter(
        UserTutorialProgress.user_id == current_user.id
    ).all()
    progress_by_tutorial = {p.tutorial_id: p for p in progress_rows}

    response_stages = []
    for stage in stages:
        tutorials = db.query(Tutorial).filter(
            Tutorial.stage_id == stage.id
        ).order_by(Tutorial.order_index).all()

        stage_tutorials_out = []
        tutorials_completed_count = 0
        for t in tutorials:
            p = progress_by_tutorial.get(t.id)
            is_completed = bool(p and p.is_completed)
            if is_completed:
                tutorials_completed_count += 1
            stage_tutorials_out.append(TutorialOut(
                id=t.id, stage_id=t.stage_id, title=t.title, description=t.description,
                module_number=t.module_number, duration_minutes=t.duration_minutes,
                video_url=t.video_url, youtube_url=t.youtube_url,
                start_seconds=t.start_seconds, end_seconds=t.end_seconds,
                gradient_colors=t.gradient_colors, order_index=t.order_index,
                is_completed=is_completed,
                watch_pct=p.watch_pct if p else 0,
                watch_time_seconds=p.watch_time_seconds if p else 0,
                last_position_seconds=p.last_position_seconds if p else 0,
                quiz_available=_quiz_available(db, t, stage),
                quiz_status=p.quiz_status if p else "pending",
                quiz_score=p.quiz_score if p else None,
                quiz_total=p.quiz_total if p else None,
            ))

        # Test-phase info + lock state. Tutorial phases are never locked (users
        # may pre-watch add-on videos); test phases lock on eligibility.
        test_info = None
        is_locked = False
        test = db.query(Test).filter(Test.stage_id == stage.id).first()
        if test:
            attempts = db.query(TestAttempt).filter(
                TestAttempt.user_id == current_user.id,
                TestAttempt.test_id == test.id,
                TestAttempt.submitted_at.isnot(None),
            ).all()
            locked, _reason = test_lock_state(db, current_user, test)
            is_locked = locked
            # Distinguish "must finish videos" from "admin hasn't started it yet".
            eligible, _missing = test_eligibility(db, current_user, test)
            test_info = StageTestInfo(
                id=test.id, title=test.title, status=test.status,
                test_type=test.test_type, scheduled_at=to_utc(test.scheduled_at),
                duration_minutes=test.duration_minutes,
                attempts_count=len(attempts),
                is_passed=any(a.is_passed for a in attempts),
                is_submitted=len(attempts) > 0,
                is_locked=locked,
                needs_videos=not eligible,
            )

        response_stages.append(StageOut(
            id=stage.id, program_district_id=stage.program_district_id,
            title=stage.title, description=stage.description,
            order_index=stage.order_index, stage_type=stage.stage_type,
            quiz_enabled=stage.quiz_enabled, is_locked=is_locked,
            tutorials_completed=tutorials_completed_count,
            total_tutorials=len(tutorials), tutorials=stage_tutorials_out,
            test=test_info,
        ))

    return response_stages


@router.post("/tutorials/{id}/progress")
def update_tutorial_progress(
    id: int,
    update: TutorialProgressUpdate,
    current_user: User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    """Watch-tracking heartbeat sent by the player while the video plays."""
    tutorial = _get_district_tutorial_or_404(db, current_user, id)
    stage = db.query(Stage).filter(Stage.id == tutorial.stage_id).first()

    progress = _get_or_create_progress(db, current_user.id, id)
    if update.duration_seconds:
        progress.video_duration_seconds = update.duration_seconds
    delta = min(update.watched_delta_seconds, MAX_BEAT_SECONDS)
    progress.watch_time_seconds = (progress.watch_time_seconds or 0) + delta
    progress.last_position_seconds = update.position_seconds

    duration = _effective_duration_seconds(tutorial, progress)
    progress.watch_pct = min(100.0, round(progress.watch_time_seconds / duration * 100, 1))

    if progress.watch_pct >= WATCH_COMPLETE_PCT:
        _mark_completed(db, current_user, tutorial, progress)

    db.commit()
    return {
        "tutorial_id": id,
        "watch_time_seconds": progress.watch_time_seconds,
        "watch_pct": progress.watch_pct,
        "is_completed": progress.is_completed,
        "quiz_available": _quiz_available(db, tutorial, stage) if stage else False,
        "quiz_status": progress.quiz_status,
    }


@router.post("/tutorials/{id}/complete")
def complete_tutorial(
    id: int,
    current_user: User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    tutorial = _get_district_tutorial_or_404(db, current_user, id)
    stage = db.query(Stage).filter(Stage.id == tutorial.stage_id).first()

    progress = _get_or_create_progress(db, current_user.id, id)
    _mark_completed(db, current_user, tutorial, progress)
    db.commit()

    return {
        "message": "Tutorial marked as completed",
        "completed_at": progress.completed_at,
        "quiz_available": _quiz_available(db, tutorial, stage) if stage else False,
        "quiz_status": progress.quiz_status,
    }


@router.get("/tutorials/{id}/quiz", response_model=TutorialQuizOut)
def get_tutorial_quiz(
    id: int,
    current_user: User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    tutorial = _get_district_tutorial_or_404(db, current_user, id)
    stage = db.query(Stage).filter(Stage.id == tutorial.stage_id).first()

    if not stage or not _quiz_available(db, tutorial, stage):
        return TutorialQuizOut(tutorial_id=id, quiz_available=False, questions=[])

    questions = db.query(TutorialQuestion).filter(
        TutorialQuestion.tutorial_id == id
    ).order_by(TutorialQuestion.order_index).all()

    return TutorialQuizOut(
        tutorial_id=id,
        quiz_available=True,
        questions=[
            TutorialQuizQuestionOut(
                id=q.id, text=q.text, order_index=q.order_index,
                options=[
                    TutorialQuizOptionOut(id=o.id, label=o.label, text=o.text)
                    for o in q.options
                ],
            )
            for q in questions
        ],
    )


@router.post("/tutorials/{id}/quiz/submit", response_model=TutorialQuizSubmitResponse)
def submit_tutorial_quiz(
    id: int,
    submission: TutorialQuizSubmitRequest,
    current_user: User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    tutorial = _get_district_tutorial_or_404(db, current_user, id)

    questions = db.query(TutorialQuestion).filter(
        TutorialQuestion.tutorial_id == id
    ).order_by(TutorialQuestion.order_index).all()
    if not questions:
        raise HTTPException(status_code=400, detail="This tutorial has no quiz questions")

    # Re-submission replaces previous responses (popup normally shows once).
    db.query(TutorialQuizResponse).filter(
        TutorialQuizResponse.user_id == current_user.id,
        TutorialQuizResponse.tutorial_id == id,
    ).delete()

    answers_by_question = {a.question_id: a for a in submission.answers}
    correct_count = 0
    for q in questions:
        valid_option_ids = {o.id for o in q.options}
        answer = answers_by_question.get(q.id)
        selected_option_id = answer.selected_option_id if answer else None
        # Ignore a selection that doesn't belong to this question (stale ids after
        # an admin edit, or tampering) — never write a dangling FK.
        if selected_option_id not in valid_option_ids:
            selected_option_id = None
        correct_option = next((o for o in q.options if o.is_correct), None)
        is_correct = bool(
            selected_option_id and correct_option and selected_option_id == correct_option.id
        )
        if is_correct:
            correct_count += 1
        db.add(TutorialQuizResponse(
            user_id=current_user.id, tutorial_id=id, question_id=q.id,
            selected_option_id=selected_option_id, is_correct=is_correct,
        ))

    progress = _get_or_create_progress(db, current_user.id, id)
    progress.quiz_status = "completed"
    progress.quiz_score = correct_count
    progress.quiz_total = len(questions)
    db.commit()

    return TutorialQuizSubmitResponse(
        tutorial_id=id,
        correct_count=correct_count,
        total_questions=len(questions),
        score_pct=round(correct_count / len(questions) * 100, 1),
    )


@router.post("/tutorials/{id}/quiz/skip")
def skip_tutorial_quiz(
    id: int,
    current_user: User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    _get_district_tutorial_or_404(db, current_user, id)

    progress = _get_or_create_progress(db, current_user.id, id)
    # Skipping never downgrades a completed quiz.
    if progress.quiz_status != "completed":
        progress.quiz_status = "skipped"
    db.commit()
    return {"tutorial_id": id, "quiz_status": progress.quiz_status}
