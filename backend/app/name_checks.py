"""Is a typed name a real one? (Learner Redesign review, 30 Oct 2026, fix 5:
records named "mother name", "Tttttt" and "Gghghgh" were saved as real
mothers.) Checked when a mother is registered — never on reading or editing
an existing record, so old records keep loading; the browser mirrors these
rules in frontend/src/lib/nameChecks.ts so the learner hears it on the page.

Names are written in Latin or in an Indian script; the letter-pattern rules
only look at Latin letters, so a name typed in Devanagari is judged on the
word list and digits alone.
"""
from __future__ import annotations

import re

# Words a tester types, and labels copied into the box instead of a name.
PLACEHOLDERS = frozenset({
    "name", "mother", "mother name", "mothers name", "mother's name", "full name", "beneficiary",
    "test", "testing", "tester", "demo", "sample", "dummy", "example", "abc", "abcd", "xyz", "asdf",
    "qwerty", "na", "n a", "none", "nil", "unknown", "no name", "xxx", "aaa",
})
_LATIN = re.compile(r"[a-z]")
_VOWELS = set("aeiouy")


def placeholder_reason(name: str) -> str | None:
    """Why `name` looks like a placeholder, or None if it looks like a name:
    "placeholder" (a word from the list), "digits", "repeated" (one letter
    over and over: "Tttttt"), "mash" (two letters typed back and forth:
    "Gghghgh"), "no_vowel" (Latin letters with no vowel: "Bcdfgh")."""
    text = re.sub(r"\s+", " ", (name or "").strip().lower())
    if not text:
        return None
    if re.sub(r"[^a-z' ]", "", text).replace("'", "").strip() in PLACEHOLDERS or text in PLACEHOLDERS:
        return "placeholder"
    if any(ch.isdigit() for ch in text):
        return "digits"
    letters = "".join(_LATIN.findall(text))
    if len(letters) < 4:
        return None
    distinct = set(letters)
    if len(distinct) == 1:
        return "repeated"
    if len(distinct) == 2 and len(letters) >= 5:
        return "mash"
    if not distinct & _VOWELS:
        return "no_vowel"
    return None


MESSAGES = {
    "placeholder": "Please type the mother's real name.",
    "digits": "A name cannot contain numbers.",
    "repeated": "This does not look like a real name. Please type the mother's name.",
    "mash": "This does not look like a real name. Please type the mother's name.",
    "no_vowel": "This does not look like a real name. Please check the spelling.",
}
