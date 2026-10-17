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
    join_project = update_data.pop("join_project", None)

    if update_data.get("phone"):
        from app.identity import normalise_mobile
        mobile = normalise_mobile(update_data["phone"])
        if mobile is None:
            raise HTTPException(status_code=400, detail="Enter a 10-digit mobile number.")
        if mobile != normalise_mobile(current_user.phone):
            current_user.phone_verified = False   # a changed number is not yet confirmed
        update_data["phone"] = mobile

    # A gram panchayat typed exactly as the taluka's list spells it is that
    # entry; only a name not on the list stays free text (to standardise later).
    typed_gp = (update_data.get("gram_panchayat_name") or "").strip()
    block_for_gp = update_data.get("block_id") or current_user.block_id
    if typed_gp and not update_data.get("gram_panchayat_id") and block_for_gp:
        from sqlalchemy import func
        from app.models import GramPanchayat
        gp = (db.query(GramPanchayat)
              .filter(GramPanchayat.block_id == block_for_gp, func.lower(GramPanchayat.name) == typed_gp.lower())
              .first())
        if gp is not None:
            update_data["gram_panchayat_id"], update_data["gram_panchayat_name"] = gp.id, None

    for key, value in update_data.items():
        setattr(current_user, key, value)
    if "phone" in update_data:
        current_user.sync_lookups()   # sign-in by mobile number finds the account by it

    # Registration by project (review of 17 Oct 2026): a learner finishing
    # registration through a project's link, or in the district of the one
    # project open for registration, is put in that project straight away.
    if update_data.get("role") and update_data.get("district_id"):
        from app import registration
        registration.assign(db, current_user, join_project)

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
