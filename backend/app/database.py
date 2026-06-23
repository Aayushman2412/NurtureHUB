from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from app.config import settings

# Create engine
engine = create_engine(
    settings.DATABASE_URL,
    # psycopg2 connection pool settings
    pool_size=10,
    max_overflow=20,
    pool_recycle=3600,
)

# Create session maker
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Declarative Base
Base = declarative_base()

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
