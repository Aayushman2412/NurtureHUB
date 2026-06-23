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
    # 1. Calculate overall progress metrics
    total_tutorials = db.query(Tutorial).count()
    completed_tutorials = db.query(UserTutorialProgress).filter(
        UserTutorialProgress.user_id == current_user.id,
        UserTutorialProgress.is_completed == True
    ).count()
    
    total_tests = db.query(Test).count()
    passed_tests = db.query(TestAttempt).filter(
        TestAttempt.user_id == current_user.id,
        TestAttempt.is_passed == True
    ).distinct(TestAttempt.test_id).count()
    
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
    
    # 3. Compile activities list
    activities = []
    
    # Fetch tutorial progress items for activity feed
    tutorial_progress_list = db.query(UserTutorialProgress).filter(
        UserTutorialProgress.user_id == current_user.id,
        UserTutorialProgress.is_completed == True
    ).order_by(UserTutorialProgress.completed_at.desc()).limit(5).all()
    
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
    test_attempts_list = db.query(TestAttempt).filter(
        TestAttempt.user_id == current_user.id,
        TestAttempt.submitted_at.isnot(None)
    ).order_by(TestAttempt.submitted_at.desc()).limit(5).all()
    
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
    
    # 4. Get stages and tutorials using our existing endpoint logic
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
