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
#
# The two runtime-data directories are created here even though .dockerignore
# keeps their contents out of the image. Docker seeds a *new* named volume from
# the image's directory at the mount point, ownership included; if the path is
# absent from the image it instead creates a root-owned mountpoint that uid
# 10001 cannot write to. Creating them appuser-owned is what makes the volumes
# writable — without it, the first pipeline upload dies on PermissionError.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/uploads /data/pipeline_data \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000

# main.py's lifespan applies migrations + seeds, then uvicorn serves the API/WS.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
