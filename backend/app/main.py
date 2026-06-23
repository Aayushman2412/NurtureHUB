from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.database import Base, engine, SessionLocal
from app.seed import seed_database
from app.routers import auth, users, tutorials, tests, results, notifications, dashboard

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Create database tables automatically
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    
    # 2. Seed database
    db = SessionLocal()
    try:
        seed_database(db)
    except Exception as e:
        print(f"Error seeding database on startup: {e}")
    finally:
        db.close()
        
    yield
    # Cleanup if needed on shutdown

app = FastAPI(
    title="NurtureHUB API",
    description="Backend API for NurtureHUB training & assessment platform",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS
# Allow our local React client (typically running on port 5173 in Vite)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(tutorials.router)
app.include_router(tests.router)
app.include_router(results.router)
app.include_router(notifications.router)
app.include_router(dashboard.router)

@app.get("/")
def read_root():
    return {"message": "Welcome to NurtureHUB API! Go to /docs for Swagger documentation."}
