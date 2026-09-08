import uuid
from datetime import timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app import models, schemas
from app.dependencies import get_current_user, require_phi_access
from app.security import consent, phi
from app.security.crypto import phone_index

# Every route here returns or writes identified maternal and child health data,
# so the whole router sits behind the emergency freeze (see
# dependencies.require_phi_access) and every handler records what it touched.
router = APIRouter(
    prefix="/api/mothers",
    tags=["mothers"],
    dependencies=[Depends(require_phi_access)],
)


def _apply(mother: models.Mother, data: schemas.MotherBase) -> None:
    """Copy scalar fields onto the ORM object and derive edd_lmp from LMP."""
    for key, value in data.model_dump(exclude={"source_ratings"}).items():
        setattr(mother, key, value)
    mother.edd_lmp = (mother.lmp + timedelta(days=280)) if mother.lmp else None


def _changed_fields(target, data) -> List[str]:
    """Field names whose value the update actually changes.

    Recorded in the audit row so a later correction dispute — "her due date was
    changed, by whom" — is answerable without storing either value.
    """
    changed = []
    for key, value in data.model_dump(exclude={"source_ratings"}).items():
        if getattr(target, key, None) != value:
            changed.append(key)
    return changed


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
        # The 404 is deliberate — a 403 would confirm the record exists to
        # someone walking ids. The audit trail records the true reason, which is
        # what the denied-access-burst rule watches for.
        exists = db.query(models.Mother.id).filter(models.Mother.id == mother_id).first() is not None
        phi.log_denied(
            resource_type="mother",
            resource_id=mother_id,
            subject_type=phi.MOTHER,
            subject_id=mother_id,
            reason="not_owner" if exists else "no_such_record",
        )
        raise HTTPException(status_code=404, detail="Mother not found")
    return mother


def _list_item(m: models.Mother) -> schemas.MotherListItem:
    return schemas.MotherListItem(
        id=m.id,
        mother_uid=m.mother_uid,
        mother_name=m.mother_name,
        mother_age=m.mother_age,
        mobile=m.mobile,
        village=m.village,
        adoption_date=m.adoption_date,
        hwc_name=m.hwc.name if m.hwc else m.hwc_other,
        edd_records=m.edd_records,
        gestational_weeks=m.gestational_weeks,
        children_count=len(m.children),
        created_at=m.created_at,
    )


@router.post("", response_model=schemas.MotherOut)
def create_mother(
    data: schemas.MotherCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Idempotent replay for the offline sync queue: same client_ref -> the
    # already-created mother, never a duplicate registration.
    if data.client_ref:
        existing = (
            db.query(models.Mother)
            .filter(models.Mother.client_ref == data.client_ref)
            .first()
        )
        if existing:
            if existing.registered_by_user_id != current_user.id:
                raise HTTPException(status_code=409, detail="client_ref already used")
            return existing

    mother = models.Mother(
        mother_uid=f"MR-{uuid.uuid4().hex[:10].upper()}",
        registered_by_user_id=current_user.id,
        client_ref=data.client_ref,
    )
    _apply(mother, data)
    mother.sync_lookups()
    db.add(mother)
    db.flush()
    _replace_ratings(mother, data.source_ratings, db)

    # Registration is where consent is taken, in person, by the health worker.
    # Recording it here rather than in a separate step means the lawful basis
    # exists from the moment the record does — a consent captured afterwards is
    # not consent for the collection that already happened.
    consent.grant_defaults(
        db,
        subject_type=phi.MOTHER,
        subject_id=mother.id,
        captured_by_user_id=current_user.id,
        given_by=mother.mother_name,
        given_by_relationship="self",
        verification_method="in_person",
        commit=False,
    )
    db.commit()
    db.refresh(mother)
    phi.log_create(
        resource_type="mother",
        resource_id=mother.id,
        subject_type=phi.MOTHER,
        subject_id=mother.id,
        detail={"mother_uid": mother.mother_uid, "offline_replay": bool(data.client_ref)},
    )
    return mother


@router.get("/lookup", response_model=List[schemas.MotherListItem])
def lookup_by_mobile(
    mobile: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Find one of *your own* registrations by mobile number.

    The number itself is not stored — the query is against a keyed one-way index
    (app/security/crypto.py:blind_index), so this works without the database
    holding a searchable phone number. Scoped to the caller's registrations for
    the same reason every other route here is: a health worker looking up an
    arbitrary number would be a directory of the district's mothers.
    """
    token = phone_index(mobile, "mother.mobile")
    if not token:
        # No index key configured (development), or an unusable number.
        return []
    mothers = (
        db.query(models.Mother)
        .options(joinedload(models.Mother.hwc), selectinload(models.Mother.children))
        .filter(
            models.Mother.mobile_lookup == token,
            models.Mother.registered_by_user_id == current_user.id,
        )
        .limit(20)
        .all()
    )
    phi.log_list(
        resource_type="mother",
        count=len(mothers),
        subject_type=phi.MOTHER,
        subject_ids=[m.id for m in mothers],
        detail={"query": "mobile_blind_index"},
    )
    return [_list_item(m) for m in mothers]


@router.get("", response_model=List[schemas.MotherListItem])
def list_mothers(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mothers = (
        db.query(models.Mother)
        .options(joinedload(models.Mother.hwc), selectinload(models.Mother.children))
        .filter(models.Mother.registered_by_user_id == current_user.id)
        .order_by(models.Mother.created_at.desc())
        .all()
    )
    phi.log_list(
        resource_type="mother",
        count=len(mothers),
        subject_type=phi.MOTHER,
        subject_ids=[m.id for m in mothers],
        detail={"scope": "own_registrations"},
    )
    return [_list_item(m) for m in mothers]


@router.get("/{mother_id}", response_model=schemas.MotherOut)
def get_mother(
    mother_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mother = _get_owned(mother_id, current_user, db)
    phi.log_read(
        resource_type="mother",
        resource_id=mother.id,
        subject_type=phi.MOTHER,
        subject_id=mother.id,
        fields=["mother_name", "mobile", "alternate_mobile", "email", "mother_dob", "lmp"],
    )
    return mother


@router.put("/{mother_id}", response_model=schemas.MotherOut)
def update_mother(
    mother_id: int,
    data: schemas.MotherUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mother = _get_owned(mother_id, current_user, db)
    changed = _changed_fields(mother, data)
    _apply(mother, data)
    mother.sync_lookups()
    _replace_ratings(mother, data.source_ratings, db)
    db.commit()
    db.refresh(mother)
    phi.log_update(
        resource_type="mother",
        resource_id=mother.id,
        subject_type=phi.MOTHER,
        subject_id=mother.id,
        changed_fields=changed,
    )
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
        phi.log_denied(
            resource_type="child",
            resource_id=child_id,
            subject_type=phi.CHILD,
            subject_id=child_id,
            reason="not_under_this_mother",
        )
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
    # Idempotent replay for the offline sync queue (see create_mother).
    if data.client_ref:
        existing = (
            db.query(models.Child)
            .filter(models.Child.client_ref == data.client_ref)
            .first()
        )
        if existing:
            if existing.mother_id != mother.id:
                raise HTTPException(status_code=409, detail="client_ref already used")
            return existing

    child = models.Child(
        child_uid=f"CR-{uuid.uuid4().hex[:10].upper()}",
        mother_id=mother.id,
        client_ref=data.client_ref,
    )
    _apply_child(child, data)
    db.add(child)
    db.flush()
    _replace_conditions(child, data.birth_conditions, db)

    # DPDP s.9: a child's data may be processed only with verifiable consent of a
    # parent or lawful guardian. The mother gave that consent in person at
    # registration; it is recorded here against the child, with the relationship
    # and the verification method, because s.9 makes the verification itself the
    # obligation rather than just the consent.
    consent.grant_defaults(
        db,
        subject_type=phi.CHILD,
        subject_id=child.id,
        captured_by_user_id=current_user.id,
        given_by=mother.mother_name,
        given_by_relationship="mother",
        is_guardian_consent=True,
        verification_method="in_person",
        commit=False,
    )
    db.commit()
    db.refresh(child)
    phi.log_create(
        resource_type="child",
        resource_id=child.id,
        subject_type=phi.CHILD,
        subject_id=child.id,
        detail={"child_uid": child.child_uid, "mother_id": mother.id,
                "guardian_consent": True, "offline_replay": bool(data.client_ref)},
    )
    return child


@router.get("/{mother_id}/children", response_model=List[schemas.ChildListItem])
def list_children(
    mother_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mother = _get_owned(mother_id, current_user, db)
    children = (
        db.query(models.Child)
        .filter(models.Child.mother_id == mother.id)
        .order_by(models.Child.created_at.desc())
        .all()
    )
    phi.log_list(
        resource_type="child",
        count=len(children),
        subject_type=phi.CHILD,
        subject_ids=[c.id for c in children],
        detail={"mother_id": mother.id},
    )
    return children


@router.get("/{mother_id}/children/{child_id}", response_model=schemas.ChildOut)
def get_child(
    mother_id: int,
    child_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mother = _get_owned(mother_id, current_user, db)
    child = _get_owned_child(mother, child_id, db)
    phi.log_read(
        resource_type="child",
        resource_id=child.id,
        subject_type=phi.CHILD,
        subject_id=child.id,
        fields=["child_name", "dob", "birth_weight", "birth_length", "birth_conditions"],
        detail={"mother_id": mother.id},
    )
    return child


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
    changed = [
        key for key, value in data.model_dump(exclude={"birth_conditions"}).items()
        if getattr(child, key, None) != value
    ]
    _apply_child(child, data)
    _replace_conditions(child, data.birth_conditions, db)
    db.commit()
    db.refresh(child)
    phi.log_update(
        resource_type="child",
        resource_id=child.id,
        subject_type=phi.CHILD,
        subject_id=child.id,
        changed_fields=changed,
        detail={"mother_id": mother.id},
    )
    return child
