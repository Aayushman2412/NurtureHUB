"""Seed / reset load-test accounts directly in the load-test database.

Never point this at a real database: it is guarded to only touch rows whose
email matches loadtest_%@nhload.org (plus their attempt/mother data).

Usage:
  python seed_accounts.py --count 5000                # create accounts
  python seed_accounts.py --complete-tutorials        # unlock exams (herd prep)
  python seed_accounts.py --reset-attempts            # wipe attempts/live data
  python seed_accounts.py --reset-progress            # wipe tutorial progress
  python seed_accounts.py --reset-mothers             # wipe mother/child rows
"""
import argparse
import os

import psycopg2

DB_URL = os.environ.get(
    "NH_LOADTEST_DB",
    "postgresql://postgres:756824@localhost/nurturehub_loadtest",
)
TEMPLATE_EMAIL = os.environ.get("NH_TEMPLATE_EMAIL", "ayushman2412@gmail.com")
EMAIL_LIKE = "loadtest_%@nhload.org"

CREATE_SQL = """
INSERT INTO users (email, password_hash, full_name, age, gender, phone,
    state_id, district_id, block_id, village_id, facility_id, qualification_id,
    experience_range_id, department, role, work_center_type, work_center_name,
    district, avatar_initials, is_verified, is_admin, otp_attempts,
    program_district_id, department_id, designation_id, facility_type_id,
    village_name, created_at)
SELECT 'loadtest_' || g || '@nhload.org', d.password_hash,
    'Load Tester ' || g, d.age, d.gender, d.phone, d.state_id, d.district_id,
    d.block_id, d.village_id, d.facility_id, d.qualification_id,
    d.experience_range_id, d.department, d.role, d.work_center_type,
    d.work_center_name, d.district, 'LT', true, false, 0,
    d.program_district_id, d.department_id, d.designation_id,
    d.facility_type_id, d.village_name, now()
FROM generate_series(1, %(count)s) g
CROSS JOIN (SELECT * FROM users WHERE email = %(template)s) d
ON CONFLICT (email) DO NOTHING;
"""

COMPLETE_TUTORIALS_SQL = """
INSERT INTO user_tutorial_progress (user_id, tutorial_id, is_completed,
    completed_at, watch_time_seconds, watch_pct, last_position_seconds,
    video_duration_seconds, quiz_status, updated_at)
SELECT u.id, t.id, true, now(), 600, 100, 600, 600, 'skipped', now()
FROM users u
JOIN stages s ON s.program_district_id = u.program_district_id
JOIN tutorials t ON t.stage_id = s.id
WHERE u.email LIKE %(like)s
ON CONFLICT ON CONSTRAINT uq_user_tutorial DO UPDATE
    SET is_completed = true, watch_pct = 100, completed_at = now();
"""

RESET_ATTEMPTS_SQL = """
DELETE FROM test_attempts WHERE user_id IN
    (SELECT id FROM users WHERE email LIKE %(like)s);
DELETE FROM notifications WHERE user_id IN
    (SELECT id FROM users WHERE email LIKE %(like)s);
"""

RESET_PROGRESS_SQL = """
DELETE FROM tutorial_quiz_responses WHERE user_id IN
    (SELECT id FROM users WHERE email LIKE %(like)s);
DELETE FROM user_tutorial_progress WHERE user_id IN
    (SELECT id FROM users WHERE email LIKE %(like)s);
"""

RESET_MOTHERS_SQL = """
DELETE FROM mothers WHERE registered_by_user_id IN
    (SELECT id FROM users WHERE email LIKE %(like)s);
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=0)
    ap.add_argument("--complete-tutorials", action="store_true")
    ap.add_argument("--reset-attempts", action="store_true")
    ap.add_argument("--reset-progress", action="store_true")
    ap.add_argument("--reset-mothers", action="store_true")
    args = ap.parse_args()

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()
    params = {"like": EMAIL_LIKE, "template": TEMPLATE_EMAIL, "count": args.count}

    if args.count:
        cur.execute(CREATE_SQL, params)
        print(f"created accounts (requested {args.count}, inserted {cur.rowcount})")
    if args.reset_attempts:
        cur.execute(RESET_ATTEMPTS_SQL, params)
        print("reset attempts + notifications")
    if args.reset_progress:
        cur.execute(RESET_PROGRESS_SQL, params)
        print("reset tutorial progress")
    if args.reset_mothers:
        cur.execute(RESET_MOTHERS_SQL, params)
        print("reset mothers/children")
    if args.complete_tutorials:
        cur.execute(COMPLETE_TUTORIALS_SQL, params)
        print(f"completed tutorials for all loadtest users ({cur.rowcount} rows)")

    conn.commit()
    cur.execute("SELECT count(*) FROM users WHERE email LIKE %(like)s", params)
    print(f"total loadtest accounts: {cur.fetchone()[0]}")
    conn.close()


if __name__ == "__main__":
    main()
