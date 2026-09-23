"""The password rules the sign-up form shows must be the rules the server applies.

The form lists and ticks off each rule as the person types, from
GET /api/auth/password-policy. If the description drifted from `validate` —
a rule enforced but not shown, a number shown that is not the real one — the
form would tell someone their password is fine and the server would refuse it.

  cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_password_policy.py -v
"""
from __future__ import annotations

import pytest

from app.security import passwords

# (password, email, full name, accepted?) — also used by hand to check that the
# browser's live checklist agrees with the server, case for case.
CASES = [
    ("Sunrise#2026", "", "", True),
    ("correct horse battery staple", "", "", True),      # passphrase: length instead of variety
    ("short1A!", "", "", False),                         # too short
    ("alllowercaseletters", "", "", True),               # 16+ chars, one kind: allowed
    ("lowercase12", "", "", False),                      # 11 chars, two kinds
    ("Password123", "", "", False),                      # common once reduced to letters
    ("Qwerty@2026x", "", "", False),                     # keyboard run
    ("Mz!12345abcd", "", "", False),                     # number run
    ("Aaaaa!1bcdef", "", "", False),                     # a character 5 times in a row
    ("Ab1!Ab1!Ab1!", "", "", False),                     # only four different characters
    (" Sunrise#2026", "", "", False),                    # leading space
    ("Priya@Field9", "priya.sharma@example.org", "Priya Sharma", False),   # own name
    ("Garden#River7", "priya.sharma@example.org", "Priya Sharma", True),
]


@pytest.mark.parametrize("password,email,name,ok", CASES, ids=[c[0] for c in CASES])
def test_validate(password, email, name, ok):
    if ok:
        passwords.validate(password, email=email or None, full_name=name or None)
    else:
        with pytest.raises(passwords.PasswordPolicyError):
            passwords.validate(password, email=email or None, full_name=name or None)


def test_description_uses_the_enforced_numbers():
    learner = passwords.describe_policy()
    admin = passwords.describe_policy(is_admin=True)
    assert learner["min_length"] == passwords.MIN_LENGTH_LEARNER
    assert admin["min_length"] == passwords.MIN_LENGTH_ADMIN
    assert learner["max_length"] == passwords.MAX_LENGTH
    assert learner["history_depth"] == passwords.PASSWORD_HISTORY_DEPTH
    assert learner["min_character_kinds"] == passwords.MIN_CHARACTER_KINDS
    assert learner["passphrase_length"] == passwords.PASSPHRASE_LENGTH
    assert learner["min_distinct_characters"] == passwords.MIN_DISTINCT_CHARACTERS
    assert learner["max_repeat"] == passwords.MAX_REPEAT
    assert learner["keyboard_run_length"] == passwords.KEYBOARD_RUN_LENGTH
    assert learner["personal_token_length"] == passwords.PERSONAL_TOKEN_LENGTH


def test_every_listed_common_password_is_refused():
    for common in passwords.describe_policy()["common_passwords"]:
        with pytest.raises(passwords.PasswordPolicyError):
            passwords.validate(common)


def test_the_limits_are_the_real_edges():
    policy = passwords.describe_policy()
    n = policy["min_length"]
    passwords.validate("Gx7!" + "mqzwrt"[: n - 4])                    # exactly the minimum
    with pytest.raises(passwords.PasswordPolicyError):
        passwords.validate("Gx7!" + "mqzwrt"[: n - 5])                # one short
    with pytest.raises(passwords.PasswordPolicyError):
        passwords.validate("Gx7!mqzw" * 20)                           # over the maximum


def test_description_claims_no_check_that_does_not_exist():
    """It once promised a 'previously breached' check; there is no breach corpus."""
    text = " ".join(passwords.describe_policy()["rules"]).lower()
    assert "breach" not in text
