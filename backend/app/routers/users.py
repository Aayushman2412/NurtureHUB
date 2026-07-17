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
