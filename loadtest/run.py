"""One-command scenario runner: reset -> setup -> monitor -> locust -> summary.

Examples:
  python run.py --scenario journey --users 200 --spawn-rate 20 --duration 120
  python run.py --scenario herd --users 200 --spawn-rate 50 --duration 180 \
      --herd-size 200 --questions 20
  python run.py --scenario journey --users 400 --premint --label after_fixes

Results land in loadtest/results/<label>/ as locust CSVs + monitor.csv.
"""
import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
PY = str(HERE / "venv-win" / "Scripts" / "python.exe")
LOCUST = str(HERE / "venv-win" / "Scripts" / "locust.exe")

SCENARIO_CLASSES = {"journey": "JourneyUser", "herd": "ExamHerdUser"}


def sh(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd))
    return subprocess.run(cmd, check=True, **kw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", choices=SCENARIO_CLASSES, default="journey")
    ap.add_argument("--users", type=int, default=100)
    ap.add_argument("--spawn-rate", type=float, default=20)
    ap.add_argument("--duration", type=int, default=120, help="seconds")
    ap.add_argument("--label", default=None)
    ap.add_argument("--host", default=os.environ.get("NH_HOST", "http://127.0.0.1:8010"))
    ap.add_argument("--time-scale", type=float, default=None)
    ap.add_argument("--premint", action="store_true",
                    help="pre-mint JWTs instead of hitting /api/auth/login")
    ap.add_argument("--no-ws", action="store_true")
    ap.add_argument("--no-reset", action="store_true")
    ap.add_argument("--herd-size", type=int, default=None)
    ap.add_argument("--herd-test", type=int, default=5)
    ap.add_argument("--questions", type=int, default=0,
                    help="inflate exam question count before the run")
    args = ap.parse_args()

    label = args.label or f"{args.scenario}_{args.users}u_{int(time.time())}"
    outdir = HERE / "results" / label
    outdir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env.setdefault("NH_HOST", args.host)
    if args.time_scale is not None:
        env["NH_TIME_SCALE"] = str(args.time_scale)
    if args.premint:
        env["NH_PREMINT_TOKENS"] = "true"
    if args.no_ws:
        env["NH_WS"] = "false"
    env["NH_HERD_TEST_ID"] = str(args.herd_test)
    if args.herd_size:
        env["NH_HERD_SIZE"] = str(args.herd_size)

    # 1. reset dynamic state so runs are comparable
    if not args.no_reset:
        sh([PY, str(HERE / "seed_accounts.py"), "--reset-attempts", "--reset-progress",
            "--reset-mothers"], env=env)
        if args.scenario == "herd":
            sh([PY, str(HERE / "seed_accounts.py"), "--complete-tutorials"], env=env)

    # 2. activate tests (+ optional question inflation)
    setup = [PY, str(HERE / "setup_env.py"), "--activate", "5", "6",
             "--district", "meghalaya"]
    if args.questions:
        setup += ["--questions", str(args.questions)]
    sh(setup, env=env)

    # 3. start the server monitor
    monitor = subprocess.Popen(
        [PY, str(HERE / "monitor_server.py"), "--port",
         args.host.rsplit(":", 1)[-1], "--out", str(outdir / "monitor.csv")],
        env=env)

    # 4. locust headless run
    code = 0
    try:
        cmd = [LOCUST, "-f", str(HERE / "locustfile.py"),
               SCENARIO_CLASSES[args.scenario],
               "--headless", "-u", str(args.users), "-r", str(args.spawn_rate),
               "-t", f"{args.duration}s", "--host", args.host,
               "--csv", str(outdir / "locust"), "--csv-full-history",
               "--only-summary"]
        print("+", " ".join(cmd))
        code = subprocess.call(cmd, env=env, cwd=str(HERE))
    finally:
        monitor.terminate()

    print(f"\nresults: {outdir}")
    sys.exit(code)


if __name__ == "__main__":
    main()
