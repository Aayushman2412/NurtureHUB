"""Project resolution: the single place that understands project LEVELS.

A project (``ProgramDistrict`` row) is either:

* **district** — standalone district. Crosstabs analyse it by BLOCK.
* **state**    — contains child district projects. Crosstabs analyse it by
  DISTRICT, and its raw-data export fans out one file set per child district.

A child district owns its content like any other project, unless the admin set
``inherits_content``, in which case it serves the parent state's content. Every
content lookup (stages / tutorials / tests / form versions) must therefore go
through :func:`content_project_id` rather than using the project id directly —
that is the one rule this module exists to enforce.
"""
from __future__ import annotations

from typing import Iterable, List, Optional

from sqlalchemy.orm import Session

from app.models import ProgramDistrict

LEVEL_DISTRICT = ProgramDistrict.LEVEL_DISTRICT
LEVEL_STATE = ProgramDistrict.LEVEL_STATE


# ── Lookup ───────────────────────────────────────────────────────────────────

def by_slug(db: Session, slug: str) -> Optional[ProgramDistrict]:
    if not slug:
        return None
    return db.query(ProgramDistrict).filter(ProgramDistrict.slug == slug).first()


def by_code(db: Session, code: str) -> Optional[ProgramDistrict]:
    if not code:
        return None
    return db.query(ProgramDistrict).filter(ProgramDistrict.code == code.upper()).first()


def all_projects(db: Session) -> List[ProgramDistrict]:
    return db.query(ProgramDistrict).order_by(ProgramDistrict.id).all()


def child_districts(db: Session, project: ProgramDistrict) -> List[ProgramDistrict]:
    """Child district projects of a state project (empty for a district)."""
    if not project or not project.is_state:
        return []
    return (
        db.query(ProgramDistrict)
        .filter(ProgramDistrict.parent_id == project.id)
        .order_by(ProgramDistrict.name)
        .all()
    )


def analysis_units(db: Session, project: ProgramDistrict) -> List[ProgramDistrict]:
    """The projects a data run covers: a state fans out to its districts,
    a district covers itself. A childless state falls back to itself so the
    admin still gets a run rather than silence."""
    if project and project.is_state:
        kids = child_districts(db, project)
        if kids:
            return kids
    return [project] if project else []


# ── Content resolution ───────────────────────────────────────────────────────

def content_project_id(project: Optional[ProgramDistrict]) -> Optional[int]:
    """Whose stages/tutorials/tests/form assignments this project serves."""
    if project is None:
        return None
    return project.content_source_id


def content_project_id_for_slug(db: Session, slug: str) -> Optional[int]:
    return content_project_id(by_slug(db, slug))


def content_project_id_for(db: Session, project_id: Optional[int]) -> Optional[int]:
    """Resolve a raw project id (e.g. ``user.program_district_id``) to the id
    whose content that project serves. Cheap: one PK lookup, and only when the
    project actually inherits does it differ."""
    if not project_id:
        return project_id
    project = db.query(ProgramDistrict).filter(ProgramDistrict.id == project_id).first()
    return content_project_id(project) if project else project_id


def member_project_ids(db: Session, project: Optional[ProgramDistrict]) -> List[int]:
    """Project ids whose LEARNERS belong to this project's scope.

    Learners always sit in a concrete project, so selecting a state must also
    surface everyone in its districts (an admin looking at Meghalaya expects
    every Meghalaya learner, not an empty list).
    """
    if project is None:
        return []
    ids = [project.id]
    if project.is_state:
        ids.extend(c.id for c in child_districts(db, project))
    return ids


def analysis_level(project: Optional[ProgramDistrict]) -> str:
    """'state' (crosstab by district) or 'district' (crosstab by block)."""
    if project is not None and project.is_state:
        return LEVEL_STATE
    return LEVEL_DISTRICT


# ── Analytics identity (pipelines + raw data) ────────────────────────────────

def project_code(project: ProgramDistrict) -> str:
    """Short code used for pipeline workspace isolation. Falls back to a
    slug-derived code so a project created before codes existed still runs."""
    if project.code:
        return project.code.upper()
    letters = [c for c in (project.slug or project.name or "") if c.isalnum()]
    return ("".join(letters)[:2] or "XX").upper()


def state_prefix(project: ProgramDistrict, db: Optional[Session] = None) -> str:
    """State abbreviation used in raw-file names ('MP Ujjain_…')."""
    if project.state_prefix:
        return project.state_prefix.upper()
    if project.parent_id and db is not None:
        parent = db.query(ProgramDistrict).filter(ProgramDistrict.id == project.parent_id).first()
        if parent and parent.state_prefix:
            return parent.state_prefix.upper()
    return project_code(project)


def serialize(db: Session, project: ProgramDistrict, *, user_count: Optional[int] = None,
              children: Optional[Iterable[ProgramDistrict]] = None) -> dict:
    """API shape for one project (children included for state projects)."""
    data = {
        "id": project.id,
        "name": project.name,
        "slug": project.slug,
        "is_active": project.is_active,
        "level": project.level or LEVEL_DISTRICT,
        "parent_id": project.parent_id,
        "inherits_content": bool(project.inherits_content),
        "code": project.code,
        "state_prefix": project.state_prefix,
        "analysis_level": analysis_level(project),
    }
    if user_count is not None:
        data["user_count"] = user_count
    if project.is_state:
        kids = list(children) if children is not None else child_districts(db, project)
        data["children"] = [serialize(db, c) for c in kids]
    return data
