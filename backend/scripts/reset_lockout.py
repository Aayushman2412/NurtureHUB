"""
Reset Account Lockouts & Failed Login Attempts.

Clears active lockouts and failed login history for a specific email or all accounts,
allowing locked-out administrators or learners to sign in immediately.

Usage:
  python -m scripts.reset_lockout [email]
"""

import sys
import argparse
from datetime import datetime, timezone
from sqlalchemy import func

import app.models
from app.database import SessionLocal
from app.models_security import AccountLockout, LoginAttempt


def reset_lockout(email: str = None):
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        if email:
            norm_email = email.strip().lower()
            l_count = (
                db.query(AccountLockout)
                .filter(AccountLockout.principal == norm_email, AccountLockout.cleared_at.is_(None))
                .update({"cleared_at": now, "cleared_by": "manual_admin_reset"}, synchronize_session=False)
            )
            a_count = (
                db.query(LoginAttempt)
                .filter(LoginAttempt.principal == norm_email)
                .delete(synchronize_session=False)
            )
            db.commit()
            print(f"[OK] Cleared {l_count} active lockout(s) and {a_count} failed attempt(s) for '{norm_email}'.")
        else:
            l_count = (
                db.query(AccountLockout)
                .filter(AccountLockout.cleared_at.is_(None))
                .update({"cleared_at": now, "cleared_by": "manual_admin_reset"}, synchronize_session=False)
            )
            a_count = db.query(LoginAttempt).delete(synchronize_session=False)
            db.commit()
            print(f"[OK] Cleared {l_count} active lockout(s) and {a_count} failed attempt(s) across ALL accounts.")

        print("You can now sign in immediately.")
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Reset account lockouts and failed login attempts.")
    parser.add_argument("email", nargs="?", default=None, help="Email of the account to unlock (default: unlock all)")
    args = parser.parse_args()
    reset_lockout(args.email)


if __name__ == "__main__":
    main()
