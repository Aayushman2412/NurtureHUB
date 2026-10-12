"""
NurtureHUB vs the earlier raw data files: which variables each side has.

The analysts' pipelines read raw files in the layout of the earlier platform's
exports (Database → Raw Data reproduces them from NurtureHUB). Asked on
5 Oct 2026 for a side-by-side: for every column of those files, whether
NurtureHUB fills it — and every NurtureHUB question the files have no column
for — so the team can decide what each side needs.

How it is worked out, so the answer is evidence rather than opinion:
  * "Not in NurtureHUB": the generator writes a fixed NULL for the column
    (read from its code), or — where a generator builds rows in loops — the
    column stays empty even over the mock dataset, where every answer of every
    form is filled. No NurtureHUB question feeds it.
  * "Filled by NurtureHUB": the column carries a value over the mock dataset.
  * "Filled when answered": mapped in the code, but empty in the test data —
    optional or "Other, please specify" answers.
  * "NurtureHUB only": a form question whose variable name the generators never
    read.

Usage (from backend/):
  venv-win/Scripts/python.exe -m scripts.compare_raw_columns --out ../comparison.xlsx
"""
from __future__ import annotations

import argparse
import ast
import inspect
import os
import re
from pathlib import Path

os.environ.setdefault("RAW_EXPORT_MOCK", "true")

from openpyxl import Workbook  # noqa: E402
from openpyxl.styles import Alignment, Font, PatternFill  # noqa: E402
from openpyxl.utils import get_column_letter  # noqa: E402

from app.rawdata import (  # noqa: E402
    gen_antenatal, gen_bf, gen_case_measurements, gen_case_report, gen_cf,
    gen_child, gen_growth, gen_masd, gen_mother, gen_protein,
)
from app.rawdata.common import NULL  # noqa: E402
from app.rawdata.mock import mock_dataset  # noqa: E402
from app.seed_forms import FORM_SPECS, build_schema  # noqa: E402
from app.form_catalog import catalog_rows  # noqa: E402

FILES = [
    ("Mother registration", gen_mother), ("Child registration", gen_child),
    ("Breastfeeding assessment", gen_bf), ("Complementary feeding assessment", gen_cf),
    ("Check growth", gen_growth), ("Antenatal care", gen_antenatal), ("Protein intake", gen_protein),
    ("Case measurements", gen_case_measurements), ("Case report", gen_case_report),
    ("MASD learner file", gen_masd),
]

# Which raw file(s) each form feeds — for the "NurtureHUB only" sheet.
FEEDS = {
    "learner_registration": "MASD learner file",
    "mother_registration": "Mother registration",
    "child_registration": "Child registration",
    "breastfeeding": "Breastfeeding assessment",
    "complementary_feeding": "Complementary feeding assessment",
    "growth_monitoring": "Check growth / Case measurements",
    "antenatal": "Antenatal care",
    "mother_protein_intake": "Protein intake",
}

# Columns that hold the record's own bookkeeping, filled for every row by
# construction (IDs, dates, user) — kept, but marked so they are not read as a
# question being matched.
SYSTEM = re.compile(r"^(user acc id|user name|ngo/facility|submission_id|submission_date|case id|role|draft|test|"
                    r"id \(cannot edit\)|other id)$", re.I)


# Each assessment's own date: the files carry it as Submission_Date.
OWN_DATES = {"bf_date", "cfa_date", "pca_date", "measurement_date", "anc_date", "assessment_date"}


def empty(value) -> bool:
    return value is None or str(value).strip() in ("", NULL, "NULL", "nan", "None")


def fixed_nulls(mod):
    """Column numbers the generator always writes NULL for, read from the one
    row literal it appends (None when rows are built some other way)."""
    tree = ast.parse(inspect.getsource(mod))
    lists = [n.args[0] for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr in ("append", "extend") and n.args and isinstance(n.args[0], ast.List)]
    row = next((lst for lst in lists if len(lst.elts) == len(mod.HEADER)
                and not any(isinstance(e, ast.Starred) for e in lst.elts)), None)
    if row is None:
        return None
    return {i + 1 for i, e in enumerate(row.elts) if isinstance(e, ast.Name) and e.id == "NULL"}


def column_status(ds):
    out = []
    for name, mod in FILES:
        rows = mod.generate(ds)
        nulls = fixed_nulls(mod)
        for i, col in enumerate(mod.HEADER):
            filled = sum(1 for r in rows if i < len(r) and not empty(r[i]))
            if SYSTEM.match(col.strip()):
                status = "Record ID / bookkeeping"
            elif nulls is not None and (i + 1) in nulls:
                status = "Not in NurtureHUB"
            elif filled:
                status = "Filled by NurtureHUB"
            elif nulls is not None:
                status = "Filled when answered"
            else:
                status = "Not in NurtureHUB"
            out.append((name, i + 1, col, status, filled, len(rows)))
    return out


def nurturehub_only():
    source = "\n".join(inspect.getsource(m) for _, m in FILES)
    source += "\n" + inspect.getsource(__import__("app.rawdata.common", fromlist=["x"]))
    rows = []
    for key, spec in FORM_SPECS.items():
        for r in catalog_rows(spec[0], build_schema(key)):
            var = r["variable"]
            # IDs, timestamps and worked-out values are bookkeeping (the files
            # carry them as Case ID / Submission_Date), not questions.
            if not var or r["item"] in ("Information shown", "Auto / read only") or var in OWN_DATES:
                continue
            if re.search(rf"\b{re.escape(var)}\b", source):
                continue
            rows.append((spec[0], FEEDS.get(key, ""), var, r["question"], r["item"]))
    return rows


def build(out: Path) -> None:
    ds = mock_dataset("Ujjain", "UJ")
    cols = column_status(ds)
    only_nh = nurturehub_only()

    wb = Workbook()
    head_font, head_fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="1F2937")
    fills = {"Filled by NurtureHUB": "DCFCE7", "Filled when answered": "FEF3C7",
             "Not in NurtureHUB": "FEE2E2", "Record ID / bookkeeping": "F3F4F6"}

    def header(ws, cells, widths):
        ws.append(cells)
        for c in ws[ws.max_row]:
            c.font, c.fill = head_font, head_fill
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w

    s = wb.active
    s.title = "Summary"
    s.append(["NurtureHUB vs the earlier raw data files — which variables each side has"])
    s["A1"].font = Font(bold=True, size=13)
    s.append(["Green = NurtureHUB fills the column · Yellow = filled when that (optional / 'Other') answer is given · "
              "Red = no NurtureHUB question feeds it · 'NurtureHUB only' = questions the files have no column for."])
    s.append([])
    kinds = ("Filled by NurtureHUB", "Filled when answered", "Not in NurtureHUB", "Record ID / bookkeeping")
    header(s, ["Raw file", "Columns", *kinds], [34, 10, 20, 20, 18, 22])
    for name, _ in FILES:
        mine = [c for c in cols if c[0] == name]
        s.append([name, len(mine)] + [sum(1 for c in mine if c[3] == k) for k in kinds])
    s.append(["All files", len(cols)] + [sum(1 for c in cols if c[3] == k) for k in kinds])
    s.append([])
    s.append(["NurtureHUB questions with no column in the files", len(only_nh)])

    a = wb.create_sheet("Columns of the raw files")
    header(a, ["Raw file", "#", "Column", "In NurtureHUB?", "Rows filled (mock)", "Rows"], [32, 5, 60, 26, 16, 8])
    for r in cols:
        a.append(list(r))
        a.cell(a.max_row, 4).fill = PatternFill("solid", fgColor=fills[r[3]])
    a.freeze_panes = "A2"
    a.auto_filter.ref = f"A1:F{a.max_row}"

    b = wb.create_sheet("Not in NurtureHUB")
    header(b, ["Raw file", "#", "Column"], [32, 5, 70])
    for r in cols:
        if r[3] == "Not in NurtureHUB":
            b.append([r[0], r[1], r[2]])

    c = wb.create_sheet("NurtureHUB only")
    header(c, ["Form", "Would feed", "Variable", "Question", "Item"], [30, 30, 30, 70, 14])
    for r in only_nh:
        c.append(list(r))
    for ws in (b, c):
        for row in ws.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical="top")
    wb.save(out)
    print(f"wrote {out}: {len(cols)} columns, "
          f"{sum(1 for x in cols if x[3] == 'Not in NurtureHUB')} not in NurtureHUB, "
          f"{len(only_nh)} NurtureHUB-only questions")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="raw_columns_comparison.xlsx")
    build(Path(ap.parse_args().out))
