"""Growth check and pregnancy check: weight to two decimals, options by age,
danger signs marked

Learner Redesign review (30 Oct 2026, Nandish's page, fixes 2, 11 and 12):
  * the baby's weight took three decimals — "2 decimals for weight (scales
    show 0.05 kg steps at most)";
  * an 8-month-old was offered "Postnatal ward", "At discharge" and "Not
    applicable" for solid foods — "hide options that can't apply at that age";
  * the pregnancy check mixed danger signs (bleeding, blurred vision,
    headache) with nausea and constipation — "they should be asked separately
    and should trigger a referral message".

The question wording is untouched: it is the research team's instrument (EP
HST tools), transcribed word for word. Only the weight's decimals, when each
option is offered (`showIf` on an option, like a field's) and a `danger`
flag on three options change. Option ids stay the same, so every answer
already saved still loads, scores and exports as before.

Forms are versioned (form_versions, immutable): for growth_monitoring and
antenatal, every version in use — the default and any a district is pinned
to — gets a new version carrying the change, and the default and the pins
move to it. A version already carrying it is left alone, so the migration
is idempotent. app/seed_forms.py builds the same content for a fresh
database. The downgrade moves the default and pins back and deletes the
versions this migration made.

Revision ID: b8e4d6f0a2c1
Revises: a7f3c2d91e40
Create Date: 2026-11-14
"""
import copy
from datetime import date
from typing import Any, Dict, List, Sequence, Tuple, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8e4d6f0a2c1"
down_revision: Union[str, Sequence[str], None] = "a7f3c2d91e40"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

AUTHOR = "migration b8e4d6f0a2c1"
DESCRIPTION = ("Weight to two decimals; newborn-only options shown to newborns only; "
               "danger signs marked (Learner Redesign review, 30 Oct 2026)")
FORMS = ("growth_monitoring", "antenatal")
NEWBORN_DAYS = 28
NEWBORN_ONLY_LOCATIONS = ("postnatal_ward_normal_delivery", "postnatal_ward_caesarean_section", "at_discharge")
CF_NA_BEFORE_DAYS = 183
ANC_DANGER_SIGNS = {"high_risk_conditions": ("vaginal_bleeding",),
                    "pregnancy_symptoms": ("headache", "blurred_vision")}

forms_t = sa.table("form_definitions", sa.column("id", sa.Integer), sa.column("form_key", sa.String),
                   sa.column("schema_json", sa.JSON), sa.column("version", sa.Integer),
                   sa.column("default_version_id", sa.Integer))
versions_t = sa.table("form_versions", sa.column("id", sa.Integer), sa.column("form_key", sa.String),
                      sa.column("version_number", sa.Integer), sa.column("created_on", sa.Date),
                      sa.column("description", sa.Text), sa.column("detected_changes", sa.JSON),
                      sa.column("diffed_from_version", sa.Integer), sa.column("schema_json", sa.JSON),
                      sa.column("created_by", sa.String))
pins_t = sa.table("form_district_assignments", sa.column("id", sa.Integer), sa.column("form_key", sa.String),
                  sa.column("version_id", sa.Integer))


def _options(field: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [o for o in field.get("options") or [] if isinstance(o, dict)]


def patch(form_key: str, schema: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """The schema with the change, and what changed (empty: nothing to do)."""
    out = copy.deepcopy(schema or {})
    fields = {f.get("id"): f for f in out.get("fields") or [] if isinstance(f, dict)}
    changes: List[str] = []
    if form_key == "growth_monitoring":
        weight = fields.get("baby_weight")
        if weight and weight.get("decimals") == 3:
            weight["decimals"] = 2
            if weight.get("helpText") == "1.000–30.000 kg, up to three decimal places.":
                weight["helpText"] = "1.00–30.00 kg, up to two decimal places."
            if weight.get("placeholder") == "e.g. 7.250":
                weight["placeholder"] = "e.g. 7.25"
            changes.append("Baby's weight (kg): two decimal places")
        for o in _options(fields.get("measurement_location") or {}):
            if o.get("value") in NEWBORN_ONLY_LOCATIONS and not o.get("showIf"):
                o["showIf"] = [{"kind": "ageLtDays", "days": NEWBORN_DAYS}]
                changes.append(f"Where was the measurement taken? — '{o.get('label')}' only for newborns")
        for o in _options(fields.get("complementary_feeding_started") or {}):
            if o.get("value") == "not_applicable" and not o.get("showIf"):
                o["showIf"] = [{"kind": "ageLtDays", "days": CF_NA_BEFORE_DAYS}]
                changes.append("Started semi-solid or solid foods? — 'Not applicable' only under 6 months")
    if form_key == "antenatal":
        for field_id, values in ANC_DANGER_SIGNS.items():
            for o in _options(fields.get(field_id) or {}):
                if o.get("value") in values and not o.get("danger"):
                    o["danger"] = True
                    changes.append(f"'{o.get('label')}' marked as a danger sign")
    return out, changes


def upgrade() -> None:
    conn = op.get_bind()
    for key in FORMS:
        definition = conn.execute(sa.select(forms_t).where(forms_t.c.form_key == key)).first()
        if definition is None:
            continue
        if definition.default_version_id is None:
            # A database from before form versions: the definition alone.
            new_schema, changes = patch(key, definition.schema_json)
            if changes:
                conn.execute(forms_t.update().where(forms_t.c.id == definition.id)
                             .values(schema_json=new_schema, version=(definition.version or 1) + 1))
            continue
        used = {definition.default_version_id} | {
            vid for (vid,) in conn.execute(sa.select(pins_t.c.version_id).where(pins_t.c.form_key == key))}
        next_no = (conn.execute(sa.select(sa.func.max(versions_t.c.version_number))
                                .where(versions_t.c.form_key == key)).scalar() or 0) + 1
        moved: Dict[int, Tuple[int, Dict[str, Any]]] = {}
        for vid in sorted(v for v in used if v is not None):
            old = conn.execute(sa.select(versions_t).where(versions_t.c.id == vid)).first()
            if old is None:
                continue
            new_schema, changes = patch(key, old.schema_json)
            if not changes:
                continue
            new_id = conn.execute(versions_t.insert().values(
                form_key=key, version_number=next_no, created_on=date.today(), description=DESCRIPTION,
                detected_changes=changes, diffed_from_version=old.version_number, schema_json=new_schema,
                created_by=AUTHOR,
            ).returning(versions_t.c.id)).scalar()
            next_no += 1
            moved[vid] = (new_id, new_schema)
            conn.execute(pins_t.update().where(pins_t.c.form_key == key, pins_t.c.version_id == vid)
                         .values(version_id=new_id))
        if definition.default_version_id in moved:
            new_id, new_schema = moved[definition.default_version_id]
            conn.execute(forms_t.update().where(forms_t.c.id == definition.id).values(
                default_version_id=new_id, schema_json=new_schema, version=(definition.version or 1) + 1))


def downgrade() -> None:
    conn = op.get_bind()
    for key in FORMS:
        made = conn.execute(sa.select(versions_t).where(versions_t.c.form_key == key,
                                                        versions_t.c.created_by == AUTHOR)).fetchall()
        definition = conn.execute(sa.select(forms_t).where(forms_t.c.form_key == key)).first()
        for v in made:
            old = conn.execute(sa.select(versions_t).where(
                versions_t.c.form_key == key, versions_t.c.version_number == v.diffed_from_version)).first()
            if old is None:
                continue
            conn.execute(pins_t.update().where(pins_t.c.form_key == key, pins_t.c.version_id == v.id)
                         .values(version_id=old.id))
            if definition is not None and definition.default_version_id == v.id:
                conn.execute(forms_t.update().where(forms_t.c.id == definition.id).values(
                    default_version_id=old.id, schema_json=old.schema_json,
                    version=max(1, (definition.version or 1) - 1)))
            conn.execute(versions_t.delete().where(versions_t.c.id == v.id))
