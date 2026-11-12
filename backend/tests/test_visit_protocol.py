"""The November 2026 visit protocol (docs/visit-protocol-2026-11.md): the
pure planner in app/visit_protocol.py, row by row of the spec's tables and
branch by branch of its breastfeeding and protein rules.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_visit_protocol.py -v
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta
from typing import Callable, List, Optional, Sequence, Tuple

import pytest

from app import visit_protocol as VP
from app.visit_protocol import Case, Form

D0 = date(2026, 11, 2)            # the adoption visit, day 0


def d(n: int) -> date:
    return D0 + timedelta(days=n)


def pnc(age_at_adoption: int, *forms: Form, split: int = 180, **kw) -> Case:
    """A PNC adoption: the baby `age_at_adoption` days old on day 0."""
    return Case(adopted=D0, dob=D0 - timedelta(days=age_at_adoption), child_adopted=D0,
                forms=tuple(forms), pnc_split_days=split, **kw)


def anc(gestation_days_at_adoption: int, *forms: Form, **kw) -> Case:
    return Case(adopted=D0, lmp=D0 - timedelta(days=gestation_days_at_adoption), forms=tuple(forms), **kw)


def cg(n: int, waz: Optional[float] = None, breastfed: Optional[bool] = True) -> Form:
    return Form("gm", d(n), waz=waz, breastfed=breastfed)


def bf(n: int, green: Sequence[str] = (), all_green: Optional[bool] = None) -> Form:
    return Form("bf", d(n), green=frozenset(green), all_green=all_green)


def pf(n: int, hq: float = 10.0, total: float = 30.0) -> Form:
    return Form("protein", d(n), hq_g=hq, total_g=total)


def run(case: Case, days: Sequence[int], *, bf_green: bool = False,
        waz: Callable[[int], Optional[float]] = lambda n: None,
        protein: Tuple[float, float] = (10.0, 30.0), breastfed: bool = True) -> Tuple[List[Tuple[int, List[str]]], Case]:
    """Visit on each day, filling exactly the forms the planner asks for."""
    seen = []
    for n in days:
        on = d(n)
        forms = VP.forms_at(case, on)
        seen.append((n, forms))
        new = []
        for code in forms:
            if code == "gm":
                new.append(Form("gm", on, waz=waz(n), breastfed=breastfed))
            elif code == "bf":
                new.append(Form("bf", on, all_green=bf_green, green=frozenset({"q1"} if bf_green else set())))
            elif code == "protein":
                new.append(Form("protein", on, hq_g=protein[0], total_g=protein[1]))
            else:
                new.append(Form(code, on))
        case = replace(case, forms=case.forms + tuple(new))
    return seen, case


# ── Adoption types ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("dob_offset, child_adopted_offset, split, expected", [
    (None, None, 180, "anc"),       # no baby yet: adopted while pregnant
    (20, 25, 180, "anc"),           # born after the adoption: still an ANC adoption
    (-10, 0, 180, "pnc_lt"),        # 10 days old
    (-179, 0, 180, "pnc_lt"),       # one day under the split
    (-180, 0, 180, "pnc_ge"),       # 180 days or older
    (-160, 0, 150, "pnc_ge"),       # the legacy 150-day split puts 160 days in bucket 3
    (-160, 0, 180, "pnc_lt"),       # … the new 180-day split in bucket 2
])
def test_buckets(dob_offset, child_adopted_offset, split, expected):
    case = Case(adopted=D0, lmp=D0 - timedelta(days=200),
                dob=d(dob_offset) if dob_offset is not None else None,
                child_adopted=d(child_adopted_offset) if child_adopted_offset is not None else None,
                pnc_split_days=split)
    assert VP.bucket(case) == expected


@pytest.mark.parametrize("bucket, forms", [
    ("anc", ["mf", "anc", "protein"]),
    ("pnc_lt", ["mf", "chf", "gm", "bf", "protein"]),
    ("pnc_ge", ["mf", "chf", "gm", "bf", "cf", "protein"]),
])
def test_day_zero_registration_order(bucket, forms):
    assert VP.registration_forms(bucket) == forms


def test_delivery_path_order():
    assert VP.DELIVERY_PATH == ("chf", "gm", "bf", "protein")
    assert VP.NO_DELIVERY_PATH == ("anc", "protein")


# ── Bucket 1 · ANC ─────────────────────────────────────────────────────────

def test_anc_every_15_days_af_and_pf():
    seen, _ = run(anc(150), [0, 15, 30, 45])
    assert seen == [(0, ["anc", "protein"]), (15, ["anc", "protein"]), (30, ["anc", "protein"]),
                    (45, ["anc", "protein"])]
    assert [s.day for s in VP.schedule(anc(150), d(60))] == [0, 15, 30, 45, 60]


@pytest.mark.parametrize("gestation_days, ask", [
    (244, False),   # 34 weeks 6 days
    (245, True),    # 35 weeks
    (260, True),
])
def test_delivery_question_from_35_weeks(gestation_days, ask):
    case = anc(gestation_days - 15)
    assert VP.ask_delivery(case, d(15)) is ask


def test_delivery_question_when_the_pregnancy_date_is_unknown():
    case = Case(adopted=D0)
    assert VP.ask_delivery(case, d(15)) is True
    # … and from the expected delivery date when there is no LMP
    by_edd = Case(adopted=D0, edd=d(15) + timedelta(days=280 - 240))
    assert VP.ask_delivery(by_edd, d(15)) is False


def test_delivery_no_keeps_af_and_pf_and_asks_again():
    case = anc(240, Form("anc", d(0)), pf(0))
    assert VP.forms_at(case, d(15)) == ["anc", "protein"]
    assert VP.ask_delivery(case, d(15)) is True
    _, case = run(case, [15])
    assert VP.ask_delivery(case, d(30)) is True and VP.forms_at(case, d(30)) == ["anc", "protein"]


def test_delivery_yes_moves_to_bucket_2_from_the_first_visit_after_delivery():
    before = anc(240, Form("anc", d(0)), pf(0, 50, 90), Form("anc", d(15)), pf(15, 50, 90))
    delivered = replace(before, dob=d(20), child_adopted=d(25))
    assert VP.bucket(delivered) == "anc"                        # the adoption type does not change
    assert VP.phase(delivered) == "pnc"
    assert VP.pnc_anchor(delivered) == d(25)
    # ChF → CG → BF, and PF: pregnancy protein forms do not count after delivery.
    assert VP.forms_at(delivered, d(25)) == ["gm", "bf", "protein"]
    _, after = run(delivered, [25])
    assert VP.forms_at(after, d(26)) == ["gm", "bf"]           # day 1 after delivery: no AF any more
    assert [s.day for s in VP.schedule(after, d(40))][:6] == [0, 1, 2, 3, 5, 7]
    assert VP.schedule(after, d(40))[1].due_on == d(26)


# ── Bucket 2 · PNC under 6 months ──────────────────────────────────────────

B2_DAYS = [0, 1, 2, 3, 5, 7, 10, 12, 14, 21, 28, 42, 72, 102, 132]


def test_bucket_2_visit_days():
    assert [s.day for s in VP.schedule(pnc(10), d(140))] == B2_DAYS


def test_bucket_2_forms_at_every_visit():
    # Breastfeeding answers never all green: BF at every visit. PF on day 0,
    # then every 15 days at the nearest visit, never under 10 days apart.
    seen, _ = run(pnc(10), B2_DAYS[:13])
    assert seen == [
        (0, ["gm", "bf", "protein"]), (1, ["gm", "bf"]), (2, ["gm", "bf"]), (3, ["gm", "bf"]),
        (5, ["gm", "bf"]), (7, ["gm", "bf"]), (10, ["gm", "bf"]), (12, ["gm", "bf"]),
        (14, ["gm", "bf", "protein"]), (21, ["gm", "bf"]), (28, ["gm", "bf", "protein"]),
        (42, ["gm", "bf", "protein"]), (72, ["gm", "bf", "protein"]),
    ]


def test_cf_schedule_starts_at_the_first_visit_at_180_days():
    # Adopted at 10 days: day 162 is 172 days old, day 192 is 202 days old.
    days = B2_DAYS + [162, 192]
    seen, case = run(pnc(10), days)
    assert "cf" not in seen[-2][1]
    assert "cf" in seen[-1][1] and "bf" not in seen[-1][1]           # 5 BF forms already done
    later = [s for s in VP.schedule(case, d(300)) if s.due_on > d(192)]
    assert [(s.due_on - d(192)).days for s in later][:6] == [5, 10, 15, 30, 45, 60]
    assert [s.cf_no for s in later][:6] == [2, 3, 4, 5, 6, 7]
    assert all(s.segment == "cf" for s in later)
    assert VP.forms_at(case, d(197)) == ["gm", "cf"]


def test_an_extra_visit_at_180_days_is_cf_day_0():
    seen, case = run(pnc(10), B2_DAYS + [162, 175])                  # day 175 = 185 days old
    assert "cf" in seen[-1][1]
    later = [s.due_on for s in VP.schedule(case, d(260)) if s.due_on > d(175)]
    assert later[:3] == [d(180), d(185), d(190)]


def test_monthly_until_one_year_then_every_three_months_after_cf_switch():
    seen, case = run(pnc(10), B2_DAYS + [162, 192])
    c0 = d(192)                                                      # 202 days old
    tail = [(s.due_on - c0).days for s in VP.schedule(case, d(192 + 400)) if s.due_on >= c0]
    # C+60 is 262 days old; monthly to 352 days; the next month would be 382 > 1 year.
    assert tail[:11] == [0, 5, 10, 15, 30, 45, 60, 90, 120, 150, 240]


# ── Bucket 3 · PNC 6 months or older ───────────────────────────────────────

def test_bucket_3_table():
    seen, _ = run(pnc(200), [0, 1, 2, 3, 5, 10, 15, 30, 45, 60, 90])
    assert seen == [
        (0, ["gm", "bf", "cf", "protein"]),   # MF · ChF · CG · BF-1 · CF-1 · PF
        (1, ["gm", "bf"]),                    # CG · BF-2
        (2, ["gm", "bf"]),                    # CG · BF-3
        (3, ["gm", "bf"]),                    # CG · BF-4
        (5, ["gm", "bf", "cf"]),              # CG · BF-5 · CF-2
        (10, ["gm", "cf"]),                   # CG · CF-3
        (15, ["gm", "cf", "protein"]),        # CG · CF-4 (PF 15 days after the first)
        (30, ["gm", "cf", "protein"]),        # CG · CF-5
        (45, ["gm", "cf", "protein"]),        # CG · CF-6
        (60, ["gm", "cf", "protein"]),        # CG · CF-7
        (90, ["gm", "cf", "protein"]),        # monthly CF
    ]
    labels = {s.day: s.cf_no for s in VP.schedule(pnc(200), d(60))}
    assert labels == {0: 1, 1: None, 2: None, 3: None, 5: 2, 10: 3, 15: 4, 30: 5, 45: 6, 60: 7}


def test_bucket_3_first_birthday_switch():
    # 200 days old on day 0: day 150 is 350 days old; a month later would be
    # past the first birthday, so the next visit is three months on.
    days = [s.day for s in VP.schedule(pnc(200), d(400))]
    assert [x for x in days if x >= 60] == [60, 90, 120, 150, 240, 330]


def test_bucket_3_missed_bf_forms_are_caught_up():
    seen, _ = run(pnc(200), [0, 3, 5, 10, 15, 30])
    assert seen == [
        (0, ["gm", "bf", "cf", "protein"]),   # BF-1
        (3, ["gm", "bf"]),                    # BF-2 (days 1 and 2 missed)
        (5, ["gm", "bf", "cf"]),              # BF-3
        (10, ["gm", "bf", "cf"]),             # BF-4
        (15, ["gm", "bf", "cf", "protein"]),  # BF-5
        (30, ["gm", "cf", "protein"]),        # five done: no more BF
    ]


def test_bucket_3_no_bf_when_the_mother_is_not_breastfeeding():
    case = pnc(200, cg(0), bf(0), Form("cf", d(0)), pf(0), cg(1, breastfed=False))
    assert VP.forms_at(case, d(1)) == ["gm"]
    assert VP.feeding_state(case)["state"] == "not_breastfeeding"      # no drop-out in bucket 3


# ── The ±2-day tolerance ───────────────────────────────────────────────────

def test_a_visit_two_days_early_counts_for_the_due_day():
    case = anc(150, Form("anc", d(0)), pf(0))
    assert VP.visit_slot(case, d(13)).day == 15
    _, case = run(case, [13])
    p = VP.plan(case, d(13))
    assert p["next"]["due_on"] == d(30).isoformat()


def test_a_visit_three_days_early_does_not_count():
    case = anc(150, Form("anc", d(0)), pf(0))
    assert VP.visit_slot(case, d(12)) is None
    assert VP.forms_at(case, d(12)) == []
    assert VP.plan(case, d(12))["next"]["due_on"] == d(15).isoformat()


def test_visit_on_day_2_counts_for_day_2_not_day_1_or_3():
    _, case = run(pnc(200), [0])
    assert VP.visit_slot(case, d(2)).day == 2
    seen, case = run(case, [2])
    assert seen == [(2, ["gm", "bf"])]
    assert VP.plan(case, d(2))["next"]["due_on"] == d(3).isoformat()


def test_a_visit_between_two_due_days_counts_for_the_earlier():
    _, case = run(pnc(10), [0, 1, 2])
    assert VP.visit_slot(case, d(4)).day == 3          # day 3 and day 5 are both 1 day away


def test_a_visit_within_two_days_of_a_later_due_day_moves_on():
    _, case = run(pnc(200), [0])
    slot = VP.visit_slot(case, d(8))
    assert (slot.day, slot.cf_no) == (10, 3)
    assert VP.forms_at(case, d(8)) == ["gm", "bf", "cf"]


def test_a_late_visit_counts_for_the_visit_that_was_missed():
    _, case = run(pnc(10), B2_DAYS[:11])                  # to day 28; day 42 missed
    assert VP.visit_slot(case, d(55)).day == 42           # 13 days late, before day 72
    p = VP.plan(case, d(55))
    assert p["next"]["due_on"] == d(42).isoformat() and p["next"]["late_days"] == 13


# ── Breastfeeding rule (bucket 2) ──────────────────────────────────────────

@pytest.mark.parametrize("green1, green2, waz, change, due", [
    (True, True, -0.30, 0.10, False),     # all green, above P30, gaining: BF stops
    (True, True, -0.52, 0.00, False),     # the boundaries count (z ≥ −0.52, change ≥ 0)
    (True, True, -0.60, 0.20, True),      # below P30 keeps BF even when gaining
    (True, True, -0.53, 0.00, True),
    (True, True, 0.00, -0.10, True),      # a falling z-score keeps BF even when all green
    (True, False, 0.00, 0.10, True),      # the last two are not both green
    (False, True, 0.00, 0.10, True),
])
def test_bf_stop_rule(green1, green2, waz, change, due):
    case = pnc(10, cg(0, waz - change), bf(0, all_green=green1), cg(1, waz), bf(1, all_green=green2))
    assert ("bf" in VP.forms_at(case, d(2))) is due


def test_bf_stops_from_the_next_visit_not_the_same_one():
    case = pnc(10, cg(0, -0.4), bf(0, all_green=True), cg(1, -0.3))
    assert "bf" in VP.forms_at(case, d(1))                  # the second green form is still filled


def test_bf_needs_two_back_to_back_green_forms():
    case = pnc(10, cg(0, 0.0), bf(0, all_green=True), cg(1, 0.1), bf(1, all_green=False),
               cg(2, 0.2), bf(2, all_green=True))
    assert "bf" in VP.forms_at(case, d(3))
    case = replace(case, forms=case.forms + (cg(3, 0.3), bf(3, all_green=True)))
    assert "bf" not in VP.forms_at(case, d(5))


def test_bf_without_a_previous_check_cannot_stop():
    case = pnc(10, bf(0, all_green=True), cg(1, 0.0), bf(1, all_green=True))
    assert "bf" in VP.forms_at(case, d(2))                  # no z-score change to read yet


STOPPED = (cg(0, -0.4), bf(0, all_green=True), cg(1, -0.3), bf(1, all_green=True))


@pytest.mark.parametrize("waz, due", [
    (-0.60, True),      # fell below the 30th percentile: BF reopens at this visit
    (-0.35, True),      # z-score change turned negative
    (-0.30, False),     # unchanged: stays stopped
    (-0.10, False),
])
def test_bf_reopens(waz, due):
    case = pnc(10, *STOPPED, cg(2, waz))
    assert ("bf" in VP.forms_at(case, d(2))) is due
    assert VP.bf_status(case, d(2))["status"] == ("reopened" if due else "stopped")


def test_bf_reopened_stops_again_after_two_more_green_forms():
    case = pnc(10, *STOPPED, cg(2, -0.6), bf(2, all_green=True), cg(3, -0.5), bf(3, all_green=True))
    assert VP.bf_status(case, d(5)) == {"due": False, "status": "stopped", "count": 4}


def test_a_late_visit_after_180_days_is_cf_day_0():
    # Adopted at 30 days: day 132 is 162 days old, the next visit (day 162)
    # would be 192 days old. Not visited by day 167: that visit is 5 days late
    # and, made today at 197 days, it is CF day 0.
    _, case = run(pnc(30), B2_DAYS)
    p = VP.plan(case, d(167))
    assert (p["next"]["due_on"], p["next"]["late_days"]) == (d(162).isoformat(), 5)
    assert "cf" in p["next"]["forms"] and p["next"]["cf_no"] == 1


def test_bf_stopped_stays_stopped_without_a_new_check():
    case = pnc(10, *STOPPED)
    assert VP.bf_status(case, d(5)) == {"due": False, "status": "stopped", "count": 2}


def test_at_180_days_bf_continues_until_five_are_done():
    # Adopted at 170 days; BF stops by the rule after two green forms, then
    # resumes at the 180-day visit (CF day 0) until five are done.
    seen, _ = run(pnc(170), [0, 1, 2, 3, 5, 7, 10, 15, 20, 25], bf_green=True, waz=lambda n: -0.3 + 0.01 * n)
    bf_days = [n for n, forms in seen if "bf" in forms]
    assert bf_days == [0, 1, 10, 15, 20]
    assert "cf" in dict(seen)[10]


def test_at_180_days_bf_stops_when_five_are_done():
    seen, _ = run(pnc(170), [0, 1, 2, 3, 5, 10])          # never all green: BF at every visit
    assert "bf" not in dict(seen)[10] and "cf" in dict(seen)[10]


# ── Points drop out ────────────────────────────────────────────────────────

@pytest.mark.parametrize("greens, hidden", [
    ([{"a", "b"}, {"a"}], ["a"]),                         # green twice running: dropped
    ([{"a"}, set(), {"a"}], []),                          # not back to back
    ([{"a"}, {"a", "b"}, {"b"}], ["a", "b"]),
    ([{"a"}, {"a"}, {"b"}, {"b"}], ["a", "b"]),           # once dropped, stays dropped
    ([{"a"}], []),
])
def test_points_drop_out(greens, hidden):
    case = pnc(10, *[bf(i, green=g) for i, g in enumerate(greens)])
    assert VP.hidden_bf_questions(case) == hidden


def test_points_drop_out_only_in_bucket_2():
    assert VP.hidden_bf_questions(pnc(200, bf(0, green={"a"}), bf(1, green={"a"}))) == []


# ── Mother's protein form ──────────────────────────────────────────────────

def test_pf_first_at_adoption_then_every_15_days_at_the_nearest_visit():
    case = pnc(10)
    assert "protein" in VP.forms_at(case, d(0))
    case = pnc(10, pf(0))
    assert "protein" not in VP.forms_at(case, d(12))
    assert "protein" in VP.forms_at(case, d(14))          # day 14 is the visit nearest day 15


def test_pf_never_under_10_days_after_the_previous():
    case = pnc(10, pf(5))                                 # done late, on day 5
    assert "protein" not in VP.forms_at(case, d(14))      # 9 days: too soon
    assert "protein" in VP.forms_at(case, d(21))          # the visit nearest day 20


Q, N = (40.0, 80.0), (39.9, 90.0)


@pytest.mark.parametrize("history, stopped", [
    ([Q, Q], True),                  # two consecutive, each ≥ 40 g HQ and ≥ 80 g total
    ([Q, N, Q], False),              # not consecutive
    ([Q, N, Q, Q], True),
    ([(45.0, 79.9), Q], False),      # total under 80 g
    ([N, N], False),
])
def test_pf_stops_for_good(history, stopped):
    days = [0, 14, 28, 42][:len(history)]
    case = pnc(10, *[pf(n, hq, total) for n, (hq, total) in zip(days, history)])
    assert VP.pf_status(case, d(72))["stopped"] is stopped
    assert ("protein" in VP.forms_at(case, d(72))) is (not stopped)


def test_pf_in_pregnancy_has_no_stop_rule():
    case = anc(150, Form("anc", d(0)), pf(0, *Q), Form("anc", d(15)), pf(15, *Q))
    assert VP.forms_at(case, d(30)) == ["anc", "protein"]


# ── Mother not breastfeeding: counselling and drop-out ─────────────────────

def test_counselling_then_drop_out_after_two_visits():
    base = pnc(10, cg(0), cg(5, breastfed=False))
    assert VP.feeding_state(base)["state"] == "counsel"
    assert "bf" not in VP.forms_at(base, d(5))
    counselled = replace(base, counselled_on=d(5))
    assert VP.feeding_state(counselled)["state"] == "counselled"
    one = replace(counselled, forms=counselled.forms + (cg(7, breastfed=False),))
    assert VP.feeding_state(one) == {"state": "counselled", "since": d(5).isoformat(),
                                     "counselled_on": d(5).isoformat(), "visits_after": 1}
    two = replace(one, forms=one.forms + (cg(10, breastfed=False),))
    assert VP.feeding_state(two)["state"] == "can_drop_out"


def test_breastfeeding_restarted_clears_the_counselling():
    case = pnc(10, cg(0), cg(5, breastfed=False), cg(7, breastfed=True), counselled_on=d(5))
    assert VP.feeding_state(case)["state"] == "ok"
    again = replace(case, forms=case.forms + (cg(10, breastfed=False),))
    assert VP.feeding_state(again)["state"] == "counsel"     # the old counselling was for the old stop


def test_a_dropped_out_adoption_has_no_more_visits():
    case = pnc(10, cg(0), dropped_out_on=d(12))
    p = VP.plan(case, d(14))
    assert p["dropped_out"] is True and p["next"] is None and p["later"] == []
    assert VP.forms_at(case, d(14)) == []


# ── The plan for a day ─────────────────────────────────────────────────────

def test_plan_next_visit_and_what_today_means():
    _, case = run(pnc(10), [0])
    p = VP.plan(case, d(0))
    assert p["bucket"] == "pnc_lt" and p["phase"] == "pnc"
    assert p["next"] == {"due_on": d(1).isoformat(), "late_days": 0, "forms": ["gm", "bf"],
                         "day": 1, "cf_no": None, "ask_delivery": False, "unfinished": False}
    late = VP.plan(case, d(4))
    assert (late["next"]["due_on"], late["next"]["late_days"]) == (d(3).isoformat(), 1)


def test_plan_carries_on_a_visit_begun_today():
    _, case = run(pnc(10), [0])
    case = replace(case, forms=case.forms + (cg(1),))
    p = VP.plan(case, d(1))
    assert p["today"] == {"visited": True, "forms": ["gm", "bf"], "done": ["gm"], "pending": ["bf"]}
    assert p["next"]["unfinished"] is True and p["next"]["forms"] == ["gm", "bf"]
    case = replace(case, forms=case.forms + (bf(1),))
    assert VP.plan(case, d(1))["next"]["due_on"] == d(2).isoformat()


def test_plan_lists_the_visits_after_the_next():
    _, case = run(pnc(10), [0])
    later = VP.plan(case, d(0), horizon_days=7)["later"]
    assert [v["due_on"] for v in later] == [d(2).isoformat(), d(3).isoformat(), d(5).isoformat(),
                                             d(7).isoformat()]
    assert all(v["forms"][0] == "gm" for v in later)


def test_plan_for_a_pregnancy_asks_about_the_delivery():
    case = anc(240, Form("anc", d(0)), pf(0))
    p = VP.plan(case, d(15))
    assert p["phase"] == "anc" and p["next"]["ask_delivery"] is True
    assert p["next"]["forms"] == ["anc", "protein"] and p["next"]["due_on"] == d(15).isoformat()


def test_plan_bf_block_reports_hidden_points_and_status():
    case = pnc(10, cg(0, 0.0), bf(0, green={"a"}, all_green=False), cg(1, 0.1), bf(1, green={"a"}, all_green=False))
    p = VP.plan(case, d(1))
    assert p["bf"]["hidden_questions"] == ["a"]
    assert p["bf"]["count"] == 2 and p["bf"]["status"] == "active"


def test_twins_carry_the_protein_form_on_one_baby_only():
    case = pnc(10, mother_forms_here=False)
    assert VP.forms_at(case, d(0)) == ["gm", "bf"]
