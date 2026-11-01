"""
Plan A – Scrapy scanner.

Usage:
    scrapy crawl vto_scan -a scan_id=12           # normal: driven by the admin "Run scan" queue
    scrapy crawl vto_scan -a url=https://shop.com -a dry=1   # print results only, no DB

The spider crawls the merchant's site (same domain), classifies each page as product or
collection, finds injection selectors on each and keeps the ones that repeat across pages.
Results are written to the `selectors` table with source='scrapy'.
"""
import os
import re
from collections import Counter, defaultdict
from urllib.parse import urlparse

import scrapy

from vto_scanner import db
from vto_scanner.analyzer import analyze

PRODUCT_HINT = re.compile(r"/(p|dp|product|products|pd|buy)/|[-/]p-?\d{4,}|/\d{6,}", re.I)
COLLECTION_HINT = re.compile(r"/(c|collections?|category|categories|shop|catalog|men|women|kids|sale|new)", re.I)
SKIP = re.compile(r"\.(pdf|jpg|jpeg|png|webp|gif|svg|zip|mp4|css|js)(\?|$)|/(cart|checkout|account|login|signin|register|wishlist|search\?)", re.I)


class VtoScanSpider(scrapy.Spider):
    name = "vto_scan"

    def __init__(self, scan_id=None, url=None, dry="0", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.dry = dry == "1"
        self.scan_id = int(scan_id) if scan_id else None
        self.site_id = None
        if self.scan_id:
            row = db.fetch_one("SELECT s.id, s.site_id, s.start_url FROM scans s WHERE s.id = %s", (self.scan_id,))
            if not row:
                raise ValueError(f"scan {scan_id} not found")
            self.site_id, url = row["site_id"], row["start_url"]
            db.execute("UPDATE scans SET status='running', started_at=NOW() WHERE id=%s", (self.scan_id,))
        if not url:
            raise ValueError("url or scan_id required")
        self.start_urls = [url]
        host = urlparse(url).netloc.lower()
        self.base_host = host[4:] if host.startswith("www.") else host
        self.max_pages = int(os.getenv("VTO_MAX_PAGES", "60"))
        self.seen_pages = 0
        self.page_counts = Counter()                       # product / collection page totals
        self.votes = defaultdict(Counter)                  # (page_type, target) -> Counter(selector)
        self.conf = {}                                     # (page_type, target, selector) -> confidence
        self.sample = {}

    # ---------------------------------------------------------------- requests
    def start_requests(self):
        for u in self.start_urls:
            yield self._req(u, priority=10)

    def _req(self, url, priority=0):
        meta = {}
        if os.getenv("VTO_USE_PLAYWRIGHT", "0") == "1":
            meta = {"playwright": True, "playwright_page_goto_kwargs": {"wait_until": "networkidle"}}
        return scrapy.Request(url, callback=self.parse, meta=meta, priority=priority, errback=self.on_error)

    def on_error(self, failure):
        self._log(f"ERR {failure.request.url}: {failure.value}")

    # ---------------------------------------------------------------- parse
    def parse(self, response):
        if not hasattr(response, "text") or self.seen_pages >= self.max_pages:
            return
        self.seen_pages += 1
        page_type, targets, extra_cards = analyze(response.text, response.url)
        self.page_counts[page_type] += 1
        self._vote(page_type, targets, response.url)
        if extra_cards:
            self.page_counts["collection"] += 1
            self._vote("collection", extra_cards, response.url)
        self._log(f"[{page_type}] {response.url} -> {', '.join(targets) or 'nothing'}")

        if self.seen_pages >= self.max_pages:
            return
        # follow internal links, preferring product & collection-looking URLs
        for href in response.css("a::attr(href)").getall():
            u = response.urljoin(href).split("#")[0]
            host = urlparse(u).netloc.lower()
            host = host[4:] if host.startswith("www.") else host
            if host != self.base_host or SKIP.search(u):
                continue
            prio = 5 if PRODUCT_HINT.search(u) else 3 if COLLECTION_HINT.search(u) else 0
            yield self._req(u, priority=prio)

    def _vote(self, page_type, targets, url):
        for target, (selector, conf) in targets.items():
            self.votes[(page_type, target)][selector] += 1
            key = (page_type, target, selector)
            self.conf[key] = max(self.conf.get(key, 0), conf)
            self.sample.setdefault(key, url)

    # ---------------------------------------------------------------- finish
    def closed(self, reason):
        saved = 0
        lines = []
        for (page_type, target), counter in self.votes.items():
            total = max(1, self.page_counts[page_type])
            # keep the top 2 selectors per target; confidence grows with how many pages agreed
            for selector, n in counter.most_common(2):
                share = n / total
                if n < 2 and total > 2:          # seen only once on a multi-page crawl → unreliable
                    continue
                conf = min(0.95, self.conf[(page_type, target, selector)] * 0.6 + share * 0.4)
                lines.append(f"{page_type}.{target}: {selector}  (pages={n}/{total}, conf={conf:.2f})")
                if not self.dry and self.site_id:
                    db.upsert_selector(self.site_id, page_type, target, selector, conf,
                                       self.sample[(page_type, target, selector)])
                saved += 1

        summary = f"Finished ({reason}). pages={self.seen_pages} product={self.page_counts['product']} " \
                  f"collection={self.page_counts['collection']} selectors={saved}"
        self.logger.info(summary)
        for l in lines:
            self.logger.info(l)
        if self.scan_id:
            db.append_log(self.scan_id, "\n".join(lines + [summary]))
            db.execute(
                "UPDATE scans SET status=%s, finished_at=NOW(), pages_crawled=%s, selectors_found=%s WHERE id=%s",
                ("done" if saved else "failed", self.seen_pages, saved, self.scan_id),
            )

    def _log(self, line):
        self.logger.info(line)
        if self.scan_id and not self.dry:
            db.append_log(self.scan_id, line)
