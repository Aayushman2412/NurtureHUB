"""Care prompts and escalation (launch review of 19 Oct 2026).

Dr Rupal: "as soon as there is some stagnation or the faltering, immediately
that message should go on their application — see this baby in 24 or 48
hours"; "if she is faltering, that immediate message should go to the
supervisor or the monitor also"; and for visits not done, a reminder to the
worker, then "the same notification goes to the batch monitor — this learner
was expected these many visits but not completed, kindly give a call".

* **After a growth check** (always on): a baby whose weight fell, who stopped
  gaining, or whose weight is low gets a "see within 2 days" notification to
  the worker, and one to her batch monitor. The monitor's message names the
  baby by its record ID only — a batch monitor is a fellow learner, and the
  team view never names another worker's mothers or babies.
* **Scheduled** (CARE_REMINDERS_ENABLED, off unless switched on): the day's
  visits in the morning, what is still not done in the evening, and an
  escalation to the batch monitor when visits stay late. Off by default
  because it messages every worker at once; the programme decides when.

Every prompt is recorded in care_alerts under a key naming it, so none is
ever sent twice.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.notify import create_notification

IST = ZoneInfo("Asia/Kolkata")

_FORM_WORDS = {"gm": "growth check", "bf": "breastfeeding form", "cf": "complementary feeding form",
               "anc": "antenatal check", "protein": "protein intake form"}


def _send(db: Session, *, kind: str, key: str, learner_id: int, recipient_id: int,
          child_id: Optional[int], title: str, message: str, link: Optional[str]) -> bool:
    """Record the prompt and notify, unless this exact prompt went before."""
    if db.query(models.CareAlert.id).filter(models.CareAlert.dedupe_key == key).first():
        return False
    try:
        with db.begin_nested():
            db.add(models.CareAlert(kind=kind, dedupe_key=key[:160], learner_id=learner_id,
                                    recipient_id=recipient_id, child_id=child_id))
    except IntegrityError:
        return False          # another worker sent it a moment ago
    create_notification(db, recipient_id, title, message, link=link)
    return True


def _first(name: Optional[str]) -> str:
    return (name or "").split(" ")[0] or "the learner"


def falter_message(child_name: str, reasons: List[str], days: int) -> Dict[str, str]:
    if "weight_fell" in reasons:
        why = f"{child_name}'s weight went down since the last visit."
    elif "not_gaining" in reasons:
        why = f"{child_name} is not gaining enough weight."
    else:
        why = f"{child_name}'s weight is low."
    return {"title": f"See {child_name} within {days} days",
            "message": f"{why} Visit within {days} days: check the growth again and talk to the mother about feeding."}


def on_growth_check(db: Session, child_id: int, learner: models.User) -> int:
    """After a growth check is submitted: prompt the worker (and her batch
    monitor) when the baby needs to be seen again soon. Returns how many
    notifications went out. Never raises into the submission."""
    from app.fieldplan import baby_status
    from app.routers.growth import _build_cases

    try:
        cases = _build_cases(db, child_id=child_id)
        if not cases:
            return 0
        case = cases[0]
        st = baby_status(case)
        if not st.get("see_within_days"):
            return 0
        days = st["see_within_days"]
        on = (st.get("latest") or {}).get("date") or date.today().isoformat()
        child = case["child"]
        text = falter_message(child["name"] or "The baby", st["reasons"], days)
        sent = 0
        sent += _send(db, kind="falter", key=f"falter:{child_id}:{on}:{learner.id}", learner_id=learner.id,
                      recipient_id=learner.id, child_id=child_id, title=text["title"], message=text["message"],
                      link=f"/babies/{child_id}")
        monitor = learner.batch_monitor_id
        if monitor and monitor != learner.id:
            what = ("lost weight" if "weight_fell" in st["reasons"]
                    else "is not gaining weight" if "not_gaining" in st["reasons"] else "has low weight")
            sent += _send(
                db, kind="falter", key=f"falter:{child_id}:{on}:{monitor}", learner_id=learner.id,
                recipient_id=monitor, child_id=child_id,
                title=f"Follow up with {_first(learner.full_name)}",
                message=(f"Baby {child['uid']} of {learner.full_name or 'your learner'} {what} at the check on {on}. "
                         f"Please call {_first(learner.full_name)}: the baby should be seen within {days} days."),
                link="/dashboard")
        db.commit()
        return sent
    except Exception as exc:  # a prompt must never break the form submission
        db.rollback()
        print(f"[care_alerts] growth-check prompt failed: {exc}")
        return 0


# ── Scheduled reminders ────────────────────────────────────────────────────

def _names(groups: List[Dict[str, Any]], limit: int = 3) -> str:
    names = []
    for g in groups:
        n = g.get("child_name") or g.get("mother_name")
        if n and n not in names:
            names.append(n)
    shown = ", ".join(names[:limit])
    return shown + (f" and {len(names) - limit} more" if len(names) > limit else "")


def remind_learner(db: Session, learner: models.User, view: Dict[str, Any], now: datetime) -> int:
    """The morning list, the evening nudge and the escalation for one worker."""
    day = now.date().isoformat()
    todo = view["today"]
    sent = 0
    if not todo:
        return 0
    if 7 * 60 + 30 <= now.hour * 60 + now.minute < 11 * 60:
        sent += _send(db, kind="reminder_am", key=f"am:{learner.id}:{day}", learner_id=learner.id,
                      recipient_id=learner.id, child_id=None,
                      title=f"Today: {len(todo)} visit{'s' if len(todo) != 1 else ''}",
                      message=f"Visit today: {_names(todo)}. Open NurtureHUB to start.", link="/dashboard")
    if 18 <= now.hour < 21:
        sent += _send(db, kind="reminder_pm", key=f"pm:{learner.id}:{day}", learner_id=learner.id,
                      recipient_id=learner.id, child_id=None,
                      title=f"{len(todo)} visit{'s' if len(todo) != 1 else ''} not done yet",
                      message=f"Still to do: {_names(todo)}. Finish them today or first thing tomorrow.",
                      link="/dashboard")
    late = [g for g in todo if g["late_days"] >= settings.CARE_ESCALATE_AFTER_DAYS]
    monitor = learner.batch_monitor_id
    if late and monitor and monitor != learner.id and 10 <= now.hour < 17:
        oldest = max(g["late_days"] for g in late)
        sent += _send(db, kind="escalation", key=f"esc:{learner.id}:{day}", learner_id=learner.id,
                      recipient_id=monitor, child_id=None,
                      title=f"{_first(learner.full_name)} needs a call",
                      message=(f"{learner.full_name or 'Your learner'} has {len(late)} visit"
                               f"{'s' if len(late) != 1 else ''} late (the oldest {oldest} days). Kindly give {_first(learner.full_name)} a call."),
                      link="/dashboard")
    return sent


def run_reminders(db: Session, now: Optional[datetime] = None) -> int:
    """One pass over every adopting worker. Cheap outside the three windows."""
    from app.fieldplan import today_view

    if not settings.CARE_REMINDERS_ENABLED:
        return 0
    now = (now or datetime.now(timezone.utc)).astimezone(IST)
    minutes = now.hour * 60 + now.minute
    if not (7 * 60 + 30 <= minutes < 11 * 60 or 10 * 60 <= minutes < 17 * 60 or 18 * 60 <= minutes < 21 * 60):
        return 0
    learner_ids = [uid for (uid,) in db.query(models.User.id)
                   .join(models.FaceToFaceSelection, models.FaceToFaceSelection.user_id == models.User.id)
                   .join(models.Mother, models.Mother.registered_by_user_id == models.User.id)
                   .filter(models.User.is_admin.is_(False)).distinct()]
    sent = 0
    for uid in learner_ids:
        learner = db.get(models.User, uid)
        if learner is None:
            continue
        try:
            sent += remind_learner(db, learner, today_view(db, learner, now.date()), now)
            db.commit()
        except Exception as exc:  # one worker's data must not stop the others
            db.rollback()
            print(f"[care_alerts] reminders failed for learner {uid}: {exc}")
    return sent
