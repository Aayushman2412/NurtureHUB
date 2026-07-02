"""
Admin API routes for NurtureHUB.
Provides admin login, district management, form config, tutorial/stage management,
test management, and results export.
All content endpoints are scoped per program district.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime
import json
import io
import random
import re

from app.database import get_db
from app.models import User, ProgramDistrict
from app.auth import verify_password, create_access_token

router = APIRouter(prefix="/api/admin", tags=["admin"])

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
@router.post("/login", response_model=AdminLoginResponse)
def admin_login(credentials: AdminLoginRequest, db: Session = Depends(get_db)):
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
def list_districts(db: Session = Depends(get_db)):
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
def create_district(data: ProgramDistrictCreate, db: Session = Depends(get_db)):
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

    # Initialize empty mock data for this district
    MOCK_FORM_CONFIG[slug] = _default_form_config()
    MOCK_STAGES[slug] = []
    MOCK_TESTS[slug] = []

    return ProgramDistrictSchema(id=district.id, name=district.name, slug=district.slug, is_active=district.is_active, user_count=0)


@router.put("/districts/{district_id}")
def update_district(district_id: int, data: ProgramDistrictCreate, db: Session = Depends(get_db)):
    """Update a program district."""
    district = db.query(ProgramDistrict).filter(ProgramDistrict.id == district_id).first()
    if not district:
        raise HTTPException(status_code=404, detail="District not found")

    old_slug = district.slug
    new_slug = _slugify(data.name)
    district.name = data.name
    district.slug = new_slug
    db.commit()

    # Migrate mock data keys
    if old_slug != new_slug:
        for store in [MOCK_FORM_CONFIG, MOCK_STAGES, MOCK_TESTS]:
            if old_slug in store:
                store[new_slug] = store.pop(old_slug)

    return {"id": district.id, "name": district.name, "slug": district.slug, "is_active": district.is_active}


@router.delete("/districts/{district_id}")
def delete_district(district_id: int, db: Session = Depends(get_db)):
    """Delete a program district."""
    district = db.query(ProgramDistrict).filter(ProgramDistrict.id == district_id).first()
    if not district:
        raise HTTPException(status_code=404, detail="District not found")

    slug = district.slug
    # Unassign users
    db.query(User).filter(User.program_district_id == district_id).update({User.program_district_id: None})
    db.delete(district)
    db.commit()

    # Clean up mock data
    for store in [MOCK_FORM_CONFIG, MOCK_STAGES, MOCK_TESTS]:
        store.pop(slug, None)

    return {"message": "District deleted"}


# ──────────────────────────────────────────────
# User-District Assignment
# ──────────────────────────────────────────────
@router.get("/users")
def list_users_for_admin(db: Session = Depends(get_db)):
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
def assign_user_district(user_id: int, data: UserDistrictAssign, db: Session = Depends(get_db)):
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
def get_dashboard_stats(district: str = Query("", description="District slug"), db: Session = Depends(get_db)):
    """Return admin dashboard statistics scoped to a district."""
    district_name = ""
    total_users = 0

    if district:
        pd = db.query(ProgramDistrict).filter(ProgramDistrict.slug == district).first()
        if pd:
            district_name = pd.name
            total_users = db.query(User).filter(User.program_district_id == pd.id).count()

    stages = MOCK_STAGES.get(district, [])
    tests = MOCK_TESTS.get(district, [])
    form_fields = MOCK_FORM_CONFIG.get(district, [])

    total_tutorials = sum(len(s.get("tutorials", [])) for s in stages)
    active_tests = sum(1 for t in tests if t.get("status") == "active")

    return DashboardStats(
        total_users=total_users,
        total_stages=len(stages),
        total_tutorials=total_tutorials,
        total_tests=len(tests),
        total_form_fields=len(form_fields),
        active_tests=active_tests,
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

MOCK_STAGES: Dict[str, List[Dict[str, Any]]] = {
    "jalna": [
        {
            "id": 1, "title": "Foundation Skills for ICDS Workers",
            "description": "Master the core concepts of child growth monitoring, immunization, and community counseling.",
            "order_index": 0,
            "tutorials": [
                {"id": 1, "title": "Introduction to Child Development Tracker", "description": "Learn how to record developmental milestones.", "module_number": "Module 1.1", "duration_minutes": 5, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 120, "order_index": 0},
                {"id": 2, "title": "Nutrition & Growth Standards", "description": "Understand the WHO growth standards.", "module_number": "Module 1.2", "duration_minutes": 8, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 30, "end_seconds": 300, "order_index": 1},
                {"id": 3, "title": "Early Stimulation Play Practices", "description": "Guide parents on simple home activities.", "module_number": "Module 1.3", "duration_minutes": 6, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 180, "order_index": 2},
            ]
        },
        {
            "id": 2, "title": "Advanced Nutritional Interventions",
            "description": "Handle micro-nutrient deficiency, SAM, MAM, and coordinate medical referrals.",
            "order_index": 1,
            "tutorials": [
                {"id": 4, "title": "Micro-Nutrient Supplements Guide", "description": "Proper dosing schedules.", "module_number": "Module 2.1", "duration_minutes": 10, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 300, "order_index": 0},
                {"id": 5, "title": "Severe Acute Malnutrition Management", "description": "How to perform appetite tests.", "module_number": "Module 2.2", "duration_minutes": 12, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 60, "end_seconds": 420, "order_index": 1},
            ]
        },
        {
            "id": 3, "title": "Community Engagement & Counseling",
            "description": "Build communication skills to influence parent behaviors.",
            "order_index": 2,
            "tutorials": [
                {"id": 6, "title": "Home Visit Strategies & Checklists", "description": "Structuring home visits.", "module_number": "Module 3.1", "duration_minutes": 9, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 240, "order_index": 0},
                {"id": 7, "title": "Counseling Mothers on Breastfeeding", "description": "Effective latching positions.", "module_number": "Module 3.2", "duration_minutes": 15, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 10, "end_seconds": 600, "order_index": 1},
            ]
        }
    ],
    "ujjain": [
        {
            "id": 1, "title": "Maternal Health Essentials",
            "description": "Learn antenatal care, safe delivery practices, and postnatal follow-up protocols.",
            "order_index": 0,
            "tutorials": [
                {"id": 1, "title": "Antenatal Care Visits Protocol", "description": "Understand the ANC schedule and referral criteria.", "module_number": "Module 1.1", "duration_minutes": 7, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 180, "order_index": 0},
                {"id": 2, "title": "Iron-Folic Acid Supplementation", "description": "Dosage, timing, and side effects.", "module_number": "Module 1.2", "duration_minutes": 6, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 150, "order_index": 1},
                {"id": 3, "title": "Birth Preparedness", "description": "Creating birth plans with families.", "module_number": "Module 1.3", "duration_minutes": 9, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 240, "order_index": 2},
            ]
        },
        {
            "id": 2, "title": "Immunization & Vaccine Schedule",
            "description": "Master the National Immunization Schedule and cold-chain management.",
            "order_index": 1,
            "tutorials": [
                {"id": 4, "title": "National Immunization Schedule", "description": "Complete vaccine schedule.", "module_number": "Module 2.1", "duration_minutes": 10, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 300, "order_index": 0},
                {"id": 5, "title": "Cold Chain Management", "description": "Proper storage and monitoring.", "module_number": "Module 2.2", "duration_minutes": 8, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 240, "order_index": 1},
            ]
        },
        {
            "id": 3, "title": "Infant & Young Child Feeding",
            "description": "Evidence-based breastfeeding, complementary feeding, and growth monitoring.",
            "order_index": 2,
            "tutorials": [
                {"id": 6, "title": "Exclusive Breastfeeding Promotion", "description": "Counseling for 6-month exclusive BF.", "module_number": "Module 3.1", "duration_minutes": 11, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 300, "order_index": 0},
                {"id": 7, "title": "Complementary Feeding Guidelines", "description": "Age-appropriate food introduction.", "module_number": "Module 3.2", "duration_minutes": 13, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 360, "order_index": 1},
            ]
        }
    ],
    "meghalaya": [
        {
            "id": 1, "title": "Tribal Health & Traditional Practices",
            "description": "Understanding health challenges in tribal/hill communities and integrating traditional knowledge.",
            "order_index": 0,
            "tutorials": [
                {"id": 1, "title": "Health Challenges in Hill Communities", "description": "Common health issues in hilly tribal regions.", "module_number": "Module 1.1", "duration_minutes": 8, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 200, "order_index": 0},
                {"id": 2, "title": "Bridging Traditional & Modern Practices", "description": "Integrating traditional healing with evidence-based care.", "module_number": "Module 1.2", "duration_minutes": 10, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 300, "order_index": 1},
            ]
        },
        {
            "id": 2, "title": "Nutrition in Hill Regions",
            "description": "Addressing malnutrition using locally available foods and government nutrition programs.",
            "order_index": 1,
            "tutorials": [
                {"id": 3, "title": "Locally Available Nutritious Foods", "description": "Indigenous foods rich in nutrients.", "module_number": "Module 2.1", "duration_minutes": 7, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 180, "order_index": 0},
                {"id": 4, "title": "ICDS Supplementary Nutrition Program", "description": "THR distribution and nutrition counseling.", "module_number": "Module 2.2", "duration_minutes": 9, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 240, "order_index": 1},
            ]
        },
        {
            "id": 3, "title": "Community Outreach in Remote Areas",
            "description": "Strategies for reaching remote villages, mobile health camps, and community mobilization.",
            "order_index": 2,
            "tutorials": [
                {"id": 5, "title": "Planning Mobile Health Camps", "description": "Logistics for health camps in remote villages.", "module_number": "Module 3.1", "duration_minutes": 10, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 300, "order_index": 0},
                {"id": 6, "title": "Community Mobilization Techniques", "description": "Working with village headmen and SHGs.", "module_number": "Module 3.2", "duration_minutes": 12, "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "start_seconds": 0, "end_seconds": 360, "order_index": 1},
            ]
        }
    ],
}

MOCK_TESTS: Dict[str, List[Dict[str, Any]]] = {
    "jalna": [
        {"id": 1, "title": "Stage 1 Assessment: Foundations", "description": "Test child growth monitoring knowledge.", "stage_id": 1, "duration_minutes": 10, "passing_score_pct": 70, "max_attempts": 3, "status": "draft", "started_at": None, "ended_at": None,
         "questions": [
             {"id": 1, "text": "What is the primary indicator for assessing wasting in WHO charts?", "option_a": "Weight-for-height", "option_b": "Height-for-age", "option_c": "Head circumference", "option_d": "MUAC only", "correct_answer": "A", "marks": 2},
             {"id": 2, "text": "At what age should complementary feeding start?", "option_a": "3 months", "option_b": "6 months", "option_c": "12 months", "option_d": "When first tooth appears", "correct_answer": "B", "marks": 2},
             {"id": 3, "text": "Which milestone is expected by 12 months?", "option_a": "Running steadily", "option_b": "Standing alone / first steps", "option_c": "Full sentences", "option_d": "Drawing shapes", "correct_answer": "B", "marks": 2},
         ]},
        {"id": 2, "title": "Stage 2 Assessment: Advanced Nutrition", "description": "Test supplementation and SAM protocols.", "stage_id": 2, "duration_minutes": 8, "passing_score_pct": 70, "max_attempts": 3, "status": "draft", "started_at": None, "ended_at": None,
         "questions": [
             {"id": 4, "text": "MUAC threshold for SAM in children 6-59 months?", "option_a": "Less than 11.5 cm", "option_b": "Between 11.5 and 12.5 cm", "option_c": "Less than 13.5 cm", "option_d": "Only weight-based", "correct_answer": "A", "marks": 2},
             {"id": 5, "text": "How often should Vitamin A be given (12-59 months)?", "option_a": "Monthly", "option_b": "Every 6 months", "option_c": "Yearly", "option_d": "Only for deficiency", "correct_answer": "B", "marks": 2},
         ]},
        {"id": 3, "title": "Stage 3 Assessment: Community & Counseling", "description": "Validate counseling and home visit skills.", "stage_id": 3, "duration_minutes": 10, "passing_score_pct": 70, "max_attempts": 3, "status": "draft", "started_at": None, "ended_at": None,
         "questions": [
             {"id": 6, "text": "Most effective counseling technique for home visits?", "option_a": "Lecturing", "option_b": "Active listening & problem solving", "option_c": "Dropping brochures", "option_d": "Fining families", "correct_answer": "B", "marks": 2},
             {"id": 7, "text": "What is colostrum?", "option_a": "Formula milk", "option_b": "First nutrient-rich breastmilk after birth", "option_c": "A micro-nutrient tablet", "option_d": "A sanitation solution", "correct_answer": "B", "marks": 2},
         ]},
    ],
    "ujjain": [
        {"id": 1, "title": "Stage 1 Assessment: Maternal Health", "description": "Test ANC and birth preparedness knowledge.", "stage_id": 1, "duration_minutes": 8, "passing_score_pct": 70, "max_attempts": 3, "status": "draft", "started_at": None, "ended_at": None,
         "questions": [
             {"id": 1, "text": "Minimum recommended ANC visits during pregnancy?", "option_a": "2 visits", "option_b": "4 visits", "option_c": "6 visits", "option_d": "Only at delivery", "correct_answer": "B", "marks": 2},
             {"id": 2, "text": "Which is a danger sign requiring immediate referral?", "option_a": "Mild nausea", "option_b": "Severe headache with blurred vision", "option_c": "Occasional fatigue", "option_d": "Increased appetite", "correct_answer": "B", "marks": 2},
         ]},
        {"id": 2, "title": "Stage 2 Assessment: Immunization", "description": "Test vaccine schedules and cold chain.", "stage_id": 2, "duration_minutes": 8, "passing_score_pct": 70, "max_attempts": 3, "status": "draft", "started_at": None, "ended_at": None,
         "questions": [
             {"id": 3, "text": "First dose of Measles vaccine age?", "option_a": "At birth", "option_b": "6 weeks", "option_c": "9 months", "option_d": "12 months", "correct_answer": "C", "marks": 2},
             {"id": 4, "text": "Ideal vaccine storage temperature?", "option_a": "-20°C to 0°C", "option_b": "+2°C to +8°C", "option_c": "+10°C to +25°C", "option_d": "Room temperature", "correct_answer": "B", "marks": 2},
         ]},
        {"id": 3, "title": "Stage 3 Assessment: IYCF", "description": "Validate breastfeeding and feeding practices.", "stage_id": 3, "duration_minutes": 10, "passing_score_pct": 70, "max_attempts": 3, "status": "draft", "started_at": None, "ended_at": None,
         "questions": [
             {"id": 5, "text": "How many months should a baby be exclusively breastfed?", "option_a": "3 months", "option_b": "6 months", "option_c": "9 months", "option_d": "12 months", "correct_answer": "B", "marks": 2},
             {"id": 6, "text": "What does responsive feeding mean?", "option_a": "Force-feeding", "option_b": "Feed only when crying", "option_c": "Paying attention to hunger/satiety cues", "option_d": "Let child eat anything", "correct_answer": "C", "marks": 2},
         ]},
    ],
    "meghalaya": [
        {"id": 1, "title": "Stage 1 Assessment: Tribal Health Basics", "description": "Test tribal health challenges and cultural sensitivity.", "stage_id": 1, "duration_minutes": 8, "passing_score_pct": 70, "max_attempts": 3, "status": "draft", "started_at": None, "ended_at": None,
         "questions": [
             {"id": 1, "text": "Most prevalent disease in forested tribal regions of NE India?", "option_a": "Diabetes Type 2", "option_b": "Malaria", "option_c": "Heart disease", "option_d": "Osteoporosis", "correct_answer": "B", "marks": 2},
             {"id": 2, "text": "Best approach when community uses traditional healing?", "option_a": "Insist they stop", "option_b": "Respectfully introduce evidence-based treatments alongside", "option_c": "Report to authorities", "option_d": "Ignore", "correct_answer": "B", "marks": 2},
         ]},
        {"id": 2, "title": "Stage 2 Assessment: Hill Nutrition", "description": "Test local nutrition strategies and ICDS programs.", "stage_id": 2, "duration_minutes": 8, "passing_score_pct": 70, "max_attempts": 3, "status": "draft", "started_at": None, "ended_at": None,
         "questions": [
             {"id": 3, "text": "Which local Meghalaya food is rich in protein and iron?", "option_a": "White rice only", "option_b": "Local river fish & greens", "option_c": "Refined sugar", "option_d": "Instant noodles", "correct_answer": "B", "marks": 2},
             {"id": 4, "text": "What is THR in ICDS context?", "option_a": "Total Health Report", "option_b": "Take-Home Ration", "option_c": "Training Health Resources", "option_d": "Therapeutic Hospital Referral", "correct_answer": "B", "marks": 2},
         ]},
        {"id": 3, "title": "Stage 3 Assessment: Community Outreach", "description": "Validate outreach and mobilization skills.", "stage_id": 3, "duration_minutes": 10, "passing_score_pct": 70, "max_attempts": 3, "status": "draft", "started_at": None, "ended_at": None,
         "questions": [
             {"id": 5, "text": "Key stakeholder for tribal village health camp?", "option_a": "City hospital director", "option_b": "Village headman / community leader", "option_c": "State governor", "option_d": "No one needed", "correct_answer": "B", "marks": 2},
             {"id": 6, "text": "Key advantage of SHGs for health promotion?", "option_a": "Fund medicines", "option_b": "Community trust & effective message spread", "option_c": "Replace health workers", "option_d": "Medical training", "correct_answer": "B", "marks": 2},
         ]},
    ],
}

# Mock users for result generation
MOCK_USERS = [
    "Sunita Devi", "Rekha Sharma", "Priya Singh", "Meena Kumari",
    "Kavita Yadav", "Anita Gupta", "Suman Tiwari", "Pooja Verma"
]


@router.get("/form-config")
def get_form_config(district: str = Query("jalna", description="District slug")):
    """Return the current registration form configuration for a district."""
    fields = MOCK_FORM_CONFIG.get(district, _default_form_config())
    return {"fields": fields}


@router.put("/form-config")
def update_form_config(config: Dict[str, Any], district: str = Query("jalna", description="District slug")):
    """Update the registration form configuration for a district."""
    if "fields" in config:
        MOCK_FORM_CONFIG[district] = config["fields"]
    return {"message": "Form configuration updated", "fields": MOCK_FORM_CONFIG.get(district, [])}


# ──────────────────────────────────────────────
# Tutorial & Stage Manager (per-district)
# ──────────────────────────────────────────────

@router.get("/stages")
def get_admin_stages(district: str = Query("jalna", description="District slug")):
    """Return all stages and tutorials for admin management (district-scoped)."""
    return MOCK_STAGES.get(district, [])


@router.post("/stages")
def create_stage(stage: Dict[str, Any], district: str = Query("jalna", description="District slug")):
    """Create a new stage in a district."""
    stages = MOCK_STAGES.setdefault(district, [])
    new_id = max([s["id"] for s in stages], default=0) + 1
    new_stage = {
        "id": new_id,
        "title": stage.get("title", "New Stage"),
        "description": stage.get("description", ""),
        "order_index": len(stages),
        "tutorials": []
    }
    stages.append(new_stage)
    return new_stage


@router.put("/stages/{stage_id}")
def update_stage(stage_id: int, stage: Dict[str, Any], district: str = Query("jalna", description="District slug")):
    """Update an existing stage."""
    stages = MOCK_STAGES.get(district, [])
    for s in stages:
        if s["id"] == stage_id:
            s["title"] = stage.get("title", s["title"])
            s["description"] = stage.get("description", s["description"])
            return s
    raise HTTPException(status_code=404, detail="Stage not found")


@router.delete("/stages/{stage_id}")
def delete_stage(stage_id: int, district: str = Query("jalna", description="District slug")):
    """Delete a stage."""
    stages = MOCK_STAGES.get(district, [])
    MOCK_STAGES[district] = [s for s in stages if s["id"] != stage_id]
    return {"message": "Stage deleted"}


@router.post("/stages/{stage_id}/tutorials")
def add_tutorial(stage_id: int, tutorial: Dict[str, Any], district: str = Query("jalna", description="District slug")):
    """Add a tutorial to a stage."""
    stages = MOCK_STAGES.get(district, [])
    for s in stages:
        if s["id"] == stage_id:
            new_id = max([t["id"] for stg in stages for t in stg["tutorials"]], default=0) + 1
            new_tut = {
                "id": new_id,
                "title": tutorial.get("title", "New Tutorial"),
                "description": tutorial.get("description", ""),
                "module_number": tutorial.get("module_number", f"Module {stage_id}.{len(s['tutorials']) + 1}"),
                "duration_minutes": tutorial.get("duration_minutes", 5),
                "youtube_url": tutorial.get("youtube_url", ""),
                "start_seconds": tutorial.get("start_seconds", 0),
                "end_seconds": tutorial.get("end_seconds", 0),
                "order_index": len(s["tutorials"])
            }
            s["tutorials"].append(new_tut)
            return new_tut
    raise HTTPException(status_code=404, detail="Stage not found")


@router.put("/tutorials/{tutorial_id}")
def update_tutorial(tutorial_id: int, tutorial: Dict[str, Any], district: str = Query("jalna", description="District slug")):
    """Update a tutorial."""
    stages = MOCK_STAGES.get(district, [])
    for s in stages:
        for t in s["tutorials"]:
            if t["id"] == tutorial_id:
                for key in ["title", "description", "module_number", "duration_minutes", "youtube_url", "start_seconds", "end_seconds"]:
                    if key in tutorial:
                        t[key] = tutorial[key]
                return t
    raise HTTPException(status_code=404, detail="Tutorial not found")


@router.delete("/tutorials/{tutorial_id}")
def delete_tutorial(tutorial_id: int, district: str = Query("jalna", description="District slug")):
    """Delete a tutorial."""
    stages = MOCK_STAGES.get(district, [])
    for s in stages:
        s["tutorials"] = [t for t in s["tutorials"] if t["id"] != tutorial_id]
    return {"message": "Tutorial deleted"}


# ──────────────────────────────────────────────
# Test Manager (per-district)
# ──────────────────────────────────────────────

@router.get("/tests")
def get_admin_tests(district: str = Query("jalna", description="District slug")):
    """Return all tests with questions for admin management (district-scoped)."""
    return MOCK_TESTS.get(district, [])


@router.post("/tests")
def create_test(test: Dict[str, Any], district: str = Query("jalna", description="District slug")):
    """Create a new test."""
    tests = MOCK_TESTS.setdefault(district, [])
    new_id = max([t["id"] for t in tests], default=0) + 1
    new_test = {
        "id": new_id,
        "title": test.get("title", "New Test"),
        "description": test.get("description", ""),
        "stage_id": test.get("stage_id", 1),
        "duration_minutes": test.get("duration_minutes", 10),
        "passing_score_pct": test.get("passing_score_pct", 70),
        "max_attempts": test.get("max_attempts", 3),
        "status": "draft",
        "started_at": None,
        "ended_at": None,
        "questions": test.get("questions", [])
    }
    tests.append(new_test)
    return new_test


@router.put("/tests/{test_id}")
def update_test(test_id: int, test: Dict[str, Any], district: str = Query("jalna", description="District slug")):
    """Update an existing test."""
    tests = MOCK_TESTS.get(district, [])
    for t in tests:
        if t["id"] == test_id:
            for key in ["title", "description", "stage_id", "duration_minutes", "passing_score_pct", "max_attempts", "questions"]:
                if key in test:
                    t[key] = test[key]
            return t
    raise HTTPException(status_code=404, detail="Test not found")


@router.delete("/tests/{test_id}")
def delete_test(test_id: int, district: str = Query("jalna", description="District slug")):
    """Delete a test."""
    tests = MOCK_TESTS.get(district, [])
    MOCK_TESTS[district] = [t for t in tests if t["id"] != test_id]
    return {"message": "Test deleted"}


@router.post("/tests/{test_id}/start")
def start_test(test_id: int, district: str = Query("jalna", description="District slug")):
    """Start a test — set status to active."""
    tests = MOCK_TESTS.get(district, [])
    for t in tests:
        if t["id"] == test_id:
            t["status"] = "active"
            t["started_at"] = datetime.utcnow().isoformat()
            t["ended_at"] = None
            return t
    raise HTTPException(status_code=404, detail="Test not found")


@router.post("/tests/{test_id}/end")
def end_test(test_id: int, district: str = Query("jalna", description="District slug")):
    """End a test — set status to ended."""
    tests = MOCK_TESTS.get(district, [])
    for t in tests:
        if t["id"] == test_id:
            t["status"] = "ended"
            t["ended_at"] = datetime.utcnow().isoformat()
            return t
    raise HTTPException(status_code=404, detail="Test not found")


@router.post("/tests/{test_id}/upload-questions")
def upload_questions(test_id: int, questions: List[Dict[str, Any]], district: str = Query("jalna", description="District slug")):
    """Upload parsed questions to a test (from frontend Excel/CSV parse)."""
    tests = MOCK_TESTS.get(district, [])
    for t in tests:
        if t["id"] == test_id:
            base_id = max([q["id"] for tt in tests for q in tt["questions"]], default=0) + 1
            for i, q in enumerate(questions):
                q["id"] = base_id + i
                q.setdefault("marks", 2)
            t["questions"] = questions
            return t
    raise HTTPException(status_code=404, detail="Test not found")


@router.get("/tests/{test_id}/results")
def get_test_results(test_id: int, district: str = Query("jalna", description="District slug")):
    """Generate mock test results for a specific test."""
    tests = MOCK_TESTS.get(district, [])
    test = None
    for t in tests:
        if t["id"] == test_id:
            test = t
            break
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    questions = test["questions"]
    results = []

    for user_name in MOCK_USERS:
        user_result = {"user_name": user_name, "answers": {}}
        total_correct = 0
        total_wrong = 0
        total_unattempted = 0

        for q in questions:
            roll = random.random()
            if roll < 0.60:
                status = "correct"
                total_correct += 1
            elif roll < 0.85:
                status = "wrong"
                total_wrong += 1
            else:
                status = "unattempted"
                total_unattempted += 1
            user_result["answers"][f"Q{q['id']}"] = status

        user_result["total_correct"] = total_correct
        user_result["total_wrong"] = total_wrong
        user_result["total_unattempted"] = total_unattempted
        total_q = len(questions)
        user_result["score_pct"] = round((total_correct / total_q) * 100, 1) if total_q > 0 else 0
        results.append(user_result)

    return {
        "test_title": test["title"],
        "questions": [{"id": q["id"], "text": q["text"]} for q in questions],
        "results": results
    }


@router.get("/tests/{test_id}/results/download")
def download_test_results_csv(test_id: int, district: str = Query("jalna", description="District slug")):
    """Download test results as CSV."""
    tests = MOCK_TESTS.get(district, [])
    test = None
    for t in tests:
        if t["id"] == test_id:
            test = t
            break
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")

    questions = test["questions"]
    output = io.StringIO()

    headers = ["User Name"]
    for q in questions:
        headers.append(f"Q{q['id']}")
    headers.extend(["Total Correct", "Total Wrong", "Total Unattempted", "Score %"])
    output.write(",".join(headers) + "\n")

    random.seed(42)
    for user_name in MOCK_USERS:
        row = [user_name]
        total_correct = 0
        total_wrong = 0
        total_unattempted = 0
        for q in questions:
            roll = random.random()
            if roll < 0.60:
                row.append("Correct")
                total_correct += 1
            elif roll < 0.85:
                row.append("Wrong")
                total_wrong += 1
            else:
                row.append("Unattempted")
                total_unattempted += 1
        total_q = len(questions)
        score = round((total_correct / total_q) * 100, 1) if total_q > 0 else 0
        row.extend([str(total_correct), str(total_wrong), str(total_unattempted), str(score)])
        output.write(",".join(row) + "\n")

    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="test_{test_id}_results.csv"'}
    )
