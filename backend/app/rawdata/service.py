"""Raw-data set storage + one-click ingest into the pipeline input stores.

A "set" is the latest generated bundle for a target (crosstabs project or
MASD). Generating again replaces the previous set; ingesting copies the files
into the same locations a manual admin upload would use, after which the
pipeline runs exactly as if the admin had uploaded the files by hand.
"""
from __future__ import annotations

import csv
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app import pipeline_service, projects
from app.config import settings
from app.pipeline_service import (
    CROSSTABS, CROSSTABS_PROJECTS, MASD, PipelineError, data_root, ensure_inputs,
)

from .common import Dataset, load_dataset
from . import (
    gen_antenatal, gen_bf, gen_case_measurements, gen_case_report, gen_cf,
    gen_child, gen_growth, gen_masd, gen_mother, gen_protein,
)

# State-code prefix per crosstabs project (matches the legacy file naming).
_STATE_PREFIX = {"UJ": "MP", "JL": "MH", "ML": "ML"}

# Generation order mirrors the legacy export; MCJ files carry no time suffix.
_CROSSTABS_GENS = [
    (gen_antenatal, True), (gen_bf, True), (gen_cf, True), (gen_growth, True),
    (gen_child, True), (gen_case_measurements, False), (gen_case_report, False),
    (gen_protein, True), (gen_mother, True),
]

# MASD per-program-district file prefixes ("<Code> <District>_...").
_MASD_CODES = {"Ujjain": "MP", "Jalna": "MH", "Meghalaya": "ML"}


def mock_enabled() -> bool:
    return bool(settings.RAW_EXPORT_MOCK)


def _sets_root() -> Path:
    return data_root() / "raw_export"


def _set_dir(pipeline: str, project: Optional[str]) -> Path:
    if pipeline == CROSSTABS:
        return _sets_root() / "crosstabs" / (project or "UJ").upper()
    return _sets_root() / "masd"


def _dataset(db: Session, district: str, project_code: str) -> Dataset:
    if mock_enabled():
        from .mock import mock_dataset
        return mock_dataset(district, project_code)
    return load_dataset(db, district, project_code)


def _write_csv(path: Path, header: list[str], rows: list[list[str]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerows(rows)
    return len(rows)


def generate_set(db: Session, pipeline: str, project: Optional[str]) -> dict:
    """Build the raw files for a target, replacing its previous set."""
    now = datetime.now()
    target = _set_dir(pipeline, project)
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)

    manifest = []
    if pipeline == CROSSTABS:
        code = (project or "UJ").upper()
        pipeline_service.refresh_projects(db)
        proj = projects.by_code(db, code)
        district = proj.name if proj else CROSSTABS_PROJECTS.get(code)
        if not district:
            raise PipelineError(f"Unknown crosstabs project '{project}'", 404)

        stamp_time = now.strftime("%Y-%m-%d-%H%M%S")
        stamp_date = now.strftime("%Y-%m-%d")
        ddmm = now.strftime("%d%m")

        # A STATE project produces a full 9-file set PER CHILD DISTRICT (each
        # district is its own project for analysis); a district project
        # produces one set for itself.
        if proj is not None:
            units = projects.analysis_units(db, proj)
        else:
            units = []
        if not units:
            units = [proj] if proj else []

        for unit in units or [None]:
            unit_name = unit.name if unit is not None else district
            unit_code = projects.project_code(unit) if unit is not None else code
            prefix = (projects.state_prefix(unit, db) if unit is not None
                      else _STATE_PREFIX.get(code, "MP"))
            ds = _dataset(db, unit_name, unit_code)
            folder = target / f"input_folder_{ddmm}(CUD)_{ddmm}(DD)_{unit_name}"
            for mod, with_time in _CROSSTABS_GENS:
                stamp = stamp_time if with_time else stamp_date
                name = f"{prefix}_{unit_name}_{mod.FILE_STEM}_{stamp}.csv"
                count = _write_csv(folder / name, mod.HEADER, mod.generate(ds))
                manifest.append({"name": name, "rows": count})
    else:
        stamp = now.strftime("%b-%d-%Y")
        for program, code in _MASD_CODES.items():
            if mock_enabled():
                # One file per geo district, with that district's real
                # location-master block names (unmatchable names would leave
                # the colour-coding stage with zero rows per block).
                from .mock import MASD_GEO, mock_dataset
                for geo_district, locations in MASD_GEO.get(program, [(program, None)]):
                    ds = mock_dataset(geo_district, code, locations)
                    name = f"{code} {geo_district}_{stamp}_MASD.csv"
                    count = _write_csv(target / name, gen_masd.HEADER, gen_masd.generate(ds))
                    manifest.append({"name": name, "rows": count})
                continue
            ds = _dataset(db, program, code)
            if not ds.learners:
                continue
            # Real data: split the program's learners by their geo district
            # (Meghalaya is one program but MASD files are per district).
            by_geo: dict[str, list] = {}
            for u in ds.learners:
                geo = ds.district_names.get(getattr(u, "district_id", None) or 0) or program
                by_geo.setdefault(geo, []).append(u)
            for geo_district, learners in sorted(by_geo.items()):
                sub = Dataset(**{**ds.__dict__, "district": geo_district, "learners": learners})
                name = f"{code} {geo_district}_{stamp}_MASD.csv"
                count = _write_csv(target / name, gen_masd.HEADER, gen_masd.generate(sub))
                manifest.append({"name": name, "rows": count})

    return list_set(pipeline, project)


def list_set(pipeline: str, project: Optional[str]) -> dict:
    """The current set's files (empty when nothing generated yet)."""
    target = _set_dir(pipeline, project)
    files = []
    if target.exists():
        for path in sorted(target.rglob("*.csv")):
            with open(path, encoding="utf-8-sig", newline="") as fh:
                rows = max(0, sum(1 for _ in fh) - 1)
            files.append({
                "name": path.name,
                "path": str(path.relative_to(target)).replace("\\", "/"),
                "rows": rows,
                "size": path.stat().st_size,
                "modified": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
            })
    return {"pipeline": pipeline, "project": (project or "").upper() or None,
            "mock": mock_enabled(), "files": files}


def set_file_path(pipeline: str, project: Optional[str], rel: str) -> Path:
    target = _set_dir(pipeline, project)
    path = (target / rel).resolve()
    if not str(path).startswith(str(target.resolve())) or not path.is_file():
        raise PipelineError("File not found in the current raw-data set", 404)
    return path


def ingest_set(pipeline: str, project: Optional[str], db: Optional[Session] = None) -> dict:
    """Copy the current set into the pipeline input store (what a manual
    upload would have produced); returns what landed where.

    State projects land TWICE, because a state's districts are projects too:
      * each district's folder goes into that district project's own store, so
        it can run its own district-level (by-block) crosstabs, and
      * every district's files also go into ONE dated folder in the state's
        store, which is what a state-level (by-district) run analyses.
    """
    target = _set_dir(pipeline, project)
    if not target.exists() or not any(target.rglob("*.csv")):
        raise PipelineError("Generate the raw data first — there is no current set", 400)

    ingested = []
    if pipeline == CROSSTABS:
        store = ensure_inputs(CROSSTABS, project)
        proj = projects.by_code(db, (project or "").upper()) if db is not None else None
        folders = sorted(p for p in target.iterdir() if p.is_dir())

        # Per-district stores (only meaningful for a state project's children).
        if proj is not None and proj.is_state:
            by_name = {c.name: c for c in projects.child_districts(db, proj)}
            for folder in folders:
                # folder name ends with the unit's display name
                child = next((c for name, c in by_name.items() if folder.name.endswith(name)), None)
                if child is None or not child.code:
                    continue
                child_store = ensure_inputs(CROSSTABS, projects.project_code(child))
                dest = child_store / "input_folder" / folder.name
                if dest.exists():
                    shutil.rmtree(dest)
                shutil.copytree(folder, dest)
                for f in sorted(dest.glob("*.csv")):
                    ingested.append(f"{child.name}: input_folder/{folder.name}/{f.name}")

            # …and the state's own combined folder (all districts together).
            ddmm = datetime.now().strftime("%d%m")
            combined = store / "input_folder" / f"input_folder_{ddmm}(CUD)_{ddmm}(DD)_{proj.name}"
            if combined.exists():
                shutil.rmtree(combined)
            combined.mkdir(parents=True)
            for folder in folders:
                for f in sorted(folder.glob("*.csv")):
                    shutil.copy2(f, combined / f.name)
                    ingested.append(f"{proj.name}: input_folder/{combined.name}/{f.name}")
        else:
            for folder in folders:
                dest = store / "input_folder" / folder.name
                if dest.exists():
                    shutil.rmtree(dest)
                shutil.copytree(folder, dest)
                for f in sorted(dest.glob("*.csv")):
                    ingested.append(f"input_folder/{folder.name}/{f.name}")
    else:
        store = ensure_inputs(MASD, None)
        dest_dir = store / "Inputs"
        dest_dir.mkdir(exist_ok=True)
        for f in sorted(target.glob("*.csv")):
            shutil.copy2(f, dest_dir / f.name)
            ingested.append(f"Inputs/{f.name}")
    return {"ingested": ingested}
