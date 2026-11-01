#!/usr/bin/env python3
"""
Scan queue worker. The admin panel inserts rows with status='queued' into `scans`;
this worker picks them up one at a time and runs the Scrapy spider in a subprocess.

Run it permanently with systemd / supervisor:
    cd /var/www/vto/scraper && python3 worker.py
or from cron every minute with --once:
    * * * * * cd /var/www/vto/scraper && python3 worker.py --once
"""
import subprocess
import sys
import time
import os

from vto_scanner import db

HERE = os.path.dirname(os.path.abspath(__file__))

# Windows pipes default to cp1252: printing "→" would crash the worker after it has claimed a scan
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def claim_next():
    """Atomically claim one queued scan."""
    with db.connect() as c, c.cursor() as cur:
        cur.execute("SELECT id FROM scans WHERE status='queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED")
        row = cur.fetchone()
        if not row:
            return None
        cur.execute("UPDATE scans SET status='running', started_at=NOW() WHERE id=%s AND status='queued'", (row["id"],))
        return row["id"] if cur.rowcount else None


def run(scan_id):
    print(f"→ scan #{scan_id}", flush=True)
    proc = subprocess.run(
        [sys.executable, "-m", "scrapy", "crawl", "vto_scan", "-a", f"scan_id={scan_id}"],
        cwd=HERE, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60 * 30,
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    if proc.returncode != 0:
        db.append_log(scan_id, "Spider crashed:\n" + proc.stderr[-1500:])
        db.execute("UPDATE scans SET status='failed', finished_at=NOW() WHERE id=%s", (scan_id,))
    print(f"✓ scan #{scan_id} exit={proc.returncode}", flush=True)


def main():
    once = "--once" in sys.argv
    # recover scans stuck in 'running' for > 40 min (crashed worker)
    db.execute("UPDATE scans SET status='failed' WHERE status='running' AND started_at < NOW() - INTERVAL 40 MINUTE")
    while True:
        sid = claim_next()
        if sid:
            try:
                run(sid)
            except subprocess.TimeoutExpired:
                db.execute("UPDATE scans SET status='failed', finished_at=NOW() WHERE id=%s", (sid,))
            continue
        if once:
            break
        time.sleep(5)


if __name__ == "__main__":
    main()
