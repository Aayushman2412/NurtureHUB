"""The MASD report as an Excel workbook.

Sheet 1 is the learner-level MASD file the analysts' scripts used to build
from a raw export — one row per learner with adoptions by type, activities by
subtype, target, ideal, fulfilment, intensity and nil-activity days. The other
sheets hold the tables behind the dashboard, so anyone can re-cut them.
"""
from __future__ import annotations

from io import BytesIO
from typing import Any, Dict, List, Optional

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from app.masd import rules as R

HEAD_FILL = PatternFill("solid", fgColor="E85D4C")
HEAD_FONT = Font(bold=True, color="FFFFFF")
THIN = Side(style="thin", color="E4DDD3")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
GOOD, OK, LOW = (PatternFill("solid", fgColor=c) for c in ("DDF1E3", "FBEBC8", "F8D7D3"))


def _tint(v: Optional[float]) -> Optional[PatternFill]:
    if v is None:
        return None
    return GOOD if v >= 80 else OK if v >= 60 else LOW


def _sheet(wb: Workbook, title: str, header: List[str], rows: List[List[Any]], widths: Optional[List[int]] = None,
           pct_cols: tuple = (), note: Optional[str] = None):
    ws = wb.create_sheet(title)
    start = 1
    if note:
        ws.cell(row=1, column=1, value=note).font = Font(italic=True, color="6B6357")
        start = 3
    for c, h in enumerate(header, start=1):
        cell = ws.cell(row=start, column=c, value=h)
        cell.fill, cell.font, cell.border = HEAD_FILL, HEAD_FONT, BORDER
        cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
    for r, row in enumerate(rows, start=start + 1):
        for c, v in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.border = BORDER
            if c in pct_cols and isinstance(v, (int, float)):
                fill = _tint(v)
                if fill:
                    cell.fill = fill
                cell.number_format = "0.0"
    for i, w in enumerate(widths or [], start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = ws.cell(row=start + 1, column=2)
    ws.auto_filter.ref = f"A{start}:{get_column_letter(len(header))}{start + len(rows)}"
    ws.row_dimensions[start].height = 32
    return ws


def build_workbook(report: Dict[str, Any]) -> BytesIO:
    wb = Workbook()
    wb.remove(wb.active)
    p, cal = report["project"], report["calendar"]
    note = (f"NurtureHUB MASD · {p['name']} · as of {report['as_of']} · F2F training {cal['training_date'] or '—'} · "
            f"tranche 2 from {cal['tranche2_start'] or '—'}")

    header = ["Learner", "Email", "Block", "Designation", "Role group", "Department", "F2F", "MT/FL",
              "ANC", "PNC <5M", "PNC ≥5M", "Not typed", "Total adoptions", "Target", "% target fulfilled",
              "Antenatal care", "Protein count", "Growth monitoring", "Breastfeeding", "Complementary feeding",
              "Total activities", "Ideal activities", "% activity intensity", "Avg activities / adoption",
              "Last activity", "Nil-activity days"]
    rows = []
    for l in sorted(report["learners"], key=lambda x: (x["block"], x["name"] or "")):
        a, act = l["adoptions"], l["activities"]
        rows.append([l["name"], l["email"], l["block"], l["role"], l["role_group"], l["department"],
                     "Yes" if l["f2f"] else "No",
                     {"master_trainer": "Master Trainer", "facilitator": "Facilitator"}.get(l["trainer_role"] or "", ""),
                     a["anc"], a["pnc_lt5"], a["pnc_ge5"], a["unknown"], a["total"], l["target"], l["fulfilment_pct"],
                     act["anc"], act["protein"], act["gm"], act["bf"], act["cf"], act["total"], l["ideal"]["total"],
                     l["intensity_pct"], l["avg_per_adoption"], l["last_activity"], l["nil_days"]])
    _sheet(wb, "MASD learners", header, rows,
           widths=[24, 30, 14, 20, 12, 10, 6, 14] + [8] * 5 + [7, 10] + [10] * 5 + [9, 9, 10, 10, 12, 10],
           pct_cols=(15, 23), note=note)

    def group_rows(groups):
        return [[g["label"], g["learners"], g["adoptions"], g["target"], g["fulfilment_pct"], g["activities"],
                 g["ideal"], g["intensity_pct"], g["nil_days_avg"]]
                + [g["subtype_pct"][k] for k in R.ACTIVITY_KEYS] for g in groups]

    g_head = ["Group", "Learners", "Adoptions", "Target", "% target", "Activities", "Ideal", "% intensity",
              "Avg nil-activity days"] + [f"% {R.ACTIVITY_LABELS[k]}" for k in R.ACTIVITY_KEYS]
    _sheet(wb, "By block", g_head, group_rows(report["blocks"]), widths=[18] + [11] * 13,
           pct_cols=(5, 8, 10, 11, 12, 13, 14))
    _sheet(wb, "By cadre", g_head, group_rows(report["roles"] + report["departments"]), widths=[18] + [11] * 13,
           pct_cols=(5, 8, 10, 11, 12, 13, 14))

    cmp = report.get("comparison")
    if cmp:
        _sheet(wb, "Then vs now", ["Block", f"% target {cmp['then']['as_of']}", f"% target {cmp['now']['as_of']}",
                                   "Change", f"% intensity {cmp['then']['as_of']}", f"% intensity {cmp['now']['as_of']}",
                                   "Change"],
               [[b["label"], b["fulfilment_then"], b["fulfilment_now"], b["fulfilment_change"],
                 b["intensity_then"], b["intensity_now"], b["intensity_change"]] for b in cmp["blocks"]],
               widths=[18] + [14] * 6)

    o = report["outcomes"]
    ex = o["exclusions"]
    _sheet(wb, "Exclusions", ["Reason", "MT+FL", "Other", "Total"],
           [[x["label"], x["mtfl"], x["other"], x["total"]] for x in ex["reasons"]]
           + [["Included (final analysis)", ex["included"]["mtfl"], ex["included"]["other"], ex["included"]["total"]],
              ["Total", ex["total"]["mtfl"], ex["total"]["other"], ex["total"]["total"]]],
           widths=[52, 10, 10, 10])

    prev_rows = []
    pv = o["prevalence"]
    for label, block in (("Overall", pv["overall"]), ("MT+FL", pv["mtfl"]), ("Other", pv["other"])):
        prev_rows += _prev(label, "All ages", block)
    for band in (R.BAND_LT6, R.BAND_6_11):
        for label in ("all", "mtfl", "other"):
            prev_rows += _prev({"all": "All", "mtfl": "MT+FL", "other": "Other"}[label], R.BAND_LABELS[band],
                               pv["bands"][band][label])
        for yn in ("yes", "no"):
            prev_rows += _prev(f"Visit rule met: {yn}", R.BAND_LABELS[band], o["compliance"][band][yn])
    _sheet(wb, "Malnutrition", ["Group", "Age band", "Indicator", "n", "BV %", "AV %", "LV %", "Abs change (pts)",
                                "Rel change %"], prev_rows, widths=[22, 14, 14, 8, 9, 9, 9, 14, 13])

    _sheet(wb, "Needs attention", ["Learner", "Block", "Cadre", "Adoptions", "% target", "% intensity", "Nil-activity days",
                                   "Reasons"],
           [[a["name"], a["block"], a["role_group"], a["adoptions"], a["fulfilment_pct"], a["intensity_pct"],
             a["nil_days"], ", ".join(a["reasons"])] for a in report["attention"]],
           widths=[24, 14, 12, 10, 10, 11, 14, 40], pct_cols=(6,))
    _sheet(wb, "Data corrections", ["Learner", "Block", "Cases", "Reasons"],
           [[f["name"], f["block"], f["cases"], "; ".join(f"{R.EXCLUSION_LABELS[k]} ({n})" for k, n in f["reasons"].items())]
            for f in o["data_fixes"]], widths=[24, 14, 8, 90])
    _sheet(wb, "Findings", ["Section", "Tone", "Finding"],
           [[section, f["tone"], f["text"]] for section, items in report["insights"].items() for f in items],
           widths=[16, 8, 140])

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer


def _prev(group: str, band: str, block: Dict[str, Any]) -> List[List[Any]]:
    if not block or not block.get("n"):
        return []
    return [[group, band, R.INDICATOR_LABELS[i], block["n"], block[i]["bv"], block[i]["av"], block[i]["lv"],
             block[i]["abs_change"], block[i]["rel_change"]] for i in R.INDICATORS]
