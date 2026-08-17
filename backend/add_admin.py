import sys
import argparse
from app.database import SessionLocal
from app.models import User
from app.auth import get_password_hash

def main():
    parser = argparse.ArgumentParser(description="Create or update an admin user in NurtureHUB.")
    parser.add_argument("email", nargs="?", help="Admin user email")
    parser.add_argument("password", nargs="?", help="Admin user password")
    parser.add_argument("name", nargs="?", default=None, help="Admin user full name (optional)")

    args = parser.parse_args()

    email = (args.email or input("Enter admin email: ")).strip().lower()
    if not email:
        print("Error: Email is required.")
        return

    password = args.password or input("Enter admin password: ").strip()
    if not password:
        print("Error: Password is required.")
        return

    full_name = (args.name or input("Enter full name (optional, press Enter to skip): ")).strip()
    if not full_name:
        full_name = email.split("@")[0].capitalize()

    db = SessionLocal()
    try:
        from sqlalchemy import func
        user = db.query(User).filter(func.lower(User.email) == email).first()
        existed = user is not None
        if user:
            user.is_admin = True
            user.password_hash = get_password_hash(password)
            user.is_verified = True
            if full_name:
                user.full_name = full_name
        else:
            user = User(
                email=email,
                full_name=full_name,
                is_admin=True,
                password_hash=get_password_hash(password),
                is_verified=True,
            )
            db.add(user)

        # Commit BEFORE reporting. These messages used to print first, and on a
        # console that is not UTF-8 (Windows cp1252, or a redirected/piped stdout
        # under a C locale) the emoji raised UnicodeEncodeError — which aborted
        # main() before the commit and silently rolled the whole thing back,
        # while the operator saw a half-written success line. Plain ASCII below
        # for the same reason.
        db.commit()
        print(f"[ok] {'Updated existing user' if existed else 'Created new admin user'}: {email} -> is_admin=True")
        print("Done. Admin user can now log in.")
    finally:
        db.close()

if __name__ == "__main__":
    main()

