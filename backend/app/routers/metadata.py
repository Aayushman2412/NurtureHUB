from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app import models, schemas

router = APIRouter(prefix="/api/metadata", tags=["metadata"])

@router.get("/states", response_model=List[schemas.StateOut])
def get_states(db: Session = Depends(get_db)):
    return db.query(models.State).filter(models.State.is_active == True).all()

@router.get("/districts", response_model=List[schemas.DistrictOut])
def get_districts(state_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    query = db.query(models.District)
    if state_id is not None:
        query = query.filter(models.District.state_id == state_id)
    return query.all()

@router.get("/blocks", response_model=List[schemas.BlockOut])
def get_blocks(district_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    query = db.query(models.Block)
    if district_id is not None:
        query = query.filter(models.Block.district_id == district_id)
    return query.all()

@router.get("/villages", response_model=List[schemas.VillageOut])
def get_villages(block_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    query = db.query(models.Village)
    if block_id is not None:
        query = query.filter(models.Village.block_id == block_id)
    return query.all()

@router.get("/facilities", response_model=List[schemas.FacilityOut])
def get_facilities(block_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    query = db.query(models.Facility)
    if block_id is not None:
        query = query.filter(models.Facility.block_id == block_id)
    return query.all()

@router.get("/qualifications", response_model=List[schemas.EducationalQualificationOut])
def get_qualifications(department_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    query = db.query(models.EducationalQualification)
    if department_id is not None:
        query = query.filter(models.EducationalQualification.department_id == department_id)
    return query.order_by(models.EducationalQualification.order_index).all()

@router.get("/experience-ranges", response_model=List[schemas.ExperienceRangeOut])
def get_experience_ranges(db: Session = Depends(get_db)):
    return db.query(models.ExperienceRange).order_by(models.ExperienceRange.order_index).all()


# ── Learner Registration professional-axis cascades ──

@router.get("/departments", response_model=List[schemas.DepartmentOut])
def get_departments(db: Session = Depends(get_db)):
    return db.query(models.Department).order_by(models.Department.order_index).all()

@router.get("/designations", response_model=List[schemas.DesignationOut])
def get_designations(department_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    query = db.query(models.Designation)
    if department_id is not None:
        query = query.filter(models.Designation.department_id == department_id)
    return query.order_by(models.Designation.order_index).all()

@router.get("/facility-types", response_model=List[schemas.FacilityTypeOut])
def get_facility_types(designation_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    # Filtered by designation → return only its mapped facility types. If the designation
    # has no mapping (empty), fall back to the full list. No filter → full list.
    if designation_id is not None:
        designation = db.query(models.Designation).filter(models.Designation.id == designation_id).first()
        if designation is not None and designation.facility_types:
            return sorted(designation.facility_types, key=lambda ft: ft.order_index)
    return db.query(models.FacilityType).order_by(models.FacilityType.order_index).all()
