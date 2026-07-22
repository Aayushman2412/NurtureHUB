"""
Admin endpoints for the Form Builder.

Seven form definitions exist (see app.seed_forms.FORM_SPECS): five 'flat'
field-list forms and the two 'flow' canvas decision-trees (breastfeeding,
complementary feeding). Saving a definition bumps its version and is live for
learners immediately — there is no draft/publish step, and no import/export.

Also hosts the media upload endpoint used by the canvas builder for option
images/GIFs and action videos; files land in backend/uploads/form_assets/ and
are served by the StaticFiles mount at /uploads (see app.main).
"""

import os
import re
import uuid
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_admin_email, get_current_admin
from app.models import FormDefinition
from app.seed_forms import FORM_SPECS, ensure_form_definitions

router = APIRouter(prefix="/api/admin", tags=["admin-forms"], dependencies=[Depends(get_current_admin)])

UPLOADS_SUBDIR = "form_assets"

# No .svg: an SVG can carry <script> and would execute in the backend origin
# when its /uploads URL is opened directly (stored XSS) — raster formats only.
_ALLOWED_UPLOAD_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif",   # option media
    ".mp4", ".webm", ".mp3",                    # action media
}
_MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB


# ── Flow-schema validation models (permissive but structural) ────────────────

class FlowActionModel(BaseModel):
    type: Literal["none", "notify", "youtube", "video", "info"] = "none"
    message: str = ""
    url: str = ""
    startSeconds: Optional[float] = None
    endSeconds: Optional[float] = None

    @field_validator("url")
    @classmethod
    def _block_dangerous_schemes(cls, v: str) -> str:
        """Learner pages render these URLs — allow http(s), bare YouTube ids and
        relative /uploads paths, but reject javascript:, data: and friends."""
        scheme = re.match(r"^([a-zA-Z][a-zA-Z0-9+.\-]*):", (v or "").strip())
        if scheme and scheme.group(1).lower() not in ("http", "https"):
            raise ValueError("action URL must be an http(s) link")
        return v


class FlowMediaModel(BaseModel):
    type: Literal["image", "gif"] = "image"
    url: str


class FlowOptionModel(BaseModel):
    id: str
    label: str = ""
    media: List[FlowMediaModel] = Field(default_factory=list)
    # A VerdictDef id (`null` = no verdict). Not a Literal any more: a form may
    # define its own verdicts. FlowSchemaModel checks the id actually exists.
    verdict: Optional[str] = None
    action: FlowActionModel = Field(default_factory=FlowActionModel)
    next: Optional[str] = None


class QuestionDisplayModel(BaseModel):
    """Per-QUESTION overrides of FlowDisplayModel. Every field is optional —
    None inherits the form-level default, so an absent override is a no-op."""
    helpText: Optional[bool] = None
    questionMedia: Optional[bool] = None
    optionMedia: Optional[bool] = None
    verdictTiming: Optional[Literal["during", "after", "never"]] = None
    actions: Optional[bool] = None


class NumericRangeModel(BaseModel):
    """Numerical-answer constraints. `decimals` is hard (max decimal places);
    flagMin/flagMax are soft — an out-of-range value is stored but flagged."""
    decimals: Optional[int] = None
    flagMin: Optional[float] = None
    flagMax: Optional[float] = None


class MatrixColumnOptionModel(BaseModel):
    label: str = ""
    value: str = ""


class MatrixColumnModel(BaseModel):
    id: str
    label: str = ""
    type: Literal["number", "text", "date", "datetime", "dropdown"] = "dropdown"
    required: bool = False
    options: Optional[List[MatrixColumnOptionModel]] = None
    numeric: Optional[NumericRangeModel] = None


class MatrixRowModel(BaseModel):
    id: str
    label: str = ""
    helpText: Optional[str] = None


class FlowSectionChildModel(BaseModel):
    id: str
    kind: Literal["question"] = "question"
    questionType: Literal["single", "multi", "text", "date", "number"] = "single"
    title: str = ""
    helpText: str = ""
    required: bool = True
    media: List[FlowMediaModel] = Field(default_factory=list)  # question-level illustrations
    options: List[FlowOptionModel] = Field(default_factory=list)
    numeric: Optional[NumericRangeModel] = None
    display: Optional[QuestionDisplayModel] = None


class FlowPositionModel(BaseModel):
    x: float = 0
    y: float = 0


class FlowNodeModel(BaseModel):
    id: str
    kind: Literal["question", "section", "info", "matrix"] = "question"
    questionType: Optional[Literal["single", "multi", "text", "date", "number"]] = None
    title: str = ""
    helpText: str = ""
    required: bool = True
    media: List[FlowMediaModel] = Field(default_factory=list)  # question-level illustrations
    position: FlowPositionModel = Field(default_factory=FlowPositionModel)
    options: List[FlowOptionModel] = Field(default_factory=list)
    children: List[FlowSectionChildModel] = Field(default_factory=list)
    numeric: Optional[NumericRangeModel] = None
    # info block
    body: Optional[str] = None
    action: Optional[FlowActionModel] = None
    # matrix
    rows: Optional[List[MatrixRowModel]] = None
    columns: Optional[List[MatrixColumnModel]] = None
    next: Optional[str] = None
    display: Optional[QuestionDisplayModel] = None


class FlowDisplayModel(BaseModel):
    """Admin switches for what the learner sees. Display only — every answer is
    still collected and stored. Absent keys fall back to these defaults."""
    helpText: bool = True
    questionMedia: bool = True
    optionMedia: bool = True
    # Default to feedback-after-submit: revealing a verdict while answering lets
    # the worker change the answer once they see it, corrupting the record.
    verdictTiming: Literal["during", "after", "never"] = "after"
    actions: bool = True


class VerdictDefModel(BaseModel):
    """One entry in a form's verdict vocabulary.

    `scoring` is what keeps the summary a stable {green, red, neutral} shape no
    matter how many verdicts a form defines — see _snapshot_answers.
    """
    id: str
    label: str = ""
    color: str = "#6366f1"
    scoring: Literal["positive", "negative", "neutral"] = "neutral"


DEFAULT_VERDICTS: List[Dict[str, Any]] = [
    {"id": "green", "label": "As per LAP", "color": "#10b981", "scoring": "positive"},
    {"id": "red", "label": "Needs tutorial", "color": "#f43f5e", "scoring": "negative"},
]


class FlowSchemaModel(BaseModel):
    startNodeId: Optional[str] = None
    nodes: Dict[str, FlowNodeModel] = Field(default_factory=dict)
    display: FlowDisplayModel = Field(default_factory=FlowDisplayModel)
    verdicts: List[VerdictDefModel] = Field(
        default_factory=lambda: [VerdictDefModel(**v) for v in DEFAULT_VERDICTS]
    )

    @model_validator(mode="after")
    def _verdict_ids_resolve(self) -> "FlowSchemaModel":
        """Every option's verdict must name a declared verdict.

        Options store a verdict *id*, so a typo or a stale reference would
        silently score as neutral. Rejecting it here keeps the definition and
        its vocabulary consistent.
        """
        known = {v.id for v in self.verdicts}
        dupes = len(known) != len(self.verdicts)
        if dupes:
            raise ValueError("verdict ids must be unique")
        for node_id, node in self.nodes.items():
            questions = node.children if node.kind == "section" else [node]
            for q in questions:
                for opt in q.options:
                    if opt.verdict is not None and opt.verdict not in known:
                        raise ValueError(
                            f"nodes.{node_id}: option '{opt.id}' references "
                            f"unknown verdict '{opt.verdict}'"
                        )
        return self


class FlatFieldOptionModel(BaseModel):
    label: str
    value: str


class FlatFieldConditionModel(BaseModel):
    kind: Literal["field", "ageLtDays", "ageGteDays"] = "field"
    fieldId: Optional[str] = None
    anyOf: Optional[List[str]] = None
    days: Optional[float] = None


class FlatFieldModel(BaseModel):
    id: str
    label: str
    type: Literal["text", "number", "date", "dropdown", "radio", "textarea", "checkbox", "image"] = "text"
    placeholder: str = ""
    required: bool = True
    options: Optional[List[FlatFieldOptionModel]] = None
    helpText: Optional[str] = None
    min: Optional[float] = None
    max: Optional[float] = None
    decimals: Optional[int] = None
    # soft "expected range" — out-of-range is stored but flagged (not rejected)
    flagMin: Optional[float] = None
    flagMax: Optional[float] = None
    noFuture: Optional[bool] = None
    notBeforeDob: Optional[bool] = None
    showIf: Optional[List[FlatFieldConditionModel]] = None


class FlatSchemaModel(BaseModel):
    fields: List[FlatFieldModel] = Field(default_factory=list)


class FormDefinitionUpdate(BaseModel):
    # Attribute named schema_data because `schema_json` shadows a BaseModel
    # classmethod; the wire format stays "schema_json" via the alias.
    model_config = ConfigDict(populate_by_name=True)

    title: Optional[str] = None
    description: Optional[str] = None
    schema_data: Dict[str, Any] = Field(alias="schema_json")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _uploads_root() -> str:
    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(backend_dir, "uploads")


def _get_definition(db: Session, form_key: str) -> FormDefinition:
    if form_key not in FORM_SPECS:
        raise HTTPException(status_code=404, detail="Unknown form")
    ensure_form_definitions(db)
    definition = db.query(FormDefinition).filter(FormDefinition.form_key == form_key).first()
    if not definition:  # ensure_form_definitions just created it; re-query defensively
        raise HTTPException(status_code=404, detail="Form not found")
    return definition


def _node_count(definition: FormDefinition) -> int:
    schema = definition.schema_json or {}
    if definition.builder_type == "flat":
        return len(schema.get("fields") or [])
    count = 0
    for node in (schema.get("nodes") or {}).values():
        if isinstance(node, dict) and node.get("kind") == "section":
            count += len(node.get("children") or [])
        else:
            count += 1
    return count


def _serialize(definition: FormDefinition) -> Dict[str, Any]:
    return {
        "id": definition.id,
        "form_key": definition.form_key,
        "title": definition.title,
        "description": definition.description,
        "builder_type": definition.builder_type,
        "version": definition.version,
        "schema_json": definition.schema_json or {},
        "updated_at": definition.updated_at.isoformat() if definition.updated_at else None,
        "updated_by": definition.updated_by,
    }


def _validate_schema(builder_type: str, schema_json: Dict[str, Any]) -> Dict[str, Any]:
    """Structural validation; returns the normalized (model-dumped) schema."""
    try:
        if builder_type == "flow":
            model = FlowSchemaModel.model_validate(schema_json)
            # Referential integrity: next pointers must reference existing nodes.
            node_ids = set(model.nodes.keys())
            if model.startNodeId and model.startNodeId not in node_ids:
                raise HTTPException(status_code=400, detail="startNodeId does not reference an existing question")
            for node in model.nodes.values():
                if node.next and node.next not in node_ids:
                    raise HTTPException(status_code=400, detail=f"Question '{node.title or node.id}' points to a deleted step")
                for option in node.options:
                    if option.next and option.next not in node_ids:
                        raise HTTPException(status_code=400, detail=f"An option of '{node.title or node.id}' points to a deleted step")
            return model.model_dump()
        model = FlatSchemaModel.model_validate(schema_json)
        return model.model_dump()
    except ValidationError as exc:
        first = exc.errors()[0] if exc.errors() else {}
        location = ".".join(str(part) for part in first.get("loc", []))
        raise HTTPException(status_code=400, detail=f"Invalid form schema at {location}: {first.get('msg', 'validation error')}")


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/forms")
def list_forms(db: Session = Depends(get_db)):
    ensure_form_definitions(db)
    definitions = {d.form_key: d for d in db.query(FormDefinition).all()}
    # Return in the canonical FORM_SPECS order.
    out = []
    for form_key in FORM_SPECS:
        definition = definitions.get(form_key)
        if not definition:
            continue
        out.append({
            "form_key": definition.form_key,
            "title": definition.title,
            "builder_type": definition.builder_type,
            "version": definition.version,
            "updated_at": definition.updated_at.isoformat() if definition.updated_at else None,
            "node_count": _node_count(definition),
        })
    return out


@router.get("/forms/{form_key}")
def get_form(form_key: str, db: Session = Depends(get_db)):
    return _serialize(_get_definition(db, form_key))


@router.put("/forms/{form_key}")
def update_form(
    form_key: str,
    data: FormDefinitionUpdate,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    definition = _get_definition(db, form_key)
    definition.schema_json = _validate_schema(definition.builder_type, data.schema_data)
    if data.title is not None and data.title.strip():
        definition.title = data.title.strip()
    if data.description is not None:
        definition.description = data.description
    definition.version = (definition.version or 0) + 1
    definition.updated_by = admin_email
    db.commit()
    db.refresh(definition)
    return _serialize(definition)


@router.post("/forms/assets")
async def upload_form_asset(file: UploadFile = File(...)):
    """Store an option image/GIF or action video; returns its /uploads/... URL."""
    original_name = file.filename or ""
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in _ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext or 'unknown'}'. "
                   f"Allowed: {', '.join(sorted(_ALLOWED_UPLOAD_EXTENSIONS))}",
        )
    # Stream in bounded chunks so an oversized body is rejected without ever
    # being buffered whole in memory.
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1 << 20)  # 1 MB
        if not chunk:
            break
        total += len(chunk)
        if total > _MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="File is larger than the 25 MB limit")
        chunks.append(chunk)

    target_dir = os.path.join(_uploads_root(), UPLOADS_SUBDIR)
    os.makedirs(target_dir, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(target_dir, filename), "wb") as fh:
        for chunk in chunks:
            fh.write(chunk)
    return {"url": f"/uploads/{UPLOADS_SUBDIR}/{filename}"}
