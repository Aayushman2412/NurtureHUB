"""Web-push subscription endpoints (PWA notifications).

The frontend fetches the VAPID public key, subscribes via the browser's
PushManager, and registers the subscription here. Subscriptions are keyed to
the user and survive token expiry; dead endpoints are pruned by the sender
(app/notify.py) when the push service reports 404/410.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.database import get_db
from app.dependencies import get_verified_user
from app.notify import push_enabled

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/public-key")
def get_public_key():
    """Public VAPID key (safe to expose); empty => push disabled server-side."""
    return {"public_key": settings.VAPID_PUBLIC_KEY, "enabled": push_enabled()}


class SubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2000)
    p256dh: str = Field(min_length=1, max_length=512)
    auth: str = Field(min_length=1, max_length=512)
    user_agent: Optional[str] = Field(default=None, max_length=300)


@router.post("/subscribe")
def subscribe(
    data: SubscriptionIn,
    current_user: models.User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.endpoint == data.endpoint)
        .first()
    )
    if existing:
        # Same device re-subscribing (possibly as a different user on a shared
        # phone) — re-home the endpoint to the current user.
        existing.user_id = current_user.id
        existing.p256dh = data.p256dh
        existing.auth = data.auth
        existing.user_agent = data.user_agent
        db.commit()
        return {"ok": True}

    db.add(models.PushSubscription(
        user_id=current_user.id,
        endpoint=data.endpoint,
        p256dh=data.p256dh,
        auth=data.auth,
        user_agent=data.user_agent,
    ))
    try:
        db.commit()
    except IntegrityError:
        # Two near-simultaneous first-time subscribes for the same endpoint
        # (endpoint is UNIQUE): the loser retries as an update.
        db.rollback()
        row = (
            db.query(models.PushSubscription)
            .filter(models.PushSubscription.endpoint == data.endpoint)
            .first()
        )
        if row:
            row.user_id = current_user.id
            row.p256dh = data.p256dh
            row.auth = data.auth
            row.user_agent = data.user_agent
            db.commit()
    return {"ok": True}


class UnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2000)


@router.post("/unsubscribe")
def unsubscribe(
    data: UnsubscribeIn,
    current_user: models.User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    db.query(models.PushSubscription).filter(
        models.PushSubscription.endpoint == data.endpoint,
        models.PushSubscription.user_id == current_user.id,
    ).delete()
    db.commit()
    return {"ok": True}
