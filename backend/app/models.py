from datetime import date
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, ForeignKey, Float, Text, Table, UniqueConstraint, Index, JSON
from sqlalchemy.orm import backref, relationship
from sqlalchemy.sql import func
from app.database import Base


class ProgramDistrict(Base):
    """A program PROJECT — the unit that owns content (stages, tutorials, tests,
    form-version pinning) and that learners belong to.

    Two levels:
      * ``district`` — a standalone district project. Crosstabs analysis runs at
        BLOCK level inside it.
      * ``state``    — a state project (e.g. Meghalaya) that CONTAINS district
        projects as children. Crosstabs analysis runs at DISTRICT level.

    A child district is a full project row in its own right: it has its own
    stages/tutorials/tests/form assignments exactly like a standalone district.
    When ``inherits_content`` is set, it instead serves its parent state's
    content — the admin's choice of "separate" vs "same" per district.

    (Table name kept as program_districts: every FK in the schema points here.)
    """
    __tablename__ = "program_districts"

    LEVEL_DISTRICT = "district"
    LEVEL_STATE = "state"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    slug = Column(String, unique=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 'district' | 'state' — drives the crosstabs analysis level and whether
    # this project can contain child districts.
    level = Column(String, nullable=False, default=LEVEL_DISTRICT)
    # Set on district projects that live inside a state project.
    parent_id = Column(
        Integer,
        ForeignKey("program_districts.id", ondelete="CASCADE", name="program_districts_parent_id_fkey"),
        nullable=True,
        index=True,
    )
    # Child districts only: serve the parent state's content instead of own.
    inherits_content = Column(Boolean, nullable=False, default=False)
    # Analytics identity: short project code (UJ/JL/ML…) used for pipeline
    # workspace isolation, and the state prefix used in raw-file names
    # ("MP Ujjain_…", "ML East Khasi Hills_…").
    code = Column(String, nullable=True, unique=True)
    state_prefix = Column(String, nullable=True)

    # Relationships
    users = relationship("User", back_populates="program_district")
    stages = relationship("Stage", back_populates="program_district", cascade="all, delete-orphan")
    children = relationship(
        "ProgramDistrict",
        backref=backref("parent", remote_side=[id]),
        cascade="all, delete-orphan",
        order_by="ProgramDistrict.name",
    )

    @property
    def is_state(self) -> bool:
        return (self.level or self.LEVEL_DISTRICT) == self.LEVEL_STATE

    @property
    def content_source_id(self) -> int:
        """Which project's stages/tutorials/tests/forms this project serves."""
        if self.parent_id and self.inherits_content:
            return self.parent_id
        return self.id


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
    designation_other = Column(String, nullable=True)         # free-text designation (dept = Other, or "Other" row picked)
    facility_type_other = Column(String, nullable=True)       # free-text facility type (dept = Other, or "Other" row picked)
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
    program_district_id = Column(Integer, ForeignKey("program_districts.id", ondelete="CASCADE"), nullable=True, index=True)
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
    stage_id = Column(Integer, ForeignKey("stages.id", ondelete="CASCADE"), nullable=False, index=True)
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
    tutorial_id = Column(Integer, ForeignKey("tutorials.id", ondelete="CASCADE"), nullable=False, index=True)
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
    # Hot filter: submit deletes-then-inserts by (user_id, tutorial_id); this
    # table grows to millions of rows at scale, so index the filter columns.
    __table_args__ = (
        Index("ix_tutorial_quiz_responses_user_tutorial", "user_id", "tutorial_id"),
    )

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
    stage_id = Column(Integer, ForeignKey("stages.id", ondelete="CASCADE"), nullable=False, index=True)
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
    test_id = Column(Integer, ForeignKey("tests.id", ondelete="CASCADE"), nullable=False, index=True)
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
    question_id = Column(Integer, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    label = Column(String, nullable=False) # e.g., "A", "B", "C", "D"
    text = Column(Text, nullable=False)
    is_correct = Column(Boolean, default=False, nullable=False)

    # Relationships
    question = relationship("Question", back_populates="options")


class TestAttempt(Base):
    __tablename__ = "test_attempts"
    # (user_id, test_id) is filtered on every /api/tests, /start and /submit;
    # this composite covers those lookups (Postgres does not auto-index FKs).
    __table_args__ = (
        Index("ix_test_attempts_user_test", "user_id", "test_id"),
    )

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
    # One answer row per (attempt, question). The unique constraint makes the
    # double-submit race impossible to corrupt data even if two submits slip
    # past the atomic submitted_at guard; the index also serves result-detail
    # lookups by attempt_id.
    __table_args__ = (
        UniqueConstraint("attempt_id", "question_id", name="uq_answer_attempt_question"),
    )

    id = Column(Integer, primary_key=True, index=True)
    attempt_id = Column(Integer, ForeignKey("test_attempts.id", ondelete="CASCADE"), nullable=False, index=True)
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
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    # In-app route this notification points at (e.g. "/assessments/12/plan");
    # used by the panel for tap-through and by web push for deep-linking.
    link = Column(String, nullable=True)
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
    # Client idempotency key: offline-queue replays of the same registration
    # return the existing row instead of creating a duplicate.
    client_ref = Column(String, unique=True, index=True, nullable=True)
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
    hwc_other = Column(String, nullable=True)         # free text when HWC is not in the master list
    phc_id = Column(Integer, ForeignKey("phcs.id"), nullable=True)

    # Socio-demographic
    education_id = Column(Integer, ForeignKey("mother_education_levels.id"), nullable=True)
    education_field_id = Column(Integer, ForeignKey("education_fields.id"), nullable=True)
    education_degree_id = Column(Integer, ForeignKey("education_degrees.id"), nullable=True)
    occupation = Column(String, nullable=True)
    occupation_other = Column(String, nullable=True)
    ration_card = Column(String, nullable=True)
    ration_card_other = Column(String, nullable=True)
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

    # Gestational age is time-relative → derived from LMP, never stored. An LMP more
    # than 315 days (45 weeks) old cannot be a current pregnancy → no gestational age.
    def _gestation_days(self):
        if not self.lmp:
            return None
        days = (date.today() - self.lmp).days
        return days if 0 <= days <= 315 else None

    # Reported the obstetric way — whole weeks plus the leftover days ("25 weeks
    # 6 days"), not weeks-and-months.
    @property
    def gestational_weeks(self):
        days = self._gestation_days()
        return days // 7 if days is not None else None

    @property
    def gestational_days(self):
        days = self._gestation_days()
        return days % 7 if days is not None else None


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
    # Client idempotency key for offline-queue replays (see Mother.client_ref).
    client_ref = Column(String, unique=True, index=True, nullable=True)
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
    bf_reason = Column(String, nullable=True)              # when bf_within_one_hour is False
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


class FormDefinition(Base):
    """An admin-authored form. Two builder types:
      - 'flat': ordered field list (learner/mother/child/growth/antenatal registration forms)
      - 'flow': canvas decision-tree of question nodes with branching, media options,
        green/red LAP verdicts and per-option actions (breastfeeding, complementary feeding)

    Versioning: every save from the builder appends an immutable FormVersion
    row. `schema_json` here is kept in sync with the DEFAULT version (what a
    learner in an unassigned district sees) so every pre-versioning consumer
    keeps working; districts pinned to another version via
    FormDistrictAssignment see that version instead.
    """
    __tablename__ = "form_definitions"

    id = Column(Integer, primary_key=True, index=True)
    form_key = Column(String, unique=True, index=True, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    builder_type = Column(String, nullable=False)      # 'flow' | 'flat'
    schema_json = Column(JSON, nullable=False, default=dict)
    version = Column(Integer, nullable=False, default=1)
    # The version served to districts without an explicit assignment.
    default_version_id = Column(
        Integer,
        ForeignKey("form_versions.id", ondelete="SET NULL", name="form_definitions_default_version_id_fkey", use_alter=True),
        nullable=True,
    )
    updated_by = Column(String, nullable=True)         # admin email (audit)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    default_version = relationship("FormVersion", foreign_keys=[default_version_id], post_update=True)


class FormVersion(Base):
    """One immutable snapshot in a form's history (git-style).

    The first version of a form is its "first creation" entry; every later
    save appends a new row with an admin-entered creation date and a
    description of what changed. Versions are never edited in place —
    districts are pointed at them via FormDistrictAssignment.
    """
    __tablename__ = "form_versions"

    id = Column(Integer, primary_key=True, index=True)
    form_key = Column(String, index=True, nullable=False)
    version_number = Column(Integer, nullable=False)
    # Admin-entered creation date (the "commit date"), distinct from created_at.
    created_on = Column(Date, nullable=False)
    # Required change summary ("first creation" for the initial version).
    description = Column(Text, nullable=False)
    # Auto-detected diff vs the version this one was edited from (list of
    # human-readable strings) — complements the admin's own description.
    detected_changes = Column(JSON, nullable=True)
    # The version_number the diff was taken against (the editor may have been
    # opened on an older version, so this is not always the previous one).
    diffed_from_version = Column(Integer, nullable=True)
    schema_json = Column(JSON, nullable=False, default=dict)
    created_by = Column(String, nullable=True)         # admin email (audit)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    assignments = relationship(
        "FormDistrictAssignment", back_populates="version", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("form_key", "version_number", name="uq_form_versions_key_number"),
    )


class FormDistrictAssignment(Base):
    """Pins one program district to one specific version of a form.

    A district appears at most once per form (unique below), so assigning it
    to a new version implicitly moves it off the old one. Districts with no
    row fall back to the form's default version.
    """
    __tablename__ = "form_district_assignments"

    id = Column(Integer, primary_key=True, index=True)
    form_key = Column(String, index=True, nullable=False)
    program_district_id = Column(
        Integer,
        ForeignKey("program_districts.id", ondelete="CASCADE", name="form_district_assignments_program_district_id_fkey"),
        nullable=False,
    )
    version_id = Column(
        Integer,
        ForeignKey("form_versions.id", ondelete="CASCADE", name="form_district_assignments_version_id_fkey"),
        nullable=False,
    )
    assigned_by = Column(String, nullable=True)        # admin email (audit)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    version = relationship("FormVersion", back_populates="assignments")
    program_district = relationship("ProgramDistrict")

    __table_args__ = (
        UniqueConstraint("form_key", "program_district_id", name="uq_form_district_assignment"),
    )


class FormResponse(Base):
    """One assessment. Most forms attach to a child (BF/CF/growth); mother-level
    forms (e.g. the protein-intake form) attach to a mother instead — exactly
    one of child_id / mother_id is set. Answers are denormalized snapshots
    (question text, option labels, verdicts, actions) taken at submit time so
    history stays readable even after the admin edits the form definition.
    """
    __tablename__ = "form_responses"

    id = Column(Integer, primary_key=True, index=True)
    form_key = Column(String, index=True, nullable=False)
    definition_version = Column(Integer, nullable=False, default=1)
    # Child-level forms set child_id; mother-level forms set mother_id instead.
    child_id = Column(Integer, ForeignKey("children.id", ondelete="CASCADE"), nullable=True)
    mother_id = Column(Integer, ForeignKey("mothers.id", ondelete="CASCADE"), nullable=True)
    submitted_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assessment_date = Column(Date, nullable=False)
    status = Column(String, nullable=False, default="draft")   # 'draft' | 'submitted'
    answers_json = Column(JSON, nullable=False, default=list)
    summary_json = Column(JSON, nullable=False, default=dict)  # {green, red, neutral, answered, total}
    actions_json = Column(JSON, nullable=False, default=list)  # triggered coaching actions
    # Client idempotency key for offline-queue replays (see Mother.client_ref).
    client_ref = Column(String, unique=True, index=True, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    child = relationship("Child")
    mother = relationship("Mother")
    submitted_by = relationship("User")

    __table_args__ = (
        Index("ix_form_responses_child_form", "child_id", "form_key"),
        Index("ix_form_responses_mother_form", "mother_id", "form_key"),
    )


class PushSubscription(Base):
    """One browser/device push endpoint for a user (web push / PWA).

    A user may have several (phone + tablet). Subscriptions outlive the JWT —
    they are keyed to the user and pruned when the push service reports them
    gone (404/410) or on explicit unsubscribe.
    """
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE", name="push_subscriptions_user_id_fkey"),
        nullable=False,
        index=True,
    )
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(String, nullable=False)
    auth = Column(String, nullable=False)
    user_agent = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PipelineRun(Base):
    """One execution of a data-analytics pipeline (admin "Database" section).

    pipeline 'crosstabs' runs are per-project (variant = 'UJ' | 'JL' | 'ML');
    pipeline 'masd' runs are per-script (variant = 'combined' | 'raw_exclusion').
    Each run executes in its own working directory under the pipeline data
    root; run_dir stores that directory relative to the root so the data root
    can be relocated. Outputs are described by manifest_json
    ([{path, name, size, section}]) and survive as plain files inside run_dir.
    """
    __tablename__ = "pipeline_runs"

    id = Column(Integer, primary_key=True, index=True)
    pipeline = Column(String, nullable=False, index=True)   # 'crosstabs' | 'masd'
    variant = Column(String, nullable=False)                # project code or masd script kind
    # 'queued' | 'running' | 'success' | 'failed' | 'imported'
    status = Column(String, nullable=False, default="queued")
    # Optional human label (e.g. "Imported baseline from local run").
    label = Column(String, nullable=True)
    run_dir = Column(String, nullable=False)                # relative to the pipeline data root
    manifest_json = Column(JSON, nullable=False, default=list)
    # Parsed run report: stage timings, validation verdict (crosstabs),
    # detected projects (masd), exit code.
    report_json = Column(JSON, nullable=False, default=dict)
    error = Column(Text, nullable=True)
    created_by = Column(String, nullable=True)              # admin email (audit)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_pipeline_runs_pipeline_variant", "pipeline", "variant"),
    )


class PipelineScript(Base):
    """One uploaded version of a pipeline script (admin "Database" section).

    Every slot (e.g. crosstabs 'cleaning' / 'derived' / 'crosstabs' / 'master'
    / 'validation', masd 'combined' / 'raw_exclusion') has a vendored default
    under backend/pipelines/; uploads create numbered versions stored under
    the data root. At most one version per slot is active — active scripts are
    materialized into new run directories under the slot's canonical filename,
    replacing the default. The 'extra' slot is special: every active upload is
    copied alongside the pipeline under its original filename.
    """
    __tablename__ = "pipeline_scripts"

    id = Column(Integer, primary_key=True, index=True)
    pipeline = Column(String, nullable=False, index=True)   # 'crosstabs' | 'masd'
    slot = Column(String, nullable=False)
    version = Column(Integer, nullable=False)
    original_name = Column(String, nullable=False)
    stored_path = Column(String, nullable=False)            # relative to the pipeline data root
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=False)
    created_by = Column(String, nullable=True)              # admin email (audit)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("pipeline", "slot", "version", name="uq_pipeline_scripts_slot_version"),
    )
