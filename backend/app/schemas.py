import re
from pydantic import BaseModel, EmailStr, Field, model_validator, field_validator
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
    department_id: Optional[int] = None
    order_index: int = 0

    class Config:
        from_attributes = True


class DepartmentOut(BaseModel):
    id: int
    code: str
    name: str
    order_index: int

    class Config:
        from_attributes = True


class DesignationOut(BaseModel):
    id: int
    department_id: int
    name: str
    order_index: int
    is_other: bool

    class Config:
        from_attributes = True


class FacilityTypeOut(BaseModel):
    id: int
    name: str
    order_index: int
    is_other: bool

    class Config:
        from_attributes = True


# ── Mother Registration metadata ──

class HWCOut(BaseModel):
    id: int
    name: str
    block_id: Optional[int] = None
    phc_id: Optional[int] = None

    class Config:
        from_attributes = True


class PHCOut(BaseModel):
    id: int
    name: str
    block_id: Optional[int] = None

    class Config:
        from_attributes = True


class MotherEducationLevelOut(BaseModel):
    id: int
    name: str
    order_index: int
    requires_field: bool

    class Config:
        from_attributes = True


class EducationFieldOut(BaseModel):
    id: int
    name: str
    order_index: int

    class Config:
        from_attributes = True


class EducationDegreeOut(BaseModel):
    id: int
    field_id: int
    name: str
    order_index: int

    class Config:
        from_attributes = True


# ── Mother Registration record ──

class MotherSourceRatingIn(BaseModel):
    source: str
    trust: Optional[int] = Field(default=None, ge=1, le=5)
    willingness: Optional[int] = Field(default=None, ge=1, le=5)


class MotherSourceRatingOut(MotherSourceRatingIn):
    class Config:
        from_attributes = True


def _digits(v: str) -> str:
    return re.sub(r"\D", "", v or "")


class MotherBase(BaseModel):
    mother_name: str = Field(min_length=2)
    adoption_date: Optional[date] = None
    mother_dob: Optional[date] = None
    mother_age: Optional[int] = Field(default=None, ge=10, le=50)
    weight: Optional[float] = Field(default=None, ge=35.0, le=200.0)
    height: Optional[float] = Field(default=None, ge=100.0, le=230.0)
    lmp: Optional[date] = None
    edd_records: Optional[date] = None
    mobile: Optional[str] = None
    alternate_mobile: Optional[str] = None
    email: Optional[EmailStr] = None
    state_id: Optional[int] = None
    district_id: Optional[int] = None
    taluk_id: Optional[int] = None
    village: Optional[str] = None
    hwc_id: Optional[int] = None
    phc_id: Optional[int] = None
    education_id: Optional[int] = None
    education_field_id: Optional[int] = None
    education_degree_id: Optional[int] = None
    occupation: Optional[str] = None
    occupation_other: Optional[str] = None
    ration_card: Optional[str] = None
    social_category: Optional[str] = None
    nutrition_course: Optional[bool] = None
    nutrition_course_name: Optional[str] = None
    video_frequency: Optional[str] = None
    implement_video: Optional[str] = None
    confidence_video: Optional[str] = None
    willingness_hcw: Optional[str] = None
    information_seeking: Optional[str] = None
    source_ratings: List[MotherSourceRatingIn] = []

    @field_validator("mobile", "alternate_mobile")
    @classmethod
    def _ten_digits(cls, v):
        if v and len(_digits(v)) != 10:
            raise ValueError("Mobile number must be exactly 10 digits.")
        return v

    @model_validator(mode="after")
    def _check(self):
        today = date.today()
        if self.mother_dob and self.mother_dob > today:
            raise ValueError("Date of birth cannot be in the future.")
        if self.adoption_date and self.adoption_date > today:
            raise ValueError("Adoption date cannot be in the future.")
        if self.lmp:
            if self.lmp > today:
                raise ValueError("LMP cannot be in the future.")
            if (today - self.lmp).days > 180:
                raise ValueError("LMP cannot be more than 180 days before today.")
        if self.mobile and self.alternate_mobile and _digits(self.mobile) == _digits(self.alternate_mobile):
            raise ValueError("Alternate mobile must be different from the primary mobile.")
        return self


class MotherCreate(MotherBase):
    pass


class MotherOut(MotherBase):
    id: int
    mother_uid: str
    registered_by_user_id: Optional[int] = None
    created_at: datetime
    edd_lmp: Optional[date] = None
    gestational_weeks: Optional[int] = None    # derived from LMP
    gestational_months: Optional[int] = None   # derived from LMP
    source_ratings: List[MotherSourceRatingOut] = []
    hwc: Optional[HWCOut] = None
    phc: Optional[PHCOut] = None
    education: Optional[MotherEducationLevelOut] = None
    education_field: Optional[EducationFieldOut] = None
    education_degree: Optional[EducationDegreeOut] = None

    class Config:
        from_attributes = True


class MotherListItem(BaseModel):
    """Compact row for the 'My Mothers' list."""
    id: int
    mother_uid: str
    mother_name: str
    village: Optional[str] = None
    edd_records: Optional[date] = None
    gestational_weeks: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


# --- Child Registration (CR) ---

class ChildBirthConditionIn(BaseModel):
    condition: str


class ChildBirthConditionOut(ChildBirthConditionIn):
    class Config:
        from_attributes = True


class ChildBase(BaseModel):
    babies_born: Optional[str] = None
    adoption_date: Optional[date] = None
    child_name: str = Field(min_length=2)
    dob: Optional[date] = None
    birth_weight: Optional[float] = Field(default=None, ge=1.0, le=5.0)
    birth_length: Optional[float] = Field(default=None, ge=30.0, le=65.0)
    sex: Optional[str] = None
    previous_living_children: Optional[int] = Field(default=None, ge=0, le=10)
    delivery_method: Optional[str] = None
    delivery_place: Optional[str] = None
    delivery_place_other: Optional[str] = None
    bf_within_one_hour: Optional[bool] = None
    ebf_during_stay: Optional[bool] = None
    ebf_reason: Optional[str] = None
    pre_existing_other: Optional[str] = None
    birth_conditions: List[ChildBirthConditionIn] = []

    @model_validator(mode="after")
    def _check(self):
        today = date.today()
        if self.dob:
            if self.dob > today:
                raise ValueError("Date of birth cannot be in the future.")
            if (today - self.dob).days > 365:
                raise ValueError("Date of birth cannot be more than 365 days before today.")
        if self.adoption_date:
            if self.adoption_date > today:
                raise ValueError("Adoption date cannot be in the future.")
            if (today - self.adoption_date).days > 14:
                raise ValueError("Adoption date cannot be more than 14 days before today.")
        return self


class ChildCreate(ChildBase):
    pass


class ChildOut(ChildBase):
    id: int
    child_uid: str
    mother_id: int
    created_at: datetime
    age_days: Optional[int] = None       # derived from DOB
    age_months: Optional[int] = None     # derived from DOB
    birth_conditions: List[ChildBirthConditionOut] = []

    class Config:
        from_attributes = True


class ChildListItem(BaseModel):
    """Compact row for a mother's children list."""
    id: int
    child_uid: str
    child_name: str
    sex: Optional[str] = None
    dob: Optional[date] = None
    birth_weight: Optional[float] = None
    age_months: Optional[int] = None
    created_at: datetime

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

    # ── Learner Registration: professional-axis FKs + extension fields ──
    department_id: Optional[int] = None
    designation_id: Optional[int] = None
    facility_type_id: Optional[int] = None
    department_other: Optional[str] = None
    marital_status: Optional[str] = None
    has_children: Optional[bool] = None
    number_children: Optional[int] = Field(default=None, ge=0, le=30)
    residence_distance_km: Optional[float] = Field(default=None, ge=0, le=100)
    years_service: Optional[float] = Field(default=None, ge=0, le=50)
    years_designation: Optional[float] = Field(default=None, ge=0, le=50)
    years_facility: Optional[float] = Field(default=None, ge=0, le=50)
    internet_workplace: Optional[str] = None
    nutrition_training: Optional[str] = None
    pregnancy_nutrition_training: Optional[str] = None
    breastfeeding_training: Optional[str] = None
    complementary_feeding_training: Optional[str] = None
    growth_monitoring_training: Optional[str] = None

    @model_validator(mode="after")
    def _check_year_consistency(self):
        # Cross-field checks only when both operands are present in this payload
        # (partial profile edits may send one without the other).
        if self.years_service is not None:
            if self.years_designation is not None and self.years_designation > self.years_service:
                raise ValueError("Years in current designation cannot exceed total years of service.")
            if self.years_facility is not None and self.years_facility > self.years_service:
                raise ValueError("Years at current facility cannot exceed total years of service.")
        return self

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

    # ── Learner Registration: professional-axis FKs + extension fields ──
    department_id: Optional[int] = None
    designation_id: Optional[int] = None
    facility_type_id: Optional[int] = None
    department_other: Optional[str] = None
    marital_status: Optional[str] = None
    has_children: Optional[bool] = None
    number_children: Optional[int] = None
    residence_distance_km: Optional[float] = None
    years_service: Optional[float] = None
    years_designation: Optional[float] = None
    years_facility: Optional[float] = None
    internet_workplace: Optional[str] = None
    nutrition_training: Optional[str] = None
    pregnancy_nutrition_training: Optional[str] = None
    breastfeeding_training: Optional[str] = None
    complementary_feeding_training: Optional[str] = None
    growth_monitoring_training: Optional[str] = None

    # Nested relations (lazy loaded via ORM)
    state: Optional[StateOut] = None
    district_rel: Optional[DistrictOut] = None
    block: Optional[BlockOut] = None
    village: Optional[VillageOut] = None
    facility: Optional[FacilityOut] = None
    qualification: Optional[EducationalQualificationOut] = None
    experience_range: Optional[ExperienceRangeOut] = None
    department_ref: Optional[DepartmentOut] = None
    designation_rel: Optional[DesignationOut] = None
    facility_type_rel: Optional[FacilityTypeOut] = None
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
