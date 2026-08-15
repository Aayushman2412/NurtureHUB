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

    email = args.email or input("Enter admin email: ").strip()
    if not email:
        print("Error: Email is required.")
        return

    password = args.password or input("Enter admin password: ").strip()
    if not password:
        print("Error: Password is required.")
        return

    full_name = args.name or input("Enter full name (optional, press Enter to skip): ").strip()
    if not full_name:
        full_name = email.split("@")[0].capitalize()

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if user:
            user.is_admin = True
            user.password_hash = get_password_hash(password)
            user.is_verified = True
            if full_name:
                user.full_name = full_name
            print(f"✅ Updated existing user: {email} -> is_admin=True")
        else:
            user = User(
                email=email,
                full_name=full_name,
                is_admin=True,
                password_hash=get_password_hash(password),
                is_verified=True,
            )
            db.add(user)
            print(f"✅ Created new admin user: {email}")

        db.commit()
        print("🎉 Done! Admin user can now log in.")
    finally:
        db.close()

if __name__ == "__main__":
    main()

