"""Videos to watch again, chosen from the learner's own cases (Learner
Redesign review, 30 Oct 2026, fix 16: "after she passes, put 'Refresh videos'
linked to her current cases at the top — e.g. the SAM video when a baby is
very thin").

Each topic is a reason in her cases — a very thin or very low-weight baby, a
baby whose weight fell or stopped rising, babies on breastfeeding, babies on
complementary feeding, pregnant mothers — and a set of words matched against
the titles of her project's training videos. Projects name their videos
differently (Chandrapur's "Poor Weight Gain Due To Improper Breastfeeding",
the demo project's "Severe Acute Malnutrition Management"), so the match is by
words, and a topic with no matching video is left out.

Counts only leave this module: which topics, how many of her babies or
mothers each concerns, and the videos. No names.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from app import models, projects

# (topic, words matched in a video title — lower case) in the order shown.
TOPICS: Sequence[Tuple[str, Sequence[str]]] = (
    ("sam", ("malnutrition", "wasting", " sam ")),
    ("weight", ("poor weight gain", "weight gain", "weight for age", "weight-for-age", "growth chart",
                "amount of breastmilk", "enough breast milk", "increase the amount")),
    ("breastfeeding", ("breastfeeding", "latch", "cradle", "side lying", "45 points", "hand expression")),
    ("complementary", ("complementary", "6 to 24", "month old", "powder recipes")),
    ("pregnancy", ("pregnan", "antenatal", "folate", "iron", "birth preparedness")),
)
PER_TOPIC = 2
CF_FROM_DAYS = 180


def _topic_counts(db: Session, user: models.User, as_of: date) -> Dict[str, int]:
    """How many of her babies (or pregnant mothers) each topic concerns."""
    from app.fieldplan import baby_status
    from app.routers.growth import _build_cases

    counts: Dict[str, int] = {t: 0 for t, _ in TOPICS}
    for case in _build_cases(db, user_id=user.id):
        st = baby_status(case)
        danger = (st.get("danger") or {}).get("kind")
        wfl = ((st.get("latest") or {}).get("wfl") or {}).get("grade")
        if danger in ("very_low_weight", "very_thin") or wfl in ("moderate", "severe"):
            counts["sam"] += 1
        if any(r in st.get("reasons", []) for r in ("weight_fell", "not_gaining", "low_wfa")):
            counts["weight"] += 1
        dob = case["child"].get("dob")
        age = (as_of - date.fromisoformat(dob[:10])).days if isinstance(dob, str) and dob else None
        if age is not None and age < CF_FROM_DAYS:
            counts["breastfeeding"] += 1
        elif age is not None:
            counts["complementary"] += 1
    pregnant = [mid for (mid,) in db.query(models.Mother.id).filter(
        models.Mother.registered_by_user_id == user.id,
        models.Mother.dropped_out_on.is_(None),
        models.Mother.declared_adoption_type == "anc")]
    if pregnant:
        with_baby = {mid for (mid,) in db.query(models.Child.mother_id).filter(models.Child.mother_id.in_(pregnant))}
        counts["pregnancy"] = sum(1 for mid in pregnant if mid not in with_baby)
    return counts


def _videos(db: Session, user: models.User) -> List[models.Tutorial]:
    project_id = projects.content_project_id_for(db, user.program_district_id)
    if project_id is None:
        return []
    return (db.query(models.Tutorial)
            .join(models.Stage, models.Stage.id == models.Tutorial.stage_id)
            .filter(models.Stage.program_district_id == project_id)
            .order_by(models.Stage.order_index, models.Tutorial.order_index, models.Tutorial.id).all())


def refresh_videos(db: Session, user: models.User, as_of: Optional[date] = None) -> List[Dict[str, Any]]:
    """[{topic, count, videos: [{id, title, minutes, watched}]}] — topics her
    cases raise and that her project has a video for, most urgent first."""
    as_of = as_of or date.today()
    videos = _videos(db, user)
    if not videos:
        return []
    counts = _topic_counts(db, user, as_of)
    watched = {tid for (tid,) in db.query(models.UserTutorialProgress.tutorial_id).filter(
        models.UserTutorialProgress.user_id == user.id,
        models.UserTutorialProgress.is_completed.is_(True))}
    used: set = set()
    out: List[Dict[str, Any]] = []
    for topic, words in TOPICS:
        if not counts.get(topic):
            continue
        picked = []
        for v in videos:
            title = f" {(v.title or '').lower()} "
            if v.id in used or not any(w in title for w in words):
                continue
            picked.append({"id": v.id, "title": v.title, "minutes": v.duration_minutes or None,
                           "watched": v.id in watched})
            used.add(v.id)
            if len(picked) == PER_TOPIC:
                break
        if picked:
            out.append({"topic": topic, "count": counts[topic], "videos": picked})
    return out
