import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

# Dev-only default secrets. If any of these are still in use when APP_ENV=production,
# the app refuses to boot (see Settings.validate_production).
DEV_JWT_SECRET = "supersecretkeyfornurturehubdevelopment12345"
DEV_DATABASE_URL = "postgresql://postgres:756824@localhost/NurtureHub"


class Settings(BaseSettings):
    PROJECT_NAME: str = "NurtureHUB API"

    # Runtime environment: "development" | "production"
    APP_ENV: str = Field(default="development", validation_alias="APP_ENV")

    # Database
    DATABASE_URL: str = Field(
        default=DEV_DATABASE_URL,  # fallback to our tested URL
        validation_alias="DATABASE_URL"
    )

    # Connection-pool sizing (Postgres only). pool_size + max_overflow is the
    # hard ceiling on concurrent DB connections per process; keep
    # (pool_size + max_overflow) * uvicorn_workers <= Postgres/pgbouncer limit.
    DB_POOL_SIZE: int = Field(default=20, validation_alias="DB_POOL_SIZE")
    DB_MAX_OVERFLOW: int = Field(default=40, validation_alias="DB_MAX_OVERFLOW")
    DB_POOL_TIMEOUT: int = Field(default=30, validation_alias="DB_POOL_TIMEOUT")

    # Optional read replica. When set, pure-read reference-data endpoints use a
    # separate read-only engine so the primary is spared. Leave empty to route
    # everything to the primary. Do NOT point read-after-write paths at this.
    READ_DATABASE_URL: str = Field(default="", validation_alias="READ_DATABASE_URL")

    # Per-process cache of the authenticated user for the verified-read path, so
    # not every request re-runs SELECT users by email. Short TTL bounds staleness;
    # writes to the user row invalidate the entry. 0 disables the cache.
    USER_CACHE_TTL_SECONDS: int = Field(default=30, validation_alias="USER_CACHE_TTL_SECONDS")

    # How often a candidate's heartbeat is persisted to the DB. Heartbeats arrive
    # every 30s from every socket; liveness is tracked in-memory, so the DB write
    # (last_heartbeat) only needs to be throttled — not done on every beat.
    WS_HEARTBEAT_PERSIST_SECONDS: int = Field(default=60, validation_alias="WS_HEARTBEAT_PERSIST_SECONDS")

    # Security & JWT
    JWT_SECRET_KEY: str = Field(default=DEV_JWT_SECRET, validation_alias="JWT_SECRET_KEY")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours

    # Google OAuth
    GOOGLE_CLIENT_ID: str = Field(default="", validation_alias="GOOGLE_CLIENT_ID")

    # Demo/mock data. True seeds demo districts, users, tutorials, tests and
    # enables demo fallbacks in admin reports. Set SEED_DEMO_DATA=false in
    # production so only essential metadata is seeded and no fabricated rows
    # ever appear in reports/exports.
    SEED_DEMO_DATA: bool = Field(default=True, validation_alias="SEED_DEMO_DATA")

    # Data-analytics pipelines (admin "Database" section). Root directory for
    # uploaded inputs, per-run workspaces and generated outputs. Empty = the
    # default backend/pipeline_data/ next to the app package. Must NOT live
    # under backend/uploads/ (that dir is publicly served).
    PIPELINE_DATA_DIR: str = Field(default="", validation_alias="PIPELINE_DATA_DIR")
    # Hard wall-clock cap for one pipeline subprocess, in minutes. A full
    # crosstabs district run takes ~7-8 min; the cap only exists to reap
    # hung processes.
    PIPELINE_RUN_TIMEOUT_MINUTES: int = Field(default=90, validation_alias="PIPELINE_RUN_TIMEOUT_MINUTES")

    # Raw-data export (admin Database → Raw Data). When true, the generators
    # fabricate a large deterministic mock dataset instead of reading real
    # form data — localhost pipeline testing only. MUST be false in production.
    RAW_EXPORT_MOCK: bool = Field(default=False, validation_alias="RAW_EXPORT_MOCK")

    # Cloudflare R2 media storage/CDN. When ALL five are set, new media
    # uploads (learner photos, form-builder assets) are stored in the R2
    # bucket and served from R2_PUBLIC_BASE_URL (the bucket's r2.dev public
    # URL or a custom domain proxied by Cloudflare). Empty = local disk under
    # backend/uploads/ as before. See app/storage.py.
    R2_ACCOUNT_ID: str = Field(default="", validation_alias="R2_ACCOUNT_ID")
    R2_ACCESS_KEY_ID: str = Field(default="", validation_alias="R2_ACCESS_KEY_ID")
    R2_SECRET_ACCESS_KEY: str = Field(default="", validation_alias="R2_SECRET_ACCESS_KEY")
    R2_BUCKET: str = Field(default="", validation_alias="R2_BUCKET")
    R2_PUBLIC_BASE_URL: str = Field(default="", validation_alias="R2_PUBLIC_BASE_URL")

    # Web push (PWA notifications). Empty keys disable push silently — the
    # in-app notification list keeps working. Generate once with:
    #   python -c "from py_vapid import Vapid01; from py_vapid.utils import b64urlencode; from cryptography.hazmat.primitives import serialization; v=Vapid01(); v.generate_keys(); print('VAPID_PRIVATE_KEY='+b64urlencode(v.private_key.private_numbers().private_value.to_bytes(32,'big'))); pk=v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint); print('VAPID_PUBLIC_KEY='+b64urlencode(pk))"
    VAPID_PUBLIC_KEY: str = Field(default="", validation_alias="VAPID_PUBLIC_KEY")
    VAPID_PRIVATE_KEY: str = Field(default="", validation_alias="VAPID_PRIVATE_KEY")
    VAPID_SUBJECT: str = Field(default="mailto:admin@nurturehub.org", validation_alias="VAPID_SUBJECT")

    # SMTP/Email settings for OTP
    SMTP_HOST: str = Field(default="smtp.gmail.com", validation_alias="SMTP_HOST")
    SMTP_PORT: int = Field(default=587, validation_alias="SMTP_PORT")
    SMTP_USER: str = Field(default="", validation_alias="SMTP_USER")
    SMTP_PASSWORD: str = Field(default="", validation_alias="SMTP_PASSWORD")
    SMTP_FROM: str = Field(default="NurtureHUB <noreply@nurturehub.org>", validation_alias="SMTP_FROM")
    SMTP_TIMEOUT: int = Field(default=10, validation_alias="SMTP_TIMEOUT")  # seconds

    # OTP policy
    OTP_EXPIRE_MINUTES: int = Field(default=10, validation_alias="OTP_EXPIRE_MINUTES")
    OTP_MAX_ATTEMPTS: int = Field(default=5, validation_alias="OTP_MAX_ATTEMPTS")
    OTP_RESEND_COOLDOWN_SECONDS: int = Field(default=60, validation_alias="OTP_RESEND_COOLDOWN_SECONDS")

    # Rate limiting — "memory://" for single-process; set a redis:// URI for multi-worker deploys
    RATE_LIMIT_STORAGE_URI: str = Field(default="memory://", validation_alias="RATE_LIMIT_STORAGE_URI")
    # Per-endpoint limits are env-tunable so a load test / trusted internal caller
    # can raise them without code changes. Values are slowapi limit strings.
    RATE_LIMIT_LOGIN: str = Field(default="10/minute", validation_alias="RATE_LIMIT_LOGIN")
    RATE_LIMIT_REGISTER: str = Field(default="5/hour", validation_alias="RATE_LIMIT_REGISTER")
    RATE_LIMIT_OTP: str = Field(default="10/minute", validation_alias="RATE_LIMIT_OTP")
    RATE_LIMIT_ENABLED: bool = Field(default=True, validation_alias="RATE_LIMIT_ENABLED")
    # When true, the rate limiter keys on the left-most X-Forwarded-For hop
    # instead of the direct peer, so users behind a trusted reverse proxy each
    # get their own bucket rather than all sharing the proxy's IP. Only enable
    # when a trusted proxy sets the header (else clients can spoof it).
    TRUST_PROXY_HEADERS: bool = Field(default=False, validation_alias="TRUST_PROXY_HEADERS")

    # CORS — comma-separated list of allowed frontend origins
    CORS_ORIGINS: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        validation_alias="CORS_ORIGINS"
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.lower() == "production"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    def validate_production(self) -> None:
        """Fail fast at boot if production is running on insecure dev defaults."""
        if not self.is_production:
            return
        errors = []
        if self.JWT_SECRET_KEY == DEV_JWT_SECRET:
            errors.append("JWT_SECRET_KEY is still the dev default — set a strong random secret.")
        if self.DATABASE_URL == DEV_DATABASE_URL:
            errors.append("DATABASE_URL is still the dev default.")
        if not self.SMTP_USER or not self.SMTP_PASSWORD:
            errors.append("SMTP_USER/SMTP_PASSWORD must be set so OTP emails can be delivered.")
        if errors:
            raise RuntimeError(
                "Refusing to start in production with insecure configuration:\n  - "
                + "\n  - ".join(errors)
            )


settings = Settings()
