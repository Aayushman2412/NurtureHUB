"""
Learner-facing endpoints for the dynamic form system (BF/CF assessments).

A response always belongs to a Child (ownership: learner → mother → child).
The client submits only node ids / option ids / raw values; the server
re-derives labels, green/red verdicts and coaching actions from the CURRENT
form definition and stores denormalized snapshots, so past assessments stay
readable even after the admin edits the form on the canvas.

Business rules:
- Only 'flow' forms (breastfeeding, complementary_feeding) accept responses.
- complementary_feeding is locked until the child is 150 days old at the
  assessment date (client disables it; enforced server-side here too).
- Submitting creates in-app notifications: one summary + one per coaching action.
"""

import os
import uuid
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.dependencies import get_verified_user

router = APIRouter(prefix="/api/forms", tags=["forms"])

FLOW_FORM_KEYS = {"breastfeeding", "complementary_feeding"}
# Flat (field-list) forms learners can submit per child.
FLAT_RESPONSE_FORM_KEYS = {"growth_monitoring"}
RESPONSE_FORM_KEYS = FLOW_FORM_KEYS | FLAT_RESPONSE_FORM_KEYS
CF_MIN_AGE_DAYS = 150
MAX_ACTION_NOTIFICATIONS = 15

# Scoring polarity for the two built-in verdicts, used when a definition
# predates custom verdicts (no `verdicts` list on the schema).
DEFAULT_VERDICT_SCORING = [
    {"id": "green", "scoring": "positive"},
    {"id": "red", "scoring": "negative"},
]

_LEARNER_UPLOAD_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
_LEARNER_UPLOAD_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


# ── Schemas ──────────────────────────────────────────────────────────────────

class AnswerIn(BaseModel):
    nodeId: str
    sectionId: Optional[str] = None
    optionIds: List[str] = Field(default_factory=list)
    value: Optional[str] = None


class ResponseCreate(BaseModel):
    child_id: int
    assessment_date: date
    status: str = "draft"  # 'draft' | 'submitted'
    answers: List[AnswerIn] = Field(default_factory=list)


class ResponseUpdate(BaseModel):
    assessment_date: date
    status: str = "draft"
    answers: List[AnswerIn] = Field(default_factory=list)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_definition(db: Session, form_key: str) -> models.FormDefinition:
    definition = (
        db.query(models.FormDefinition)
        .filter(models.FormDefinition.form_key == form_key)
        .first()
    )
    if not definition:
        raise HTTPException(status_code=404, detail="Form not found")
    return definition


def _get_owned_child(db: Session, child_id: int, user: models.User) -> models.Child:
    child = (
        db.query(models.Child)
        .join(models.Mother, models.Child.mother_id == models.Mother.id)
        .filter(
            models.Child.id == child_id,
            models.Mother.registered_by_user_id == user.id,
        )
        .first()
    )
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")
    return child


def _get_owned_response(db: Session, response_id: int, user: models.User) -> models.FormResponse:
    response = (
        db.query(models.FormResponse)
        .join(models.Child, models.FormResponse.child_id == models.Child.id)
        .join(models.Mother, models.Child.mother_id == models.Mother.id)
        .filter(
            models.FormResponse.id == response_id,
            models.Mother.registered_by_user_id == user.id,
        )
        .first()
    )
    if not response:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return response


def _check_cf_gate(form_key: str, child: models.Child, assessment_date: date) -> None:
    if form_key != "complementary_feeding":
        return
    if not child.dob:
        raise HTTPException(
            status_code=400,
            detail="Complementary feeding needs the child's date of birth. Add it to the child record first.",
        )
    age_days = (assessment_date - child.dob).days
    if age_days < CF_MIN_AGE_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Complementary feeding assessments unlock when the child is {CF_MIN_AGE_DAYS} days old "
                   f"(child is {max(age_days, 0)} days old on the assessment date).",
        )


def _index_questions(schema: Dict[str, Any]) -> Dict[str, tuple]:
    """question id → (owning section id | None, question dict), section children included."""
    questions: Dict[str, tuple] = {}
    for node in (schema.get("nodes") or {}).values():
        if not isinstance(node, dict):
            continue
        if node.get("kind") == "section":
            for child in node.get("children") or []:
                if isinstance(child, dict) and child.get("id"):
                    questions[child["id"]] = (node.get("id"), child)
        elif node.get("id"):
            questions[node["id"]] = (None, node)
    return questions


def _reachable_question_count(schema: Dict[str, Any]) -> int:
    """Answerable questions reachable from the start (section children expanded)."""
    nodes = schema.get("nodes") or {}
    start = schema.get("startNodeId")
    if not start or start not in nodes:
        return 0
    seen: set = set()
    queue = [start]
    count = 0
    while queue:
        node_id = queue.pop(0)
        if node_id in seen:
            continue
        seen.add(node_id)
        node = nodes.get(node_id)
        if not isinstance(node, dict):
            continue
        if node.get("kind") == "section":
            count += len(node.get("children") or [])
        else:
            count += 1
        nxt = node.get("next")
        if nxt and nxt in nodes:
            queue.append(nxt)
        for opt in node.get("options") or []:
            target = isinstance(opt, dict) and opt.get("next")
            if target and target in nodes:
                queue.append(target)
    return count


def _snapshot_answers(schema: Dict[str, Any], answers: List[AnswerIn]) -> tuple:
    """Resolve client answers against the definition → (answers_json, summary_json, actions_json)."""
    questions = _index_questions(schema)
    answer_snapshots: List[Dict[str, Any]] = []
    triggered_actions: List[Dict[str, Any]] = []
    green = red = neutral = 0

    # verdict id → scoring polarity. Falls back to the built-ins so definitions
    # saved before custom verdicts existed score exactly as they always did.
    verdict_defs = schema.get("verdicts") or DEFAULT_VERDICT_SCORING
    scoring_by_verdict: Dict[str, str] = {
        d.get("id"): d.get("scoring", "neutral")
        for d in verdict_defs
        if isinstance(d, dict) and d.get("id")
    }

    # Each question is scored at most once regardless of client input — a
    # duplicate nodeId would otherwise double-count verdicts and duplicate
    # coaching notifications. Last entry wins, first position kept.
    deduped: Dict[str, AnswerIn] = {}
    for answer in answers:
        deduped[answer.nodeId] = answer

    for answer in deduped.values():
        entry = questions.get(answer.nodeId)
        if not entry:
            continue  # question was deleted from the definition mid-fill — skip gracefully
        section_id, question = entry
        options_by_id = {
            o.get("id"): o for o in (question.get("options") or []) if isinstance(o, dict)
        }
        selected: List[Dict[str, Any]] = []
        for option_id in answer.optionIds:
            option = options_by_id.get(option_id)
            if not option:
                continue
            verdict = option.get("verdict")
            # Score by the verdict's declared polarity, not its id: a form may
            # define its own verdicts, and only `scoring` says which side of the
            # ledger they land on. This keeps summary_json a stable
            # {green, red, neutral} shape, so history/trend/plan need no change.
            scoring = scoring_by_verdict.get(verdict) if verdict else None
            if scoring == "positive":
                green += 1
            elif scoring == "negative":
                red += 1
            else:
                neutral += 1
            action = option.get("action") or {}
            selected.append({
                "optionId": option_id,
                "label": option.get("label") or "",
                "verdict": verdict,
                "action": action,
            })
            if action.get("type") and action.get("type") != "none":
                triggered_actions.append({
                    "nodeId": answer.nodeId,
                    "question": question.get("title") or "",
                    "optionId": option_id,
                    "optionLabel": option.get("label") or "",
                    "verdict": verdict,
                    "action": action,
                })
        answer_snapshots.append({
            "nodeId": answer.nodeId,
            "sectionId": section_id,
            "question": question.get("title") or "",
            "questionType": question.get("questionType") or "single",
            "value": answer.value,
            "selected": selected,
        })

    summary = {
        "green": green,
        "red": red,
        "neutral": neutral,
        "answered": len(answer_snapshots),
        "total": _reachable_question_count(schema),
    }
    return answer_snapshots, summary, triggered_actions


def _flat_field_visible(field: Dict[str, Any], values: Dict[str, List[str]], age_days: Optional[int]) -> bool:
    """Server-side mirror of the client's showIf evaluation (AND of conditions)."""
    for cond in field.get("showIf") or []:
        kind = cond.get("kind")
        if kind == "ageLtDays":
            if age_days is None or cond.get("days") is None or not age_days < cond["days"]:
                return False
        elif kind == "ageGteDays":
            if age_days is None or cond.get("days") is None or not age_days >= cond["days"]:
                return False
        else:  # 'field'
            any_of = cond.get("anyOf") or []
            selected = values.get(cond.get("fieldId") or "", [])
            if any_of and not any(v in any_of for v in selected):
                return False
    return True


def _snapshot_flat_answers(
    schema: Dict[str, Any],
    answers: List[AnswerIn],
    child: models.Child,
    assessment_date: date,
    enforce: bool,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], List[Dict[str, Any]]]:
    """Validate + snapshot a flat (field-list) submission against the definition.

    Server is authoritative: visibility is re-evaluated here, required visible
    fields must be present (when `enforce`, i.e. on submit — drafts may be
    partial), and number/date constraints are enforced. Snapshot items keep the
    same shape as flow answers so history/detail rendering stays uniform.
    """
    fields = [f for f in (schema.get("fields") or []) if isinstance(f, dict) and f.get("id")]
    by_id = {a.nodeId: a for a in answers}

    # Raw values map for visibility evaluation (choice fields → optionIds).
    choice_types = {"dropdown", "radio", "checkbox"}
    values: Dict[str, List[str]] = {}
    for f in fields:
        a = by_id.get(f["id"])
        if not a:
            continue
        values[f["id"]] = list(a.optionIds) if f.get("type") in choice_types else ([a.value] if a.value else [])

    age_days = (assessment_date - child.dob).days if child.dob else None
    snapshots: List[Dict[str, Any]] = []
    visible_total = 0

    def _bad(field: Dict[str, Any], why: str) -> HTTPException:
        return HTTPException(status_code=400, detail=f"{field.get('label') or field.get('id')}: {why}")

    for f in fields:
        if not _flat_field_visible(f, values, age_days):
            continue
        visible_total += 1
        ftype = f.get("type") or "text"
        a = by_id.get(f["id"])
        selected_values = values.get(f["id"], [])
        raw_value = (a.value or "").strip() if a and a.value else ""
        answered = bool(selected_values) if ftype in choice_types else bool(raw_value)

        if not answered:
            if enforce and f.get("required", True):
                raise _bad(f, "this answer is required")
            continue

        if ftype == "number":
            try:
                n = float(raw_value)
            except ValueError:
                raise _bad(f, "enter a valid number")
            if (f.get("min") is not None and n < f["min"]) or (f.get("max") is not None and n > f["max"]):
                raise _bad(f, f"value must be between {f.get('min')} and {f.get('max')}")
            decimals = f.get("decimals")
            if decimals is not None:
                frac = raw_value.split(".")[1] if "." in raw_value else ""
                if len(frac) > decimals:
                    raise _bad(f, f"use at most {decimals} decimal place(s)")
        elif ftype == "date":
            try:
                d = date.fromisoformat(raw_value[:10])
            except ValueError:
                raise _bad(f, "enter a valid date")
            if f.get("noFuture") and d > date.today():
                raise _bad(f, "date cannot be in the future")
            if f.get("notBeforeDob") and child.dob and d < child.dob:
                raise _bad(f, "date cannot be before the child's date of birth")

        option_labels = {o.get("value"): o.get("label") for o in (f.get("options") or []) if isinstance(o, dict)}
        selected = [
            {"optionId": v, "label": option_labels.get(v, v), "verdict": None,
             "action": {"type": "none", "message": "", "url": "", "startSeconds": None, "endSeconds": None}}
            for v in selected_values
            if not option_labels or v in option_labels
        ]
        snapshots.append({
            "nodeId": f["id"],
            "sectionId": None,
            "question": f.get("label") or "",
            "questionType": ftype,
            "value": raw_value or None,
            "selected": selected,
        })

    summary = {"green": 0, "red": 0, "neutral": 0, "answered": len(snapshots), "total": visible_total}
    return snapshots, summary, []


def _notify_on_submit(
    db: Session,
    user: models.User,
    definition: models.FormDefinition,
    child: models.Child,
    summary: Dict[str, Any],
    actions: List[Dict[str, Any]],
) -> None:
    """One summary notification + one per coaching action (capped).

    Per-action notifications are suppressed for questions whose coaching
    actions are hidden — either form-wide (`schema_json.display.actions`) or by
    the question's own override (`question.display.actions`) — so a learner is
    never notified about an action the app will not show them. The summary
    notification is always sent, and `actions_json` is still stored.
    """
    schema = definition.schema_json or {}
    default_actions = ((schema.get("display") or {}).get("actions", True))
    actions_visible: Dict[str, bool] = {}
    for node in (schema.get("nodes") or {}).values():
        if not isinstance(node, dict):
            continue
        questions = node.get("children") or [] if node.get("kind") == "section" else [node]
        for q in questions:
            if not isinstance(q, dict) or not q.get("id"):
                continue
            override = (q.get("display") or {}).get("actions")
            actions_visible[q["id"]] = default_actions if override is None else bool(override)

    db.add(models.Notification(
        user_id=user.id,
        title=f"{definition.title} — {child.child_name}",
        message=(
            f"{summary['green']} step(s) as per LAP, {summary['red']} need attention. "
            "Open the assessment plan to see the recommended actions."
        ),
    ))
    visible = [a for a in actions if actions_visible.get(a.get("nodeId"), default_actions)]
    for item in visible[:MAX_ACTION_NOTIFICATIONS]:
        action = item.get("action") or {}
        action_type = action.get("type")
        if action_type in ("notify", "info"):
            message = action.get("message") or item.get("question") or ""
        else:  # youtube / video
            caption = action.get("message")
            message = f"Watch the tutorial: {caption or item.get('question') or ''}"
        db.add(models.Notification(
            user_id=user.id,
            title=f"{child.child_name}: {item.get('question') or definition.title}",
            message=message[:500],
        ))


def _serialize_list_item(r: models.FormResponse) -> Dict[str, Any]:
    return {
        "id": r.id,
        "assessment_date": r.assessment_date.isoformat() if r.assessment_date else None,
        "status": r.status,
        "summary_json": r.summary_json or {},
        "definition_version": r.definition_version,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _serialize_detail(r: models.FormResponse, child: models.Child) -> Dict[str, Any]:
    data = _serialize_list_item(r)
    data.update({
        "form_key": r.form_key,
        "child_id": r.child_id,
        "mother_id": child.mother_id,
        "child_name": child.child_name,
        "answers_json": r.answers_json or [],
        "actions_json": r.actions_json or [],
    })
    return data


def _validate_status(status_value: str) -> None:
    if status_value not in ("draft", "submitted"):
        raise HTTPException(status_code=400, detail="status must be 'draft' or 'submitted'")


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/uploads")
async def upload_learner_media(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_verified_user),
):
    """Photo upload for form answers (e.g. CG measurement photos). Images only."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _LEARNER_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext or 'unknown'}'. "
                   f"Allowed: {', '.join(sorted(_LEARNER_UPLOAD_EXTENSIONS))}",
        )
    chunks: List[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1 << 20)
        if not chunk:
            break
        total += len(chunk)
        if total > _LEARNER_UPLOAD_MAX_BYTES:
            raise HTTPException(status_code=400, detail="Photo is larger than the 10 MB limit")
        chunks.append(chunk)

    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    target_dir = os.path.join(backend_dir, "uploads", "learner_media")
    os.makedirs(target_dir, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(target_dir, filename), "wb") as fh:
        fh.write(b"".join(chunks))
    return {"url": f"/uploads/learner_media/{filename}"}


@router.get("/responses/{response_id}")
def get_response(
    response_id: int,
    current_user: models.User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    response = _get_owned_response(db, response_id, current_user)
    child = db.query(models.Child).filter(models.Child.id == response.child_id).first()
    return _serialize_detail(response, child)


@router.put("/responses/{response_id}")
def update_response(
    response_id: int,
    data: ResponseUpdate,
    current_user: models.User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    _validate_status(data.status)
    response = _get_owned_response(db, response_id, current_user)
    if response.status == "submitted":
        raise HTTPException(status_code=400, detail="A submitted assessment cannot be edited")

    definition = _get_definition(db, response.form_key)
    child = db.query(models.Child).filter(models.Child.id == response.child_id).first()
    _check_cf_gate(response.form_key, child, data.assessment_date)

    if definition.builder_type == "flat":
        answers, summary, actions = _snapshot_flat_answers(
            definition.schema_json or {}, data.answers, child, data.assessment_date,
            enforce=data.status == "submitted",
        )
    else:
        answers, summary, actions = _snapshot_answers(definition.schema_json or {}, data.answers)
    response.assessment_date = data.assessment_date
    response.status = data.status
    response.definition_version = definition.version
    response.answers_json = answers
    response.summary_json = summary
    response.actions_json = actions

    if data.status == "submitted" and definition.builder_type == "flow":
        _notify_on_submit(db, current_user, definition, child, summary, actions)

    db.commit()
    db.refresh(response)
    return _serialize_detail(response, child)


@router.delete("/responses/{response_id}")
def delete_response(
    response_id: int,
    current_user: models.User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    response = _get_owned_response(db, response_id, current_user)
    if response.status == "submitted":
        raise HTTPException(status_code=400, detail="A submitted assessment cannot be deleted")
    db.delete(response)
    db.commit()
    return {"message": "Draft deleted"}


@router.get("/{form_key}")
def get_form_definition(
    form_key: str,
    current_user: models.User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    definition = _get_definition(db, form_key)
    return {
        "id": definition.id,
        "form_key": definition.form_key,
        "title": definition.title,
        "description": definition.description,
        "builder_type": definition.builder_type,
        "version": definition.version,
        "schema_json": definition.schema_json or {},
        "updated_at": definition.updated_at.isoformat() if definition.updated_at else None,
        "updated_by": None,  # not exposed to learners
    }


@router.get("/{form_key}/responses")
def list_responses(
    form_key: str,
    child_id: int = Query(...),
    current_user: models.User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    _get_owned_child(db, child_id, current_user)
    rows = (
        db.query(models.FormResponse)
        .filter(
            models.FormResponse.child_id == child_id,
            models.FormResponse.form_key == form_key,
        )
        .order_by(models.FormResponse.assessment_date.desc(), models.FormResponse.id.desc())
        .all()
    )
    return [_serialize_list_item(r) for r in rows]


@router.post("/{form_key}/responses")
def create_response(
    form_key: str,
    data: ResponseCreate,
    current_user: models.User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    if form_key not in RESPONSE_FORM_KEYS:
        raise HTTPException(status_code=400, detail="This form does not accept assessments")
    _validate_status(data.status)

    definition = _get_definition(db, form_key)
    child = _get_owned_child(db, data.child_id, current_user)
    _check_cf_gate(form_key, child, data.assessment_date)

    if definition.builder_type == "flat":
        answers, summary, actions = _snapshot_flat_answers(
            definition.schema_json or {}, data.answers, child, data.assessment_date,
            enforce=data.status == "submitted",
        )
    else:
        answers, summary, actions = _snapshot_answers(definition.schema_json or {}, data.answers)
    response = models.FormResponse(
        form_key=form_key,
        definition_version=definition.version,
        child_id=child.id,
        submitted_by_user_id=current_user.id,
        assessment_date=data.assessment_date,
        status=data.status,
        answers_json=answers,
        summary_json=summary,
        actions_json=actions,
    )
    db.add(response)

    if data.status == "submitted" and definition.builder_type == "flow":
        _notify_on_submit(db, current_user, definition, child, summary, actions)

    db.commit()
    db.refresh(response)
    return _serialize_detail(response, child)
