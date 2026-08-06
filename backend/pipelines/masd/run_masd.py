"""Headless runner for the MASD notebooks (NurtureHUB server add-on).

Executes a MASD notebook the same way the crosstabs master_pipeline runs its
notebooks: json-load the .ipynb, concatenate the code cells, patch the single
BASE_DIR constant to point at an isolated per-run working directory, then
exec() the result. No jupyter/nbformat needed, and the notebook files
themselves are never modified.

Usage:
    python run_masd.py "<notebook.ipynb>" --base-dir "<run working dir>"

The working dir must contain the layout the notebooks expect under BASE_DIR:
Inputs/*.csv, "Role and department sheet.xlsx", the three location masters,
and optionally expected/. Exit code 0 = the notebook ran to completion.
"""
import argparse
import json
import re
import sys
import traceback
from pathlib import Path

BASE_DIR_RE = re.compile(r"^BASE_DIR\s*=\s*r?[\"'].*?[\"']", re.MULTILINE)


def extract_code(notebook_path: Path) -> str:
    with open(notebook_path, encoding="utf-8") as f:
        nb = json.load(f)
    cells = []
    for i, cell in enumerate(nb.get("cells", [])):
        if cell.get("cell_type") != "code":
            continue
        src = "".join(cell.get("source", []))
        if src.strip():
            cells.append(f"# ===== CELL {i} =====\n{src}")
    return "\n\n".join(cells)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a MASD notebook headlessly")
    parser.add_argument("notebook")
    parser.add_argument("--base-dir", required=True)
    args = parser.parse_args()

    notebook = Path(args.notebook).resolve()
    base_dir = Path(args.base_dir).resolve()
    if not notebook.exists():
        print(f"ERROR: notebook not found: {notebook}", file=sys.stderr)
        return 2
    if not base_dir.is_dir():
        print(f"ERROR: base dir not found: {base_dir}", file=sys.stderr)
        return 2

    code = extract_code(notebook)
    replacement = "BASE_DIR = r\"" + str(base_dir).replace("\\", "/") + "\""
    code, n_subs = BASE_DIR_RE.subn(replacement, code, count=1)
    if n_subs != 1:
        print("ERROR: could not find the BASE_DIR assignment to patch — "
              "the notebook layout changed; refusing to run against the "
              "original hardcoded path.", file=sys.stderr)
        return 2

    print(f"Running {notebook.name}")
    print(f"BASE_DIR patched to {base_dir}")
    sys.stdout.flush()

    globals_ns = {"__name__": "__main__", "__builtins__": __builtins__}
    try:
        exec(compile(code, str(notebook), "exec"), globals_ns)
    except Exception:
        traceback.print_exc()
        return 1
    print("Notebook completed successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
