"""Admin endpoints for the data-analytics pipelines ("Database" section).

Everything lives under /api/admin/pipelines/* (the admin token contract) and
is guarded router-wide. File payloads never leave the pipeline data root, and
paths are confined server-side (see pipeline_service._safe_join).
"""
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.database import get_db
from app.dependencies import get_admin_email, get_current_admin
from app import pipeline_service as svc
from app.models import PipelineRun

router = APIRouter(
    prefix="/api/admin/pipelines",
    tags=["admin-pipelines"],
    dependencies=[Depends(get_current_admin)],
)


# ------------------------------------------------------------------ overview

@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    # Pick up admin-created projects (incl. districts inside a state).
    svc.refresh_projects(db)
    return {
        "crosstabs": {
            "projects": [
                {"code": code, "name": name, "analysis_level": svc.analysis_level_for(code)}
                for code, name in svc.CROSSTABS_PROJECTS.items()
            ],
        },
        "masd": {
            "kinds": [
                {"kind": "combined", "label": "Combined MASD script"},
                {"kind": "raw_exclusion", "label": "Raw + exclusion script"},
            ],
        },
    }


# ------------------------------------------------------------------- inputs

def _input_scope(pipeline: str, project: Optional[str]):
    if pipeline == svc.CROSSTABS and not project:
        raise svc.PipelineError("A project is required for crosstabs inputs", 400)
    return project


@router.get("/crosstabs/{project}/inputs")
def crosstabs_inputs(project: str):
    return {
        "files": svc.list_input_files(svc.CROSSTABS, project),
        "kinds": svc.input_kinds(svc.CROSSTABS, project),
        "status": svc.crosstabs_input_status(project),
        "default_raw_subdir": svc.default_raw_subdir(project),
    }


@router.get("/masd/inputs")
def masd_inputs():
    return {
        "files": svc.list_input_files(svc.MASD),
        "kinds": svc.input_kinds(svc.MASD),
        "status": svc.masd_input_status(),
    }


# These handlers are deliberately sync (`def`, not `async def`): they do
# blocking disk I/O, so FastAPI runs them in a worker thread instead of
# stalling the event loop for every other request.
@router.post("/crosstabs/{project}/inputs")
def upload_crosstabs_inputs(
    project: str,
    files: list[UploadFile] = File(...),
    subdir: Optional[str] = Form(None),
    kind: Optional[str] = Form(None),
):
    saved = [svc.save_input_file(svc.CROSSTABS, project, f.filename or "file", f.file,
                                 subdir, kind)
             for f in files]
    return {"saved": saved}


@router.post("/masd/inputs")
def upload_masd_inputs(
    files: list[UploadFile] = File(...),
    kind: Optional[str] = Form(None),
):
    saved = [svc.save_input_file(svc.MASD, None, f.filename or "file", f.file, None, kind)
             for f in files]
    return {"saved": saved}


def _extract_zip_upload(pipeline: str, project: Optional[str],
                        file: UploadFile, subdir: Optional[str]):
    if not (file.filename or "").lower().endswith(".zip"):
        raise svc.PipelineError("Upload a .zip archive", 400)
    tmp_dir = svc.data_root() / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(suffix=".zip", prefix="pipeline_inputs_", dir=str(tmp_dir))
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        svc._write_stream(file.file, tmp, svc.MAX_INPUT_ZIP_MB)
        extracted = svc.extract_input_zip(pipeline, project, tmp, subdir)
    finally:
        tmp.unlink(missing_ok=True)
    return {"extracted": extracted}


@router.post("/crosstabs/{project}/inputs/zip")
def upload_crosstabs_inputs_zip(
    project: str,
    file: UploadFile = File(...),
    subdir: Optional[str] = Form(None),
):
    return _extract_zip_upload(svc.CROSSTABS, project, file, subdir)


@router.post("/masd/inputs/zip")
def upload_masd_inputs_zip(file: UploadFile = File(...)):
    return _extract_zip_upload(svc.MASD, None, file, None)


@router.delete("/crosstabs/{project}/inputs")
def delete_crosstabs_input(project: str, path: str = Query(...)):
    svc.delete_input_path(svc.CROSSTABS, project, path)
    return {"deleted": path}


@router.delete("/masd/inputs")
def delete_masd_input(path: str = Query(...)):
    svc.delete_input_path(svc.MASD, None, path)
    return {"deleted": path}


@router.delete("/crosstabs/{project}/inputs/group/{group}")
def delete_crosstabs_input_group(project: str, group: str):
    return {"deleted": svc.delete_input_group(svc.CROSSTABS, project, group)}


@router.delete("/masd/inputs/group/{group}")
def delete_masd_input_group(group: str):
    return {"deleted": svc.delete_input_group(svc.MASD, None, group)}


# -------------------------------------------------------------------- runs

class MasdRunRequest(BaseModel):
    kind: str


@router.post("/crosstabs/{project}/runs")
def trigger_crosstabs_run(
    project: str,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    run = svc.start_run(db, svc.CROSSTABS, project, admin_email)
    return svc.run_to_dict(run)


@router.post("/masd/runs")
def trigger_masd_run(
    payload: MasdRunRequest,
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    run = svc.start_run(db, svc.MASD, payload.kind, admin_email)
    return svc.run_to_dict(run)


def _get_run(db: Session, run_id: int) -> PipelineRun:
    run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
    if not run:
        raise svc.PipelineError("Run not found", 404)
    return run


@router.get("/runs")
def list_runs(
    pipeline: str = Query(...),
    variant: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(PipelineRun).filter(PipelineRun.pipeline == pipeline)
    if variant:
        query = query.filter(PipelineRun.variant == variant)
    runs = query.order_by(PipelineRun.id.desc()).limit(limit).all()
    return {"runs": [svc.run_to_dict(r) for r in runs]}


@router.get("/runs/{run_id}")
def run_detail(run_id: int, db: Session = Depends(get_db)):
    run = _get_run(db, run_id)
    return svc.run_to_dict(run, include_manifest=True)


@router.get("/runs/{run_id}/log", response_class=PlainTextResponse)
def run_log(
    run_id: int,
    file: str = Query("console"),
    tail_kb: int = Query(256, ge=1, le=4096),
    db: Session = Depends(get_db),
):
    run = _get_run(db, run_id)
    names = {"console": "console.log", "pipeline": "pipeline.log", "report": "pipeline_report.txt"}
    if file not in names:
        raise svc.PipelineError("file must be one of: console, pipeline, report", 400)
    path = svc.run_dir_abs(run) / names[file]
    if not path.exists():
        return ""
    size = path.stat().st_size
    limit = tail_kb * 1024
    with open(path, "rb") as fp:
        if size > limit:
            fp.seek(size - limit)
        data = fp.read()
    text = data.decode("utf-8", errors="replace")
    if size > limit:
        text = "... (truncated, showing the last %d KB)\n" % tail_kb + text
    return text


@router.delete("/runs/{run_id}")
def remove_run(run_id: int, db: Session = Depends(get_db)):
    run = _get_run(db, run_id)
    svc.delete_run(db, run)
    return {"deleted": run_id}


@router.get("/runs/{run_id}/file")
def download_run_file(run_id: int, path: str = Query(...), db: Session = Depends(get_db)):
    run = _get_run(db, run_id)
    file_path = svc.run_file(run, path)
    return FileResponse(
        file_path,
        filename=file_path.name,
        media_type="application/octet-stream",
    )


class ZipRequest(BaseModel):
    paths: Optional[list[str]] = None
    section: Optional[str] = None


@router.post("/runs/{run_id}/zip")
def download_run_zip(run_id: int, payload: ZipRequest, db: Session = Depends(get_db)):
    run = _get_run(db, run_id)
    tmp, filename = svc.build_run_zip(run, paths=payload.paths, section=payload.section)
    return FileResponse(
        tmp,
        filename=filename,
        media_type="application/zip",
        background=BackgroundTask(lambda: tmp.unlink(missing_ok=True)),
    )


# ------------------------------------------------------------------ scripts

@router.get("/scripts/{pipeline}")
def list_scripts(pipeline: str, db: Session = Depends(get_db)):
    return {"slots": svc.list_scripts(db, pipeline)}


@router.post("/scripts/{pipeline}/{slot}")
def upload_script(
    pipeline: str,
    slot: str,
    file: UploadFile = File(...),
    notes: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    admin_email: str = Depends(get_admin_email),
):
    script = svc.upload_script(db, pipeline, slot, file.filename or "script",
                               file.file, notes, admin_email)
    return {"slot": slot, "version": script.version, "original_name": script.original_name}


class ActivateRequest(BaseModel):
    version: Optional[int] = None  # None = revert to the vendored default


@router.post("/scripts/{pipeline}/{slot}/activate")
def activate_script(pipeline: str, slot: str, payload: ActivateRequest,
                    db: Session = Depends(get_db)):
    svc.set_active_script(db, pipeline, slot, payload.version)
    return {"slot": slot, "active_version": payload.version}


@router.post("/scripts/{pipeline}/{slot}/{version}/deactivate")
def deactivate_script(pipeline: str, slot: str, version: int,
                      db: Session = Depends(get_db)):
    svc.deactivate_script(db, pipeline, slot, version)
    return {"slot": slot, "version": version, "is_active": False}


@router.get("/scripts/{pipeline}/{slot}/file")
def download_script(pipeline: str, slot: str,
                    version: Optional[int] = Query(None),
                    db: Session = Depends(get_db)):
    path, name = svc.script_file_path(db, pipeline, slot, version)
    return FileResponse(path, filename=name, media_type="application/octet-stream")


@router.delete("/scripts/{pipeline}/{slot}/{version}")
def delete_script(pipeline: str, slot: str, version: int, db: Session = Depends(get_db)):
    svc.delete_script(db, pipeline, slot, version)
    return {"deleted": version}
