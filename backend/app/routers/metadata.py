from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_read_db
from app import models, schemas

# Reference/metadata data is seeded once and only read at runtime, so these
# endpoints route to the read replica when one is configured (get_read_db falls
# back to the primary otherwise). No read-after-write concerns here.
router = APIRouter(prefix="/api/metadata", tags=["metadata"])


@router.get("/programme")
def programme_constants():
    """Programme-wide constants the app's screens share (no personal data):
    the age splitting PNC adoptions into under / from N months."""
    from app.masd import rules as R
    return {"pnc_split_days": R.FIVE_MONTHS_DAYS, "pnc_split_months": R.PNC_SPLIT_MONTHS}


@router.get("/registration-scope")
def registration_scope(project: str = Query("", description="Slug from a project's sign-up link"),
                       db: Session = Depends(get_read_db)):
    """Which state / district the learner registration form may offer
    (review of 17 Oct 2026) — see app/registration.py."""
    from app import registration
    return registration.scope(db, project or None)


def _registration_ids(db: Session, registration: bool, project: str, key: str):
    if not registration and not project:
        return None
    from app import registration as reg
    return reg.scope(db, project or None)[key]


@router.get("/states", response_model=List[schemas.StateOut])
def get_states(registration: bool = Query(False, description="Only states open for registration"),
               project: str = Query(""), db: Session = Depends(get_read_db)):
    query = db.query(models.State).filter(models.State.is_active == True)
    allowed = _registration_ids(db, registration, project, "state_ids")
    if allowed is not None:
        query = query.filter(models.State.id.in_(allowed))
    return query.order_by(models.State.id).all()

@router.get("/districts", response_model=List[schemas.DistrictOut])
def get_districts(state_id: Optional[int] = Query(None),
                  registration: bool = Query(False, description="Only districts open for registration"),
                  project: str = Query(""), db: Session = Depends(get_read_db)):
    query = db.query(models.District)
    if state_id is not None:
        query = query.filter(models.District.state_id == state_id)
    allowed = _registration_ids(db, registration, project, "district_ids")
    if allowed is not None:
        query = query.filter(models.District.id.in_(allowed))
    return query.order_by(models.District.name).all()

@router.get("/blocks", response_model=List[schemas.BlockOut])
def get_blocks(district_id: Optional[int] = Query(None), db: Session = Depends(get_read_db)):
    query = db.query(models.Block)
    if district_id is not None:
        query = query.filter(models.Block.district_id == district_id)
    return query.order_by(models.Block.subdivision, models.Block.name).all()

@router.get("/gram-panchayats", response_model=List[schemas.GramPanchayatOut])
def get_gram_panchayats(block_id: int = Query(...), db: Session = Depends(get_read_db)):
    """A taluka's gram panchayats, as the district publishes them."""
    return (db.query(models.GramPanchayat).filter(models.GramPanchayat.block_id == block_id)
            .order_by(models.GramPanchayat.name).all())

@router.get("/villages", response_model=List[schemas.VillageOut])
def get_villages(block_id: Optional[int] = Query(None), db: Session = Depends(get_read_db)):
    query = db.query(models.Village)
    if block_id is not None:
        query = query.filter(models.Village.block_id == block_id)
    return query.all()

@router.get("/facilities", response_model=List[schemas.FacilityOut])
def get_facilities(block_id: Optional[int] = Query(None), db: Session = Depends(get_read_db)):
    query = db.query(models.Facility)
    if block_id is not None:
        query = query.filter(models.Facility.block_id == block_id)
    return query.all()

@router.get("/qualifications", response_model=List[schemas.EducationalQualificationOut])
def get_qualifications(department_id: Optional[int] = Query(None), db: Session = Depends(get_read_db)):
    query = db.query(models.EducationalQualification)
    if department_id is not None:
        query = query.filter(models.EducationalQualification.department_id == department_id)
    return query.order_by(models.EducationalQualification.order_index).all()

@router.get("/experience-ranges", response_model=List[schemas.ExperienceRangeOut])
def get_experience_ranges(db: Session = Depends(get_read_db)):
    return db.query(models.ExperienceRange).order_by(models.ExperienceRange.order_index).all()


# ── Learner Registration professional-axis cascades ──

@router.get("/departments", response_model=List[schemas.DepartmentOut])
def get_departments(db: Session = Depends(get_read_db)):
    return db.query(models.Department).order_by(models.Department.order_index).all()

@router.get("/designations", response_model=List[schemas.DesignationOut])
def get_designations(department_id: Optional[int] = Query(None), db: Session = Depends(get_read_db)):
    query = db.query(models.Designation)
    if department_id is not None:
        query = query.filter(models.Designation.department_id == department_id)
    return query.order_by(models.Designation.order_index).all()

@router.get("/facility-types", response_model=List[schemas.FacilityTypeOut])
def get_facility_types(designation_id: Optional[int] = Query(None),
                       department_id: Optional[int] = Query(None),
                       db: Session = Depends(get_read_db)):
    # Filtered by designation → its mapped facility types; a designation with no
    # mapping ("Other (Specify)", Counsellor …) falls back to every type. Either
    # way only the department's own types (review of 17 Oct 2026: an Anganwadi
    # Centre or an ICDS office is never offered to Health staff, a PHC or a
    # health office never to WCD staff); "Other (Specify)" belongs to all.
    types = db.query(models.FacilityType).order_by(models.FacilityType.order_index).all()
    if designation_id is not None:
        designation = db.query(models.Designation).filter(models.Designation.id == designation_id).first()
        if designation is not None:
            department_id = department_id or designation.department_id
            if designation.facility_types:
                mapped = {ft.id for ft in designation.facility_types}
                types = [ft for ft in types if ft.id in mapped]
    if department_id is not None:
        dept = db.get(models.Department, department_id)
        if dept is not None and dept.code in ("HFW", "WCD"):
            types = [ft for ft in types if ft.department_id in (None, dept.id)]
    return types


# ── Mother Registration cascades ──

@router.get("/education-levels", response_model=List[schemas.MotherEducationLevelOut])
def get_education_levels(db: Session = Depends(get_read_db)):
    return db.query(models.MotherEducationLevel).order_by(models.MotherEducationLevel.order_index).all()

@router.get("/education-fields", response_model=List[schemas.EducationFieldOut])
def get_education_fields(db: Session = Depends(get_read_db)):
    return db.query(models.EducationField).order_by(models.EducationField.order_index).all()

@router.get("/education-degrees", response_model=List[schemas.EducationDegreeOut])
def get_education_degrees(field_id: Optional[int] = Query(None), db: Session = Depends(get_read_db)):
    query = db.query(models.EducationDegree)
    if field_id is not None:
        query = query.filter(models.EducationDegree.field_id == field_id)
    return query.order_by(models.EducationDegree.order_index).all()

@router.get("/hwcs", response_model=List[schemas.HWCOut])
def get_hwcs(block_id: Optional[int] = Query(None), db: Session = Depends(get_read_db)):
    query = db.query(models.HWC)
    if block_id is not None:  # block == taluk
        query = query.filter(models.HWC.block_id == block_id)
    return query.order_by(models.HWC.name).all()

@router.get("/phcs", response_model=List[schemas.PHCOut])
def get_phcs(
    hwc_id: Optional[int] = Query(None),
    block_id: Optional[int] = Query(None),
    db: Session = Depends(get_read_db),
):
    # An HWC maps to exactly one PHC → return that one (auto-populate). Else list by taluk.
    if hwc_id is not None:
        hwc = db.query(models.HWC).filter(models.HWC.id == hwc_id).first()
        return [hwc.phc] if hwc and hwc.phc else []
    query = db.query(models.PHC)
    if block_id is not None:
        query = query.filter(models.PHC.block_id == block_id)
    return query.order_by(models.PHC.name).all()
