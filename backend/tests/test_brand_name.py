"""Guard: the product is called EduPoshan; the old name must not reappear.

Scans file contents and file paths for ``nurture`` (any case). A line passes
only if, after deleting every substring matched by an allowlisted regex whose
path glob matches the file, no ``nurture`` remains.

To keep one more identifier, add ONE line to ALLOWLIST: (path_glob, regex, reason).
Globs are matched with fnmatch against the repo-relative POSIX path (``*``
crosses ``/``).

Areas can be checked independently:  pytest tests/test_brand_name.py -k backend
"""
from __future__ import annotations

import fnmatch
import os
import re
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
OLD_NAME = re.compile(r"nurture", re.IGNORECASE)

# (path_glob, regex, reason) — deliberate survivors of the rename.
ALLOWLIST: list[tuple[str, str, str]] = [
    ("backend/app/security/audit.py", r"nurturehub\.audit\.v1",
     "key-derivation label for the audit-chain MAC; changing it invalidates every existing audit row"),
    ("backend/*", r"[\w.+-]*@nurturehub\.(mock|demo)|nurturehub\.(mock|demo)",
     "mock/demo account e-mail domains that exist in live and local databases; cleanup scripts match on them"),
    ("loadtest/*", r"[\w.+-]*@nurturehub\.(mock|demo)|nurturehub\.(mock|demo)",
     "mock/demo account e-mail domains that exist in live and local databases; cleanup scripts match on them"),
    ("deploy/*", r"[\w.+-]*@nurturehub\.(mock|demo)|nurturehub\.(mock|demo)",
     "mock/demo account e-mail domains that exist in live and local databases; cleanup scripts match on them"),
    ("backend/app/identity.py", r"mobile\.nurturehub\.invalid",
     "placeholder e-mail domain stored on mobile-only accounts"),
    ("backend/tests/*", r"mobile\.nurturehub\.invalid",
     "tests of the stored placeholder e-mail domain"),
    ("backend/app/models_security.py", r"(?<= )nurturehub(?= \| state_govt)",
     "stored custody_party value (comment listing the enum values)"),
    ("backend/app/security/incidents.py", r'"nurturehub"(?=\s*:)',
     "stored custody_party value used as a dict key; only its label is renamed"),
    ("frontend/src/pages/admin/AdminDataProtectionPage.tsx", r'"nurturehub"|value="nurturehub"',
     "stored custody_party value used as an option value; only its label is renamed"),
    ("frontend/src/*", r'custody_party[^\n]*"nurturehub"',
     "stored custody_party value in tests/typings of the data-protection page"),
    ("frontend/src/lib/attemptStorage.ts", r"nurturehub_attempt_",
     "legacy localStorage key: a test draft saved before the rename is moved to the new key on first read"),
    ("backend/app/security/passwords.py", r'"nurturehub(123)?"',
     "banned-password entries: the old name stays a guessable password"),
    ("backend/tests/test_security_layer.py", r'"nurturehub(123)?"',
     "tests of the banned-password entries"),
    ("backend/app/routers/admin_forms.py", r"nurturehub-form-template",
     "legacy format marker still accepted when importing templates exported before the rename"),
    ("backend/tests/*", r"nurturehub-form-template",
     "tests of the legacy form-template marker"),
    ("backend/app/config.py", r"supersecretkeyfornurturehubdevelopment12345",
     "dev-only default JWT secret string (never valid in production)"),
    ("backend/.env.example", r"supersecretkeyfornurturehubdevelopment12345",
     "dev-only default JWT secret string, mirrored in the example env file"),
    ("docker-compose.yml", r"supersecretkeyfornurturehubdevelopment12345",
     "dev-only default JWT secret string (never valid in production)"),
    ("loadtest/*", r"supersecretkeyfornurturehubdevelopment12345",
     "dev-only default JWT secret string (never valid in production)"),
    ("backend/app/config.py", r"localhost/NurtureHub",
     "the developer's local Postgres database name in DEV_DATABASE_URL"),
    ("backend/.env.example", r"localhost/NurtureHub",
     "the developer's local Postgres database name (example URL)"),
    ("backend/app/config.py", r"privacy@nurturehub\.org",
     "legacy placeholder that production validation must keep rejecting"),
    ("backend/tests/test_security_layer.py", r"privacy@nurturehub\.org",
     "test that production validation still rejects the legacy placeholder"),
    ("docker-compose*.yml", r"name: nurturehub\b|POSTGRES_(USER|PASSWORD|DB):-nurturehub|aayushman2412/nurturehub",
     "live deployment's compose project, volume, database and registry names"),
    ("docker-compose.yml", r"NurtureHUB <noreply@nurturehub\.org>|admin@nurturehub\.org",
     "old SMTP_FROM / ADMIN_BOOTSTRAP_EMAIL defaults: the server checkout carries a local edit to this file, "
     "so the CD's plain `git pull` fails if it changes; the backend reads the old sender as unset"),
    ("backend/app/utils.py", r"NurtureHUB <noreply@nurturehub\.org>",
     "the old compose default sender, recognised so it is treated as unset"),
    ("backend/tests/test_brand_runtime.py", r"NurtureHUB <noreply@nurturehub\.org>",
     "test that the old compose default sender is treated as unset"),
    (".github/workflows/cd.yml", r"/websites_dir/NurtureHUB|aayushman2412/nurturehub",
     "server checkout path and registry path of the live deployment"),
    ("deploy/*", r"/websites_dir/NurtureHUB|aayushman2412/nurturehub|nurturehub-(db|backend|frontend|redis)-\d+",
     "server checkout path, registry path and container names of the live deployment"),
    ("*", r"nurturehub\.edupyramids\.org",
     "the live hostname until DNS changes"),
    ("deploy/*", r"ghcr\.io/aayushman2412/nurturehub",
     "container registry path of the published images"),
    ("deploy/pgbouncer/pgbouncer.ini", r"nurturehub",
     "DB user/name must match the live Postgres role"),
    ("deploy/pgbouncer/userlist.txt.example", r"nurturehub",
     "DB user/name must match the live Postgres role"),
    (".env.example", r"POSTGRES_(USER|PASSWORD|DB)=nurturehub\b|supersecretkeyfornurturehubdevelopment12345",
     "POSTGRES_* equal to the live compose defaults; dev-only JWT default"),
    (".env.production.example", r"POSTGRES_(USER|PASSWORD|DB)=nurturehub\b|supersecretkeyfornurturehubdevelopment12345",
     "POSTGRES_* equal to the live compose defaults; dev-only JWT default"),
    ("deploy/GO_LIVE.md", r"nurturehub-pre-dp-",
     "backup filenames on the live server"),
    ("deploy/LIVE_TESTING_AT_SCALE.md", r"nurturehub_before_scale_",
     "backup filenames on the live server"),
    ("loadtest/config.py", r"admin@nurturehub\.org",
     "signs in to the existing live admin account"),
    ("loadtest/setup_env.py", r"admin@nurturehub\.org",
     "signs in to the existing live admin account"),
]

SKIP_DIRS = {"node_modules", "dist", "venv", "venv-win", "__pycache__", ".git", "results"}
SKIP_EXTS = {".png", ".ico", ".jpg", ".xlsx", ".pptx", ".pdf", ".woff2", ".pyc", ".dump"}
SKIP_FILES = {"package-lock.json", "backend/audit_spool.jsonl", "backend/.env",
              "backend/tests/test_brand_name.py"}

# area -> (directories scanned recursively, top-level file globs relative to the area's top dir)
AREAS: dict[str, tuple[list[str], list[tuple[str, list[str]]]]] = {
    "backend": (
        ["backend/app", "backend/scripts", "backend/alembic", "backend/tests", "backend/pipelines"],
        [("backend", ["Dockerfile", "requirements*.txt", "alembic.ini", "*.md", "*.toml", "*.cfg",
                      "*.py", ".env.example", ".dockerignore"])],
    ),
    "frontend": (
        ["frontend/src", "frontend/public", "frontend/brand"],
        [("frontend", ["index.html", "vite.config.ts", "pwa-assets.config.ts", "package.json",
                       "nginx*.conf", "Dockerfile*", "*.md", "tsconfig*.json", ".env.example"])],
    ),
    "deploy": (
        ["deploy", ".github", "loadtest"],
        [(".", ["docker-compose*.yml"])],
    ),
    "docs": (
        [],
        [(".", ["*.md", ".env.example", ".env.production.example"])],
    ),
}


def _all_files() -> list[str]:
    """Tracked + untracked-not-ignored files, as repo-relative POSIX paths."""
    try:
        out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=REPO,
                             capture_output=True, check=True).stdout.decode("utf-8", "replace")
        return [p for p in out.split("\0") if p and (REPO / p).is_file()]
    except (OSError, subprocess.CalledProcessError):
        found = []
        for root, dirs, files in os.walk(REPO):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                found.append(Path(root, f).relative_to(REPO).as_posix())
        return found


def _skipped(rel: str) -> bool:
    parts = rel.split("/")
    if any(p in SKIP_DIRS or p.startswith("review_") for p in parts[:-1]):
        return True
    return rel in SKIP_FILES or parts[-1] in SKIP_FILES or Path(rel).suffix.lower() in SKIP_EXTS


def _in_area(rel: str, dirs: list[str], top_globs: list[tuple[str, list[str]]]) -> bool:
    if any(rel.startswith(d + "/") for d in dirs):
        return True
    parent, _, name = rel.rpartition("/")
    for top, globs in top_globs:
        if parent == ("" if top == "." else top) and any(fnmatch.fnmatch(name, g) for g in globs):
            return True
    return False


def _residue(rel: str, text: str) -> str:
    """text with every allowlisted substring removed for this file."""
    for glob, pattern, _reason in ALLOWLIST:
        if fnmatch.fnmatch(rel, glob):
            text = re.sub(pattern, "", text)
    return text


def find_hits(area: str) -> list[str]:
    dirs, top_globs = AREAS[area]
    hits: list[str] = []
    for rel in sorted(_all_files()):
        if _skipped(rel) or not _in_area(rel, dirs, top_globs):
            continue
        if OLD_NAME.search(_residue(rel, rel)):
            hits.append(f"{rel}:0: (path)")
        try:
            content = (REPO / rel).read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(content.splitlines(), 1):
            if OLD_NAME.search(_residue(rel, line)):
                hits.append(f"{rel}:{number}: {line.strip()[:160]}")
    return hits


@pytest.mark.parametrize("area", sorted(AREAS))
def test_old_product_name_is_gone(area):
    hits = find_hits(area)
    assert not hits, f"{len(hits)} leftover 'nurture' hit(s) in area '{area}':\n" + "\n".join(hits)


def test_every_allowlist_entry_has_a_reason_and_compiles():
    for glob, pattern, reason in ALLOWLIST:
        assert glob and reason.strip(), (glob, pattern)
        re.compile(pattern)
