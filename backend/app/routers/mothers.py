import uuid
from datetime import timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.dependencies import get_current_user

router = APIRouter(prefix="/api/mothers", tags=["mothers"])


def _apply(mother: models.Mother, data: schemas.MotherBase) -> None:
    """Copy scalar fields onto the ORM object and derive edd_lmp from LMP."""
    for key, value in data.model_dump(exclude={"source_ratings"}).items():
        setattr(mother, key, value)
    mother.edd_lmp = (mother.lmp + timedelta(days=280)) if mother.lmp else None


def _replace_ratings(mother: models.Mother, ratings: List[schemas.MotherSourceRatingIn], db: Session) -> None:
    mother.source_ratings.clear()
    db.flush()
    for r in ratings:
        db.add(models.MotherSourceRating(mother_id=mother.id, **r.model_dump()))


def _get_owned(mother_id: int, current_user: models.User, db: Session) -> models.Mother:
    mother = (
        db.query(models.Mother)
        .filter(models.Mother.id == mother_id, models.Mother.registered_by_user_id == current_user.id)
        .first()
    )
    if not mother:
        raise HTTPException(status_code=404, detail="Mother not found")
    return mother


@router.post("", response_model=schemas.MotherOut)
def create_mother(
    data: schemas.MotherCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mother = models.Mother(
        mother_uid=f"MR-{uuid.uuid4().hex[:10].upper()}",
        registered_by_user_id=current_user.id,
    )
    _apply(mother, data)
    db.add(mother)
    db.flush()
    _replace_ratings(mother, data.source_ratings, db)
    db.commit()
    db.refresh(mother)
    return mother


@router.get("", response_model=List[schemas.MotherListItem])
def list_mothers(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(models.Mother)
        .filter(models.Mother.registered_by_user_id == current_user.id)
        .order_by(models.Mother.created_at.desc())
        .all()
    )


@router.get("/{mother_id}", response_model=schemas.MotherOut)
def get_mother(
    mother_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _get_owned(mother_id, current_user, db)


@router.put("/{mother_id}", response_model=schemas.MotherOut)
def update_mother(
    mother_id: int,
    data: schemas.MotherCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mother = _get_owned(mother_id, current_user, db)
    _apply(mother, data)
    _replace_ratings(mother, data.source_ratings, db)
    db.commit()
    db.refresh(mother)
    return mother


# --- Children (nested under an owned mother) ---

def _apply_child(child: models.Child, data: schemas.ChildBase) -> None:
    for key, value in data.model_dump(exclude={"birth_conditions"}).items():
        setattr(child, key, value)


def _replace_conditions(child: models.Child, conditions: List[schemas.ChildBirthConditionIn], db: Session) -> None:
    child.birth_conditions.clear()
    db.flush()
    seen = set()
    for c in conditions:
        if c.condition in seen:      # the UniqueConstraint(child_id, condition) forbids dupes
            continue
        seen.add(c.condition)
        db.add(models.ChildBirthCondition(child_id=child.id, condition=c.condition))


def _get_owned_child(mother: models.Mother, child_id: int, db: Session) -> models.Child:
    child = (
        db.query(models.Child)
        .filter(models.Child.id == child_id, models.Child.mother_id == mother.id)
        .first()
    )
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")
    return child


@router.post("/{mother_id}/children", response_model=schemas.ChildOut)
def create_child(
    mother_id: int,
    data: schemas.ChildCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mother = _get_owned(mother_id, current_user, db)
    child = models.Child(child_uid=f"CR-{uuid.uuid4().hex[:10].upper()}", mother_id=mother.id)
    _apply_child(child, data)
    db.add(child)
    db.flush()
    _replace_conditions(child, data.birth_conditions, db)
    db.commit()
    db.refresh(child)
    return child


@router.get("/{mother_id}/children", response_model=List[schemas.ChildListItem])
def list_children(
    mother_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mother = _get_owned(mother_id, current_user, db)
    return (
        db.query(models.Child)
        .filter(models.Child.mother_id == mother.id)
        .order_by(models.Child.created_at.desc())
        .all()
    )


@router.get("/{mother_id}/children/{child_id}", response_model=schemas.ChildOut)
def get_child(
    mother_id: int,
    child_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mother = _get_owned(mother_id, current_user, db)
    return _get_owned_child(mother, child_id, db)


@router.put("/{mother_id}/children/{child_id}", response_model=schemas.ChildOut)
def update_child(
    mother_id: int,
    child_id: int,
    data: schemas.ChildUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mother = _get_owned(mother_id, current_user, db)
    child = _get_owned_child(mother, child_id, db)
    _apply_child(child, data)
    _replace_conditions(child, data.birth_conditions, db)
    db.commit()
    db.refresh(child)
    return child
