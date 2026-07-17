"""Load-test configuration — everything overridable via NH_* environment variables.

The simulated journey mirrors the real frontend request-for-request
(see loadtest/README.md for the mapping). Timing is compressed by
NH_TIME_SCALE: request COUNTS stay identical to a real user, only the
pacing shrinks, so N virtual users ~= N / NH_TIME_SCALE real users of
steady-state load.
"""
import os


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _env_f(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def _env_i(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def _env_b(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# --- target ---------------------------------------------------------------
HOST = _env("NH_HOST", "http://127.0.0.1:8010")
WS_BASE = HOST.replace("https://", "wss://").replace("http://", "ws://")

# --- accounts (pre-seeded via seed_accounts.py) ---------------------------
ACCOUNT_EMAIL_FMT = _env("NH_ACCOUNT_EMAIL_FMT", "loadtest_{n}@nhload.org")
ACCOUNT_PASSWORD = _env("NH_ACCOUNT_PASSWORD", "password123")
ACCOUNT_COUNT = _env_i("NH_ACCOUNT_COUNT", 5000)
# Multi-worker runs: each worker claims a disjoint slice of accounts.
ACCOUNTS_PER_WORKER = _env_i("NH_ACCOUNTS_PER_WORKER", 1000)

# Pre-mint JWTs client-side instead of calling /api/auth/login. Models the
# real world where users hold 24h tokens, and isolates content-endpoint
# capacity from the bcrypt/rate-limit login wall. Dev secret only.
PREMINT_TOKENS = _env_b("NH_PREMINT_TOKENS", False)
DEV_JWT_SECRET = _env("NH_JWT_SECRET", "supersecretkeyfornurturehubdevelopment12345")

# --- pacing ---------------------------------------------------------------
# 1.0 = real-time journey (~30-60 min per user). 0.02 = 50x compression.
TIME_SCALE = _env_f("NH_TIME_SCALE", 0.02)
# Reported video length (drives number of 10s progress beats per tutorial).
VIDEO_SECONDS = _env_f("NH_VIDEO_SECONDS", 60.0)
# Real-world cadences (seconds) taken from the frontend code — do not change
# these to tune load; change TIME_SCALE.
NOTIF_POLL_SECONDS = 15.0          # NotificationPanel.tsx:48
BEAT_INTERVAL_SECONDS = 10.0       # TrackedVideoPlayer.tsx:13
WS_HEARTBEAT_SECONDS = 30.0        # useTestEventEmitter.ts:18
SECONDS_PER_QUESTION = (15.0, 60.0)  # human answering pace range

# --- journey shape --------------------------------------------------------
NOTIF_POLL_ENABLED = _env_b("NH_NOTIF_POLL", True)
WS_ENABLED = _env_b("NH_WS", True)              # candidate proctoring socket
DO_MOTHER_FORMS = _env_b("NH_MOTHER_FORMS", True)
LOOP_JOURNEY = _env_b("NH_LOOP_JOURNEY", False)  # restart journey when done

# --- herd (thundering-herd exam submit) ------------------------------------
HERD_TEST_ID = _env_i("NH_HERD_TEST_ID", 5)      # Meghalaya formative test
HERD_SIZE = _env_i("NH_HERD_SIZE", 100)          # cohort that fires together
HERD_MAX_WAIT = _env_f("NH_HERD_MAX_WAIT", 120)  # release partial cohort after
HERD_LEAD = _env_f("NH_HERD_LEAD", 2.0)          # absolute-time release lead

# --- admin monitor client ---------------------------------------------------
ADMIN_EMAIL = _env("NH_ADMIN_EMAIL", "admin@nurturehub.org")
ADMIN_PASSWORD = _env("NH_ADMIN_PASSWORD", "admin123")

# --- staged load shape (NH_SHAPE=1) -----------------------------------------
# Comma-separated "users:spawn_rate:hold_seconds" stages. The shape walks each
# stage in order so one distributed run climbs toward the target and reveals the
# wall (which failures start, at what user count). Default: 1k -> 3k -> 5k -> 7k.
SHAPE_ENABLED = _env_b("NH_SHAPE", False)
SHAPE_STAGES = _env(
    "NH_SHAPE_STAGES",
    "1000:200:180, 3000:300:180, 5000:400:180, 7000:500:300",
)
