---
name: vto-injection
description: Implementation plan and reference for the third-party Virtual Try-On (VTO) platform — injecting Try-On buttons into any e-commerce site (Vilvah, Nykaa, Ajio, custom, SPAs) with a 3-plan looped fallback (Scrapy → Block → Inspect), PHP backend, MySQL and an admin panel.
---

# VTO Injection — Detailed Implementation Plan

## 1. What we are building

A **platform-independent** virtual try-on service. It is not a Shopify/Woo plugin. Any store adds
**one script tag**; the widget then finds the right elements on the page by itself and injects:

| # | Injection point | Page | Placement |
|---|---|---|---|
| 1 | **Try-On button** | Product page | Directly after Add-to-Cart / Add-to-Bag |
| 2 | **Icon on main product image** | Product page | Absolute overlay, top-right of image |
| 3 | **Icon on every product card** | Collection / search / home / "similar products" | Absolute overlay, bottom-right of card image |

Element discovery uses **three plans in a looped fallback**:

| Plan | Name | Where it runs | Technique |
|---|---|---|---|
| A | `scrapy` | Server (Python Scrapy) → stored in MySQL | Crawl the store, detect selectors, the widget reads them from the API |
| B | `block` | Browser | Automatic block segmentation (repeated card blocks, media block, CTA block) |
| C | `inspect` | Browser | Automatic inspection of ids / attributes / JSON-LD / microdata / ARIA / button text |

Selectors found by B or C are sent back to the server, so the next visitor gets them through **Plan A** (self-learning).

### Stack
- **Backend:** PHP 8.1+ (PDO, no framework), REST-style endpoints
- **Database:** MySQL 8 / MariaDB 10.6+
- **Scanner:** Python 3.10+, Scrapy (+ optional scrapy-playwright for JS sites)
- **Widget:** Vanilla ES5-compatible JavaScript, Shadow-DOM modal, zero dependencies
- **Admin panel:** PHP server-rendered pages, session auth, CSRF, roles

---

## 2. Architecture

```
            Merchant store (any platform)
   ┌───────────────────────────────────────────┐
   │ <script src=".../widget/vto.js"            │
   │         data-vto-key=KEY data-api=...>     │
   │                                            │
   │  vto.js ── GET  /api/config.php ───────────┼──┐  settings + Plan-A selectors
   │         ── POST /api/report.php ───────────┼──┤  plan used, hits/misses, learned selectors, clicks
   │         ── POST /api/tryon.php ────────────┼──┤  photo + product image → result
   └───────────────────────────────────────────┘  │
                                                    ▼
   ┌──────────────── PHP backend ───────────────────────────┐
   │ api/*  lib/Database  lib/helpers  lib/TryOnProvider     │──► Try-on engine (mock | http model server)
   │ media.php (results)   cli/create_admin  cli/cleanup     │
   └───────────────┬─────────────────────────────────────────┘
                   │                       ▲
                   ▼                       │ writes selectors / scan status
              MySQL (vto_platform) ◄───────┴──── Python worker.py → scrapy crawl vto_scan
                   ▲                                  (queue: scans.status = 'queued')
                   │
   ┌───────────────┴─────── Admin panel (PHP) ──────────────┐
   │ Dashboard · Sites · Selectors · Scans · Try-ons · Events · Admins │
   └─────────────────────────────────────────────────────────┘
```

### Folder layout
```
vto/
├── widget/vto.js
├── backend/
│   ├── config.php
│   ├── media.php
│   ├── api/{config,report,tryon}.php
│   ├── lib/{bootstrap,Database,helpers,TryOnProvider}.php
│   ├── cli/{create_admin,cleanup}.php
│   └── storage/uploads/{user,garment,result}/
├── admin/{_init,login,logout,index,sites,site,scans,tryons,events,admins}.php + assets/admin.css
├── scraper/
│   ├── scrapy.cfg  requirements.txt  .env.example  worker.py
│   └── vto_scanner/{settings,db,analyzer}.py  spiders/vto_scan.py
├── database/schema.sql
└── demo/{index,product}.html
```

---

## 3. Database design (MySQL)

| Table | Purpose | Key columns |
|---|---|---|
| `admins` | Admin users | email, password_hash (bcrypt), role `super/manager/viewer` |
| `sites` | One row per merchant | domain, allowed_origins, **api_key** (40 hex), status, **plan_order** (`scrapy,block,inspect`), enable_product_button / image_icon / card_icon, button text & colours, product/collection URL regex, daily_tryon_limit |
| `selectors` | All discovered selectors | site_id, page_type `product/collection`, target, selector, **source** `scrapy/block/inspect/manual`, confidence, hits, misses, **status** `active/pending/disabled`, sample_url — unique (site, page_type, target, selector) |
| `scans` | Scrapy job queue | site_id, start_url, status `queued/running/done/failed`, pages_crawled, selectors_found, log |
| `tryon_sessions` | Every try-on | product_url/title/image, user_image, result_image, provider, status, duration_ms, trigger_from, plan_used, ip_hash |
| `events` | Widget telemetry | type `inject_ok/inject_fail/plan_fallback/click/tryon_ok/tryon_fail`, plan, page_type, url, meta JSON |
| `rate_limits` | Per-IP/site/minute buckets | bucket, hits, window_start |

### Selector targets
| page_type | target | Meaning |
|---|---|---|
| product | `add_to_cart` | Try-On button is inserted after it |
| product | `product_image` | Main image → overlay icon |
| product | `product_title` | Fallback anchor if no ATC found |
| collection | `card` | Repeated product card (group selector) |
| collection | `card_image` | Image inside card — **relative to card** |
| collection | `card_link` | Link inside card — **relative to card** |

### Selector lifecycle
```
Plan B/C learns ─► pending (hits=1) ─► 3 confirmations ─► active
Scrapy finds    ─► active (or promotes pending → active)
Manual (admin)  ─► active, confidence 0.99, always first, never auto-disabled
Active but failing: misses ≥ 25 AND misses > 3 × hits ─► disabled (auto)
```

---

## 4. Public API contract

All public endpoints take `?key=SITE_API_KEY` and validate the browser **Origin/Referer** against
`sites.domain` + `allowed_origins` (subdomains allowed). CORS echoes the allowed origin.

### `GET /backend/api/config.php`
```json
{
  "ok": true,
  "site": {"id": 1, "name": "Vilvah", "category": "beauty"},
  "plans": ["scrapy", "block", "inspect"],
  "ui": {"productButton": true, "imageIcon": true, "cardIcon": true,
         "text": "Virtual Try-On", "color": "#111111", "textColor": "#ffffff"},
  "patterns": {"product": "/products/", "collection": null},
  "selectors": {
    "product":    {"add_to_cart": [{"id": 12, "sel": "button.pdp-add", "src": "manual", "c": 0.99}],
                   "product_image": [...]},
    "collection": {"card": [...], "card_image": [...], "card_link": [...]}
  }
}
```
Ordering: manual first → confidence → hits. Cached 60 s. Rate limit 120/min.

### `POST /backend/api/report.php`
```json
{
  "event": "inject | learn | click",
  "pageType": "product | collection",
  "plan": "scrapy | block | inspect | none",
  "url": "https://...",
  "injected": 3,
  "tried": ["scrapy", "block"],
  "hits": [12], "misses": [9],
  "learned": [{"target": "add_to_cart", "selector": "button.x9-btn", "confidence": 0.8}],
  "trigger": "product_button"
}
```
Server actions: hits/misses counters → auto-disable; upsert learned (only for block/inspect, max 10,
sanitised); log `inject_ok` / `plan_fallback` / `inject_fail`; flip site `pending → active` on first success.

### `POST /backend/api/tryon.php` (multipart)
Fields: `photo` (jpg/png/webp ≤ 8 MB), `product_image` (absolute URL), `product_url`, `product_title`,
`trigger`, `plan`, `visitor_id` → `{ "ok": true, "id": 41, "result_url": ".../media.php?f=result/<token>.jpg" }`

Flow: rate limit (6/min) → daily cap → MIME check via finfo → store photo under random 128-bit name →
**SSRF-safe fetch** of product image (block private/reserved IPs, pin DNS with `CURLOPT_RESOLVE`, no redirects,
10 MB cap, image MIME only) → `TryOnProvider::generate()` → save result → update session.

### Try-on providers (`lib/TryOnProvider.php`)
```php
interface TryOnProvider {
    public function generate(string $personPath, string $garmentPath, array $ctx): string; // image bytes
    public function name(): string;
}
// mock → GD composite (dev only)
// http → multipart POST person+garment to your model server (IDM-VTON / OOTDiffusion / CatVTON / vendor API),
//         accepts image/* response or JSON {image_base64 | image_url}
```

---

## 5. The widget (`widget/vto.js`)

### 5.1 Boot
1. Read `data-vto-key`, `data-api`, `data-debug` (or `?vto_debug=1`) from `document.currentScript`.
2. Guard double-load with `window.__VTO_LOADED__`.
3. `GET config.php` → inject scoped styles (`.vto-btn`, `.vto-icon`) with CSS vars for brand colours.
4. `start()` → `startObserver()` → `hookSpaNavigation()`; expose `window.VTO.rescan()`.

### 5.2 Page type detection (in order)
1. Admin URL regex (`product_url_pattern`, `collection_url_pattern`)
2. Exactly one JSON-LD `Product` with `offers`
3. `og:type=product` or `product:price:amount` meta
4. Exactly one `[itemtype*="schema.org/Product"]`
5. URL like `/p/…`, `/dp/…`, `/product(s)/…`, `/buy/…` + an `<h1>`
6. 1–3 visible “Add to cart / bag / Buy now” CTAs outside header/footer + `<h1>`
7. Otherwise `collection`

Zones: `product` zone only on product pages; `cards` zone on **every** page (recommendation carousels too).

### 5.3 Plan A — `scrapy`
```js
for target in [add_to_cart, product_image, (product_title)]:
    for s in config.selectors.product[target]:      // ordered list
        els = querySelectorAll(s.sel).filter(visible)
        if els.length: hits.push(s.id); use els[0]; break
        else misses.push(s.id)
cards zone: first matching `card` selector → for each card use card_image / card_link (relative)
            or largest image / first a[href] inside the card
```
Every `querySelectorAll` is wrapped in try/catch — a bad selector can never break the store.

### 5.4 Plan B — `block` (automatic block segmentation)
**Cards**
1. Collect all `a[href]` that contain a visible image with area > 6 000 px², outside header/nav/footer.
2. From each anchor climb ≤ 6 ancestors until the element's parent holds **≥ 3 siblings with the same signature** (`tag + first 2 stable classes`) → that element is a card.
3. Group cards by `parentSig > cardSig`; score = count + 2 × (cards with a price pattern `₹ / Rs / INR / $ / € / £`).
4. Best group → expand to all same-signature siblings (lazy cards) → build a **group selector**:
   `tag[data-product-id]` › `tag.commonClass1.commonClass2` › `.commonClass` › `parent > tag.class` —
   accepted only if it covers ≥ 90 % of the group and matches ≤ 1.6 × group + 2 elements.
5. Learn `card`, `card_image` (relative), `card_link` (relative).

**Product page**
1. **Media block:** largest visible `<img>` ≥ 180×180, top < 1 600 px, aspect < 2.2, not in chrome.
2. **Info block:** climb from the visible `<h1>` until a block contains a price and buttons.
3. **CTA scoring** for every visible `button / [role=button] / input[submit] / a` (label 2–40 chars, area ≥ 1 200, label not wishlist/share/size chart/login/…):
   | Signal | Score |
   |---|---|
   | area / 8000 (cap 3) | 0–3 |
   | inside info block | +3 |
   | label matches cart regex | +4 |
   | filled background colour | +1 |
   | near a price element | 0–2 |
   | right of / below main image | +1 |
   Winner needs score ≥ 4, else Plan B yields nothing for the button.
4. Learn `add_to_cart` (confidence = score/12, max 0.9) and `product_image` (0.6).

### 5.5 Plan C — `inspect` (automatic inspection)
**Add to cart** — first visible hit from a prioritised list:
`form[action*="/cart/add"] [type=submit]`, `button[name=add]`, `[name=add-to-cart]`, `#add-to-cart`, `#AddToCart`,
`#product-addtocart-button` (Magento), `.single_add_to_cart_button` (Woo), `[data-testid*=add-to-cart i]`,
`[id|class*=add-to-cart|addtocart|add-to-bag|addtobag i]`, `[class*=btn-cart|pdp-add i]`, `[aria-label*="add to cart|bag" i]`
→ fallback: largest visible button whose text matches `add to cart|bag|basket|buy now`.

**Product image**
1. Collect image URLs from JSON-LD `Product.image` + `og:image`, reduce to file-name keys.
2. Find the largest visible `<img>` whose `src/srcset/data-src` contains a key.
3. Fallback list: `[itemprop=image]`, `.product__media img` (Shopify), `.woocommerce-product-gallery__image img`, `.fotorama__stage img` (Magento), `[class*=pdp-image|product-image|main-image i] img` …
4. Fallback: `<img alt>` containing the `<h1>` text.

**Cards** — prioritised list: `[itemtype*="schema.org/Product"]`, `[data-product-id]`, `[data-sku]`,
`.product-card`, `.product-item`, `.product-tile`, `li.product`, `.grid-product`, `.card-wrapper`, `.product-base`,
`[class*=product-card|productcard|product-tile|product-item i]`, `[data-testid*=product-card i]` → keep outermost
matches with an image and a link; accept when ≥ 2.

### 5.6 Stable selector generation (used to learn from B and C)
- Reject unstable classes: CSS-in-JS hashes (`css-`, `sc-`, `jsx-`, `emotion-`, `chakra-`, `mui`), CSS-module suffixes (`__abc12`), 3+ digit runs, state classes (`active`, `selected`, `is-*`, `lazy`, `swiper-slide-active`, `slick-*`…).
- Reject unstable ids (4+ digits, uuids, React `:r1:`, `ember…`).
- Priority: unique stable `#id` → unique `[data-testid|data-test|data-qa|itemprop|name|aria-label]` → ancestor path `tag.class > tag.class` (≤ 6 levels) that is **unique and not a bare tag** → `:nth-of-type` disambiguation.

### 5.7 The looped fallback engine
```js
function runZone(zone) {
  attempt = 0
  loop:
    if (routeChanged) abort
    for plan of config.plans:                 // admin-defined order
        r = PLANS[plan](zone)
        n = zone === 'product' ? injectProduct(r) : injectCards(r)
        if (n > 0) {
            report({event:'inject', plan, injected:n, tried, hits, misses, learned: plan==='scrapy' ? [] : r.learned})
            if (zone === 'product') completeProduct(r)   // fill missing button/image from other plans + report 'learn'
            return
        }
    if (attempt < 7) setTimeout(loop, [400,900,1600,2500,4000,6500,10000][attempt++])
    else if (zone === 'product') report({plan:'none', injected:0})   // → inject_fail in admin
}
```

**Keep-alive**
- `MutationObserver` on `body` (debounced 450 ms, ignores our own nodes):
  - cards zone → re-run the winning plan, inject only into unmarked cards (infinite scroll / lazy grids)
  - product zone → if our button and icon are gone (React re-render) → reset and run the full loop again
- SPA navigation: wrap `history.pushState/replaceState` + `popstate` → `generation++`, reset zones, restart.

### 5.8 Injection rules
- Mark processed nodes with `data-vto` to avoid duplicates.
- **Button:** `insertAdjacentElement('afterend')` on ATC; if ATC sits in a horizontal flex row with siblings, insert after the row.
- **Icons:** host = image parent (or `<picture>` parent); set `position:relative` only if it is `static`.
- Icon click: `preventDefault + stopPropagation` in capture phase and stop `mousedown/touchstart/pointerdown` so the card link does not navigate.
- Product image URL: largest `srcset` candidate → `currentSrc` → `data-src/data-original/data-zoom-image` → `src`; fallback JSON-LD image → `og:image`.

### 5.9 Try-on modal
- Rendered inside a **Shadow DOM** host at `z-index: 2147483646` → immune to store CSS.
- Steps: product thumbnail + title → upload/take photo (≤ 8 MB) → "Generate my look" → spinner → result + "Open full size".
- Esc / backdrop / × close; body scroll locked while open; privacy note (deleted within 24 h).
- Sends `visitor_id` (UUID in localStorage, try/catch) for analytics.

---

## 6. Plan A scanner (Python / Scrapy)

### 6.1 Queue
1. Admin clicks **Run scan** (or "scan now" on site creation) → `INSERT scans (status='queued')`.
2. `worker.py` claims jobs with `SELECT … FOR UPDATE SKIP LOCKED`, runs `scrapy crawl vto_scan -a scan_id=N` in a subprocess (30 min timeout), marks crashes as `failed`, recovers jobs stuck in `running` > 40 min.
3. Run as a service (systemd/supervisor) or cron `* * * * * python3 worker.py --once`.

### 6.2 Spider `vto_scan`
- Same-domain crawl from `start_url`, max `VTO_MAX_PAGES` (default 60), priority to product-looking URLs, then collection URLs; skips cart/checkout/login/media.
- Polite: robots.txt obeyed by default, AutoThrottle, 0.75 s delay, 2 concurrent per domain.
- `VTO_USE_PLAYWRIGHT=1` renders pages in Chromium (required for React/Next/Angular stores such as Nykaa, Ajio).
- Each page → `analyzer.analyze(html, url)` → page type + targets (+ card grids on product pages).
- **Voting:** count how many pages agree on each selector per target. On close keep top 2 per target, drop
  selectors seen on only one page in multi-page crawls, confidence = `analyzerConf × 0.6 + pageShare × 0.4` (≤ 0.95).
- Upsert into `selectors` with `source='scrapy'`, `status='active'`; write log + counts into `scans`.
- Dry run: `scrapy crawl vto_scan -a url=https://store/collections/all -a dry=1`.

The analyzer mirrors Plans B and C (JSON-LD, ATC lists/tokens/text, repeated-sibling card detection, group
selector, stable selector rules) so browser and crawler produce the same selectors.

---

## 7. Admin panel

| Page | Features |
|---|---|
| **Login** | bcrypt, session regenerate, CSRF, throttle after 8 attempts, auto-rehash |
| **Dashboard** | KPIs (active sites, try-ons today / 30 d, clicks, success %), 14-day bar chart, injections per plan, entry points, sites where all 3 plans failed; site filter |
| **Sites** | List with status, plan order, active selectors, try-ons, last widget ping; create store (+ queue scan) |
| **Site detail** | Embed code · **preview bookmarklet** (runs the widget on the live store in debug mode before the merchant installs) · regenerate key · settings (status, category, extra origins, scan URL, **plan order dropdowns**, which injections, button text/colours, URL regexes, daily limit) · run scan + last 5 scans · plan performance · **selector manager** (activate / disable / delete / add manual) · recent events · delete site (super) |
| **Scans** | Queue list, per-scan live log (auto refresh while running) |
| **Try-ons** | Grid: shopper photo / product / result, status, plan, trigger, duration, error; delete (for data-deletion requests) |
| **Events** | Filter by site/type, pagination, CSV export |
| **Admins** | Create/update/remove; roles `super` (all), `manager` (edit), `viewer` (read only) |

---

## 8. Security & privacy checklist
- [x] Per-site API key + Origin/Referer allow-list (domain, subdomains, extra origins)
- [x] Rate limits per IP hash per site; daily try-on cap per site
- [x] SSRF-safe product image fetch (private IPs blocked, DNS pinned, no redirects, size + MIME caps)
- [x] Upload MIME validation via finfo; random 128-bit file names; storage dir non-executable & web-denied
- [x] Shopper photos admin-only; results public by unguessable token; cron deletes photos after 24 h
- [x] Browser-learned selectors sanitised (`< { } ;`, `javascript:`, `url(`, `expression(` blocked) and start as pending
- [x] Prepared statements everywhere; output escaping in admin; CSRF on all admin POSTs; `X-Frame-Options: DENY`
- [x] IPs stored only as salted SHA-256
- [ ] Production: HTTPS only, env-based secrets, `VTO_DEV_ALLOW_PRIVATE` never set, rotate `VTO_IP_SALT`
- [ ] Add a privacy notice/consent text per merchant (DPDP Act 2023 / GDPR) before upload

---

## 9. Implementation phases

| Phase | Scope | Est. |
|---|---|---|
| **0 · Setup** | Server, domain + SSL, MySQL, PHP-FPM, repo, env config | 1 day |
| **1 · Data + API** | `schema.sql`, Database/helpers, `config.php`, `report.php`, CORS/origin checks, rate limits | 2–3 days |
| **2 · Widget core** | Boot, page detection, Plan A, injection (button + 2 icons), modal UI, `tryon.php` with mock provider | 3–4 days |
| **3 · Plans B & C** | Block segmentation, inspection lists, stable-selector generator, learning reports | 4–5 days |
| **4 · Loop + resilience** | Retry back-off, completeProduct, MutationObserver, SPA routing, auto-disable | 2 days |
| **5 · Scrapy scanner** | Analyzer, spider + voting, queue worker, Playwright mode | 3–4 days |
| **6 · Admin panel** | Auth, dashboard, sites, selector manager, scans, try-ons, events, admins | 4–5 days |
| **7 · Real try-on engine** | Deploy model server (GPU) or vendor API, `HttpTryOnProvider`, timeouts, queue if > 30 s | 3–7 days |
| **8 · QA** | Test matrix below, cross-browser, mobile, performance budget | 3–4 days |
| **9 · Pilot** | 1–2 friendly stores, bookmarklet demo → embed → monitor dashboard | 1 week |

### Test matrix
| Store type | Example | What to verify |
|---|---|---|
| Shopify | Vilvah | Plan C hits `form[action*=/cart/add]`; cards via `.card-wrapper`/`.grid-product` |
| React SPA (PLP infinite scroll) | Nykaa-style | Plan B cards, observer adds icons on scroll, route change restart |
| React SPA (PDP late render) | Ajio-style | Retry rounds until render, Plan B CTA scoring ("ADD TO BAG") |
| WooCommerce | — | `.single_add_to_cart_button`, `li.product` |
| Magento | — | `#product-addtocart-button`, `.fotorama__stage img` |
| Obfuscated classes | demo pages | Hash classes ignored, learned selectors stable |
| Redesign | change classes | Misses → auto-disable → B/C relearn |
| Mobile 375 px | all | Button full width, icons tappable, modal single column |

Acceptance: injection on ≥ 90 % of product page views within 3 s of content render; zero console errors
originating from the store because of the widget; widget ≤ 40 KB minified; try-on success ≥ 95 % (excluding bad photos).

---

## 10. Deployment

```bash
# DB
mysql -u root -p < database/schema.sql
mysql -u root -p -e "CREATE USER 'vto_user'@'localhost' IDENTIFIED BY 'STRONG';
                     GRANT ALL ON vto_platform.* TO 'vto_user'@'localhost';"
# First admin
php backend/cli/create_admin.php "Name" you@company.com 'StrongPassword123'
# Scanner
cd scraper && pip install -r requirements.txt && cp .env.example .env && python3 worker.py
# Optional JS rendering
pip install scrapy-playwright && playwright install chromium   # .env: VTO_USE_PLAYWRIGHT=1
# Cron
0 * * * * php /var/www/vto/backend/cli/cleanup.php
```

Environment: `VTO_BASE_URL`, `VTO_DB_*`, `VTO_IP_SALT`, `VTO_PROVIDER=mock|http`, `VTO_PROVIDER_URL`, `VTO_PROVIDER_KEY`.

Nginx:
```nginx
location ~ ^/backend/(lib|cli|storage)/ { deny all; }
location = /backend/config.php           { deny all; }
location /widget/ { add_header Access-Control-Allow-Origin *; add_header Cache-Control "public, max-age=300"; }
```

Merchant embed:
```html
<script async src="https://vto.yourdomain.com/widget/vto.js"
        data-vto-key="SITE_API_KEY"
        data-api="https://vto.yourdomain.com/backend/api"></script>
```
Installable via theme `<head>`, Google Tag Manager (Custom HTML tag) or the platform's custom-script area.

---

## 11. Merchant onboarding runbook
1. Admin → **Sites → Add a store** (name, domain, scan URL) → scan queued automatically.
2. Check the scan log; if the store is a SPA and the scan found nothing on product pages, enable Playwright and re-scan.
3. Open the live store with the **⭑ VTO preview** bookmarklet → confirm button + icons (console shows which plan won).
4. If anything is wrong, add a **manual selector** (top priority) or change the plan order.
5. Send the embed code; after install the site status flips to `active` on the first successful injection.
6. Monitor **Plan performance**, **Events** (`inject_fail`, `plan_fallback`) and **Try-ons**.

> Note: the widget only runs on pages that load the script, so marketplaces like Nykaa or Ajio must
> add the embed code (or approve it in their tag manager). Crawl only stores that have agreed to integrate.

---

## 12. Verified so far (local end-to-end test)
- Collection page with hashed classes: Plan A empty → **Plan B** injected 4 card icons, observer added 4 more on infinite scroll.
- React-style product page rendering after 1.2 s: loop retried, **Plan B** found "ADD TO BAG" and the main image.
- `plan_order = inspect,…`: **Plan C** injected via JSON-LD image match + button text.
- Learned selectors went pending → active after 3 views; 4th visit **Plan A** won directly; missing image filled by `completeProduct`.
- Scrapy scan via worker queue found `div.tile-wrap` / `img` / `a[href]` and activated them.
- Full try-on: upload → `tryon.php` → mock result shown in modal and admin grid; all admin pages and actions return 200 with no PHP warnings.

## 13. Next improvements
- Async job queue for slow GPU models (return job id, widget polls)
- Category-specific engines (eyewear/jewellery AR via face landmarks, makeup for beauty)
- Per-site A/B of button text/placement; conversion tracking via add-to-cart click after try-on
- Merchant self-serve portal (own login, analytics, billing by try-on volume)
- Widget minification + CDN, Subresource-free versioned URLs
