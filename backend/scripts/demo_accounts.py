"""Two learner accounts for showing the learner's side (review of 18 Oct 2026).

Sir: "one learner I want to focus on in the stage of selection — the
screening test; another learner, we need to show how the dashboard would be
for a person who is halfway through the adoption process. These two are
independent accounts."

  A  a synthetic learner who finished every video and both tests and is
     waiting for the selection — not selected for F2F, no mothers
     (default project: jalna). Her dashboard opens on Training.
  B  a synthetic F2F learner about halfway through her adoptions and forms
     (default project: chandrapur). Her dashboard opens on Adoptions.

    python -m scripts.demo_accounts pick                 # who would be used (changes nothing)
    python -m scripts.demo_accounts prepare              # asks for a password, sets it on both
    python -m scripts.demo_accounts undo                 # puts both passwords and the topics back

`prepare` also gives the two projects' test questions a topic where they
have none (by keywords in the question), so the topic-wise scores have
something to show; `undo` clears exactly those. Only @nurturehub.mock
learners are ever touched. Sign in with the mobile number it prints.
"""
from __future__ import annotations

import argparse
import getpass
import re
import sys
from datetime import date
from typing import Dict, List, Optional

from app import models, projects
from app.auth import get_password_hash
from app.database import SessionLocal
from app.flow import is_awaiting_results

MOCK_DOMAIN = "@nurturehub.mock"
UNDO_KEY = "demo.accounts"

# First rule that matches wins, so "complementary feeding … continued
# breastfeeding" is complementary feeding.
TOPIC_RULES = [
    ("Complementary feeding", ["complementary", "solid food", "semi-solid", "weaning"]),
    ("Breastfeeding", ["breastfeed", "breast milk", "breastmilk", "colostrum", "latch"]),
    ("Malnutrition (SAM / MAM)", ["muac", "sam", "mam", "severe acute", "malnutrition", "oedema"]),
    ("Growth monitoring", ["growth", "weigh", "stunting", "wasting", "underweight", "height-for-age", "z-score"]),
    ("Micro-nutrients", ["vitamin", "iron", "ifa", "folic", "zinc", "micronutrient", "supplement"]),
    ("Immunization", ["vaccin", "immuni", "cold chain", "bcg", "polio", "measles"]),
    ("Antenatal care", ["antenatal", "anc", "pregnan", "birth prepared", "delivery"]),
    ("Child development", ["milestone", "development", "stimulation", "play"]),
    ("Counselling", ["counsel", "home visit"]),
]


def topic_for(text: str) -> str:
    low = (text or "").lower()
    for topic, words in TOPIC_RULES:
        if any(re.search(r"\b" + re.escape(w), low) for w in words):
            return topic
    return "General"


def _project(db, slug: str) -> models.ProgramDistrict:
    p = db.query(models.ProgramDistrict).filter(models.ProgramDistrict.slug == slug).first()
    if p is None:
        sys.exit(f"No project '{slug}'.")
    return p


def _mobile(u: models.User) -> str:
    return u.phone or "—"


def pick_a(db, slug: str) -> Optional[models.User]:
    p = _project(db, slug)
    f2f = {uid for (uid,) in db.query(models.FaceToFaceSelection.user_id)}
    adopting = {uid for (uid,) in db.query(models.Mother.registered_by_user_id).distinct()}
    for u in (db.query(models.User).filter(models.User.program_district_id == p.id,
                                           models.User.email.like(f"%{MOCK_DOMAIN}"))
              .order_by(models.User.id)):
        if u.id not in f2f and u.id not in adopting and u.phone and is_awaiting_results(db, u):
            return u
    return None


def pick_b(db, slug: str) -> Optional[tuple]:
    """The F2F learner whose adoptions and forms are both nearest 60 % done."""
    from app.masd import data as D, engine as E
    from app.routers.dashboard import _masd_project

    p = _project(db, slug)
    ids = [uid for (uid,) in db.query(models.User.id)
           .join(models.FaceToFaceSelection, models.FaceToFaceSelection.user_id == models.User.id)
           .filter(models.User.program_district_id == p.id, models.User.email.like(f"%{MOCK_DOMAIN}"),
                   models.User.phone.isnot(None))]
    if not ids:
        return None
    any_user = db.get(models.User, ids[0])
    project = _masd_project(db, any_user)
    data = D.load(db, project, only_learners=ids, with_growth=False)
    rows = [r for r in E.team_view(data, date.today(), ids)
            if r["adoptions"] and r["fulfilment_pct"] is not None and r["forms_pct"] is not None]
    if not rows:
        return None
    best = min(rows, key=lambda r: abs(r["fulfilment_pct"] - 60) + abs(r["forms_pct"] - 60))
    return db.get(models.User, best["id"]), best


def _set_topics(db, slugs: List[str]) -> List[int]:
    changed: List[int] = []
    for slug in slugs:
        cid = projects.content_project_id_for(db, _project(db, slug).id)
        stage_ids = [s.id for s in db.query(models.Stage.id).filter(models.Stage.program_district_id == cid)]
        test_ids = [t.id for t in db.query(models.Test.id).filter(models.Test.stage_id.in_(stage_ids))] if stage_ids else []
        for q in (db.query(models.Question).filter(models.Question.test_id.in_(test_ids),
                                                   models.Question.topic.is_(None)) if test_ids else []):
            q.topic = topic_for(q.text)
            changed.append(q.id)
    return changed


def show(db, a_slug: str, b_slug: str) -> tuple:
    a = pick_a(db, a_slug)
    b = pick_b(db, b_slug)
    print("A — waiting for the selection (dashboard opens on Training):")
    print(f"   {a.full_name} · {a_slug} · mobile {_mobile(a)}" if a else "   none found")
    print("B — halfway through adoptions (dashboard opens on Adoptions):")
    if b:
        u, r = b
        print(f"   {u.full_name} · {b_slug} · mobile {_mobile(u)} · adoptions {r['adoptions']}/{r['target']}"
              f" ({r['fulfilment_pct']}%) · forms {r['forms_done']}/{r['forms_due']} ({r['forms_pct']}%)")
    else:
        print("   none found")
    return a, (b[0] if b else None)


def prepare(db, a_slug: str, b_slug: str) -> None:
    if db.get(models.MasdRuleTable, UNDO_KEY) is not None:
        sys.exit("Already prepared — run `undo` first.")
    a, b = show(db, a_slug, b_slug)
    users = [u for u in (a, b) if u is not None]
    if not users:
        sys.exit("No accounts to prepare.")
    if any(not u.email.endswith(MOCK_DOMAIN) for u in users):
        sys.exit("Refusing: only synthetic (@nurturehub.mock) learners are used.")
    pw = getpass.getpass("Password for both demo accounts (not shown): ")
    if len(pw) < 8 or pw != getpass.getpass("Again: "):
        sys.exit("Passwords did not match (or under 8 characters); nothing changed.")
    undo: Dict[str, object] = {"users": {str(u.id): u.password_hash for u in users}}
    for u in users:
        u.password_hash = get_password_hash(pw)
    undo["questions"] = _set_topics(db, sorted({a_slug, b_slug}))
    db.add(models.MasdRuleTable(key=UNDO_KEY, value_json=undo, updated_by="scripts.demo_accounts"))
    db.commit()
    print(f"Done: password set on {len(users)} account(s); topics given to {len(undo['questions'])} question(s).")
    print("Sign in on the learner page with the mobile number above and that password.")


def undo(db) -> None:
    row = db.get(models.MasdRuleTable, UNDO_KEY)
    if row is None:
        print("Nothing to undo.")
        return
    info = row.value_json or {}
    for uid, old in (info.get("users") or {}).items():
        u = db.get(models.User, int(uid))
        if u is not None and u.email.endswith(MOCK_DOMAIN):
            u.password_hash = old
    qids = info.get("questions") or []
    if qids:
        db.query(models.Question).filter(models.Question.id.in_(qids)).update(
            {models.Question.topic: None}, synchronize_session=False)
    db.delete(row)
    db.commit()
    print(f"Restored {len(info.get('users') or {})} password(s); cleared {len(qids)} topic(s).")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["pick", "prepare", "undo"])
    ap.add_argument("--a-project", default="jalna", help="project of the learner waiting for selection")
    ap.add_argument("--b-project", default="chandrapur", help="project of the learner halfway through adoptions")
    a = ap.parse_args()
    db = SessionLocal()
    try:
        if a.action == "pick":
            show(db, a.a_project, a.b_project)
        elif a.action == "prepare":
            prepare(db, a.a_project, a.b_project)
        else:
            undo(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
