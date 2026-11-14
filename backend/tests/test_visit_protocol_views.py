"""What the worker app reads from the visit protocol besides "which forms":
the points coming back when breastfeeding reopens, the tag beside each form,
the complementary feeding gate, the visit line, and the progress counts
(app/visit_protocol.py; the Learner Redesign and Visit Flows reviews,
built 14 Nov 2026).

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_visit_protocol_views.py -v
"""
from __future__ import annotations

from datetime import timedelta

from app import visit_protocol as VP
from app.visit_protocol import Form
from tests.test_visit_protocol import anc, bf, cg, d, pf, pnc, run


# ── Points come back when breastfeeding reopens ───────────────────────────

GREEN_TWICE = (cg(0, -0.4), bf(0, green={"latch"}, all_green=True),
               cg(1, -0.3), bf(1, green={"latch"}, all_green=True))


def test_points_dropped_before_a_reopening_come_back():
    stopped = pnc(10, *GREEN_TWICE)
    assert VP.hidden_bf_questions(stopped, d(1)) == ["latch"]
    reopened = pnc(10, *GREEN_TWICE, cg(2, -0.6))           # fell below the 30th percentile
    assert VP.bf_status(reopened, d(2))["status"] == "reopened"
    assert VP.hidden_bf_questions(reopened, d(2)) == []


def test_after_a_reopening_two_new_green_forms_drop_a_point_again():
    case = pnc(10, *GREEN_TWICE, cg(2, -0.6), bf(2, green={"latch"}), cg(3, -0.5), bf(3, green={"latch"}))
    assert VP.hidden_bf_questions(case, d(3)) == ["latch"]
    one_since = pnc(10, *GREEN_TWICE, cg(2, -0.6), bf(2, green={"latch"}))
    assert VP.hidden_bf_questions(one_since, d(2)) == []


def test_without_a_date_every_form_counts_as_before():
    assert VP.hidden_bf_questions(pnc(10, *GREEN_TWICE, cg(2, -0.6))) == ["latch"]


def test_plan_reports_the_points_as_of_its_day():
    case = pnc(10, *GREEN_TWICE, cg(2, -0.6))
    assert VP.plan(case, d(2))["bf"]["hidden_questions"] == []


# ── Why each form is there ────────────────────────────────────────────────

def test_bucket_3_day_0_tags():
    case = pnc(200)
    tags = VP.form_reasons(case, d(0), VP.forms_at(case, d(0)))
    assert tags["gm"] == {"kind": "every_visit"}
    assert tags["bf"] == {"kind": "count", "n": 1, "of": 5}
    assert tags["cf"] == {"kind": "cf", "n": 1}
    assert tags["protein"] == {"kind": "first"}


def test_a_missed_bucket_3_bf_day_is_a_catch_up():
    _, case = run(pnc(200), [0])                             # day 1 missed
    tags = VP.form_reasons(case, d(2), VP.forms_at(case, d(2)))
    assert tags["bf"] == {"kind": "catch_up", "n": 2, "of": 5}


def test_bucket_2_bf_tag_follows_the_rule():
    assert VP.form_reasons(pnc(10), d(0), ["bf"])["bf"] == {"kind": "until_good", "n": 1}
    reopened = pnc(10, *GREEN_TWICE, cg(2, -0.6))
    assert VP.form_reasons(reopened, d(2), ["bf"])["bf"]["kind"] == "reopened"


def test_protein_tag_after_the_first():
    case = pnc(10, pf(0))
    assert VP.form_reasons(case, d(14), ["protein"])["protein"] == {"kind": "every_15"}


# ── Complementary feeding not before its day ──────────────────────────────

def test_cf_allowed_on_its_day_and_refused_between():
    assert VP.cf_gate(pnc(200), d(0))["allowed"] is True
    _, case = run(pnc(200), [0])
    gate = VP.cf_gate(case, d(1))
    assert gate["allowed"] is False and gate["reason"] == "too_early"
    assert (gate["last_on"], gate["last_no"]) == (d(0).isoformat(), 1)
    assert (gate["next_on"], gate["next_no"], gate["next_day"]) == (d(5).isoformat(), 2, 5)


def test_cf_filled_today_is_not_offered_again():
    assert VP.cf_gate(pnc(200, Form("cf", d(0))), d(0))["reason"] == "done_today"


def test_cf_before_180_days_says_when_it_starts():
    gate = VP.cf_gate(pnc(30), d(1))
    assert gate["reason"] == "not_started" and gate["next_no"] == 1
    # The first planned visit at 180 days or older: day 162 (192 days old).
    assert gate["next_on"] == d(162).isoformat()


def test_no_cf_while_pregnant():
    assert VP.cf_gate(anc(100), d(0))["reason"] == "not_applicable"


# ── The visit line ────────────────────────────────────────────────────────

def test_timeline_marks_done_missed_and_due():
    _, case = run(pnc(10), [0, 1, 2])
    line = VP.timeline(case, d(5))
    first = line["lines"][0]
    assert first["key"] == "pnc"
    states = [(v["day"], v["state"]) for v in first["visits"][:6]]
    assert states == [(0, "done"), (1, "done"), (2, "done"), (3, "missed"), (5, "due"), (7, "later")]
    current = line["current"]
    assert (current["n"], current["done"], current["missed"], current["state"]) == (5, 3, 1, "due")
    assert current["total"] == sum(len(ln["visits"]) for ln in line["lines"])
    # Bucket 2 switches to the CF schedule at 180 days: a second line.
    assert [ln["key"] for ln in line["lines"]] == ["pnc", "cf"]


def test_timeline_next_visit_when_nothing_is_due():
    _, case = run(pnc(10), [0, 1, 2, 3])
    current = VP.timeline(case, d(4))["current"]
    assert (current["state"], current["n"]) == ("next", 5)


def test_timeline_of_a_pregnancy_runs_to_the_due_date():
    line = VP.timeline(anc(100), d(0))
    assert [ln["key"] for ln in line["lines"]] == ["anc"]
    days = [v["day"] for v in line["lines"][0]["visits"]]
    assert days[0] == 0 and all(b - a == VP.ANC_EVERY_DAYS for a, b in zip(days, days[1:]))
    assert d(days[-1]) <= d(0) + timedelta(days=VP.PREGNANCY_DAYS - 100)


def test_no_timeline_after_a_drop_out():
    assert VP.timeline(pnc(10, dropped_out_on=d(3)), d(5)) == {"lines": [], "current": None}


# ── Progress ──────────────────────────────────────────────────────────────

def test_progress_counts_visits_and_forms_due_by_today():
    _, case = run(pnc(10), [0, 1, 2, 3, 5])
    p = VP.progress(case, d(7))                              # day 7 due today, not yet made
    assert p["visits"] == {"due": 6, "made": 5, "on_time": 5}
    assert (p["expected"]["gm"], p["done"]["gm"]) == (6, 5)
    assert p["expected"]["bf"] >= p["done"]["bf"] > 0


def test_progress_expects_protein_once_per_15_days_when_visits_are_missed():
    case = pnc(10, cg(0), bf(0), pf(0))                     # only the adoption visit made
    p = VP.progress(case, d(20))
    assert p["expected"]["protein"] == 2                     # day 0, then one ~15 days on
    assert p["done"]["protein"] == 1


def test_progress_of_a_pregnancy():
    case = anc(100, Form("anc", d(0)), pf(0), Form("anc", d(15)), pf(15))
    p = VP.progress(case, d(31))
    assert p["visits"] == {"due": 3, "made": 2, "on_time": 2}
    assert (p["expected"]["anc"], p["done"]["anc"]) == (3, 2)
