"""
Default form definitions for the dynamic form system.

Seven forms exist (see FORM_SPECS). Five are simple 'flat' field lists; the
breastfeeding (BF) and complementary-feeding (CF) assessments are 'flow'
decision-trees designed on the admin canvas and rendered by the learner runner.

The BF/CF seed content mirrors the Cuedwell/cueTree assessment checklists
(33-step "Assess breast-feeding techniques", "Assess complementary feeding")
so admins start from a realistic tree instead of a blank canvas: every
checkpoint is a single-select question whose options carry a green ("as per
LAP") or red ("needs tutorial") verdict, and red options carry a coaching
action that is surfaced to the learner in their plan.

`ensure_form_definitions(db)` is idempotent per form_key — it only inserts
missing definitions and never overwrites admin edits.
"""

import re

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import FormDefinition

# ── Flow-schema builders ─────────────────────────────────────────────────────

_NO_ACTION = {"type": "none", "message": "", "url": "", "startSeconds": None, "endSeconds": None}


def _action(kind: str, message: str = "", url: str = "",
            start: int | None = None, end: int | None = None) -> dict:
    return {"type": kind, "message": message, "url": url,
            "startSeconds": start, "endSeconds": end}


def _opt(oid: str, label: str, verdict: str | None = None,
         action: dict | None = None, media: list | None = None,
         nxt: str | None = None) -> dict:
    return {
        "id": oid,
        "label": label,
        "media": media or [],
        "verdict": verdict,
        "action": action or dict(_NO_ACTION),
        "next": nxt,
    }


def _question(qid: str, title: str, options: list, qtype: str = "single",
              help_text: str = "", required: bool = True,
              nxt: str | None = None, pos: tuple[int, int] = (0, 0)) -> dict:
    return {
        "id": qid,
        "kind": "question",
        "questionType": qtype,
        "title": title,
        "helpText": help_text,
        "required": required,
        "position": {"x": pos[0], "y": pos[1]},
        "options": options,
        "next": nxt,
    }


def _section_child(qid: str, title: str, options: list, qtype: str = "single",
                   help_text: str = "", required: bool = True) -> dict:
    return {
        "id": qid,
        "kind": "question",
        "questionType": qtype,
        "title": title,
        "helpText": help_text,
        "required": required,
        "options": options,
    }


def _section(sid: str, title: str, children: list,
             nxt: str | None = None, pos: tuple[int, int] = (0, 0)) -> dict:
    return {
        "id": sid,
        "kind": "section",
        "title": title,
        "position": {"x": pos[0], "y": pos[1]},
        "children": children,
        "next": nxt,
    }


def _green_red(qid: str, coaching: str) -> list:
    """The standard BF checkpoint pair: done as per LAP vs needs the tutorial."""
    return [
        _opt(f"{qid}_g", "Done as shown in the tutorial", "green"),
        _opt(f"{qid}_r", "Needs practice — not as per LAP", "red",
             _action("notify", coaching)),
    ]


def _chain_and_position(nodes: list[dict], per_row: int = 4,
                        x0: int = 80, y0: int = 80,
                        dx: int = 340, dy: int = 300) -> dict:
    """Link nodes linearly via default `next` and lay them on a tidy grid."""
    for i, node in enumerate(nodes):
        node["position"] = {"x": x0 + (i % per_row) * dx, "y": y0 + (i // per_row) * dy}
        node["next"] = nodes[i + 1]["id"] if i + 1 < len(nodes) else None
    return {"startNodeId": nodes[0]["id"] if nodes else None,
            "nodes": {n["id"]: n for n in nodes}}


# ── Breastfeeding assessment (flow) ──────────────────────────────────────────

# (id suffix, checkpoint title, coaching message for the red option)
_BF_CHECKPOINTS = [
    ("hunger", "Hunger cues",
     "Revise early hunger cues: rooting, bringing hands to the mouth and soft sounds. Feed before the baby starts crying."),
    ("clothes", "Type of clothes worn (loose/tight/front open)",
     "Loose or front-open clothing makes positioning and skin-to-skin contact easier during feeds."),
    ("waking", "Waking up the baby",
     "Show the mother gentle ways to wake the baby: stroke the soles, undress a layer, or express a few drops on the lips."),
    ("body_support", "Support for the baby's body",
     "The baby's whole body should be supported and turned towards the mother, not just the head and shoulders."),
    ("alignment", "Position of the baby's ears, shoulder joint and hip joint",
     "Ear, shoulder and hip should stay in one straight line so the baby does not twist its neck to feed."),
    ("head_support", "Support for the baby's head",
     "Support the head with the forearm or palm so the neck is slightly extended, never pushed into the breast."),
    ("face_direction", "Direction of the baby's face",
     "The baby's face should directly face the breast with the nose opposite the nipple before latching."),
    ("lip_position", "Position of the baby's lips (vertical/ horizontal/ diagonal)",
     "Check the lip line: the baby's lips should meet the breast so more areola shows above the top lip than below."),
    ("nose_chin", "Position of the baby's nose and chin",
     "The chin should touch the breast and the nose stay free — revise the tilted-head position from the tutorial."),
    ("breast_hold", "Holding the breast with her fingers",
     "Teach the C-hold: thumb above and fingers below the breast, well behind the areola."),
    ("finger_direction", "Direction of the mother's fingers",
     "The fingers should run parallel to the baby's lips so the breast 'sandwich' matches the mouth opening."),
    ("finger_distance", "Distance of the fingers from the nipple",
     "Fingers must stay well away from the areola (about 3 fingers back) so they do not block the latch."),
    ("compressing", "Compressing the breast",
     "Gently compress the breast to shape it to the baby's mouth; deep pressing can block milk ducts."),
    ("stimulate_mouth", "Stimulate opening of the mouth",
     "Brush the nipple from nose to lips and wait for a wide open mouth before bringing the baby to the breast."),
    ("mouth_opening", "Opening of the mouth for latching",
     "Wait for a wide yawn-like mouth (not a half-open mouth) before latching — revise the latching tutorial."),
    ("latching", "How is mother latching the baby?",
     "Bring the baby quickly to the breast (not the breast to the baby), aiming the lower lip below the nipple."),
    ("upper_lower_lips", "Position of baby's upper and lower lips",
     "Both lips should be turned outward (flanged) like a fish — tucked-in lips cause a shallow, painful latch."),
    ("deep_attachment", "Checking baby's deep attachment to the breast",
     "In a deep latch most of the areola is inside the mouth and sucks are slow and deep with visible swallowing."),
    ("lips_chin_visibility", "Visibility of the lips and chin while breastfeeding",
     "The chin should press into the breast and the lower lip stay hidden — revise attachment checkpoints."),
    ("cheeks", "Appearance of the cheeks while breastfeeding",
     "Cheeks should look full and rounded while feeding; dimpling means the latch is shallow — relatch the baby."),
    ("release_latch", "How does the mother release the baby's latch in case of nipple pain or if the baby goes to sleep",
     "Never pull the baby off — slide a clean little finger into the corner of the mouth to break the suction first."),
    ("support_after_latch", "Supporting the breast after checking the latch",
     "Once deeply latched, the breast can be released slowly; keep supporting it only if it is large or heavy."),
    ("frequency", "Frequency of breastfeeding",
     "Feed on demand, at least 8–12 times in 24 hours in the early months."),
    ("night_feeding", "Breastfeeding at night",
     "Night feeds matter — they maintain milk supply and the baby gets hind milk. Encourage at least 1–2 night feeds."),
    ("both_sides", "Breastfeeding from both the sides",
     "Offer both breasts at each feed, starting from the side used last so both are drained regularly."),
    ("emptying", "Emptying of one breast completely before switching to another",
     "Let the baby finish the first breast completely (to reach fatty hind milk) before offering the second."),
    ("check_emptied", "Manually expressing milk to check if the breast is completely emptied or not",
     "After the feed, express a few drops to confirm the breast is soft and emptied — fullness invites engorgement."),
    ("manual_expression", "Manual expression",
     "Revise manual expression: press back towards the chest, then compress rhythmically behind the areola."),
    ("burping", "Burping",
     "Hold the baby upright against the shoulder and rub or pat the back gently until the baby burps."),
]


def build_breastfeeding_schema() -> dict:
    nodes: list[dict] = []

    nodes.append(_question(
        "bf_date", "Assessment date", [], qtype="date",
        help_text="Date on which this breastfeeding observation was done.",
    ))

    # Common section: preparation & hygiene checks (asked in every flow path).
    nodes.append(_section(
        "bf_prep", "Preparation & hygiene checks",
        [
            _section_child("bf_prep_wash", "Washing hands",
                           _green_red("bf_prep_wash",
                                      "Hands must be washed with soap and water before every feed.")),
            _section_child("bf_prep_water", "Drinking a glass of water",
                           _green_red("bf_prep_water",
                                      "Remind the mother to drink a glass of water before sitting down to feed.")),
            _section_child("bf_prep_posture", "Sitting posture",
                           _green_red("bf_prep_posture",
                                      "The mother should sit comfortably with her back supported and feet resting flat.")),
        ],
    ))

    for suffix, title, coaching in _BF_CHECKPOINTS:
        qid = f"bf_{suffix}"
        nodes.append(_question(qid, title, _green_red(qid, coaching)))

    return _chain_and_position(nodes)


# ── Complementary feeding assessment (flow) ──────────────────────────────────

_CF_FOOD_GROUPS = [
    ("pulses", "whole beans or pulses"),
    ("milk", "milk products"),
    ("grains", "grains"),
    ("millets", "millets"),
    ("leafy_veg", "green leafy vegetables"),
    ("orange_veg", "red and orange vegetables"),
    ("other_veg", "other vegetables"),
    ("fruits", "fruits"),
    ("roots", "roots and tubers"),
    ("nuts", "nuts and seeds"),
]


def _frequency_options(qid: str, food: str) -> list:
    return [
        _opt(f"{qid}_0", "0 days", "red",
             _action("notify", f"The baby received no {food} this week. Try to include {food} at least 3–4 days a week.")),
        _opt(f"{qid}_12", "1–2 days", None),
        _opt(f"{qid}_34", "3–4 days", "green"),
        _opt(f"{qid}_57", "5–7 days", "green"),
    ]


def build_complementary_feeding_schema() -> dict:
    nodes: list[dict] = []

    nodes.append(_question(
        "cf_date", "Assessment date", [], qtype="date",
        help_text="Date of this complementary feeding assessment.",
    ))

    nodes.append(_question("cf_diet_type", "Baby's diet type", [
        _opt("cf_diet_veg", "Vegetarian"),
        _opt("cf_diet_egg", "Eggetarian (vegetarian who eats eggs)"),
        _opt("cf_diet_nonveg", "Non vegetarian"),
    ]))

    for suffix, food in _CF_FOOD_GROUPS:
        qid = f"cf_freq_{suffix}"
        nodes.append(_question(
            qid, f"Number of days per week {food} were given to the baby",
            _frequency_options(qid, food),
        ))

    nodes.append(_question("cf_consistency", "Consistency of food given to the baby", [
        _opt("cf_consistency_watery", "Watery / thin", "red",
             _action("notify", "Thin, watery food fills the stomach without enough energy. "
                               "Food should be thick enough to stay on a spoon.")),
        _opt("cf_consistency_thick", "Thick / mashed", "green"),
        _opt("cf_consistency_family", "Soft family food texture", "green"),
    ]))

    nodes.append(_question("cf_meals", "Number of meals per day", [
        _opt("cf_meals_1", "1 meal or fewer", "red",
             _action("notify", "A baby on complementary feeding needs at least 2–3 meals a day "
                               "plus 1–2 nutritious snacks depending on age.")),
        _opt("cf_meals_2", "2 meals", None),
        _opt("cf_meals_3", "3 meals", "green"),
        _opt("cf_meals_4", "4 or more meals / meals with snacks", "green"),
    ]))

    nodes.append(_question("cf_quantity", "Quantity of food given to the baby per meal", [
        _opt("cf_qty_lt4tbsp", "Less than 4 tablespoons (1 tbsp = 15 g)", "red",
             _action("notify", "Increase the quantity gradually each week. Aim for at least half a cup "
                               "(125 ml) per meal by 9–12 months.")),
        _opt("cf_qty_quarter", "4–8 tablespoons (about a quarter cup)", None),
        _opt("cf_qty_half", "Half cup (125 ml)", "green"),
        _opt("cf_qty_more", "More than half cup", "green"),
    ]))

    # Common section: everyday feeding habits (asked regardless of branch).
    nodes.append(_section("cf_habits", "Everyday feeding habits", [
        _section_child("cf_habits_bf", "Is the baby breastfed or given expressed breast milk every day?", [
            _opt("cf_habits_bf_yes", "Yes", "green"),
            _opt("cf_habits_bf_no", "No", "red",
                 _action("notify", "Breastfeeding should continue alongside complementary foods up to 2 years.")),
        ]),
        _section_child("cf_habits_water", "Type of water given to the baby", [
            _opt("cf_water_boiled", "Boiled and cooled water", "green"),
            _opt("cf_water_filtered", "Filtered water", "green"),
            _opt("cf_water_direct", "Direct tap / well water", "red",
                 _action("notify", "Untreated water causes diarrhoea and poor growth. "
                                   "Always boil and cool the baby's drinking water.")),
        ]),
    ]))

    nodes.append(_question(
        "cf_ingredients", "Were the following ingredients added to the baby's food?",
        [
            _opt("cf_ing_sugar", "Sugar", "red",
                 _action("notify", "Avoid added sugar for babies — it reduces appetite for nutritious food "
                                   "and harms emerging teeth.")),
            _opt("cf_ing_jaggery", "Jaggery", "red",
                 _action("notify", "Jaggery is still added sugar; use fruit for natural sweetness instead.")),
            _opt("cf_ing_salt", "Extra salt", "red",
                 _action("notify", "A baby's kidneys cannot handle extra salt; cook the baby's portion "
                                   "before salting the family food.")),
            _opt("cf_ing_ghee", "Ghee", "green"),
            _opt("cf_ing_oil", "Cooking oil", "green"),
        ],
        qtype="multi",
        help_text="Select everything that was added this week.",
    ))

    nodes.append(_question("cf_cereal_pulse", "Was a combination of cereals and pulses given?", [
        _opt("cf_cp_yes", "Yes (e.g. khichdi, dal-rice)", "green"),
        _opt("cf_cp_no", "No", "red",
             _action("notify", "Cereal + pulse combinations (like khichdi) give complete protein — "
                               "aim for them daily.")),
    ]))

    nodes.append(_question("cf_fruit_puree", "Is fruit puree added to the baby's regular meals?", [
        _opt("cf_fp_yes", "Yes", "green"),
        _opt("cf_fp_no", "No", None,
             _action("info", "Mashed seasonal fruit between meals is an easy way to add vitamins.")),
    ]))

    nodes.append(_question(
        "cf_cooking", "What cooking techniques were used to increase nutrient absorption?",
        [
            _opt("cf_cook_soak", "Soaking", "green"),
            _opt("cf_cook_sprout", "Sprouting / germination", "green"),
            _opt("cf_cook_ferment", "Fermentation", "green"),
            _opt("cf_cook_roast", "Roasting", "green"),
            _opt("cf_cook_none", "None of these", "red",
                 _action("notify", "Soaking, sprouting, fermenting and roasting unlock iron and zinc "
                                   "from grains and pulses — use at least one of them.")),
        ],
        qtype="multi",
    ))

    nodes.append(_question(
        "cf_powders", "Which home-made nutritious powders were added to the baby's food?",
        [
            _opt("cf_pow_ragi", "Sprouted ragi powder", "green"),
            _opt("cf_pow_groundnut", "Roasted groundnut powder", "green"),
            _opt("cf_pow_til", "Til / sesame powder", "green"),
            _opt("cf_pow_none", "None", "red",
                 _action("notify", "Home-made powders (sprouted ragi, roasted groundnut, til) are a cheap "
                                   "way to add energy and protein to every meal.")),
        ],
        qtype="multi",
    ))

    return _chain_and_position(nodes)


# ── Flat form defaults ───────────────────────────────────────────────────────

def _flat(fields: list[dict]) -> dict:
    return {"fields": fields}


def _field(fid: str, label: str, ftype: str = "text", placeholder: str = "",
           required: bool = True, options: list | None = None) -> dict:
    return {"id": fid, "label": label, "type": ftype, "placeholder": placeholder,
            "required": required, "options": options}


def _opts(*labels: str) -> list[dict]:
    return [{"label": l, "value": l.lower().replace(" ", "_")} for l in labels]


def build_learner_registration_fields() -> dict:
    return _flat([
        _field("dob", "Date of Birth", "date"),
        _field("gender", "Gender", "radio", options=_opts("Female", "Male", "Other")),
        _field("phone", "Contact Number", "text", "+91 98765 43210"),
        _field("state", "State", "dropdown", "Select State", options=_opts("Uttar Pradesh", "Bihar", "Madhya Pradesh")),
        _field("district", "District", "dropdown", "Select District", options=_opts("Gorakhpur", "Lucknow", "Patna")),
        _field("department", "Department", "dropdown",
               options=_opts("Women & Child Development (WCD)", "Health & Family Welfare", "National Health Mission (NHM)")),
        _field("role", "Designation / Role", "dropdown",
               options=_opts("Anganwadi Worker (AWW)", "Anganwadi Supervisor", "ANM / Health Worker", "CDPO")),
        _field("qualification", "Highest Educational Qualification", "dropdown",
               options=_opts("High School (10th)", "Higher Secondary (12th)", "Graduate", "Post Graduate")),
        _field("experience", "Experience in Current Designation", "dropdown",
               options=_opts("Under 1 year", "1 - 3 years", "3 - 5 years", "5 - 10 years", "10+ years")),
    ])


def build_mother_registration_fields() -> dict:
    return _flat([
        _field("mother_name", "Mother's Name"),
        _field("mother_dob", "Date of Birth", "date", required=False),
        _field("mobile", "Mobile Number", "text", "10-digit mobile"),
        _field("lmp", "Last Menstrual Period (LMP)", "date", required=False),
        _field("weight", "Weight (kg)", "number", "e.g. 52", required=False),
        _field("height", "Height (cm)", "number", "e.g. 158", required=False),
        _field("education", "Education Level", "dropdown", "Select level",
               options=_opts("No formal education", "Primary", "Secondary", "Graduate and above"), required=False),
        _field("village", "Village", "text", required=False),
    ])


def build_child_registration_fields() -> dict:
    return _flat([
        _field("child_name", "Child's Name"),
        _field("dob", "Date of Birth", "date"),
        _field("gender", "Gender", "radio", options=_opts("Female", "Male")),
        _field("birth_weight", "Birth Weight (kg)", "number", "e.g. 2.8"),
        _field("birth_length", "Birth Length (cm)", "number", "e.g. 48", required=False),
        _field("delivery_place", "Place of Delivery", "dropdown", "Select place",
               options=_opts("Home", "PHC", "CHC", "District Hospital", "Private Hospital", "Other")),
    ])


def _slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")


def _cg_opts(*labels: str) -> list[dict]:
    return [{"label": l.strip(), "value": _slug(l)} for l in labels]


def _if_field(field_id: str, *values: str) -> dict:
    return {"kind": "field", "fieldId": field_id, "anyOf": list(values)}


def _if_age_lt(days: int) -> dict:
    return {"kind": "ageLtDays", "days": days}


def _if_age_gte(days: int) -> dict:
    return {"kind": "ageGteDays", "days": days}


def build_growth_monitoring_fields() -> dict:
    """The Check Growth (CG) form — 24 questions transcribed from the
    'EP HST tools' instrument: measurement + 24h feeding recall + illness
    follow-up, with the instrument's conditional display and validation rules.
    """
    yes_no = _cg_opts("Yes", "No")
    yes_no_na = _cg_opts("Yes", "No", "Not applicable")

    return _flat([
        _field("measurement_date", "Measurement date", "date") | {
            "noFuture": True,
            "helpText": "Defaults to today. Cannot be a future date.",
        },
        _field("measurement_completed",
               "Were you able to measure the child's weight and length?",
               "radio", options=yes_no),
        _field("measurement_not_done_reason",
               "What were the reasons for not recording the measurements?",
               "checkbox",
               options=_cg_opts(
                   "House was locked", "Mother and child not present", "Mother not present",
                   "Family has moved/migrated", "Bad weather", "Damaged measuring instrument",
                   "Measuring instrument unavailable", "Other restriction on visit",
                   "I was sick and could not visit", "Other (Specify)",
               )) | {"showIf": [_if_field("measurement_completed", "no")],
                     "helpText": "Select all that apply."},
        _field("measurement_reason_other", "Please specify the other reason.", "text") | {
            "showIf": [_if_field("measurement_not_done_reason", "other_specify")],
        },
        _field("measurement_location", "Where was the measurement taken?", "dropdown",
               "Select location",
               options=_cg_opts(
                   "Postnatal ward (Normal delivery)", "Postnatal ward (Caesarean section)",
                   "At discharge", "Mother's home", "Anganwadi Centre",
                   "Health & Wellness Centre", "Primary Health Centre (PHC)",
                   "Community Health Centre (CHC)/Taluk Hospital", "District Hospital",
                   "Health camp", "Other (Specify)",
               )) | {"showIf": [_if_field("measurement_completed", "yes")]},
        _field("measurement_location_other", "Specify other location", "text") | {
            "showIf": [_if_field("measurement_location", "other_specify")],
        },
        _field("baby_length", "Baby's length (cm)", "number", "e.g. 68.5") | {
            "showIf": [_if_field("measurement_completed", "yes")],
            "min": 30.0, "max": 120.0, "decimals": 1,
            "helpText": "30.0–120.0 cm, one decimal place.",
        },
        _field("baby_weight", "Baby's weight (kg)", "number", "e.g. 7.250") | {
            "showIf": [_if_field("measurement_completed", "yes")],
            "min": 1.0, "max": 30.0, "decimals": 3,
            "helpText": "1.000–30.000 kg, up to three decimal places.",
        },
        _field("growth_photo",
               "Upload photograph of the length measurement", "image", required=False) | {
            "showIf": [_if_field("measurement_completed", "yes")],
            "helpText": "Whole body visible with correct positioning (optional, quality assurance).",
        },
        _field("weight_photo",
               "Upload photograph of the weighing scale display showing the child's weight",
               "image", required=False) | {
            "showIf": [_if_field("measurement_completed", "yes")],
            "helpText": "Optional, quality assurance.",
        },
        _field("breastfed_24h", "Was the child breastfed during the past 24 hours?",
               "radio", options=yes_no),
        _field("exclusive_breastfeeding",
               "Is the child currently receiving only breastmilk (excluding prescribed "
               "medicines, vitamin/mineral supplements and ORS)?",
               "radio", options=yes_no_na) | {
            "showIf": [_if_age_lt(183)],
            "helpText": "WHO definition of exclusive breastfeeding. Asked for children under 6 months.",
        },
        _field("received_other_foods",
               "During the past 24 hours, was the child given anything other than breastmilk?",
               "radio", options=yes_no),
        _field("foods_given",
               "What was the child given during the past 24 hours? (Select all that apply)",
               "checkbox",
               options=_cg_opts(
                   "Infant formula", "Cow's milk", "Buffalo milk", "Goat's milk", "Plain water",
                   "Oral Rehydration Solution (ORS)", "Fruit juice", "Semi-solid foods",
                   "Solid foods", "Other liquids", "Other foods (Specify)",
               )) | {"showIf": [_if_field("received_other_foods", "yes")]},
        _field("other_food", "Please specify the other food or liquid given.", "text") | {
            "showIf": [_if_field("foods_given", "other_foods_specify", "other_liquids")],
        },
        _field("complementary_feeding_started",
               "Has your child started receiving any semi-solid or solid foods in addition "
               "to breastmilk?",
               "radio", options=yes_no_na) | {
            "showIf": [_if_age_gte(122)],
            "helpText": "Asked for children of 4 completed months and older.",
        },
        _field("complementary_feeding_start_date",
               "Approximately on what date was complementary feeding first started?",
               "date") | {
            "showIf": [_if_field("complementary_feeding_started", "yes")],
            "noFuture": True, "notBeforeDob": True,
            "helpText": "An approximate date is fine if the exact date is unknown.",
        },
        _field("illness_since_last_visit",
               "Since the last follow-up visit, has the child had any illness?",
               "radio", options=yes_no),
        _field("illness_type",
               "Which of the following illnesses did the child have? (Select all that apply)",
               "checkbox",
               options=_cg_opts(
                   "Fever", "Cold/Upper Respiratory Infection (URI)", "Cough",
                   "Fast breathing/Difficulty breathing", "Diarrhoea", "Vomiting",
                   "Ear infection/Ear discharge", "Skin infection",
                   "Hospitalization due to illness", "Other (Specify)",
               )) | {"showIf": [_if_field("illness_since_last_visit", "yes")]},
        _field("illness_other", "Please specify the other illness.", "text") | {
            "showIf": [_if_field("illness_type", "other_specify")],
        },
        _field("illness_duration",
               "Approximately how many days was the child ill since the last follow-up visit?",
               "dropdown", "Select duration",
               options=_cg_opts("1-2 days", "3-5 days", "6-10 days", "More than 10 days")) | {
            "showIf": [_if_field("illness_since_last_visit", "yes")],
        },
        _field("feeding_during_illness",
               "During the illness, compared with usual, how was the child fed?",
               "dropdown", "Select one",
               options=_cg_opts("More than usual", "Same as usual", "Less than usual",
                                "Unable to feed")) | {
            "showIf": [_if_field("illness_since_last_visit", "yes")],
        },
        _field("health_services",
               "For this illness, which of the following health services were sought? "
               "(Select all that apply)",
               "checkbox",
               options=_cg_opts(
                   "No treatment sought", "ASHA advice", "Anganwadi Worker (AWW) advice",
                   "ANM advice", "Health & Wellness Centre (HWC) visit",
                   "Primary Health Centre (PHC) visit", "Community Health Centre (CHC) visit",
                   "Taluk Hospital visit", "District Hospital visit",
                   "Private Clinic/Hospital visit", "Pharmacy/Medical Shop advised treatment",
                   "Traditional healer advice", "Hospital admission", "Other (Specify)",
               )) | {"showIf": [_if_field("illness_since_last_visit", "yes")]},
        _field("health_services_other", "Please specify the other health service sought.",
               "text") | {
            "showIf": [_if_field("health_services", "other_specify")],
        },
    ])


def build_antenatal_fields() -> dict:
    return _flat([
        _field("visit_date", "Visit Date", "date"),
        _field("gestational_weeks", "Gestational Age (weeks)", "number", "e.g. 28"),
        _field("weight", "Mother's Weight (kg)", "number"),
        _field("bp", "Blood Pressure", "text", "e.g. 120/80"),
        _field("ifa_given", "IFA Tablets Given", "radio", options=_opts("Yes", "No")),
        _field("counselling", "Counselling Notes", "textarea", required=False),
    ])


# ── Registry & seeding ───────────────────────────────────────────────────────

# form_key → (title, description, builder_type, schema builder)
FORM_SPECS: dict[str, tuple[str, str, str, callable]] = {
    "learner_registration": (
        "Learner Registration Form",
        "Fields collected when a health worker completes their profile.",
        "flat", build_learner_registration_fields),
    "mother_registration": (
        "Mother Registration Form",
        "Fields collected when registering a mother.",
        "flat", build_mother_registration_fields),
    "child_registration": (
        "Child Registration Form",
        "Fields collected when registering a child under a mother.",
        "flat", build_child_registration_fields),
    "breastfeeding": (
        "Breastfeeding Assessment",
        "Observation checklist of breastfeeding technique. Each step is scored "
        "as per LAP (green) or needing the tutorial (red); red answers trigger "
        "coaching actions shown in the learner's plan.",
        "flow", build_breastfeeding_schema),
    "complementary_feeding": (
        "Complementary Feeding Assessment",
        "Dietary diversity and feeding-practice assessment. Unlocks once the "
        "child is 150 days old.",
        "flow", build_complementary_feeding_schema),
    "growth_monitoring": (
        "Check Growth Form",
        "Growth measurement entry (weight/length per visit).",
        "flat", build_growth_monitoring_fields),
    "antenatal": (
        "Antenatal Form",
        "Antenatal visit record for the mother.",
        "flat", build_antenatal_fields),
}


def ensure_form_definitions(db: Session) -> None:
    """Insert any missing form definitions (idempotent; never overwrites edits)."""
    existing = {row.form_key for row in db.query(FormDefinition.form_key).all()}
    created = False
    for form_key, (title, description, builder_type, build) in FORM_SPECS.items():
        if form_key in existing:
            continue
        db.add(FormDefinition(
            form_key=form_key,
            title=title,
            description=description,
            builder_type=builder_type,
            schema_json=build(),
            version=1,
        ))
        created = True
    if created:
        # Also called at request time (admin list/get), so two concurrent
        # requests can race the insert — the loser's unique-index violation
        # just means the rows already exist.
        try:
            db.commit()
            print("Seeded default form definitions.")
        except IntegrityError:
            db.rollback()
