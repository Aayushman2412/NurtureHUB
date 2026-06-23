from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, date

# Auth Schemas
class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class GoogleLoginRequest(BaseModel):
    id_token: str

class OTPVerify(BaseModel):
    email: EmailStr
    code: str

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class Token(BaseModel):
    access_token: str
    token_type: str
    is_verified: bool
    is_profile_complete: bool

# Profile Schema
class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    age: Optional[int] = None
    date_of_birth: Optional[date] = None
    sex: Optional[str] = None
    phone: Optional[str] = None
    department: Optional[str] = None
    role: Optional[str] = None
    work_center_type: Optional[str] = None
    work_center_name: Optional[str] = None
    district: Optional[str] = None
    avatar_initials: Optional[str] = None

class UserOut(BaseModel):
    id: int
    email: str
    full_name: Optional[str] = None
    age: Optional[int] = None
    date_of_birth: Optional[date] = None
    sex: Optional[str] = None
    phone: Optional[str] = None
    department: Optional[str] = None
    role: Optional[str] = None
    work_center_type: Optional[str] = None
    work_center_name: Optional[str] = None
    district: Optional[str] = None
    avatar_initials: Optional[str] = None
    is_verified: bool
    created_at: datetime

    class Config:
        from_attributes = True

# Tutorial Schemas
class TutorialProgressOut(BaseModel):
    is_completed: bool
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class TutorialOut(BaseModel):
    id: int
    stage_id: int
    title: str
    description: Optional[str] = None
    module_number: Optional[str] = None
    duration_minutes: int
    video_url: Optional[str] = None
    gradient_colors: Optional[str] = None
    order_index: int
    is_completed: bool = False

    class Config:
        from_attributes = True

class StageOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    order_index: int
    is_locked: bool = True
    tutorials_completed: int = 0
    total_tutorials: int = 0
    tutorials: List[TutorialOut] = []

    class Config:
        from_attributes = True

# Test Schemas
class QuestionOptionOut(BaseModel):
    id: int
    label: str
    text: str

    class Config:
        from_attributes = True

class QuestionOut(BaseModel):
    id: int
    text: str
    marks: int
    order_index: int
    options: List[QuestionOptionOut]

    class Config:
        from_attributes = True

class TestOut(BaseModel):
    id: int
    stage_id: int
    title: str
    description: Optional[str] = None
    total_questions: int
    duration_minutes: int
    passing_score_pct: int
    max_attempts: int
    is_locked: bool = True
    best_score: Optional[float] = None
    attempts_count: int = 0
    is_passed: bool = False

    class Config:
        from_attributes = True

class TestAttemptOut(BaseModel):
    id: int
    test_id: int
    attempt_number: int
    started_at: datetime
    submitted_at: Optional[datetime] = None
    score: Optional[float] = None
    total_marks: Optional[float] = None
    is_passed: bool
    time_used_seconds: Optional[int] = None

    class Config:
        from_attributes = True

class StartAttemptResponse(BaseModel):
    attempt_id: int
    duration_minutes: int
    questions: List[QuestionOut]

class AnswerSubmit(BaseModel):
    question_id: int
    selected_option_id: Optional[int] = None
    is_marked_for_review: bool = False

class TestSubmitRequest(BaseModel):
    answers: List[AnswerSubmit]
    time_used_seconds: int

class TestSubmitResponse(BaseModel):
    attempt_id: int
    score: float
    total_marks: float
    is_passed: bool
    correct_answers_count: int
    total_questions: int

class DetailedAnswerOut(BaseModel):
    question_id: int
    question_text: str
    selected_option_id: Optional[int]
    correct_option_id: int
    is_correct: bool
    options: List[QuestionOptionOut]

class DetailedResultResponse(BaseModel):
    attempt: TestAttemptOut
    test_title: str
    passing_score_pct: int
    correct_count: int
    total_questions: int
    answers: List[DetailedAnswerOut]

# Dashboard Schemas
class DashboardActivity(BaseModel):
    id: str
    type: str # 'tutorial' or 'test'
    title: str
    timestamp: datetime
    status: str # e.g. 'Completed', 'Passed', 'Failed'

class AchievementOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    emoji_icon: Optional[str] = None
    earned_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class DashboardData(BaseModel):
    progress_percentage: float
    tutorials_completed: int
    total_tutorials: int
    tests_passed: int
    total_tests: int
    achievements: List[AchievementOut]
    activities: List[DashboardActivity]
    stages: List[StageOut]

# Notification Schemas
class NotificationOut(BaseModel):
    id: int
    title: str
    message: str
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True
