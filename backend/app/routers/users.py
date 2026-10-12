from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.schemas import UserOut, UserProfileUpdate
from app.dependencies import get_current_user, invalidate_user_cache

router = APIRouter(prefix="/api/users", tags=["users"])

@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.put("/me", response_model=UserOut)
def update_profile(
    profile_data: UserProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Update profile fields if provided
    update_data = profile_data.model_dump(exclude_unset=True)
    
    for key, value in update_data.items():
        setattr(current_user, key, value)
        
    # Generate avatar initials if full_name is updated
    if "full_name" in update_data and update_data["full_name"]:
        current_user.avatar_initials = "".join([part[0].upper() for part in update_data["full_name"].split() if part][:2])
        
    db.commit()
    db.refresh(current_user)
    # Profile edits (role, program_district_id, …) gate content visibility, so
    # drop the cached snapshot to make the change take effect on the next request.
    invalidate_user_cache(current_user.email)
    return current_user


@router.get("/me/support-team")
def my_support_team(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Who a learner can call (review of 6 Oct 2026): their batch monitor and
    their training batch's trainers. A batch monitor also gets the learners
    they watch over, so they can reach the ones who fall behind."""
    import json

    from app import models
    from app.masd import rules as R

    def person(u):
        return {"id": u.id, "name": u.full_name or "", "phone": u.phone,
                "cadre": R.role_group(u.role)}

    out = {"monitor": None, "batch": None, "trainers": [], "is_monitor": bool(current_user.is_batch_monitor),
           "watching": []}
    if current_user.batch_monitor_id:
        mon = db.get(User, current_user.batch_monitor_id)
        if mon is not None:
            out["monitor"] = person(mon)
    sel = (db.query(models.FaceToFaceSelection)
           .filter(models.FaceToFaceSelection.user_id == current_user.id).first())
    if sel is not None and sel.batch is not None:
        b = sel.batch
        try:
            trainers = json.loads(b.trainers) if b.trainers else []
        except ValueError:
            trainers = []
        out["batch"] = {"name": b.name, "start_date": b.start_date.isoformat() if b.start_date else None,
                        "end_date": b.end_date.isoformat()}
        out["trainers"] = [t for t in trainers if isinstance(t, dict)]
    if current_user.is_batch_monitor:
        watched = (db.query(User).filter(User.batch_monitor_id == current_user.id)
                   .order_by(User.full_name).all())
        out["watching"] = [person(u) for u in watched]
    return out
