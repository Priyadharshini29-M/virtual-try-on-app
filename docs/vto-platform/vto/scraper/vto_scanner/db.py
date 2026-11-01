"""Tiny MySQL helper shared by the spider and the worker (same DB as the PHP backend)."""
import os
import pymysql
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


def connect():
    return pymysql.connect(
        host=os.getenv("VTO_DB_HOST", "127.0.0.1"),
        port=int(os.getenv("VTO_DB_PORT", "3306")),
        user=os.getenv("VTO_DB_USER", "vto_user"),
        password=os.getenv("VTO_DB_PASS", "change_me"),
        database=os.getenv("VTO_DB_NAME", "vto_platform"),
        charset="utf8mb4",
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )


def fetch_one(sql, params=()):
    with connect() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def execute(sql, params=()):
    with connect() as c, c.cursor() as cur:
        cur.execute(sql, params)
        return cur.rowcount


def append_log(scan_id, line):
    execute(
        "UPDATE scans SET log = CONCAT(COALESCE(log,''), %s) WHERE id = %s",
        (line[:2000] + "\n", scan_id),
    )


def upsert_selector(site_id, page_type, target, selector, confidence, sample_url):
    """Scrapy-found selectors go straight to 'active' (they are verified across several pages)."""
    execute(
        """INSERT INTO selectors (site_id, page_type, target, selector, source, confidence, status, sample_url)
           VALUES (%s, %s, %s, %s, 'scrapy', %s, 'active', %s)
           ON DUPLICATE KEY UPDATE
             confidence = GREATEST(confidence, VALUES(confidence)),
             -- a browser-learned 'pending' selector confirmed by the crawler becomes active;
             -- auto-disabled ones are re-enabled (manual disables stay as they are)
             status = IF(status = 'pending' OR (status = 'disabled' AND source <> 'manual'), 'active', status),
             sample_url = VALUES(sample_url)""",
        (site_id, page_type, target, selector[:600], round(confidence, 3), (sample_url or "")[:500]),
    )
