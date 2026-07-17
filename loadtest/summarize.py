"""Compact one-line-per-endpoint summary of a locust result dir + monitor peaks."""
import csv
import sys
from pathlib import Path


def summarize(outdir: Path):
    stats = outdir / "locust_stats.csv"
    if not stats.exists():
        print(f"no stats in {outdir}")
        return
    rows = list(csv.DictReader(open(stats)))
    agg = next((r for r in rows if r["Name"] == "Aggregated"), None)

    print(f"\n=== {outdir.name} ===")
    if agg:
        reqs = int(agg["Request Count"]); fails = int(agg["Failure Count"])
        fr = 100 * fails / reqs if reqs else 0
        print(f"total reqs={reqs}  fails={fails} ({fr:.1f}%)  "
              f"rps={float(agg['Requests/s']):.0f}  "
              f"med={agg['Median Response Time']}ms  "
              f"p95={agg['95%']}ms  p99={agg['99%']}ms  max={agg['Max Response Time']}ms")

    # worst endpoints by p95
    interesting = [r for r in rows if r["Name"] != "Aggregated" and int(r["Request Count"]) > 0]
    interesting.sort(key=lambda r: float(r["95%"] or 0), reverse=True)
    print("  slowest by p95:")
    for r in interesting[:8]:
        fails = int(r["Failure Count"]); reqs = int(r["Request Count"])
        fr = f"  {100*fails/reqs:.0f}% fail" if fails else ""
        print(f"    {r['95%']:>6}ms p95  {r['Median Response Time']:>5}ms med  "
              f"n={reqs:<5} {r['Type']:4} {r['Name']}{fr}")

    # failures breakdown
    ffile = outdir / "locust_failures.csv"
    if ffile.exists():
        frows = list(csv.DictReader(open(ffile)))
        if frows:
            print("  failures:")
            for r in sorted(frows, key=lambda x: -int(x["Occurrences"]))[:8]:
                print(f"    {r['Occurrences']:>5}x {r['Name']}  ::  {r['Error'][:80]}")

    # monitor peaks
    mon = outdir / "monitor.csv"
    if mon.exists():
        mrows = list(csv.DictReader(open(mon)))
        if mrows:
            cpu = max(float(r["cpu_pct"]) for r in mrows)
            rss = max(float(r["rss_mb"]) for r in mrows)
            thr = max(int(r["threads"]) for r in mrows)
            conns = max(int(r["estab_conns"]) for r in mrows)
            pgt = max(int(r["pg_total"]) for r in mrows)
            pga = max(int(r["pg_active"]) for r in mrows)
            pgi = max(int(r["pg_idle_in_tx"]) for r in mrows)
            pgw = max(int(r["pg_waiting"]) for r in mrows)
            print(f"  server peak: cpu={cpu:.0f}%  rss={rss:.0f}MB  threads={thr}  "
                  f"sockets={conns}  pg_conns={pgt}(active {pga}/idle_tx {pgi}/waiting {pgw})")


if __name__ == "__main__":
    base = Path(__file__).parent / "results"
    targets = sys.argv[1:] or [p.name for p in sorted(base.iterdir()) if p.is_dir()]
    for t in targets:
        summarize(base / t)
