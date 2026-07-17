"""Sample backend-process and Postgres health during a load run -> CSV.

Columns: ts, cpu_pct (backend process, all cores=100*n), rss_mb, threads,
open_conns (TCP established on the port), pg_total, pg_active,
pg_idle_in_tx, pg_waiting.

Usage: python monitor_server.py --port 8010 --out run1_monitor.csv
Stops on Ctrl+C or when --duration elapses.
"""
import argparse
import csv
import os
import sys
import time

import psutil
import psycopg2

DB_URL = os.environ.get(
    "NH_LOADTEST_DB",
    "postgresql://postgres:756824@localhost/nurturehub_loadtest",
)


def find_backend(port: int) -> psutil.Process | None:
    for conn in psutil.net_connections(kind="tcp"):
        if conn.laddr and conn.laddr.port == port and conn.status == "LISTEN" and conn.pid:
            return psutil.Process(conn.pid)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8010)
    ap.add_argument("--out", default="monitor.csv")
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--duration", type=float, default=0, help="0 = until killed")
    args = ap.parse_args()

    proc = find_backend(args.port)
    if proc is None:
        print(f"no listener on port {args.port}", file=sys.stderr)
        sys.exit(1)
    proc.cpu_percent()  # prime

    pg = psycopg2.connect(DB_URL)
    pg.autocommit = True

    started = time.time()
    with open(args.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ts", "cpu_pct", "rss_mb", "threads", "estab_conns",
                    "pg_total", "pg_active", "pg_idle_in_tx", "pg_waiting"])
        while True:
            if args.duration and time.time() - started > args.duration:
                break
            time.sleep(args.interval)
            try:
                cpu = proc.cpu_percent()
                rss = proc.memory_info().rss / (1024 * 1024)
                thr = proc.num_threads()
            except psutil.NoSuchProcess:
                print("backend process exited", file=sys.stderr)
                break
            estab = sum(1 for c in psutil.net_connections(kind="tcp")
                        if c.laddr and c.laddr.port == args.port
                        and c.status == "ESTABLISHED")
            with pg.cursor() as cur:
                cur.execute("""
                    SELECT count(*),
                           count(*) FILTER (WHERE state = 'active'),
                           count(*) FILTER (WHERE state = 'idle in transaction'),
                           count(*) FILTER (WHERE wait_event_type = 'Lock')
                    FROM pg_stat_activity
                    WHERE datname = current_database()""")
                pg_total, pg_active, pg_idle_tx, pg_wait = cur.fetchone()
            w.writerow([round(time.time() - started, 1), cpu, round(rss, 1), thr,
                        estab, pg_total, pg_active, pg_idle_tx, pg_wait])
            f.flush()


if __name__ == "__main__":
    main()
