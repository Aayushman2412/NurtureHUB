import sys
import argparse
from app.database import SessionLocal
from app.models import User
from app.auth import verify_password

def main():
    parser = argparse.ArgumentParser(description="Check admin status in NurtureHUB.")
    parser.add_argument("email", nargs="?", default="ruqaiya@edupyramids.org", help="Admin email to check")
    parser.add_argument("password", nargs="?", default=None, help="Password to verify against (optional)")

    args = parser.parse_args()

    db = SessionLocal()
    try:
        u = db.query(User).filter(User.email == args.email).first()
        if u:
            print(f"User Found: True")
            print(f"Email: {u.email}")
            print(f"Name: {u.full_name}")
            print(f"is_admin: {u.is_admin}")
            print(f"is_verified: {u.is_verified}")
            print(f"has password_hash: {bool(u.password_hash)}")
            if args.password and u.password_hash:
                print(f"Password '{args.password}' matches: {verify_password(args.password, u.password_hash)}")
        else:
            print(f"User '{args.email}' NOT found in database!")
    finally:
        db.close()

if __name__ == "__main__":
    main()

