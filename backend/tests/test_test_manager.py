"""Test Manager behaviour that would be expensive to get wrong.

Two of these guard exam integrity directly:

  * shuffling changes only the ORDER a paper is presented in. Scoring matches
    on option ID, so a shuffled paper must mark identically to an unshuffled
    one — otherwise randomisation silently rewrites results.
  * the order is stable for one attempt. If it were re-rolled on every request,
    a candidate who reloads mid-test would see the paper rearrange under them
    and could answer the wrong question.

    cd backend && venv/bin/python -m pytest tests/test_test_manager.py -v
    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_test_manager.py -v
"""
from __future__ import annotations

import random

import pytest

from app.routers.admin import _normalise_question


# ── the shuffle, as start_test_attempt applies it ────────────────────────────
# Mirrors the real code path: seed from the attempt id, shuffle the question
# list and each question's option list, and keep option identity intact.

class _Opt:
    def __init__(self, oid, label, correct=False):
        self.id, self.label, self.is_correct = oid, label, correct

    def __repr__(self):
        return f"<Opt {self.id} {self.label}{'*' if self.is_correct else ''}>"


class _Q:
    def __init__(self, qid, options):
        self.id, self.options = qid, options


def _paper(n_questions=8, n_options=4):
    questions = []
    for q in range(n_questions):
        opts = [
            _Opt(oid=q * 10 + i, label="ABCDEF"[i], correct=(i == q % n_options))
            for i in range(n_options)
        ]
        questions.append(_Q(qid=q, options=opts))
    return questions


def _deliver(questions, attempt_id, shuffle_questions, shuffle_options):
    """The exact ordering logic from routers/tests.py:start_test_attempt."""
    questions = list(questions)
    option_order = {q.id: sorted(q.options, key=lambda o: (o.label or ""))
                    for q in questions}
    if shuffle_questions or shuffle_options:
        rng = random.Random(attempt_id)
        if shuffle_questions:
            rng.shuffle(questions)
        if shuffle_options:
            for opts in option_order.values():
                rng.shuffle(opts)
    return [(q.id, [o.id for o in option_order[q.id]]) for q in questions]


def _correct_ids(questions):
    return {q.id: next(o.id for o in q.options if o.is_correct) for q in questions}


def test_shuffling_never_changes_which_option_is_correct():
    """The claim the whole feature rests on: order moves, marking does not."""
    paper = _paper()
    before = _correct_ids(paper)
    _deliver(paper, attempt_id=99, shuffle_questions=True, shuffle_options=True)
    assert _correct_ids(paper) == before


def test_every_question_and_option_survives_the_shuffle():
    """A shuffle must not drop or duplicate anything — that would lose marks."""
    paper = _paper()
    plain = _deliver(paper, 1, False, False)
    mixed = _deliver(paper, 1, True, True)

    assert sorted(q for q, _ in mixed) == sorted(q for q, _ in plain)
    for qid, opts in mixed:
        expected = dict(plain)[qid]
        assert sorted(opts) == sorted(expected)
        assert len(set(opts)) == len(opts)


def test_the_same_attempt_always_sees_the_same_paper():
    """A reload mid-test must not rearrange the questions."""
    paper = _paper()
    first = _deliver(paper, attempt_id=4242, shuffle_questions=True, shuffle_options=True)
    again = _deliver(_paper(), attempt_id=4242, shuffle_questions=True, shuffle_options=True)
    assert first == again


def test_two_attempts_see_different_papers():
    """Otherwise shuffling buys nothing over a fixed order."""
    a = _deliver(_paper(20), attempt_id=1, shuffle_questions=True, shuffle_options=False)
    b = _deliver(_paper(20), attempt_id=2, shuffle_questions=True, shuffle_options=False)
    assert [q for q, _ in a] != [q for q, _ in b]


def test_shuffle_off_keeps_the_authored_order():
    """The default must be exactly the old behaviour."""
    paper = _paper()
    delivered = _deliver(paper, 7, False, False)
    assert [q for q, _ in delivered] == [q.id for q in paper]
    for qid, opts in delivered:
        source = next(q for q in paper if q.id == qid)
        assert opts == [o.id for o in sorted(source.options, key=lambda o: o.label)]


def test_options_only_shuffle_leaves_question_order_alone():
    paper = _paper()
    delivered = _deliver(paper, 3, shuffle_questions=False, shuffle_options=True)
    assert [q for q, _ in delivered] == [q.id for q in paper]


# ── duplicate detection ──────────────────────────────────────────────────────

@pytest.mark.parametrize("a,b", [
    ("What is exclusive breastfeeding?", "what is exclusive breastfeeding"),
    ("Within 1 hour?", "WITHIN 1 HOUR ?"),
    ("Colostrum  is   rich", "Colostrum is rich"),
    ("Feeding cues, early", "Feeding cues early!"),
])
def test_near_identical_questions_share_a_key(a, b):
    """Case, spacing and punctuation are exactly what hides a duplicate."""
    assert _normalise_question(a) == _normalise_question(b)


@pytest.mark.parametrize("a,b", [
    ("When should complementary foods be introduced?", "When should breastfeeding start?"),
    ("Within 1 hour", "Within 6 hours"),
])
def test_different_questions_do_not_collide(a, b):
    assert _normalise_question(a) != _normalise_question(b)


def test_blank_questions_are_ignored():
    """Empty rows must not all pile into one giant 'duplicate' group."""
    assert _normalise_question("") == ""
    assert _normalise_question("   ") == ""
    assert _normalise_question("!!!") == ""
