"""The language-review sheet must keep telling the truth.

The workbook we send for review lists the sentences the SERVER sends — the
verification email and the notifications — by hand, because they live in
Python rather than in the app's translation files. Nothing stops someone
rewording one of them in the code and leaving the sheet behind, so a reviewer
would be approving a sentence nobody sees any more.

These tests pin both halves: every listed sentence still exists in the file it
claims to come from, and every sentence in the app's English translation files
reaches the sheet.

  cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_translation_sheet.py -v
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from scripts.export_translation_sheet import AREAS, BACKEND_STRINGS, LOCALES, collect_rows

BACKEND = Path(__file__).resolve().parents[1]


def _normalise(text: str) -> str:
    """Compare on words, not typography: the sheet writes plain hyphens, plain
    ampersands and straight quotes where the code uses dashes, HTML entities
    and curly quotes."""
    for a, b in (("—", "-"), ("–", "-"), ("·", "-"), ("•", "-"), ("&amp;", "&"),
                 ("’", "'"), ("“", '"'), ("”", '"')):
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip()


def _source_text(path: Path) -> str:
    """The file's text with Python's adjacent-literal seams closed up, so a
    sentence written as "half " "and half" reads as one sentence here too."""
    return re.sub(r'"\s*(?:f|r|rf|fr)?"', "", _normalise(path.read_text(encoding="utf-8")))


def _fragments(english: str) -> list[str]:
    """The literal pieces between {placeholders} that must appear in the code."""
    return [f for f in (_normalise(p) for p in re.split(r"\{[^}]*\}", english)) if len(f) >= 15]


@pytest.mark.parametrize("entry", BACKEND_STRINGS, ids=[e[0] for e in BACKEND_STRINGS])
def test_server_sentence_is_still_in_the_code(entry):
    sid, where, english, _note = entry
    match = re.search(r"\(([^)]+\.py)\)", where)
    assert match, f"{sid}: 'where' must name the source file, e.g. (app/utils.py)"
    source = _source_text(BACKEND / match.group(1))

    pieces = _fragments(english)
    if not pieces:                       # very short ones: "Hello,", "Passed"
        pieces = [_normalise(english)]
    missing = [p for p in pieces if p not in source]
    assert not missing, (
        f"{sid}: the sheet says the app sends {missing!r}, but that is no longer in "
        f"{match.group(1)}. Update BACKEND_STRINGS in scripts/export_translation_sheet.py."
    )


def test_every_translation_namespace_has_a_home_in_the_sheet():
    files = {p.stem for p in (LOCALES / "en").glob("*.json")}
    missing = sorted(files - set(AREAS))
    assert not missing, (
        f"New translation file(s) {missing}: add them to AREAS in "
        f"scripts/export_translation_sheet.py so reviewers see which screen they belong to."
    )


def test_sheet_covers_every_english_string():
    def flatten(d, prefix=""):
        out = {}
        for k, v in d.items():
            key = f"{prefix}.{k}" if prefix else k
            out.update(flatten(v, key)) if isinstance(v, dict) else out.update({key: v})
        return out

    expected = sum(
        len(flatten(json.loads(p.read_text(encoding="utf-8"))))
        for p in (LOCALES / "en").glob("*.json")
    )
    rows = collect_rows()
    in_sheet = sum(len(r) for name, r in rows.items() if name != "Messages & email")
    assert in_sheet == expected, "every English string belongs in the review sheet"
    assert len(rows["Messages & email"]) == len(BACKEND_STRINGS)
