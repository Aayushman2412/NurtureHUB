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
# ── Breastfeeding assessment (flow) ──────────────────────────────────────────
#
# Rebuilt from the new BFA instrument (30 observed items in 5 sections). Every
# item reuses the question/option ids of its counterpart in the previous form
# so historical responses stay linked, with ONE exception:
#   * bf_breast_in_mouth (sheet Sl 22, "Amount of breast inside the baby's
#     mouth") has no counterpart in the previous form — NEW id, and its red
#     coaching message is newly written (marked below).
# Previous ids retired (no item for them in the new instrument):
#   * bf_breast_hold, bf_finger_distance, bf_mouth_opening.
# Option labels and titles are verbatim from the instrument sheet (including
# its ligature glyphs, e.g. "ﬁnger"); red-option coaching messages are carried
# over unchanged from the previous form.

# (question id, item title from the sheet,
#  green option label, red option label,
#  coaching message for the red option — from the previous form)
_BFA_SECTIONS = [
    ("bf_sec_prep", "Mother's preparation", [
        ("bf_hunger", "Feeding the baby when the baby is hungry",
         "The mother knows the baby’s early hunger cues like squirming, opening of the mouth, "
         "putting ﬁnger in the mouth.",
         "The mother feeds the baby when the baby cries.",
         "Revise early hunger cues: rooting, bringing hands to the mouth and soft sounds. Feed before the baby starts crying."),
        ("bf_prep_wash", "Washing hands before breastfeeding",
         "The mother washes her hands with soap and water.",
         "The mother does not wash her hands with soap and water.",
         "Hands must be washed with soap and water before every feed."),
        ("bf_prep_water", "Drinking water before breastfeeding",
         "The mother drinks one glass of water before breastfeeding.",
         "The mother does not drink water before breastfeeding.",
         "Remind the mother to drink a glass of water before sitting down to feed."),
        ("bf_prep_posture", "Mother's sitting position during breastfeeding",
         "The mother is relaxed and sitting straight with back support on the bed or on the ﬂoor.",
         "The mother's shoulders are hunched. She is leaning over the baby with no back support.",
         "The mother should sit comfortably with her back supported and feet resting flat."),
        ("bf_clothes", "Mother's clothing during breastfeeding",
         "The mother is wearing loose clothes.",
         "The mother is wearing tight clothes.",
         "Loose or front-open clothing makes positioning and skin-to-skin contact easier during feeds."),
        ("bf_waking", "Waking the baby before breastfeeding",
         "The mother wakes up the baby by removing the blanket, cap, mittens, and socks. Then, "
         "she makes the baby sit for a few minutes before bringing the baby close to breastfeed.",
         "The mother does not remove the blanket, cap, mittens, or socks. She does not make the "
         "baby sit to wake her up. The baby is sleepy when brought close to breastfeed.",
         "Show the mother gentle ways to wake the baby: stroke the soles, undress a layer, or express a few drops on the lips."),
    ]),
    ("bf_sec_position", "Baby position", [
        ("bf_body_support", "Supporting the baby's whole body",
         "Baby's head, back, hips & legs are fully supported by the mother's left hand.",
         "Baby’s full body is not supported by the mother. Only the shoulders or the head of the "
         "baby are supported.",
         "The baby's whole body should be supported and turned towards the mother, not just the head and shoulders."),
        ("bf_alignment", "Keeping the baby's body in a straight line",
         "Baby's ears, shoulder joint and hip joint are in the same line.",
         "Baby's ears, shoulder joint and hip joint are not in the same line. Baby’s body or neck "
         "is twisted.",
         "Ear, shoulder and hip should stay in one straight line so the baby does not twist its neck to feed."),
        ("bf_head_support", "Supporting the baby's head correctly",
         "The lower part of the baby's head is held with the mother's left thumb and other "
         "ﬁngers. Mother’s thumb is behind one ear of the baby. Her ﬁngers are behind the other "
         "ear of the baby.",
         "The mother is not supporting the baby’s head properly. She is restricting the movement "
         "of the baby’s head while breastfeeding the baby by putting pressure on the back of the "
         "baby’s head.",
         "Support the head with the forearm or palm so the neck is slightly extended, never pushed into the breast."),
        ("bf_face_direction", "Keeping the baby close to the mother's body",
         "The baby is facing the mother's breast. The baby's chest and the mother's chest are "
         "touching each other. The baby is in a horizontal position.",
         "The baby is facing the mother's face. The baby's chest is not touching the mother's "
         "chest. The baby’s chest is held far away, or it is turned upward. The baby is in a "
         "diagonal position.",
         "The baby's face should directly face the breast with the nose opposite the nipple before latching."),
        ("bf_lip_position", "Keeping the baby in the correct feeding position",
         "When the baby is absolutely horizontal while feeding on the right breast, the baby's "
         "upper lip is at 9 o'clock position and the lower lip is at 3 o'clock position. Thus "
         "the baby's lips are absolutely vertical.",
         "When the baby is in a diagonal position while feeding on the right breast, the baby's "
         "lips are not in a vertical position on the areola.",
         "Check the lip line: the baby's lips should meet the breast so more areola shows above the top lip than below."),
        ("bf_nose_chin", "Bringing the baby to the breast correctly",
         "The mother brings the baby to the breast keeping the baby’s chin forward such that the "
         "Nare of the nose is in line with the nipple. Doing so, will ensure that the baby’s "
         "neck is extended in the same way that an adult’s neck is extended while drinking water.",
         "The baby is brought straight on to the nipple without extension of the neck. Here, "
         "either the baby's nose is higher than the mother's nipple or the tip of the nose is in "
         "line with the nipple. Also, the baby’s neck is bent forward.",
         "The chin should touch the breast and the nose stay free — revise the tilted-head position from the tutorial."),
    ]),
    ("bf_sec_hold", "Holding the breast for a deep latch", [
        ("bf_finger_direction", "Holding the breast correctly",
         "The mother holds the breast in such a way that her ﬁngers are parallel to the baby's "
         "lips.",
         "The mother holds the breast in such a way that her ﬁngers are not parallel to the "
         "baby's lips.",
         "The fingers should run parallel to the baby's lips so the breast 'sandwich' matches the mouth opening."),
        ("bf_compressing", "Pressing the breast correctly",
         "The mother is compressing the breast adequately. So it is easy for the baby to attach "
         "deeply to the lower areola.",
         "The mother is not compressing the breast adequately. So the baby is unable to attach "
         "deeply.",
         "Gently compress the breast to shape it to the baby's mouth; deep pressing can block milk ducts."),
        ("bf_latching", "Bringing the baby to the breast (not the breast to the baby)",
         "The mother is bringing the baby to the breast. She is not pushing the breast towards "
         "the baby.",
         "The mother is pushing the breast towards the baby. She is not bringing the baby to the "
         "breast.",
         "Bring the baby quickly to the breast (not the breast to the baby), aiming the lower lip below the nipple."),
    ]),
    ("bf_sec_latch", "Latching", [
        ("bf_stimulate_mouth", "Helping the baby open the mouth wide",
         "The mother brushes her nipple on the upper lip of the baby to stimulate opening of the "
         "baby’s mouth between 120 -160 degrees wide.",
         "The mother doesn't attempt to stimulate a wide opening of the baby’s mouth. She "
         "hurriedly pushes her nipple into the baby's mouth when the mouth opening is smaller "
         "than 120 degrees wide.",
         "Brush the nipple from nose to lips and wait for a wide open mouth before bringing the baby to the breast."),
        ("bf_upper_lower_lips", "Baby taking the breast deeply into the mouth",
         "The baby’s lower lip is at the border of the areola in case of a big areola. Lower lip "
         "is on the breast if the mother’s areola is small. Upper lip is at the border of the "
         "nipple.",
         "The baby’s lower lip is just below the nipple. The upper lip is either at the border "
         "of the nipple or at the border of the areola.",
         "Both lips should be turned outward (flanged) like a fish — tucked-in lips cause a shallow, painful latch."),
        ("bf_deep_attachment", "Checking whether the baby is attached properly",
         "The mother checks the latch by pressing on the breast near the baby's lower lip with "
         "her right index finger.",
         "The mother does not check the latch by pressing on the breast with her finger.",
         "In a deep latch most of the areola is inside the mouth and sucks are slow and deep with visible swallowing."),
        ("bf_lips_chin_visibility", "Baby's lips and chin touching the breast correctly",
         "The baby's lips and chin are embedded in the breast. They are not visible when the "
         "baby breastfeeds.",
         "The baby’s lips and chin are not embedded in the breast. They are visible when the "
         "baby breastfeeds.",
         "The chin should press into the breast and the lower lip stay hidden — revise attachment checkpoints."),
        ("bf_cheeks", "Baby's cheeks while sucking",
         "The baby’s cheeks look full and rounded. There are no dimples in the cheeks.",
         "The baby’s cheeks look hollow. There are dimples in the cheeks.",
         "Cheeks should look full and rounded while feeding; dimpling means the latch is shallow — relatch the baby."),
        # NEW question (no counterpart in the previous form) — coaching newly written.
        ("bf_breast_in_mouth", "Amount of breast inside the baby's mouth",
         "While checking the latch, only the upper areola is visible. The lower areola is not "
         "visible. If the mother has a small areola, both the upper & the lower parts of the "
         "areola are in the baby's mouth.",
         "While checking the latch, even for the mothers having a big areola, the upper areola "
         "is not visible as it is in the baby's mouth.",
         "In a deep latch the lower areola is inside the baby's mouth and only the upper areola stays visible — relatch the baby if the whole areola disappears into the mouth."),
        ("bf_release_latch", "Removing the baby from the breast safely",
         "While delatching the baby, the mother inserts her little ﬁnger in the corner of the "
         "baby’s mouth to delatch.",
         "While delatching the baby, mother just pulls the baby oﬀ her breast without putting "
         "her ﬁnger in the baby’s mouth.",
         "Never pull the baby off — slide a clean little finger into the corner of the mouth to break the suction first."),
    ]),
    ("bf_sec_counsel", "Important counselling points", [
        ("bf_support_after_latch", "Supporting the baby after the baby starts feeding",
         "After checking the latch, the mother releases her breast from her hand. She supports "
         "the baby's body with that hand. She ensures that the baby's head is still well "
         "supported with her other hand.",
         "After checking the latch, the mother keeps holding the breast with her hand. She does "
         "not support the baby’s body with that hand. She does not support the baby's head with "
         "her other hand.",
         "Once deeply latched, the breast can be released slowly; keep supporting it only if it is large or heavy."),
        ("bf_check_emptied", "Checking whether one breast is emptied",
         "The mother expresses breast milk with her hand to check if thin milk or thick milk "
         "comes out. She oﬀers the other breast when only a few drops of thick milk can be "
         "expressed.",
         "The mother attempts to feed from the other breast without checking if her breast is "
         "empty or not by expressing breast milk with her hand.",
         "After the feed, express a few drops to confirm the breast is soft and emptied — fullness invites engorgement."),
        ("bf_manual_expression", "Expressing breast milk by hand",
         "The mother knows the technique of manual expression of breast milk - press back, "
         "compress & release.",
         "The mother does not know press back, compress and release technique of hand expression "
         "of milk.",
         "Revise manual expression: press back towards the chest, then compress rhythmically behind the areola."),
        ("bf_emptying", "Feeding completely from one breast before changing sides",
         "The mother feeds the baby completely from one breast before feeding from the other "
         "breast.",
         "The mother feeds from both breasts for less than 5 minutes, without emptying the "
         "breasts completely.",
         "Let the baby finish the first breast completely (to reach fatty hind milk) before offering the second."),
        ("bf_burping", "Burping the baby after feeding",
         "The mother holds the baby in a sitting position for burping.",
         "The mother holds the baby on her shoulder for burping.",
         "Burp the baby in a SITTING position: support the chin, keep the back straight and rub or pat the back gently until the baby burps."),
        ("bf_both_sides", "Feeding from both breasts",
         "The mother oﬀers both the breasts to the baby to feed from.",
         "The mother feeds the baby only from one breast.",
         "Offer both breasts at each feed, starting from the side used last so both are drained regularly."),
        ("bf_frequency", "Number of breastfeeds during the day",
         "The mother feeds the baby 10-12 times in 24 hours.",
         "The frequency of breastfeeding is less than 10 times in 24 hours.",
         "Feed on demand, 10–12 times in 24 hours in the early months."),
        ("bf_night_feeding", "Number of breastfeeds during the night",
         "The mother breastfeeds the baby 3-4 times at night.",
         "Breastfeeding during the night is less than 3 times.",
         "Night feeds matter — they maintain milk supply and the baby gets hind milk. Encourage 3–4 night feeds."),
    ]),
]


def build_breastfeeding_schema() -> dict:
    nodes: list[dict] = []

    nodes.append(_question(
        "bf_date", "Assessment date", [], qtype="date",
        help_text="Date on which this breastfeeding observation was done.",
    ))

    for sec_id, sec_title, items in _BFA_SECTIONS:
        nodes.append(_section(sec_id, sec_title, [
            _section_child(qid, title, [
                _opt(f"{qid}_g", green, "green"),
                _opt(f"{qid}_r", red, "red", _action("notify", coaching)),
            ])
            for qid, title, green, red, coaching in items
        ]))

    # date → prep → position → hold → latch → counsel → end, one tidy column.
    return _chain_and_position(nodes, per_row=1, x0=120, y0=120, dy=220)


# MAPPING AUDIT: sheet Sl → question id (sheet has no Sl 14; ids reused from
# the previous form unless marked NEW)
#  1 → bf_hunger               (was "Hunger cues")
#  2 → bf_prep_wash            (was section child "Washing hands")
#  3 → bf_prep_water           (was section child "Drinking a glass of water")
#  4 → bf_prep_posture         (was section child "Sitting posture")
#  5 → bf_clothes              (was "Type of clothes worn (loose/tight/front open)")
#  6 → bf_waking               (was "Waking up the baby")
#  7 → bf_body_support         (was "Support for the baby's body")
#  8 → bf_alignment            (was "Position of the baby's ears, shoulder joint and hip joint")
#  9 → bf_head_support         (was "Support for the baby's head")
# 10 → bf_face_direction       (was "Direction of the baby's face"; the sheet item leads with
#                               the baby facing the breast vs facing the mother's face)
# 11 → bf_lip_position         (was "Position of the baby's lips (vertical/ horizontal/ diagonal)";
#                               sheet options are the vertical-vs-diagonal lip criterion)
# 12 → bf_nose_chin            (was "Position of the baby's nose and chin"; nose-to-nipple line
#                               and neck extension)
# 13 → bf_finger_direction     UNSURE-ish (heading says "Holding the breast correctly" which
#                               nominally matches bf_breast_hold, but both options are exactly the
#                               fingers-parallel-to-the-lips criterion of "Direction of the
#                               mother's fingers", whose coaching addresses it directly)
# 15 → bf_compressing          (was "Compressing the breast")
# 16 → bf_latching             (was "How is mother latching the baby?" — its coaching is literally
#                               "bring the baby to the breast, not the breast to the baby")
# 17 → bf_stimulate_mouth      (was "Stimulate opening of the mouth"; the sheet merges nipple-brush
#                               stimulation and the wide 120–160° opening into one item, so
#                               bf_mouth_opening is retired)
# 18 → bf_upper_lower_lips     (was "Position of baby's upper and lower lips"; options describe
#                               where the upper/lower lips land on the areola)
# 19 → bf_deep_attachment      UNSURE-ish (heading "Checking whether the baby is attached properly"
#                               ≈ old "Checking baby's deep attachment to the breast"; Sl 22 also
#                               had a claim on this id — see below)
# 20 → bf_lips_chin_visibility (was "Visibility of the lips and chin while breastfeeding")
# 21 → bf_cheeks               (was "Appearance of the cheeks while breastfeeding")
# 22 → bf_breast_in_mouth      NEW — no true counterpart. Closest was bf_deep_attachment (claimed
#                               by Sl 19, the explicit "checking" item). Its red coaching message
#                               is newly written, not carried over.
# 23 → bf_release_latch        (was "How does the mother release the baby's latch …" — little
#                               finger in the corner of the mouth)
# 24 → bf_support_after_latch  (was "Supporting the breast after checking the latch")
# 25 → bf_check_emptied        (was "Manually expressing milk to check if the breast is completely
#                               emptied or not")
# 26 → bf_manual_expression    (was "Manual expression" — press back, compress & release)
# 27 → bf_emptying             (was "Emptying of one breast completely before switching to another")
# 28 → bf_burping              (was "Burping") — CONTENT CONFLICT: the kept coaching recommends
#                               holding the baby upright AGAINST THE SHOULDER, but the new sheet
#                               marks the shoulder hold red and the sitting position green. Kept
#                               per the coaching-preservation rule; flag for content review.
# 29 → bf_both_sides           (was "Breastfeeding from both the sides")
# 30 → bf_frequency            (was "Frequency of breastfeeding") — minor mismatch: coaching says
#                               8–12 feeds/24 h, sheet green option says 10–12. Kept as-is.
# 31 → bf_night_feeding        (was "Breastfeeding at night") — minor mismatch: coaching encourages
#                               "at least 1–2 night feeds", sheet green option says 3–4. Kept as-is.
#
# Retired previous ids with no item in the new instrument:
#   bf_breast_hold ("Holding the breast with her fingers" — C-hold; Sl 13 went to
#   bf_finger_direction instead), bf_finger_distance ("Distance of the fingers from the
#   nipple" — nothing in the new sheet mentions it), bf_mouth_opening ("Opening of the
#   mouth for latching" — folded into Sl 17 / bf_stimulate_mouth).


# ── Complementary Feeding Assessment (CFA) — dietary-recall flow ─────────────
#
# REPLACES the retired cf_* observation checklist. Every id here is new and
# carries the `cfa_` prefix; no cf_ id is reused. Uses the module's helper
# dialect (_opt, _question, _chain_and_position) — standalone question nodes
# chained via `next`; no sections.
#
# Neutral data collection: every option has verdict None, action "none" and
# media [] (the _opt defaults) — no green/red scoring anywhere in this form.

# Diet gates. `visibleIf` is a plain dict key on a TOP-LEVEL question node:
# the node is shown only when the referenced question's answer includes one of
# `anyOf`. Hidden nodes stay in the default `next` chain — the runner walks
# straight through them — so no branch surgery is needed on the chain itself.
_CFA_GATE_EGG_OK = {"nodeId": "cfa_diet", "anyOf": ["cfa_diet_egg", "cfa_diet_nonveg"]}
_CFA_GATE_NONVEG_ONLY = {"nodeId": "cfa_diet", "anyOf": ["cfa_diet_nonveg"]}

# Shared frequency scale: option ids cfa_<slug>_freq_0 … cfa_<slug>_freq_7.
_CFA_FREQ_LABELS = [
    "0 days", "1 day", "2 days", "3 days",
    "4 days", "5 days", "6 days", "7 days",
]

# The 14 food groups, in exact sheet order (rows 7-37 of the CFA tab).
# Tuple: (slug,
#         Q1 frequency title (verbatim),
#         Q2 types question or None: (title verbatim, [(option slug, label), ...]),
#         Q3 last-24-hours title (verbatim) or None,
#         visibleIf gate or None)
# NOTE: the sheet's Grains skip-logic text says "skip Q2 and Q3" but the sheet
# has NO Grains Q3 row — Grains is built with Q1+Q2 only, following the rows
# that actually exist. Ten groups (Green Leafy Vegetables onward) have no Q2.
_CFA_FOOD_GROUPS = [
    ("pulses",
     "Number of days per week whole beans or pulses were given to the baby",
     ("Select types of whole beans or pulses given to the baby",
      [("beans", "Beans"), ("pulses", "Pulses")]),
     "Did you give the baby any whole beans or pulses in the last 24 hours?",
     None),
    ("milk",
     "Number of days per week milk products were given to the baby",
     ("Select types of milk products given to the baby",
      [("curd", "Curd"), ("paneer", "Paneer"), ("cheese", "Cheese"),
       ("khoa", "Khoa"), ("buttermilk", "Buttermilk"),
       ("cow_milk", "Cow or animal milk"), ("formula", "Formula milk")]),
     "Did you give the baby any milk products in the last 24 hours?",
     None),
    ("grains",
     "Number of days per week grains were given to the baby",
     ("Select types of grains given to the baby",
      [("rice", "Rice"), ("wheat", "Wheat")]),
     None,  # no Q3 row in the sheet for Grains (see NOTE above)
     None),
    ("millets",
     "Number of days per week millets were given to the baby",
     ("Select types of millets given to the baby",
      [("bajra", "Bajra"), ("jowar", "Jowar"), ("ragi", "Ragi"),
       ("kodo", "Kodo Millet"), ("little", "Little Millet"),
       ("barnyard", "Barnyard Millet"), ("foxtail", "Foxtail Millet")]),
     "Did you give the baby any millets in the last 24 hours?",
     None),
    ("leafy_veg",
     "Number of days per week green leafy vegetables were given to the baby",
     None,
     "Did you give the baby any green leafy vegetables in the last 24 hours?",
     None),
    ("orange_veg",
     "Number of days per week red and orange vegetables were given to the baby",
     None,
     "Did you give the baby any red and orange vegetables in the last 24 hours?",
     None),
    ("other_veg",
     "Number of days per week other vegetables were given to the baby",
     None,
     "Did you give the baby any other vegetables in the last 24 hours?",
     None),
    ("fruits",
     "Number of days per week fruits were given to the baby",
     None,
     "Did you give the baby any fruits in the last 24 hours?",
     None),
    ("roots",
     "Number of days per week roots and tubers were given to the baby",
     None,
     "Did you give the baby any roots and tubers in the last 24 hours?",
     None),
    ("nuts",
     "Number of days per week nuts and seeds were given to the baby",
     None,
     "Did you give the baby any nuts and seeds in the last 24 hours?",
     None),
    ("eggs",
     "Number of days per week eggs were given to the baby",
     None,
     "Did you give the baby any eggs in the last 24 hours?",
     _CFA_GATE_EGG_OK),
    ("chicken",
     "Number of days per week chicken or poultry was given to the baby",
     None,
     "Did you give the baby any chicken or poultry in the last 24 hours?",
     _CFA_GATE_NONVEG_ONLY),
    ("seafood",
     "Number of days per week seafood was given to the baby",
     None,
     "Did you give the baby any seafood in the last 24 hours?",
     _CFA_GATE_NONVEG_ONLY),
    ("meat",
     "Number of days per week meat or organ meat was given to the baby",
     None,
     "Did you give the baby any meat or organ meat in the last 24 hours?",
     _CFA_GATE_NONVEG_ONLY),
]

# First question after the food groups — the "0 days" option of the LAST
# group jumps here.
_CFA_FIRST_POST_GROUP_ID = "cfa_practice_consistency"

# Post-group questions (sheet rows 38-49), verbatim titles and options.
# Tuple: (qid, title, questionType, [(option slug, label), ...], helpText)
# NOTE: the sheet requires "None…" options to be mutually exclusive with the
# rest ("If None is selected, no other option should be selectable") — the
# platform cannot enforce single-choice-within-multi yet, so the rule is
# surfaced in helpText instead.
_CFA_POST_GROUP_QUESTIONS = [
    ("cfa_practice_consistency",
     "Consistency of food given to the baby", "single",
     [("thin_puree", "Thin puree"), ("thick_puree", "Thick puree"),
      ("thick_paste", "Thick paste"), ("mashed", "Hand mashed or lumpy food"),
      ("chunky", "Soft chunky food"), ("finger", "Soft finger food"),
      ("table", "Table food")],
     ""),
    ("cfa_practice_meals",
     "Number of meals given to the baby per day", "single",
     [("1", "1 meal"), ("2", "2 meals"), ("3", "3 meals"),
      ("4", "4 meals"), ("5", "5 meals"), ("gt5", "More than 5 meals")],
     ""),
    ("cfa_practice_quantity",
     "Quantity of food given to the baby per meal", "single",
     [("tbsp1", "1 tablespoon (15 g)"), ("tbsp2", "2 tablespoons (30 g)"),
      ("tbsp3", "3 tablespoons (45 g)"), ("tbsp4", "4 tablespoons (60 g)"),
      ("half_cup", "Half cup (125 mL)"),
      ("threefourth_cup", "Three-fourths cup (190 mL)"),
      ("cup1", "1 cup (250 mL)"), ("gt_cup", "More than 1 cup")],
     ""),
    ("cfa_ingredients",
     "Were any of the following ingredients added to the baby's food?", "multi",
     [("sugar", "Sugar"), ("jaggery", "Jaggery"), ("honey", "Honey"),
      ("salt", "Salt"), ("spices", "Spices"), ("none", "None added")],
     "(If 'None added' applies, select only that.)"),
    ("cfa_bf_timing",
     "When is the baby breastfed or given expressed breast milk in relation to complementary feeding?",
     "single",
     [("just_before", "Just before giving complementary feeding"),
      ("just_after", "Just after giving complementary feeding"),
      ("gap_20_30", "20–30 minutes before or after complementary feeding"),
      ("not_given", "Breastmilk is not given during complementary feeding stage"),
      ("stopped", "Breastfeeding has been stopped")],
     ""),
    ("cfa_water",
     "Type of water given to the baby", "single",
     [("boiled", "Boiled and cooled water"), ("tap", "Tap water"),
      ("bottled", "Bottled water"), ("filtered", "Filtered water"),
      ("purified", "Purified water"), ("none", "No water was given")],
     ""),
    ("cfa_diversity",
     "Was a combination of cereals and pulses given to the baby?", "single",
     [("yes", "Yes"), ("no", "No")],
     ""),
    ("cfa_limit",
     "Which of the following was given to the baby?", "multi",
     [("tea_coffee", "Tea/Coffee"), ("packaged", "Packaged food/drink"),
      ("outside", "Outside food"), ("biscuits", "Biscuits"),
      ("chocolate", "Chocolate"), ("fried", "Fried food"),
      ("baby_food", "Baby food products"), ("bakery", "Bakery products"),
      ("ice_cream", "Ice cream"), ("none", "None")],
     "(If 'None' applies, select only that.)"),
    ("cfa_fruit_puree",
     "Is fruit puree added to the baby's regular meals?", "single",
     [("yes", "Yes"), ("no", "No")],
     ""),
    ("cfa_cooking",
     "What cooking techniques were used to increase nutrient absorption for the food given to the baby?",
     "multi",
     [("soaking", "Soaking"), ("sprouting", "Sprouting"),
      ("fermenting", "Fermenting"), ("roasting", "Roasting"),
      ("steaming", "Steaming"), ("boiling", "Boiling"),
      ("none", "No technique used")],
     "(If 'No technique used' applies, select only that.)"),
    ("cfa_powders",
     "Which home-made nutritious powders were added to the food given to the baby?",
     "multi",
     [("peanut", "Peanut powder"), ("coconut", "Coconut powder"),
      ("nuts", "Nuts powder"), ("seeds", "Seeds powder"),
      ("sprouts", "Sprouts powder"), ("leaf", "Leaf powder"),
      ("amylase", "Amylase powder"),
      ("none", "No home-made nutritious powder added")],
     "(If 'No home-made nutritious powder added' applies, select only that.)"),
]


def build_complementary_feeding_schema() -> dict:
    """Dietary-recall CFA flow: date → diet type → 14 food groups → practices.

    Per food group: frequency (0-7 days) → [types] → [last-24-hours]. The
    "0 days" option jumps over the group's remaining questions to the next
    group's frequency question (last group → first post-group question).
    Egg/meat groups are gated on the diet-type answer via `visibleIf`.
    """
    nodes: list[dict] = []

    # NOTE: the sheet's "Age of the baby (Months and Days)" row (Q2 of
    # Assessment Details) is auto-calculated from the child's date of birth —
    # the platform cannot render computed fields in flows yet, so it is
    # intentionally omitted here.
    nodes.append(_question(
        "cfa_date", "Complementary Feeding Assessment Date", [], qtype="date",
        help_text="Date of this complementary feeding assessment (DD-MM-YYYY).",
    ))

    nodes.append(_question("cfa_diet", "Baby's diet type", [
        _opt("cfa_diet_veg", "Vegetarian"),
        _opt("cfa_diet_egg", "Eggetarian (Vegetarian who eats eggs)"),
        _opt("cfa_diet_nonveg", "Non-Vegetarian"),
    ]))

    for gi, (slug, freq_title, types, q3_title, gate) in enumerate(_CFA_FOOD_GROUPS):
        freq_id = f"cfa_{slug}_freq"

        # Skip-if-0: "0 days" bypasses this group's types/24h questions.
        if gi + 1 < len(_CFA_FOOD_GROUPS):
            zero_target = f"cfa_{_CFA_FOOD_GROUPS[gi + 1][0]}_freq"
        else:
            zero_target = _CFA_FIRST_POST_GROUP_ID
        freq_question = _question(freq_id, freq_title, [
            _opt(f"{freq_id}_{i}", label, nxt=zero_target if i == 0 else None)
            for i, label in enumerate(_CFA_FREQ_LABELS)
        ])
        if gate is not None:
            freq_question["visibleIf"] = dict(gate)
        nodes.append(freq_question)

        if types is not None:
            types_title, type_options = types
            types_id = f"cfa_{slug}_types"
            types_question = _question(types_id, types_title, [
                _opt(f"{types_id}_{oslug}", label) for oslug, label in type_options
            ], qtype="multi")
            if gate is not None:
                types_question["visibleIf"] = dict(gate)
            nodes.append(types_question)

        if q3_title is not None:
            day_id = f"cfa_{slug}_24h"
            day_question = _question(day_id, q3_title, [
                _opt(f"{day_id}_yes", "Yes"),
                _opt(f"{day_id}_no", "No"),
            ])
            if gate is not None:
                day_question["visibleIf"] = dict(gate)
            nodes.append(day_question)

    for qid, title, qtype, options, help_text in _CFA_POST_GROUP_QUESTIONS:
        nodes.append(_question(
            qid, title,
            [_opt(f"{qid}_{oslug}", label) for oslug, label in options],
            qtype=qtype, help_text=help_text,
        ))

    # Same top-level shape as the outgoing CF builder: _chain_and_position's
    # {"startNodeId", "nodes"} — like that builder, no top-level `display` /
    # `verdicts` keys are set, so the platform defaults apply unchanged.
    return _chain_and_position(nodes, x0=120, y0=120, dx=340, dy=230)


# AUDIT: 44 questions — cfa_date, cfa_diet, then per food group (sheet order):
#   pulses     → cfa_pulses_freq, cfa_pulses_types, cfa_pulses_24h
#   milk       → cfa_milk_freq, cfa_milk_types, cfa_milk_24h
#   grains     → cfa_grains_freq, cfa_grains_types            (no Q3 in sheet)
#   millets    → cfa_millets_freq, cfa_millets_types, cfa_millets_24h
#   leafy_veg  → cfa_leafy_veg_freq, cfa_leafy_veg_24h
#   orange_veg → cfa_orange_veg_freq, cfa_orange_veg_24h
#   other_veg  → cfa_other_veg_freq, cfa_other_veg_24h
#   fruits     → cfa_fruits_freq, cfa_fruits_24h
#   roots      → cfa_roots_freq, cfa_roots_24h
#   nuts       → cfa_nuts_freq, cfa_nuts_24h
#   eggs       → cfa_eggs_freq, cfa_eggs_24h                  [visibleIf: cfa_diet_egg OR cfa_diet_nonveg]
#   chicken    → cfa_chicken_freq, cfa_chicken_24h            [visibleIf: cfa_diet_nonveg]
#   seafood    → cfa_seafood_freq, cfa_seafood_24h            [visibleIf: cfa_diet_nonveg]
#   meat       → cfa_meat_freq, cfa_meat_24h                  [visibleIf: cfa_diet_nonveg]
# then post-group: cfa_practice_consistency, cfa_practice_meals,
#   cfa_practice_quantity, cfa_ingredients, cfa_bf_timing, cfa_water,
#   cfa_diversity, cfa_limit, cfa_fruit_puree, cfa_cooking, cfa_powders.
# Gated groups: eggs (egg+nonveg), chicken/seafood/meat (nonveg only) — every
# question of a gated group carries the gate; the default next-chain still
# runs straight through them (the runner skips invisible nodes).


def _info(iid: str, title: str, body: str, media: list | None = None,
          action: dict | None = None) -> dict:
    return {
        "id": iid, "kind": "info", "title": title, "body": body,
        "media": media or [], "action": action or dict(_NO_ACTION),
        "position": {"x": 0, "y": 0}, "next": None,
    }


def _mrow(rid: str, label: str) -> dict:
    return {"id": rid, "label": label}


def _mcol_dropdown(cid: str, label: str, values: list, required: bool = False) -> dict:
    return {
        "id": cid, "label": label, "type": "dropdown", "required": required,
        "options": [{"label": str(v), "value": str(v)} for v in values], "numeric": None,
    }


def _mcol_number(cid: str, label: str, decimals: int = 1,
                 flag_min: float | None = None, flag_max: float | None = None,
                 required: bool = False) -> dict:
    return {
        "id": cid, "label": label, "type": "number", "required": required, "options": None,
        "numeric": {"decimals": decimals, "flagMin": flag_min, "flagMax": flag_max},
    }


def _matrix(mid: str, title: str, rows: list, columns: list,
            help_text: str = "", required: bool = True) -> dict:
    return {
        "id": mid, "kind": "matrix", "title": title, "helpText": help_text,
        "required": required, "rows": rows, "columns": columns,
        "position": {"x": 0, "y": 0}, "next": None,
    }


# Portions eaten in the last 24 hours (0–10, half-serving granularity) and
# days/week ("0 days" … "7 days"), matching the Cuedwell instrument.
# Mother's Protein Intake (PCA) — replacement flow schema for NurtureHUB.
#
# Authored from the "PCA" tab of the assessment workbook (sheets.json):
# rows 2-4 assessment details; rows 7-23 the food matrix, re-cut here as ONE
# NurtureHUB matrix node per Food Group in sheet order; rows 25-26 the
# nutritional-supplements gate question; rows 28-37 the supplement matrix.
# The workbook's computed variables (rows 41-45: total / high-quality protein,
# 24-hour and habitual) are produced by the platform from the matrix answers
# and are deliberately NOT modelled as questions.
#
# Matrix-dialect keys beyond the classic _matrix() helper (which is why the
# matrix nodes below are emitted as plain dicts):
#   row["proteinPerServing"] — grams of protein per standard serving (sheet
#                              column 3); absent on supplement rows.
#   row["highQuality"]       — True for the animal-source groups (Milk
#                              Products, Eggs, Meat/Chicken/Seafood); feeds
#                              the high-quality-protein totals.
#   col["zeroesRow"]         — marks the frequency column: the runner
#                              auto-zeroes the row's other columns when it is
#                              0 (the sheet's "If Frequency = 0 days →
#                              auto-fill columns 5 & 6 as NA" rule).
#   node["visibleIf"]        — {"nodeId": ..., "anyOf": [option ids]} display
#                              gate. Gated nodes stay in the default `next`
#                              chain; the runner just skips them when hidden.
#
# Column ids are EXACTLY freq / usual / qty24 in every matrix — the
# computed-totals code keys on them. No verdicts, actions or media anywhere:
# this is a pure data-collection instrument.

_PCA_NONE_ACTION = {
    "type": "none", "message": "", "url": "", "startSeconds": None, "endSeconds": None,
}


def _pca_opt(oid: str, label: str) -> dict:
    """A plain option: no verdict, no action, no media."""
    return {
        "id": oid, "label": label, "media": [], "verdict": None,
        "action": dict(_PCA_NONE_ACTION), "next": None,
    }


def _pca_question(qid: str, title: str, options: list, qtype: str = "single",
                  help_text: str = "", required: bool = True) -> dict:
    return {
        "id": qid, "kind": "question", "questionType": qtype, "title": title,
        "helpText": help_text, "required": required,
        "position": {"x": 0, "y": 0}, "options": options, "next": None,
    }


def _pca_fmt(v: float) -> str:
    """Format a serving count the way the sheet lists them: '2', not '2.0'."""
    return str(int(v)) if float(v).is_integer() else str(v)


# Servings dropdown (0-10 in half steps, per the sheet's serving lists) and
# days-per-week dropdown ("0 days" … "7 days").
_PCA_PORTIONS = [round(x * 0.5, 1) for x in range(0, 21)]  # 0, 0.5, 1, … 10
_PCA_PORTION_OPTS = [{"label": _pca_fmt(v), "value": _pca_fmt(v)} for v in _PCA_PORTIONS]
_PCA_DAYS_OPTS = [
    {"label": f"{d} day" + ("" if d == 1 else "s"), "value": str(d)} for d in range(0, 8)
]


def _pca_intake_columns() -> list[dict]:
    """The shared freq / usual / qty24 column trio (fresh dicts per matrix).

    `zeroesRow` on freq tells the runner to auto-zero usual & qty24 when the
    food was eaten 0 days a week.
    """
    return [
        {
            "id": "freq", "label": "Frequency (days/week)", "type": "dropdown",
            "required": False, "options": [dict(o) for o in _PCA_DAYS_OPTS],
            "numeric": None, "zeroesRow": True,
        },
        {
            "id": "usual", "label": "Usual quantity on a day when consumed",
            "type": "dropdown", "required": False,
            "options": [dict(o) for o in _PCA_PORTION_OPTS], "numeric": None,
        },
        {
            "id": "qty24", "label": "Quantity consumed in the past 24 hours",
            "type": "dropdown", "required": False,
            "options": [dict(o) for o in _PCA_PORTION_OPTS], "numeric": None,
        },
    ]


# One entry per Food Group, in sheet order (PCA rows 7-23):
# (slug, matrix title [trailing * markers stripped], high-quality group?,
#  visibleIf gate or None, [(food-item label — sheet cell verbatim, protein g)])
_PCA_FOOD_GROUPS = [
    ("pulses", "Pulses", False, None, [
        ("1 cup cooked whole beans/sprouts/thick dal", 10),
        ("1 cup cooked whole soybeans", 22),
    ]),
    ("milk", "Milk Products", True, None, [
        ("1 cup curd", 8),
        ("3–4 pieces paneer", 8.8),
        ("1 glass milk", 8),
    ]),
    ("grains", "Grains", False, None, [
        ("1 chapati/roti", 6),
        ("1 cup cooked rice", 5),
    ]),
    ("millets", "Millets", False, None, [
        ("1 bhakri (jowar/bajra etc.)", 10.9),
    ]),
    ("leafy", "Green Leafy Vegetables", False, None, [
        ("½ cup dry cooked green leafy vegetables", 3.6),
        ("1 cup green leafy vegetable curry", 5.4),
    ]),
    ("veg", "Other Vegetables", False, None, [
        ("1 cup dry cooked vegetables", 3.4),
        ("1 cup vegetable curry", 1.7),
    ]),
    ("roots", "Roots & Tubers", False, None, [
        ("1 cup dry cooked roots and tubers", 2.6),
        ("1 cup roots and tubers curry", 1.3),
    ]),
    ("nuts", "Nuts & Seeds", False, None, [
        ("1 tablespoon (15 g)", 3),
    ]),
    # Sheet: "Display only if Diet Type = Eggetarian or Non-Vegetarian".
    ("eggs", "Eggs", True,
     {"nodeId": "pca_diet", "anyOf": ["pca_diet_egg", "pca_diet_nonveg"]}, [
        ("1 egg", 7),
    ]),
    # Sheet: "Display only if Diet Type = Non-Vegetarian".
    ("meat", "Meat/Chicken/Seafood", True,
     {"nodeId": "pca_diet", "anyOf": ["pca_diet_nonveg"]}, [
        ("4 medium cooked pieces (100 g)", 20),
    ]),
]


# Multi-select options for the supplements gate (sheet row 26, verbatim).
_PCA_SUPPLEMENT_OPTS = [
    ("pca_supp_protein", "Protein powder"),
    ("pca_supp_medical", "Medical nutrition supplement"),
    ("pca_supp_malted", "Malted health drink (Horlicks, Boost, Bournvita, etc.)"),
    ("pca_supp_ragi", "Ragi malt"),
    ("pca_supp_sprouted", "Sprouted cereal powder"),
    ("pca_supp_peanut", "Groundnut/Peanut powder"),
    ("pca_supp_sattu", "Sattu"),
    ("pca_supp_homemade", "Homemade nutritional powder/mix"),
    ("pca_supp_other", "Other (Specify)"),
    ("pca_supp_none", "None"),
]

# Supplement-matrix rows (sheet rows 29-37):
# (supplement name, standard household measure) — both cells verbatim.
_PCA_SUPPLEMENT_ROWS = [
    ("Protein powder", "Scoop"),
    ("Medical nutrition supplement", "Scoop/Sachet"),
    ("Malted health drink", "Tablespoon"),
    ("Ragi malt", "Tablespoon"),
    ("Sprouted cereal powder", "Tablespoon"),
    ("Peanut powder", "Tablespoon"),
    ("Sattu", "Tablespoon"),
    ("Homemade nutrition mix", "Tablespoon"),
    ("Other", "User defined"),
]


def build_mother_protein_intake_schema() -> dict:
    """The mother's protein-intake recall (PCA): assessment date, diet type and
    mother's status, then one food-group matrix per sheet Food Group (freq /
    usual / qty24 servings with per-row protein values), a nutritional-
    supplements gate and the gated supplement matrix. Filled for the MOTHER on
    every visit; the platform computes the total / high-quality protein
    variables from the matrix answers."""
    nodes: list[dict] = []

    nodes.append(_pca_question("pca_date", "Assessment Date", [], qtype="date"))

    nodes.append(_pca_question("pca_diet", "Diet Type", [
        _pca_opt("pca_diet_veg", "Vegetarian"),
        _pca_opt("pca_diet_egg", "Eggetarian (Vegetarian who eats eggs)"),
        _pca_opt("pca_diet_nonveg", "Non-Vegetarian"),
    ]))

    nodes.append(_pca_question("pca_status", "Mother's Status", [
        _pca_opt("pca_status_pregnant", "Pregnant Woman (ANC stage)"),
        _pca_opt("pca_status_lactating", "Lactating Mother (PNC stage)"),
    ]))

    for slug, title, high_quality, gate, foods in _PCA_FOOD_GROUPS:
        matrix = {
            "id": f"pca_m_{slug}", "kind": "matrix", "title": title,
            "helpText": "", "required": False,
            "rows": [
                {
                    "id": f"pca_m_{slug}_r{i}", "label": label,
                    "proteinPerServing": grams, "highQuality": high_quality,
                }
                for i, (label, grams) in enumerate(foods, start=1)
            ],
            "columns": _pca_intake_columns(),
            "position": {"x": 0, "y": 0}, "next": None,
        }
        if gate is not None:
            # Display-gated by diet type, but kept in the default next chain.
            matrix["visibleIf"] = {"nodeId": gate["nodeId"], "anyOf": list(gate["anyOf"])}
        nodes.append(matrix)

    nodes.append(_pca_question(
        "pca_supplements",
        "Is the mother currently consuming any nutritional supplement, "
        "nutritional powder, or fortified health drink apart from her regular diet?",
        [_pca_opt(oid, label) for oid, label in _PCA_SUPPLEMENT_OPTS],
        qtype="multi",
        help_text="Select all that apply. If None, select only that.",
    ))

    nodes.append({
        "id": "pca_m_supp", "kind": "matrix",
        "title": "Nutritional Supplement Consumption",
        "helpText": "", "required": False,
        # Shown whenever anything other than "None" was picked above.
        "visibleIf": {
            "nodeId": "pca_supplements",
            "anyOf": [oid for oid, _ in _PCA_SUPPLEMENT_OPTS if oid != "pca_supp_none"],
        },
        "rows": [
            # No proteinPerServing: supplement protein is brand-specific, so
            # these rows never feed the computed protein totals.
            {"id": f"pca_m_supp_r{i}", "label": f"{name} — {measure}", "highQuality": False}
            for i, (name, measure) in enumerate(_PCA_SUPPLEMENT_ROWS, start=1)
        ],
        "columns": [
            {
                "id": "brand", "label": "Brand / product name", "type": "text",
                "required": False, "options": None, "numeric": None,
            },
            *_pca_intake_columns(),
        ],
        "position": {"x": 0, "y": 0}, "next": None,
    })

    # Linear default chain + staggered grid layout.
    for i, node in enumerate(nodes):
        node["position"] = {"x": 120 + 340 * (i % 4), "y": 120 + 240 * (i // 4)}
        node["next"] = nodes[i + 1]["id"] if i + 1 < len(nodes) else None

    # Same top-level keys as the current builder (_chain_and_position): no
    # display/verdicts overrides — FlowSchemaModel defaults apply, and with no
    # option verdicts anywhere, verdict timing is moot.
    return {"startNodeId": "pca_date", "nodes": {n["id"]: n for n in nodes}}


# AUDIT:
#   pca_m_pulses    2 rows   proteinPerServing [10, 22]
#   pca_m_milk      3 rows   proteinPerServing [8, 8.8, 8]    highQuality
#   pca_m_grains    2 rows   proteinPerServing [6, 5]
#   pca_m_millets   1 row    proteinPerServing [10.9]
#   pca_m_leafy     2 rows   proteinPerServing [3.6, 5.4]
#   pca_m_veg       2 rows   proteinPerServing [3.4, 1.7]
#   pca_m_roots     2 rows   proteinPerServing [2.6, 1.3]
#   pca_m_nuts      1 row    proteinPerServing [3]
#   pca_m_eggs      1 row    proteinPerServing [7]            highQuality
#   pca_m_meat      1 row    proteinPerServing [20]           highQuality
#   pca_m_supp      9 rows   (no proteinPerServing)
#   visibleIf gates:
#     pca_m_eggs → {"nodeId": "pca_diet", "anyOf": ["pca_diet_egg", "pca_diet_nonveg"]}
#     pca_m_meat → {"nodeId": "pca_diet", "anyOf": ["pca_diet_nonveg"]}
#     (plus pca_m_supp → pca_supplements anyOf = all 9 supplement ids except pca_supp_none)
#   Columns in every matrix: freq (0–7 days, zeroesRow) / usual (0–10) /
#   qty24 (0–10); pca_m_supp adds a leading free-text "brand" column.


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
    """The Antenatal Assessment (ANC) — transcribed from the 'EP HST tools'
    instrument. Mother-level visit form; gestational age and weight gain are
    computed read-only by the runner (from the mother's LMP and the previous
    submitted visit)."""
    return _flat([
        _field("assessment_date", "Assessment Date", "date") | {
            "noFuture": True,
            "helpText": "Defaults to today. Cannot be a future date.",
        },
        _field("gestational_age", "Gestational Age", "text", required=False) | {
            "computed": "gestational_age",
            "helpText": "Auto-calculated from the mother's LMP as XX completed weeks + XX completed days.",
        },
        _field("current_weight", "Current Weight (kg)", "number", "e.g. 58.5") | {
            "min": 20, "max": 200, "decimals": 1,
        },
        _field("weight_gain", "Weight Gain Since Previous Visit (kg)", "text", required=False) | {
            "computed": "weight_gain",
            "helpText": "Auto-calculated against the previous submitted antenatal visit.",
        },
        _field("high_risk_conditions",
               "Does the mother currently have any of the following high-risk conditions?",
               "checkbox",
               options=_cg_opts(
                   "Multiple pregnancy (Twins/Triplets)", "Short stature (<145 cm)",
                   "Age less than 18 years", "Age more than 35 years",
                   "Previous caesarean section", "Previous stillbirth or newborn loss",
                   "Hypertension / Pre-eclampsia", "Gestational or pre-existing diabetes",
                   "Severe anaemia", "Vaginal bleeding", "Other (Specify)", "None",
               )) | {"helpText": "Select all that apply. If None applies, select only that."},
        _field("high_risk_other", "Please specify the other high-risk condition.", "text") | {
            "showIf": [_if_field("high_risk_conditions", "other_specify")],
        },
        _field("pregnancy_symptoms",
               "Is the mother currently experiencing any of the following pregnancy-related symptoms?",
               "checkbox",
               options=_cg_opts(
                   "Nausea", "Vomiting", "Loss of appetite", "Food aversions",
                   "Heartburn / Acidity", "Constipation", "Swelling of feet",
                   "Excessive tiredness", "Headache", "Blurred vision",
                   "Other (Specify)", "None",
               )) | {"helpText": "Select all that apply. If None applies, select only that."},
        _field("pregnancy_symptoms_other", "Please specify the other symptom.", "text") | {
            "showIf": [_if_field("pregnancy_symptoms", "other_specify")],
        },
        _field("ifa_purpose",
               "What is the current purpose of taking Iron and Folic Acid (IFA) tablets?",
               "dropdown", "Select purpose",
               options=_cg_opts(
                   "Routine prophylactic supplementation during pregnancy",
                   "Treatment of diagnosed anaemia",
                   "Not taking IFA currently",
               )),
        _field("ifa_compliance",
               "Approximately how many Iron and Folic Acid (IFA) tablets did the mother take in the last 7 days?",
               "dropdown", "Select count",
               options=_cg_opts(
                   "IFA tablets unavailable", "None (0 tablets)", "1–3 tablets",
                   "4–6 tablets", "7 tablets (once daily)", "8–13 tablets",
                   "14 tablets (twice daily)",
               )) | {"helpText": "Captures both once-daily and twice-daily regimens."},
        _field("calcium_compliance",
               "Approximately how many Calcium tablets did the mother take in the last 7 days?",
               "dropdown", "Select count",
               options=_cg_opts(
                   "Calcium tablets unavailable", "None (0 tablets)", "1–3 tablets",
                   "4–6 tablets", "7 tablets (once daily)", "8–13 tablets",
                   "14 tablets (twice daily)",
               )) | {"helpText": "Suitable for one or two tablets/day regimens."},
        _field("hb_value", "Latest Haemoglobin Value (g/dL)", "number", "e.g. 11.2", required=False) | {
            "min": 3.0, "max": 18.0, "decimals": 1,
        },
        _field("hb_date", "Date of Latest Haemoglobin Test", "date", required=False) | {
            "noFuture": True,
        },
        _field("medications",
               "Apart from Iron, Folic Acid and Calcium, is the mother currently taking any of the following medications?",
               "checkbox",
               options=_cg_opts(
                   "Blood pressure medicines", "Diabetes medicines", "Thyroid medicines",
                   "Antibiotics", "Ayurvedic / Herbal preparations",
                   "Other (Specify)", "None",
               )) | {"helpText": "Select all that apply. If None applies, select only that."},
        _field("medications_other", "Please specify the other medication.", "text") | {
            "showIf": [_if_field("medications", "other_specify")],
        },
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
        "Food-group dietary recall (days/week, types, last 24 hours) plus "
        "feeding practices — consistency, meals, ingredients, water and "
        "cooking techniques. Unlocks once the child is 150 days old.",
        "flow", build_complementary_feeding_schema),
    "growth_monitoring": (
        "Check Growth Form",
        "Growth measurement entry (weight/length per visit).",
        "flat", build_growth_monitoring_fields),
    "antenatal": (
        "Antenatal Assessment",
        "Per-visit antenatal record for the mother: weight and auto-computed "
        "gestational age / weight gain, high-risk screening, symptoms, IFA and "
        "calcium compliance, haemoglobin and current medications.",
        "flat", build_antenatal_fields),
    "mother_protein_intake": (
        "Mother's Protein Intake",
        "Daily protein-intake recall for the mother — food-group matrices with a "
        "portions/day-per-week grid. Filled for the mother on every visit.",
        "flow", build_mother_protein_intake_schema),
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
