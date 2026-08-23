"""Validation rules for flat (field-list) form submissions.

`_snapshot_flat_answers` is the server-side authority: the browser can be
bypassed entirely, so every rule the learner runner enforces has to hold here
too. It is a pure function — no database, no app boot — so these run as plain
unit tests.

    cd backend && venv/bin/python -m pytest tests/          # POSIX
    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/   # Windows

Install the runner first: `pip install -r requirements-dev.txt`.
"""

from datetime import date

import pytest
from fastapi import HTTPException

from app.routers.forms import OTHER_OPTION_VALUE, AnswerIn, _snapshot_flat_answers


def _schema(**overrides):
    """One radio field 'q' with options A/B, plus whatever the test overrides."""
    field = {
        "id": "q",
        "label": "Q",
        "type": "radio",
        "required": True,
        "options": [{"value": "a", "label": "A"}, {"value": "b", "label": "B"}],
    }
    field.update(overrides)
    return {"fields": [field]}


def _run(schema, answers, *, enforce=True):
    return _snapshot_flat_answers(schema, answers, None, date.today(), enforce)


def _answer(*option_ids, value=None):
    return AnswerIn(nodeId="q", optionIds=list(option_ids), value=value)


# ── a real option ────────────────────────────────────────────────────────────

def test_valid_option_is_accepted_and_labelled():
    snaps, summary, _ = _run(_schema(), [_answer("a")])

    assert [s["nodeId"] for s in snaps] == ["q"]
    assert snaps[0]["selected"] == [
        {
            "optionId": "a",
            "label": "A",
            "verdict": None,
            "action": {"type": "none", "message": "", "url": "", "startSeconds": None, "endSeconds": None},
        }
    ]
    assert summary["answered"] == 1
    assert summary["total"] == 1


def test_checkbox_keeps_every_selected_option():
    schema = _schema(type="checkbox")
    snaps, _, _ = _run(schema, [_answer("a", "b")])

    assert [s["optionId"] for s in snaps[0]["selected"]] == ["a", "b"]


# ── an option the form does not define ───────────────────────────────────────

def test_unknown_option_is_rejected_on_submit():
    with pytest.raises(HTTPException) as excinfo:
        _run(_schema(), [_answer("garbage")])

    assert excinfo.value.status_code == 400
    assert "unknown answer option" in excinfo.value.detail


def test_unknown_option_cannot_satisfy_a_required_field():
    """The bug this guards: `answered` was computed from the raw id list, so a
    junk id passed the required check and stored `selected: []` — a required
    question recorded as answered with no answer."""
    with pytest.raises(HTTPException) as excinfo:
        _run(_schema(required=True), [_answer("garbage")])

    assert excinfo.value.status_code == 400


def test_unknown_option_mixed_with_a_real_one_is_still_rejected():
    with pytest.raises(HTTPException):
        _run(_schema(type="checkbox"), [_answer("a", "garbage")])


def test_unknown_option_is_tolerated_on_a_draft():
    """Drafts may be partial or stale; they are re-validated on submit."""
    snaps, summary, _ = _run(_schema(), [_answer("garbage")], enforce=False)

    # Dropped rather than stored — and with nothing left, the field is unanswered.
    assert snaps == []
    assert summary["answered"] == 0
    assert summary["total"] == 1


def test_draft_keeps_the_real_option_and_drops_the_junk():
    snaps, _, _ = _run(_schema(type="checkbox"), [_answer("a", "garbage")], enforce=False)

    assert [s["optionId"] for s in snaps[0]["selected"]] == ["a"]


def test_field_without_authored_options_still_accepts_anything():
    """Deliberate escape hatch: with no options in the schema there is nothing
    to validate against, so such a field keeps its long-standing behaviour."""
    snaps, _, _ = _run(_schema(options=[]), [_answer("whatever")])

    assert [s["optionId"] for s in snaps[0]["selected"]] == ["whatever"]


# ── the semi-open "Other" answer ─────────────────────────────────────────────

def test_other_is_accepted_when_the_field_allows_it():
    snaps, _, _ = _run(_schema(allowOther=True), [_answer(OTHER_OPTION_VALUE, value="Ramesh")])

    assert snaps[0]["selected"][0]["optionId"] == OTHER_OPTION_VALUE
    assert snaps[0]["selected"][0]["label"] == "Other: Ramesh"
    # The typed text is kept verbatim alongside the label.
    assert snaps[0]["value"] == "Ramesh"


def test_other_alongside_a_listed_option_on_a_checkbox():
    schema = _schema(type="checkbox", allowOther=True)
    snaps, _, _ = _run(schema, [_answer("a", OTHER_OPTION_VALUE, value="Chickenpox")])

    assert [s["label"] for s in snaps[0]["selected"]] == ["A", "Other: Chickenpox"]


def test_other_with_no_text_is_rejected_on_submit():
    with pytest.raises(HTTPException) as excinfo:
        _run(_schema(allowOther=True), [_answer(OTHER_OPTION_VALUE)])

    assert excinfo.value.status_code == 400
    assert "Other" in excinfo.value.detail


def test_other_with_no_text_is_tolerated_on_a_draft():
    snaps, _, _ = _run(_schema(allowOther=True), [_answer(OTHER_OPTION_VALUE)], enforce=False)

    assert snaps[0]["selected"][0]["label"] == "Other"


def test_other_is_rejected_when_the_field_does_not_allow_it():
    """Without `allowOther` the sentinel is just another undefined option."""
    with pytest.raises(HTTPException) as excinfo:
        _run(_schema(allowOther=False), [_answer(OTHER_OPTION_VALUE, value="sneaky")])

    assert excinfo.value.status_code == 400


def test_other_is_dropped_on_a_draft_when_the_field_does_not_allow_it():
    snaps, _, _ = _run(_schema(allowOther=False), [_answer(OTHER_OPTION_VALUE)], enforce=False)

    assert snaps == []


# ── unrelated rules that must survive the reordering ─────────────────────────

def test_missing_required_answer_still_raises():
    with pytest.raises(HTTPException) as excinfo:
        _run(_schema(), [])

    assert "required" in excinfo.value.detail


def test_missing_optional_answer_is_skipped():
    snaps, summary, _ = _run(_schema(required=False), [])

    assert snaps == []
    assert summary["total"] == 1


def test_hidden_field_is_not_validated():
    """A field whose display condition fails is neither required nor counted."""
    schema = {
        "fields": [
            {"id": "gate", "label": "Gate", "type": "radio", "required": True,
             "options": [{"value": "yes", "label": "Yes"}, {"value": "no", "label": "No"}]},
            {"id": "q", "label": "Q", "type": "radio", "required": True,
             "options": [{"value": "a", "label": "A"}],
             "showIf": [{"kind": "field", "fieldId": "gate", "anyOf": ["yes"]}]},
        ]
    }
    snaps, summary, _ = _snapshot_flat_answers(
        schema, [AnswerIn(nodeId="gate", optionIds=["no"])], None, date.today(), True
    )

    assert [s["nodeId"] for s in snaps] == ["gate"]
    assert summary["total"] == 1


def test_number_outside_the_soft_range_is_flagged_not_rejected():
    schema = {"fields": [{"id": "w", "label": "Weight", "type": "number", "required": True,
                          "flagMin": 2, "flagMax": 10}]}
    snaps, summary, actions = _snapshot_flat_answers(
        schema, [AnswerIn(nodeId="w", optionIds=[], value="42")], None, date.today(), True
    )

    assert summary["red"] == 1
    assert snaps[0]["value"] == "42"
    assert actions and actions[0]["optionId"] == "__out_of_range__"
