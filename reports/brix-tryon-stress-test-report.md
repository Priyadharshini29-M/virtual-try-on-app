# BRIX Try-On – Stress Test Report

Report date: 2026-10-22. Every number below is taken from `reports/results/<run>/summary.json`, `meta.json` or `monitor.csv` (digested with `tests/performance/scripts/show.py`). Nothing is estimated.

> **Scope warning.** All AI traffic was **MOCKED** and every test ran against a **local Docker replica** (PHP 8.3/Apache + MariaDB + mock RunPod, one shared 4-CPU/4 GB VM, k6 in the same VM). Results say nothing about real RunPod/Fashn/fal.ai/OpenAI capacity, LiteSpeed, Cloudflare or the live host. No live or staging environment was tested.

## 1. Executive summary
* The widget path (settings → submit → poll → fetch result) is fast and error-free up to **315 VUs / ~95 req/s** when only widget + try-on traffic is sent (p95 239 ms, 0 % HTTP errors).
* When **photo uploads and admin calls are mixed in**, latency degrades at far lower throughput (p95 1.2 s at 33 req/s; 2.6 s at 48 req/s) and fails the proposed 800 ms target. Apache workers (20) and DB CPU were saturated in those runs.
* **Zero HTTP-level failures in every run**, but the GPU-bound spike (1 simulated worker) delivered only **38.5 % try-on success** (24 client timeouts) – a capacity, not an error-rate, problem.
* Two **correctness defects** were found under test (usage double-counting on repeated status polls; plan limit exceeded under concurrent submits: 95 → 115 on a limit of 100). Both were fixed in the working tree at 10:13–10:16 on 2026-10-22 and the targeted retests pass. Load/stress runs have **not** been repeated on the fixed code.
* Formal acceptance is **pending**: the thresholds are proposed engineering targets, not approved business criteria.

## 2. Confirmed application architecture
Confirmed from the repo and the existing plan (`reports/brix-tryon-stress-test-plan.md` §1):
* Storefront: Shopify theme app extension (`tryon-widget.js`, `tryon-modal.css`, Liquid blocks), calling `/apps/tryfit/*` (App Proxy).
* Backend: PHP 8 front controller `api.php` → `router.php`; MariaDB; file storage (`results/`, `temp/`); `X-Api-Key` for admin routes, `?shop=` for widget routes.
* Async try-on: `POST /api/tryon` → provider job id; `GET /api/tryon-status` polls the provider and, on completion, saves the image and updates session/quota/analytics.
* Providers: RunPod FASHN VTON 1.5 (`workersMax=1`), Fashn.ai, fal.ai, HF Space, OpenAI. Python service and Remix admin are out of scope of these tests.
* Not verified in this run: whether the live App Proxy targets PHP directly (skipping signature checks) – needs the Partner Dashboard.

## 3. Environment and configuration
| Item | Value |
|---|---|
| Target | `http://app:80` inside docker compose project `brixperf` (local) |
| Stack | PHP 8.3 + Apache prefork (`MaxRequestWorkers` 20, KeepAlive Off), MariaDB 10.11, mock RunPod, `grafana/k6:0.54.0` |
| Data | 2 synthetic merchants, synthetic images (`tests/performance/fixtures/`) |
| Mock GPU | 14 000 ms per generation (earlier real measurement, pre-existing); 10 workers unless stated, 1 worker for the GPU-bound spike |
| Safety | Production, live DB and paid AI never contacted; `.env` excluded from the image |

## 4. Endpoints and workflows tested (all MOCKED AI, local)
| Endpoint | Auth | Class |
|---|---|---|
| `GET /api/widget-settings?shop=` | shop param | read-only |
| `POST /api/widget-event` | shop param | write (synthetic) |
| `POST /api/tryon?shop=` | shop param | mocked AI submit |
| `GET /api/tryon-status?job_id=` (poll) | shop param | mocked AI poll + finalise |
| result image fetch | – | read-only |
| `POST /upload-temp` (valid / 7 MB / non-image) | – | write (temp files) |
| Admin settings (`X-Api-Key`) | API key | read-only |

## 5–8. Results (date 2026-10-21 unless noted; commands in §6)
Status is judged against the **proposed** thresholds (API p95 < 800 ms, error < 1 %, submit p95 < 5 s, poll p95 < 1 s, e2e p95 < 90 s, success > 95 %). PASS/FAIL below = "met / did not meet proposed targets", not formal acceptance. "Failure rate" is the k6 HTTP failure rate; try-on-level failures are noted.

| Scenario | VUs (max) | Duration | Requests | RPS | p95 latency | Failure rate | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| Smoke (2026-10-22 11:38, re-run) | 4 | 44.7 s | 71 | 2.2 | 687 ms | 0.00 % | PASS |
| Baseline | 12 | 183.7 s | 1 246 | 6.9 | 37 ms | 0.00 % | PASS |
| Load (widget + try-on + upload + admin) | 68 | 309.1 s | 10 019 | 33.2 | 1 201 ms | 0.00 % | FAIL (widget p95, submit p95 5 384 ms, poll p95 1 509 ms) |
| Spike, 10 mock GPU workers | 167 | 256.7 s | 9 242 | 39.9 | 4 412 ms | 0.00 % | FAIL (widget, submit p95 11 070 ms, poll p95 7 472 ms) |
| Spike, 1 mock GPU worker | 183 | 344.7 s | 15 116 | 46.9 | 380 ms | 0.00 % HTTP; **61.5 % try-ons not successful** (24 timeouts) | FAIL (success 38.5 %, e2e p95 178.8 s) |
| Stress, widget + try-on only | 315 | 393.8 s | 30 201 | 94.9 | 239 ms | 0.00 % | PASS |
| Stress-heavy (+ admin + upload) | 221 | 293.0 s | 11 041 | 48.4 | 2 588 ms | 0.00 % | FAIL (widget, admin, submit p95 10 098 ms, poll p95 4 402 ms) |
| Soak, 10 min | 32 | 702.9 s | 16 470 | 23.8 | 95 ms | 0.00 % | PASS |
| Recovery after container restart | 5 | 305.6 s | 226 | 0.8 | 48 ms | 0.00 % | PASS |
| Recovery, no restart, post-fix (2026-10-22 10:13) | 5 | 324.0 s | 223 | 0.7 | 315 ms | 0.00 % | PASS – see caveat §10 |
| Idempotency, **before fix** | 1 | 51.3 s | 33 | 0.7 | 48 ms | 0.00 % | **FAIL** – 12 usage increments for 3 jobs (9 double-counted) |
| Idempotency, after fix (2026-10-22 10:21) | 1 | 16.1 s | 19 | 1.8 | 111 ms | 0.00 % | PASS – 3 increments for 3 jobs, 0 double-counted |
| Quota, **before fix** | 20 | 45.7 s | 181 | 4.3 | 2 560 ms | 0.00 % | **FAIL** – 20 accepted at 95/100 used; usage 95 → 115 |
| Quota, after fix (2026-10-22 10:22) | 20 | – | 31 | 4.0 | 299 ms (submit) | 0.00 % | PASS on k6 counts – 5 accepted, 15 × HTTP 429. DB usage not recorded (no `meta.json` saved) |

**Maximum VUs reached: 315** (stress run, mocked AI, local replica).

### Latency detail (all-requests p50/p90/p95/p99, ms)
| Run | p50 | p90 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|
| Smoke | 22 | 363 | 687 | 1 372 | 1 372 |
| Baseline | 11 | 27 | 37 | 83 | 211 |
| Load | 42 | 608 | 1 201 | 4 424 | 11 731 |
| Spike (10 w) | 178 | 2 497 | 4 412 | 15 833 | 24 818 |
| Spike (1 w) | 20 | 200 | 380 | 1 183 | 2 370 |
| Stress | 20 | 156 | 239 | 414 | 3 453 |
| Stress-heavy | 237 | 1 922 | 2 588 | 7 785 | 16 792 |
| Soak | 12 | 42 | 95 | 422 | 2 863 |

Smoke end-to-end (mock job, 1 worker, 14 s generation): submit 1 455 ms, poll p95 771 ms, e2e 18.1 s, 1 job, 100 % success. The first request after the stack was idle is slow (smoke p99 1.4 s); smoke's 4 VUs is the profile's cap, not the requested 1 VU – see §12.

## 9. Resource utilization (peak over 5 s samples; one shared Docker VM)
| Run | App CPU | DB CPU | Apache busy / 20 | DB threads | Mock queue depth |
|---|---:|---:|---:|---:|---:|
| Baseline | 32 % | 14 % | 3 | 2 | 0 |
| Load | 96 % | 132 % | 19 | 20 | 0 |
| Spike (10 w) | 321 % | 210 % | 20 | 18 | 1 |
| Spike (1 w) | 166 % | 101 % | 20 | 12 | 31 |
| Stress | 130 % | 100 % | 20 | 19 | 3 |
| Stress-heavy | 203 % | 105 % | 20 | 19 | 0 |
| Soak | 26 % | 109 % | 6 | 9 | 0 |
App memory stayed ≤ 90 MiB and DB memory ≤ 168 MiB in every run (no growth trend seen in the 10-minute soak: 35 MiB / 138 MiB peak). DB `max_used_connections` peaked at 24. The MariaDB `slow_queries` counter is cumulative across runs (e.g. 199 after Load, 527 after Stress-heavy); the slow-query threshold was not recorded, so it is not attributed to any query.

## 10. Reproducible failures and evidence
1. **Usage double-counting (fixed, retest passed).** Idempotency run `20261021-175035-idempotency`: 3 completed jobs, 9 extra polls after completion → `tryon_count_month` +12, `result_files` 12. Also seen in the invalidated 10:06 spike chain (94 vs 85). Post-fix run `20261022-102158-idempotency`: +3 for 3 jobs.
2. **Plan limit not enforced under concurrency (fixed, partly verified).** `20261021-175609-quota`: 20 concurrent submits at 95/100 → all 20 accepted, usage 115. Post-fix k6 run: 5 accepted, 15 × 429. The post-fix DB counter was not captured.
3. **GPU-bound success collapse.** `20261021-184233-spike`: mock queue depth peaked at 31, queue wait p50 227 s, 24 client timeouts. Client gives up at 190 s (plan §1). Depends on the simulated worker count (1, matching `workersMax=1`) and 14 s generation time.
4. **Widget latency collapses when uploads/admin are mixed in** (Load, Spike, Stress-heavy), while widget+try-on-only stress at 2–3× the throughput stays at p95 239 ms. Measured contrast; the CPU and Apache-worker saturation in the same runs is consistent with the upload/admin work being the cost, but individual endpoints were not profiled, so root cause is **not confirmed**.

Caveats: the code fixes (`TryOnController.php`, `PlanLimitCheck.php`, `MerchantRepo.php`) are uncommitted working-tree changes; I did not review them beyond the diff excerpt. The 10:13 recovery run followed an invalid, overlapping chain (mock reported 104 submitted jobs vs 10 from k6), so its higher submit p95 (2 502 ms) may include leftover load. Invalid runs are in `reports/results/invalid/` and excluded. Nine Oct-21 `load` runs between 18:02 and 18:26 were harness tuning iterations and are not used here.

## 11. Bottlenecks and recommendations
| Priority | Finding | Evidence | Recommendation |
|---|---|---|---|
| High | Over-limit and double-counted usage affected billing integrity | §10.1–2 | Commit and review the atomic reserve/claim fix; rerun idempotency, quota and a concurrent load run on the fixed code |
| High | GPU capacity bounds shopper success | §10.3 | Decide acceptable queueing: raise `workersMax` (note: previously reverted deliberately), show queue/ETA, shorten 190 s client timeout messaging |
| Medium | Upload/admin traffic degrades the shared Apache worker pool | §10.4, §9 | Profile `/upload-temp` and admin endpoints (image processing, DB queries); consider caching `widget-settings`; measure on LiteSpeed |
| Low | `slow_queries` growing, threshold unknown | §9 | Record `long_query_time` and enable the slow log in the next run |

## 12. Blocked and untested
* **Live/staging read-only load (Tier B): BLOCKED** – an earlier ad-hoc run at ≈37 req/s against the live host reportedly caused HTTP 500s and an IP block (from the plan; not re-verified here). Needs an allowlisted IP and approval.
* **Real AI generation (Tier C): NOT RUN** – needs approved job count and cost cap. AI Studio workflows (flat lay, ghost mannequin, accessories, infographic) are untested.
* Product Catalog, Analytics, Asset Library, Plans and Remix dashboard routes; lead capture (the `leads` table is not created by repo migrations); browser/Lighthouse and camera flow; Shopify App Proxy signature and webhooks; cleanup cron.
* **Process deviation:** the requested first step was a 1-VU/30 s smoke. The `smoke` profile uses up to 4 VUs (≈45 s), and the earlier campaign (up to 315 VUs) was executed in a previous session before staged approval in this one; I found its artifacts but cannot see the approvals. All of it was local and mocked.
* Fidelity limits: Apache prefork vs LiteSpeed; shared VM; schema made via migrations plus `schema_drift_patch.sql`.

## 13. Retest results and unresolved risks
* Retested after fixes: idempotency PASS, quota PASS (k6 side), recovery PASS.
* Not retested after fixes: load, spike, stress, soak – the added atomic UPDATE and per-job claim may change latency and DB load; unmeasured.
* Unresolved: root cause of upload/admin slowdown, real-provider behaviour, live host capacity.

## 14. Acceptance criteria and final assessment
Criteria are **proposed, not approved** → formal acceptance **pending**. Against the proposed targets, on the local mocked replica: baseline, soak, widget-only stress and recovery meet them; load, spike (both) and stress-heavy do not. The product is not ready to be called load-validated until the fixes are committed, load/stress are rerun on the fixed code, and a live/staging and a capped real-AI test are approved and run.

## Commands
```bash
cd tests/performance
python scripts/prepare_db.py
docker compose up -d --build
python scripts/run_test.py smoke
python scripts/run_test.py baseline --mock-workers 10
python scripts/run_test.py load --mock-workers 10 --max-vus 150 --dur-scale 0.6
python scripts/run_test.py stress --mock-workers 10 --max-vus 300 --dur-scale 0.5 --yes-i-am-authorised
python scripts/run_test.py idempotency --extra-polls 3 --mock-gen-ms 3000
python scripts/run_test.py quota --mock-gen-ms 2000 --max-vus 20
python scripts/show.py <profile|run-dir>      # evidence digest
```
Artifacts: `reports/results/<timestamp>-<profile>/{summary.json,meta.json,monitor.csv,k6_stdout.txt,dashboard.html}`.
