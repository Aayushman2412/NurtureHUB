"""Admin Database → Raw Data: generate pipeline raw inputs from NurtureHUB's
own collected data and ingest them into the pipeline input stores.

PipelineError is translated to a JSON response by the app-level handler in
main.py, exactly like the pipelines router.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_admin_email, get_current_admin
from app.pipeline_service import CROSSTABS, MASD
from app.rate_limit import limiter, principal_key
from app.rawdata import service
from app.security import phi

router = APIRouter(
    prefix="/api/admin/rawdata",
    tags=["admin-rawdata"],
    dependencies=[Depends(get_current_admin)],
)


def _pipeline(value: str) -> str:
    if value not in (CROSSTABS, MASD):
        raise HTTPException(status_code=404, detail="Unknown pipeline")
    return value


@router.get("/{pipeline}")
def current_set(pipeline: str, project: Optional[str] = Query(None)):
    return service.list_set(_pipeline(pipeline), project)


@router.post("/{pipeline}/generate")
# Keyed by the signed-in ACCOUNT, not the source address, so a shared
# office connection is many buckets and a legitimate cohort is unaffected -
# while one stolen token cannot pull the database at machine speed. An
# export is the moment data leaves this system's custody (SECURITY.md).
@limiter.limit(lambda: settings.RATE_LIMIT_EXPORT, key_func=principal_key)
def generate(
    request: Request,
    pipeline: str,
    project: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    """Materialise the pipeline's raw inputs from real collected records.

    This is the largest single movement of patient-derived data in the platform:
    it walks every mother, child and assessment in scope and writes them to CSV
    on the server's disk. Recorded as an export because that is what it is —
    from here the data is in files, and custody follows the files.
    """
    result = service.generate_set(db, _pipeline(pipeline), project)
    phi.log_export(
        resource_type="rawdata_set",
        record_count=int(result.get("total_rows") or result.get("rows") or 0),
        fmt="csv",
        db=db,
        detail={
            "pipeline": pipeline,
            "project": project,
            "generated_by": admin_email,
            "files": [f.get("name") for f in (result.get("files") or [])][:50],
            "custody_note": "written to the pipeline data volume on the application server",
        },
    )
    db.commit()
    return result


@router.get("/{pipeline}/file")
@limiter.limit(lambda: settings.RATE_LIMIT_EXPORT, key_func=principal_key)
def download(
    request: Request,
    pipeline: str,
    path: str = Query(...),
    project: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    file_path = service.set_file_path(_pipeline(pipeline), project, path)
    phi.log_export(
        resource_type="rawdata_file",
        record_count=0,
        fmt="csv",
        db=db,
        detail={
            "pipeline": pipeline, "project": project, "file": file_path.name,
            "downloaded_by": admin_email,
            "custody_note": "the downloaded copy leaves this system's custody",
        },
    )
    db.commit()
    return FileResponse(file_path, filename=file_path.name, media_type="text/csv")


@router.post("/{pipeline}/ingest")
def ingest(pipeline: str, project: Optional[str] = Query(None), db: Session = Depends(get_db)):
    return service.ingest_set(_pipeline(pipeline), project, db)
