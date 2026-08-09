"""Shared layer for the raw-data export generators.

Design rules (every gen_*.py module follows them):

- A generator NEVER queries the database. It receives a :class:`Dataset` —
  plain lists/dicts of ORM rows (or mock look-alikes) — and returns rows of
  strings. That single seam is what lets RAW_EXPORT_MOCK fabricate a large
  dataset and push it through the exact same generator code.
- Headers must match the legacy reference files BYTE-FOR-BYTE, including the
  trailing ' *', ' #', ' * #' form-field markers — the pipeline strips them on
  read, but only when they are exactly right.
- Blank cells are the literal string "NULL" (legacy platform convention);
  dates are DD/MM/YYYY; option-valued cells carry the option LABEL text.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app import models

NULL = "NULL"


# ── Cell formatting ──────────────────────────────────────────────────────────

def s(value: Any) -> str:
    """String cell; None/empty → NULL."""
    if value is None:
        return NULL
    text = str(value).strip()
    return text if text else NULL


def ddmmyyyy(value: Any) -> str:
    """date/datetime → DD/MM/YYYY; None → NULL."""
    if value is None:
        return NULL
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    return s(value)


def num(value: Any) -> str:
    """Number cell; integers render without a decimal point (58 not 58.0)."""
    if value is None:
        return NULL
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def yesno(value: Optional[bool]) -> str:
    if value is None:
        return NULL
    return "Yes" if value else "No"


def truefalse(value: Optional[bool]) -> str:
    if value is None:
        return NULL
    return "true" if value else "false"


def epoch_ms(value: Any) -> str:
    if value is None:
        return NULL
    if isinstance(value, date) and not isinstance(value, datetime):
        value = datetime(value.year, value.month, value.day)
    return str(int(value.timestamp() * 1000))


# ── Response answer access ───────────────────────────────────────────────────

class ResponseView:
    """Convenient access to a FormResponse's denormalized answers_json."""

    def __init__(self, response: Any):
        self.response = response
        self.by_node: Dict[str, Dict[str, Any]] = {}
        for snap in (response.answers_json or []):
            if isinstance(snap, dict) and snap.get("nodeId"):
                self.by_node[snap["nodeId"]] = snap

    def has(self, node_id: str) -> bool:
        return node_id in self.by_node

    def value(self, node_id: str) -> str:
        """The raw text value (text/number/date fields)."""
        snap = self.by_node.get(node_id)
        return s(snap.get("value")) if snap else NULL

    def _labels(self, node_id: str) -> List[str]:
        snap = self.by_node.get(node_id)
        if not snap:
            return []
        return [
            sel.get("label") or sel.get("optionId") or ""
            for sel in (snap.get("selected") or [])
            if isinstance(sel, dict) and sel.get("optionId") != "__out_of_range__"
        ]

    def label(self, node_id: str) -> str:
        """First selected option's LABEL (single-choice fields)."""
        labels = self._labels(node_id)
        if labels:
            return s(labels[0])
        # Choice questions answered via free value (rare) fall back to value.
        return self.value(node_id)

    def labels(self, node_id: str, sep: str = ", ") -> str:
        """All selected option labels joined (multi-select fields)."""
        labels = [l for l in self._labels(node_id) if l]
        return sep.join(labels) if labels else NULL

    def grid(self, node_id: str) -> Dict[str, Any]:
        """Matrix answers: the JSON grid {rowId: {colId: cellValue}}."""
        snap = self.by_node.get(node_id)
        raw = snap.get("value") if snap else None
        if not raw:
            return {}
        try:
            parsed = json.loads(raw) if isinstance(raw, str) else raw
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            return {}


# ── The dataset a generator consumes ─────────────────────────────────────────

@dataclass
class Dataset:
    """Everything the generators may touch. Real mode fills it from Postgres,
    mock mode fabricates look-alike objects with the same attribute names."""
    district: str                                   # e.g. "Ujjain"
    project_code: str                               # e.g. "UJ"
    mothers: List[Any] = field(default_factory=list)
    children: List[Any] = field(default_factory=list)
    learners: List[Any] = field(default_factory=list)     # users of the district
    responses: Dict[str, List[Any]] = field(default_factory=dict)  # form_key → rows
    mothers_by_id: Dict[int, Any] = field(default_factory=dict)
    children_by_id: Dict[int, Any] = field(default_factory=dict)
    children_by_mother: Dict[int, List[Any]] = field(default_factory=dict)
    learners_by_id: Dict[int, Any] = field(default_factory=dict)
    # id → display-name lookups (geography, education, facilities, designations)
    district_names: Dict[int, str] = field(default_factory=dict)
    block_names: Dict[int, str] = field(default_factory=dict)
    education_names: Dict[int, str] = field(default_factory=dict)
    facility_names: Dict[int, str] = field(default_factory=dict)
    designation_names: Dict[int, str] = field(default_factory=dict)
    department_names: Dict[int, str] = field(default_factory=dict)
    # MASD learner-progress extras
    tutorial_progress_by_user: Dict[int, List[Any]] = field(default_factory=dict)
    test_attempts_by_user: Dict[int, List[Any]] = field(default_factory=dict)
    stages: List[Any] = field(default_factory=list)
    tutorials_by_id: Dict[int, Any] = field(default_factory=dict)
    tests_by_id: Dict[int, Any] = field(default_factory=dict)

    def learner_of(self, row: Any) -> Any:
        """The learner (User) who registered/submitted `row`, or None."""
        uid = getattr(row, "registered_by_user_id", None) or getattr(row, "submitted_by_user_id", None)
        return self.learners_by_id.get(uid) if uid else None

    def mother_of_response(self, response: Any) -> Any:
        if getattr(response, "mother_id", None):
            return self.mothers_by_id.get(response.mother_id)
        child = self.children_by_id.get(getattr(response, "child_id", None) or 0)
        return self.mothers_by_id.get(child.mother_id) if child else None

    def child_of_response(self, response: Any) -> Any:
        return self.children_by_id.get(getattr(response, "child_id", None) or 0)


def load_dataset(db: Session, district: str, project_code: str) -> Dataset:
    """Assemble the district's real data. District = ProgramDistrict name
    (case-insensitive) of the learners who registered the records."""
    ds = Dataset(district=district, project_code=project_code)

    pd_row = (
        db.query(models.ProgramDistrict)
        .filter(models.ProgramDistrict.name.ilike(district))
        .first()
    )
    learner_q = db.query(models.User)
    if pd_row:
        learner_q = learner_q.filter(models.User.program_district_id == pd_row.id)
    ds.learners = learner_q.all()
    ds.learners_by_id = {u.id: u for u in ds.learners}
    learner_ids = set(ds.learners_by_id)

    ds.mothers = [
        m for m in db.query(models.Mother).order_by(models.Mother.id).all()
        if m.registered_by_user_id in learner_ids
    ]
    ds.mothers_by_id = {m.id: m for m in ds.mothers}
    ds.children = [
        c for c in db.query(models.Child).order_by(models.Child.id).all()
        if c.mother_id in ds.mothers_by_id
    ]
    ds.children_by_id = {c.id: c for c in ds.children}
    for c in ds.children:
        ds.children_by_mother.setdefault(c.mother_id, []).append(c)

    child_ids = set(ds.children_by_id)
    mother_ids = set(ds.mothers_by_id)
    for r in (
        db.query(models.FormResponse)
        .order_by(models.FormResponse.id)
        .all()
    ):
        if (r.child_id and r.child_id in child_ids) or (r.mother_id and r.mother_id in mother_ids):
            ds.responses.setdefault(r.form_key, []).append(r)

    ds.district_names = {d.id: d.name for d in db.query(models.District).all()}
    ds.block_names = {b.id: b.name for b in db.query(models.Block).all()}
    if hasattr(models, "MotherEducationLevel"):
        ds.education_names = {e.id: e.name for e in db.query(models.MotherEducationLevel).all()}
    if hasattr(models, "Facility"):
        ds.facility_names = {f.id: f.name for f in db.query(models.Facility).all()}
    if hasattr(models, "Designation"):
        ds.designation_names = {d.id: d.name for d in db.query(models.Designation).all()}
    if hasattr(models, "Department"):
        ds.department_names = {d.id: d.name for d in db.query(models.Department).all()}

    # MASD learner progress
    for p in db.query(models.UserTutorialProgress).all():
        if p.user_id in learner_ids:
            ds.tutorial_progress_by_user.setdefault(p.user_id, []).append(p)
    for a in db.query(models.TestAttempt).all():
        if a.user_id in learner_ids:
            ds.test_attempts_by_user.setdefault(a.user_id, []).append(a)
    if pd_row:
        ds.stages = (
            db.query(models.Stage)
            .filter(models.Stage.program_district_id == pd_row.id)
            .order_by(models.Stage.order_index)
            .all()
        )
    stage_ids = {st.id for st in ds.stages}
    ds.tutorials_by_id = {
        t.id: t for t in db.query(models.Tutorial).all() if t.stage_id in stage_ids
    }
    ds.tests_by_id = {
        t.id: t for t in db.query(models.Test).all() if t.stage_id in stage_ids
    }
    return ds
