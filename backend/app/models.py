from datetime import date
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, ForeignKey, Float, Text, Table, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class ProgramDistrict(Base):
    """Represents a program district — each district gets its own content (stages, tutorials, tests, forms)."""
    __tablename__ = "program_districts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    slug = Column(String, unique=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    users = relationship("User", back_populates="program_district")
    stages = relationship("Stage", back_populates="program_district", cascade="all, delete-orphan")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=True) # Nullable for Google Auth users
    full_name = Column(String, nullable=True)
    age = Column(Integer, nullable=True)
    date_of_birth = Column(Date, nullable=True)
    gender = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    alternate_phone = Column(String, nullable=True)
    state_id = Column(Integer, ForeignKey("states.id"), nullable=True)
    district_id = Column(Integer, ForeignKey("districts.id"), nullable=True)
    block_id = Column(Integer, ForeignKey("blocks.id"), nullable=True)
    village_id = Column(Integer, ForeignKey("villages.id"), nullable=True)
    village_name = Column(String, nullable=True)         # free-text village (when not in the master list)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=True)
    qualification_id = Column(Integer, ForeignKey("educational_qualifications.id"), nullable=True)
    experience_range_id = Column(Integer, ForeignKey("experience_ranges.id"), nullable=True)
    qualification_other_detail = Column(String, nullable=True)
    department = Column(String, nullable=True)          # legacy string, kept for back-compat display
    role = Column(String, nullable=True)                # legacy string (designation name)
    work_center_type = Column(String, nullable=True)    # legacy string (facility type name)
    work_center_name = Column(String, nullable=True)
    district = Column(String, nullable=True)
    avatar_initials = Column(String, nullable=True)

    # ── Learner Registration (LR) professional-axis FKs — master-data backed cascades ──
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    designation_id = Column(Integer, ForeignKey("designations.id"), nullable=True)
    facility_type_id = Column(Integer, ForeignKey("facility_types.id"), nullable=True)

    # ── Learner Registration (LR) extension fields (from EP HST "LR" tool) ──
    department_other = Column(String, nullable=True)          # shown only when department = Other
    marital_status = Column(String, nullable=True)            # Never married;Married;Widowed;Divorced;Separated
    has_children = Column(Boolean, nullable=True)
    number_children = Column(Integer, nullable=True)          # shown only when has_children = True
    residence_distance_km = Column(Float, nullable=True)      # 0–100 km, one decimal
    years_service = Column(Float, nullable=True)              # total years of service (0–50)
    years_designation = Column(Float, nullable=True)          # years in current designation (<= years_service)
    years_facility = Column(Float, nullable=True)             # years at current facility (<= years_service)
    internet_workplace = Column(String, nullable=True)        # Always/Often/Sometimes/Rarely/Never
    nutrition_training = Column(String, nullable=True)        # training-recency questions
    pregnancy_nutrition_training = Column(String, nullable=True)
    breastfeeding_training = Column(String, nullable=True)
    complementary_feeding_training = Column(String, nullable=True)
    growth_monitoring_training = Column(String, nullable=True)
    is_verified = Column(Boolean, default=False, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    otp_code = Column(String, nullable=True)  # stores a bcrypt hash of the OTP, never plaintext
    otp_expires_at = Column(DateTime, nullable=True)
    otp_attempts = Column(Integer, default=0, nullable=False)  # failed verify attempts for the current code
    google_id = Column(String, unique=True, nullable=True)
    program_district_id = Column(Integer, ForeignKey("program_districts.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    state = relationship("State")
    district_rel = relationship("District")
    block = relationship("Block")
    village = relationship("Village")
    facility = relationship("Facility")
    qualification = relationship("EducationalQualification")
    experience_range = relationship("ExperienceRange")
    department_ref = relationship("Department")
    designation_rel = relationship("Designation")
    facility_type_rel = relationship("FacilityType")
    program_district = relationship("ProgramDistrict", back_populates="users")
    tutorial_progress = relationship("UserTutorialProgress", back_populates="user", cascade="all, delete-orphan")
    test_attempts = relationship("TestAttempt", back_populates="user", cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")
    achievements = relationship("UserAchievement", back_populates="user", cascade="all, delete-orphan")


class Stage(Base):
    __tablename__ = "stages"

    id = Column(Integer, primary_key=True, index=True)
    program_district_id = Column(Integer, ForeignKey("program_districts.id", ondelete="CASCADE"), nullable=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    order_index = Column(Integer, nullable=False, default=0)
    # 'tutorials' -> phase of videos (Phase 1 basic / Phase 3 add-on)
    # 'test'      -> phase holding a scheduled test (Phase 2 formative / Phase 4 screening)
    stage_type = Column(String, nullable=False, default="tutorials")
    # Phase-level master switch for post-tutorial quiz popups in this stage
    quiz_enabled = Column(Boolean, default=True, nullable=False)

    # Relationships
    program_district = relationship("ProgramDistrict", back_populates="stages")
    tutorials = relationship("Tutorial", back_populates="stage", cascade="all, delete-orphan")
    tests = relationship("Test", back_populates="stage", cascade="all, delete-orphan")


class Tutorial(Base):
    __tablename__ = "tutorials"

    id = Column(Integer, primary_key=True, index=True)
    stage_id = Column(Integer, ForeignKey("stages.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    module_number = Column(String, nullable=True) # e.g. "Module 1"
    duration_minutes = Column(Integer, default=0)
    video_url = Column(String, nullable=True)
    youtube_url = Column(String, nullable=True)
    start_seconds = Column(Integer, nullable=True)
    end_seconds = Column(Integer, nullable=True)
    gradient_colors = Column(String, nullable=True) # JSON or Comma-separated list for card gradients
    order_index = Column(Integer, default=0)
    # Per-tutorial switch for the post-tutorial quiz popup (effective only if stage.quiz_enabled)
    quiz_enabled = Column(Boolean, default=True, nullable=False)

    # Relationships
    stage = relationship("Stage", back_populates="tutorials")
    progress = relationship("UserTutorialProgress", back_populates="tutorial", cascade="all, delete-orphan")
    quiz_questions = relationship(
        "TutorialQuestion", back_populates="tutorial", cascade="all, delete-orphan",
        order_by="TutorialQuestion.order_index"
    )


class UserTutorialProgress(Base):
    __tablename__ = "user_tutorial_progress"
    # One progress row per (user, tutorial); guards the check-then-insert race in
    # _get_or_create_progress when the video-end flush and complete calls arrive together.
    __table_args__ = (UniqueConstraint("user_id", "tutorial_id", name="uq_user_tutorial"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tutorial_id = Column(Integer, ForeignKey("tutorials.id", ondelete="CASCADE"), nullable=False)
    is_completed = Column(Boolean, default=False, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    # Watch tracking (accumulated only while the video is actually playing)
    watch_time_seconds = Column(Float, default=0, nullable=False)
    watch_pct = Column(Float, default=0, nullable=False)  # 0-100, capped
    last_position_seconds = Column(Float, default=0, nullable=False)
    video_duration_seconds = Column(Float, nullable=True)  # duration reported by the player
    # Post-tutorial quiz outcome: pending | completed | skipped
    quiz_status = Column(String, default="pending", nullable=False)
    quiz_score = Column(Float, nullable=True)   # correct answers
    quiz_total = Column(Integer, nullable=True) # questions asked
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="tutorial_progress")
    tutorial = relationship("Tutorial", back_populates="progress")


class TutorialQuestion(Base):
    """A quiz question shown in the popup after a tutorial finishes."""
    __tablename__ = "tutorial_questions"

    id = Column(Integer, primary_key=True, index=True)
    tutorial_id = Column(Integer, ForeignKey("tutorials.id", ondelete="CASCADE"), nullable=False)
    text = Column(Text, nullable=False)
    order_index = Column(Integer, default=0)

    # Relationships
    tutorial = relationship("Tutorial", back_populates="quiz_questions")
    options = relationship(
        "TutorialQuestionOption", back_populates="question", cascade="all, delete-orphan"
    )


class TutorialQuestionOption(Base):
    __tablename__ = "tutorial_question_options"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("tutorial_questions.id", ondelete="CASCADE"), nullable=False)
    label = Column(String, nullable=False)  # "A", "B", "C", "D"
    text = Column(Text, nullable=False)
    is_correct = Column(Boolean, default=False, nullable=False)

    # Relationships
    question = relationship("TutorialQuestion", back_populates="options")


class TutorialQuizResponse(Base):
    """One row per question answered in a post-tutorial quiz."""
    __tablename__ = "tutorial_quiz_responses"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tutorial_id = Column(Integer, ForeignKey("tutorials.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, ForeignKey("tutorial_questions.id", ondelete="CASCADE"), nullable=False)
    selected_option_id = Column(Integer, ForeignKey("tutorial_question_options.id", ondelete="SET NULL"), nullable=True)
    is_correct = Column(Boolean, default=False, nullable=False)
    answered_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User")
    question = relationship("TutorialQuestion")


class Test(Base):
    __tablename__ = "tests"

    id = Column(Integer, primary_key=True, index=True)
    stage_id = Column(Integer, ForeignKey("stages.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    total_questions = Column(Integer, default=0)
    duration_minutes = Column(Integer, default=0)
    passing_score_pct = Column(Integer, default=50) # e.g., 50 means 50%
    max_attempts = Column(Integer, default=3)
    # Lifecycle: draft -> (scheduled_at set) -> active (admin starts) -> ended (admin ends).
    # Students may only start attempts while status == 'active'.
    status = Column(String, nullable=False, default="draft")
    test_type = Column(String, nullable=True)  # 'formative' | 'screening'
    scheduled_at = Column(DateTime(timezone=True), nullable=True)  # tentative go-live shown to users
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    stage = relationship("Stage", back_populates="tests")
    questions = relationship("Question", back_populates="test", cascade="all, delete-orphan")
    attempts = relationship("TestAttempt", back_populates="test", cascade="all, delete-orphan")


class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    test_id = Column(Integer, ForeignKey("tests.id", ondelete="CASCADE"), nullable=False)
    text = Column(Text, nullable=False)
    marks = Column(Integer, default=1)
    order_index = Column(Integer, default=0)

    # Relationships
    test = relationship("Test", back_populates="questions")
    options = relationship("QuestionOption", back_populates="question", cascade="all, delete-orphan")
    answers = relationship("TestAnswer", back_populates="question", cascade="all, delete-orphan")


class QuestionOption(Base):
    __tablename__ = "question_options"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    label = Column(String, nullable=False) # e.g., "A", "B", "C", "D"
    text = Column(Text, nullable=False)
    is_correct = Column(Boolean, default=False, nullable=False)

    # Relationships
    question = relationship("Question", back_populates="options")


class TestAttempt(Base):
    __tablename__ = "test_attempts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    test_id = Column(Integer, ForeignKey("tests.id", ondelete="CASCADE"), nullable=False)
    attempt_number = Column(Integer, nullable=False, default=1)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    score = Column(Float, nullable=True) # Percentage score or calculated score
    total_marks = Column(Float, nullable=True)
    is_passed = Column(Boolean, default=False)
    time_used_seconds = Column(Integer, nullable=True)

    # Relationships
    user = relationship("User", back_populates="test_attempts")
    test = relationship("Test", back_populates="attempts")
    answers = relationship("TestAnswer", back_populates="attempt", cascade="all, delete-orphan")


class TestAnswer(Base):
    __tablename__ = "test_answers"

    id = Column(Integer, primary_key=True, index=True)
    attempt_id = Column(Integer, ForeignKey("test_attempts.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    selected_option_id = Column(Integer, ForeignKey("question_options.id", ondelete="CASCADE"), nullable=True)
    is_correct = Column(Boolean, default=False)
    is_marked_for_review = Column(Boolean, default=False)

    # Relationships
    attempt = relationship("TestAttempt", back_populates="answers")
    question = relationship("Question", back_populates="answers")
    selected_option = relationship("QuestionOption")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", back_populates="notifications")


class Achievement(Base):
    __tablename__ = "achievements"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    emoji_icon = Column(String, nullable=True)


class UserAchievement(Base):
    __tablename__ = "user_achievements"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    achievement_id = Column(Integer, ForeignKey("achievements.id", ondelete="CASCADE"), nullable=False)
    earned_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", back_populates="achievements")
    achievement = relationship("Achievement")


class FaceToFaceSelection(Base):
    """Users selected (via admin Excel upload) for face-to-face training."""
    __tablename__ = "face_to_face_selections"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    program_district_id = Column(Integer, ForeignKey("program_districts.id", ondelete="CASCADE"), nullable=True)
    uploaded_by = Column(String, nullable=True)  # admin email
    notified = Column(Boolean, default=False, nullable=False)
    selected_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User")
    program_district = relationship("ProgramDistrict")


class State(Base):
    __tablename__ = "states"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    # Relationships
    districts = relationship("District", back_populates="state", cascade="all, delete-orphan")


class District(Base):
    __tablename__ = "districts"

    id = Column(Integer, primary_key=True, index=True)
    state_id = Column(Integer, ForeignKey("states.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)

    # Relationships
    state = relationship("State", back_populates="districts")
    blocks = relationship("Block", back_populates="district", cascade="all, delete-orphan")


class Block(Base):
    __tablename__ = "blocks"

    id = Column(Integer, primary_key=True, index=True)
    district_id = Column(Integer, ForeignKey("districts.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)

    # Relationships
    district = relationship("District", back_populates="blocks")
    villages = relationship("Village", back_populates="block", cascade="all, delete-orphan")
    facilities = relationship("Facility", back_populates="block", cascade="all, delete-orphan")


class Village(Base):
    __tablename__ = "villages"

    id = Column(Integer, primary_key=True, index=True)
    block_id = Column(Integer, ForeignKey("blocks.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)

    # Relationships
    block = relationship("Block", back_populates="villages")


class Facility(Base):
    __tablename__ = "facilities"

    id = Column(Integer, primary_key=True, index=True)
    block_id = Column(Integer, ForeignKey("blocks.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    facility_type = Column(String, nullable=False)

    # Relationships
    block = relationship("Block", back_populates="facilities")


class EducationalQualification(Base):
    __tablename__ = "educational_qualifications"

    id = Column(Integer, primary_key=True, index=True)
    qualification_name = Column(String, nullable=False)
    has_semi_open_input = Column(Boolean, default=False, nullable=False)
    # LR: qualification lists are department-specific (HFW vs WCD). Null = shared/generic (legacy rows).
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    order_index = Column(Integer, default=0, nullable=False)  # by prevalence

    department = relationship("Department")


class ExperienceRange(Base):
    __tablename__ = "experience_ranges"

    id = Column(Integer, primary_key=True, index=True)
    label = Column(String, nullable=False)
    order_index = Column(Integer, default=0, nullable=False)


# ─────────────────────────────────────────────────────────────────────────────
# Professional-axis master data — powers the Learner Registration cascading
# dropdowns (Department → Designation → Facility type, and Department → Education).
# The frontend fetches these from /api/metadata/* so option lists live in the
# backend, not hardcoded in the form. See the EP HST "LR notes" sheet.
# ─────────────────────────────────────────────────────────────────────────────

# Which facility types a given designation can be posted at (LR-notes mapping).
designation_facility_types = Table(
    "designation_facility_types",
    Base.metadata,
    Column("designation_id", Integer, ForeignKey("designations.id", ondelete="CASCADE"), primary_key=True),
    Column("facility_type_id", Integer, ForeignKey("facility_types.id", ondelete="CASCADE"), primary_key=True),
)


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False)   # HFW | WCD | OTHER
    name = Column(String, nullable=False)
    order_index = Column(Integer, default=0, nullable=False)

    designations = relationship("Designation", back_populates="department", cascade="all, delete-orphan")


class Designation(Base):
    __tablename__ = "designations"

    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    order_index = Column(Integer, default=0, nullable=False)   # ordered by frequency
    is_other = Column(Boolean, default=False, nullable=False)  # "Other (Specify)" → free-text follow-up

    department = relationship("Department", back_populates="designations")
    facility_types = relationship(
        "FacilityType", secondary=designation_facility_types, back_populates="designations"
    )


class FacilityType(Base):
    __tablename__ = "facility_types"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    order_index = Column(Integer, default=0, nullable=False)
    is_other = Column(Boolean, default=False, nullable=False)

    designations = relationship(
        "Designation", secondary=designation_facility_types, back_populates="facility_types"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Mother Registration (MR) — a pregnant mother a learner "adopts"/registers.
# Ownership: User (learner) → Mother → Child. Geography reuses states/districts/
# blocks (taluk); HWC/PHC are new master tables. See the EP HST "MR" tool.
# ─────────────────────────────────────────────────────────────────────────────

class PHC(Base):
    """Primary Health Centre — master list."""
    __tablename__ = "phcs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    block_id = Column(Integer, ForeignKey("blocks.id", ondelete="CASCADE"), nullable=True)  # taluk


class HWC(Base):
    """Health & Wellness Centre — master list. Each HWC maps to exactly one PHC."""
    __tablename__ = "hwcs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    block_id = Column(Integer, ForeignKey("blocks.id", ondelete="CASCADE"), nullable=True)  # taluk
    phc_id = Column(Integer, ForeignKey("phcs.id"), nullable=True)

    phc = relationship("PHC")


class MotherEducationLevel(Base):
    """Highest-education options for mothers (general population, distinct from LR)."""
    __tablename__ = "mother_education_levels"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    order_index = Column(Integer, default=0, nullable=False)
    # True for Diploma/Graduate/Postgraduate → the form then asks for field + degree.
    requires_field = Column(Boolean, default=False, nullable=False)


class EducationField(Base):
    """Broad field of study (Health Sciences, Engineering, …) → cascades to degrees."""
    __tablename__ = "education_fields"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    order_index = Column(Integer, default=0, nullable=False)

    degrees = relationship("EducationDegree", back_populates="field", cascade="all, delete-orphan")


class EducationDegree(Base):
    """Specific degree/diploma, filtered by education field."""
    __tablename__ = "education_degrees"

    id = Column(Integer, primary_key=True, index=True)
    field_id = Column(Integer, ForeignKey("education_fields.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    order_index = Column(Integer, default=0, nullable=False)

    field = relationship("EducationField", back_populates="degrees")


class Mother(Base):
    __tablename__ = "mothers"

    id = Column(Integer, primary_key=True, index=True)
    mother_uid = Column(String, unique=True, index=True, nullable=False)  # human-facing ID
    registered_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Identity & clinical
    mother_name = Column(String, nullable=False)
    adoption_date = Column(Date, nullable=True)
    mother_dob = Column(Date, nullable=True)          # "Preferred", not required
    mother_age = Column(Integer, nullable=True)       # auto from DOB, editable; 10–50
    weight = Column(Float, nullable=True)             # kg, 35.0–200.0
    height = Column(Float, nullable=True)             # cm, 100.0–230.0
    lmp = Column(Date, nullable=True)
    edd_lmp = Column(Date, nullable=True)             # auto = LMP + 280 days (read-only)
    edd_records = Column(Date, nullable=True)         # typed, "as per latest records"
    mobile = Column(String, nullable=True)
    alternate_mobile = Column(String, nullable=True)
    email = Column(String, nullable=True)
    # gestational weeks/months are time-relative → derived from lmp on read, not stored.

    # Geography (state/district/taluk reuse the shared masters; village is free text)
    state_id = Column(Integer, ForeignKey("states.id"), nullable=True)
    district_id = Column(Integer, ForeignKey("districts.id"), nullable=True)
    taluk_id = Column(Integer, ForeignKey("blocks.id"), nullable=True)
    village = Column(String, nullable=True)
    hwc_id = Column(Integer, ForeignKey("hwcs.id"), nullable=True)
    phc_id = Column(Integer, ForeignKey("phcs.id"), nullable=True)

    # Socio-demographic
    education_id = Column(Integer, ForeignKey("mother_education_levels.id"), nullable=True)
    education_field_id = Column(Integer, ForeignKey("education_fields.id"), nullable=True)
    education_degree_id = Column(Integer, ForeignKey("education_degrees.id"), nullable=True)
    occupation = Column(String, nullable=True)
    occupation_other = Column(String, nullable=True)
    ration_card = Column(String, nullable=True)
    social_category = Column(String, nullable=True)

    # Knowledge / attitudes / practice
    nutrition_course = Column(Boolean, nullable=True)
    nutrition_course_name = Column(String, nullable=True)
    video_frequency = Column(String, nullable=True)
    implement_video = Column(String, nullable=True)       # Likert
    confidence_video = Column(String, nullable=True)      # Likert
    willingness_hcw = Column(String, nullable=True)       # Likert
    information_seeking = Column(String, nullable=True)   # Likert

    registered_by = relationship("User")
    state = relationship("State")
    district = relationship("District")
    taluk = relationship("Block")
    hwc = relationship("HWC")
    phc = relationship("PHC")
    education = relationship("MotherEducationLevel")
    education_field = relationship("EducationField")
    education_degree = relationship("EducationDegree")
    source_ratings = relationship(
        "MotherSourceRating", back_populates="mother", cascade="all, delete-orphan"
    )
    children = relationship(
        "Child", back_populates="mother", cascade="all, delete-orphan"
    )

    # Gestational age is time-relative → derived from LMP, never stored.
    @property
    def gestational_weeks(self):
        return (date.today() - self.lmp).days // 7 if self.lmp else None

    @property
    def gestational_months(self):
        return (date.today() - self.lmp).days // 30 if self.lmp else None


class MotherSourceRating(Base):
    """Trust/willingness matrix — one row per (mother, information source)."""
    __tablename__ = "mother_source_ratings"

    id = Column(Integer, primary_key=True, index=True)
    mother_id = Column(Integer, ForeignKey("mothers.id", ondelete="CASCADE"), nullable=False)
    source = Column(String, nullable=False)          # e.g. "doctor", "asha", "youtube"
    trust = Column(Integer, nullable=True)           # 1–5
    willingness = Column(Integer, nullable=True)     # 1–5

    mother = relationship("Mother", back_populates="source_ratings")

    __table_args__ = (UniqueConstraint("mother_id", "source", name="uq_mother_source"),)


class Child(Base):
    """A child registered under a mother (mother-first ownership: learner → mother → child)."""
    __tablename__ = "children"

    id = Column(Integer, primary_key=True, index=True)
    child_uid = Column(String, unique=True, index=True, nullable=False)  # human-facing ID
    mother_id = Column(Integer, ForeignKey("mothers.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Birth
    babies_born = Column(String, nullable=True)        # "Single" | "Twins"
    adoption_date = Column(Date, nullable=True)        # not future, not >14 days ago
    child_name = Column(String, nullable=False)        # temporary name allowed if unnamed
    dob = Column(Date, nullable=True)                  # not future, not >365 days ago
    birth_weight = Column(Float, nullable=True)        # kg, 1.0–5.0
    birth_length = Column(Float, nullable=True)        # cm, 30.0–65.0
    gender = Column(String, nullable=True)             # "Female" | "Male"
    previous_living_children = Column(Integer, nullable=True)  # 0–10

    # Delivery & feeding
    delivery_method = Column(String, nullable=True)
    delivery_place = Column(String, nullable=True)
    delivery_place_other = Column(String, nullable=True)   # when delivery_place == "Other"
    bf_within_one_hour = Column(Boolean, nullable=True)    # breastfeeding within 1h of birth
    ebf_during_stay = Column(Boolean, nullable=True)       # exclusively breastfed during facility stay
    ebf_reason = Column(String, nullable=True)             # when ebf_during_stay is False

    # Pre-existing / birth conditions (multi-select → child table); free text for "Others"
    pre_existing_other = Column(String, nullable=True)

    mother = relationship("Mother", back_populates="children")
    birth_conditions = relationship(
        "ChildBirthCondition", back_populates="child", cascade="all, delete-orphan"
    )

    # Child age is time-relative → derived from DOB, never stored.
    @property
    def age_days(self):
        return (date.today() - self.dob).days if self.dob else None

    @property
    def age_months(self):
        return (date.today() - self.dob).days // 30 if self.dob else None


class ChildBirthCondition(Base):
    """Pre-existing/birth conditions checklist — one row per (child, condition)."""
    __tablename__ = "child_birth_conditions"

    id = Column(Integer, primary_key=True, index=True)
    child_id = Column(Integer, ForeignKey("children.id", ondelete="CASCADE"), nullable=False)
    condition = Column(String, nullable=False)         # e.g. "Neonatal jaundice", "Others"

    child = relationship("Child", back_populates="birth_conditions")

    __table_args__ = (UniqueConstraint("child_id", "condition", name="uq_child_condition"),)
