from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from sqlalchemy import func, case
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import Notification
from app.schemas import NotificationOut
from app.dependencies import get_verified_user
from app.models import User

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _notifications_etag(db: Session, user_id: int) -> str:
    """A cheap fingerprint of a user's notification state (one indexed aggregate
    query). Changes whenever a notification is added, removed, or read/unread —
    which is exactly when the polled list would differ."""
    count, max_id, unread = db.query(
        func.count(Notification.id),
        func.coalesce(func.max(Notification.id), 0),
        func.coalesce(func.sum(case((Notification.is_read == False, 1), else_=0)), 0),  # noqa: E712
    ).filter(Notification.user_id == user_id).one()
    return f'W/"n{count}-{max_id}-{unread}"'


@router.get("", response_model=List[NotificationOut])
def get_notifications(
    request: Request,
    response: Response,
    current_user: User = Depends(get_verified_user),
    db: Session = Depends(get_db),
):
    # This endpoint is polled every 15s by every open page, so short-circuit the
    # common "nothing changed" case: compute a cheap ETag and return 304 (no body,
    # no row fetch, no serialization) when the client's copy is current.
    etag = _notifications_etag(db, current_user.id)
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED,
                        headers={"ETag": etag, "Cache-Control": "private, no-cache"})

    notifications = db.query(Notification).filter(
        Notification.user_id == current_user.id
    ).order_by(Notification.created_at.desc()).all()
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "private, no-cache"
    return notifications

@router.put("/{id}/read")
def mark_as_read(id: int, current_user: User = Depends(get_verified_user), db: Session = Depends(get_db)):
    notification = db.query(Notification).filter(
        Notification.id == id,
        Notification.user_id == current_user.id
    ).first()
    
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
        
    notification.is_read = True
    db.commit()
    return {"message": "Notification marked as read"}

@router.put("/read-all")
def mark_all_as_read(current_user: User = Depends(get_verified_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    ).update({Notification.is_read: True}, synchronize_session=False)
    db.commit()
    return {"message": "All notifications marked as read"}
