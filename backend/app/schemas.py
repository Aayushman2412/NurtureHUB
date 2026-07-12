from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, date

# Metadata Schemas
class StateOut(BaseModel):
    id: int
    name: str
    is_active: bool

    class Config:
        from_attributes = True


class DistrictOut(BaseModel):
    id: int
    state_id: int
    name: str

    class Config:
        from_attributes = True


class BlockOut(BaseModel):
    id: int
    district_id: int
    name: str

    class Config:
        from_attributes = True


class VillageOut(BaseModel):
    id: int
    block_id: int
    name: str

    class Config:
        from_attributes = True


class FacilityOut(BaseModel):
    id: int
    block_id: int
    name: str
    facility_type: str

    class Config:
        from_attributes = True


class EducationalQualificationOut(BaseModel):
    id: int
    qualification_name: str
    has_semi_open_input: bool

    class Config:
        from_attributes = True


class ExperienceRangeOut(BaseModel):
    id: int
    label: str
    order_index: int

    class Config:
        from_attributes = True


class ProgramDistrictOut(BaseModel):
    id: int
    name: str
    slug: str
    is_active: bool

    class Config:
        from_attributes = True


class ProgramDistrictCreate(BaseModel):
    name: str

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
    gender: Optional[str] = None
    phone: Optional[str] = None
    alternate_phone: Optional[str] = None
    state_id: Optional[int] = None
    district_id: Optional[int] = None
    block_id: Optional[int] = None
    village_id: Optional[int] = None
    facility_id: Optional[int] = None
    qualification_id: Optional[int] = None
    experience_range_id: Optional[int] = None
    qualification_other_detail: Optional[str] = None
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
    gender: Optional[str] = None
    phone: Optional[str] = None
    alternate_phone: Optional[str] = None
    state_id: Optional[int] = None
    district_id: Optional[int] = None
    block_id: Optional[int] = None
    village_id: Optional[int] = None
    facility_id: Optional[int] = None
    qualification_id: Optional[int] = None
    experience_range_id: Optional[int] = None
    qualification_other_detail: Optional[str] = None
    department: Optional[str] = None
    role: Optional[str] = None
    work_center_type: Optional[str] = None
    work_center_name: Optional[str] = None
    district: Optional[str] = None
    avatar_initials: Optional[str] = None
    is_verified: bool
    program_district_id: Optional[int] = None
    created_at: datetime

    # Nested relations (lazy loaded via ORM)
    state: Optional[StateOut] = None
    district_rel: Optional[DistrictOut] = None
    block: Optional[BlockOut] = None
    village: Optional[VillageOut] = None
    facility: Optional[FacilityOut] = None
    qualification: Optional[EducationalQualificationOut] = None
    experience_range: Optional[ExperienceRangeOut] = None
    program_district: Optional[ProgramDistrictOut] = None

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
    youtube_url: Optional[str] = None
    start_seconds: Optional[int] = None
    end_seconds: Optional[int] = None
    gradient_colors: Optional[str] = None
    order_index: int
    is_completed: bool = False
    # Per-user watch tracking
    watch_pct: float = 0
    watch_time_seconds: float = 0
    last_position_seconds: float = 0
    # Post-tutorial quiz
    quiz_available: bool = False  # enabled (stage+tutorial) and has questions
    quiz_status: str = "pending"  # pending | completed | skipped
    quiz_score: Optional[float] = None
    quiz_total: Optional[int] = None

    class Config:
        from_attributes = True

class StageTestInfo(BaseModel):
    """Summary of the test living in a test-phase stage, for dashboard cards."""
    id: int
    title: str
    status: str
    test_type: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: int = 0
    attempts_count: int = 0
    is_passed: bool = False
    is_submitted: bool = False
    is_locked: bool = False
    # True only when the lock is because required videos aren't done (vs. admin
    # simply not having started the test yet) — lets the dashboard show the right message.
    needs_videos: bool = False

class StageOut(BaseModel):
    id: int
    program_district_id: Optional[int] = None
    title: str
    description: Optional[str] = None
    order_index: int
    stage_type: str = "tutorials"
    quiz_enabled: bool = True
    is_locked: bool = True
    tutorials_completed: int = 0
    total_tutorials: int = 0
    tutorials: List[TutorialOut] = []
    test: Optional[StageTestInfo] = None

    class Config:
        from_attributes = True

# Watch-progress heartbeat sent by the player every few seconds
class TutorialProgressUpdate(BaseModel):
    position_seconds: float = Field(ge=0)
    watched_delta_seconds: float = Field(ge=0, le=120)  # time actually played since last beat
    duration_seconds: Optional[float] = Field(default=None, ge=0)

# Post-tutorial quiz schemas
class TutorialQuizOptionOut(BaseModel):
    id: int
    label: str
    text: str

    class Config:
        from_attributes = True

class TutorialQuizQuestionOut(BaseModel):
    id: int
    text: str
    order_index: int
    options: List[TutorialQuizOptionOut]

    class Config:
        from_attributes = True

class TutorialQuizOut(BaseModel):
    tutorial_id: int
    quiz_available: bool
    questions: List[TutorialQuizQuestionOut] = []

class QuizAnswerSubmit(BaseModel):
    question_id: int
    selected_option_id: Optional[int] = None

class TutorialQuizSubmitRequest(BaseModel):
    answers: List[QuizAnswerSubmit]

class TutorialQuizSubmitResponse(BaseModel):
    tutorial_id: int
    correct_count: int
    total_questions: int
    score_pct: float

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
    status: str = "draft"
    test_type: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    is_locked: bool = True
    lock_reason: Optional[str] = None
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
    # True once every tutorial is completed and every test has been submitted —
    # the user is done and waiting for the admin to publish results.
    awaiting_results: bool = False
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
