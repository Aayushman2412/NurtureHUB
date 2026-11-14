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

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.notify import ACT_TODAY, TOMORROW, create_notification

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

_FORM_WORDS = {"gm": "growth check", "bf": "breastfeeding form", "cf": "complementary feeding form",
               "anc": "antenatal check", "protein": "protein intake form"}


def _problem(kind: str, child_id: Optional[int], learner_id: int) -> str:
    """What a prompt is about, for "one alert per child per problem"
    (Learner Redesign review, 30 Oct 2026): a newer prompt about the same
    baby and problem replaces the older one in the recipient's list."""
    if kind in ("bf_counsel", "bf_dropout"):
        return f"care:bf:{child_id}"
    if child_id is not None:
        return f"care:{kind}:{child_id}"
    return f"care:{kind}:{learner_id}"


def _send(db: Session, *, kind: str, key: str, learner_id: int, recipient_id: int,
          child_id: Optional[int], title: str, message: str, link: Optional[str],
          category: str = ACT_TODAY, problem: Optional[str] = None) -> bool:
    """Record the prompt and notify, unless this exact prompt went before."""
    if db.query(models.CareAlert.id).filter(models.CareAlert.dedupe_key == key).first():
        return False
    try:
        with db.begin_nested():
            db.add(models.CareAlert(kind=kind, dedupe_key=key[:160], learner_id=learner_id,
                                    recipient_id=recipient_id, child_id=child_id))
    except IntegrityError:
        return False          # another worker sent it a moment ago
    create_notification(db, recipient_id, title, message, link=link, category=category,
                        dedupe_key=problem or _problem(kind, child_id, learner_id))
    return True


def _first(name: Optional[str]) -> str:
    return (name or "").split(" ")[0] or "the learner"


def falter_message(child_name: str, reasons: List[str], days: int) -> Dict[str, str]:
    if "weight_fell" in reasons:
        why = f"{child_name}'s weight reduced since the last visit."
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


def _visits(n: int) -> str:
    return f"{n} visit{'s' if n != 1 else ''}"


def _forms_line(g: Dict[str, Any]) -> str:
    return ", ".join(_FORM_WORDS.get(f["key"], f["key"]) for f in g.get("forms") or [])


def remind_learner(db: Session, learner: models.User, view: Dict[str, Any], now: datetime) -> int:
    """The morning list, the evening nudge, tomorrow's visits and the
    escalation for one worker. The 8 am message (Learner Redesign review,
    30 Oct 2026): "Today: 3 visits. Tomorrow: 1." — and nothing at all on a
    day with nothing to do."""
    day = now.date().isoformat()
    todo = view["today"]
    tomorrow = (now.date() + timedelta(days=1)).isoformat()
    next_day = next((d["items"] for d in view.get("week") or [] if d["date"] == tomorrow), [])
    sent = 0
    if not todo and not next_day:
        return 0
    if 8 * 60 <= now.hour * 60 + now.minute < 11 * 60:
        title = (f"Today: {_visits(len(todo))}" if todo else "No visits today")
        if next_day:
            title += f". Tomorrow: {len(next_day)}."
        message = (f"Visit today: {_names(todo)}. Open EduPoshan to start." if todo
                   else f"Tomorrow: {_names(next_day)}.")
        sent += _send(db, kind="reminder_am", key=f"am:{learner.id}:{day}", learner_id=learner.id,
                      recipient_id=learner.id, child_id=None, title=title, message=message, link="/dashboard")
    if 18 <= now.hour < 21 and next_day:
        first = next_day[0]
        who = first.get("child_name") or first.get("mother_name") or "your mother"
        more = f" and {len(next_day) - 1} more" if len(next_day) > 1 else ""
        sent += _send(db, kind="reminder_tomorrow", key=f"tmrw:{learner.id}:{day}", learner_id=learner.id,
                      recipient_id=learner.id, child_id=None, category=TOMORROW,
                      title=f"Tomorrow: {_visits(len(next_day))}",
                      message=f"{who}{more}. Forms: {_forms_line(first)}.", link="/dashboard")
    if not todo:
        return sent
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
    if not (8 * 60 <= minutes < 11 * 60 or 10 * 60 <= minutes < 17 * 60 or 18 * 60 <= minutes < 21 * 60):
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


# ── November 2026 protocol: breastfeeding stopped ─────────────────────────

def on_feeding_check(db: Session, child_id: int, learner: models.User) -> int:
    """After a growth check on a project that runs the November 2026
    protocol: a mother found not breastfeeding prompts the learner to counsel
    her; still not breastfeeding at two visits after the counselling, it
    prompts her to decide on the drop-out (docs/visit-protocol-2026-11.md).
    Once per stop. Never raises into the submission."""
    from app import visit_plan

    try:
        child = db.get(models.Child, child_id)
        plan = visit_plan.plan_for_alerts(db, learner, child, date.today()) if child is not None else None
        if plan is None or plan.get("dropout"):
            return 0
        name = child.child_name or "the baby"
        feeding = plan["feeding"]
        sent = 0
        if feeding["state"] == "counsel":
            sent += _send(db, kind="bf_counsel", key=f"bfcounsel:{child_id}:{feeding['since']}",
                          learner_id=learner.id, recipient_id=learner.id, child_id=child_id,
                          title=f"Counsel {name}'s mother",
                          message=(f"{name}'s mother is not breastfeeding. Talk to her about restarting, "
                                   "then mark the counselling on the baby's page."),
                          link=f"/babies/{child_id}")
        elif feeding["state"] == "can_drop_out":
            sent += _send(db, kind="bf_dropout", key=f"bfdropout:{child_id}:{feeding['since']}",
                          learner_id=learner.id, recipient_id=learner.id, child_id=child_id,
                          title=f"{name}: breastfeeding still stopped",
                          message=("Still not breastfeeding at two visits after the counselling. If she will not "
                                   "restart, confirm the drop-out on the baby's page."),
                          link=f"/babies/{child_id}")
        db.commit()
        return sent
    except Exception:  # a prompt must never break the form submission
        db.rollback()
        logger.exception("feeding prompt failed for child %s", child_id)
        return 0


# ── Pregnancy check: danger signs ─────────────────────────────────────────

def danger_options(schema: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
    """field id -> {option value: label} of the options marked as danger signs."""
    out: Dict[str, Dict[str, str]] = {}
    for field in schema.get("fields") or []:
        marked = {o.get("value"): o.get("label") or o.get("value")
                  for o in field.get("options") or [] if isinstance(o, dict) and o.get("danger")}
        if marked:
            out[field.get("id")] = marked
    return out


def on_anc_danger(db: Session, response: models.FormResponse, schema: Dict[str, Any],
                  learner: models.User) -> int:
    """A submitted pregnancy check with a danger sign ticked (bleeding,
    blurred vision, headache — Learner Redesign review, 30 Oct 2026: they
    "should trigger a referral message"): tell the learner to refer the
    mother today. Once per form. Never raises into the submission."""
    try:
        marked = danger_options(schema)
        if not marked:
            return 0
        found: List[str] = []
        for snap in response.answers_json or []:
            if not isinstance(snap, dict) or snap.get("nodeId") not in marked:
                continue
            labels = marked[snap["nodeId"]]
            for s in snap.get("selected") or []:
                oid = s.get("optionId") if isinstance(s, dict) else None
                if oid in labels:
                    found.append(labels[oid])
        if not found:
            return 0
        mother = db.get(models.Mother, response.mother_id)
        name = (mother.mother_name if mother else None) or "the mother"
        sent = _send(db, kind="anc_danger", key=f"ancdanger:{response.id}", learner_id=learner.id,
                     recipient_id=learner.id, child_id=None,
                     problem=f"care:anc_danger:m{response.mother_id}",
                     title=f"Refer {name} today",
                     message=(f"Danger signs at the pregnancy check: {', '.join(found)}. "
                              "Take her to the PHC / FRU today and tell your supervisor."),
                     link=f"/mothers/{response.mother_id}")
        db.commit()
        return int(sent)
    except Exception:  # a prompt must never break the form submission
        db.rollback()
        logger.exception("pregnancy danger prompt failed for response %s", response.id)
        return 0
