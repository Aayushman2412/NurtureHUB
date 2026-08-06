"""One-time import of an existing local pipeline workspace as a baseline.

Copies the uploaded inputs into the admin "Database" input stores and records
the workspace's existing outputs as an 'imported' run (full history entry, all
files downloadable) so the section is populated before the first server-side
run — and so a fresh run can be compared against the last local one.

Usage (from backend/):
    python -m app.import_pipeline_baseline \
        --crosstabs-src "C:/path/to/full pipeline" --crosstabs-project UJ \
        --masd-src "C:/path/to/MASD COMBINED"

Either source may be given alone. Re-running skips variants that already have
an imported run unless --force is passed.
"""
import argparse
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from app.database import SessionLocal
from app.models import PipelineRun
from app import pipeline_service as svc


def _copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def _new_imported_run(db, pipeline: str, variant: str, label: str) -> PipelineRun:
    run = PipelineRun(pipeline=pipeline, variant=variant, status="imported",
                      label=label, run_dir="", created_by="import-script")
    db.add(run)
    db.commit()
    db.refresh(run)
    parent = svc.runs_parent(pipeline, variant)
    parent.mkdir(parents=True, exist_ok=True)
    run_dir = parent / f"run_{run.id:05d}"
    run_dir.mkdir(parents=True, exist_ok=True)
    run.run_dir = run_dir.resolve().relative_to(svc.data_root()).as_posix()
    now = datetime.now(timezone.utc)
    run.started_at = now
    run.finished_at = now
    db.commit()
    return run


def _finish_imported_run(db, run: PipelineRun) -> None:
    run_dir = svc.run_dir_abs(run)
    run.manifest_json = svc.build_manifest(run.pipeline, run.variant, run_dir)
    if run.pipeline == svc.CROSSTABS:
        report = svc.parse_pipeline_report(run_dir / "pipeline_report.txt")
        report.pop("error", None)
        run.report_json = {**report, "imported": True}
    else:
        run.report_json = {"imported": True}
    db.commit()
    print(f"  -> run #{run.id} ({run.pipeline}/{run.variant}): "
          f"{len(run.manifest_json)} files")


def _has_imported(db, pipeline: str, variant: str) -> bool:
    return db.query(PipelineRun).filter(
        PipelineRun.pipeline == pipeline,
        PipelineRun.variant == variant,
        PipelineRun.status == "imported",
    ).first() is not None


def import_crosstabs(db, src: Path, project: str, force: bool) -> None:
    project = project.upper()
    print(f"Importing crosstabs workspace for {project} from {src}")
    inputs_src = src / "Inputs"
    if not inputs_src.is_dir():
        raise SystemExit(f"ERROR: {inputs_src} does not exist")

    # ---- inputs -----------------------------------------------------------
    inputs = svc.ensure_inputs(svc.CROSSTABS, project)
    raw_src = inputs_src / "input_folder"
    if raw_src.is_dir():
        for sub in raw_src.iterdir():
            if sub.is_dir() and "(CUD)" in sub.name.upper():
                svc._copytree_into(sub, inputs / "input_folder" / sub.name)
                print(f"  raw folder: {sub.name}")
    for pattern in ("Role and department sheet.xlsx", "MASD_*_combined.xlsx",
                    "DOCS_onetime_fill_*.xlsx", "*_raw_combined_*_MASD.xlsx"):
        for f in inputs_src.glob(pattern):
            if not f.name.startswith("~$"):
                _copy(f, inputs / f.name)
    # The raw MASD extract historically sits at the workspace ROOT.
    for f in src.glob("*_raw_combined_*_MASD.xlsx"):
        if not f.name.startswith("~$"):
            _copy(f, inputs / f.name)
    print("  inputs imported")

    # ---- baseline run -----------------------------------------------------
    if _has_imported(db, svc.CROSSTABS, project) and not force:
        print("  imported run already exists — skipping (use --force to add another)")
        return
    run = _new_imported_run(db, svc.CROSSTABS, project,
                            "Imported baseline (last local run)")
    run_dir = svc.run_dir_abs(run)
    if (src / "outputs").is_dir():
        svc._copytree_into(src / "outputs", run_dir / "outputs")
    for sub in ("derived", "merged", "summaries", "combined", "cleaned"):
        if (inputs_src / sub).is_dir():
            svc._copytree_into(inputs_src / sub, run_dir / "Inputs" / sub)
    for name in ("crosstab_total_validation_report.xlsx", "pipeline.log", "pipeline_report.txt"):
        if (src / name).exists():
            _copy(src / name, run_dir / name)
    _finish_imported_run(db, run)


def import_masd(db, src: Path, force: bool) -> None:
    print(f"Importing MASD workspace from {src}")
    if not src.is_dir():
        raise SystemExit(f"ERROR: {src} does not exist")

    # ---- inputs -----------------------------------------------------------
    inputs = svc.ensure_inputs(svc.MASD)
    if (src / "Inputs").is_dir():
        for f in (src / "Inputs").glob("*.csv"):
            _copy(f, inputs / "Inputs" / f.name)
    for name in ("Role and department sheet.xlsx", "location_ujjain.xlsx",
                 "Location Meghalaya.xlsx", "location jalna.xlsx"):
        if (src / name).exists():
            _copy(src / name, inputs / name)
    if (src / "expected").is_dir():
        for f in (src / "expected").glob("*.xlsx"):
            _copy(f, inputs / "expected" / f.name)
    print("  inputs imported")

    # ---- baseline runs ----------------------------------------------------
    root_raw = [f for f in src.glob("*.xlsx")
                if re.search(r"_raw_combined_.+_MASD\.xlsx$", f.name, re.IGNORECASE)
                and not f.name.startswith("~$") and "_expected" not in f.name.lower()]
    root_excl = [f for f in src.glob("*.xlsx")
                 if re.search(r"_Excluded_", f.name, re.IGNORECASE)
                 and not f.name.startswith("~$") and "_expected" not in f.name.lower()]

    if _has_imported(db, svc.MASD, "combined") and not force:
        print("  combined imported run already exists — skipping")
    else:
        run = _new_imported_run(db, svc.MASD, "combined",
                                "Imported baseline (last local run)")
        run_dir = svc.run_dir_abs(run)
        for sub in ("Combined of combined script", "Colour coded of combined script"):
            if (src / sub).is_dir():
                svc._copytree_into(src / sub, run_dir / sub)
        # Notebook A also emits the Meghalaya raw/excluded pair at the root.
        for f in root_raw + root_excl:
            if f.name.upper().startswith("ML"):
                _copy(f, run_dir / f.name)
        _finish_imported_run(db, run)

    if _has_imported(db, svc.MASD, "raw_exclusion") and not force:
        print("  raw_exclusion imported run already exists — skipping")
    else:
        run = _new_imported_run(db, svc.MASD, "raw_exclusion",
                                "Imported baseline (last local run)")
        run_dir = svc.run_dir_abs(run)
        for f in root_raw + root_excl:
            _copy(f, run_dir / f.name)
        _finish_imported_run(db, run)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crosstabs-src")
    parser.add_argument("--crosstabs-project", default="UJ")
    parser.add_argument("--masd-src")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if not args.crosstabs_src and not args.masd_src:
        parser.error("provide --crosstabs-src and/or --masd-src")

    db = SessionLocal()
    try:
        if args.crosstabs_src:
            import_crosstabs(db, Path(args.crosstabs_src), args.crosstabs_project, args.force)
        if args.masd_src:
            import_masd(db, Path(args.masd_src), args.force)
        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
