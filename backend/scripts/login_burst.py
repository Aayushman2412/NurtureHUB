"""
Sign-in burst: N mock learners log in through the real endpoint, C at a time.

For rehearsing a test start. Every sign-in is a real bcrypt verification, so
this measures what actually limits a crowd logging in at once: CPU.

Run it where the backend is reachable, e.g. on the server:
  docker compose exec backend python -m scripts.login_burst --count 6000 --concurrency 400

Each request carries its own X-Forwarded-For address. Without that, every
sign-in from this one machine would share one per-address rate-limit bucket
and the run would measure the limiter rather than the server. It only has an
effect when the backend trusts proxy headers (TRUST_PROXY_HEADERS=true, which
the live-testing overlay sets).

Uses mock learners (@nurturehub.mock, password "password123") created by
scripts.seed_mock_learners. Real accounts are never touched.
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from app.database import SessionLocal
from app.models import ProgramDistrict, User

MOCK_SUFFIX = "@nurturehub.mock"


def main():
    ap = argparse.ArgumentParser(description="Sign-in burst against the real login endpoint.")
    ap.add_argument("--district", default="jalna")
    ap.add_argument("--count", type=int, default=6000)
    ap.add_argument("--concurrency", type=int, default=400)
    ap.add_argument("--api", default="http://localhost:8000")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        pd = db.query(ProgramDistrict).filter(ProgramDistrict.slug == args.district).first()
        if not pd:
            raise SystemExit(f"No project '{args.district}'.")
        emails = [e for (e,) in db.query(User.email).filter(
            User.program_district_id == pd.id, User.email.like(f"%{MOCK_SUFFIX}"))
            .order_by(User.id).limit(args.count).all()]
    finally:
        db.close()
    if not emails:
        raise SystemExit("No mock learners — run scripts.seed_mock_learners first.")

    url = f"{args.api}/api/auth/login"

    def one(i_email):
        i, email = i_email
        fake_ip = f"10.{(i >> 16) & 255}.{(i >> 8) & 255}.{i & 255}"
        req = urllib.request.Request(
            url, method="POST",
            data=json.dumps({"email": email, "password": "password123"}).encode(),
            headers={"Content-Type": "application/json", "X-Forwarded-For": fake_ip},
        )
        t = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                r.read()
                code = r.status
        except urllib.error.HTTPError as e:
            code = e.code
        except Exception as e:  # noqa: BLE001
            code = type(e).__name__
        return code, time.perf_counter() - t

    print(f"{len(emails)} sign-ins, {args.concurrency} at a time, against {url} ...", flush=True)
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        results = list(pool.map(one, enumerate(emails)))
    wall = time.perf_counter() - t0

    codes = Counter(c for c, _ in results)
    ok = sorted(d for c, d in results if c == 200)
    print(f"done in {wall:.1f}s -> {len(ok)/wall:.1f} successful sign-ins/s")
    print(f"status codes: {dict(codes)}")
    if ok:
        pct = lambda p: ok[min(len(ok) - 1, int(len(ok) * p))]  # noqa: E731
        print(f"wait per sign-in: median {statistics.median(ok):.2f}s, "
              f"p95 {pct(0.95):.2f}s, p99 {pct(0.99):.2f}s, max {ok[-1]:.2f}s")
    failed = len(results) - len(ok)
    print("RESULT:", "PASS" if failed == 0 else f"{failed} sign-in(s) did not succeed — see status codes")


if __name__ == "__main__":
    main()
