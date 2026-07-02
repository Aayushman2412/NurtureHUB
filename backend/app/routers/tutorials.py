from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
from app.database import get_db
from app.models import Stage, Tutorial, UserTutorialProgress, Test, TestAttempt, Notification
from app.schemas import StageOut, TutorialOut
from app.dependencies import get_current_user
from app.models import User

router = APIRouter(prefix="/api", tags=["tutorials"])

@router.get("/stages", response_model=List[StageOut])
def get_stages(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Filter stages by the user's program district
    query = db.query(Stage)
    if current_user.program_district_id:
        query = query.filter(Stage.program_district_id == current_user.program_district_id)
    else:
        # Users without a district see no stages
        return []

    stages = query.order_by(Stage.order_index).all()
    
    # Get user completed tutorial IDs
    completed_progress = db.query(UserTutorialProgress).filter(
        UserTutorialProgress.user_id == current_user.id,
        UserTutorialProgress.is_completed == True
    ).all()
    completed_tutorial_ids = {p.tutorial_id for p in completed_progress}
    
    # Get all test attempts to check passing status for stages
    attempts = db.query(TestAttempt).filter(
        TestAttempt.user_id == current_user.id,
        TestAttempt.is_passed == True
    ).all()
    
    # Check which stages are passed
    # A stage is passed if the test for that stage is passed
    passed_stage_ids = set()
    for attempt in attempts:
        test = db.query(Test).filter(Test.id == attempt.test_id).first()
        if test:
            passed_stage_ids.add(test.stage_id)
            
    response_stages = []
    
    for i, stage in enumerate(stages):
        # Determine if locked
        # First stage (order_index == 0) is always unlocked
        if i == 0:
            is_locked = False
        else:
            # Unlocked if previous stage was passed
            prev_stage = stages[i - 1]
            # Check if there was a test for prev_stage, and if that test has been passed
            prev_test = db.query(Test).filter(Test.stage_id == prev_stage.id).first()
            if prev_test:
                is_locked = prev_test.id not in {att.test_id for att in attempts}
            else:
                # If no test, previous stage is assumed passed if all its tutorials are completed
                prev_tutorials = db.query(Tutorial).filter(Tutorial.stage_id == prev_stage.id).all()
                if not prev_tutorials:
                    is_locked = False
                else:
                    prev_completed = [t.id for t in prev_tutorials if t.id in completed_tutorial_ids]
                    is_locked = len(prev_completed) < len(prev_tutorials)
                    
        # Get tutorials for this stage
        tutorials = db.query(Tutorial).filter(Tutorial.stage_id == stage.id).order_by(Tutorial.order_index).all()
        
        stage_tutorials_out = []
        tutorials_completed_count = 0
        
        for t in tutorials:
            is_completed = t.id in completed_tutorial_ids
            if is_completed:
                tutorials_completed_count += 1
                
            stage_tutorials_out.append(
                TutorialOut(
                    id=t.id,
                    stage_id=t.stage_id,
                    title=t.title,
                    description=t.description,
                    module_number=t.module_number,
                    duration_minutes=t.duration_minutes,
                    video_url=t.video_url,
                    gradient_colors=t.gradient_colors,
                    order_index=t.order_index,
                    is_completed=is_completed
                )
            )
            
        response_stages.append(
            StageOut(
                id=stage.id,
                program_district_id=stage.program_district_id,
                title=stage.title,
                description=stage.description,
                order_index=stage.order_index,
                is_locked=is_locked,
                tutorials_completed=tutorials_completed_count,
                total_tutorials=len(tutorials),
                tutorials=stage_tutorials_out
            )
        )
        
    return response_stages

@router.post("/tutorials/{id}/complete")
def complete_tutorial(
    id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    tutorial = db.query(Tutorial).filter(Tutorial.id == id).first()
    if not tutorial:
        raise HTTPException(status_code=404, detail="Tutorial not found")
        
    progress = db.query(UserTutorialProgress).filter(
        UserTutorialProgress.user_id == current_user.id,
        UserTutorialProgress.tutorial_id == id
    ).first()
    
    if not progress:
        progress = UserTutorialProgress(
            user_id=current_user.id,
            tutorial_id=id,
            is_completed=True,
            completed_at=datetime.utcnow()
        )
        db.add(progress)
    else:
        if not progress.is_completed:
            progress.is_completed = True
            progress.completed_at = datetime.utcnow()
            
    # Add a notification
    notification = Notification(
        user_id=current_user.id,
        title="Tutorial Completed",
        message=f"You have successfully completed the tutorial: '{tutorial.title}'."
    )
    db.add(notification)
    
    db.commit()
    
    return {"message": "Tutorial marked as completed", "completed_at": progress.completed_at}
