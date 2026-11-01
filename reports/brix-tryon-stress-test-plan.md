# BRIX Try-On – Stress Test Plan

Scope: PHP backend (`fitfyce-php`) and the storefront widget's API traffic (`tryon-widget.js`). The Python service is out of scope (not deployed).
Note: the repository and Shopify app are named FitFyce / Fit Snap; "BRIX Try-On" is treated as the same product.

## 1. Architecture discovered from the code
| Layer | Finding |
|---|---|
| Storefront | Theme app extension: `tryon-widget.js` (173.6 KB raw, ~39 KB gzip, unminified), `tryon-modal.css` (67.9 KB raw, ~12 KB gzip), 6 Liquid blocks. All calls go to `https://{shop}/apps/tryfit/*` (Shopify App Proxy). |
| Widget calls | `GET /api/widget-settings` (every product-page load), `POST /api/widget-event`, `POST /api/tryon`, `GET /api/tryon-status` (poll every 2.5 s, give up at 190 s), `POST /api/lead/capture` |
| App Proxy target | `shopify.app.toml` points the proxy at the PHP host (`tryonapp.digifyce.com`) directly. PHP does no Shopify signature check; the signature-verifying Remix routes (`api.tryon*.jsx`) are bypassed if this is the live setup. **To be confirmed in the Partner Dashboard.** |
| Backend | PHP 8 on LiteSpeed shared hosting behind Cloudflare, MariaDB/MySQL, file storage (`results/`, `temp/`). No Docker, no APM; only `logs/app.log`. Front controller `api.php` → `router.php` (≈60 `require_once` per request). |
| Auth | Public widget routes: `?shop=` only. Admin routes: `X-Api-Key`. CORS `*`. |
| Async design | `POST /api/tryon` submits to RunPod and returns a job id; `GET /api/tryon-status` checks the provider once per call and, on completion, saves the image, updates session/quota/analytics. |
| AI providers | RunPod FASHN VTON 1.5 (`workersMax=1`, measured ≈14 s/generation), Fashn.ai (sarees), fal.ai (flat-lay), HF Space (accessories), OpenAI (infographics). |
| Quota | `PlanLimitCheck` at submit; `tryon_count_month` incremented at completion. |
| Existing perf data | `docs/concurrent-load-report.html`: real 3-tab test, 15.2 / 30.7 / 45.3 s for 3 simultaneous shoppers with 1 worker (REAL-INTEGRATION, pre-existing). |

## 2. Test approach and safety limits
* **Tier A – local Docker replica (executed):** PHP + MariaDB + mock AI + k6. All AI traffic MOCKED. Synthetic merchants and images only.
* **Tier B – live read-only (BLOCKED):** an earlier ad-hoc run at ≈37 req/s from one IP caused HTTP 500s and then a host-side IP block (HTTP 403). Not repeated; needs an allowlisted IP and approval.
* **Tier C – real AI smoke (NOT RUN):** needs an approved job count and cost cap.
* Hard caps: `--max-vus`; abort if >25 % request failures; heavy profiles need `--yes-i-am-authorised`; no deployment commands, no production changes, no application-code changes.

## 3. Scenarios
| Scenario | Profile (default) | Cap | Purpose |
|---|---|---|---|
| Smoke | 1 VU widget + 1 try-on + 1 upload + admin, ~30 s | 4 VUs | validate harness and endpoints |
| Baseline | 5 widget VUs, 2 try-ons/min, 3 min | 12 | reference latencies |
| Load | ramp to 50 widget VUs + 8 try-ons/min | 150 | expected concurrent activity |
| Stress | steps to 300 widget VUs + 64 try-ons/min | 300 | find the breaking point |
| Spike | 5→150 VUs in 10 s, 40 try-ons/min | 200 | sudden burst |
| Spike (GPU-bound) | same, 1 simulated GPU worker | 200 | what shoppers see when the GPU is the limit |
| Soak | 25 VUs + 4 try-ons/min, 10 min | 50 | leaks, storage growth, degradation |
| Recovery | 2 VUs + 2 try-ons/min, 5 min after heavy runs | 50 | return to baseline |
| Idempotency | 3 jobs, 3 extra polls each | 1 | correctness: no double-counting |
| Quota | 20 concurrent submits at 95/100 used | 20 | correctness: limit enforced under concurrency |
| Upload | valid / 7 MB oversize / non-image | 5 | validation (5 MB limit) |

## 4. Proposed acceptance criteria (configurable, NOT verified facts)
| Metric | Target |
|---|---|
| Widget/admin API p95 | < 800 ms |
| API error rate | < 1 % |
| Try-on submit p95 | < 5 s |
| Status poll p95 | < 1 s |
| Try-on end-to-end p95 (incl. mocked GPU) | < 90 s |
| Try-on success rate | > 95 % |
| Data consistency | quota delta == completed jobs; limit never exceeded |

## 5. Not planned / blocked
Storefront browser metrics (Lighthouse/Playwright, camera flow), real provider latency and rate limits, Shopify API throttling and webhooks, lead capture (`leads` table is not created by the repo's migrations), size-chart / complete-look endpoints, data-lifecycle cleanup (`cron/cleanup_results.php`), Fashn/saree and accessory paths.
