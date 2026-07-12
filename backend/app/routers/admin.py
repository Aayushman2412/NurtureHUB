"""
Admin API routes for NurtureHUB.
Provides admin login, district management, form config, tutorial/stage management,
test management, and results export.
All content endpoints are scoped per program district.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime
import json
import io
import random
import re

from app.config import settings
from app.database import get_db
from app.models import (
    User, ProgramDistrict, Stage, Tutorial, Test, Question, QuestionOption,
    TestAttempt, TestAnswer, TutorialQuestion, TutorialQuestionOption,
    TutorialQuizResponse, UserTutorialProgress, Notification, FaceToFaceSelection,
)
from app.auth import verify_password, create_access_token
from app.dependencies import get_current_admin, get_admin_email
from app.rate_limit import limiter
from app.timeutils import iso_utc, utcnow

# Public admin endpoints (login only) — no token required.
auth_router = APIRouter(prefix="/api/admin", tags=["admin-auth"])

# All other admin endpoints require a valid admin token (enforced at router level).
router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])

# ──────────────────────────────────────────────
# Hardcoded admin credentials for quick testing
# ──────────────────────────────────────────────
HARDCODED_ADMIN_EMAIL = "admin@nurturehub.org"
HARDCODED_ADMIN_PASSWORD = "admin123"

# ──────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────
class AdminLoginRequest(BaseModel):
    email: str
    password: str

class AdminLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    is_admin: bool = True
    admin_name: str = "Administrator"

class FormFieldOption(BaseModel):
    label: str
    value: str

class FormField(BaseModel):
    id: str
    label: str
    type: str  # dropdown, text, number, date, radio, textarea
    placeholder: Optional[str] = ""
    required: bool = True
    options: Optional[List[FormFieldOption]] = None

class FormConfigResponse(BaseModel):
    fields: List[FormField]

class TutorialData(BaseModel):
    id: int
    title: str
    description: str
    module_number: str
    duration_minutes: int
    youtube_url: str
    start_seconds: int = 0
    end_seconds: int = 0
    order_index: int

class StageData(BaseModel):
    id: int
    title: str
    description: str
    order_index: int
    tutorials: List[TutorialData]

class TestQuestionData(BaseModel):
    id: int
    text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_answer: str  # A, B, C, D
    marks: int = 2

class TestData(BaseModel):
    id: int
    title: str
    description: str
    stage_id: int
    duration_minutes: int
    passing_score_pct: int
    max_attempts: int
    status: str = "draft"  # draft, active, ended
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    questions: List[TestQuestionData]

class DashboardStats(BaseModel):
    total_users: int
    total_stages: int
    total_tutorials: int
    total_tests: int
    total_form_fields: int
    active_tests: int
    district_name: str = ""

class ProgramDistrictSchema(BaseModel):
    id: int
    name: str
    slug: str
    is_active: bool
    user_count: int = 0

class ProgramDistrictCreate(BaseModel):
    name: str

class UserDistrictAssign(BaseModel):
    program_district_id: Optional[int] = None


# ──────────────────────────────────────────────
# Helper: slugify
# ──────────────────────────────────────────────
def _slugify(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


# ──────────────────────────────────────────────
# Admin Login
# ──────────────────────────────────────────────
@auth_router.post("/login", response_model=AdminLoginResponse)
@limiter.limit("10/minute")
def admin_login(request: Request, credentials: AdminLoginRequest, db: Session = Depends(get_db)):
    """
    Authenticate admin user.
    Supports both hardcoded credentials for testing and DB-validated admin auth.
    """
    # 1. Check hardcoded credentials first (for quick testing)
    if (credentials.email == HARDCODED_ADMIN_EMAIL and
            credentials.password == HARDCODED_ADMIN_PASSWORD):
        access_token = create_access_token(data={"sub": HARDCODED_ADMIN_EMAIL, "is_admin": True})
        return AdminLoginResponse(
            access_token=access_token,
            admin_name="NurtureHUB Admin"
        )

    # 2. Check DB for admin users
    user = db.query(User).filter(User.email == credentials.email).first()
    if user and user.is_admin and user.password_hash:
        if verify_password(credentials.password, user.password_hash):
            access_token = create_access_token(data={"sub": user.email, "is_admin": True})
            return AdminLoginResponse(
                access_token=access_token,
                admin_name=user.full_name or "Admin"
            )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid admin credentials"
    )


# ──────────────────────────────────────────────
# District CRUD
# ──────────────────────────────────────────────
@router.get("/districts", response_model=List[ProgramDistrictSchema])
def list_districts(db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """List all program districts with user counts."""
    districts = db.query(ProgramDistrict).order_by(ProgramDistrict.id).all()
    result = []
    for d in districts:
        user_count = db.query(User).filter(User.program_district_id == d.id).count()
        result.append(ProgramDistrictSchema(
            id=d.id, name=d.name, slug=d.slug, is_active=d.is_active, user_count=user_count
        ))
    return result


@router.post("/districts", response_model=ProgramDistrictSchema)
def create_district(data: ProgramDistrictCreate, db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Create a new program district."""
    slug = _slugify(data.name)
    existing = db.query(ProgramDistrict).filter(
        (ProgramDistrict.name == data.name) | (ProgramDistrict.slug == slug)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="A district with this name already exists")

    district = ProgramDistrict(name=data.name, slug=slug, is_active=True)
    db.add(district)
    db.commit()
    db.refresh(district)

    # Initialize a default registration form config for this district
    MOCK_FORM_CONFIG[slug] = _default_form_config()

    return ProgramDistrictSchema(id=district.id, name=district.name, slug=district.slug, is_active=district.is_active, user_count=0)


@router.put("/districts/{district_id}")
def update_district(district_id: int, data: ProgramDistrictCreate, db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Update a program district."""
    district = db.query(ProgramDistrict).filter(ProgramDistrict.id == district_id).first()
    if not district:
        raise HTTPException(status_code=404, detail="District not found")

    old_slug = district.slug
    new_slug = _slugify(data.name)
    district.name = data.name
    district.slug = new_slug
    db.commit()

    # Migrate form-config key
    if old_slug != new_slug and old_slug in MOCK_FORM_CONFIG:
        MOCK_FORM_CONFIG[new_slug] = MOCK_FORM_CONFIG.pop(old_slug)

    return {"id": district.id, "name": district.name, "slug": district.slug, "is_active": district.is_active}


@router.delete("/districts/{district_id}")
def delete_district(district_id: int, db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Delete a program district."""
    district = db.query(ProgramDistrict).filter(ProgramDistrict.id == district_id).first()
    if not district:
        raise HTTPException(status_code=404, detail="District not found")

    slug = district.slug
    # Unassign users
    db.query(User).filter(User.program_district_id == district_id).update({User.program_district_id: None})
    db.delete(district)
    db.commit()

    MOCK_FORM_CONFIG.pop(slug, None)

    return {"message": "District deleted"}


# ──────────────────────────────────────────────
# User-District Assignment
# ──────────────────────────────────────────────
@router.get("/users")
def list_users_for_admin(db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """List all users with their district assignment."""
    users = db.query(User).order_by(User.id).all()
    result = []
    for u in users:
        result.append({
            "id": u.id,
            "email": u.email,
            "full_name": u.full_name,
            "program_district_id": u.program_district_id,
            "program_district_name": u.program_district.name if u.program_district else None,
        })
    return result


@router.put("/users/{user_id}/district")
def assign_user_district(user_id: int, data: UserDistrictAssign, db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Assign a user to a program district."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if data.program_district_id is not None:
        district = db.query(ProgramDistrict).filter(ProgramDistrict.id == data.program_district_id).first()
        if not district:
            raise HTTPException(status_code=404, detail="District not found")

    user.program_district_id = data.program_district_id
    db.commit()
    return {"message": "User district updated", "user_id": user.id, "program_district_id": data.program_district_id}


# ──────────────────────────────────────────────
# Dashboard Stats (district-scoped)
# ──────────────────────────────────────────────
@router.get("/dashboard-stats", response_model=DashboardStats)
def get_dashboard_stats(district: str = Query("", description="District slug"), db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Return admin dashboard statistics scoped to a district."""
    district_name = ""
    total_users = 0

    if district:
        pd = db.query(ProgramDistrict).filter(ProgramDistrict.slug == district).first()
        if pd:
            district_name = pd.name
            total_users = db.query(User).filter(User.program_district_id == pd.id).count()

    stages = _district_stages(db, district) if district else []
    stage_ids = [s.id for s in stages]
    form_fields = MOCK_FORM_CONFIG.get(district, [])
    total_tutorials = db.query(Tutorial).filter(Tutorial.stage_id.in_(stage_ids)).count() if stage_ids else 0

    district_tests = db.query(Test).filter(Test.stage_id.in_(stage_ids)).all() if stage_ids else []

    return DashboardStats(
        total_users=total_users,
        total_stages=len(stages),
        total_tutorials=total_tutorials,
        total_tests=len(district_tests),
        total_form_fields=len(form_fields),
        active_tests=sum(1 for t in district_tests if t.status == "active"),
        district_name=district_name,
    )


# ──────────────────────────────────────────────
# Form Builder Config (per-district)
# ──────────────────────────────────────────────

def _default_form_config() -> List[Dict[str, Any]]:
    """Return a default registration form config for a new district."""
    return [
        {"id": "dob", "label": "Date of Birth", "type": "date", "placeholder": "", "required": True, "options": None},
        {"id": "age", "label": "Age (Years)", "type": "number", "placeholder": "e.g. 28", "required": False, "options": None},
        {"id": "gender", "label": "Gender", "type": "radio", "placeholder": "", "required": True,
         "options": [{"label": "Female", "value": "Female"}, {"label": "Male", "value": "Male"}, {"label": "Other", "value": "Other"}]},
        {"id": "phone", "label": "Contact Number", "type": "text", "placeholder": "+91 98765 43210", "required": True, "options": None},
        {"id": "alternate_phone", "label": "Alternate Contact (Optional)", "type": "text", "placeholder": "+91 98765 43210", "required": False, "options": None},
        {"id": "state", "label": "State", "type": "dropdown", "placeholder": "Select State", "required": True,
         "options": [{"label": "Uttar Pradesh", "value": "up"}, {"label": "Bihar", "value": "bihar"}, {"label": "Madhya Pradesh", "value": "mp"}]},
        {"id": "district", "label": "District", "type": "dropdown", "placeholder": "Select District", "required": True,
         "options": [{"label": "Gorakhpur", "value": "gkp"}, {"label": "Lucknow", "value": "lko"}, {"label": "Patna", "value": "pat"}]},
        {"id": "department", "label": "Department", "type": "dropdown", "placeholder": "", "required": True,
         "options": [
             {"label": "Women & Child Development (WCD)", "value": "wcd"},
             {"label": "Department of Health and Family Welfare", "value": "health"},
             {"label": "National Health Mission (NHM)", "value": "nhm"}
         ]},
        {"id": "block", "label": "Administrative Block", "type": "dropdown", "placeholder": "Select Block", "required": True,
         "options": [{"label": "Bhathat", "value": "bhathat"}, {"label": "Pipraich", "value": "pipraich"}, {"label": "Malihabad", "value": "malihabad"}]},
        {"id": "workplace_type", "label": "Type of Workplace", "type": "dropdown", "placeholder": "", "required": True,
         "options": [
             {"label": "Anganwadi Center (AWC)", "value": "awc"},
             {"label": "Mini Anganwadi Center", "value": "mini_awc"},
             {"label": "Primary Health Center (PHC)", "value": "phc"}
         ]},
        {"id": "facility", "label": "Facility Name", "type": "dropdown", "placeholder": "Select Facility", "required": True,
         "options": [{"label": "Kalyanpur AWC", "value": "k_awc"}, {"label": "Bhathat PHC", "value": "b_phc"}]},
        {"id": "village", "label": "Workplace Village / City", "type": "dropdown", "placeholder": "Select Village / City", "required": True,
         "options": [{"label": "Kalyanpur", "value": "kalyanpur"}, {"label": "Bhathat Khas", "value": "bhathat_khas"}]},
        {"id": "role", "label": "Designation / Role", "type": "dropdown", "placeholder": "", "required": True,
         "options": [
             {"label": "Anganwadi Worker (AWW)", "value": "aww"},
             {"label": "Anganwadi Helper (AWH)", "value": "awh"},
             {"label": "Anganwadi Supervisor", "value": "supervisor"},
             {"label": "CDPO", "value": "cdpo"},
             {"label": "ANM / Health Worker", "value": "anm"}
         ]},
        {"id": "qualification", "label": "Highest Educational Qualification", "type": "dropdown", "placeholder": "Select Qualification", "required": True,
         "options": [
             {"label": "High School (10th)", "value": "hs"},
             {"label": "Higher Secondary (12th)", "value": "hsc"},
             {"label": "Graduate", "value": "grad"},
             {"label": "Post Graduate", "value": "pg"},
             {"label": "Other (Please specify)", "value": "other"}
         ]},
        {"id": "experience", "label": "Experience in Current Designation", "type": "dropdown", "placeholder": "Select Experience Range", "required": True,
         "options": [
             {"label": "Under 1 year", "value": "lt1"},
             {"label": "1 - 3 years", "value": "1_3"},
             {"label": "3 - 5 years", "value": "3_5"},
             {"label": "5 - 10 years", "value": "5_10"},
             {"label": "10+ years", "value": "10plus"}
         ]}
    ]


# District-keyed mock data stores
MOCK_FORM_CONFIG: Dict[str, List[Dict[str, Any]]] = {
    "jalna": _default_form_config(),
    "ujjain": _default_form_config(),
    "meghalaya": _default_form_config(),
}

# Mock users for result generation
MOCK_USERS = [
    "Sunita Devi", "Rekha Sharma", "Priya Singh", "Meena Kumari",
    "Kavita Yadav", "Anita Gupta", "Suman Tiwari", "Pooja Verma"
]


@router.get("/form-config")
def get_form_config(district: str = Query("jalna", description="District slug"), admin_email: str = Depends(get_admin_email)):
    """Return the current registration form configuration for a district."""
    fields = MOCK_FORM_CONFIG.get(district, _default_form_config())
    return {"fields": fields}


@router.put("/form-config")
def update_form_config(config: Dict[str, Any], district: str = Query("jalna", description="District slug"), admin_email: str = Depends(get_admin_email)):
    """Update the registration form configuration for a district."""
    if "fields" in config:
        MOCK_FORM_CONFIG[district] = config["fields"]
    return {"message": "Form configuration updated", "fields": MOCK_FORM_CONFIG.get(district, [])}


# ──────────────────────────────────────────────
# Tutorial & Stage Manager (per-district, DB-backed)
# ──────────────────────────────────────────────
# These operate on the SAME `stages`/`tutorials` tables students read, so admin
# edits are live for candidates (previously this was an in-memory mock store).

def _serialize_admin_tutorial(db: Session, t: Tutorial) -> Dict[str, Any]:
    question_count = db.query(TutorialQuestion).filter(
        TutorialQuestion.tutorial_id == t.id
    ).count()
    return {
        "id": t.id,
        "title": t.title,
        "description": t.description or "",
        "module_number": t.module_number or "",
        "duration_minutes": t.duration_minutes or 0,
        "video_url": t.video_url or "",
        "youtube_url": t.youtube_url or "",
        "start_seconds": t.start_seconds or 0,
        "end_seconds": t.end_seconds or 0,
        "order_index": t.order_index or 0,
        "quiz_enabled": bool(t.quiz_enabled),
        "quiz_question_count": question_count,
    }


def _serialize_admin_stage(db: Session, stage: Stage) -> Dict[str, Any]:
    tutorials = db.query(Tutorial).filter(
        Tutorial.stage_id == stage.id
    ).order_by(Tutorial.order_index).all()
    return {
        "id": stage.id,
        "title": stage.title,
        "description": stage.description or "",
        "order_index": stage.order_index,
        "stage_type": stage.stage_type or "tutorials",
        "quiz_enabled": bool(stage.quiz_enabled),
        "tutorials": [_serialize_admin_tutorial(db, t) for t in tutorials],
    }


def _get_district_or_404(db: Session, slug: str) -> ProgramDistrict:
    district = db.query(ProgramDistrict).filter(ProgramDistrict.slug == slug).first()
    if not district:
        raise HTTPException(status_code=404, detail="District not found")
    return district


TUTORIAL_EDITABLE_FIELDS = [
    "title", "description", "module_number", "duration_minutes",
    "video_url", "youtube_url", "start_seconds", "end_seconds", "order_index",
]


@router.get("/stages")
def get_admin_stages(district: str = Query("jalna", description="District slug"), db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """
    Return the district's VIDEO phases (and their tutorials) for the Tutorials
    manager. Test phases are deliberately excluded here — they live in Test
    Management. This also prevents deleting a test (and its data) from this screen.
    """
    return [
        _serialize_admin_stage(db, s)
        for s in _district_stages(db, district)
        if (s.stage_type or "tutorials") != "test"
    ]


@router.post("/stages")
def create_stage(stage: Dict[str, Any], district: str = Query("jalna", description="District slug"), db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Create a new stage/phase in a district."""
    pd = _get_district_or_404(db, district)
    count = db.query(Stage).filter(Stage.program_district_id == pd.id).count()
    new_stage = Stage(
        program_district_id=pd.id,
        title=stage.get("title", "New Phase"),
        description=stage.get("description", ""),
        order_index=count,
        stage_type=stage.get("stage_type", "tutorials"),
        quiz_enabled=bool(stage.get("quiz_enabled", True)),
    )
    db.add(new_stage)
    db.commit()
    db.refresh(new_stage)
    return _serialize_admin_stage(db, new_stage)


@router.put("/stages/{stage_id}")
def update_stage(stage_id: int, stage: Dict[str, Any], district: str = Query("jalna", description="District slug"), db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Update an existing stage/phase."""
    db_stage = db.query(Stage).filter(Stage.id == stage_id).first()
    if not db_stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    for key in ["title", "description", "stage_type", "order_index"]:
        if key in stage:
            setattr(db_stage, key, stage[key])
    if "quiz_enabled" in stage:
        db_stage.quiz_enabled = bool(stage["quiz_enabled"])
    db.commit()
    db.refresh(db_stage)
    return _serialize_admin_stage(db, db_stage)


@router.delete("/stages/{stage_id}")
def delete_stage(stage_id: int, district: str = Query("jalna", description="District slug"), db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Delete a video phase (its tutorials cascade). Test phases are protected."""
    db_stage = db.query(Stage).filter(Stage.id == stage_id).first()
    if not db_stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    # A test phase anchors a Test (with schedule/attempts/questions). Deleting it here
    # would cascade-delete that test — manage test phases in Test Management instead.
    if (db_stage.stage_type or "tutorials") == "test":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This is a test phase. Manage or remove its test from Test Management, not here.",
        )
    district_id = db_stage.program_district_id
    db.delete(db_stage)
    db.flush()
    # Reindex remaining stages so order stays contiguous
    remaining = db.query(Stage).filter(
        Stage.program_district_id == district_id
    ).order_by(Stage.order_index).all()
    for i, s in enumerate(remaining):
        s.order_index = i
    db.commit()
    return {"message": "Stage deleted"}


@router.post("/stages/{stage_id}/tutorials")
def add_tutorial(stage_id: int, tutorial: Dict[str, Any], district: str = Query("jalna", description="District slug"), db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Add a tutorial to a stage."""
    db_stage = db.query(Stage).filter(Stage.id == stage_id).first()
    if not db_stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    count = db.query(Tutorial).filter(Tutorial.stage_id == stage_id).count()
    new_tut = Tutorial(
        stage_id=stage_id,
        title=tutorial.get("title", "New Tutorial"),
        description=tutorial.get("description", ""),
        module_number=tutorial.get("module_number", f"Module {db_stage.order_index + 1}.{count + 1}"),
        duration_minutes=tutorial.get("duration_minutes", 5),
        video_url=tutorial.get("video_url") or None,
        youtube_url=tutorial.get("youtube_url") or None,
        start_seconds=tutorial.get("start_seconds", 0),
        end_seconds=tutorial.get("end_seconds", 0),
        order_index=count,
        quiz_enabled=bool(tutorial.get("quiz_enabled", True)),
    )
    db.add(new_tut)
    db.commit()
    db.refresh(new_tut)
    return _serialize_admin_tutorial(db, new_tut)


@router.put("/tutorials/{tutorial_id}")
def update_tutorial(tutorial_id: int, tutorial: Dict[str, Any], district: str = Query("jalna", description="District slug"), db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Update a tutorial."""
    db_tut = db.query(Tutorial).filter(Tutorial.id == tutorial_id).first()
    if not db_tut:
        raise HTTPException(status_code=404, detail="Tutorial not found")
    for key in TUTORIAL_EDITABLE_FIELDS:
        if key in tutorial:
            setattr(db_tut, key, tutorial[key])
    if "quiz_enabled" in tutorial:
        db_tut.quiz_enabled = bool(tutorial["quiz_enabled"])
    db.commit()
    db.refresh(db_tut)
    return _serialize_admin_tutorial(db, db_tut)


@router.delete("/tutorials/{tutorial_id}")
def delete_tutorial(tutorial_id: int, district: str = Query("jalna", description="District slug"), db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Delete a tutorial (progress, quiz questions and responses cascade)."""
    db_tut = db.query(Tutorial).filter(Tutorial.id == tutorial_id).first()
    if not db_tut:
        raise HTTPException(status_code=404, detail="Tutorial not found")
    db.delete(db_tut)
    db.commit()
    return {"message": "Tutorial deleted"}


# ──────────────────────────────────────────────
# Post-Tutorial Quiz Management
# ──────────────────────────────────────────────

@router.get("/tutorials/{tutorial_id}/quiz-questions")
def get_tutorial_quiz_questions(tutorial_id: int, db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Quiz questions for a tutorial in the flat admin shape (with correct answers)."""
    db_tut = db.query(Tutorial).filter(Tutorial.id == tutorial_id).first()
    if not db_tut:
        raise HTTPException(status_code=404, detail="Tutorial not found")
    questions = db.query(TutorialQuestion).filter(
        TutorialQuestion.tutorial_id == tutorial_id
    ).order_by(TutorialQuestion.order_index).all()
    out = []
    for q in questions:
        opts = sorted(q.options, key=lambda o: (o.label or ""))
        opt_map = {(o.label or "").upper(): o.text for o in opts}
        correct = next(((o.label or "").upper() for o in opts if o.is_correct), "A")
        out.append({
            "id": q.id,
            "text": q.text,
            "option_a": opt_map.get("A", ""),
            "option_b": opt_map.get("B", ""),
            "option_c": opt_map.get("C", ""),
            "option_d": opt_map.get("D", ""),
            "correct_answer": correct,
        })
    return {"tutorial_id": tutorial_id, "quiz_enabled": bool(db_tut.quiz_enabled), "questions": out}


@router.put("/tutorials/{tutorial_id}/quiz-questions")
def replace_tutorial_quiz_questions(tutorial_id: int, payload: Dict[str, Any], db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Replace a tutorial's quiz questions from the flat admin shape (A–D + correct_answer)."""
    db_tut = db.query(Tutorial).filter(Tutorial.id == tutorial_id).first()
    if not db_tut:
        raise HTTPException(status_code=404, detail="Tutorial not found")

    questions = payload.get("questions", [])
    # Old responses reference deleted question rows; drop them with the questions.
    old_ids = [q.id for q in db.query(TutorialQuestion).filter(
        TutorialQuestion.tutorial_id == tutorial_id
    ).all()]
    if old_ids:
        db.query(TutorialQuizResponse).filter(
            TutorialQuizResponse.question_id.in_(old_ids)
        ).delete(synchronize_session=False)
        db.query(TutorialQuestion).filter(
            TutorialQuestion.id.in_(old_ids)
        ).delete(synchronize_session=False)
    db.flush()

    for idx, q in enumerate(questions):
        question = TutorialQuestion(
            tutorial_id=tutorial_id,
            text=q.get("text", ""),
            order_index=idx,
        )
        db.add(question)
        db.flush()
        requested = str(q.get("correct_answer", "A")).upper()
        # A/B are always kept; C/D only when they have text (2-3 option questions).
        opts = []
        for label in ["A", "B", "C", "D"]:
            text = q.get(f"option_{label.lower()}", "") or ""
            if not text and label in ("C", "D"):
                continue
            opts.append((label, text))
        # Guarantee exactly one gradable correct option: prefer the requested label
        # if it exists with text, else the first non-empty option, else the first.
        with_text = [l for l, t in opts if t.strip()]
        if requested in with_text:
            correct_label = requested
        elif with_text:
            correct_label = with_text[0]
        elif opts:
            correct_label = opts[0][0]
        else:
            correct_label = "A"
        for label, text in opts:
            db.add(TutorialQuestionOption(
                question_id=question.id,
                label=label,
                text=text,
                is_correct=(label == correct_label),
            ))

    # Users who already answered/skipped the OLD quiz should be re-prompted and
    # must not keep a stale score for questions that no longer exist.
    db.query(UserTutorialProgress).filter(
        UserTutorialProgress.tutorial_id == tutorial_id,
        UserTutorialProgress.quiz_status.in_(["completed", "skipped"]),
    ).update(
        {
            UserTutorialProgress.quiz_status: "pending",
            UserTutorialProgress.quiz_score: None,
            UserTutorialProgress.quiz_total: None,
        },
        synchronize_session=False,
    )

    db.commit()
    return get_tutorial_quiz_questions(tutorial_id, db=db, admin_email=admin_email)


@router.put("/tutorials/{tutorial_id}/quiz-enabled")
def set_tutorial_quiz_enabled(tutorial_id: int, payload: Dict[str, Any], db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Enable/disable the post-tutorial quiz popup for one tutorial."""
    db_tut = db.query(Tutorial).filter(Tutorial.id == tutorial_id).first()
    if not db_tut:
        raise HTTPException(status_code=404, detail="Tutorial not found")
    db_tut.quiz_enabled = bool(payload.get("enabled", True))
    db.commit()
    return {"tutorial_id": tutorial_id, "quiz_enabled": db_tut.quiz_enabled}


@router.put("/stages/{stage_id}/quiz-enabled")
def set_stage_quiz_enabled(stage_id: int, payload: Dict[str, Any], db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """
    Enable/disable quiz popups for a whole phase. The stage flag is a master
    switch; optionally cascade the same value onto every tutorial in the stage.
    """
    db_stage = db.query(Stage).filter(Stage.id == stage_id).first()
    if not db_stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    enabled = bool(payload.get("enabled", True))
    db_stage.quiz_enabled = enabled
    if payload.get("apply_to_tutorials"):
        db.query(Tutorial).filter(Tutorial.stage_id == stage_id).update(
            {Tutorial.quiz_enabled: enabled}, synchronize_session=False
        )
    db.commit()
    return {"stage_id": stage_id, "quiz_enabled": enabled}


# ──────────────────────────────────────────────
# Test Manager (per-district, DB-backed)
# ──────────────────────────────────────────────
# The admin Test Manager operates on the SAME real DB `tests` table that
# candidates take, so `test.id` here == `tests.id` == `LiveSession.test_id` ==
# the admin live-monitoring WebSocket channel.
#
# The lifecycle (draft -> scheduled -> active -> ended) is persisted on the Test
# row and HARD-GATES students: they can only start attempts while status is
# 'active' (enforced in routers/tests.py via app.flow.test_lock_state).


def _parse_client_datetime(value: Any) -> Optional[datetime]:
    """Parse an ISO datetime string coming from the admin UI ('' -> None)."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid datetime: {value!r}")


def _district_stages(db: Session, slug: str) -> List[Stage]:
    """Return a district's stages ordered by order_index (empty if unknown district)."""
    district = db.query(ProgramDistrict).filter(ProgramDistrict.slug == slug).first()
    if not district:
        return []
    return (
        db.query(Stage)
        .filter(Stage.program_district_id == district.id)
        .order_by(Stage.order_index)
        .all()
    )


def _district_test_ids(db: Session, slug: str) -> List[int]:
    """All DB test ids belonging to a district (across its stages)."""
    stages = _district_stages(db, slug)
    if not stages:
        return []
    stage_ids = [s.id for s in stages]
    return [t.id for t in db.query(Test).filter(Test.stage_id.in_(stage_ids)).all()]


def _stage_position(stages: List[Stage], stage_id: int) -> int:
    """1-based position of a stage within its district (for the 'Stage N' badge)."""
    for i, s in enumerate(stages):
        if s.id == stage_id:
            return i + 1
    return 1


def _serialize_admin_test(db: Session, test: Test, stage_position: int) -> Dict[str, Any]:
    """Serialize a DB Test into the flat shape the admin UI (AdminTestsPage) expects."""
    questions = (
        db.query(Question)
        .filter(Question.test_id == test.id)
        .order_by(Question.order_index)
        .all()
    )
    q_out = []
    for q in questions:
        opts = sorted(q.options, key=lambda o: (o.label or ""))
        opt_map = {(o.label or "").upper(): o.text for o in opts}
        correct = next(((o.label or "").upper() for o in opts if o.is_correct), "A")
        q_out.append({
            "id": q.id,
            "text": q.text,
            "option_a": opt_map.get("A", ""),
            "option_b": opt_map.get("B", ""),
            "option_c": opt_map.get("C", ""),
            "option_d": opt_map.get("D", ""),
            "correct_answer": correct,
            "marks": q.marks,
        })
    return {
        "id": test.id,
        "title": test.title,
        "description": test.description or "",
        "stage_id": stage_position,  # 1-based display position within the district
        "duration_minutes": test.duration_minutes,
        "passing_score_pct": test.passing_score_pct,
        "max_attempts": test.max_attempts,
        "status": test.status or "draft",
        "test_type": test.test_type,
        "scheduled_at": iso_utc(test.scheduled_at),
        "started_at": iso_utc(test.started_at),
        "ended_at": iso_utc(test.ended_at),
        "questions": q_out,
    }


def _guard_questions_replaceable(db: Session, test: Test):
    """
    Refuse to replace a test's questions once real attempts have been submitted.
    Question rows cascade-delete their TestAnswers, which would silently wipe the
    per-question result history of everyone who already took the test.
    """
    submitted = db.query(TestAttempt).filter(
        TestAttempt.test_id == test.id,
        TestAttempt.submitted_at.isnot(None),
    ).first()
    if submitted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This test already has submitted attempts, so its questions can't be "
                "changed without destroying result history. Duplicate the test instead."
            ),
        )


def _replace_questions(db: Session, test: Test, questions: List[Dict[str, Any]]):
    """Replace a test's DB questions/options from the admin flat shape (A–D + correct_answer)."""
    for q in list(test.questions):
        db.delete(q)
    db.flush()
    for idx, q in enumerate(questions):
        question = Question(
            test_id=test.id,
            text=q.get("text", ""),
            marks=q.get("marks", 2) or 2,
            order_index=idx,
        )
        db.add(question)
        db.flush()
        correct = str(q.get("correct_answer", "A")).upper()
        for label in ["A", "B", "C", "D"]:
            db.add(QuestionOption(
                question_id=question.id,
                label=label,
                text=q.get(f"option_{label.lower()}", "") or "",
                is_correct=(label == correct),
            ))
    test.total_questions = len(questions)
    db.flush()


@router.get("/tests")
def get_admin_tests(
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Return all DB tests with questions for admin management (district-scoped)."""
    stages = _district_stages(db, district)
    result = []
    for pos, stage in enumerate(stages, start=1):
        tests = db.query(Test).filter(Test.stage_id == stage.id).order_by(Test.id).all()
        for test in tests:
            result.append(_serialize_admin_test(db, test, pos))
    return result


@router.post("/tests")
def create_test(
    test: Dict[str, Any],
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Create a new DB test under the district's Nth stage."""
    stages = _district_stages(db, district)
    if not stages:
        raise HTTPException(status_code=404, detail="District has no stages to attach a test to")
    pos = int(test.get("stage_id", 1) or 1)
    stage = stages[pos - 1] if 1 <= pos <= len(stages) else stages[0]
    scheduled_at = _parse_client_datetime(test.get("scheduled_at"))
    new_test = Test(
        stage_id=stage.id,
        title=test.get("title", "New Test"),
        description=test.get("description", ""),
        total_questions=0,
        duration_minutes=test.get("duration_minutes", 10),
        passing_score_pct=test.get("passing_score_pct", 70),
        max_attempts=test.get("max_attempts", 3),
        test_type=test.get("test_type"),
        scheduled_at=scheduled_at,
        status="scheduled" if scheduled_at else "draft",
    )
    db.add(new_test)
    db.flush()
    if test.get("questions"):
        _replace_questions(db, new_test, test["questions"])
    db.commit()
    db.refresh(new_test)
    return _serialize_admin_test(db, new_test, _stage_position(stages, new_test.stage_id))


@router.put("/tests/{test_id}")
def update_test(
    test_id: int,
    test: Dict[str, Any],
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Update an existing DB test (and optionally its stage / questions)."""
    db_test = db.query(Test).filter(Test.id == test_id).first()
    if not db_test:
        raise HTTPException(status_code=404, detail="Test not found")

    for key in ["title", "description", "duration_minutes", "passing_score_pct", "max_attempts", "test_type"]:
        if key in test:
            setattr(db_test, key, test[key])

    if "scheduled_at" in test:
        db_test.scheduled_at = _parse_client_datetime(test.get("scheduled_at"))
        if db_test.status == "draft" and db_test.scheduled_at:
            db_test.status = "scheduled"

    stages = _district_stages(db, district)
    if "stage_id" in test and stages:
        pos = int(test["stage_id"] or 1)
        if 1 <= pos <= len(stages):
            db_test.stage_id = stages[pos - 1].id

    if "questions" in test:
        _guard_questions_replaceable(db, db_test)
        _replace_questions(db, db_test, test["questions"])

    db.commit()
    db.refresh(db_test)
    return _serialize_admin_test(db, db_test, _stage_position(stages, db_test.stage_id))


@router.delete("/tests/{test_id}")
def delete_test(
    test_id: int,
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Delete a DB test (questions cascade)."""
    db_test = db.query(Test).filter(Test.id == test_id).first()
    if not db_test:
        raise HTTPException(status_code=404, detail="Test not found")
    db.delete(db_test)
    db.commit()
    return {"message": "Test deleted"}


@router.post("/tests/{test_id}/start")
def start_test(
    test_id: int,
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Start a test — students can only take it while it is active."""
    db_test = db.query(Test).filter(Test.id == test_id).first()
    if not db_test:
        raise HTTPException(status_code=404, detail="Test not found")
    db_test.status = "active"
    db_test.started_at = utcnow()
    db_test.ended_at = None
    db.commit()
    db.refresh(db_test)
    stages = _district_stages(db, district)
    return _serialize_admin_test(db, db_test, _stage_position(stages, db_test.stage_id))


@router.post("/tests/{test_id}/end")
def end_test(
    test_id: int,
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """End a test — blocks any further student attempts."""
    db_test = db.query(Test).filter(Test.id == test_id).first()
    if not db_test:
        raise HTTPException(status_code=404, detail="Test not found")
    db_test.status = "ended"
    db_test.ended_at = utcnow()
    db.commit()
    db.refresh(db_test)
    stages = _district_stages(db, district)
    return _serialize_admin_test(db, db_test, _stage_position(stages, db_test.stage_id))


@router.put("/tests/{test_id}/schedule")
def schedule_test(
    test_id: int,
    payload: Dict[str, Any],
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Set/clear a test's tentative go-live datetime (shown on the user dashboard)."""
    db_test = db.query(Test).filter(Test.id == test_id).first()
    if not db_test:
        raise HTTPException(status_code=404, detail="Test not found")
    db_test.scheduled_at = _parse_client_datetime(payload.get("scheduled_at"))
    if db_test.status in ("draft", "scheduled"):
        db_test.status = "scheduled" if db_test.scheduled_at else "draft"
    db.commit()
    db.refresh(db_test)
    stages = _district_stages(db, district)
    return _serialize_admin_test(db, db_test, _stage_position(stages, db_test.stage_id))


@router.post("/tests/{test_id}/upload-questions")
def upload_questions(
    test_id: int,
    questions: List[Dict[str, Any]],
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Replace a test's questions with parsed rows (from the frontend Excel/CSV parse)."""
    db_test = db.query(Test).filter(Test.id == test_id).first()
    if not db_test:
        raise HTTPException(status_code=404, detail="Test not found")
    _guard_questions_replaceable(db, db_test)
    _replace_questions(db, db_test, questions)
    db.commit()
    db.refresh(db_test)
    stages = _district_stages(db, district)
    return _serialize_admin_test(db, db_test, _stage_position(stages, db_test.stage_id))


def _build_test_results(db: Session, test: Test, questions: List[Question]) -> List[Dict[str, Any]]:
    """
    Build per-student result rows for a test. Uses REAL submitted attempts when they
    exist; otherwise falls back to random/mock rows over MOCK_USERS (demo-only —
    remove the fallback branch for production).
    """
    total_q = len(questions)
    attempts = (
        db.query(TestAttempt)
        .filter(TestAttempt.test_id == test.id, TestAttempt.submitted_at.isnot(None))
        .all()
    )

    if attempts:
        results = []
        for att in attempts:
            answers_by_q = {a.question_id: a for a in att.answers}
            row = {
                "user_name": att.user.full_name if att.user else f"User {att.user_id}",
                "answers": {},
            }
            tc = tw = tu = 0
            for q in questions:
                a = answers_by_q.get(q.id)
                if not a or a.selected_option_id is None:
                    st = "unattempted"; tu += 1
                elif a.is_correct:
                    st = "correct"; tc += 1
                else:
                    st = "wrong"; tw += 1
                row["answers"][f"Q{q.id}"] = st
            row["total_correct"] = tc
            row["total_wrong"] = tw
            row["total_unattempted"] = tu
            row["score_pct"] = round((tc / total_q) * 100, 1) if total_q > 0 else 0
            results.append(row)
        return results

    # Fallback: mock/random demo rows (demo builds only — production returns empty)
    if not settings.SEED_DEMO_DATA:
        return []
    results = []
    for user_name in MOCK_USERS:
        row = {"user_name": user_name, "answers": {}}
        tc = tw = tu = 0
        for q in questions:
            roll = random.random()
            if roll < 0.60:
                st = "correct"; tc += 1
            elif roll < 0.85:
                st = "wrong"; tw += 1
            else:
                st = "unattempted"; tu += 1
            row["answers"][f"Q{q.id}"] = st
        row["total_correct"] = tc
        row["total_wrong"] = tw
        row["total_unattempted"] = tu
        row["score_pct"] = round((tc / total_q) * 100, 1) if total_q > 0 else 0
        results.append(row)
    return results


@router.get("/tests/{test_id}/results")
def get_test_results(
    test_id: int,
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Test results for a specific DB test (real attempts if any, else demo rows)."""
    test = db.query(Test).filter(Test.id == test_id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    questions = (
        db.query(Question).filter(Question.test_id == test_id).order_by(Question.order_index).all()
    )
    return {
        "test_title": test.title,
        "questions": [{"id": q.id, "text": q.text} for q in questions],
        "results": _build_test_results(db, test, questions),
    }


@router.get("/tests/{test_id}/results/download")
def download_test_results_csv(
    test_id: int,
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Download test results as CSV."""
    test = db.query(Test).filter(Test.id == test_id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    questions = (
        db.query(Question).filter(Question.test_id == test_id).order_by(Question.order_index).all()
    )
    results = _build_test_results(db, test, questions)

    output = io.StringIO()
    headers = ["User Name"] + [f"Q{q.id}" for q in questions] + [
        "Total Correct", "Total Wrong", "Total Unattempted", "Score %"
    ]
    output.write(",".join(headers) + "\n")
    for r in results:
        row = [r["user_name"]]
        for q in questions:
            row.append(r["answers"].get(f"Q{q.id}", "unattempted").capitalize())
        row.extend([
            str(r["total_correct"]), str(r["total_wrong"]),
            str(r["total_unattempted"]), str(r["score_pct"]),
        ])
        output.write(",".join(row) + "\n")

    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="test_{test_id}_results.csv"'}
    )


# ──────────────────────────────────────────────
# Live Monitoring REST Endpoints
# ──────────────────────────────────────────────

from sqlalchemy.orm import joinedload
from app.models_live import LiveSession, ActivityEvent, SuspiciousFlag, AdminAction as AdminActionModel
from app.event_processor import build_candidate_state_from_session


class FlagRequest(BaseModel):
    notes: str = ""

class WarningRequest(BaseModel):
    message: str = "You have been warned by the administrator."

class NoteRequest(BaseModel):
    notes: str


@router.get("/tests/{test_id}/live/candidates")
def get_live_candidates(
    test_id: int,
    search: str = Query("", description="Search by name or email"),
    sort_by: str = Query("risk_score", description="Sort field"),
    sort_order: str = Query("desc", description="asc or desc"),
    status_filter: str = Query("", description="Filter by status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=10, le=200),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """
    Paginated list of all LiveSessions for an active test.
    Supports search, sort, and status filtering.
    """
    query = db.query(LiveSession).options(
        joinedload(LiveSession.user)
    ).filter(LiveSession.test_id == test_id)

    # Status filter
    if status_filter:
        statuses = [s.strip() for s in status_filter.split(",") if s.strip()]
        if statuses:
            query = query.filter(LiveSession.status.in_(statuses))

    # Search by user name or email
    if search:
        query = query.join(User).filter(
            (User.full_name.ilike(f"%{search}%")) |
            (User.email.ilike(f"%{search}%"))
        )

    # Total count before pagination
    total = query.count()

    # Sort
    sort_columns = {
        "risk_score": LiveSession.risk_score,
        "time_remaining": LiveSession.remaining_seconds,
        "questions_attempted": LiveSession.questions_attempted,
        "accuracy": LiveSession.accuracy_pct,
        "status": LiveSession.status,
        "connected_at": LiveSession.connected_at,
        "tab_switch_count": LiveSession.tab_switch_count,
    }
    sort_col = sort_columns.get(sort_by, LiveSession.risk_score)
    if sort_order == "asc":
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    # Paginate
    offset = (page - 1) * page_size
    sessions = query.offset(offset).limit(page_size).all()

    candidates = [build_candidate_state_from_session(s) for s in sessions]

    return {
        "candidates": candidates,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/tests/{test_id}/live/stats")
def get_live_stats(
    test_id: int,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """
    Aggregate statistics for the live monitoring dashboard.
    """
    sessions = db.query(LiveSession).filter(LiveSession.test_id == test_id).all()

    total = len(sessions)
    active = sum(1 for s in sessions if s.status == "active")
    idle = sum(1 for s in sessions if s.status == "idle")
    disconnected = sum(1 for s in sessions if s.status == "disconnected")
    submitted = sum(1 for s in sessions if s.status in ("submitted", "auto_submitted"))
    not_started = sum(1 for s in sessions if s.status == "not_started")
    flagged = sum(1 for s in sessions if s.is_flagged)
    high_risk = sum(1 for s in sessions if (s.risk_score or 0) >= 50)
    medium_risk = sum(1 for s in sessions if 20 <= (s.risk_score or 0) < 50)

    avg_progress = 0
    avg_accuracy = 0
    if total > 0:
        total_attempted = sum(s.questions_attempted or 0 for s in sessions)
        total_questions = sum(s.total_questions or 0 for s in sessions)
        avg_progress = round((total_attempted / total_questions * 100), 1) if total_questions > 0 else 0

        accuracies = [s.accuracy_pct or 0 for s in sessions if (s.questions_attempted or 0) > 0]
        avg_accuracy = round(sum(accuracies) / len(accuracies), 1) if accuracies else 0

    return {
        "total_candidates": total,
        "active": active,
        "idle": idle,
        "disconnected": disconnected,
        "submitted": submitted,
        "not_started": not_started,
        "flagged": flagged,
        "high_risk": high_risk,
        "medium_risk": medium_risk,
        "avg_progress": avg_progress,
        "avg_accuracy": avg_accuracy,
    }


@router.get("/tests/{test_id}/live/candidate/{session_id}")
def get_candidate_detail(
    test_id: int,
    session_id: int,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """
    Detailed view of a single candidate, including their event timeline
    and suspicious flags.
    """
    session = db.query(LiveSession).options(
        joinedload(LiveSession.user),
        joinedload(LiveSession.suspicious_flags),
        joinedload(LiveSession.admin_actions),
    ).filter(
        LiveSession.id == session_id,
        LiveSession.test_id == test_id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get recent events (last 100)
    events = db.query(ActivityEvent).filter(
        ActivityEvent.session_id == session_id
    ).order_by(ActivityEvent.timestamp.desc()).limit(100).all()

    state = build_candidate_state_from_session(session)

    state["events"] = [
        {
            "id": e.id,
            "event_type": e.event_type,
            "question_id": e.question_id,
            "payload": e.payload,
            "timestamp": e.timestamp.isoformat() if e.timestamp else None,
        }
        for e in reversed(events)
    ]

    state["suspicious_flags"] = [
        {
            "id": f.id,
            "rule_name": f.rule_name,
            "severity": f.severity,
            "details": f.details,
            "detected_at": f.detected_at.isoformat() if f.detected_at else None,
        }
        for f in session.suspicious_flags
    ]

    state["admin_actions"] = [
        {
            "id": a.id,
            "action_type": a.action_type,
            "admin_email": a.admin_email,
            "notes": a.notes,
            "timestamp": a.timestamp.isoformat() if a.timestamp else None,
        }
        for a in session.admin_actions
    ]

    state["answer_state"] = session.answer_state or {}
    state["navigation_pattern"] = session.navigation_pattern or []

    return state


@router.post("/tests/{test_id}/live/candidate/{session_id}/flag")
def flag_candidate(
    test_id: int,
    session_id: int,
    req: FlagRequest,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Flag a candidate."""
    session = db.query(LiveSession).filter(
        LiveSession.id == session_id,
        LiveSession.test_id == test_id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.is_flagged = True
    session.flag_reason = req.notes or "Flagged by admin"

    action = AdminActionModel(
        session_id=session.id,
        admin_email=admin_email,
        action_type="FLAG",
        notes=req.notes,
    )
    db.add(action)
    db.commit()

    return {"message": "Candidate flagged", "session_id": session_id}


@router.post("/tests/{test_id}/live/candidate/{session_id}/warn")
def warn_candidate(
    test_id: int,
    session_id: int,
    req: WarningRequest,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Send a warning to a candidate."""
    session = db.query(LiveSession).filter(
        LiveSession.id == session_id,
        LiveSession.test_id == test_id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    action = AdminActionModel(
        session_id=session.id,
        admin_email=admin_email,
        action_type="SEND_WARNING",
        notes=req.message,
    )
    db.add(action)
    db.commit()

    # The actual WebSocket warning is sent via the admin WS endpoint
    return {"message": "Warning recorded", "session_id": session_id}


@router.post("/tests/{test_id}/live/candidate/{session_id}/force-submit")
def force_submit_candidate(
    test_id: int,
    session_id: int,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Force submit a candidate's test."""
    session = db.query(LiveSession).filter(
        LiveSession.id == session_id,
        LiveSession.test_id == test_id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.status = "auto_submitted"

    action = AdminActionModel(
        session_id=session.id,
        admin_email=admin_email,
        action_type="FORCE_SUBMIT",
        notes="Force submitted by admin",
    )
    db.add(action)
    db.commit()

    return {"message": "Test force-submitted", "session_id": session_id}


@router.post("/tests/{test_id}/live/candidate/{session_id}/notes")
def add_candidate_note(
    test_id: int,
    session_id: int,
    req: NoteRequest,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Add a violation note to a candidate."""
    session = db.query(LiveSession).filter(
        LiveSession.id == session_id,
        LiveSession.test_id == test_id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    action = AdminActionModel(
        session_id=session.id,
        admin_email=admin_email,
        action_type="ADD_NOTE",
        notes=req.notes,
    )
    db.add(action)
    db.commit()

    return {"message": "Note added", "session_id": session_id}


# ──────────────────────────────────────────────
# Tutorial Tracking (watch time/%, quiz engagement, performance score)
# ──────────────────────────────────────────────

from sqlalchemy import func as sa_func

# Performance score = how honestly/thoroughly the user consumed the tutorials:
#   60% average watch percentage across all tutorials
#   20% quiz participation (answered instead of skipped, over quiz-enabled tutorials)
#   20% quiz accuracy (correct answers over questions answered)
# If a district has no quiz-enabled tutorials the score is just the watch average.
PERF_WEIGHT_WATCH = 0.6
PERF_WEIGHT_PARTICIPATION = 0.2
PERF_WEIGHT_ACCURACY = 0.2


def _district_stage_tutorials(db: Session, slug: str) -> List[tuple]:
    """[(stage, tutorial), ...] for a district, in phase + tutorial order."""
    out = []
    for stage in _district_stages(db, slug):
        tutorials = db.query(Tutorial).filter(
            Tutorial.stage_id == stage.id
        ).order_by(Tutorial.order_index).all()
        out.extend((stage, t) for t in tutorials)
    return out


def _performance_score(avg_watch_pct: float, participation_pct: float,
                       accuracy_pct: float, has_quizzes: bool) -> float:
    if not has_quizzes:
        return round(avg_watch_pct, 1)
    return round(
        PERF_WEIGHT_WATCH * avg_watch_pct
        + PERF_WEIGHT_PARTICIPATION * participation_pct
        + PERF_WEIGHT_ACCURACY * accuracy_pct,
        1,
    )


def _build_tutorial_tracking(db: Session, pd: ProgramDistrict) -> tuple:
    """(tutorials_meta, user_rows) powering /tutorial-tracking and /results."""
    stage_tutorials = _district_stage_tutorials(db, pd.slug)
    tutorial_ids = [t.id for _, t in stage_tutorials]

    quiz_counts: Dict[int, int] = {}
    if tutorial_ids:
        quiz_counts = dict(
            db.query(TutorialQuestion.tutorial_id, sa_func.count(TutorialQuestion.id))
            .filter(TutorialQuestion.tutorial_id.in_(tutorial_ids))
            .group_by(TutorialQuestion.tutorial_id)
            .all()
        )

    tutorials_meta = []
    for stage, t in stage_tutorials:
        has_quiz = (
            bool(stage.quiz_enabled) and bool(t.quiz_enabled)
            and quiz_counts.get(t.id, 0) > 0
        )
        tutorials_meta.append({
            "id": t.id,
            "title": t.title,
            "module_number": t.module_number or "",
            "stage_id": stage.id,
            "stage_title": stage.title,
            "stage_order": stage.order_index,
            "duration_minutes": t.duration_minutes or 0,
            "quiz_question_count": quiz_counts.get(t.id, 0),
            "has_quiz": has_quiz,
        })

    users = db.query(User).filter(
        User.program_district_id == pd.id,
        User.is_admin == False,  # noqa: E712
    ).order_by(User.full_name).all()

    progress_map: Dict[tuple, UserTutorialProgress] = {}
    if tutorial_ids and users:
        rows = db.query(UserTutorialProgress).filter(
            UserTutorialProgress.tutorial_id.in_(tutorial_ids),
            UserTutorialProgress.user_id.in_([u.id for u in users]),
        ).all()
        progress_map = {(r.user_id, r.tutorial_id): r for r in rows}

    quiz_tutorials = [m for m in tutorials_meta if m["has_quiz"]]

    user_rows = []
    for u in users:
        per_tutorial = {}
        watch_pcts = []
        total_watch_time = 0.0
        completed_count = 0
        quizzes_completed = 0
        quizzes_skipped = 0
        quiz_correct_total = 0.0
        quiz_question_total = 0

        for meta in tutorials_meta:
            p = progress_map.get((u.id, meta["id"]))
            watch_pct = round(p.watch_pct, 1) if p else 0.0
            watch_pcts.append(watch_pct)
            total_watch_time += p.watch_time_seconds if p else 0.0
            if p and p.is_completed:
                completed_count += 1
            quiz_status = p.quiz_status if p else "pending"
            if meta["has_quiz"]:
                if quiz_status == "completed":
                    quizzes_completed += 1
                    quiz_correct_total += p.quiz_score or 0
                    quiz_question_total += p.quiz_total or 0
                elif quiz_status == "skipped":
                    quizzes_skipped += 1
            per_tutorial[str(meta["id"])] = {
                "watch_time_seconds": round(p.watch_time_seconds, 1) if p else 0,
                "watch_pct": watch_pct,
                "is_completed": bool(p and p.is_completed),
                "completed_at": p.completed_at.isoformat() if p and p.completed_at else None,
                "quiz_status": quiz_status if meta["has_quiz"] else "n/a",
                "quiz_score": p.quiz_score if p else None,
                "quiz_total": p.quiz_total if p else None,
            }

        avg_watch_pct = round(sum(watch_pcts) / len(watch_pcts), 1) if watch_pcts else 0.0
        participation_pct = (
            round(quizzes_completed / len(quiz_tutorials) * 100, 1) if quiz_tutorials else 0.0
        )
        accuracy_pct = (
            round(quiz_correct_total / quiz_question_total * 100, 1) if quiz_question_total else 0.0
        )

        user_rows.append({
            "user_id": u.id,
            "name": u.full_name or u.email,
            "email": u.email,
            "tutorials": per_tutorial,
            "summary": {
                "tutorials_completed": completed_count,
                "total_tutorials": len(tutorials_meta),
                "avg_watch_pct": avg_watch_pct,
                "total_watch_time_seconds": round(total_watch_time, 1),
                "quizzes_completed": quizzes_completed,
                "quizzes_skipped": quizzes_skipped,
                "quizzes_pending": max(0, len(quiz_tutorials) - quizzes_completed - quizzes_skipped),
                "quiz_participation_pct": participation_pct,
                "quiz_accuracy_pct": accuracy_pct,
                "performance_score": _performance_score(
                    avg_watch_pct, participation_pct, accuracy_pct, bool(quiz_tutorials)
                ),
            },
        })

    return tutorials_meta, user_rows


@router.get("/tutorial-tracking")
def get_tutorial_tracking(
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """
    Per-user tutorial engagement for a district: watch time, watch %, quiz
    results (or skipped), and the composite performance score.
    """
    pd = _get_district_or_404(db, district)
    tutorials_meta, user_rows = _build_tutorial_tracking(db, pd)
    return {
        "district": pd.slug,
        "district_name": pd.name,
        "tutorials": tutorials_meta,
        "users": user_rows,
    }


# ──────────────────────────────────────────────
# Live Monitoring Report Export
# ──────────────────────────────────────────────

@router.get("/tests/{test_id}/live/export")
def export_live_report(
    test_id: int,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """
    Full performance + anti-cheat report for every candidate session of a test.
    Returns JSON rows; the admin UI turns them into a styled Excel sheet.
    """
    test = db.query(Test).filter(Test.id == test_id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    sessions = db.query(LiveSession).options(
        joinedload(LiveSession.user),
        joinedload(LiveSession.suspicious_flags),
    ).filter(LiveSession.test_id == test_id).order_by(LiveSession.risk_score.desc()).all()

    attempt_ids = [s.attempt_id for s in sessions]
    attempts = {
        a.id: a for a in db.query(TestAttempt).filter(TestAttempt.id.in_(attempt_ids)).all()
    } if attempt_ids else {}

    rows = []
    for s in sessions:
        att = attempts.get(s.attempt_id)
        rows.append({
            "candidate_name": s.user.full_name if s.user else f"User {s.user_id}",
            "email": s.user.email if s.user else "",
            "status": s.status,
            "ip_address": s.ip_address or "",
            "connected_at": s.connected_at.isoformat() if s.connected_at else None,
            "questions_attempted": s.questions_attempted or 0,
            "total_questions": s.total_questions or 0,
            "correct_answers": s.correct_answers or 0,
            "wrong_answers": s.wrong_answers or 0,
            "accuracy_pct": s.accuracy_pct or 0,
            "time_spent_seconds": s.time_spent_seconds or 0,
            "avg_time_per_question_ms": s.avg_time_per_question_ms or 0,
            "fastest_question_ms": s.fastest_question_ms,
            "slowest_question_ms": s.slowest_question_ms,
            "tab_switch_count": s.tab_switch_count or 0,
            "fullscreen_exit_count": s.fullscreen_exit_count or 0,
            "window_blur_count": s.window_blur_count or 0,
            "copy_paste_count": s.copy_paste_count or 0,
            "question_switch_count": s.question_switch_count or 0,
            "idle_periods": s.idle_periods or 0,
            "risk_score": s.risk_score or 0,
            "is_flagged": bool(s.is_flagged),
            "flag_reason": s.flag_reason or "",
            "suspicious_flags": "; ".join(
                f"{f.rule_name} ({f.severity})" for f in s.suspicious_flags
            ),
            "final_score_pct": att.score if att else None,
            "is_passed": bool(att.is_passed) if att and att.submitted_at else None,
            "submitted_at": att.submitted_at.isoformat() if att and att.submitted_at else None,
        })

    return {
        "test_id": test_id,
        "test_title": test.title,
        "generated_at": datetime.utcnow().isoformat(),
        "rows": rows,
    }


# ──────────────────────────────────────────────
# Results Section (combined table + face-to-face selection)
# ──────────────────────────────────────────────

class FaceToFaceUploadRequest(BaseModel):
    emails: List[str]
    notify: bool = True


FACE_TO_FACE_NOTIFICATION_TITLE = "Selected for Face-to-Face Training"


@router.get("/results")
def get_combined_results(
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """
    Combined per-user results for a district: tutorial engagement (watch %,
    quizzes, performance score) + every test (score, attempts, anti-cheat
    summary) + flow completion + face-to-face selection status.
    """
    pd = _get_district_or_404(db, district)
    tutorials_meta, user_rows = _build_tutorial_tracking(db, pd)

    stages = _district_stages(db, pd.slug)
    stage_ids = [s.id for s in stages]
    tests = db.query(Test).join(Stage, Test.stage_id == Stage.id).filter(
        Test.stage_id.in_(stage_ids)
    ).order_by(Stage.order_index).all() if stage_ids else []
    test_ids = [t.id for t in tests]

    user_ids = [r["user_id"] for r in user_rows]

    attempts_by_user_test: Dict[tuple, List[TestAttempt]] = {}
    if user_ids and test_ids:
        for att in db.query(TestAttempt).filter(
            TestAttempt.user_id.in_(user_ids),
            TestAttempt.test_id.in_(test_ids),
            TestAttempt.submitted_at.isnot(None),
        ).all():
            attempts_by_user_test.setdefault((att.user_id, att.test_id), []).append(att)

    sessions_by_user_test: Dict[tuple, List[LiveSession]] = {}
    if user_ids and test_ids:
        for s in db.query(LiveSession).filter(
            LiveSession.user_id.in_(user_ids),
            LiveSession.test_id.in_(test_ids),
        ).all():
            sessions_by_user_test.setdefault((s.user_id, s.test_id), []).append(s)

    selections = {
        sel.user_id: sel for sel in db.query(FaceToFaceSelection).filter(
            FaceToFaceSelection.user_id.in_(user_ids)
        ).all()
    } if user_ids else {}

    for row in user_rows:
        uid = row["user_id"]
        tests_out = {}
        all_submitted = True
        for t in tests:
            atts = attempts_by_user_test.get((uid, t.id), [])
            sessions = sessions_by_user_test.get((uid, t.id), [])
            if not atts:
                all_submitted = False
            tests_out[str(t.id)] = {
                "attempts_count": len(atts),
                "best_score": max((a.score or 0) for a in atts) if atts else None,
                "is_passed": any(a.is_passed for a in atts),
                "last_submitted_at": max(
                    (a.submitted_at for a in atts), default=None
                ).isoformat() if atts else None,
                "max_risk_score": max((s.risk_score or 0) for s in sessions) if sessions else 0,
                "tab_switches": sum(s.tab_switch_count or 0 for s in sessions),
                "fullscreen_exits": sum(s.fullscreen_exit_count or 0 for s in sessions),
                "copy_paste_events": sum(s.copy_paste_count or 0 for s in sessions),
                "was_flagged": any(s.is_flagged for s in sessions),
            }
        summary = row["summary"]
        completed_flow = (
            summary["tutorials_completed"] == summary["total_tutorials"]
            and summary["total_tutorials"] > 0
            and bool(tests) and all_submitted
        )
        selection = selections.get(uid)
        row["tests"] = tests_out
        row["completed_flow"] = completed_flow
        row["face_to_face"] = {
            "selected": selection is not None,
            "selected_at": selection.selected_at.isoformat() if selection and selection.selected_at else None,
            "notified": bool(selection.notified) if selection else False,
        }

    return {
        "district": pd.slug,
        "district_name": pd.name,
        "tutorials": tutorials_meta,
        "tests": [
            {"id": t.id, "title": t.title, "test_type": t.test_type, "status": t.status}
            for t in tests
        ],
        "users": user_rows,
    }


@router.get("/results/face-to-face")
def list_face_to_face_selections(
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Users currently selected for face-to-face training in a district."""
    pd = _get_district_or_404(db, district)
    selections = db.query(FaceToFaceSelection).join(
        User, FaceToFaceSelection.user_id == User.id
    ).filter(User.program_district_id == pd.id).order_by(FaceToFaceSelection.selected_at).all()
    return [
        {
            "user_id": sel.user_id,
            "name": sel.user.full_name or sel.user.email,
            "email": sel.user.email,
            "uploaded_by": sel.uploaded_by,
            "notified": sel.notified,
            "selected_at": sel.selected_at.isoformat() if sel.selected_at else None,
        }
        for sel in selections
    ]


@router.post("/results/face-to-face/upload")
def upload_face_to_face_selection(
    payload: FaceToFaceUploadRequest,
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """
    Register the admin-uploaded list of users selected for face-to-face
    training (the Excel sheet is parsed to emails client-side) and notify each
    newly selected user to await further instructions.
    """
    pd = _get_district_or_404(db, district)
    district_users = db.query(User).filter(User.program_district_id == pd.id).all()
    by_email = {u.email.lower(): u for u in district_users}

    seen = set()
    matched, unmatched, already_selected = [], [], []
    for raw in payload.emails:
        email = (raw or "").strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        user = by_email.get(email)
        if not user:
            unmatched.append(email)
            continue
        existing = db.query(FaceToFaceSelection).filter(
            FaceToFaceSelection.user_id == user.id
        ).first()
        if existing:
            # A selection may linger from a district the user was previously in.
            # Re-home it to the current district (and notify if not yet notified)
            # rather than reporting a confusing "already selected".
            if existing.program_district_id != pd.id:
                existing.program_district_id = pd.id
                existing.uploaded_by = admin_email
                if payload.notify and not existing.notified:
                    existing.notified = True
                    db.add(Notification(
                        user_id=user.id,
                        title=FACE_TO_FACE_NOTIFICATION_TITLE,
                        message=(
                            "Congratulations! You have been selected for the face-to-face "
                            "training. Please await further instructions."
                        ),
                    ))
                    matched.append(email)
                    continue
            already_selected.append(email)
            continue
        db.add(FaceToFaceSelection(
            user_id=user.id,
            program_district_id=pd.id,
            uploaded_by=admin_email,
            notified=payload.notify,
        ))
        if payload.notify:
            db.add(Notification(
                user_id=user.id,
                title=FACE_TO_FACE_NOTIFICATION_TITLE,
                message=(
                    "Congratulations! You have been selected for the face-to-face "
                    "training. Please await further instructions."
                ),
            ))
        matched.append(email)
    db.commit()

    return {
        "matched": matched,
        "unmatched": unmatched,
        "already_selected": already_selected,
        "notified_count": len(matched) if payload.notify else 0,
    }


@router.delete("/results/face-to-face/{user_id}")
def remove_face_to_face_selection(
    user_id: int,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Remove a user from the face-to-face selection list."""
    selection = db.query(FaceToFaceSelection).filter(
        FaceToFaceSelection.user_id == user_id
    ).first()
    if not selection:
        raise HTTPException(status_code=404, detail="Selection not found")
    db.delete(selection)
    db.commit()
    return {"message": "Selection removed", "user_id": user_id}

