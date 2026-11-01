# BRIX Try-On – Application Functional & Module Test Report

Date: 2026-10-22. Graded with the verdict scale and priority order in `skills/principles.md` (correctness and security first, then repo conventions, then general principles). `skills/question-bank.md` was used to choose the review categories (placement, data flow, validation, sync/async, errors, security, testing, scaling, observability). Those two files are architecture-review guides, not test scripts, so they shaped *what was judged and how*, not what was executed.

**Verdicts:** ✅ fits · ⚠️ works but risky · ❌ breaks the design (correctness/security) · ⛔ not tested.

> **Scope.** Everything executed ran against the **local Docker replica** (`localhost:8080`: PHP 8.3 + MariaDB, synthetic merchants/data, mocked AI, no production, no real AI spend). Findings marked *replica* may be caused by the replica's schema and must be confirmed on staging. The probe script refuses non-localhost targets. Companion report: `reports/brix-tryon-stress-test-report.md` (performance).

## 1. How testing was done
| Method | Evidence |
|---|---|
| Route-level functional + auth probe, 46 routes from `fitfyce-php/router.php`: no key / wrong key / synthetic valid key, status, JSON validity, latency | `tests/functional/module_probe.py` → `reports/results/functional-probe.json` |
| Try-on pipeline journey, uploads, admin reads, idempotency, quota under load | k6 runs in `reports/results/*` (see performance report) |
| Source review of auth resolution, quota and finalisation code | `StudioV2Controller.php:593`, `GarmentStudioController.php:1167`, `LeadController.php:64-125`, `PlanLimitCheck.php`, `MerchantRepo.php` (diff) |
| Not executed | Browser/storefront UI, Remix admin UI, Shopify sync/webhooks, real AI generation, billing, anything on live/staging |

## 2. Results by module
| # | Module | Functional result (measured) | Verdict |
|---|---|---|---|
| 1 | **Storefront widget API** (`/api/widget-settings`, `/api/widget-event`, `/api/session/create`) | settings 200 JSON (796 ms on first cold call, then ~10–60 ms); event 200; empty/invalid input → 400, not 500 | ✅ |
| 2 | **Try-on pipeline** (submit → poll → result, mocked GPU) | End-to-end success in every normal run (smoke e2e 18.1 s, 100 % success). After the fixes: each job counted once (3 jobs → +3), limit enforced (5 accepted, 15 × 429 at 95/100). | ⚠️ fixes are uncommitted, not re-validated under load; capacity collapses on 1 GPU worker (38.5 % success) |
| 3 | **Upload** (`/upload-temp`) | valid photo accepted; 7 MB and non-image rejected, 0 unexpected results across hundreds of calls | ✅ |
| 4 | **Consent modal, lead capture & unlock, add-to-cart, share, buy-now** | Run in headless Chrome with the real widget code (see §2b): consent, upload validation, generation, result, lead form rules, unlock, add-to-cart and buy-now payloads, WhatsApp link all work. **Save-image falls back to opening the image in a tab** (no CORS header on `/results/*` in the replica). | ⚠️ |
| 5 | **Widget Settings** (`GET/PATCH /widget/settings`, `/settings`) | no key → 401, wrong key → 401, valid key → 200 JSON; PATCH/POST without key → 401. Authenticated writes not run (would change settings, even synthetic). | ✅ (read) / ⛔ (write) |
| 6 | **Product Catalog** (`/products`, `/variants/mapping`, `/shop/products`, `/shopify/sync`) | `/products` 200 with key, 401 without. **`GET /shop/products` returns HTTP 500 with a valid key:** `Unknown column 'p.shopify_domain'` in `db/ProductSummaryRepo.php:40`. Shopify sync needs Shopify, not run. | ❌ on replica (may be schema drift – confirm on staging) |
| 7 | **Analytics** (`/analytics`, `/conversion`) | `/analytics` 200 in 227 ms; `/conversion` without key 401 | ✅ (read) |
| 8 | **Plans & usage** (`/plans`, `/plan/limit`, `/plan/update`) | reads 200 (11–15 ms); `plan/update` without key 401. Billing change not run. | ✅ (read) |
| 9 | **Authentication / authorization** (admin routes) | `X-Api-Key` enforced on the key-protected admin routes tested: no key and bad key both returned 401 (the exceptions are the shop-only routes in modules 10–12). | ✅ for those routes |
| 10 | **Leads list** (`GET /leads`) | **Accepts a shop domain alone (no key/secret) and returns the merchant's leads** (`LeadController.php:107-120`: shop param wins over key). Data was empty in the synthetic DB, but the access path is open. `GET /lead/list` is master-key only → 401, correct. | ❌ confirmed (customer PII on a real shop) |
| 11 | **AI Studio v1 / Garment Studio** (`/studio/*`) | `models`, `setup-check`, `sessions` return 200 with **no key**; `models`/`setup-check` even with no shop parameter. `setup-check` also exposes the server path `/var/www/html/models`. Auth is `resolveMerchant()` = `?shop=` only (`GarmentStudioController.php:1167`). Generate/pose-variant not run (cost). | ❌ confirmed |
| 12 | **AI Studio v2 / Asset Library / saved models** (`/studio-v2/*`) | `models`, `generations`, `assets` return 200 with the shop domain alone; same `resolveMerchant()` (`StudioV2Controller.php:593`). Without a shop → 401. Upload/generate/delete not run. | ❌ confirmed (read); write/spend paths ⛔ |
| 13 | **Infographic / Flat-lay / Ghost-mannequin / Accessories / Marketing** | Infographic routes return 503 on the replica (provider not configured) before any auth result is visible, so authorization there is **unverified**. Accessory worker rejects unsigned calls with 403 (HMAC, as designed). Generation quality and output never exercised. | ⛔ (accessory worker ✅) |
| 14 | **RAG index** (`/rag/status`, `/rag/reindex`) | status 200 with key, 401 without; reindex without key 401 | ✅ |
| 15 | **Size Chart / Complete Look** | admin 401 without key, 200 with; public endpoints 200 | ✅ (read) |
| 16 | **Merchant / onboarding** | `by-domain` and `onboarding` enforce key; `deactivate` without key 401 | ✅ |
| 17 | **Default models library** (`/studio/default-models`) | key required (401), 200 with key | ✅ |

## 2b. Storefront widget in a real browser (added 2026-10-22)
**How:** the *real* `tryon-widget.js`, `tryon-modal.css` and modal markup from `fitfyce-shopify/extensions/tryon-widget/` were loaded on a synthetic product page (`tests/functional/storefront/server.mjs`, port 5190) and driven in headless Chrome over the DevTools protocol (`cdp.mjs`, `flow.mjs`; no installs). A same-origin `/apps/tryfit/*` proxy forwards to the local replica, like Shopify's app proxy does. Chrome was started with every non-localhost host unresolvable, so nothing could reach the live site; the page contacted only `localhost` (Google Fonts was blocked). Shopify's storefront cart (`/cart/add.js`, `/cart.js`) is **MOCKED** by the harness and records what the widget posts. AI generation is the mock GPU. Screenshots and `flow.json`: `reports/results/storefront-flow/` (add-to-cart pass) and `reports/results/storefront-flow-buynow/` (buy-now pass).

| Step | Result | Evidence |
|---|---|---|
| Widget boots, settings fetched, button rendered | PASS | `GET /api/widget-settings` 200; `widget-event` and `session/create` 200 |
| Consent modal → upload step | PASS | |
| Non-image upload rejected | PASS | "Please upload an image file (JPEG, PNG, or WebP)"; processing never starts |
| Valid photo → processing → result | PASS | 15.7–17.2 s from upload (mock GPU 14 s); result image 768×1152 loads |
| Lead gate: invalid email rejected | PASS | form stays |
| Lead gate: submit without consent blocked | PASS | "Please agree to the Privacy Policy and Terms of Service to continue." |
| Lead capture with consent unlocks | PASS | `POST /api/lead/capture` 200; purchase panel shown (variants, qty, price) |
| Add to cart | PASS (mocked cart) | posts `{"id":1001,"quantity":1,"properties":{}}` as JSON to `/cart/add.js` |
| Buy now | PASS (mocked cart) | fresh cart post with the same payload; `/checkout` navigation not followed (stub host) |
| Share on WhatsApp | PASS | `https://wa.me/?text=` with product title, product URL and result URL |
| Save image (real download) | **FAIL** | download never fires; widget falls back to opening the image. The result image is served without `Access-Control-Allow-Origin`, so the widget's `fetch()`→blob download is blocked cross-origin. Replica observation; check the live host's headers. |
| Console errors | none | |

Not covered here: camera capture (needs a media device), mobile viewport, collection-page icon, before/after and promo blocks, size-chart and complete-look widgets, the 190 s timeout and error UI for a failed generation, and real Shopify cart/checkout.

Environment note: `/studio/setup-check` reports `ok:false` on the replica (models directory absent). That is a replica gap, not evidence about production.

## 3. Findings, ranked
**High**
1. **AI Studio and Leads trust the shop domain as the credential** (modules 10–12). Shop domains are public. In the replica, anyone who knows a shop's domain can read its studio assets/sessions/leads, and the generate endpoints use the same check, so AI spend can plausibly be triggered by third parties (generation itself was **not** run to prove it). Principle breached: *Never trust the client; authorization is enforced server-side in the repo's central mechanism* (`skills/principles.md`, Security) → ❌. Caveat: if the live app proxy always signs requests, the exposure may be reduced; the plan notes the proxy points at PHP directly, which would bypass that. **Confirm in the Partner Dashboard.**
2. **Usage/billing integrity defects** found by load tests: double-counting and plan-limit overshoot (95 → 115). Fixed in uncommitted working-tree changes and retested on small runs only.

**Medium**
3. **`GET /shop/products` 500** – missing column in the replica schema; verify on staging, add a migration if the column is genuinely absent.
4. **Information disclosure** in `/studio/setup-check` (filesystem path, unauthenticated).
5. **Capacity:** GPU-bound runs fail shoppers (38.5 % success), and upload/admin traffic saturates the 20 Apache workers (see performance report).

**Found with the browser flow (replica observations; confirm on staging)**
- **Cross-origin POSTs fail:** `OPTIONS /api/tryon` returns **404** because the router only registers `POST`/`GET` (`CorsMiddleware` advertises OPTIONS but is only reached for matched routes). On the storefront the app proxy keeps requests same-origin, so shoppers are unaffected, but the widget's hard-coded fallback to `https://tryonapp.digifyce.com` (`tryon-widget.js:712`) is cross-origin and would break for every POST (try-on, lead, events) if the proxy ever fails. GETs (settings) would still work. *Principle: external calls fail; every fallback needs to actually work* → ⚠️.
- **Save image does not download** without a CORS header on `/results/*` (see §2b).
- **Test-safety note:** that same fallback means a test page whose proxy fails will silently send traffic to the live host. The harness blocks all non-localhost hosts to prevent this.
- A server-side fetch of a user-supplied image URL exists (the API answered "Failed to load clothing_image" for an unreachable URL), so it is worth a review for server-side request forgery (private IPs, redirects); I did not test it.

**Low / maintainability (principles review)**
6. The shop-resolution logic is copied in three places (`GarmentStudioController`, `StudioV2Controller`, `LeadController`). *Abstract on the third copy* – and this is the right moment, because fixing finding 1 once in a shared mechanism beats patching three copies. The `findByDomainLike` fuzzy fallback in those copies was not reviewed; a fuzzy match on an identity check deserves a look.
7. `router.php` loads ~60 files on every request, so the hot widget path pays for the whole admin/AI surface (*single responsibility*, *watch the access pattern*). Measured effect not isolated.
8. Observability is only `logs/app.log`; the replica's Apache log showed the 500 and its stack trace, but nothing alerts on it.

## 4. Not tested (and why)
**Blocked – Remix admin screens (Product Catalog, Widget Settings, Analytics, Asset Library, Plans, AI Studio UI):** they need an embedded Shopify session. The Shopify CLI is **not installed** here (not on PATH, not in `node_modules`; an earlier note of mine saying otherwise was wrong) and `shopify app dev` needs an interactive login and would rewrite the app's URLs in the Partner Dashboard (`automatically_update_urls_on_dev = true`). The only admin screen run is the Analytics mock preview (renders correctly). Needs your approval to install the CLI and log in, plus a decision on the URL update.

Also not tested: camera capture, mobile viewport, collection/before-after/size-chart/complete-look blocks on the storefront; real AI generation for try-on, flat lay, ghost mannequin, accessories, infographic (cost approval needed); Shopify install, sync and webhooks; real cart/checkout; billing/plan change; live/staging environment; authenticated write paths on settings. No automated test suite for application logic was found beyond ad-hoc scripts in `fitfyce-php/` and the harnesses in `tests/`.

## 5. Final assessment
Core try-on path and read-only admin APIs work and enforce the API key where it is used. The release-blocking item is **authorization on AI Studio and Leads**, followed by committing and re-validating the quota/idempotency fixes. Overall: **not ready to call fully tested** – 32 of 46 probed routes passed their checks and 14 were flagged (in 4 groups: shop-only auth, `/shop/products` 500, and unverified infographic auth), and the largest functional surface (real AI generation and the UIs) has not been run.

## 6. Rerun
```bash
# local replica must be up: cd tests/performance && docker compose up -d
python tests/functional/module_probe.py                 # writes reports/results/functional-probe.json
python tests/performance/scripts/run_test.py smoke      # try-on journey, mocked AI
# storefront widget in headless Chrome (needs Node 22+, Chrome, and the replica running)
cd tests/functional/storefront && node server.mjs &       # harness on :5190
node flow.mjs ../../../reports/results/storefront-flow cart   # add-to-cart pass (use 'buy' for buy-now)
```
