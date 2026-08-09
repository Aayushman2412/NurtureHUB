"""Single funnel for user notifications + web-push delivery.

Every feature that used to `db.add(models.Notification(...))` inline now calls
`create_notification()`. Besides inserting the row, the helper records the
notification in the session's info dict; a SQLAlchemy `after_commit` hook then
hands the batch to a background thread that sends one web push per device
subscription — so a push can never fire for a row that was rolled back, and
webpush HTTP latency never runs inside a request/DB transaction.

Batching: a single form submit can create up to ~17 notifications for one
user (summary + high-protein + per-action coaching). Pushing each one would
spam the phone, so more than DIGEST_THRESHOLD rows for the same user in one
commit collapse into a single digest push. The in-app notification list still
shows every row.

Delivery is best-effort: no VAPID keys configured -> pushes are skipped
silently (the in-app list keeps working). Subscriptions rejected by the push
service (404/410) are pruned.
"""
from __future__ import annotations

import json
import threading
import uuid
from typing import Optional

from sqlalchemy import event
from sqlalchemy.orm import Session

from app import models
from app.config import settings

DIGEST_THRESHOLD = 3

_PENDING_KEY = "pending_push_notifications"

# Webpush HTTP calls can hang up to their 10s timeout each; without a bound a
# burst of commits would stack an unbounded number of sender threads.
_SEND_SLOTS = threading.BoundedSemaphore(4)


def create_notification(
    db: Session,
    user_id: int,
    title: str,
    message: str,
    link: Optional[str] = None,
) -> models.Notification:
    """Insert a notification row and schedule its push for after commit."""
    notification = models.Notification(
        user_id=user_id, title=title, message=message, link=link
    )
    db.add(notification)
    db.info.setdefault(_PENDING_KEY, []).append(
        {"user_id": user_id, "title": title, "message": message, "link": link}
    )
    return notification


def push_enabled() -> bool:
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)


def _send_push_batch(batch: list[dict]) -> None:
    """Runs on a daemon thread; bounded by _SEND_SLOTS.

    DB discipline: sessions here come from the SAME pool the request handlers
    use, and webpush HTTP calls can take up to 10s each — so subscriptions are
    read and MATERIALIZED first and the session is closed BEFORE any network
    I/O. Dead-endpoint pruning opens a second short-lived session at the end.
    A slow push service must never pin pooled connections and starve the API.
    """
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:  # pragma: no cover — dependency missing in some env
        return
    from app.database import SessionLocal

    with _SEND_SLOTS:
        by_user: dict[int, list[dict]] = {}
        for item in batch:
            by_user.setdefault(item["user_id"], []).append(item)

        # Phase 1 — read subscriptions into plain tuples, then release the
        # connection before any webpush call.
        db = SessionLocal()
        try:
            rows = (
                db.query(models.PushSubscription)
                .filter(models.PushSubscription.user_id.in_(by_user.keys()))
                .all()
            )
            subs_by_user: dict[int, list[tuple[int, str, str, str]]] = {}
            for sub in rows:
                subs_by_user.setdefault(sub.user_id, []).append(
                    (sub.id, sub.endpoint, sub.p256dh, sub.auth)
                )
        finally:
            db.close()

        # Phase 2 — pure network I/O, no DB session held.
        dead: set[int] = set()
        for user_id, items in by_user.items():
            subscriptions = subs_by_user.get(user_id)
            if not subscriptions:
                continue
            if len(items) > DIGEST_THRESHOLD:
                payloads = [{
                    "title": items[0]["title"],
                    "body": f"…and {len(items) - 1} more notifications.",
                    "link": "/notifications",
                    # One constant tag: successive digests SHOULD collapse.
                    "tag": "nh-digest",
                }]
            else:
                payloads = [{
                    "title": item["title"],
                    "body": item["message"][:180],
                    "link": item["link"] or "/notifications",
                    # Unique per push — a tag derived from the title made two
                    # same-title events (two tutorial completions) silently
                    # replace each other in the phone's tray.
                    "tag": f"nh-{uuid.uuid4().hex[:10]}",
                } for item in items]

            for sub_id, endpoint, p256dh, auth in subscriptions:
                for payload in payloads:
                    try:
                        webpush(
                            subscription_info={
                                "endpoint": endpoint,
                                "keys": {"p256dh": p256dh, "auth": auth},
                            },
                            data=json.dumps(payload),
                            vapid_private_key=settings.VAPID_PRIVATE_KEY,
                            vapid_claims={"sub": settings.VAPID_SUBJECT},
                            timeout=10,
                        )
                    except WebPushException as exc:
                        status = getattr(exc.response, "status_code", None)
                        if status in (404, 410):
                            dead.add(sub_id)
                        break  # don't hammer a failing endpoint with the rest
                    except Exception:  # noqa: BLE001 — network blips etc.
                        break

        # Phase 3 — prune dead endpoints in a fresh short-lived session.
        if dead:
            db = SessionLocal()
            try:
                db.query(models.PushSubscription).filter(
                    models.PushSubscription.id.in_(dead)
                ).delete(synchronize_session=False)
                db.commit()
            finally:
                db.close()


def _after_commit(session: Session) -> None:
    pending = session.info.pop(_PENDING_KEY, None)
    if not pending or not push_enabled():
        return
    threading.Thread(
        target=_send_push_batch, args=(pending,), daemon=True, name="webpush-send"
    ).start()


def _after_rollback(session: Session) -> None:
    session.info.pop(_PENDING_KEY, None)


def wire_session_events(session_factory) -> None:
    """Attach the after-commit push dispatcher to the app's sessionmaker."""
    event.listen(session_factory, "after_commit", _after_commit)
    event.listen(session_factory, "after_rollback", _after_rollback)
