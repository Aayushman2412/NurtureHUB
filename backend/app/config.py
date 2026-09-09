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
    # How long a request waits for a free connection before giving up. 30s meant
    # that a burst big enough to saturate the pool produced 30-second hangs and
    # then 500s; a short wait turns the same burst into a fast, retryable 503
    # (see the TimeoutError handler in main.py), which a client can act on and
    # which frees the worker to serve someone else.
    DB_POOL_TIMEOUT: int = Field(default=8, validation_alias="DB_POOL_TIMEOUT")

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

    # Password hashing work factor.
    #
    # This is the single biggest lever on how fast a cohort can sign in, because
    # bcrypt is deliberately slow: at 12 a verification costs ~300ms of CPU, so
    # 300 health workers signing in for a scheduled test is ~90 CPU-seconds of
    # pure hashing that no amount of pooling or extra workers can avoid — only
    # more cores. At 10 it is ~4x cheaper.
    #
    # 12 is kept as the default because it is the stronger setting and the right
    # one for a database of health-worker credentials. Lower it deliberately, if
    # a measured test start is too slow AND the box cannot be given more cores;
    # 10 is the floor OWASP still considers acceptable for bcrypt. Existing
    # hashes are upgraded in place on next sign-in (see auth.needs_rehash), so a
    # change takes effect gradually without a reset.
    BCRYPT_ROUNDS: int = Field(default=12, ge=10, le=15, validation_alias="BCRYPT_ROUNDS")

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

    # ── Unauthenticated endpoints: keyed by SOURCE ADDRESS ──
    # These are flood ceilings, NOT brute-force controls, and the distinction
    # matters enormously here. Whole ICDS block offices sit behind one NAT
    # address, and Indian mobile networks put thousands of subscribers behind
    # one CGNAT address — so when a test goes live and 300 health workers sign
    # in within a minute, every one of them shares a bucket. The old 10/minute
    # ceiling turned that into 429s for everyone after the tenth person, which
    # is a failed exam day, not a defence.
    #
    # Brute force is handled where it belongs: per ACCOUNT, by the lockout table
    # (LOCKOUT_* below), which is immune to how many people share an address.
    # These values only exist to stop one host hammering the origin.
    RATE_LIMIT_LOGIN: str = Field(default="1200/minute", validation_alias="RATE_LIMIT_LOGIN")
    RATE_LIMIT_REGISTER: str = Field(default="60/hour", validation_alias="RATE_LIMIT_REGISTER")
    RATE_LIMIT_OTP: str = Field(default="120/minute", validation_alias="RATE_LIMIT_OTP")
    # Low-volume public form with no legitimate burst — a genuine per-address cap.
    RATE_LIMIT_PUBLIC_FORM: str = Field(default="10/hour", validation_alias="RATE_LIMIT_PUBLIC_FORM")

    # ── Authenticated endpoints: keyed by ACCOUNT, not address ──
    # Keying on the signed-in principal is what makes these safe to set tight:
    # a shared office address is many principals, so a legitimate cohort is
    # unaffected, while a single stolen token cannot exfiltrate at machine speed.
    # Exports are the ones that matter — that is the moment data leaves this
    # system's custody (see SECURITY.md).
    RATE_LIMIT_EXPORT: str = Field(default="30/hour", validation_alias="RATE_LIMIT_EXPORT")
    RATE_LIMIT_PIPELINE: str = Field(default="12/hour", validation_alias="RATE_LIMIT_PIPELINE")

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

    # ═════════════════════════════════════════════════════════════════════════
    # Data protection (see app/security/ for what each of these drives)
    # ═════════════════════════════════════════════════════════════════════════

    # ── Organisation identity, used in breach notifications and privacy notices ──
    ORG_LEGAL_NAME: str = Field(default="Spoken Tutorial Project, IIT Bombay", validation_alias="ORG_LEGAL_NAME")
    DPO_NAME: str = Field(default="Data Protection Officer", validation_alias="DPO_NAME")
    DPO_EMAIL: str = Field(default="privacy@nurturehub.org", validation_alias="DPO_EMAIL")
    DPO_PHONE: str = Field(default="", validation_alias="DPO_PHONE")
    PUBLIC_BASE_URL: str = Field(default="", validation_alias="PUBLIC_BASE_URL")
    CERTIN_EMAIL: str = Field(default="incident@cert-in.org.in", validation_alias="CERTIN_EMAIL")

    # ── Field encryption (app/security/crypto.py) ──
    # Versioned so keys rotate without a flag-day rewrite:
    #   PHI_ENCRYPTION_KEYS=v1:<base64url 32 bytes>,v2:<base64url 32 bytes>
    # Generate one with:
    #   python -c "from app.security.crypto import generate_key; print(generate_key())"
    PHI_ENCRYPTION_KEYS: str = Field(default="", validation_alias="PHI_ENCRYPTION_KEYS")
    PHI_ENCRYPTION_ACTIVE_KEY: str = Field(default="", validation_alias="PHI_ENCRYPTION_ACTIVE_KEY")
    # Separate key for blind indexes, so leaking one does not compromise the other.
    PHI_INDEX_KEY: str = Field(default="", validation_alias="PHI_INDEX_KEY")

    # ── Audit trail (app/security/audit.py) ──
    # Keys the message authentication code on every audit row. MUST differ from
    # JWT_SECRET_KEY: sharing them means one leak forges both sessions and the
    # log that would have recorded the forgery.
    AUDIT_HMAC_KEY: str = Field(default="", validation_alias="AUDIT_HMAC_KEY")
    AUDIT_SPOOL_PATH: str = Field(default="", validation_alias="AUDIT_SPOOL_PATH")
    # How often chain heads are notarised (truncation detection) and detection
    # rules run. 0 disables the sweeper entirely.
    SECURITY_SWEEP_INTERVAL_SECONDS: int = Field(default=300, validation_alias="SECURITY_SWEEP_INTERVAL_SECONDS")
    AUDIT_ANCHOR_INTERVAL_SECONDS: int = Field(default=900, validation_alias="AUDIT_ANCHOR_INTERVAL_SECONDS")

    # ── Sessions (app/security/sessions.py) ──
    # Admin tokens unlock every record in the programme, so they live for a
    # working day rather than a full 24 hours.
    ADMIN_TOKEN_EXPIRE_MINUTES: int = Field(default=480, validation_alias="ADMIN_TOKEN_EXPIRE_MINUTES")
    SESSION_CACHE_TTL_SECONDS: int = Field(default=15, validation_alias="SESSION_CACHE_TTL_SECONDS")
    SESSION_TOUCH_INTERVAL_SECONDS: int = Field(default=300, validation_alias="SESSION_TOUCH_INTERVAL_SECONDS")
    # Tokens minted before the session layer existed carry no jti. Accepting
    # them avoids signing every field worker out on deploy day; because tokens
    # live at most ACCESS_TOKEN_EXPIRE_MINUTES the allowance drains itself.
    # Set false once a full token lifetime has passed since rollout.
    SESSION_ALLOW_LEGACY_TOKENS: bool = Field(default=True, validation_alias="SESSION_ALLOW_LEGACY_TOKENS")

    # ── Account lockout (app/security/lockout.py) ──
    LOCKOUT_THRESHOLD: int = Field(default=6, validation_alias="LOCKOUT_THRESHOLD")
    LOCKOUT_WINDOW_MINUTES: int = Field(default=15, validation_alias="LOCKOUT_WINDOW_MINUTES")
    LOCKOUT_DURATION_MINUTES: int = Field(default=15, validation_alias="LOCKOUT_DURATION_MINUTES")
    LOCKOUT_MAX_MINUTES: int = Field(default=240, validation_alias="LOCKOUT_MAX_MINUTES")
    # Distinct accounts failing from one address before a stuffing alert. Never
    # a block: whole block offices share one NAT address.
    STUFFING_ACCOUNT_THRESHOLD: int = Field(default=8, validation_alias="STUFFING_ACCOUNT_THRESHOLD")

    # ── Multi-factor (app/security/mfa.py) ──
    MFA_ISSUER: str = Field(default="NurtureHUB", validation_alias="MFA_ISSUER")
    # Enrol administrators first, then switch this on — turning it on before
    # anyone has enrolled locks every administrator out of the console.
    MFA_REQUIRED_FOR_ADMINS: bool = Field(default=False, validation_alias="MFA_REQUIRED_FOR_ADMINS")

    # ── Detection thresholds (app/security/anomaly.py) ──
    # Tune to the deployment's real caseload; the defaults assume a health
    # worker handles tens, not hundreds, of families.
    BULK_READ_WINDOW_MINUTES: int = Field(default=30, validation_alias="BULK_READ_WINDOW_MINUTES")
    BULK_READ_SUBJECT_THRESHOLD: int = Field(default=60, validation_alias="BULK_READ_SUBJECT_THRESHOLD")
    EXPORT_RECORD_THRESHOLD: int = Field(default=250, validation_alias="EXPORT_RECORD_THRESHOLD")
    OFF_HOURS_WINDOW_MINUTES: int = Field(default=60, validation_alias="OFF_HOURS_WINDOW_MINUTES")
    OFF_HOURS_EVENT_THRESHOLD: int = Field(default=15, validation_alias="OFF_HOURS_EVENT_THRESHOLD")
    WORK_HOURS_START: int = Field(default=6, validation_alias="WORK_HOURS_START")
    WORK_HOURS_END: int = Field(default=22, validation_alias="WORK_HOURS_END")
    # Minutes east of UTC for "local time" in the rules. 330 = IST.
    SECURITY_TZ_OFFSET_MINUTES: int = Field(default=330, validation_alias="SECURITY_TZ_OFFSET_MINUTES")
    NEW_LOCATION_WINDOW_MINUTES: int = Field(default=60, validation_alias="NEW_LOCATION_WINDOW_MINUTES")
    DENIED_WINDOW_MINUTES: int = Field(default=15, validation_alias="DENIED_WINDOW_MINUTES")
    DENIED_THRESHOLD: int = Field(default=20, validation_alias="DENIED_THRESHOLD")
    ERASURE_THRESHOLD: int = Field(default=25, validation_alias="ERASURE_THRESHOLD")
    ALERT_DEDUPE_MINUTES: int = Field(default=120, validation_alias="ALERT_DEDUPE_MINUTES")

    # ── Breach notification clocks, in hours from discovery ──
    # Defaults are the conservative reading of the operative texts; confirm
    # against the notified DPDP Rules and the executed MOU annexure.
    BREACH_CERTIN_HOURS: float = Field(default=6, validation_alias="BREACH_CERTIN_HOURS")
    BREACH_DPB_INITIAL_HOURS: float = Field(default=6, validation_alias="BREACH_DPB_INITIAL_HOURS")
    BREACH_DPB_DETAILED_HOURS: float = Field(default=72, validation_alias="BREACH_DPB_DETAILED_HOURS")
    BREACH_PRINCIPALS_HOURS: float = Field(default=72, validation_alias="BREACH_PRINCIPALS_HOURS")
    BREACH_MOU_HOURS: float = Field(default=24, validation_alias="BREACH_MOU_HOURS")
    # Response window for a data-principal rights request, in days.
    DSR_RESPONSE_DAYS: int = Field(default=30, validation_alias="DSR_RESPONSE_DAYS")

    # ── Transport hardening (app/security/middleware.py) ──
    HSTS_ENABLED: bool = Field(default=True, validation_alias="HSTS_ENABLED")
    HSTS_MAX_AGE: int = Field(default=31536000, validation_alias="HSTS_MAX_AGE")
    HSTS_PRELOAD: bool = Field(default=False, validation_alias="HSTS_PRELOAD")
    # Comma-separated hostnames the app will answer to. Empty = any, which is
    # only safe behind a proxy that already pins the host.
    ALLOWED_HOSTS: str = Field(default="", validation_alias="ALLOWED_HOSTS")
    # Interactive API docs expose the full surface of the API to anyone who can
    # reach them. Off in production unless deliberately enabled.
    ENABLE_API_DOCS: bool = Field(default=True, validation_alias="ENABLE_API_DOCS")
    # Serve backend/uploads/ as an open static mount. Media belongs on R2 in
    # production; leaving this on there means anyone with a URL reads the file.
    SERVE_LOCAL_UPLOADS: bool = Field(default=True, validation_alias="SERVE_LOCAL_UPLOADS")

    # Emergency switch: refuse every request that would return patient data.
    # For use during an active incident, before the cause is understood.
    PHI_ACCESS_FROZEN: bool = Field(default=False, validation_alias="PHI_ACCESS_FROZEN")

    # ── Administrator bootstrap ──
    # This replaces the credentials that used to be literals in admin.py
    # (admin@nurturehub.org / admin123), which meant every deployment of this
    # code shipped with a known password to the full patient database.
    #
    # ADMIN_BOOTSTRAP_PASSWORD creates the first administrator on a database
    # that has none, then must be unset — production refuses to boot while it
    # is still set. ALLOW_DEV_ADMIN is the local-development convenience and
    # cannot be enabled in production.
    ADMIN_BOOTSTRAP_EMAIL: str = Field(default="admin@nurturehub.org", validation_alias="ADMIN_BOOTSTRAP_EMAIL")
    ADMIN_BOOTSTRAP_PASSWORD: str = Field(default="", validation_alias="ADMIN_BOOTSTRAP_PASSWORD")
    # Defaults on so a developer's existing local login keeps working; the
    # production validator rejects it outright, and boot prints a warning
    # whenever it is active.
    ALLOW_DEV_ADMIN: bool = Field(default=True, validation_alias="ALLOW_DEV_ADMIN")
    DEV_ADMIN_PASSWORD: str = Field(default="admin123", validation_alias="DEV_ADMIN_PASSWORD")

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

    @property
    def allowed_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.ALLOWED_HOSTS.split(",") if h.strip()]

    def validate_production(self) -> None:
        """Fail fast at boot if production is running on insecure dev defaults.

        Everything below is a control the MOU's data-privacy clause depends on.
        Booting without one of them means the platform cannot honestly claim the
        protection, so it refuses to boot rather than claim it silently.
        """
        if not self.is_production:
            return
        errors = []
        if self.JWT_SECRET_KEY == DEV_JWT_SECRET:
            errors.append("JWT_SECRET_KEY is still the dev default — set a strong random secret.")
        if len(self.JWT_SECRET_KEY) < 32:
            errors.append("JWT_SECRET_KEY must be at least 32 characters.")
        if self.DATABASE_URL == DEV_DATABASE_URL:
            errors.append("DATABASE_URL is still the dev default.")
        if not self.SMTP_USER or not self.SMTP_PASSWORD:
            errors.append("SMTP_USER/SMTP_PASSWORD must be set so OTP emails can be delivered.")

        # ── data-protection controls ──
        if not self.AUDIT_HMAC_KEY:
            errors.append(
                "AUDIT_HMAC_KEY is not set — the audit trail would be signed with a key derived "
                "from JWT_SECRET_KEY, so one leak would forge both sessions and the log."
            )
        elif self.AUDIT_HMAC_KEY == self.JWT_SECRET_KEY:
            errors.append("AUDIT_HMAC_KEY must be different from JWT_SECRET_KEY.")
        elif len(self.AUDIT_HMAC_KEY) < 32:
            errors.append("AUDIT_HMAC_KEY must be at least 32 characters.")

        if not self.PHI_ENCRYPTION_KEYS:
            errors.append(
                "PHI_ENCRYPTION_KEYS is not set — mothers' and learners' contact details would be "
                "stored in plaintext. Generate one with: python -c "
                "\"from app.security.crypto import generate_key; print('v1:'+generate_key())\""
            )
        if not self.PHI_INDEX_KEY:
            errors.append("PHI_INDEX_KEY is not set — encrypted identifiers would not be searchable.")
        elif self.PHI_INDEX_KEY == self.PHI_ENCRYPTION_KEYS:
            errors.append("PHI_INDEX_KEY must be different from the encryption key ring.")

        if self.ADMIN_BOOTSTRAP_PASSWORD:
            errors.append(
                "ADMIN_BOOTSTRAP_PASSWORD is set. It exists to create the first administrator on "
                "an empty database; unset it once that account exists."
            )
        if self.ALLOW_DEV_ADMIN:
            errors.append("ALLOW_DEV_ADMIN must be false in production.")
        if not self.ALLOWED_HOSTS:
            errors.append(
                "ALLOWED_HOSTS is empty — set the deployment's hostname(s) so a forged Host "
                "header cannot redirect verification links."
            )
        if self.RAW_EXPORT_MOCK:
            errors.append("RAW_EXPORT_MOCK must be false in production — it fabricates data.")
        if self.SEED_DEMO_DATA:
            errors.append("SEED_DEMO_DATA must be false in production.")
        # Empty counts as unset, not as "not the placeholder". docker-compose passes
        # ${DPO_EMAIL:-}, so an unconfigured deployment arrives here with "" rather
        # than the default — which used to sail past this check and publish a blank
        # contact on /privacy.
        if not self.DPO_EMAIL.strip() or self.DPO_EMAIL.strip() == "privacy@nurturehub.org":
            errors.append(
                "DPO_EMAIL is unset or still the placeholder. The DPDP Act requires a published "
                "contact for the person answering data-principal requests."
            )
        if "*" in self.cors_origins_list:
            errors.append("CORS_ORIGINS must not contain '*' — name the real frontend origins.")

        if errors:
            raise RuntimeError(
                "Refusing to start in production with insecure configuration:\n  - "
                + "\n  - ".join(errors)
            )

    def security_posture(self) -> list[dict]:
        """Live self-assessment of the configurable controls.

        Rendered on the admin security dashboard. Deliberately reports what is
        actually configured rather than what is intended, because the failure
        mode this guards against is a control that everyone believes is on.
        """
        def check(key, label, ok, detail, severity="high"):
            return {"key": key, "label": label, "ok": bool(ok), "detail": detail, "severity": severity}

        return [
            check(
                "phi_encryption", "Patient contact details encrypted at rest",
                bool(self.PHI_ENCRYPTION_KEYS),
                "AES-256-GCM with a versioned key ring" if self.PHI_ENCRYPTION_KEYS
                else "PHI_ENCRYPTION_KEYS is not set — identifiers are stored in plaintext.",
            ),
            check(
                "audit_key", "Audit trail signed with its own key",
                bool(self.AUDIT_HMAC_KEY) and self.AUDIT_HMAC_KEY != self.JWT_SECRET_KEY,
                "Independent HMAC key configured" if self.AUDIT_HMAC_KEY
                else "Falling back to a key derived from JWT_SECRET_KEY.",
            ),
            check(
                "mfa", "Second factor required for administrators",
                self.MFA_REQUIRED_FOR_ADMINS,
                "Enforced at admin sign-in" if self.MFA_REQUIRED_FOR_ADMINS
                else "Administrators can sign in with a password alone.",
            ),
            check(
                "hsts", "HTTP Strict Transport Security",
                self.HSTS_ENABLED,
                f"max-age={self.HSTS_MAX_AGE}" if self.HSTS_ENABLED else "Disabled.",
                severity="medium",
            ),
            check(
                "allowed_hosts", "Host header pinned",
                bool(self.ALLOWED_HOSTS),
                ", ".join(self.allowed_hosts_list) if self.ALLOWED_HOSTS
                else "Any Host header is accepted.",
                severity="medium",
            ),
            check(
                "legacy_tokens", "Legacy tokens without a session record refused",
                not self.SESSION_ALLOW_LEGACY_TOKENS,
                "Every token maps to a revocable session" if not self.SESSION_ALLOW_LEGACY_TOKENS
                else "Pre-rollout tokens are still accepted; turn this off once a token lifetime has passed.",
                severity="medium",
            ),
            check(
                "dev_admin", "Development administrator fallback disabled",
                not self.ALLOW_DEV_ADMIN and not self.ADMIN_BOOTSTRAP_PASSWORD,
                "No built-in credentials" if not self.ALLOW_DEV_ADMIN and not self.ADMIN_BOOTSTRAP_PASSWORD
                else "A built-in administrator credential is active.",
                severity="critical",
            ),
            check(
                "demo_data", "No fabricated data in reports",
                not self.SEED_DEMO_DATA and not self.RAW_EXPORT_MOCK,
                "Demo seeding and mock exports are off" if not self.SEED_DEMO_DATA and not self.RAW_EXPORT_MOCK
                else "Demo or mock data is enabled — reports may contain fabricated rows.",
            ),
            check(
                "uploads", "Media served from object storage, not an open local mount",
                not self.SERVE_LOCAL_UPLOADS or not self.is_production,
                "Local uploads mount disabled" if not self.SERVE_LOCAL_UPLOADS
                else "backend/uploads/ is served without authentication.",
                severity="medium",
            ),
            check(
                "api_docs", "Interactive API docs closed in production",
                not (self.is_production and self.ENABLE_API_DOCS),
                "Disabled" if not self.ENABLE_API_DOCS else "Reachable at /docs.",
                severity="low",
            ),
            check(
                "phi_freeze", "Patient data access is not frozen",
                not self.PHI_ACCESS_FROZEN,
                "Normal operation" if not self.PHI_ACCESS_FROZEN
                else "EMERGENCY FREEZE ACTIVE — all patient-data endpoints are refusing requests.",
                severity="critical",
            ),
        ]


settings = Settings()
