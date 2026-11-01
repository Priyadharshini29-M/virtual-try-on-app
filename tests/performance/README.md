# BRIX / FitFyce Try-On – performance test suite

Local, isolated load testing of the **PHP backend** and the **storefront widget's API traffic**.
Nothing here touches production, the live database, or any paid AI provider.

| Piece | What it is | Label in results |
|---|---|---|
| `php/Dockerfile` | PHP 8.3 + Apache image built from a **copy** of `fitfyce-php/` (the repo source is not modified). The RunPod URL is redirected to the mock inside the image copy only. `.env` is excluded. | – |
| `docker-compose.yml` | `db` (MariaDB 10.11), `mock-ai`, `app`, `k6`. CPU/memory limits are configurable. | – |
| `mock/mock-ai.mjs` | Mock RunPod endpoint: FIFO queue + N simulated GPU workers, configurable generation time, failure rate, queue cap. | **MOCKED** – says nothing about real RunPod capacity |
| `db/init.sql` | Built by `scripts/prepare_db.py` from the repo's migrations + 2 synthetic merchants. `db/schema_drift_patch.sql` adds columns the code needs that the migrations never create. | synthetic data |
| `fixtures/` | Synthetic images (abstract shapes), an oversize file and a non-image file. **No real people / customer photos.** Regenerate with `fixtures/make_fixtures.py`. | synthetic |
| `k6/main.js`, `k6/lib/*` | k6 scenarios, thresholds, profiles. All knobs via env vars. | – |
| `scripts/run_test.py` | Orchestrator: starts the stack with the requested settings, samples CPU/memory/MariaDB/Apache every 5 s, runs k6, checks data consistency, saves results. | – |
| `scripts/show.py` | Prints an evidence-only digest of a saved run. | – |
| `scripts/run_suite.sh` | The full suite (~45 min). | – |

## Prerequisites
Docker Desktop running, Python 3 (stdlib only for the scripts; Pillow only to regenerate fixtures). k6 runs inside Docker (`grafana/k6:0.54.0`) – nothing to install.

## One-time setup
```bash
cd tests/performance
python scripts/prepare_db.py          # builds db/init.sql from the repo's migrations + seed
docker compose up -d --build          # first build takes a few minutes
```

## Run a test
```bash
python scripts/run_test.py smoke                                  # 1 VU, one real try-on journey (mocked AI)
python scripts/run_test.py baseline --mock-workers 10
python scripts/run_test.py load     --mock-workers 10 --max-vus 150 --dur-scale 0.6
python scripts/run_test.py spike    --mock-workers 10 --max-vus 200 --yes-i-am-authorised
python scripts/run_test.py stress   --mock-workers 10 --max-vus 300 --dur-scale 0.5 --yes-i-am-authorised
python scripts/run_test.py soak     --mock-workers 10 --soak-min 10 --yes-i-am-authorised
python scripts/run_test.py recovery --mock-workers 10             # run right after spike/stress
python scripts/run_test.py idempotency --extra-polls 3 --mock-gen-ms 3000   # correctness probe
python scripts/run_test.py quota --mock-gen-ms 2000 --max-vus 20            # correctness probe
bash scripts/run_suite.sh                                         # everything
python scripts/show.py load                                       # digest of the latest 'load' run
```
Heavy profiles (`stress`, `spike`, `soak`) refuse to run without `--yes-i-am-authorised`.
Useful options: `--mock-workers N` (simulated GPU workers; the real endpoint is `workersMax=1`), `--mock-gen-ms` (default 14000 = measured real generation time), `--mock-fail-rate`, `--mock-max-queue`, `--app-workers` (Apache `MaxRequestWorkers`, default 20), `--keepalive On|Off`, `--only widget,journey`, `--widget-event 0|1`, `--dur-scale`, `--rate-scale`, `--max-vus` (hard cap).

Acceptance thresholds are **proposed, configurable targets** (env vars, see `k6/lib/config.js`): `API_P95_MS=800`, `API_ERR=0.01`, `SUBMIT_P95_MS=5000`, `STATUS_P95_MS=1000`, `E2E_P95_MS=90000`, `AI_SUCCESS=0.95`.

## Where results go
`reports/results/<timestamp>-<profile>/` : `summary.json` (k6, machine-readable), `dashboard.html` (k6 HTML report), `monitor.csv` (container CPU/mem, MariaDB, Apache workers, mock queue every 5 s), `k6_stdout.txt`, `meta.json` (settings, before/after state, consistency checks). Report: `reports/brix-tryon-stress-test-report.md`; plan: `reports/brix-tryon-stress-test-plan.md`.

## Safety rules baked in
* Local Docker replica only; the live host is never targeted by these scripts.
* k6 aborts the run if more than 25 % of requests fail (after 30 s).
* `--max-vus` hard-caps virtual users. Heavy profiles need an explicit flag.
* Real AI inference is never called; all AI traffic goes to the mock.

## Known fidelity limits of the replica
* Web server is Apache prefork, the live host is LiteSpeed. With HTTP keep-alive **on**, prefork pins one worker per idle connection and starves under ~50 users; this is a replica artefact, so the default here is `KeepAlive Off` (see report §Bottlenecks).
* Load generator, app, DB and mock share one 4-CPU / 4 GB Docker VM, so absolute numbers are indicative, not production capacity.
* `migrate.php` + `schema_drift_patch.sql` are applied to make the test DB match what the code expects; the real production schema may differ.
* Storefront JS (Lighthouse/Playwright) and real-provider tests are **not run** here.
