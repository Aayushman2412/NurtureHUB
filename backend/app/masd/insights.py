"""The plain-language findings under each part of the MASD report.

The analysts' deck puts two or three "→" sentences under every chart, saying
what the reader should take from it. These are the same sentences, written
from the numbers each time the report is computed, so the dashboard and the
downloaded deck carry identical wording. Each finding has a tone — good,
watch, info — that the dashboard shows as an icon.

Rules of thumb kept throughout: name the group and the number; say when a
group is too small to read much into (fewer than five learners); never call a
difference a trend when it is under two points.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.masd import rules as R

SMALL_N = 5


def _f(v: Optional[float]) -> str:
    return "—" if v is None else f"{v:.1f}%"


def _pts(v: Optional[float]) -> str:
    return "—" if v is None else f"{v:+.1f} pts"


def _date(iso: str) -> str:
    from datetime import date
    return date.fromisoformat(iso).strftime("%d %b %Y")


def _finding(tone: str, text: str) -> Dict[str, str]:
    return {"tone": tone, "text": text}


def _small(n: int) -> str:
    return f" — though on a base of just {n} learner{'s' if n != 1 else ''}" if n < SMALL_N else ""


def _valid(groups: List[Dict[str, Any]], key: str) -> List[Dict[str, Any]]:
    return [g for g in groups if g.get(key) is not None]


# ── Activity half ──────────────────────────────────────────────────────────


def overview(r: Dict[str, Any]) -> List[Dict[str, str]]:
    s = r["summary"]
    out = []
    if s["learners"] == 0:
        return [_finding("info", "No learner in this project has been selected for face-to-face "
                                 "training yet, so there is nothing to report.")]
    fl, it = s["fulfilment_pct"], s["intensity_pct"]
    out.append(_finding(
        "good" if (fl or 0) >= 100 else "watch",
        f"{s['learners']} F2F-trained learners adopted {s['adoptions']:,} mothers against a target of "
        f"{s['target']:,} ({_f(fl)} of target)."))
    if it is not None:
        out.append(_finding(
            "good" if it >= 80 else "watch" if it < 60 else "info",
            f"They completed {s['activities']:,} activities — {_f(it)} of the {s['ideal']:,} expected "
            f"by now (the targets in force × the forms due at each learner's follow-up)."))
    if fl is not None and it is not None and fl - it >= 20:
        out.append(_finding("watch", "Adoption volume is running well ahead of follow-up: more cases "
                                     "are being taken on than are being visited as often as the "
                                     "programme expects."))
    if s["own_pct"] is not None:
        out.append(_finding(
            "good" if s["own_pct"] >= 80 else "watch" if s["own_pct"] < 60 else "info",
            f"On the cases they did adopt, learners filed {_f(s['own_pct'])} of the forms those cases were "
            f"due by their own follow-up."))
    if s["no_activity"]:
        silent, nobody = s["no_activity"], s["zero_adoptions"]
        tail = f", and {nobody} adopted nobody" if nobody else ""
        out.append(_finding("watch", f"{silent} learner{'s have' if silent != 1 else ' has'} "
                                     f"filed no activity at all{tail}."))
    return out


def blocks(r: Dict[str, Any]) -> List[Dict[str, str]]:
    groups = [g for g in r["blocks"] if g["learners"]]
    out = []
    ranked = _valid(groups, "intensity_pct")
    if len(ranked) >= 2:
        best = max(ranked, key=lambda g: g["intensity_pct"])
        worst = min(ranked, key=lambda g: g["intensity_pct"])
        out.append(_finding("info", f"{best['label']} leads on expected activity done ({_f(best['intensity_pct'])}"
                                    f"{_small(best['learners'])}); {worst['label']} is lowest "
                                    f"({_f(worst['intensity_pct'])}{_small(worst['learners'])})."))
    over = [g for g in groups if (g["fulfilment_pct"] or 0) >= 100]
    if groups:
        out.append(_finding("good" if len(over) == len(groups) else "info",
                            f"{len(over)} of {len(groups)} blocks {'meets' if len(over) == 1 else 'meet'} or exceed "
                            f"the adoption target."))
    nil = _valid(groups, "nil_days_avg")
    if nil:
        worst = max(nil, key=lambda g: g["nil_days_avg"])
        if worst["nil_days_avg"] >= 10:
            out.append(_finding("watch", f"{worst['label']} has the longest silence since the last activity — "
                                         f"{worst['nil_days_avg']:.1f} days on average."))
    both = [g for g in ranked if g["fulfilment_pct"] is not None]
    if len(both) >= 3:
        weak = [g for g in both if g["fulfilment_pct"] < _avg(both, "fulfilment_pct")
                and g["intensity_pct"] < _avg(both, "intensity_pct")]
        if weak:
            out.append(_finding("watch", "Below the district average on both adoption and activity: "
                                         + ", ".join(g["label"] for g in weak) + "."))
    return out


def _avg(groups: List[Dict[str, Any]], key: str) -> float:
    vals = [g[key] for g in groups if g.get(key) is not None]
    return sum(vals) / len(vals) if vals else 0.0


def roles(r: Dict[str, Any]) -> List[Dict[str, str]]:
    groups = [g for g in r["roles"] if g["learners"]]
    out = []
    ranked = _valid(groups, "intensity_pct")
    if not ranked:
        return out
    big = [g for g in ranked if g["learners"] >= SMALL_N] or ranked
    best = max(big, key=lambda g: (g["intensity_pct"], g["fulfilment_pct"] or 0))
    nil_note = f", with {best['nil_days_avg']:.1f} nil-activity days" if best["nil_days_avg"] is not None else ""
    out.append(_finding("good", f"{best['label']} is the strongest cadre on follow-up among the larger groups — "
                                f"{_f(best['fulfilment_pct'])} of the adoption target and {_f(best['intensity_pct'])} "
                                f"of the expected activities{nil_note}."))
    gaps = [g for g in ranked if g["fulfilment_pct"] is not None]
    if gaps:
        widest = max(gaps, key=lambda g: g["fulfilment_pct"] - g["intensity_pct"])
        if widest["fulfilment_pct"] - widest["intensity_pct"] >= 20:
            out.append(_finding("watch", f"{widest['label']} shows the widest gap between adopting and following up "
                                         f"({_f(widest['fulfilment_pct'])} adoption vs {_f(widest['intensity_pct'])} "
                                         f"activity){_small(widest['learners'])}."))
    nil = _valid(groups, "nil_days_avg")
    if nil:
        worst = max(nil, key=lambda g: g["nil_days_avg"])
        out.append(_finding("watch" if worst["nil_days_avg"] >= 10 else "info",
                            f"{worst['label']} has the highest average nil-activity days "
                            f"({worst['nil_days_avg']:.1f}){_small(worst['learners'])}."))
    nurses = next((g for g in groups if g["key"] == R.NURSING_STAFF), None)
    if nurses:
        target = r["calendar"]["targets"]["now"]["nurse"]
        out.append(_finding("info", f"Staff Nurses ({nurses['learners']}) are expected to adopt {target} PNC <5 month "
                                    f"cases in the facility by now; they reach {_f(nurses['fulfilment_pct'])} of that "
                                    f"and {_f(nurses['intensity_pct'])} of their expected activities."))
    return out


def subtypes(r: Dict[str, Any]) -> List[Dict[str, str]]:
    s = r["summary"]["subtype_pct"]
    vals = {k: v for k, v in s.items() if v is not None}
    if not vals:
        return []
    low = min(vals, key=vals.get)
    high = max(vals, key=vals.get)
    out = [_finding("watch" if vals[low] < 60 else "info",
                    f"{R.ACTIVITY_LABELS[low]} lags the other activities ({_f(vals[low])} of expected) — "
                    f"a priority area for supervision.")]
    if high != low:
        out.append(_finding("good", f"{R.ACTIVITY_LABELS[high]} is the most complete activity ({_f(vals[high])})."))
    gm, bf, cf = vals.get("gm"), vals.get("bf"), vals.get("cf")
    if gm is not None and bf is not None and abs(gm - bf) >= 10:
        out.append(_finding("watch", f"Growth checks ({_f(gm)}) and breastfeeding assessments ({_f(bf)}) are "
                                     f"out of step — the two should usually be filled at the same visit."))
    return out


def progress(cmp: Dict[str, Any]) -> List[Dict[str, str]]:
    t, n = cmp["then"], cmp["now"]
    out = []
    blocks = [b for b in cmp["blocks"] if b["fulfilment_change"] is not None]
    if blocks:
        up = [b for b in blocks if b["fulfilment_change"] > 0]
        out.append(_finding("good" if len(up) == len(blocks) else "info",
                            f"Adoption-target fulfilment rose in {len(up)} of {len(blocks)} blocks between "
                            f"{_date(t['as_of'])} and {_date(n['as_of'])}."))
    ints = [b for b in cmp["blocks"] if b["intensity_change"] is not None]
    if ints:
        down = [b for b in ints if b["intensity_change"] < -2]
        worst = min(ints, key=lambda b: b["intensity_change"])
        if down:
            out.append(_finding("watch", f"Expected activity done fell in {len(down)} of {len(ints)} blocks — most sharply "
                                         f"in {worst['label']} ({_f(worst['intensity_then'])} → "
                                         f"{_f(worst['intensity_now'])})."))
        best = max(ints, key=lambda b: b["intensity_change"])
        if best["intensity_change"] > 2:
            out.append(_finding("good", f"{best['label']} improved the most on expected activity done "
                                        f"({_pts(best['intensity_change'])})."))
    if t["target_per_learner"] != n["target_per_learner"]:
        out.append(_finding("info", f"The target itself changed between the two dates "
                                    f"({t['target_per_learner']} → {n['target_per_learner']} adoptions per learner) "
                                    f"at the review, so the figures reflect a further round of adoption, "
                                    f"not the same cases counted twice."))
    return out


# ── Outcome half ───────────────────────────────────────────────────────────


def outcomes(r: Dict[str, Any]) -> List[Dict[str, str]]:
    o = r["outcomes"]
    ex = o["exclusions"]
    out = []
    if ex["total"]["total"] == 0:
        return [_finding("info", "No F2F learner's cases are eligible for the outcome analysis yet.")]
    out.append(_finding("info", f"{ex['included']['total']:,} of {ex['total']['total']:,} mother-child dyads "
                                f"({_f(ex['inclusion_pct'])}) pass every data check and are analysed."))
    if ex["inclusion_pct_mtfl"] is not None and ex["inclusion_pct_other"] is not None:
        diff = ex["inclusion_pct_mtfl"] - ex["inclusion_pct_other"]
        if abs(diff) >= 2:
            out.append(_finding("good" if diff > 0 else "watch",
                                f"MT+FL learners keep {'more' if diff > 0 else 'fewer'} of their cases in the analysis "
                                f"({_f(ex['inclusion_pct_mtfl'])}) than other learners ({_f(ex['inclusion_pct_other'])})."))
    reasons = sorted((x for x in ex["reasons"] if x["total"]), key=lambda x: -x["total"])
    if reasons:
        top = reasons[0]
        out.append(_finding("info", f"The most common reason a case drops out is '{top['label']}' "
                                    f"({top['total']} cases) — incomplete follow-up rather than a data error."
                                    if top["key"] in ("no_child", "only_adoption_visit", "only_birth_anthropometry")
                                    else f"The most common reason a case drops out is '{top['label']}' ({top['total']} cases)."))
    return out


def prevalence(p: Dict[str, Any], who: str) -> List[Dict[str, str]]:
    if not p or not p.get("n"):
        return []
    better = [i for i in R.INDICATORS if (p[i]["abs_change"] or 0) < 0]
    worse = [i for i in R.INDICATORS if (p[i]["abs_change"] or 0) > 0]
    out = []
    if len(better) == 3:
        out.append(_finding("good", f"{who} show improvement from the adoption visit to the last visit on all "
                                    f"three indicators."))
    elif better:
        out.append(_finding("info", f"{who} improve on {', '.join(R.INDICATOR_LABELS[i].lower() for i in better)}."))
    for i in worse:
        out.append(_finding("watch", f"{R.INDICATOR_LABELS[i]} worsens for {who.lower()} "
                                     f"({_f(p[i]['av'])} → {_f(p[i]['lv'])}) — worth watching."))
    return out


def compliance(c: Dict[str, Any], band: str) -> List[Dict[str, str]]:
    yes, no = c["yes"], c["no"]
    if not yes.get("n") or not no.get("n"):
        return [_finding("info", "Too few cases on one side of the visit rule to compare.")]
    lower = [i for i in R.INDICATORS if yes[i]["lv"] is not None and no[i]["lv"] is not None
             and yes[i]["lv"] < no[i]["lv"]]
    rule = c["rule"]
    label = f"{rule['min_visits']}+ growth checks over ≥{rule['min_follow_up_days']} days"
    if len(lower) == 3:
        uw = "underweight"
        return [_finding("good", f"Cases that met the visit rule ({label}) end lower at the last visit on all "
                                 f"three indicators — e.g. underweight {_f(yes[uw]['lv'])} vs {_f(no[uw]['lv'])}.")]
    if lower:
        return [_finding("info", f"Cases meeting the visit rule ({label}) end lower on "
                                 f"{', '.join(R.INDICATOR_LABELS[i].lower() for i in lower)}.")]
    return [_finding("watch", f"Meeting the visit rule ({label}) does not yet show lower malnutrition at the last visit.")]


def mtfl_vs_other(bands: Dict[str, Any]) -> List[Dict[str, str]]:
    out = []
    for band in (R.BAND_LT6, R.BAND_6_11):
        m, o = bands[band]["mtfl"], bands[band]["other"]
        if not m.get("n") or not o.get("n"):
            continue
        wins = [i for i in R.INDICATORS if m[i]["rel_change"] is not None and o[i]["rel_change"] is not None
                and m[i]["rel_change"] < o[i]["rel_change"]]
        label = R.BAND_LABELS[band]
        if len(wins) == 3:
            out.append(_finding("good", f"At {label}, MT+FL learners' relative improvement outpaces other "
                                        f"learners' on all three indicators."))
        elif wins:
            out.append(_finding("info", f"At {label}, MT+FL learners improve faster on "
                                        f"{', '.join(R.INDICATOR_LABELS[i].lower() for i in wins)}."))
        for i in R.INDICATORS:
            if (m[i]["abs_change"] or 0) > 0:
                out.append(_finding("watch", f"At {label}, MT+FL {R.INDICATOR_LABELS[i].lower()} rises "
                                             f"({_f(m[i]['av'])} → {_f(m[i]['lv'])})."))
    return out


def takeaways(r: Dict[str, Any], cmp: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    s = r["summary"]
    out = []
    blocks = _valid([b for b in r["blocks"] if b["learners"]], "intensity_pct")
    if s["fulfilment_pct"] is not None:
        out.append(_finding("good" if s["fulfilment_pct"] >= 100 else "watch",
                            f"Adoption target fulfilment stands at {_f(s['fulfilment_pct'])} of the "
                            f"{_community_target(r)}-adoption target in force."))
    if blocks:
        lo = min(blocks, key=lambda b: b["intensity_pct"])
        hi = max(blocks, key=lambda b: b["intensity_pct"])
        out.append(_finding("watch", f"Expected activity done runs {_f(lo['intensity_pct'])}–{_f(hi['intensity_pct'])} by "
                                     f"block — adoption volume is there, completion per adoption has room to "
                                     f"improve, particularly in {lo['label']}."))
    sub = {k: v for k, v in s["subtype_pct"].items() if v is not None}
    if sub:
        low = min(sub, key=sub.get)
        out.append(_finding("watch", f"{R.ACTIVITY_LABELS[low]} shows the lowest completion across activity types."))
    bands = r["outcomes"]["prevalence"]
    m, o = bands["mtfl"], bands["other"]
    if m.get("n") and o.get("n"):
        uw_m, uw_o = m["underweight"]["rel_change"], o["underweight"]["rel_change"]
        if uw_m is not None and uw_o is not None:
            out.append(_finding("good" if uw_m < uw_o else "info",
                                f"MT+FL learners' cases cut underweight by {abs(uw_m):.0f}% (relative) against "
                                f"{abs(uw_o):.0f}% for other learners."))
    gap = _widest_type_gap(s)
    if gap:
        out.append(gap)
    fl = r["flags"]["summary"]
    if fl["edd_passed"]:
        out.append(_finding("watch", f"{fl['edd_passed']} pregnant women are past their due date with no birth "
                                     f"recorded — see Follow-up flags."))
    if r["attention"]:
        out.append(_finding("watch", f"{len(r['attention'])} learners need a supervisor's call — see the "
                                     f"'needs attention' list."))
    return out


def _community_target(r: Dict[str, Any]) -> int:
    now = r["calendar"]["targets"]["now"]
    return now["anc"] + now["pnc_lt5"] + now["pnc_ge5"]


def _widest_type_gap(g: Dict[str, Any]) -> Optional[Dict[str, str]]:
    typed = [(t, v) for t, v in g["by_type"].items()
             if v["adoption_pct"] is not None and v["activity_pct"] is not None]
    if not typed:
        return None
    t, v = max(typed, key=lambda x: x[1]["adoption_pct"] - x[1]["activity_pct"])
    if v["adoption_pct"] - v["activity_pct"] < 20:
        return None
    return _finding("watch", f"{R.ADOPTION_TYPE_LABELS[t]} adoptions reach {_f(v['adoption_pct'])} of target but only "
                             f"{_f(v['activity_pct'])} of the activity they were expected to generate — adopting is "
                             f"not the same as following up.")


def by_type(r: Dict[str, Any]) -> List[Dict[str, str]]:
    """The adoption-type view: adoption met vs activity done, and which block
    is best and worst for each type."""
    s = r["summary"]
    out = []
    gap = _widest_type_gap(s)
    if gap:
        out.append(gap)
    for t in R.ADOPTION_TYPES:
        groups = [b for b in r["blocks"] if b["learners"] >= 3 and b["by_type"][t]["activity_pct"] is not None]
        if len(groups) < 2:
            continue
        best = max(groups, key=lambda b: b["by_type"][t]["activity_pct"])
        worst = min(groups, key=lambda b: b["by_type"][t]["activity_pct"])
        out.append(_finding("info", f"{R.ADOPTION_TYPE_LABELS[t]}: {best['label']} does the most of its expected "
                                    f"activity ({_f(best['by_type'][t]['activity_pct'])}), {worst['label']} the least "
                                    f"({_f(worst['by_type'][t]['activity_pct'])})."))
    return out


def own_cases(r: Dict[str, Any]) -> List[Dict[str, str]]:
    """Within the cases learners adopted: how active they are on them."""
    s = r["summary"]
    if not s["own_banded"]:
        return []
    labels = dict(R.OWN_BANDS)
    bands = s["own_bands"]
    top = max(bands, key=bands.get)
    out = [_finding("info", f"The largest group of learners ({bands[top]} of {s['own_banded']}) sits at "
                            f"{labels[top]} of the activity their own cases were due.")]
    low = bands["none"] + bands["b1_20"] + bands["b21_40"]
    if low:
        out.append(_finding("watch", f"{low} learners have filed 40% or less of what their own cases needed "
                                     f"({bands['none']} nothing at all)."))
    depts = [d for d in r["departments"] if d["key"] != "total" and d["own_banded"]]
    if len(depts) >= 2:
        def share(d):
            return 100.0 * (d["own_bands"]["b61_80"] + d["own_bands"]["b81_100"]) / d["own_banded"]
        best = max(depts, key=share)
        out.append(_finding("good", f"{best['key']} has the most learners above 60% of their cases' expected "
                                    f"activity ({share(best):.0f}%)."))
    return out


def flags(r: Dict[str, Any]) -> List[Dict[str, str]]:
    f = r["flags"]["summary"]
    if not f["open_pregnancies"]:
        return [_finding("info", "No pregnant woman is currently under follow-up.")]
    out = [_finding("info", f"{f['open_pregnancies']} pregnant women are under follow-up; {f['flagged']} need attention.")]
    if f["edd_passed"]:
        out.append(_finding("watch", f"{f['edd_passed']} are past their expected delivery date with no birth "
                                     f"entered — ask the learner whether the baby has come."))
    if f["anc_behind"]:
        out.append(_finding("watch", f"{f['anc_behind']} have missed two or more fortnightly antenatal checks."))
    if f["no_lmp"]:
        out.append(_finding("info", f"{f['no_lmp']} have no LMP recorded, so their due date cannot be tracked."))
    return out


def all_findings(r: Dict[str, Any], cmp: Optional[Dict[str, Any]]) -> Dict[str, List[Dict[str, str]]]:
    p = r["outcomes"]["prevalence"]
    return {
        "overview": overview(r),
        "blocks": blocks(r),
        "roles": roles(r),
        "subtypes": subtypes(r),
        "by_type": by_type(r),
        "own_cases": own_cases(r),
        "flags": flags(r),
        "progress": progress(cmp) if cmp else [],
        "outcomes": outcomes(r),
        "overall": prevalence(p["overall"], "All analysed cases"),
        "mtfl": prevalence(p["mtfl"], "MT+FL learners' cases"),
        "other": prevalence(p["other"], "Other learners' cases"),
        "compliance_lt6": compliance(r["outcomes"]["compliance"][R.BAND_LT6], R.BAND_LT6),
        "compliance_6_11": compliance(r["outcomes"]["compliance"][R.BAND_6_11], R.BAND_6_11),
        "bands": mtfl_vs_other(p["bands"]),
        "takeaways": takeaways(r, cmp),
    }
