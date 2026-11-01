# VTO Platform — third-party Virtual Try-On for any e-commerce site

A platform-independent virtual try-on widget. It is **not** a Shopify/Woo plugin: any store
(Vilvah, Nykaa, Ajio, custom PHP, Magento, React/Next SPAs…) adds **one script tag**, and the
widget finds the right places on the page and injects the Try-On buttons by itself.

```
vto/
├── widget/vto.js            ← the embeddable script (3-plan looped fallback + try-on modal)
├── backend/                 ← PHP 8.1+ API
│   ├── api/config.php       GET  site settings + Plan-A selectors
│   ├── api/report.php       POST injection results, learned selectors, clicks
│   ├── api/tryon.php        POST shopper photo + product image → try-on result
│   ├── media.php            serves result images (shopper photos are admin-only)
│   ├── lib/                 DB, helpers, TryOnProvider (mock | http)
│   └── cli/                 create_admin.php, cleanup.php (cron)
├── admin/                   ← PHP admin panel (sites, selectors, scans, try-ons, events, admins)
├── scraper/                 ← Python Scrapy scanner (Plan A) + queue worker
├── database/schema.sql      ← MySQL schema
└── demo/                    ← two test pages (listing + React-style product page)
```

---

## How the injection works

The merchant installs:

```html
<script async src="https://vto.yourdomain.com/widget/vto.js"
        data-vto-key="SITE_API_KEY"
        data-api="https://vto.yourdomain.com/backend/api"></script>
```

The widget runs **two zones** independently, each with its own looped fallback:

| Zone | Where | What is injected |
|---|---|---|
| `product` | product page | **Try-On button** right after Add-to-Cart / Add-to-Bag, and an **icon on the main product image** |
| `cards` | collection, search, home, “similar products” on PDP | **icon on every product card image** |

### The three plans (order configurable per site in the admin)

| Plan | How it finds the elements |
|---|---|
| **A · scrapy** | Uses selectors stored in MySQL — found by the Scrapy crawler, entered manually by an admin, or **learned earlier from Plans B/C**. Fastest and most precise. |
| **B · block** | Visual/structural block segmentation in the browser: finds repeated sibling blocks that contain image + link + price (cards); on the PDP finds the main media block and scores every button in the title/price block to pick the primary CTA. |
| **C · inspect** | Semantic inspection of ids/attributes/markup: JSON-LD `Product`, `og:image`, microdata, `[itemprop]`, Shopify/Woo/Magento ids, `data-testid`, ARIA labels, “Add to cart / Add to bag / Buy now” text. |

### The loop

```
for round in 0..7:                       # waits 0.4s → 10s between rounds (SPAs render late)
    for plan in site.plan_order:         # e.g. scrapy → block → inspect
        result = plan(zone)
        if inject(result) > 0:
            report(plan, learned selectors, hit/miss of Plan-A selectors)
            fill missing pieces from the other plans (e.g. A found the button, B finds the image)
            stop
then keep alive with a MutationObserver (infinite scroll, React re-renders)
and restart on SPA route changes (pushState / popstate)
```

### Self-learning

* Selectors found by B/C are sent to `report.php` and stored as **pending**. After 3 confirmations
  they become **active**, so on the next visit Plan A injects instantly.
* A Scrapy scan that finds the same selector activates it immediately.
* Plan-A selectors that keep missing (≥25 misses and 3× more misses than hits) are **auto-disabled**
  (e.g. after a store redesign) and the loop falls back to B/C, which learn the new ones.
* Manual selectors always win and are never auto-disabled.

---

## Setup

### 1. Requirements
PHP 8.1+ with `pdo_mysql`, `curl`, `gd`, `fileinfo` · MySQL 8 / MariaDB 10.6+ · Python 3.10+ · Apache or Nginx with HTTPS.

### 2. Database
```bash
mysql -u root -p < database/schema.sql
mysql -u root -p -e "CREATE USER 'vto_user'@'localhost' IDENTIFIED BY 'STRONG_PASS';
                     GRANT ALL ON vto_platform.* TO 'vto_user'@'localhost';"
```

### 3. Backend config
Set environment variables (or edit `backend/config.php`):
```
VTO_BASE_URL=https://vto.yourdomain.com
VTO_DB_HOST=127.0.0.1  VTO_DB_NAME=vto_platform  VTO_DB_USER=vto_user  VTO_DB_PASS=STRONG_PASS
VTO_IP_SALT=<random string>
VTO_PROVIDER=mock|http   VTO_PROVIDER_URL=...   VTO_PROVIDER_KEY=...
```
Make `backend/storage/uploads` writable by the web server. The `.htaccess` files block `lib/`, `cli/`,
`storage/` and `config.php` on Apache; on **Nginx** add:
```nginx
location ~ ^/backend/(lib|cli|storage)/ { deny all; }
location = /backend/config.php { deny all; }
location /widget/ { add_header Access-Control-Allow-Origin *; }
```

### 4. First admin
```bash
php backend/cli/create_admin.php "Your Name" you@company.com 'StrongPassword123'
```
Open `https://vto.yourdomain.com/admin/` and sign in.

### 5. Scrapy scanner (Plan A)
```bash
cd scraper
pip install -r requirements.txt
cp .env.example .env            # same DB credentials
python3 worker.py               # keep running (systemd/supervisor) – or cron: * * * * * python3 worker.py --once
```
For JavaScript-rendered stores (Nykaa, Ajio and most React/Next sites) enable rendering:
```bash
pip install scrapy-playwright && playwright install chromium
# .env → VTO_USE_PLAYWRIGHT=1
```
Manual test without the DB: `scrapy crawl vto_scan -a url=https://store.com/collections/all -a dry=1`

### 6. Cron
```
0 * * * * php /var/www/vto/backend/cli/cleanup.php     # deletes shopper photos after 24h, trims logs
```

---

## Onboarding a store (admin flow)

1. **Sites → Add a store** (name, domain, scan start URL) → a Scrapy scan is queued.
2. On the site page, use the **⭑ VTO preview** bookmarklet on the live store to see the buttons
   before the merchant installs anything (debug log in the browser console).
3. Send the **embed code** to the merchant (theme `<head>`, Google Tag Manager “Custom HTML”, or the platform’s script area).
4. Watch **Plan performance** and **Events**. If a site shows “all 3 plans failed”, run a new scan
   or add a **manual selector** (it gets top priority).

## Admin panel features
* Dashboard: try-ons per day, success rate, which plan injected, entry point (button / image icon / card icon), failing sites
* Sites: status, API key (regenerate), allowed extra origins (`m.site.com`), plan order, which injections are on, button text/colours, URL regexes, daily limit
* Selectors: all selectors with source, confidence, hits/misses; activate / disable / delete; add manual
* Scans: queue + live log of each Scrapy run
* Try-ons: shopper photo, product, result side by side; delete (GDPR/DPDP requests)
* Events: filterable widget telemetry with CSV export
* Admins: super / manager / viewer roles

## Try-on engine
`backend/lib/TryOnProvider.php` ships with:
* `mock` — a GD composite so the full pipeline works end-to-end during development (not a real try-on).
* `http` — posts `person` + `garment` images (multipart) to your model server or a VTO API and accepts
  an image response, or JSON with `image_base64` / `image_url`. Point it at a self-hosted diffusion
  try-on model (IDM-VTON, OOTDiffusion, CatVTON…) or a commercial try-on API.

## Security notes
* Public API is keyed per site **and** checks the browser `Origin` against the site’s domain(s).
* Rate limits per IP per site; daily try-on cap per site.
* Product images are fetched server-side with SSRF protection (private/reserved IPs blocked, DNS pinned, size-capped).
  `VTO_DEV_ALLOW_PRIVATE=1` disables that for local testing only — never set it in production.
* Browser-reported selectors are sanitised and start as *pending*.
* Admin: bcrypt passwords, CSRF tokens, session fixation protection, role checks, login throttling.
* Shopper photos are private (admin-only URL) and auto-deleted after 24 h.

## Important: getting onto marketplaces like Nykaa or Ajio
The widget can only run on pages that load the script, so each store has to add the embed code
(or approve it through their tag manager) — that is the “integration”. The Scrapy scan and the
preview bookmarklet let you prepare and demo the integration on their live site before they do.
Crawl only stores that have agreed to integrate; `ROBOTSTXT_OBEY` is on by default.

## Local demo
```bash
VTO_BASE_URL=http://localhost:8080 VTO_DEV_ALLOW_PRIVATE=1 PHP_CLI_SERVER_WORKERS=4 php -S localhost:8080
```
Insert a site with domain `localhost`, put its key into `demo/*.html` (replace `__KEY__`) and open
`http://localhost:8080/demo/index.html`. The demo pages use obfuscated class names and late
rendering on purpose, to exercise the fallback loop.
