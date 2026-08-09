"""Admin Database → Raw Data: generate pipeline raw inputs from NurtureHUB's
own collected data and ingest them into the pipeline input stores.

PipelineError is translated to a JSON response by the app-level handler in
main.py, exactly like the pipelines router.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin
from app.pipeline_service import CROSSTABS, MASD
from app.rawdata import service

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
def generate(pipeline: str, project: Optional[str] = Query(None), db: Session = Depends(get_db)):
    return service.generate_set(db, _pipeline(pipeline), project)


@router.get("/{pipeline}/file")
def download(pipeline: str, path: str = Query(...), project: Optional[str] = Query(None)):
    file_path = service.set_file_path(_pipeline(pipeline), project, path)
    return FileResponse(file_path, filename=file_path.name, media_type="text/csv")


@router.post("/{pipeline}/ingest")
def ingest(pipeline: str, project: Optional[str] = Query(None), db: Session = Depends(get_db)):
    return service.ingest_set(_pipeline(pipeline), project, db)
