import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

BOT_NAME = "vto_scanner"
SPIDER_MODULES = ["vto_scanner.spiders"]
NEWSPIDER_MODULE = "vto_scanner.spiders"

USER_AGENT = os.getenv(
    "VTO_USER_AGENT",
    "Mozilla/5.0 (compatible; VTOScanner/1.0; +https://vto.yourdomain.com/bot)",
)

# Be a polite crawler. Merchants who integrate VTO can allow our bot in robots.txt.
ROBOTSTXT_OBEY = os.getenv("VTO_OBEY_ROBOTS", "1") == "1"
CONCURRENT_REQUESTS = 4
CONCURRENT_REQUESTS_PER_DOMAIN = 2
DOWNLOAD_DELAY = 0.75
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 1
AUTOTHROTTLE_MAX_DELAY = 10
DOWNLOAD_TIMEOUT = 30
RETRY_TIMES = 2
COOKIES_ENABLED = True
LOG_LEVEL = os.getenv("VTO_LOG_LEVEL", "INFO")
REQUEST_FINGERPRINTER_IMPLEMENTATION = "2.7"
FEED_EXPORT_ENCODING = "utf-8"

# Max pages per scan
VTO_MAX_PAGES = int(os.getenv("VTO_MAX_PAGES", "60"))

# Optional JS rendering
if os.getenv("VTO_USE_PLAYWRIGHT", "0") == "1":
    DOWNLOAD_HANDLERS = {
        "http": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
        "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
    }
    TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"
    PLAYWRIGHT_BROWSER_TYPE = "chromium"
    PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT = 45000
else:
    TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"
