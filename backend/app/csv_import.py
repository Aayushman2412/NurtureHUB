"""
CSV import for the dynamic form builder.

Turns an admin-uploaded CSV into the same schema_json shape the manual builder
UI produces, so it can go through the existing `_validate_schema` Pydantic
validation and save path (see app.routers.admin_forms.update_form).

Two builder types, two parsers, kept independent on purpose (see
app.routers.admin_forms.import_form_csv for the builder_type dispatch):
  - parse_flat_csv  — 'flat' forms (field lists): one row per field.
  - parse_flow_csv  — 'flow' forms (breastfeeding/complementary-feeding
    canvas trees): one row per *option*, with the parent question's columns
    repeated on each of its option rows.

Sections and media are deliberately out of scope for both — a CSV row always
produces a plain question node/field. Add support for either by extending
the relevant parser's column set later; it's additive, not a rework.
"""

import csv
import io
from typing import Any, Dict, List, Optional, Set


class CsvImportError(Exception):
    """Raised with a message safe to show directly to the admin (via HTTPException)."""

    def __init__(self, message: str, row: Optional[int] = None):
        self.row = row
        super().__init__(f"Row {row}: {message}" if row else message)


_REQUIRED_COLUMNS = {"field_id", "label", "type"}
_VALID_TYPES = {"text", "number", "date", "dropdown", "radio", "textarea", "checkbox", "image"}
_OPTION_TYPES = {"dropdown", "radio"}
_TRUE_VALUES = {"true", "1", "yes", "y"}
_FALSE_VALUES = {"false", "0", "no", "n"}


def _parse_bool(raw: str, field_name: str, row: int) -> bool:
    value = (raw or "").strip().lower()
    if value in _TRUE_VALUES:
        return True
    if value in _FALSE_VALUES:
        return False
    raise CsvImportError(f"'{field_name}' must be TRUE or FALSE, got '{raw}'", row)


def _parse_float(raw: str, field_name: str, row: int) -> Optional[float]:
    value = (raw or "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        raise CsvImportError(f"'{field_name}' must be a number, got '{raw}'", row)


def _parse_int(raw: str, field_name: str, row: int) -> Optional[int]:
    value = (raw or "").strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        raise CsvImportError(f"'{field_name}' must be a whole number, got '{raw}'", row)


def _parse_options(raw: str, row: int) -> Optional[List[Dict[str, str]]]:
    """'Yes:yes|No:no' -> [{"label": "Yes", "value": "yes"}, ...]"""
    value = (raw or "").strip()
    if not value:
        return None
    options = []
    for part in value.split("|"):
        part = part.strip()
        if not part:
            continue
        if ":" not in part:
            raise CsvImportError(f"'options' entry '{part}' must be in 'label:value' form", row)
        label, val = part.split(":", 1)
        label, val = label.strip(), val.strip()
        if not label or not val:
            raise CsvImportError(f"'options' entry '{part}' has an empty label or value", row)
        options.append({"label": label, "value": val})
    return options or None


def _parse_show_if(raw: str, row: int) -> Optional[List[Dict[str, Any]]]:
    """'field:qualification=other,none' or 'ageLtDays:180', ';'-separated for multiple (AND)."""
    value = (raw or "").strip()
    if not value:
        return None
    conditions = []
    for part in value.split(";"):
        part = part.strip()
        if not part:
            continue
        if ":" not in part:
            raise CsvImportError(
                f"'show_if' entry '{part}' must start with 'field:', 'ageLtDays:' or 'ageGteDays:'", row
            )
        kind, rest = part.split(":", 1)
        kind, rest = kind.strip(), rest.strip()
        if kind == "field":
            if "=" not in rest:
                raise CsvImportError(
                    f"'show_if' entry '{part}' must be 'field:<fieldId>=<value1>,<value2>'", row
                )
            field_id, values = rest.split("=", 1)
            any_of = [v.strip() for v in values.split(",") if v.strip()]
            if not field_id.strip() or not any_of:
                raise CsvImportError(f"'show_if' entry '{part}' is missing a field id or values", row)
            conditions.append({"kind": "field", "fieldId": field_id.strip(), "anyOf": any_of})
        elif kind in ("ageLtDays", "ageGteDays"):
            days = _parse_float(rest, "show_if", row)
            if days is None:
                raise CsvImportError(f"'show_if' entry '{part}' is missing a day count", row)
            conditions.append({"kind": kind, "days": days})
        else:
            raise CsvImportError(f"'show_if' has an unknown condition kind '{kind}'", row)
    return conditions or None


def parse_flat_csv(raw_bytes: bytes) -> Dict[str, Any]:
    """Parse a flat-form CSV into a `{"fields": [...]}` dict matching FlatSchemaModel.

    Raises CsvImportError (with a 1-indexed CSV row number where relevant) on
    any structural problem, so the admin gets a message pointing at the exact
    row to fix.
    """
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise CsvImportError("File isn't valid UTF-8 text — export the CSV with UTF-8 encoding")

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise CsvImportError("CSV has no header row")

    missing = _REQUIRED_COLUMNS - set(reader.fieldnames)
    if missing:
        raise CsvImportError(f"CSV is missing required column(s): {', '.join(sorted(missing))}")

    fields: List[Dict[str, Any]] = []
    seen_ids: Set[str] = set()

    for row_num, row in enumerate(reader, start=2):  # header is row 1
        if not any((v or "").strip() for v in row.values()):
            continue  # tolerate a trailing blank line

        field_id = (row.get("field_id") or "").strip()
        label = (row.get("label") or "").strip()
        field_type = (row.get("type") or "").strip()

        if not field_id:
            raise CsvImportError("'field_id' is required", row_num)
        if field_id in seen_ids:
            raise CsvImportError(f"duplicate field_id '{field_id}'", row_num)
        seen_ids.add(field_id)

        if not label:
            raise CsvImportError("'label' is required", row_num)

        if field_type not in _VALID_TYPES:
            raise CsvImportError(
                f"'type' must be one of {sorted(_VALID_TYPES)}, got '{field_type}'", row_num
            )

        options = _parse_options(row.get("options", ""), row_num)
        if field_type in _OPTION_TYPES and not options:
            raise CsvImportError(f"'{field_type}' fields need at least one entry in 'options'", row_num)

        required_raw = (row.get("required") or "").strip()
        no_future_raw = (row.get("no_future") or "").strip()
        not_before_dob_raw = (row.get("not_before_dob") or "").strip()

        fields.append({
            "id": field_id,
            "label": label,
            "type": field_type,
            "placeholder": (row.get("placeholder") or "").strip(),
            "required": _parse_bool(required_raw, "required", row_num) if required_raw else True,
            "options": options,
            "helpText": (row.get("help_text") or "").strip() or None,
            "min": _parse_float(row.get("min", ""), "min", row_num),
            "max": _parse_float(row.get("max", ""), "max", row_num),
            "decimals": _parse_int(row.get("decimals", ""), "decimals", row_num),
            "noFuture": _parse_bool(no_future_raw, "no_future", row_num) if no_future_raw else None,
            "notBeforeDob": _parse_bool(not_before_dob_raw, "not_before_dob", row_num) if not_before_dob_raw else None,
            "showIf": _parse_show_if(row.get("show_if", ""), row_num),
        })

    if not fields:
        raise CsvImportError("CSV has no data rows")

    return {"fields": fields}


# ── Flow forms (canvas decision trees) ───────────────────────────────────────

_FLOW_REQUIRED_COLUMNS = {"node_id", "question_type", "title"}
_QUESTION_TYPES = {"single", "multi", "text", "date"}
_OPTION_QUESTION_TYPES = {"single", "multi"}  # question types that take options at all
_VERDICTS = {"green", "red"}
_ACTION_TYPES = {"none", "notify", "youtube", "video", "info"}

# Grid layout for auto-positioned nodes — mirrors app.seed_forms._chain_and_position
# (kept as a plain literal here rather than imported, since that helper always
# overwrites `next` and this parser must preserve explicit CSV branching instead).
_GRID_PER_ROW = 4
_GRID_X0, _GRID_Y0 = 80, 80
_GRID_DX, _GRID_DY = 340, 300


def _parse_action(row: Dict[str, str], row_num: int) -> Dict[str, Any]:
    action_type = (row.get("action_type") or "").strip() or "none"
    if action_type not in _ACTION_TYPES:
        raise CsvImportError(
            f"'action_type' must be one of {sorted(_ACTION_TYPES)}, got '{action_type}'", row_num
        )
    return {
        "type": action_type,
        "message": (row.get("action_message") or "").strip(),
        "url": (row.get("action_url") or "").strip(),
        "startSeconds": _parse_float(row.get("action_start_seconds", ""), "action_start_seconds", row_num),
        "endSeconds": _parse_float(row.get("action_end_seconds", ""), "action_end_seconds", row_num),
    }


def parse_flow_csv(raw_bytes: bytes) -> Dict[str, Any]:
    """Parse a flow-form CSV into a `{"startNodeId": ..., "nodes": {...}}` dict
    matching FlowSchemaModel.

    One row = one option. A question's node-level columns (question_type,
    title, help_text, required, node_next) only need to be filled on that
    node's first row in the file — later option rows for the same node_id
    only need node_id + the option_* columns; node-level columns are ignored
    on those rows. 'text'/'date' questions (no options) get a single row with
    the option columns blank.

    node_next: leave blank to auto-chain to the next distinct node_id that
    appears in the file, so a straight-line checklist needs zero branching
    columns; set it explicitly to skip ahead or loop back.
    option_next: leave blank to fall back to the node's node_next. Only valid
    on 'single'-type questions — per-option branching isn't meaningful for
    'multi' (more than one can be selected) or 'text'/'date' (no options) —
    setting it elsewhere is a row error, likewise setting option_id/label at
    all on a 'text'/'date' node.

    Raises CsvImportError (with a 1-indexed CSV row number where relevant) on
    any structural problem, including a next/option_next that doesn't match
    any node_id in the file.
    """
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise CsvImportError("File isn't valid UTF-8 text — export the CSV with UTF-8 encoding")

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise CsvImportError("CSV has no header row")

    missing = _FLOW_REQUIRED_COLUMNS - set(reader.fieldnames)
    if missing:
        raise CsvImportError(f"CSV is missing required column(s): {', '.join(sorted(missing))}")

    nodes: Dict[str, Dict[str, Any]] = {}
    node_order: List[str] = []
    node_first_row: Dict[str, int] = {}
    node_next_explicit: Dict[str, tuple] = {}  # node_id -> (target, row_num)
    option_next_checks: List[tuple] = []       # (row_num, node_id, option_id, target)
    seen_option_ids: Dict[str, Set[str]] = {}

    for row_num, row in enumerate(reader, start=2):  # header is row 1
        if not any((v or "").strip() for v in row.values()):
            continue  # tolerate a trailing blank line

        node_id = (row.get("node_id") or "").strip()
        if not node_id:
            raise CsvImportError("'node_id' is required", row_num)

        if node_id not in nodes:
            question_type = (row.get("question_type") or "").strip()
            title = (row.get("title") or "").strip()
            if question_type not in _QUESTION_TYPES:
                raise CsvImportError(
                    f"'question_type' must be one of {sorted(_QUESTION_TYPES)}, got '{question_type}'", row_num
                )
            if not title:
                raise CsvImportError("'title' is required", row_num)

            required_raw = (row.get("required") or "").strip()
            nodes[node_id] = {
                "id": node_id,
                "kind": "question",
                "questionType": question_type,
                "title": title,
                "helpText": (row.get("help_text") or "").strip(),
                "required": _parse_bool(required_raw, "required", row_num) if required_raw else True,
                "media": [],
                "position": {"x": 0, "y": 0},
                "options": [],
                "next": None,
            }
            node_order.append(node_id)
            node_first_row[node_id] = row_num
            seen_option_ids[node_id] = set()

            node_next = (row.get("node_next") or "").strip()
            if node_next:
                node_next_explicit[node_id] = (node_next, row_num)

        node = nodes[node_id]
        question_type = node["questionType"]

        option_id = (row.get("option_id") or "").strip()
        option_label = (row.get("option_label") or "").strip()
        if not option_id and not option_label:
            continue  # bare node-header row, or a text/date question's only row

        if question_type not in _OPTION_QUESTION_TYPES:
            raise CsvImportError(
                f"node '{node_id}' is question_type '{question_type}', which doesn't take options — "
                f"leave option_id/option_label blank", row_num
            )
        if not option_id:
            raise CsvImportError("'option_id' is required when 'option_label' is set", row_num)
        if not option_label:
            raise CsvImportError("'option_label' is required when 'option_id' is set", row_num)
        if option_id in seen_option_ids[node_id]:
            raise CsvImportError(f"duplicate option_id '{option_id}' on node '{node_id}'", row_num)
        seen_option_ids[node_id].add(option_id)

        verdict = (row.get("verdict") or "").strip() or None
        if verdict and verdict not in _VERDICTS:
            raise CsvImportError(f"'verdict' must be 'green' or 'red', got '{verdict}'", row_num)

        option_next = (row.get("option_next") or "").strip() or None
        if option_next and question_type != "single":
            raise CsvImportError(
                f"'option_next' only applies to single-select questions (node '{node_id}' is '{question_type}')",
                row_num,
            )

        node["options"].append({
            "id": option_id,
            "label": option_label,
            "media": [],
            "verdict": verdict,
            "action": _parse_action(row, row_num),
            "next": option_next,
        })
        if option_next:
            option_next_checks.append((row_num, node_id, option_id, option_next))

    if not node_order:
        raise CsvImportError("CSV has no data rows")

    # Resolve `next`: explicit node_next values validated against known node_ids;
    # blank ones auto-chain to the next distinct node_id in file order.
    for node_id, (target, row_num) in node_next_explicit.items():
        if target not in nodes:
            raise CsvImportError(
                f"node '{node_id}' has node_next '{target}', which is not a node_id in this CSV", row_num
            )
        nodes[node_id]["next"] = target
    for i, node_id in enumerate(node_order):
        if node_id in node_next_explicit:
            continue
        nodes[node_id]["next"] = node_order[i + 1] if i + 1 < len(node_order) else None

    for row_num, node_id, option_id, target in option_next_checks:
        if target not in nodes:
            raise CsvImportError(
                f"option '{option_id}' on node '{node_id}' has option_next '{target}', "
                f"which is not a node_id in this CSV", row_num
            )

    for node_id in node_order:
        node = nodes[node_id]
        if node["questionType"] in _OPTION_QUESTION_TYPES and not node["options"]:
            raise CsvImportError(
                f"'{node['questionType']}' questions need at least one option row", node_first_row[node_id]
            )

    for i, node_id in enumerate(node_order):
        nodes[node_id]["position"] = {
            "x": _GRID_X0 + (i % _GRID_PER_ROW) * _GRID_DX,
            "y": _GRID_Y0 + (i // _GRID_PER_ROW) * _GRID_DY,
        }

    return {"startNodeId": node_order[0], "nodes": nodes}
