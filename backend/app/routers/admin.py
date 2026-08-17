"""
Admin API routes for NurtureHUB.
Provides admin login, district management, form config, tutorial/stage management,
test management, and results export.
All content endpoints are scoped per program district.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime
import json
import io
import random
import re

from app import projects
from app.config import settings
from app.database import get_db
from app.models import (
    User, ProgramDistrict, Stage, Tutorial, Test, Question, QuestionOption,
    TestAttempt, TestAnswer, TutorialQuestion, TutorialQuestionOption,
    TutorialQuizResponse, UserTutorialProgress, Notification, FaceToFaceSelection,
    Mother, FormDefinition, FormDistrictAssignment, FormVersion,
)
from app.seed_forms import FORM_SPECS, ensure_form_definitions
from app.auth import verify_password, create_access_token
from app.dependencies import get_current_admin, get_admin_email, invalidate_user_cache
from app.notify import create_notification
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
    # Project level info so pickers (e.g. form-version assignment) can show a
    # state and its districts as a hierarchy rather than a flat list.
    level: str = ProgramDistrict.LEVEL_DISTRICT
    parent_id: Optional[int] = None
    inherits_content: bool = False

class ProgramDistrictCreate(BaseModel):
    name: str

class ProjectCreate(BaseModel):
    """A project is a district (analysis by block) or a state (analysis by
    district, containing child district projects)."""
    name: str
    level: str = ProgramDistrict.LEVEL_DISTRICT
    parent_id: Optional[int] = None          # set to nest a district in a state
    inherits_content: bool = False           # child districts: serve state content
    code: Optional[str] = None               # analytics project code (UJ/JL/ML…)
    state_prefix: Optional[str] = None       # raw-file prefix (MP/MH/ML)

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    inherits_content: Optional[bool] = None
    code: Optional[str] = None
    state_prefix: Optional[str] = None

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
    norm_email = credentials.email.strip().lower()
    # 1. Check hardcoded credentials first (for quick testing)
    if (norm_email == HARDCODED_ADMIN_EMAIL.lower() and
            credentials.password == HARDCODED_ADMIN_PASSWORD):
        access_token = create_access_token(data={"sub": HARDCODED_ADMIN_EMAIL, "is_admin": True})
        return AdminLoginResponse(
            access_token=access_token,
            admin_name="NurtureHUB Admin"
        )

    # 2. Check DB for admin users
    user = db.query(User).filter(func.lower(User.email) == norm_email).first()
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
# Project CRUD (districts + states)
# ──────────────────────────────────────────────
# A project is the unit that owns content and that learners belong to. States
# contain district projects; each child district is a full project in its own
# right (own phases/tests/form pinning) unless it inherits its state's content.
# The older /districts endpoints below remain for compatibility.

def _user_counts(db: Session) -> Dict[int, int]:
    from sqlalchemy import func as _func
    rows = (
        db.query(User.program_district_id, _func.count(User.id))
        .filter(User.program_district_id.isnot(None))
        .group_by(User.program_district_id)
        .all()
    )
    return {pid: count for pid, count in rows}


@router.get("/projects")
def list_projects(db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """All projects as a tree: state projects carry their child districts,
    standalone districts come through flat. Ordered states-first by name."""
    counts = _user_counts(db)
    all_rows = projects.all_projects(db)
    children_by_parent: Dict[int, List[ProgramDistrict]] = {}
    for row in all_rows:
        if row.parent_id:
            children_by_parent.setdefault(row.parent_id, []).append(row)

    out = []
    for row in all_rows:
        if row.parent_id:
            continue  # emitted inside its parent
        data = projects.serialize(
            db, row,
            user_count=counts.get(row.id, 0),
            children=sorted(children_by_parent.get(row.id, []), key=lambda c: (c.name or "").lower()),
        )
        for child in data.get("children", []):
            child["user_count"] = counts.get(child["id"], 0)
        out.append(data)
    out.sort(key=lambda p: (p["level"] != ProgramDistrict.LEVEL_STATE, (p["name"] or "").lower()))
    return out


@router.post("/projects")
def create_project(data: ProjectCreate, db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Create a state project, a standalone district, or a district inside a state."""
    level = (data.level or ProgramDistrict.LEVEL_DISTRICT).lower()
    if level not in (ProgramDistrict.LEVEL_DISTRICT, ProgramDistrict.LEVEL_STATE):
        raise HTTPException(status_code=400, detail="level must be 'district' or 'state'")

    parent = None
    if data.parent_id:
        parent = db.query(ProgramDistrict).filter(ProgramDistrict.id == data.parent_id).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent project not found")
        if not parent.is_state:
            raise HTTPException(status_code=400, detail="Only a state project can contain districts")
        if level != ProgramDistrict.LEVEL_DISTRICT:
            raise HTTPException(status_code=400, detail="A project inside a state must be a district")

    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    slug = _slugify(name)
    if db.query(ProgramDistrict).filter(
        (ProgramDistrict.name == name) | (ProgramDistrict.slug == slug)
    ).first():
        raise HTTPException(status_code=400, detail="A project with this name already exists")

    code = (data.code or "").strip().upper() or None
    if code and db.query(ProgramDistrict).filter(ProgramDistrict.code == code).first():
        raise HTTPException(status_code=400, detail=f"Project code '{code}' is already in use")

    project = ProgramDistrict(
        name=name,
        slug=slug,
        is_active=True,
        level=level,
        parent_id=parent.id if parent else None,
        inherits_content=bool(data.inherits_content) if parent else False,
        code=code,
        # A district inside a state inherits the state's file-name prefix.
        state_prefix=((data.state_prefix or "").strip().upper() or
                      (parent.state_prefix if parent else None)),
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    MOCK_FORM_CONFIG[slug] = _default_form_config()
    return projects.serialize(db, project, user_count=0)


@router.put("/projects/{project_id}")
def update_project(project_id: int, data: ProjectUpdate, db: Session = Depends(get_db),
                   admin_email: str = Depends(get_admin_email)):
    project = db.query(ProgramDistrict).filter(ProgramDistrict.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        new_slug = _slugify(name)
        clash = db.query(ProgramDistrict).filter(
            ProgramDistrict.id != project.id,
            (ProgramDistrict.name == name) | (ProgramDistrict.slug == new_slug),
        ).first()
        if clash:
            raise HTTPException(status_code=400, detail="A project with this name already exists")
        old_slug = project.slug
        project.name, project.slug = name, new_slug
        if old_slug != new_slug and old_slug in MOCK_FORM_CONFIG:
            MOCK_FORM_CONFIG[new_slug] = MOCK_FORM_CONFIG.pop(old_slug)

    if data.is_active is not None:
        project.is_active = bool(data.is_active)
    if data.inherits_content is not None:
        if data.inherits_content and not project.parent_id:
            raise HTTPException(status_code=400,
                                detail="Only a district inside a state can inherit content")
        project.inherits_content = bool(data.inherits_content)
    if data.code is not None:
        code = data.code.strip().upper() or None
        if code and db.query(ProgramDistrict).filter(
            ProgramDistrict.code == code, ProgramDistrict.id != project.id
        ).first():
            raise HTTPException(status_code=400, detail=f"Project code '{code}' is already in use")
        project.code = code
    if data.state_prefix is not None:
        project.state_prefix = data.state_prefix.strip().upper() or None

    db.commit()
    db.refresh(project)
    counts = _user_counts(db)
    return projects.serialize(db, project, user_count=counts.get(project.id, 0))


@router.get("/projects/{project_id}/setup-options")
def project_setup_options(project_id: int, db: Session = Depends(get_db),
                          admin_email: str = Depends(get_admin_email)):
    """Everything the "set up this project" wizard needs in one call: which
    projects can be copied from (and how much content each has), and every form
    with its versions so a version can be pinned per form up front."""
    project = db.query(ProgramDistrict).filter(ProgramDistrict.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    sources = []
    for row in projects.all_projects(db):
        if row.id == project.id:
            continue
        stage_ids = [
            s.id for s in db.query(Stage.id).filter(Stage.program_district_id == row.id).all()
        ]
        if not stage_ids:
            continue
        sources.append({
            "id": row.id,
            "name": row.name,
            "level": row.level or ProgramDistrict.LEVEL_DISTRICT,
            "phase_count": len(stage_ids),
            "tutorial_count": db.query(Tutorial).filter(Tutorial.stage_id.in_(stage_ids)).count(),
            "test_count": db.query(Test).filter(Test.stage_id.in_(stage_ids)).count(),
        })

    ensure_form_definitions(db)
    definitions = {d.form_key: d for d in db.query(FormDefinition).all()}
    assignments = {
        a.form_key: a for a in db.query(FormDistrictAssignment).filter(
            FormDistrictAssignment.program_district_id == project.id
        ).all()
    }
    versions_by_form: Dict[str, List[FormVersion]] = {}
    for version in db.query(FormVersion).order_by(FormVersion.version_number.desc()).all():
        versions_by_form.setdefault(version.form_key, []).append(version)

    forms = []
    for form_key in FORM_SPECS:
        definition = definitions.get(form_key)
        if not definition:
            continue
        assignment = assignments.get(form_key)
        current = None
        if assignment:
            current = next(
                (v.version_number for v in versions_by_form.get(form_key, []) if v.id == assignment.version_id),
                None,
            )
        forms.append({
            "form_key": form_key,
            "title": definition.title,
            "default_version_number": (
                definition.default_version.version_number if definition.default_version else None
            ),
            "current_version_number": current,   # None = follows the default
            "versions": [
                {
                    "version_number": v.version_number,
                    "created_on": v.created_on.isoformat() if v.created_on else None,
                    "description": v.description,
                }
                for v in versions_by_form.get(form_key, [])
            ],
        })

    return {
        "project": projects.serialize(db, project),
        "can_have_districts": project.is_state,
        "sources": sorted(sources, key=lambda s: (s["name"] or "").lower()),
        "forms": forms,
    }


@router.post("/projects/{project_id}/setup")
def setup_project(project_id: int, data: Dict[str, Any], db: Session = Depends(get_db),
                  admin_email: str = Depends(get_admin_email)):
    """One-shot onboarding for a newly created project.

    Payload (every part optional):
      copy_content_from: int    — clone that project's phases/tutorials into this one
      copy_tests:        bool   — also clone its test papers (as drafts, unscheduled)
      form_versions:     {form_key: version_number | null}  — pin each form
      child_districts:   [str]  — district projects to create inside a STATE project
      children_inherit:  bool   — those districts serve this state's content

    Content is only copied into an EMPTY project: re-running the wizard must
    never silently duplicate a syllabus.
    """
    project = db.query(ProgramDistrict).filter(ProgramDistrict.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    result: Dict[str, Any] = {"phases_copied": 0, "forms_pinned": 0, "districts_created": []}

    # ── 1. Content ────────────────────────────────────────────────────────────
    source_id = data.get("copy_content_from")
    if source_id:
        source = db.query(ProgramDistrict).filter(ProgramDistrict.id == int(source_id)).first()
        if not source:
            raise HTTPException(status_code=404, detail="Source project not found")
        if source.id == project.id:
            raise HTTPException(status_code=400, detail="A project cannot copy content from itself")
        existing = db.query(Stage).filter(Stage.program_district_id == project.id).count()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(f"'{project.name}' already has {existing} phase(s). Delete them first, or copy "
                        "individual phases from the Tutorials screen."),
            )
        source_stages = (
            db.query(Stage)
            .filter(Stage.program_district_id == projects.content_project_id(source))
            .order_by(Stage.order_index)
            .all()
        )
        for i, stage in enumerate(source_stages):
            _clone_stage(db, stage, project.id, i, include_tests=bool(data.get("copy_tests")))
        result["phases_copied"] = len(source_stages)

    # ── 2. Form versions ──────────────────────────────────────────────────────
    wanted_versions: Dict[str, Any] = data.get("form_versions") or {}
    if wanted_versions:
        ensure_form_definitions(db)
        existing_assignments = {
            a.form_key: a for a in db.query(FormDistrictAssignment).filter(
                FormDistrictAssignment.program_district_id == project.id
            ).all()
        }
        for form_key, version_number in wanted_versions.items():
            if form_key not in FORM_SPECS:
                raise HTTPException(status_code=400, detail=f"Unknown form '{form_key}'")
            assignment = existing_assignments.get(form_key)
            if version_number is None:
                # "Follow the default" — drop any pin.
                if assignment:
                    db.delete(assignment)
                continue
            version = db.query(FormVersion).filter(
                FormVersion.form_key == form_key,
                FormVersion.version_number == int(version_number),
            ).first()
            if not version:
                raise HTTPException(status_code=404,
                                    detail=f"{form_key} has no version {version_number}")
            if assignment:
                assignment.version_id = version.id
                assignment.assigned_by = admin_email
            else:
                db.add(FormDistrictAssignment(
                    form_key=form_key,
                    program_district_id=project.id,
                    version_id=version.id,
                    assigned_by=admin_email,
                ))
            result["forms_pinned"] += 1

    # ── 3. Child districts (state projects only) ──────────────────────────────
    names = [str(n).strip() for n in (data.get("child_districts") or []) if str(n).strip()]
    if names:
        if not project.is_state:
            raise HTTPException(status_code=400,
                                detail="Only a state project can contain district projects")
        inherit = bool(data.get("children_inherit"))
        for name in names:
            slug = _slugify(name)
            clash = db.query(ProgramDistrict).filter(
                (ProgramDistrict.name == name) | (ProgramDistrict.slug == slug)
            ).first()
            if clash:
                raise HTTPException(status_code=400,
                                    detail=f"A project named '{name}' already exists")
            child = ProgramDistrict(
                name=name,
                slug=slug,
                is_active=True,
                level=ProgramDistrict.LEVEL_DISTRICT,
                parent_id=project.id,
                inherits_content=inherit,
                state_prefix=project.state_prefix,
            )
            db.add(child)
            db.flush()
            MOCK_FORM_CONFIG[slug] = _default_form_config()
            result["districts_created"].append({"id": child.id, "name": child.name, "slug": child.slug})

    db.commit()
    return result


@router.delete("/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Delete a project. A state with districts must be emptied first — the FK
    cascade would otherwise silently take every child project's content with it."""
    project = db.query(ProgramDistrict).filter(ProgramDistrict.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    kids = projects.child_districts(db, project)
    if kids:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(f"This state still contains {len(kids)} district project(s). "
                    "Delete or move them first."),
        )
    db.query(User).filter(User.program_district_id == project.id).update(
        {User.program_district_id: None})
    db.delete(project)
    db.commit()
    return {"message": "Project deleted"}


@router.get("/districts", response_model=List[ProgramDistrictSchema])
def list_districts(db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Every project (states and districts alike), flat, with user counts.

    Kept flat for callers that assign things per project — notably form-version
    pinning, where a state and each of its districts are independent targets.
    """
    districts = db.query(ProgramDistrict).order_by(ProgramDistrict.id).all()
    counts = _user_counts(db)
    return [
        ProgramDistrictSchema(
            id=d.id, name=d.name, slug=d.slug, is_active=d.is_active,
            user_count=counts.get(d.id, 0),
            level=d.level or ProgramDistrict.LEVEL_DISTRICT,
            parent_id=d.parent_id,
            inherits_content=bool(d.inherits_content),
        )
        for d in districts
    ]


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
def _serialize_learner(db: Session, u: User) -> Dict[str, Any]:
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "phone": u.phone,
        "role": u.role,
        "learner_category": u.learner_category,
        "work_center_name": u.work_center_name,
        "is_verified": bool(u.is_verified),
        "is_admin": bool(u.is_admin),
        "created_at": iso_utc(u.created_at),
        "program_district_id": u.program_district_id,
        "program_district_name": u.program_district.name if u.program_district else None,
    }


def _learner_activity(db: Session, user_ids: List[int]) -> Dict[int, Dict[str, int]]:
    """Per-learner counts used by the delete confirmation, in two grouped queries."""
    if not user_ids:
        return {}
    activity: Dict[int, Dict[str, int]] = {uid: {"attempts": 0, "mothers": 0} for uid in user_ids}
    for uid, count in (
        db.query(TestAttempt.user_id, func.count(TestAttempt.id))
        .filter(TestAttempt.user_id.in_(user_ids), TestAttempt.submitted_at.isnot(None))
        .group_by(TestAttempt.user_id).all()
    ):
        activity[uid]["attempts"] = count
    for uid, count in (
        db.query(Mother.registered_by_user_id, func.count(Mother.id))
        .filter(Mother.registered_by_user_id.in_(user_ids))
        .group_by(Mother.registered_by_user_id).all()
    ):
        if uid in activity:
            activity[uid]["mothers"] = count
    return activity


@router.get("/users")
def list_users_for_admin(
    q: str = Query("", description="Search name or email"),
    project_id: Optional[int] = Query(None, description="Filter by project id; -1 = unassigned"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """List learners with their project assignment, searchable and filterable.

    Returns `total` alongside the page so the UI can say "showing 200 of 4,318"
    rather than silently truncating.
    """
    query = db.query(User)
    term = (q or "").strip()
    if term:
        like = f"%{term.lower()}%"
        query = query.filter(
            func.lower(User.email).like(like) | func.lower(func.coalesce(User.full_name, "")).like(like)
        )
    if project_id is not None:
        if project_id < 0:
            query = query.filter(User.program_district_id.is_(None))
        else:
            query = query.filter(User.program_district_id == project_id)

    total = query.count()
    users = query.order_by(User.id).offset(offset).limit(limit).all()
    activity = _learner_activity(db, [u.id for u in users])
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "users": [{**_serialize_learner(db, u), **activity.get(u.id, {})} for u in users],
    }


LEARNER_EDITABLE_FIELDS = ["full_name", "phone", "role", "learner_category", "work_center_name"]


@router.put("/users/{user_id}")
def update_learner(
    user_id: int,
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Edit a learner's profile fields, verification flag and project."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    for key in LEARNER_EDITABLE_FIELDS:
        if key in payload:
            value = payload[key]
            setattr(user, key, (value or None) if isinstance(value, str) else value)

    if "email" in payload:
        # Emails are the login identity and are stored lowercase everywhere.
        email = (payload.get("email") or "").strip().lower()
        if not email:
            raise HTTPException(status_code=400, detail="Email is required")
        clash = db.query(User.id).filter(func.lower(User.email) == email, User.id != user.id).first()
        if clash:
            raise HTTPException(status_code=400, detail="Another account already uses that email")
        old_email = user.email
        user.email = email
        invalidate_user_cache(old_email)

    if "is_verified" in payload:
        user.is_verified = bool(payload["is_verified"])
    if "program_district_id" in payload:
        project_id = payload["program_district_id"]
        if project_id is not None:
            exists = db.query(ProgramDistrict.id).filter(ProgramDistrict.id == project_id).first()
            if not exists:
                raise HTTPException(status_code=404, detail="Project not found")
        user.program_district_id = project_id

    db.commit()
    db.refresh(user)
    # The cached snapshot gates content and verification — drop it so the edit
    # takes effect on the learner's next request, not after the cache TTL.
    invalidate_user_cache(user.email)
    return _serialize_learner(db, user)


@router.delete("/users/{user_id}")
def delete_learner(
    user_id: int,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Permanently delete a learner account.

    Everything owned by the account goes with it (progress, attempts, answers,
    notifications, achievements, push subscriptions) via ON DELETE CASCADE.
    Mothers and children they registered are field data belonging to the
    programme, not to the account — those rows survive with a null registrar
    (Mother.registered_by_user_id is ON DELETE SET NULL).
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if (user.email or "").lower() == (admin_email or "").lower():
        raise HTTPException(status_code=400, detail="You cannot delete the account you are signed in as")

    email = user.email
    db.delete(user)
    db.commit()
    invalidate_user_cache(email)
    return {"message": "Account deleted", "email": email}


@router.post("/users/bulk-assign")
def bulk_assign_users(
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Move several learners to one project at once ({"user_ids": [...],
    "program_district_id": n | null})."""
    user_ids = [int(uid) for uid in (payload.get("user_ids") or [])]
    if not user_ids:
        raise HTTPException(status_code=400, detail="Select at least one learner")
    project_id = payload.get("program_district_id")
    if project_id is not None:
        exists = db.query(ProgramDistrict.id).filter(ProgramDistrict.id == project_id).first()
        if not exists:
            raise HTTPException(status_code=404, detail="Project not found")

    users = db.query(User).filter(User.id.in_(user_ids)).all()
    for user in users:
        user.program_district_id = project_id
    db.commit()
    for user in users:
        invalidate_user_cache(user.email)
    return {"moved": len(users), "program_district_id": project_id}


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
    # District gates which content the learner sees; drop any cached snapshot so
    # the reassignment takes effect immediately, not after the cache TTL.
    invalidate_user_cache(user.email)
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
        "test_count": db.query(Test).filter(Test.stage_id == stage.id).count(),
        "tutorials": [_serialize_admin_tutorial(db, t) for t in tutorials],
    }


def _get_district_or_404(db: Session, slug: str) -> ProgramDistrict:
    district = projects.by_slug(db, slug)
    if not district:
        raise HTTPException(status_code=404, detail="Project not found")
    return district


def _content_project_or_404(db: Session, slug: str) -> ProgramDistrict:
    """The project new content must be written to: an inheriting child district
    shows its state's content, so authoring there edits the STATE."""
    project = _get_district_or_404(db, slug)
    if project.parent_id and project.inherits_content and project.parent:
        return project.parent
    return project


TUTORIAL_EDITABLE_FIELDS = [
    "title", "description", "module_number", "duration_minutes",
    "video_url", "youtube_url", "start_seconds", "end_seconds", "order_index",
]


@router.get("/stages")
def get_admin_stages(district: str = Query("jalna", description="District slug"), db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """
    Return every phase of the project in running order — video phases with their
    tutorials, and test phases so the sequence the learner walks through is
    legible (and reorderable) in one place.

    Test phases stay read-only here: their tests, schedules and results are
    managed in Test Management, and delete_stage refuses them.
    """
    return [_serialize_admin_stage(db, s) for s in _district_stages(db, district)]


@router.post("/stages")
def create_stage(stage: Dict[str, Any], district: str = Query("jalna", description="District slug"), db: Session = Depends(get_db), admin_email: str = Depends(get_admin_email)):
    """Create a new stage/phase in a project."""
    pd = _content_project_or_404(db, district)
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


def _clone_stage(
    db: Session,
    source: Stage,
    target_project_id: int,
    order_index: int,
    include_tests: bool,
) -> Stage:
    """Deep-copy one phase into another project.

    Copies the phase, its tutorials and each tutorial's post-video quiz. Test
    papers are copied only when `include_tests` — and always as fresh DRAFTS
    with no schedule, so a copy can never go live behind the admin's back. No
    learner data (progress, attempts, answers) is ever copied.
    """
    new_stage = Stage(
        program_district_id=target_project_id,
        title=source.title,
        description=source.description,
        order_index=order_index,
        stage_type=source.stage_type or "tutorials",
        quiz_enabled=bool(source.quiz_enabled),
    )
    db.add(new_stage)
    db.flush()

    tutorials = (
        db.query(Tutorial).filter(Tutorial.stage_id == source.id).order_by(Tutorial.order_index).all()
    )
    for tut in tutorials:
        new_tut = Tutorial(
            stage_id=new_stage.id,
            title=tut.title,
            description=tut.description,
            module_number=tut.module_number,
            duration_minutes=tut.duration_minutes,
            video_url=tut.video_url,
            youtube_url=tut.youtube_url,
            start_seconds=tut.start_seconds,
            end_seconds=tut.end_seconds,
            gradient_colors=tut.gradient_colors,
            order_index=tut.order_index,
            quiz_enabled=bool(tut.quiz_enabled),
        )
        db.add(new_tut)
        db.flush()
        for question in tut.quiz_questions:
            new_q = TutorialQuestion(
                tutorial_id=new_tut.id,
                text=question.text,
                order_index=question.order_index,
            )
            db.add(new_q)
            db.flush()
            for option in question.options:
                db.add(TutorialQuestionOption(
                    question_id=new_q.id,
                    label=option.label,
                    text=option.text,
                    is_correct=option.is_correct,
                ))

    if include_tests:
        for test in db.query(Test).filter(Test.stage_id == source.id).order_by(Test.id).all():
            new_test = Test(
                stage_id=new_stage.id,
                title=test.title,
                description=test.description,
                total_questions=test.total_questions,
                duration_minutes=test.duration_minutes,
                passing_score_pct=test.passing_score_pct,
                max_attempts=test.max_attempts,
                default_marks=test.default_marks or 1,
                test_type=test.test_type,
                status="draft",
                scheduled_at=None,
            )
            db.add(new_test)
            db.flush()
            for question in sorted(test.questions, key=lambda q: (q.order_index or 0, q.id)):
                new_q = Question(
                    test_id=new_test.id,
                    text=question.text,
                    marks=question.marks,
                    order_index=question.order_index,
                    image_url=question.image_url,
                )
                db.add(new_q)
                db.flush()
                for option in question.options:
                    db.add(QuestionOption(
                        question_id=new_q.id,
                        label=option.label,
                        text=option.text,
                        image_url=option.image_url,
                        is_correct=option.is_correct,
                    ))

    return new_stage


@router.post("/stages/reorder")
def reorder_stages(
    payload: Dict[str, Any],
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Set the running order of a project's phases from {"stage_ids": [...]}.

    Order matters beyond presentation: a test is gated on every tutorial in its
    own phase and all EARLIER ones (see app/flow.py), so moving a video phase
    above or below a test phase changes what learners must finish first.
    """
    pd = _content_project_or_404(db, district)
    wanted = [int(sid) for sid in (payload.get("stage_ids") or [])]
    stages = db.query(Stage).filter(Stage.program_district_id == pd.id).all()
    by_id = {s.id: s for s in stages}
    unknown = [sid for sid in wanted if sid not in by_id]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown phase id(s) for this project: {unknown}")

    # Listed phases take the given order; anything omitted keeps its relative
    # position at the end, so a stale client list can never drop a phase.
    ordered = [by_id[sid] for sid in wanted]
    ordered += [s for s in sorted(stages, key=lambda s: s.order_index or 0) if s.id not in set(wanted)]
    for i, stage in enumerate(ordered):
        stage.order_index = i
    db.commit()
    return [_serialize_admin_stage(db, s) for s in ordered]


@router.post("/stages/{stage_id}/copy")
def copy_stage_to_projects(
    stage_id: int,
    payload: Dict[str, Any],
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Copy a phase — its tutorials and their post-video quiz questions — into
    other projects ({"project_ids": [...]}).

    This is a COPY, not a live link: each target project gets its own phase it
    can then edit independently. (For a permanently shared syllabus, make the
    district inherit its state's content on the Projects screen instead.)
    Tests are not copied — they carry schedules, attempts and results.
    """
    source = db.query(Stage).filter(Stage.id == stage_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Phase not found")

    target_ids = {int(pid) for pid in (payload.get("project_ids") or [])}
    target_ids.discard(source.program_district_id)
    if not target_ids:
        raise HTTPException(status_code=400, detail="Pick at least one other project to copy into")

    targets = db.query(ProgramDistrict).filter(ProgramDistrict.id.in_(target_ids)).all()
    missing = target_ids - {p.id for p in targets}
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown project id(s): {sorted(missing)}")

    source_tutorials = (
        db.query(Tutorial).filter(Tutorial.stage_id == source.id).order_by(Tutorial.order_index).all()
    )
    copied = []
    for target in targets:
        count = db.query(Stage).filter(Stage.program_district_id == target.id).count()
        new_stage = _clone_stage(db, source, target.id, count, include_tests=False)
        copied.append({"project_id": target.id, "project_name": target.name, "stage_id": new_stage.id})

    db.commit()
    return {"copied": copied, "tutorials_per_copy": len(source_tutorials)}


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
# Bulk tutorial upload (Excel sheet, parsed client-side like test questions)
# ──────────────────────────────────────────────
# Fixed sheet columns (header row 1): Phase | Title | Description | Module |
# Video Link | Start Time | End Time | Duration (min) | Quiz
# The frontend parses the sheet with SheetJS and POSTs normalized rows here.

_YOUTUBE_LINK_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([a-zA-Z0-9_-]{11})"
)


def _parse_sheet_time(raw: str) -> int:
    """'90' -> 90, '1:30' -> 90, '0:01:30' / '1:01:05' -> seconds. '' -> 0."""
    text = (raw or "").strip()
    if not text:
        return 0
    if re.fullmatch(r"\d+", text):
        return int(text)
    parts = text.split(":")
    if not (2 <= len(parts) <= 3) or not all(re.fullmatch(r"\d+", p) for p in parts):
        raise ValueError(f"'{raw}' is not a valid time (use seconds, m:ss or h:mm:ss)")
    parts = [int(p) for p in parts]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


class TutorialSheetRow(BaseModel):
    """One data row of the tutorial upload sheet (all cells as raw strings)."""
    row: int                      # Excel row number, for error messages
    phase: str = ""               # phase number as shown in the manager (1-based)
    title: str = ""
    description: str = ""
    module: str = ""
    link: str = ""                # YouTube URL or direct video file URL
    start: str = ""               # clip start (YouTube only)
    end: str = ""                 # clip end (YouTube only)
    duration: str = ""            # minutes badge
    quiz: str = ""                # yes/no (default yes)


class TutorialBulkUpload(BaseModel):
    rows: List[TutorialSheetRow]


@router.post("/tutorials/bulk-upload")
def bulk_upload_tutorials(
    payload: TutorialBulkUpload,
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Create/update tutorials from an uploaded sheet.

    Upsert semantics: a row matches an existing tutorial by (phase, title,
    case-insensitive) and updates it; otherwise a new tutorial is appended to
    that phase in sheet order. Nothing is ever deleted here. Valid rows are
    applied even when other rows fail — failures come back per-row.
    """
    pd = _content_project_or_404(db, district)
    stages = (
        db.query(Stage)
        .filter(Stage.program_district_id == pd.id)
        .order_by(Stage.order_index)
        .all()
    )
    # "Phase N" in the manager is order_index + 1 (test phases keep their slot).
    video_stage_by_phase = {
        s.order_index + 1: s for s in stages if (s.stage_type or "tutorials") != "test"
    }
    test_phase_numbers = {
        s.order_index + 1 for s in stages if (s.stage_type or "tutorials") == "test"
    }

    created = 0
    updated = 0
    errors: List[Dict[str, Any]] = []
    # Next order_index per stage, advanced as new tutorials are appended.
    next_order: Dict[int, int] = {}

    for row in payload.rows:
        try:
            title = row.title.strip()
            if not title:
                raise ValueError("Title is required")

            phase_text = row.phase.strip()
            if not re.fullmatch(r"\d+", phase_text):
                raise ValueError("Phase must be a number (as shown in the Tutorial Manager)")
            phase_no = int(phase_text)
            stage = video_stage_by_phase.get(phase_no)
            if stage is None:
                if phase_no in test_phase_numbers:
                    raise ValueError(f"Phase {phase_no} is a test phase — tutorials go in video phases")
                raise ValueError(
                    f"Phase {phase_no} does not exist. Video phases: "
                    f"{', '.join(str(n) for n in sorted(video_stage_by_phase)) or 'none'}"
                )

            link = row.link.strip()
            if not link:
                raise ValueError("Video Link is required")
            yt_match = _YOUTUBE_LINK_RE.search(link)
            if yt_match:
                youtube_url, video_url = link, None
            elif link.lower().startswith(("http://", "https://")):
                youtube_url, video_url = None, link
            else:
                raise ValueError("Video Link must be a YouTube link or an http(s) video URL")

            start_seconds = _parse_sheet_time(row.start)
            end_seconds = _parse_sheet_time(row.end)
            if end_seconds and end_seconds <= start_seconds:
                raise ValueError("End Time must be after Start Time")
            if (row.start.strip() or row.end.strip()) and not yt_match:
                raise ValueError("Start/End Time clipping only works with YouTube links")

            duration_text = row.duration.strip()
            if duration_text and not re.fullmatch(r"\d+", duration_text):
                raise ValueError("Duration (min) must be a whole number of minutes")
            duration_minutes = int(duration_text) if duration_text else 5

            quiz_text = row.quiz.strip().lower()
            if quiz_text and quiz_text not in ("yes", "no", "y", "n", "true", "false", "1", "0"):
                raise ValueError("Quiz must be yes or no")
            quiz_enabled = quiz_text not in ("no", "n", "false", "0")

            existing = next(
                (
                    t for t in db.query(Tutorial).filter(Tutorial.stage_id == stage.id).all()
                    if (t.title or "").strip().lower() == title.lower()
                ),
                None,
            )
            if existing:
                existing.description = row.description.strip() or existing.description
                if row.module.strip():
                    existing.module_number = row.module.strip()
                existing.duration_minutes = duration_minutes
                existing.youtube_url = youtube_url
                existing.video_url = video_url
                existing.start_seconds = start_seconds
                existing.end_seconds = end_seconds
                existing.quiz_enabled = quiz_enabled
                updated += 1
            else:
                if stage.id not in next_order:
                    next_order[stage.id] = db.query(Tutorial).filter(
                        Tutorial.stage_id == stage.id
                    ).count()
                order_index = next_order[stage.id]
                next_order[stage.id] += 1
                db.add(Tutorial(
                    stage_id=stage.id,
                    title=title,
                    description=row.description.strip(),
                    module_number=row.module.strip() or f"Module {phase_no}.{order_index + 1}",
                    duration_minutes=duration_minutes,
                    video_url=video_url,
                    youtube_url=youtube_url,
                    start_seconds=start_seconds,
                    end_seconds=end_seconds,
                    order_index=order_index,
                    quiz_enabled=quiz_enabled,
                ))
                created += 1
        except ValueError as exc:
            errors.append({"row": row.row, "message": str(exc)})

    db.commit()
    return {
        "created": created,
        "updated": updated,
        "errors": errors,
        "stages": [
            _serialize_admin_stage(db, s)
            for s in _district_stages(db, district)
            if (s.stage_type or "tutorials") != "test"
        ],
    }


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
    """A project's stages, ordered (empty if the project is unknown).

    Content resolution: a child district that inherits serves its parent
    state's stages, so this reads the CONTENT project, not the literal one.
    """
    project = projects.by_slug(db, slug)
    if not project:
        return []
    return (
        db.query(Stage)
        .filter(Stage.program_district_id == projects.content_project_id(project))
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


# Option slots a test question can use. Four was the historical fixed shape;
# E/F let a question offer more choices without a schema change. Blank slots
# are simply not stored, so a true/false question keeps only A and B.
OPTION_LABELS = ["A", "B", "C", "D", "E", "F"]


def _serialize_admin_question(q: Question) -> Dict[str, Any]:
    """One question in the flat A–F shape the admin UI edits."""
    opts = sorted(q.options, key=lambda o: (o.label or ""))
    by_label = {(o.label or "").upper(): o for o in opts}
    correct = next(((o.label or "").upper() for o in opts if o.is_correct), "A")
    out: Dict[str, Any] = {
        "id": q.id,
        "text": q.text,
        "correct_answer": correct,
        "marks": q.marks,
        "order_index": q.order_index or 0,
        "image_url": q.image_url or "",
    }
    for label in OPTION_LABELS:
        option = by_label.get(label)
        out[f"option_{label.lower()}"] = option.text if option else ""
        out[f"option_{label.lower()}_image"] = (option.image_url or "") if option else ""
    return out


def _serialize_admin_test(db: Session, test: Test, stage_position: int) -> Dict[str, Any]:
    """Serialize a DB Test into the flat shape the admin UI (AdminTestsPage) expects."""
    questions = (
        db.query(Question)
        .filter(Question.test_id == test.id)
        .order_by(Question.order_index, Question.id)
        .all()
    )
    return {
        "id": test.id,
        "title": test.title,
        "description": test.description or "",
        "stage_id": stage_position,  # 1-based display position within the district
        "duration_minutes": test.duration_minutes,
        "passing_score_pct": test.passing_score_pct,
        "max_attempts": test.max_attempts,
        "default_marks": test.default_marks or 1,
        "status": test.status or "draft",
        "test_type": test.test_type,
        "scheduled_at": iso_utc(test.scheduled_at),
        "started_at": iso_utc(test.started_at),
        "ended_at": iso_utc(test.ended_at),
        "has_submitted_attempts": _has_submitted_attempts(db, test),
        "questions": [_serialize_admin_question(q) for q in questions],
    }


def _has_submitted_attempts(db: Session, test: Test) -> bool:
    return db.query(TestAttempt.id).filter(
        TestAttempt.test_id == test.id,
        TestAttempt.submitted_at.isnot(None),
    ).first() is not None


def _guard_questions_replaceable(db: Session, test: Test):
    """
    Refuse to replace a test's questions once real attempts have been submitted.
    Question rows cascade-delete their TestAnswers, which would silently wipe the
    per-question result history of everyone who already took the test.

    In-place wording/marks/image edits go through _apply_question_fields instead
    and stay allowed — they keep the same question and option rows, so nobody's
    answers are lost.
    """
    if _has_submitted_attempts(db, test):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This test already has submitted attempts, so its questions can't be "
                "changed without destroying result history. Duplicate the test instead."
            ),
        )


def _apply_question_fields(
    db: Session,
    question: Question,
    payload: Dict[str, Any],
    default_marks: int,
) -> None:
    """Write the flat admin shape (text/marks/image + option_a..option_f) onto a
    question, reusing existing option rows so submitted answers keep resolving.

    An option slot left blank is removed; a slot that gains text/an image is
    created. The correct answer must land on a slot that still has content.
    """
    if "text" in payload:
        question.text = (payload.get("text") or "").strip()
    if "image_url" in payload:
        question.image_url = (payload.get("image_url") or "").strip() or None
    if "marks" in payload:
        try:
            marks = int(payload.get("marks") or 0)
        except (TypeError, ValueError):
            marks = 0
        question.marks = marks if marks > 0 else default_marks

    by_label = {(o.label or "").upper(): o for o in question.options}
    correct = str(payload.get("correct_answer") or "").upper()
    if correct not in OPTION_LABELS:
        correct = next((label for label, o in by_label.items() if o.is_correct), "A")

    filled: List[str] = []
    for label in OPTION_LABELS:
        key = f"option_{label.lower()}"
        # Absent keys mean "leave this slot alone" (partial update); present but
        # empty means "clear it".
        if key not in payload and f"{key}_image" not in payload:
            if label in by_label:
                filled.append(label)
            continue
        existing = by_label.get(label)
        text = (payload.get(key) or "").strip() if key in payload else (existing.text if existing else "")
        image = (
            (payload.get(f"{key}_image") or "").strip()
            if f"{key}_image" in payload
            else (existing.image_url if existing else "")
        )
        if not text and not image:
            if existing:
                db.delete(existing)
                by_label.pop(label, None)
            continue
        if existing:
            existing.text = text
            existing.image_url = image or None
        else:
            option = QuestionOption(
                question_id=question.id,
                label=label,
                text=text,
                image_url=image or None,
                is_correct=False,
            )
            db.add(option)
            by_label[label] = option
        filled.append(label)

    if filled and correct not in filled:
        correct = filled[0]
    for label, option in by_label.items():
        option.is_correct = (label == correct)
    db.flush()


def _replace_questions(db: Session, test: Test, questions: List[Dict[str, Any]]):
    """Replace a test's DB questions/options from the admin flat shape.

    Used by the sheet upload and by create-test. Marks fall back to the test's
    `default_marks` rather than a hardcoded constant.
    """
    for q in list(test.questions):
        db.delete(q)
    db.flush()
    default_marks = test.default_marks or 1
    for idx, q in enumerate(questions):
        question = Question(
            test_id=test.id,
            text=(q.get("text") or "").strip(),
            marks=default_marks,
            order_index=idx,
        )
        db.add(question)
        db.flush()
        _apply_question_fields(db, question, {**q, "marks": q.get("marks")}, default_marks)
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
        default_marks=max(1, int(test.get("default_marks") or 1)),
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
    if "default_marks" in test:
        db_test.default_marks = max(1, int(test.get("default_marks") or 1))

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


# ──────────────────────────────────────────────
# Manual question authoring (add / edit / reorder / delete one at a time)
# ──────────────────────────────────────────────
# The sheet upload replaces the whole paper; these let an admin correct or
# extend it in place — including attaching an image to the question or to
# individual options.

def _question_or_404(db: Session, question_id: int) -> Question:
    question = db.query(Question).filter(Question.id == question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    return question


def _renumber_questions(db: Session, test_id: int) -> None:
    rows = (
        db.query(Question)
        .filter(Question.test_id == test_id)
        .order_by(Question.order_index, Question.id)
        .all()
    )
    for i, q in enumerate(rows):
        q.order_index = i
    db.flush()


@router.post("/tests/{test_id}/questions")
def add_question(
    test_id: int,
    payload: Dict[str, Any],
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Append one question to a test (manual authoring)."""
    db_test = db.query(Test).filter(Test.id == test_id).first()
    if not db_test:
        raise HTTPException(status_code=404, detail="Test not found")
    if not (payload.get("text") or "").strip():
        raise HTTPException(status_code=400, detail="Question text is required")

    last = (
        db.query(func.max(Question.order_index))
        .filter(Question.test_id == test_id)
        .scalar()
    )
    question = Question(
        test_id=test_id,
        text=(payload.get("text") or "").strip(),
        marks=db_test.default_marks or 1,
        order_index=(last if last is not None else -1) + 1,
    )
    db.add(question)
    db.flush()
    _apply_question_fields(db, question, payload, db_test.default_marks or 1)
    db_test.total_questions = db.query(Question).filter(Question.test_id == test_id).count()
    db.commit()
    db.refresh(question)
    return _serialize_admin_question(question)


@router.put("/questions/{question_id}")
def update_question(
    question_id: int,
    payload: Dict[str, Any],
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Edit one question in place — wording, marks, option text, option images,
    the correct answer.

    Allowed even after submitted attempts: the question and its option rows
    survive, so existing TestAnswers still point at real options. Clearing an
    option that somebody already selected is the one destructive case, and it
    is refused below.
    """
    question = _question_or_404(db, question_id)
    db_test = db.query(Test).filter(Test.id == question.test_id).first()
    if not db_test:
        raise HTTPException(status_code=404, detail="Test not found")

    if _has_submitted_attempts(db, db_test):
        # Which option rows would this edit delete?
        doomed = [
            o.id for o in question.options
            if f"option_{(o.label or '').lower()}" in payload
            and not (payload.get(f"option_{(o.label or '').lower()}") or "").strip()
            and not (payload.get(f"option_{(o.label or '').lower()}_image") or "").strip()
        ]
        if doomed and db.query(TestAnswer.id).filter(
            TestAnswer.selected_option_id.in_(doomed)
        ).first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Learners have already chosen an option you are removing. Reword it "
                    "instead of clearing it, or duplicate the test."
                ),
            )

    _apply_question_fields(db, question, payload, db_test.default_marks or 1)
    db.commit()
    db.refresh(question)
    return _serialize_admin_question(question)


@router.post("/questions/{question_id}/move")
def move_question(
    question_id: int,
    payload: Dict[str, Any],
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Move a question one slot up or down ({"direction": "up" | "down"})."""
    question = _question_or_404(db, question_id)
    direction = str(payload.get("direction") or "").lower()
    if direction not in ("up", "down"):
        raise HTTPException(status_code=400, detail="direction must be 'up' or 'down'")

    _renumber_questions(db, question.test_id)
    db.refresh(question)
    neighbour = (
        db.query(Question)
        .filter(
            Question.test_id == question.test_id,
            Question.order_index == question.order_index + (-1 if direction == "up" else 1),
        )
        .first()
    )
    if neighbour:
        question.order_index, neighbour.order_index = neighbour.order_index, question.order_index
        db.commit()
    return {"message": "Question moved"}


@router.delete("/questions/{question_id}")
def delete_question(
    question_id: int,
    district: str = Query("jalna", description="District slug"),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Delete one question. Refused once the test has submitted attempts —
    the answer rows would cascade away with it."""
    question = _question_or_404(db, question_id)
    db_test = db.query(Test).filter(Test.id == question.test_id).first()
    if db_test:
        _guard_questions_replaceable(db, db_test)
    test_id = question.test_id
    db.delete(question)
    db.flush()
    _renumber_questions(db, test_id)
    if db_test:
        db_test.total_questions = db.query(Question).filter(Question.test_id == test_id).count()
    db.commit()
    return {"message": "Question deleted"}


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
                    create_notification(
                        db,
                        user.id,
                        FACE_TO_FACE_NOTIFICATION_TITLE,
                        (
                            "Congratulations! You have been selected for the face-to-face "
                            "training. Please await further instructions."
                        ),
                        link="/dashboard",
                    )
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
            create_notification(
                db,
                user.id,
                FACE_TO_FACE_NOTIFICATION_TITLE,
                (
                    "Congratulations! You have been selected for the face-to-face "
                    "training. Please await further instructions."
                ),
                link="/dashboard",
            )
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

