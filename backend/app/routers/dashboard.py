from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import Stage, Tutorial, UserTutorialProgress, Test, TestAttempt, UserAchievement, Achievement
from app.schemas import DashboardData, DashboardActivity, AchievementOut
from app.dependencies import get_current_user
from app.models import User
from app.routers.tutorials import get_stages

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

@router.get("", response_model=DashboardData)
def get_dashboard_data(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Scope all queries to the user's program district
    district_id = current_user.program_district_id

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
    
    return DashboardData(
        progress_percentage=progress_pct,
        tutorials_completed=completed_tutorials,
        total_tutorials=total_tutorials,
        tests_passed=passed_tests,
        total_tests=total_tests,
        achievements=achievements_out,
        activities=activities,
        stages=stages_out
    )
