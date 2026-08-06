"""Data-analytics pipelines subsystem (admin "Database" section).

Two pipelines are embedded, vendored under backend/pipelines/:

- **crosstabs** — the 4-stage HST crosstabs pipeline (cleaning/combining ->
  derived columns -> crosstab workbooks -> totals validation), orchestrated by
  its own ``master_pipeline.py``. Strictly one project (district) at a time,
  so all of its state is isolated per project (UJ / JL / ML): separate input
  stores, runs and outputs.
- **masd** — the MASD notebooks: the "combined" script (combined +
  colour-coded workbooks per region) and the "raw + exclusion" script. Both
  auto-detect which projects' input CSVs are present and process only those,
  so MASD has a single shared input store.

Every run executes in its own freshly materialized working directory under
the pipeline data root (uploaded inputs + active script versions are copied
in), in a subprocess, so runs are reproducible, concurrent-safe and keep
their outputs forever (full run history). The pipeline code itself is never
modified — uploaded script versions simply replace the vendored defaults
under their canonical filenames inside the run directory.
"""
from __future__ import annotations

import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import zipfile
from datetime import datetime, timedelta, timezone, date
from pathlib import Path
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import PipelineRun, PipelineScript


class PipelineError(Exception):
    """Service-level error with an HTTP-ish status code (router converts)."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


# ==============================================================================
# Static configuration
# ==============================================================================

CROSSTABS = "crosstabs"
MASD = "masd"

CROSSTABS_PROJECTS = {"UJ": "Ujjain", "JL": "Jalna", "ML": "Meghalaya"}

MASD_KINDS = ("combined", "raw_exclusion")

# Which MASD input-CSV state prefix belongs to which project.
MASD_PREFIX_PROJECTS = {"MH": "Jalna", "MP": "Ujjain", "ML": "Meghalaya"}

# "<XX> <District>_<Mon-DD-YYYY>_MASD.csv"
MASD_INPUT_RE = re.compile(
    r"^(?P<prefix>[A-Za-z]{2})\s+(?P<district>.+?)\s*_(?P<date>[A-Za-z]{3}-\d{1,2}-\d{4})_MASD\.csv$",
    re.IGNORECASE,
)

# Script slots. "canonical" is the filename the pipeline expects inside a run
# directory ("dest" = subdirectory); uploads replace it. The "extra" slot
# accepts any helper scripts, copied into the run root under their own names.
CROSSTABS_SLOTS = {
    "master": {"label": "Master orchestrator", "canonical": "master_pipeline.py", "dest": ""},
    "validation": {"label": "Crosstab totals validation", "canonical": "validate_crosstab_totals.py", "dest": ""},
    "cleaning": {"label": "Stage 1 — Cleaning, Combining and Merging", "canonical": "Cleaning, Combining and Merging.ipynb", "dest": "All scripts"},
    "derived": {"label": "Stage 2 — Derived columns (ML pipeline)", "canonical": "ML_Pipeline(streamlined draft).ipynb", "dest": "All scripts"},
    "crosstabs": {"label": "Stage 3 — CrossTab pipeline", "canonical": "CrossTab_streamlined pipeline.ipynb", "dest": "All scripts"},
    "extra": {"label": "Extra scripts", "canonical": None, "dest": ""},
}
MASD_SLOTS = {
    "combined": {"label": "Combined MASD script", "canonical": "Combined MASD Script.ipynb", "dest": ""},
    "raw_exclusion": {"label": "Raw + exclusion script", "canonical": "MASD raw and exclusion data with derived cols.ipynb", "dest": ""},
    "extra": {"label": "Extra scripts", "canonical": None, "dest": ""},
}
SLOTS_BY_PIPELINE = {CROSSTABS: CROSSTABS_SLOTS, MASD: MASD_SLOTS}

ALLOWED_SCRIPT_EXTENSIONS = {".py", ".ipynb"}
ALLOWED_INPUT_EXTENSIONS = {".csv", ".xlsx", ".xls"}
MAX_SCRIPT_MB = 25
MAX_INPUT_FILE_MB = 100
MAX_INPUT_ZIP_MB = 400
# Caps on what a zip may expand to. The compressed-size cap above bounds the
# upload, not the extraction: DEFLATE reaches ~1000:1, so an in-limit archive
# could otherwise fill the disk.
MAX_INPUT_ZIP_EXPANDED_MB = 2048
MAX_INPUT_ZIP_MEMBERS = 2000

# Crosstabs master-input filename patterns (live at the root of Inputs/).
_CROSSTABS_MASTER_PATTERNS = (
    re.compile(r"^Role and department sheet\.xlsx$", re.IGNORECASE),
    re.compile(r"^MASD_.+_combined\.xlsx$", re.IGNORECASE),
    re.compile(r"^DOCS_onetime_fill_.+\.xlsx$", re.IGNORECASE),
    re.compile(r"^[A-Za-z]{2}_raw_combined_.+_MASD\.xlsx$", re.IGNORECASE),
)

# MASD master workbooks (live at the root of the MASD working dir), keyed by
# lowercase name -> the exact spelling the notebooks open.
_MASD_MASTER_NAMES = {
    "role and department sheet.xlsx": "Role and department sheet.xlsx",
    "location_ujjain.xlsx": "location_ujjain.xlsx",
    "location meghalaya.xlsx": "Location Meghalaya.xlsx",
    "location jalna.xlsx": "location jalna.xlsx",
}

# Crosstabs master sheets whose spelling the pipeline hardcodes.
_CROSSTABS_CANONICAL_NAMES = {
    "role and department sheet.xlsx": "Role and department sheet.xlsx",
}

# Output classification for crosstab workbooks that are diagnostics/case lists
# rather than report crosstabs.
_DIAG_PATTERNS = (
    "no_role_group_case_list",
    "no_block_case_list",
    "exclusion_reason_detail_ct",
    "gestational_week_missing_reason_ct",
    "last_visit_date_recovery_list",
)

SECTION_ORDER = {
    CROSSTABS: [
        "Crosstabs — column-wise %",
        "Crosstabs — row-wise %",
        "Case lists & diagnostics",
        "Derived workbook",
        "Merged master data",
        "Summaries & data screening",
        "Combined form CSVs",
        "Cleaned form CSVs",
        "Validation report",
        "Logs & run report",
    ],
    MASD: [
        "Combined workbooks",
        "Colour-coded workbooks",
        "Raw combined (exclusion-flagged)",
        "Excluded rows",
        "Logs",
    ],
}

RUNNING_STATUSES = ("queued", "running")


# ==============================================================================
# Paths
# ==============================================================================

def _backend_dir() -> Path:
    return Path(__file__).resolve().parent.parent


def vendored_dir(pipeline: str) -> Path:
    return _backend_dir() / "pipelines" / pipeline


def data_root() -> Path:
    root = Path(settings.PIPELINE_DATA_DIR) if settings.PIPELINE_DATA_DIR else _backend_dir() / "pipeline_data"
    return root.resolve()


def crosstabs_project_dir(project: str) -> Path:
    project = project.upper()
    if project not in CROSSTABS_PROJECTS:
        raise PipelineError(f"Unknown project '{project}'", 404)
    return data_root() / CROSSTABS / "projects" / project


def inputs_dir(pipeline: str, project: Optional[str] = None) -> Path:
    if pipeline == CROSSTABS:
        if not project:
            raise PipelineError("Crosstabs inputs are per-project", 400)
        return crosstabs_project_dir(project) / "inputs"
    if pipeline == MASD:
        return data_root() / MASD / "inputs"
    raise PipelineError(f"Unknown pipeline '{pipeline}'", 404)


def runs_parent(pipeline: str, variant: str) -> Path:
    if pipeline == CROSSTABS:
        return crosstabs_project_dir(variant) / "runs"
    return data_root() / MASD / "runs"


def scripts_dir(pipeline: str) -> Path:
    return data_root() / pipeline / "scripts"


def run_dir_abs(run: PipelineRun) -> Path:
    return (data_root() / run.run_dir).resolve()


def _safe_join(root: Path, rel: str) -> Path:
    """Join and confine: the result must stay inside root (no traversal)."""
    rel = (rel or "").replace("\\", "/").strip("/")
    if not rel:
        raise PipelineError("A file path is required", 400)
    candidate = (root / rel).resolve()
    root = root.resolve()
    if candidate != root and root not in candidate.parents:
        raise PipelineError("Invalid path", 400)
    return candidate


def _rel(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


# ==============================================================================
# Default inputs seeding
# ==============================================================================

def ensure_inputs(pipeline: str, project: Optional[str] = None) -> Path:
    """Create the input store if needed and seed vendored reference sheets."""
    root = inputs_dir(pipeline, project)
    root.mkdir(parents=True, exist_ok=True)
    if pipeline == CROSSTABS:
        (root / "input_folder").mkdir(exist_ok=True)
        ref = vendored_dir(CROSSTABS) / "reference_inputs"
        role = root / "Role and department sheet.xlsx"
        if not role.exists() and (ref / role.name).exists():
            shutil.copy2(ref / role.name, role)
        if project and project.upper() == "UJ":
            docs = root / "DOCS_onetime_fill_Ujjain.xlsx"
            if not docs.exists() and (ref / docs.name).exists():
                shutil.copy2(ref / docs.name, docs)
    else:
        (root / "Inputs").mkdir(exist_ok=True)
        ref = vendored_dir(MASD) / "reference_inputs"
        if ref.exists():
            for item in ref.iterdir():
                if item.is_file():
                    target = root / item.name
                    if not target.exists():
                        shutil.copy2(item, target)
            expected_src = ref / "expected"
            expected_dst = root / "expected"
            if expected_src.is_dir():
                expected_dst.mkdir(exist_ok=True)
                for item in expected_src.iterdir():
                    target = expected_dst / item.name
                    if not target.exists():
                        shutil.copy2(item, target)
    return root


# ==============================================================================
# Input listing / classification
# ==============================================================================

# Inputs fall into two groups, because they are managed differently:
#   reference — fixed master sheets every run needs (role/location/DOCS/expected).
#               A vendored copy ships with the app, so deleting one restores it.
#   dated     — the data that changes every run: raw exports and the dated MASD
#               workbooks. These are what an admin replaces before a new run.
GROUP_REFERENCE = "reference"
GROUP_DATED = "dated"

_REFERENCE_NAMES = {
    "role and department sheet.xlsx",
    "location_ujjain.xlsx",
    "location meghalaya.xlsx",
    "location jalna.xlsx",
}

# Date tokens carried by the varying inputs, most specific first.
_DATE_PATTERNS = (
    re.compile(r"(?P<d>[A-Za-z]{3}-\d{1,2}-\d{4})"),          # Aug-04-2026
    re.compile(r"_(?P<d>\d{6})_combined\.xlsx$", re.I),        # MASD_..._040826_combined
    re.compile(r"(?P<d>\d{4})\(CUD\)", re.I),                  # input_folder_0108(CUD)_...
)


def _input_date_label(rel_path: str) -> Optional[str]:
    for pattern in _DATE_PATTERNS:
        m = pattern.search(rel_path)
        if m:
            return m.group("d")
    return None


def classify_input_group(pipeline: str, rel_path: str) -> str:
    """Which management group a stored input belongs to."""
    parts = rel_path.split("/")
    name = parts[-1].lower()
    if name in _REFERENCE_NAMES:
        return GROUP_REFERENCE
    if name.startswith("docs_onetime_fill_"):
        return GROUP_REFERENCE
    if pipeline == MASD and parts[0].lower() == "expected":
        return GROUP_REFERENCE
    return GROUP_DATED


# ==============================================================================
# Input kinds — one upload slot per distinct thing the pipeline consumes
# ==============================================================================
#
# Each kind is its own section in the admin UI with its own uploader, so an
# admin never has to rely on filename guessing: uploading into a slot states
# what the file IS, and the service puts it where that pipeline expects it
# (renaming to the canonical spelling where the pipeline opens a file by exact
# name). Auto-classification is still used for zip uploads and for files
# already on disk.

CROSSTABS_KINDS = [
    {
        "key": "raw_folder", "group": GROUP_DATED, "required": True,
        "label": "Raw data export folder",
        "description": "The app's CSV exports for this run (mother, case report, measurements, growth, BF, CF, protein, antenatal, child). They are placed inside a dated folder.",
        "accept": ".csv", "multiple": True, "allows_zip": True,
        "hint": "MP_Ujjain_Mother_2026-08-01-164803.csv",
    },
    {
        "key": "masd_combined", "group": GROUP_DATED, "required": True,
        "label": "MASD combined sheet",
        "description": "Output of the MASD pipeline for this district — the batch/block authority. The run cannot start without it.",
        "accept": ".xlsx", "multiple": False, "allows_zip": False,
        "hint": "MASD_<District>_<DDMMYY>_combined.xlsx",
    },
    {
        "key": "masd_raw", "group": GROUP_DATED, "required": False,
        "label": "MASD raw combined extract",
        "description": "Optional. Supplies the role fill plus the no-batch and zero-adoption exclusion reasons; skipped when absent.",
        "accept": ".xlsx", "multiple": False, "allows_zip": False,
        "hint": "UJ_raw_combined_<Mon-DD-YYYY>_MASD.xlsx",
    },
    {
        "key": "role_sheet", "group": GROUP_REFERENCE, "required": True,
        "label": "Role and department sheet",
        "description": "Role → short role / department / role group mapping. Stored under its exact expected name.",
        "accept": ".xlsx", "multiple": False, "allows_zip": False,
        "hint": "Role and department sheet.xlsx",
    },
    {
        "key": "docs_fill", "group": GROUP_REFERENCE, "required": False,
        "label": "DOCS one-time fill sheet",
        "description": "Optional helper that gap-fills role and block from the skill-refreshment attendance list.",
        "accept": ".xlsx", "multiple": False, "allows_zip": False,
        "hint": "DOCS_onetime_fill_<District>.xlsx",
    },
]

MASD_KINDS = [
    {
        "key": "masd_csv", "group": GROUP_DATED, "required": True,
        "label": "MASD export CSVs",
        "description": "One CSV per district. Upload any mix of projects — each script processes exactly the projects present here.",
        "accept": ".csv", "multiple": True, "allows_zip": True,
        "hint": "MP Ujjain_Aug-04-2026_MASD.csv",
    },
    {
        "key": "role_sheet", "group": GROUP_REFERENCE, "required": True,
        "label": "Role and department sheet",
        "description": "Role → short role / department / role group mapping.",
        "accept": ".xlsx", "multiple": False, "allows_zip": False,
        "hint": "Role and department sheet.xlsx",
    },
    {
        "key": "location_sheets", "group": GROUP_REFERENCE, "required": True,
        "label": "Location master sheets",
        "description": "Location → block/taluk mapping, one per state. All three ship with the app.",
        "accept": ".xlsx", "multiple": True, "allows_zip": False,
        "hint": "location_ujjain.xlsx · Location Meghalaya.xlsx · location jalna.xlsx",
    },
    {
        "key": "expected", "group": GROUP_REFERENCE, "required": False,
        "label": "Expected reference workbooks",
        "description": "Optional. Used only to reproduce the reference row order of earlier outputs.",
        "accept": ".xlsx", "multiple": True, "allows_zip": False,
        "hint": "MASD_<District>_160626_combined_expected.xlsx",
    },
]

KINDS_BY_PIPELINE = {CROSSTABS: CROSSTABS_KINDS, MASD: MASD_KINDS}
OTHER_KIND = "other"


def input_kinds(pipeline: str, project: Optional[str] = None) -> list[dict]:
    """The upload slots for a pipeline, with the district filled into hints."""
    kinds = KINDS_BY_PIPELINE.get(pipeline)
    if kinds is None:
        raise PipelineError(f"Unknown pipeline '{pipeline}'", 404)
    district = CROSSTABS_PROJECTS.get((project or "").upper(), "<District>")
    out = []
    for kind in kinds:
        entry = dict(kind)
        entry["hint"] = entry["hint"].replace("<District>", district)
        out.append(entry)
    return out


def classify_input_kind(pipeline: str, rel_path: str) -> str:
    """Which upload slot an already-stored file belongs to."""
    parts = rel_path.split("/")
    name = parts[-1]
    low = name.lower()
    if pipeline == CROSSTABS:
        if parts[0] == "input_folder":
            return "raw_folder"
        if low == "role and department sheet.xlsx":
            return "role_sheet"
        if low.startswith("docs_onetime_fill_"):
            return "docs_fill"
        if re.match(r"^MASD_.+_combined\.xlsx$", name, re.I):
            return "masd_combined"
        if re.match(r"^[A-Za-z]{2}_raw_combined_.+_MASD\.xlsx$", name, re.I):
            return "masd_raw"
        if low.endswith(".csv"):
            return "raw_folder"
        return OTHER_KIND
    if parts[0].lower() == "expected":
        return "expected"
    if low == "role and department sheet.xlsx":
        return "role_sheet"
    if low in _MASD_MASTER_NAMES:
        return "location_sheets"
    if parts[0] == "Inputs" or low.endswith(".csv"):
        return "masd_csv"
    return OTHER_KIND


def _destination_for_kind(pipeline: str, kind: str, filename: str,
                          project: Optional[str], subdir: Optional[str]) -> str:
    """Where a file uploaded into a specific slot must be stored.

    Files the pipelines open by literal name are renamed to that exact name, so
    an upload can never be silently invisible to the run.
    """
    name = Path(filename).name
    low = name.lower()
    if pipeline == CROSSTABS:
        district = CROSSTABS_PROJECTS.get((project or "").upper(), "")
        if kind == "raw_folder":
            folder = (subdir or "").strip().strip("/\\") or default_raw_subdir(project or "UJ")
            return f"input_folder/{folder}/{name}"
        if kind == "role_sheet":
            return "Role and department sheet.xlsx"
        if kind == "docs_fill":
            return f"DOCS_onetime_fill_{district}.xlsx"
        if kind == "masd_combined":
            if not re.match(r"^MASD_.+_combined\.xlsx$", name, re.I):
                raise PipelineError(
                    f"'{name}' is not a MASD combined sheet. The pipeline looks for "
                    f"MASD_{district}_<DDMMYY>_combined.xlsx — upload that file, or rename yours to match.", 400)
            if district and not re.match(rf"^MASD_{re.escape(district)}_", name, re.I):
                raise PipelineError(
                    f"'{name}' belongs to a different district. This project needs "
                    f"MASD_{district}_<DDMMYY>_combined.xlsx.", 400)
            return name
        if kind == "masd_raw":
            if not re.match(r"^[A-Za-z]{2}_raw_combined_.+_MASD\.xlsx$", name, re.I):
                raise PipelineError(
                    f"'{name}' is not a raw MASD extract. Expected "
                    f"{(project or 'XX').upper()}_raw_combined_<Mon-DD-YYYY>_MASD.xlsx.", 400)
            return name
    else:
        if kind == "masd_csv":
            if not MASD_INPUT_RE.match(name):
                raise PipelineError(
                    f"'{name}' does not match the required naming pattern "
                    "'<XX> <District>_<Mon-DD-YYYY>_MASD.csv' (e.g. "
                    "'MP Ujjain_Aug-04-2026_MASD.csv'). The scripts would skip it.", 400)
            return f"Inputs/{name}"
        if kind == "role_sheet":
            return "Role and department sheet.xlsx"
        if kind == "location_sheets":
            canonical = _MASD_MASTER_NAMES.get(low)
            if not canonical or canonical == "Role and department sheet.xlsx":
                raise PipelineError(
                    f"'{name}' is not one of the location masters. Expected one of: "
                    "location_ujjain.xlsx, Location Meghalaya.xlsx, location jalna.xlsx.", 400)
            return canonical
        if kind == "expected":
            return f"expected/{name}"
    # Unknown slot -> fall back to filename-based routing.
    return (classify_crosstabs_upload(name, subdir, project or "UJ")
            if pipeline == CROSSTABS else classify_masd_upload(name))


def list_input_files(pipeline: str, project: Optional[str] = None) -> list[dict]:
    root = ensure_inputs(pipeline, project)
    files = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and not path.name.startswith("~$"):
            stat = path.stat()
            rel = _rel(root, path)
            files.append({
                "group": classify_input_group(pipeline, rel),
                "kind": classify_input_kind(pipeline, rel),
                "date": _input_date_label(rel),
                "path": rel,
                "name": path.name,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
    return files


def crosstabs_input_status(project: str) -> dict:
    """Raw folders present, master sheets present, preflight problems."""
    root = ensure_inputs(CROSSTABS, project)
    district = CROSSTABS_PROJECTS[project.upper()]
    raw_parent = root / "input_folder"
    raw_folders = []
    for sub in sorted(raw_parent.iterdir() if raw_parent.exists() else []):
        if sub.is_dir():
            csvs = [f.name for f in sub.glob("*.csv")]
            raw_folders.append({
                "name": sub.name,
                "csv_count": len(csvs),
                "dated": "(CUD)" in sub.name.upper(),
            })
    loose_csvs = len(list(raw_parent.glob("*.csv"))) if raw_parent.exists() else 0

    role_ok = (root / "Role and department sheet.xlsx").exists()
    masd_files = [p.name for p in root.glob(f"MASD_{district}_*_combined.xlsx") if not p.name.startswith("~$")]
    raw_masd_files = [p.name for p in root.glob(f"{project.upper()}_raw_combined_*_MASD.xlsx") if not p.name.startswith("~$")]
    docs_files = [p.name for p in root.glob(f"DOCS_onetime_fill_{district}.xlsx")]

    problems = []
    dated = [f for f in raw_folders if f["dated"] and f["csv_count"] > 0]
    if not dated and loose_csvs == 0:
        problems.append("No raw data folder: upload the app's CSV exports into a dated "
                        "input folder (e.g. input_folder_0108(CUD)_0308(DD)_" + district + ").")
    if not role_ok:
        problems.append("'Role and department sheet.xlsx' is missing.")
    if not masd_files:
        problems.append(f"MASD combined sheet is missing (MASD_{district}_<DDMMYY>_combined.xlsx) — the pipeline hard-requires it.")
    warnings = []
    if not raw_masd_files:
        warnings.append(f"{project.upper()}_raw_combined_<date>_MASD.xlsx not present — MASD role fill and "
                        "batch/zero-adoption exclusion reasons will be skipped.")
    if not docs_files:
        warnings.append(f"DOCS_onetime_fill_{district}.xlsx not present — DOCS role/block fills will be skipped.")
    return {
        "raw_folders": raw_folders,
        "loose_csv_count": loose_csvs,
        "role_sheet": role_ok,
        "masd_combined": masd_files,
        "raw_masd": raw_masd_files,
        "docs_fill": docs_files,
        "problems": problems,
        "warnings": warnings,
    }


def masd_input_status() -> dict:
    """Which projects have data present (the scripts process only those).

    Detection mirrors the Combined notebook's own globs ("MH Jalna_*_MASD.csv",
    "MP Ujjain_*_MASD.csv", "ML *_MASD.csv") rather than the looser filename
    regex, so a file the notebook would silently skip is never reported as
    present.
    """
    root = ensure_inputs(MASD)
    csv_dir = root / "Inputs"
    projects: dict[str, dict] = {
        prefix: {"project": name, "files": []} for prefix, name in MASD_PREFIX_PROJECTS.items()
    }
    unrecognized = []
    for f in sorted(csv_dir.glob("*.csv")):
        m = MASD_INPUT_RE.match(f.name)
        prefix = m.group("prefix").upper() if m else None
        district = m.group("district").strip() if m else ""
        if prefix in projects and (prefix == "ML" or district.lower() == projects[prefix]["project"].lower()):
            projects[prefix]["files"].append(f.name)
        else:
            unrecognized.append(f.name)
    masters_missing = [n for n in ("Role and department sheet.xlsx", "location_ujjain.xlsx",
                                   "Location Meghalaya.xlsx", "location jalna.xlsx")
                       if not (root / n).exists()]
    problems = []
    if not any(p["files"] for p in projects.values()):
        problems.append("No input CSVs found. Upload files named like 'MP Ujjain_Aug-04-2026_MASD.csv'.")
    if masters_missing:
        problems.append("Missing master sheets: " + ", ".join(masters_missing))
    return {
        "projects": [
            {"prefix": prefix, "project": info["project"], "present": bool(info["files"]), "files": info["files"]}
            for prefix, info in projects.items()
        ],
        "unrecognized": unrecognized,
        "masters_missing": masters_missing,
        "problems": problems,
    }


# ==============================================================================
# Input uploads
# ==============================================================================

def _check_ext(filename: str, allowed: set[str]) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in allowed:
        raise PipelineError(f"File type '{ext or filename}' is not allowed", 400)
    return ext


def _safe_filename(filename: str) -> str:
    """Basename reduced to characters every filesystem accepts."""
    name = re.sub(r"[^A-Za-z0-9 ._()\-]", "_", Path(filename).name).strip(" .")
    return name or "file"


def default_raw_subdir(project: str) -> str:
    today = date.today().strftime("%d%m")
    return f"input_folder_{today}(CUD)_{today}(DD)_{CROSSTABS_PROJECTS[project.upper()]}"


def classify_crosstabs_upload(filename: str, subdir: Optional[str], project: str) -> str:
    """Relative destination (under the project's inputs root) for one file.

    The Role sheet is stored under its canonical spelling: the pipeline opens
    it by exact name, so on a case-sensitive filesystem an upload named
    "role and department sheet.xlsx" would otherwise be invisible to it.
    """
    name = Path(filename).name
    for pattern in _CROSSTABS_MASTER_PATTERNS:
        if pattern.match(name):
            return _CROSSTABS_CANONICAL_NAMES.get(name.lower(), name)
    if name.lower().endswith(".csv"):
        folder = (subdir or "").strip().strip("/\\") or default_raw_subdir(project)
        return f"input_folder/{folder}/{name}"
    return name


def classify_masd_upload(filename: str) -> str:
    name = Path(filename).name
    if MASD_INPUT_RE.match(name) or name.lower().endswith("_masd.csv") or name.lower().endswith(".csv"):
        return f"Inputs/{name}"
    if name.lower() in _MASD_MASTER_NAMES:
        # Same exact-name concern as above: the notebooks open the master
        # workbooks by literal filename.
        return _MASD_MASTER_NAMES[name.lower()]
    if "_expected" in name.lower():
        return f"expected/{name}"
    return name


def save_input_file(pipeline: str, project: Optional[str], filename: str,
                    stream, subdir: Optional[str] = None,
                    kind: Optional[str] = None) -> dict:
    """Store one uploaded input.

    `kind` names the upload slot it came from, which states what the file is;
    without it the destination is inferred from the filename (zip members and
    the legacy generic uploader).
    """
    _check_ext(filename, ALLOWED_INPUT_EXTENSIONS)
    root = ensure_inputs(pipeline, project)
    if kind and kind != OTHER_KIND:
        valid = {k["key"] for k in KINDS_BY_PIPELINE.get(pipeline, [])}
        if kind not in valid:
            raise PipelineError(f"Unknown input type '{kind}'", 400)
        allowed_ext = next(k["accept"] for k in KINDS_BY_PIPELINE[pipeline] if k["key"] == kind)
        if Path(filename).suffix.lower() != allowed_ext:
            raise PipelineError(
                f"This section takes {allowed_ext} files; '{Path(filename).name}' is not one.", 400)
        rel = _destination_for_kind(pipeline, kind, filename, project, subdir)
    elif pipeline == CROSSTABS:
        rel = classify_crosstabs_upload(filename, subdir, project)
    else:
        rel = classify_masd_upload(filename)
    dest = _safe_join(root, rel)
    dest.parent.mkdir(parents=True, exist_ok=True)
    _write_stream(stream, dest, MAX_INPUT_FILE_MB)
    return {"path": _rel(root, dest), "size": dest.stat().st_size}


def _write_stream(stream, dest: Path, max_mb: int) -> None:
    """Stream to a temp file, then atomically replace the destination.

    Writing in place would let a run that is materializing at the same moment
    copy a half-written file and process truncated data silently.
    """
    limit = max_mb * 1024 * 1024
    written = 0
    tmp = dest.with_name(dest.name + f".part{os.getpid()}")
    try:
        with open(tmp, "wb") as out:
            while True:
                chunk = stream.read(1 << 20)
                if not chunk:
                    break
                written += len(chunk)
                if written > limit:
                    raise PipelineError(f"File exceeds the {max_mb} MB limit", 413)
                out.write(chunk)
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)


# Stage-output subdirectories of a crosstabs workspace's Inputs/ folder. A zip
# of a whole local workspace carries these; importing them would seed the input
# store with a previous run's artifacts, which every later run would copy in and
# then report as its own output.
_CROSSTABS_STAGE_OUTPUT_DIRS = {"cleaned", "combined", "merged", "derived", "summaries"}


def extract_input_zip(pipeline: str, project: Optional[str], zip_path: Path,
                      subdir: Optional[str] = None) -> list[str]:
    """Extract an uploaded zip into the input store with per-member routing."""
    root = ensure_inputs(pipeline, project)
    extracted: list[str] = []
    written_paths: list[Path] = []
    skipped_outputs = 0
    expanded_limit = MAX_INPUT_ZIP_EXPANDED_MB * 1024 * 1024
    expanded = 0

    def _abort(message: str, status: int) -> None:
        for path in written_paths:
            path.unlink(missing_ok=True)
        raise PipelineError(message, status)

    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            raw = member.filename.replace("\\", "/")
            name = Path(raw).name
            if name.startswith("~$") or name.startswith(".") or "__MACOSX" in raw:
                continue
            if Path(name).suffix.lower() not in ALLOWED_INPUT_EXTENSIONS:
                continue
            if len(extracted) >= MAX_INPUT_ZIP_MEMBERS:
                _abort(f"The zip contains more than {MAX_INPUT_ZIP_MEMBERS} files", 413)
            parts = [p for p in raw.split("/") if p not in ("", ".", "..")]
            if pipeline == CROSSTABS:
                cud_idx = next((i for i, p in enumerate(parts) if "(CUD)" in p.upper()), None)
                if cud_idx is not None:
                    rel = "input_folder/" + "/".join(parts[cud_idx:])
                elif "Inputs" in parts:
                    inner = parts[parts.index("Inputs") + 1:]
                    if not inner:
                        continue
                    # Only master sheets are taken from a workspace's Inputs/
                    # root; its stage-output subfolders are ignored.
                    if len(inner) > 1 and inner[0].lower() in _CROSSTABS_STAGE_OUTPUT_DIRS:
                        skipped_outputs += 1
                        continue
                    rel = classify_crosstabs_upload(name, subdir, project)
                else:
                    rel = classify_crosstabs_upload(name, subdir, project)
            else:
                if "expected" in [p.lower() for p in parts[:-1]]:
                    rel = f"expected/{name}"
                else:
                    rel = classify_masd_upload(name)
            dest = _safe_join(root, rel)
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_name(dest.name + f".part{os.getpid()}")
            try:
                with archive.open(member) as src, open(tmp, "wb") as out:
                    while True:
                        chunk = src.read(1 << 20)
                        if not chunk:
                            break
                        expanded += len(chunk)
                        if expanded > expanded_limit:
                            # The enclosing finally removes tmp once the file
                            # handle is closed — deleting it here would fail on
                            # Windows, where an open file cannot be unlinked.
                            _abort("The zip expands to more than "
                                   f"{MAX_INPUT_ZIP_EXPANDED_MB} MB", 413)
                        out.write(chunk)
                os.replace(tmp, dest)
            finally:
                tmp.unlink(missing_ok=True)
            written_paths.append(dest)
            extracted.append(_rel(root, dest))
    if not extracted:
        detail = ("The zip contained no usable input files (.csv/.xlsx)")
        if skipped_outputs:
            detail += (f" — {skipped_outputs} file(s) were skipped because they are "
                       "pipeline outputs (Inputs/cleaned, /combined, /merged, "
                       "/derived, /summaries), not inputs.")
        raise PipelineError(detail, 400)
    return extracted


def delete_input_path(pipeline: str, project: Optional[str], rel_path: str) -> None:
    root = ensure_inputs(pipeline, project)
    target = _safe_join(root, rel_path)
    if not target.exists():
        raise PipelineError("File not found", 404)
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    _prune_empty_dirs(root)


def delete_input_group(pipeline: str, project: Optional[str], group: str) -> int:
    """Delete every stored input in one group ('reference', 'dated' or 'all').

    Reference sheets are restored from the vendored copies the next time the
    input store is read, so this resets them rather than leaving the pipeline
    without its master data.
    """
    if group not in (GROUP_REFERENCE, GROUP_DATED, "all"):
        raise PipelineError("group must be 'reference', 'dated' or 'all'", 400)
    root = ensure_inputs(pipeline, project)
    removed = 0
    for path in sorted(root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if not path.is_file():
            continue
        rel = _rel(root, path)
        if group != "all" and classify_input_group(pipeline, rel) != group:
            continue
        try:
            path.unlink()
            removed += 1
        except OSError:
            pass
    _prune_empty_dirs(root)
    return removed


def _prune_empty_dirs(root: Path) -> None:
    """Remove directories left empty by a delete (e.g. a dated raw folder)."""
    for path in sorted(root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            try:
                path.rmdir()
            except OSError:
                pass


# ==============================================================================
# Scripts
# ==============================================================================

def slot_info(pipeline: str, slot: str) -> dict:
    slots = SLOTS_BY_PIPELINE.get(pipeline)
    if slots is None:
        raise PipelineError(f"Unknown pipeline '{pipeline}'", 404)
    if slot not in slots:
        raise PipelineError(f"Unknown script slot '{slot}'", 404)
    return slots[slot]


def list_scripts(db: Session, pipeline: str) -> list[dict]:
    slots = SLOTS_BY_PIPELINE.get(pipeline)
    if slots is None:
        raise PipelineError(f"Unknown pipeline '{pipeline}'", 404)
    rows = (db.query(PipelineScript)
              .filter(PipelineScript.pipeline == pipeline)
              .order_by(PipelineScript.slot, PipelineScript.version.desc())
              .all())
    by_slot: dict[str, list[PipelineScript]] = {}
    for row in rows:
        by_slot.setdefault(row.slot, []).append(row)
    result = []
    for slot, info in slots.items():
        versions = [{
            "version": r.version,
            "original_name": r.original_name,
            "notes": r.notes,
            "is_active": r.is_active,
            "created_by": r.created_by,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in by_slot.get(slot, [])]
        result.append({
            "slot": slot,
            "label": info["label"],
            "canonical": info["canonical"],
            "multi": info["canonical"] is None,
            "versions": versions,
            "active_version": next((v["version"] for v in versions if v["is_active"]), None),
        })
    return result


def _validate_uploaded_script(slot: str, path: Path) -> None:
    """Reject a replacement orchestrator that would escape the run directory.

    The vendored master_pipeline.py takes its workspace from
    PIPELINE_WORKSPACE_DIR. A copy edited from an older local version still
    carries a hardcoded Desktop path, so it would write outside the run (or
    fail outright) with no obvious cause — catch that at upload time.
    """
    if slot != "master":
        return
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return
    if "PIPELINE_WORKSPACE_DIR" not in text:
        raise PipelineError(
            "This master_pipeline.py does not read PIPELINE_WORKSPACE_DIR, so it would "
            "run against a hardcoded local folder instead of this run's workspace. "
            "Start from the current version (download it with 'Download current') and "
            "re-apply your changes on top of it.", 400)


def upload_script(db: Session, pipeline: str, slot: str, filename: str, stream,
                  notes: Optional[str], admin_email: Optional[str]) -> PipelineScript:
    info = slot_info(pipeline, slot)
    _check_ext(filename, ALLOWED_SCRIPT_EXTENSIONS)
    if info["canonical"] and Path(info["canonical"]).suffix != Path(filename).suffix.lower():
        raise PipelineError(
            f"This slot expects a {Path(info['canonical']).suffix} file "
            f"(it replaces '{info['canonical']}')", 400)
    last = (db.query(PipelineScript)
              .filter(PipelineScript.pipeline == pipeline, PipelineScript.slot == slot)
              .order_by(PipelineScript.version.desc())
              .first())
    version = (last.version + 1) if last else 1
    dest = scripts_dir(pipeline) / slot / f"v{version}__{_safe_filename(filename)}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    _write_stream(stream, dest, MAX_SCRIPT_MB)
    try:
        _validate_uploaded_script(slot, dest)
    except PipelineError:
        dest.unlink(missing_ok=True)
        raise

    if info["canonical"] is not None:
        # Single-file slot: a new upload becomes the one active version.
        db.query(PipelineScript).filter(
            PipelineScript.pipeline == pipeline, PipelineScript.slot == slot,
        ).update({"is_active": False})
    script = PipelineScript(
        pipeline=pipeline, slot=slot, version=version,
        original_name=Path(filename).name,
        stored_path=_rel(data_root(), dest),
        notes=notes, is_active=True, created_by=admin_email,
    )
    db.add(script)
    db.commit()
    db.refresh(script)
    return script


def set_active_script(db: Session, pipeline: str, slot: str, version: Optional[int]) -> None:
    info = slot_info(pipeline, slot)
    query = db.query(PipelineScript).filter(
        PipelineScript.pipeline == pipeline, PipelineScript.slot == slot)
    if version is None:
        # Revert to the vendored default (or, for 'extra', deactivate all).
        query.update({"is_active": False})
    else:
        target = query.filter(PipelineScript.version == version).first()
        if not target:
            raise PipelineError("Script version not found", 404)
        if info["canonical"] is not None:
            query.update({"is_active": False})
        target.is_active = True
    db.commit()


def deactivate_script(db: Session, pipeline: str, slot: str, version: int) -> None:
    row = (db.query(PipelineScript)
             .filter(PipelineScript.pipeline == pipeline, PipelineScript.slot == slot,
                     PipelineScript.version == version)
             .first())
    if not row:
        raise PipelineError("Script version not found", 404)
    row.is_active = False
    db.commit()


def delete_script(db: Session, pipeline: str, slot: str, version: int) -> None:
    row = (db.query(PipelineScript)
             .filter(PipelineScript.pipeline == pipeline, PipelineScript.slot == slot,
                     PipelineScript.version == version)
             .first())
    if not row:
        raise PipelineError("Script version not found", 404)
    stored = data_root() / row.stored_path
    db.delete(row)
    db.commit()
    stored.unlink(missing_ok=True)


def script_file_path(db: Session, pipeline: str, slot: str, version: Optional[int]) -> tuple[Path, str]:
    """Path + download name for a script version (None = active, else default)."""
    info = slot_info(pipeline, slot)
    query = db.query(PipelineScript).filter(
        PipelineScript.pipeline == pipeline, PipelineScript.slot == slot)
    row = None
    if version is not None:
        row = query.filter(PipelineScript.version == version).first()
        if not row:
            raise PipelineError("Script version not found", 404)
    else:
        row = query.filter(PipelineScript.is_active.is_(True)).order_by(PipelineScript.version.desc()).first()
    if row:
        path = data_root() / row.stored_path
        if not path.exists():
            raise PipelineError("Stored script file is missing on disk", 500)
        return path, row.original_name
    if info["canonical"] is None:
        raise PipelineError("No uploaded script in this slot", 404)
    dest = info["dest"]
    default = vendored_dir(pipeline) / dest / info["canonical"] if dest else vendored_dir(pipeline) / info["canonical"]
    if not default.exists():
        raise PipelineError("Vendored default script is missing", 500)
    return default, info["canonical"]


# ==============================================================================
# Run materialization
# ==============================================================================

def _materialize_scripts(db: Session, pipeline: str, run_dir: Path, kinds: Optional[Iterable[str]] = None) -> dict:
    """Copy active (or default) scripts into the run dir; returns provenance."""
    slots = SLOTS_BY_PIPELINE[pipeline]
    provenance = {}
    for slot, info in slots.items():
        if slot == "extra":
            extras = (db.query(PipelineScript)
                        .filter(PipelineScript.pipeline == pipeline,
                                PipelineScript.slot == "extra",
                                PipelineScript.is_active.is_(True))
                        .order_by(PipelineScript.version)
                        .all())
            for extra in extras:
                src = data_root() / extra.stored_path
                if src.exists():
                    safe = _safe_filename(extra.original_name)
                    shutil.copy2(src, run_dir / safe)
                    provenance[f"extra:{safe}"] = f"v{extra.version}"
            continue
        if kinds is not None and slot not in kinds:
            continue
        active = (db.query(PipelineScript)
                    .filter(PipelineScript.pipeline == pipeline,
                            PipelineScript.slot == slot,
                            PipelineScript.is_active.is_(True))
                    .order_by(PipelineScript.version.desc())
                    .first())
        dest_dir = run_dir / info["dest"] if info["dest"] else run_dir
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / info["canonical"]
        if active:
            src = data_root() / active.stored_path
            if not src.exists():
                raise PipelineError(f"Active script for slot '{slot}' is missing on disk", 500)
            shutil.copy2(src, dest)
            provenance[slot] = f"v{active.version} ({active.original_name})"
        else:
            src = vendored_dir(pipeline) / info["dest"] / info["canonical"] if info["dest"] else vendored_dir(pipeline) / info["canonical"]
            if not src.exists():
                raise PipelineError(f"Vendored default for slot '{slot}' is missing", 500)
            shutil.copy2(src, dest)
            provenance[slot] = "default"
    return provenance


def _copytree_into(src: Path, dst: Path) -> None:
    """Copy the contents of src into dst (dst may exist).

    Directory mtimes are copied too: master_pipeline picks the raw data folder
    by *newest mtime*, and writing files into a freshly created directory
    stamps it with the copy time — which would silently select whichever
    folder happened to be copied last instead of the newest one.
    """
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        if item.name.startswith("~$"):
            continue
        target = dst / item.name
        if item.is_dir():
            _copytree_into(item, target)
        else:
            shutil.copy2(item, target)
    shutil.copystat(src, dst)


def materialize_crosstabs_run(db: Session, project: str, run_dir: Path) -> dict:
    status = crosstabs_input_status(project)
    if status["problems"]:
        raise PipelineError("Inputs are incomplete: " + " ".join(status["problems"]), 409)
    run_dir.mkdir(parents=True, exist_ok=True)
    provenance = _materialize_scripts(db, CROSSTABS, run_dir)
    _copytree_into(inputs_dir(CROSSTABS, project), run_dir / "Inputs")
    return {"scripts": provenance, "input_warnings": status["warnings"]}


def materialize_masd_run(db: Session, kind: str, run_dir: Path) -> dict:
    if kind not in MASD_KINDS:
        raise PipelineError(f"Unknown MASD script '{kind}'", 404)
    status = masd_input_status()
    if status["problems"]:
        raise PipelineError("Inputs are incomplete: " + " ".join(status["problems"]), 409)
    run_dir.mkdir(parents=True, exist_ok=True)
    provenance = _materialize_scripts(db, MASD, run_dir, kinds=(kind,))
    _copytree_into(inputs_dir(MASD), run_dir)
    shutil.copy2(vendored_dir(MASD) / "run_masd.py", run_dir / "run_masd.py")
    return {
        "scripts": provenance,
        "detected_projects": [
            {"project": p["project"], "present": p["present"], "file_count": len(p["files"])}
            for p in status["projects"]
        ],
    }


# ==============================================================================
# Run execution
# ==============================================================================

def start_run(db: Session, pipeline: str, variant: str, admin_email: Optional[str]) -> PipelineRun:
    if pipeline == CROSSTABS:
        variant = variant.upper()
        if variant not in CROSSTABS_PROJECTS:
            raise PipelineError(f"Unknown project '{variant}'", 404)
    elif pipeline == MASD:
        if variant not in MASD_KINDS:
            raise PipelineError(f"Unknown MASD script '{variant}'", 404)
    else:
        raise PipelineError(f"Unknown pipeline '{pipeline}'", 404)

    active = (db.query(PipelineRun)
                .filter(PipelineRun.pipeline == pipeline,
                        PipelineRun.variant == variant,
                        PipelineRun.status.in_(RUNNING_STATUSES))
                .first())
    if active:
        raise PipelineError(
            f"A run for this {'project' if pipeline == CROSSTABS else 'script'} is already "
            f"in progress (run #{active.id})", 409)

    run = PipelineRun(pipeline=pipeline, variant=variant, status="queued",
                      created_by=admin_email, run_dir="")
    db.add(run)
    db.commit()
    db.refresh(run)

    parent = runs_parent(pipeline, variant)
    parent.mkdir(parents=True, exist_ok=True)
    run_dir = parent / f"run_{run.id:05d}"
    run.run_dir = _rel(data_root(), run_dir)
    db.commit()
    db.refresh(run)

    thread = threading.Thread(target=_execute_run, args=(run.id,), daemon=True,
                              name=f"pipeline-run-{run.id}")
    thread.start()
    return run


def _finalize_run(run_id: int, **fields) -> None:
    """Write the terminal state of a run using a short-lived own session.

    The run thread must not hold a session (and therefore a pooled DB
    connection and an idle transaction) across a multi-minute subprocess, and
    a failure to persist the terminal state would leave the run stuck in
    'running' — blocking every later run of that variant.
    """
    for attempt in range(3):
        db = SessionLocal()
        try:
            run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
            if not run:
                return
            for key, value in fields.items():
                setattr(run, key, value)
            run.finished_at = datetime.now(timezone.utc)
            db.commit()
            return
        except Exception as exc:  # noqa: BLE001 — retry, then give up loudly
            db.rollback()
            print(f"WARNING: could not finalize pipeline run {run_id} "
                  f"(attempt {attempt + 1}): {exc}")
        finally:
            db.close()


def _execute_run(run_id: int) -> None:
    db = SessionLocal()
    try:
        run = db.query(PipelineRun).filter(PipelineRun.id == run_id).first()
        if not run:
            return
        pipeline, variant = run.pipeline, run.variant
        run_dir = run_dir_abs(run)
        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        # Owner identity lets a restarted process tell a genuinely dead run
        # apart from one still executing in a sibling worker.
        run.report_json = {"owner_pid": os.getpid(), "owner_host": socket.gethostname()}
        db.commit()

        try:
            if pipeline == CROSSTABS:
                materialization = materialize_crosstabs_run(db, variant, run_dir)
                cmd = [sys.executable, "master_pipeline.py"]
                extra_env = {
                    "PIPELINE_WORKSPACE_DIR": str(run_dir),
                    "PIPELINE_RUN_DATE": date.today().isoformat(),
                    # Pin the raw folder explicitly instead of leaving the
                    # pipeline's newest-mtime heuristic to re-derive it.
                    "PIPELINE_RAW_INPUT_DIR": str(_pick_raw_input_dir(run_dir)),
                    # Meghalaya is analysed state-wide; the others by district.
                    "PIPELINE_ANALYSIS_LEVEL": "state" if variant == "ML" else "district",
                }
            else:
                materialization = materialize_masd_run(db, variant, run_dir)
                notebook = MASD_SLOTS[variant]["canonical"]
                cmd = [sys.executable, "run_masd.py", notebook, "--base-dir", str(run_dir)]
                extra_env = {}
        except PipelineError as exc:
            _finalize_run(run_id, status="failed", error=str(exc))
            return
        except Exception as exc:  # noqa: BLE001
            _finalize_run(run_id, status="failed", error=f"{type(exc).__name__}: {exc}")
            return
        finally:
            # Release the connection before the long-running subprocess.
            db.close()

        report = {"materialization": materialization,
                  "owner_pid": os.getpid(), "owner_host": socket.gethostname()}
        try:
            console_log = run_dir / "console.log"
            pid_file = run_dir / PID_FILENAME
            timeout = settings.PIPELINE_RUN_TIMEOUT_MINUTES * 60
            timed_out = False
            with open(console_log, "w", encoding="utf-8") as log_fp:
                proc = subprocess.Popen(
                    cmd, cwd=str(run_dir), env=_subprocess_env(extra_env),
                    stdout=log_fp, stderr=subprocess.STDOUT,
                )
                # Recorded so a restarted server can reap this child if the
                # process that started it died mid-run.
                pid_file.write_text(str(proc.pid), encoding="utf-8")
                try:
                    exit_code = proc.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    exit_code = proc.wait()
                    timed_out = True
                finally:
                    pid_file.unlink(missing_ok=True)

            report["exit_code"] = exit_code
            if timed_out:
                success = False
                error = (f"Run exceeded the {settings.PIPELINE_RUN_TIMEOUT_MINUTES} minute "
                         "timeout and was terminated. Any partial outputs are listed below.")
            elif pipeline == CROSSTABS:
                parsed = parse_pipeline_report(run_dir / "pipeline_report.txt")
                report.update(parsed)
                success = exit_code == 0 and parsed.get("status") == "SUCCESS"
                error = None if success else (
                    parsed.get("error") or f"Pipeline reported status {parsed.get('status') or 'UNKNOWN'} "
                    f"(exit code {exit_code}) — see the logs."
                )
            else:
                success = exit_code == 0
                error = None if success else f"Script exited with code {exit_code} — see the log."

            # Always publish whatever was produced, including on failure, so
            # partial outputs and logs stay downloadable.
            _finalize_run(run_id,
                          manifest_json=build_manifest(pipeline, variant, run_dir),
                          report_json=report,
                          status="success" if success else "failed",
                          error=error)
        except Exception as exc:  # noqa: BLE001 — a run thread must never die silently
            try:
                manifest = build_manifest(pipeline, variant, run_dir)
            except Exception:  # noqa: BLE001
                manifest = []
            _finalize_run(run_id, manifest_json=manifest, report_json=report,
                          status="failed", error=f"{type(exc).__name__}: {exc}")
    finally:
        db.close()


def _pick_raw_input_dir(run_dir: Path) -> Path:
    """The dated (CUD) raw folder the run should process (newest wins)."""
    parent = run_dir / "Inputs" / "input_folder"
    if parent.is_dir():
        dated = [d for d in parent.iterdir() if d.is_dir() and "(CUD)" in d.name.upper()]
        if dated:
            return max(dated, key=lambda p: p.stat().st_mtime)
    return parent


# Server secrets the pipeline subprocess has no use for. It executes
# admin-uploaded code, so we do not hand it the app's credentials.
_SECRET_ENV_KEYS = (
    "DATABASE_URL", "READ_DATABASE_URL", "ALEMBIC_DATABASE_URL", "JWT_SECRET_KEY",
    "SMTP_USER", "SMTP_PASSWORD", "GOOGLE_CLIENT_ID", "RATE_LIMIT_STORAGE_URI",
    "POSTGRES_PASSWORD", "POSTGRES_USER",
)


def _subprocess_env(extra: dict) -> dict:
    env = {k: v for k, v in os.environ.items() if k not in _SECRET_ENV_KEYS}
    env["PYTHONIOENCODING"] = "utf-8"
    env.update(extra)
    return env


def parse_pipeline_report(report_path: Path) -> dict:
    """Parse master_pipeline's pipeline_report.txt (the success authority)."""
    if not report_path.exists():
        return {"status": None, "error": "pipeline_report.txt was not written — the run "
                                         "aborted before the orchestrator could report."}
    fields = {}
    for line in report_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if ":" in line and not line.strip().startswith("="):
            key, _, value = line.partition(":")
            key, value = key.strip(), value.strip()
            if key and value:
                fields[key] = value
    return {
        "status": fields.get("Status"),
        "stages": {k: fields[k] for k in
                   ("Cleaning & Combining", "ML Pipeline", "CrossTab Pipeline", "Total Validation")
                   if k in fields},
        "total_runtime": fields.get("Total Runtime"),
        "validation": {k: fields[k] for k in
                       ("Workbooks scanned", "Tables checked", "Column-wise mismatches",
                        "Row-wise mismatches", "UNEXPLAINED", "Verdict")
                       if k in fields},
        "failed_stage": fields.get("Failed Stage"),
        "error": fields.get("Error"),
    }


# ==============================================================================
# Output manifests
# ==============================================================================

def _entry(root: Path, path: Path, section: str) -> dict:
    return {
        "path": _rel(root, path),
        "name": path.name,
        "size": path.stat().st_size,
        "section": section,
    }


def build_manifest(pipeline: str, variant: str, run_dir: Path) -> list[dict]:
    if pipeline == CROSSTABS:
        return _crosstabs_manifest(run_dir)
    return _masd_manifest(run_dir)


def _is_diag(name: str) -> bool:
    low = name.lower()
    return any(p in low for p in _DIAG_PATTERNS)


def _crosstabs_manifest(run_dir: Path) -> list[dict]:
    entries: list[dict] = []
    outputs = run_dir / "outputs"
    if outputs.exists():
        for path in sorted(outputs.rglob("*.xlsx")):
            if path.name.startswith("~$"):
                continue
            parent = path.parent.name
            row_wise = parent in ("output_2", "output_jalna_2")
            if _is_diag(path.name):
                section = "Case lists & diagnostics"
            elif row_wise:
                section = "Crosstabs — row-wise %"
            else:
                section = "Crosstabs — column-wise %"
            entries.append(_entry(run_dir, path, section))
    for sub, section, pattern in (
        ("Inputs/derived", "Derived workbook", "*.xlsx"),
        ("Inputs/merged", "Merged master data", "*.csv"),
        ("Inputs/summaries", "Summaries & data screening", "*.*"),
        ("Inputs/combined", "Combined form CSVs", "*.csv"),
    ):
        base = run_dir / sub
        if base.exists():
            for path in sorted(base.glob(pattern)):
                if path.is_file() and not path.name.startswith("~$"):
                    entries.append(_entry(run_dir, path, section))
    cleaned = run_dir / "Inputs" / "cleaned"
    if cleaned.exists():
        for path in sorted(cleaned.rglob("*.csv")):
            entries.append(_entry(run_dir, path, "Cleaned form CSVs"))
    validation = run_dir / "crosstab_total_validation_report.xlsx"
    if validation.exists():
        entries.append(_entry(run_dir, validation, "Validation report"))
    for log_name in ("pipeline_report.txt", "pipeline.log", "console.log"):
        path = run_dir / log_name
        if path.exists():
            entries.append(_entry(run_dir, path, "Logs & run report"))
    return entries


def _is_untouched_copy(run_file: Path) -> bool:
    """True if this file is the input store's copy, unmodified by the run.

    An output-shaped workbook uploaded into the MASD input store is copied into
    every run directory; unless the run actually rewrote it (which changes size
    and mtime) it is not that run's output and must not be listed as one.
    """
    try:
        source = inputs_dir(MASD) / run_file.name
        if not source.is_file():
            return False
        a, b = run_file.stat(), source.stat()
        return a.st_size == b.st_size and abs(a.st_mtime - b.st_mtime) < 2
    except OSError:
        return False


def _masd_manifest(run_dir: Path) -> list[dict]:
    entries: list[dict] = []
    for sub, section in (
        ("Combined of combined script", "Combined workbooks"),
        ("Colour coded of combined script", "Colour-coded workbooks"),
    ):
        base = run_dir / sub
        if base.exists():
            for path in sorted(base.glob("*.xlsx")):
                if not path.name.startswith("~$"):
                    entries.append(_entry(run_dir, path, section))
    for path in sorted(run_dir.glob("*.xlsx")):
        name = path.name
        if name.startswith("~$") or name.lower() in _MASD_MASTER_NAMES:
            continue
        if _is_untouched_copy(path):
            continue
        if re.search(r"_raw_combined_.+_MASD\.xlsx$", name, re.IGNORECASE):
            entries.append(_entry(run_dir, path, "Raw combined (exclusion-flagged)"))
        elif re.search(r"_Excluded_", name, re.IGNORECASE):
            entries.append(_entry(run_dir, path, "Excluded rows"))
    console = run_dir / "console.log"
    if console.exists():
        entries.append(_entry(run_dir, console, "Logs"))
    return entries


# ==============================================================================
# Run housekeeping / downloads
# ==============================================================================

# Name of the per-run file holding the pipeline subprocess's PID.
PID_FILENAME = ".pipeline_pid"


def _process_alive(pid: int) -> bool:
    try:
        if os.name == "nt":
            out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                                 capture_output=True, text=True, timeout=10)
            return str(pid) in (out.stdout or "")
        os.kill(pid, 0)
    except (OSError, ProcessLookupError, subprocess.SubprocessError):
        return False
    return True


def _reap_orphan_subprocess(run: PipelineRun) -> None:
    """Kill a pipeline subprocess abandoned by a dead server process.

    Only kills when the recorded PID still belongs to a Python process, so a
    recycled PID cannot take an unrelated program down with it.
    """
    try:
        pid_file = run_dir_abs(run) / PID_FILENAME
        if not pid_file.exists():
            return
        pid = int(pid_file.read_text(encoding="utf-8").strip() or 0)
        pid_file.unlink(missing_ok=True)
        if pid <= 0 or not _process_alive(pid):
            return
        if os.name == "nt":
            out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH", "/FO", "CSV"],
                                 capture_output=True, text=True, timeout=10)
            if "python" not in (out.stdout or "").lower():
                return
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                           capture_output=True, timeout=15)
        else:
            try:
                cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().decode("utf-8", "replace")
            except OSError:
                return
            if "master_pipeline.py" not in cmdline and "run_masd.py" not in cmdline:
                return
            os.kill(pid, 9)
        print(f"Reaped orphaned pipeline subprocess {pid} from run {run.id}.")
    except Exception as exc:  # noqa: BLE001 — never block boot on cleanup
        print(f"WARNING: could not reap subprocess for run {run.id}: {exc}")


def fail_stale_runs() -> int:
    """Mark abandoned queued/running runs as failed (called at server startup).

    A run's worker thread lives inside one process, so a restart abandons it.
    Runs owned by a *live* process on this host are left alone — otherwise a
    respawned worker would kill runs still executing in a sibling worker. Runs
    from another host, or ones past the timeout window, are failed regardless
    so a variant can never stay blocked forever.
    """
    db = SessionLocal()
    try:
        stale = db.query(PipelineRun).filter(PipelineRun.status.in_(RUNNING_STATUSES)).all()
        host = socket.gethostname()
        cutoff = datetime.now(timezone.utc) - timedelta(
            minutes=settings.PIPELINE_RUN_TIMEOUT_MINUTES)
        failed = 0
        for run in stale:
            report = run.report_json or {}
            owner_pid, owner_host = report.get("owner_pid"), report.get("owner_host")
            started = run.started_at
            overdue = started is not None and started < cutoff
            if (owner_host == host and isinstance(owner_pid, int)
                    and _process_alive(owner_pid) and not overdue):
                continue  # still running in a sibling worker
            _reap_orphan_subprocess(run)
            run.status = "failed"
            run.error = ("Interrupted by a server restart."
                         if not overdue else
                         "Abandoned: the run outlived the timeout window without finishing.")
            run.finished_at = run.finished_at or datetime.now(timezone.utc)
            failed += 1
        db.commit()
        return failed
    finally:
        db.close()


def delete_run(db: Session, run: PipelineRun) -> None:
    if run.status in RUNNING_STATUSES:
        raise PipelineError("Cannot delete a run that is still in progress", 409)
    run_dir = run_dir_abs(run)
    db.delete(run)
    db.commit()
    if run_dir.exists() and data_root() in run_dir.parents:
        shutil.rmtree(run_dir, ignore_errors=True)


def run_file(run: PipelineRun, rel_path: str) -> Path:
    path = _safe_join(run_dir_abs(run), rel_path)
    if not path.is_file():
        raise PipelineError("File not found", 404)
    return path


def build_run_zip(run: PipelineRun, paths: Optional[list[str]] = None,
                  section: Optional[str] = None) -> tuple[Path, str]:
    """Write a zip of run outputs to a temp file; caller streams + deletes it."""
    manifest = run.manifest_json or []
    if paths:
        wanted = set(paths)
        selected = [m for m in manifest if m["path"] in wanted]
        missing = wanted - {m["path"] for m in selected}
        if missing:
            raise PipelineError("Unknown output files requested: " + ", ".join(sorted(missing)[:5]), 400)
    elif section:
        selected = [m for m in manifest if m["section"] == section]
    else:
        selected = list(manifest)
    if not selected:
        raise PipelineError("No output files to download", 404)

    root = run_dir_abs(run)
    tmp_dir = data_root() / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    _sweep_temp_zips(tmp_dir)
    fd, tmp_name = tempfile.mkstemp(suffix=".zip", prefix=f"pipeline_run_{run.id}_",
                                    dir=str(tmp_dir))
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as archive:
            for item in selected:
                src = _safe_join(root, item["path"])
                if src.is_file():
                    archive.write(src, arcname=item["path"])
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    label = section.replace(" ", "_") if section else ("selected" if paths else "all_outputs")
    label = re.sub(r"[^A-Za-z0-9_\-]", "", label) or "outputs"
    filename = f"{run.pipeline}_{run.variant}_run{run.id}_{label}.zip"
    return tmp, filename


def _sweep_temp_zips(tmp_dir: Path, max_age_hours: int = 6) -> None:
    """Delete leftover download zips (a cancelled download skips its cleanup)."""
    cutoff = datetime.now(timezone.utc).timestamp() - max_age_hours * 3600
    for stale in tmp_dir.glob("pipeline_run_*.zip"):
        try:
            if stale.stat().st_mtime < cutoff:
                stale.unlink()
        except OSError:
            pass


def run_to_dict(run: PipelineRun, include_manifest: bool = False) -> dict:
    data = {
        "id": run.id,
        "pipeline": run.pipeline,
        "variant": run.variant,
        "status": run.status,
        "label": run.label,
        "error": run.error,
        "created_by": run.created_by,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "report": run.report_json or {},
        "file_count": len(run.manifest_json or []),
    }
    if include_manifest:
        data["manifest"] = run.manifest_json or []
        data["sections"] = SECTION_ORDER[run.pipeline]
    return data
