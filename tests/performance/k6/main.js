// BRIX / FitFyce try-on load tests (PHP backend replica + mock AI).  Run via ../scripts/run_test.py or:
//   docker compose --profile tools run --rm k6 run -e PROFILE=smoke k6/main.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';
import { Trend, Counter, Rate } from 'k6/metrics';
import { BASE, SHOP, QUOTA_SHOP, API_KEY, PROFILE, OUT_DIR, POLL_MS, DEADLINE_MS, EXTRA_POLLS, T } from './lib/config.js';
import { PROFILES } from './lib/profiles.js';

// ---- fixtures (synthetic images) -------------------------------------------------------------
const PERSON = open('../fixtures/person.jpg', 'b');
const GARMENT = open('../fixtures/garment.jpg', 'b');
const OVERSIZE = open('../fixtures/oversize.jpg', 'b');
const NOT_IMG = open('../fixtures/not-an-image.txt', 'b');
const dataUri = (b) => 'data:image/jpeg;base64,' + encoding.b64encode(b, 'std');
const TRYON_BODY = JSON.stringify({ clothing_image: dataUri(GARMENT), avatar_image: dataUri(PERSON), product_title: 'Cotton T-Shirt', seed: 42 });
const JSON_H = { 'Content-Type': 'application/json' };

// ---- custom metrics --------------------------------------------------------------------------
const submitMs   = new Trend('tryon_submit_ms', true);
const statusMs   = new Trend('tryon_status_ms', true);
const e2eMs      = new Trend('tryon_e2e_ms', true);   // submit -> result visible (INCLUDES the mocked AI time)
const resultMs   = new Trend('result_fetch_ms', true);
const tOk        = new Counter('tryon_completed');
const tFail      = new Counter('tryon_failed');
const tTimeout   = new Counter('tryon_timeout');
const tRejected  = new Counter('tryon_submit_rejected');
const polls      = new Counter('status_polls');
const extraPolls = new Counter('extra_polls_after_complete');
const tSuccess   = new Rate('tryon_success');
const qAccepted  = new Counter('quota_accepted');
const qRejected  = new Counter('quota_rejected_429');
const upOk       = new Counter('upload_valid_ok');
const upRejected = new Counter('upload_invalid_rejected');
const upWrong    = new Counter('upload_unexpected');

// ---- options ---------------------------------------------------------------------------------
const ALL = PROFILES[PROFILE];
// ONLY=widget,journey keeps just those scenarios (used to bisect a bottleneck)
const ONLY = (__ENV.ONLY || '').split(',').filter(Boolean);
const scenarios = ALL && ONLY.length ? Object.fromEntries(Object.entries(ALL).filter(([k]) => ONLY.includes(k))) : ALL;
if (!scenarios) throw new Error(`Unknown PROFILE '${PROFILE}'. Options: ${Object.keys(PROFILES).join(', ')}`);
const has = (n) => Object.prototype.hasOwnProperty.call(scenarios, n);

const thresholds = {
  // SAFETY: abort the whole run if the backend is clearly falling over.
  http_req_failed: [{ threshold: 'rate<0.25', abortOnFail: true, delayAbortEval: '30s' }],
};
if (has('widget')) {
  thresholds['http_req_duration{name:widget_settings}'] = [`p(95)<${T.API_P95_MS}`];
  thresholds['http_req_failed{name:widget_settings}'] = [`rate<${T.API_ERR}`];
}
if (has('journey')) {
  thresholds['tryon_submit_ms'] = [`p(95)<${T.SUBMIT_P95_MS}`];
  thresholds['tryon_status_ms'] = [`p(95)<${T.STATUS_P95_MS}`];
  thresholds['tryon_e2e_ms'] = [`p(95)<${T.E2E_P95_MS}`];
  thresholds['tryon_success'] = [`rate>${T.AI_SUCCESS}`];
}
if (has('admin')) thresholds['http_req_duration{name:admin_settings}'] = [`p(95)<${T.API_P95_MS}`];

export const options = {
  scenarios,
  thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const OK_OR_400 = http.expectedStatuses({ min: 200, max: 299 }, 400);
const OK_OR_429 = http.expectedStatuses({ min: 200, max: 299 }, 429);

// ---- scenario: storefront widget page load ---------------------------------------------------
export function widget() {
  const r = http.get(`${BASE}/api/widget-settings?shop=${SHOP}`, { tags: { name: 'widget_settings' } });
  check(r, { 'widget-settings 200': (x) => x.status === 200, 'widget-settings has config': (x) => !!x.body && x.body.length > 20 });
  if (__ENV.WIDGET_EVENT === '0') { sleep(1 + Math.random() * 2); return; }
  const e = http.post(`${BASE}/api/widget-event`, JSON.stringify({ shop: SHOP, event: 'widget_open' }), { headers: JSON_H, tags: { name: 'widget_event' } });
  check(e, { 'widget-event 200': (x) => x.status === 200 });
  sleep(1 + Math.random() * 2);
}

// ---- helpers for the async try-on flow -------------------------------------------------------
function submit(shop) {
  const t = Date.now();
  const r = http.post(`${BASE}/api/tryon?shop=${shop}`, TRYON_BODY, { headers: JSON_H, tags: { name: 'tryon_submit' }, responseCallback: OK_OR_429, timeout: '60s' });
  submitMs.add(Date.now() - t);
  return r;
}

function pollOnce(job, shop) {
  const t = Date.now();
  const r = http.get(`${BASE}/api/tryon-status?job_id=${encodeURIComponent(job)}&shop=${shop}&seed=42`, { tags: { name: 'tryon_status' }, responseCallback: OK_OR_400, timeout: '30s' });
  statusMs.add(Date.now() - t);
  polls.add(1);
  let status = 'unparsed';
  try { status = r.json('status'); } catch (e) { /* non-JSON body, e.g. a 500 page */ }
  return { r, status };
}

function pollToEnd(job, shop, t0) {
  while (Date.now() - t0 < DEADLINE_MS) {
    sleep(POLL_MS / 1000);
    const { r, status } = pollOnce(job, shop);
    if (status === 'completed') return { outcome: 'completed', r };
    if (status === 'failed') return { outcome: 'failed', r };
    // 'processing' or a transient error -> keep polling, like the widget does
  }
  return { outcome: 'timeout' };
}

// ---- scenario: full try-on journey (submit -> poll -> result) --------------------------------
export function journey() {
  const t0 = Date.now();
  const s = submit(SHOP);
  const accepted = check(s, { 'submit 200 + job_id': (x) => x.status === 200 && !!x.json('job_id') });
  if (!accepted) { tRejected.add(1); tSuccess.add(false); return; }
  const job = s.json('job_id');
  const end = pollToEnd(job, SHOP, t0);
  if (end.outcome === 'completed') {
    e2eMs.add(Date.now() - t0); tOk.add(1); tSuccess.add(true);
    const url = end.r.json('result_image');
    if (url) {
      const f = http.get(String(url).replace(/^https?:\/\/[^/]+/, BASE), { tags: { name: 'result_fetch' } });
      resultMs.add(f.timings.duration);
      check(f, { 'result image 200': (x) => x.status === 200, 'result is an image': (x) => String(x.headers['Content-Type'] || '').includes('image') });
    }
    for (let i = 0; i < EXTRA_POLLS; i++) { pollOnce(job, SHOP); extraPolls.add(1); }
  } else if (end.outcome === 'failed') {
    tFail.add(1); tSuccess.add(false);
  } else {
    tTimeout.add(1); tSuccess.add(false);
  }
}

// ---- scenario: image upload validation -------------------------------------------------------
export function upload() {
  const good = http.post(`${BASE}/upload-temp`, { photo: http.file(PERSON, 'person.jpg', 'image/jpeg') }, { tags: { name: 'upload_valid' } });
  if (check(good, { 'valid upload 200 + tempUrl': (x) => x.status === 200 && !!x.json('tempUrl') })) upOk.add(1); else upWrong.add(1);
  // Large images are accepted since the 5 MB limit was removed (the server downscales them), so this now asserts 200 + tempUrl.
  const big = http.post(`${BASE}/upload-temp`, { photo: http.file(OVERSIZE, 'big.jpg', 'image/jpeg') }, { tags: { name: 'upload_oversize' } });
  if (check(big, { 'large image accepted (200 + tempUrl)': (x) => x.status === 200 && !!x.json('tempUrl') })) upOk.add(1); else upWrong.add(1);
  const txt = http.post(`${BASE}/upload-temp`, { photo: http.file(NOT_IMG, 'x.jpg', 'image/jpeg') }, { tags: { name: 'upload_not_image' }, responseCallback: OK_OR_400 });
  if (check(txt, { 'non-image rejected (400)': (x) => x.status === 400 })) upRejected.add(1); else upWrong.add(1);
  sleep(1);
}

// ---- scenario: merchant admin endpoints (X-Api-Key) ------------------------------------------
export function admin() {
  const h = { headers: { 'X-Api-Key': API_KEY } };
  const routes = [['admin_settings', '/settings'], ['admin_analytics', '/analytics'], ['admin_widget_settings', '/widget/settings'], ['admin_shop', '/shop'], ['admin_products', '/products']];
  for (const [name, path] of routes) {
    const r = http.get(`${BASE}${path}`, Object.assign({ tags: { name } }, h));
    check(r, { [`${name} 200`]: (x) => x.status === 200 });
  }
  sleep(1 + Math.random() * 2);
}

// ---- correctness probe: quota under concurrency ----------------------------------------------
// perf-quota merchant: plan 'basic' (limit 100) starting at 95 used => at most 5 should be accepted.
export function quota() {
  const t0 = Date.now();
  const s = submit(QUOTA_SHOP);
  if (s.status === 429) { qRejected.add(1); return; }
  if (s.status === 200 && s.json('job_id')) { qAccepted.add(1); pollToEnd(s.json('job_id'), QUOTA_SHOP, t0); }
}

// ---- correctness probe: is completion idempotent? ---------------------------------------------
export function idem() { journey(); }

// ---- summary ---------------------------------------------------------------------------------
export function handleSummary(data) {
  const m = data.metrics;
  const v = (k, f) => (m[k] && m[k].values[f] !== undefined ? m[k].values[f].toFixed(1) : null);
  const lines = [
    `PROFILE=${PROFILE} BASE=${BASE}`,
    `iterations=${m.iterations ? m.iterations.values.count : 0} http_reqs=${m.http_reqs.values.count} rps=${m.http_reqs.values.rate.toFixed(1)} failed=${(m.http_req_failed.values.rate * 100).toFixed(2)}% vus_max=${m.vus_max ? m.vus_max.values.max : '?'}`,
    `http p95 ms: ${v('http_req_duration', 'p(95)')}`,
  ];
  for (const [k, label] of [['tryon_submit_ms', 'submit'], ['tryon_status_ms', 'status'], ['tryon_e2e_ms', 'e2e']]) {
    if (v(k, 'p(95)') !== null) lines.push(`${label} p95 ms: ${v(k, 'p(95)')}`);
  }
  return { [`${OUT_DIR}/summary.json`]: JSON.stringify(data, null, 1), stdout: lines.join('\n') + '\n' };
}
