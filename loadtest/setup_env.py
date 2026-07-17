"""Pre-run environment setup via the admin API.

- Optionally inflates a test's question bank to a realistic size
  (seeded demo tests have only 4-5 questions; real exams have 20+).
- Activates tests (seeded status='scheduled' keeps them locked until an
  admin presses Start — same step a real exam day requires).

Usage:
  python setup_env.py --activate 5 6 --questions 20 --district meghalaya
"""
import argparse
import os

import requests

HOST = os.environ.get("NH_HOST", "http://127.0.0.1:8010")
ADMIN_EMAIL = os.environ.get("NH_ADMIN_EMAIL", "admin@nurturehub.org")
ADMIN_PASSWORD = os.environ.get("NH_ADMIN_PASSWORD", "admin123")


def admin_token() -> str:
    r = requests.post(f"{HOST}/api/admin/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--activate", type=int, nargs="*", default=[])
    ap.add_argument("--questions", type=int, default=0,
                    help="replace each activated test's questions with N generated ones")
    ap.add_argument("--district", default="meghalaya")
    args = ap.parse_args()

    headers = {"Authorization": f"Bearer {admin_token()}"}

    for test_id in args.activate:
        if args.questions:
            rows = [{
                "text": f"Load-test question {i + 1}: which option is correct?",
                "marks": 2,
                "correct_answer": "ABCD"[i % 4],
                "option_a": "Option A", "option_b": "Option B",
                "option_c": "Option C", "option_d": "Option D",
            } for i in range(args.questions)]
            r = requests.post(
                f"{HOST}/api/admin/tests/{test_id}/upload-questions",
                params={"district": args.district}, json=rows,
                headers=headers, timeout=60)
            if r.status_code == 409:
                print(f"test {test_id}: questions unchanged (has submitted attempts; "
                      f"run seed_accounts.py --reset-attempts first)")
            else:
                r.raise_for_status()
                print(f"test {test_id}: uploaded {args.questions} questions")

        r = requests.post(f"{HOST}/api/admin/tests/{test_id}/start",
                          params={"district": args.district},
                          headers=headers, timeout=30)
        r.raise_for_status()
        print(f"test {test_id}: status -> {r.json().get('status', '?')}")


if __name__ == "__main__":
    main()
