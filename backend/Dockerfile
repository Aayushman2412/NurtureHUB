# syntax=docker/dockerfile:1

# NurtureHUB backend — FastAPI + Alembic + Postgres (psycopg2).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt .
RUN pip install -r requirements.txt

# App source — includes app/, alembic/ and alembic.ini, which the startup
# lifespan needs to run `alembic upgrade head` + seed before serving.
COPY . .

# Run as an unprivileged user.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# main.py's lifespan applies migrations + seeds, then uvicorn serves the API/WS.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
