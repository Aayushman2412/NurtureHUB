"""A learner's own tests, topic by topic (review of 18 Oct 2026).

Sir: "in the formative test and screening test, which particular topic got
what percentage of score, and a small inference based on this scoring
pattern — you have scored better in this particular area but you are still
poor in this particular component; it would be suggested you watch the
videos related to complementary feeding."

One entry per test the learner has submitted, from their LATEST submitted
attempt (what they last did is what the advice is about). Topics come from
`questions.topic` (set from the question-upload sheet); questions without one
are grouped as untagged (topic None) so the totals still add up.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app import projects
from app.models import Question, Stage, Test, TestAnswer, TestAttempt, Tutorial, User

# A topic at or above this share is "done well"; below the test's pass mark it
# needs another look.
STRONG_PCT = 80.0

# Words too common in this syllabus to tie a topic to a video.
_STOP = {"and", "the", "for", "with", "care", "test", "basic", "basics", "practice", "general",
         "other", "from", "into", "about", "their", "health", "child", "children", "mother", "mothers"}


def _words(text: Optional[str]) -> set[str]:
    """Word stems (first six letters), so "counselling" meets "Counseling" and
    "nutrients" meets "Micro-Nutrient"."""
    return {w[:6] for w in re.findall(r"[a-z]+", (text or "").lower()) if len(w) >= 4 and w not in _STOP}


def _videos_for(topic: str, tutorials: List[Tutorial], limit: int = 3) -> List[Dict[str, Any]]:
    """The project's videos whose title or description shares a word with the
    topic — best overlap first. No topic table links them yet, so this is a
    plain word match; it errs towards suggesting nothing."""
    want = _words(topic)
    if not want:
        return []
    scored = []
    for t in tutorials:
        title, desc = _words(t.title), _words(t.description)
        score = 2 * len(want & title) + len(want & desc)
        if score:
            scored.append((score, t.order_index or 0, t))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [{"id": t.id, "title": t.title, "module_number": t.module_number} for _, _, t in scored[:limit]]


def topic_report(db: Session, user: User) -> List[Dict[str, Any]]:
    project_id = projects.content_project_id_for(db, user.program_district_id)
    if not project_id:
        return []
    stages = db.query(Stage).filter(Stage.program_district_id == project_id).order_by(Stage.order_index).all()
    stage_ids = [s.id for s in stages]
    if not stage_ids:
        return []
    order = {s.id: s.order_index for s in stages}
    tests = sorted(db.query(Test).filter(Test.stage_id.in_(stage_ids)).all(),
                   key=lambda t: order.get(t.stage_id, 0))
    tutorials = db.query(Tutorial).filter(Tutorial.stage_id.in_(stage_ids)).all()

    out: List[Dict[str, Any]] = []
    for test in tests:
        attempt = (db.query(TestAttempt)
                   .filter(TestAttempt.user_id == user.id, TestAttempt.test_id == test.id,
                           TestAttempt.submitted_at.isnot(None))
                   .order_by(TestAttempt.submitted_at.desc()).first())
        if attempt is None:
            continue
        right = {qid: bool(ok) for qid, ok in db.query(TestAnswer.question_id, TestAnswer.is_correct)
                 .filter(TestAnswer.attempt_id == attempt.id)}
        buckets: Dict[Optional[str], Dict[str, int]] = {}
        for qid, topic in db.query(Question.id, Question.topic).filter(Question.test_id == test.id):
            key = (topic or "").strip() or None
            b = buckets.setdefault(key, {"correct": 0, "total": 0})
            b["total"] += 1
            b["correct"] += 1 if right.get(qid) else 0
        topics = [{"topic": k, **v, "pct": round(100.0 * v["correct"] / v["total"], 1) if v["total"] else None}
                  for k, v in buckets.items()]
        # Weakest first: that is what the learner should act on.
        topics.sort(key=lambda r: (r["topic"] is None, r["pct"] if r["pct"] is not None else 101, r["topic"] or ""))
        named = [r for r in topics if r["topic"]]
        pass_pct = float(test.passing_score_pct or 0)
        weak = [r["topic"] for r in named if r["pct"] is not None and r["pct"] < pass_pct]
        strong = [r["topic"] for r in sorted(named, key=lambda r: -(r["pct"] or 0))
                  if r["pct"] is not None and r["pct"] >= STRONG_PCT]
        correct = sum(r["correct"] for r in topics)
        total = sum(r["total"] for r in topics)
        out.append({
            "test_id": test.id, "title": test.title, "test_type": test.test_type,
            "status": test.status, "stage_id": test.stage_id,
            "attempt_id": attempt.id, "attempt_number": attempt.attempt_number,
            "score": attempt.score, "is_passed": bool(attempt.is_passed),
            "passing_score_pct": test.passing_score_pct,
            "correct": correct, "total": total,
            "topics": topics, "strong": strong, "weak": weak,
            "videos": [{"topic": w, "videos": _videos_for(w, tutorials)} for w in weak],
        })
    return out
