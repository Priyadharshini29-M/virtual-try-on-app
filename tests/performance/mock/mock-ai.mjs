// MOCK RunPod serverless endpoint (VTON). Simulates a pool of GPU workers with a FIFO queue.
// No dependencies (Node >= 18). Results from this mock say NOTHING about real RunPod capacity.
//
// Wire format matches what fitfyce-php/src/RunpodVtonClient.php sends/reads:
//   POST /v2/{endpoint}/run          -> {id, status:"IN_QUEUE"}
//   GET  /v2/{endpoint}/status/{id}  -> IN_QUEUE | IN_PROGRESS | COMPLETED{output.images[]} | FAILED{error}
// Extras for the test harness: GET /__stats, POST /__reset, GET /healthz
//
// Env: PORT(4010) MOCK_WORKERS(1) MOCK_GEN_MS(14000) MOCK_JITTER_MS(1000) MOCK_FAIL_RATE(0)
//      MOCK_MAX_QUEUE(0=unbounded; when exceeded /run returns 429) MOCK_RESULT(path to jpg)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = {
  port: +(process.env.PORT || 4010),
  workers: +(process.env.MOCK_WORKERS || 1),
  genMs: +(process.env.MOCK_GEN_MS || 14000),
  jitterMs: +(process.env.MOCK_JITTER_MS || 1000),
  failRate: +(process.env.MOCK_FAIL_RATE || 0),
  maxQueue: +(process.env.MOCK_MAX_QUEUE || 0),
};
const resultB64 = fs.readFileSync(process.env.MOCK_RESULT || path.join(HERE, '..', 'fixtures', 'result.jpg')).toString('base64');

let freeAt, jobs, stats;
function reset() {
  freeAt = Array.from({ length: cfg.workers }, () => 0);
  jobs = new Map();
  stats = { submitted: 0, rejected429: 0, statusCalls: 0, maxQueueDepth: 0 };
}
reset();

const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const json = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };
const queueDepth = (now) => { let n = 0; for (const j of jobs.values()) if (j.start > now) n++; return n; };

http.createServer((req, res) => {
  const now = Date.now();
  const url = new URL(req.url, 'http://x');
  let m;

  if (url.pathname === '/healthz') return json(res, 200, { ok: true, cfg });
  if (url.pathname === '/__reset' && req.method === 'POST') { reset(); return json(res, 200, { ok: true }); }
  if (url.pathname === '/__stats') {
    const waits = [], gens = [];
    let completed = 0, failed = 0, running = 0;
    for (const j of jobs.values()) {
      waits.push(j.start - j.submittedAt); gens.push(j.end - j.start);
      if (now >= j.end) { j.fail ? failed++ : completed++; } else if (now >= j.start) running++;
    }
    waits.sort((a, b) => a - b);
    return json(res, 200, {
      cfg, ...stats, jobs: jobs.size, completed, failed, running, queueDepthNow: queueDepth(now),
      queueWaitMs: { p50: pct(waits, .5), p95: pct(waits, .95), max: waits[waits.length - 1] || 0, avg: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0 },
    });
  }

  // ---- MOCK Fashn.ai (saree engine): behaviour chosen with POST /__fashn?mode=ok|credits|credits-msg|concurrency|badrequest
  if (url.pathname === '/__fashn' && req.method === 'POST') { stats.fashnMode = url.searchParams.get('mode') || 'ok'; stats.fashnCalls = 0; return json(res, 200, { mode: stats.fashnMode }); }
  if (req.method === 'POST' && url.pathname === '/fashn/v1/run') {
    req.on('data', () => {});
    req.on('end', () => {
      stats.fashnCalls = (stats.fashnCalls || 0) + 1;
      const mode = stats.fashnMode || 'ok';
      if (mode === 'credits') return json(res, 402, { error: 'OutOfCredits', message: 'You have run out of credits. Please top up your account.' });
      if (mode === 'credits-msg') return json(res, 403, { error: 'Forbidden', message: 'Insufficient credits on this account' });
      if (mode === 'concurrency') return json(res, 429, { error: 'ConcurrencyLimitExceeded', message: 'Too many requests in flight' });
      if (mode === 'badrequest') return json(res, 400, { error: 'BadRequest', message: 'Invalid model_image' });
      return json(res, 200, { id: 'fashn-mock-' + stats.fashnCalls, error: null });
    });
    return;
  }

  if (req.method === 'POST' && (m = url.pathname.match(/^\/v2\/[^/]+\/run$/))) {
    // drain the (large, base64) request body so the PHP client sees a normal response
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; chunks.push(c); });
    req.on('end', () => {
      try { const inp = (JSON.parse(Buffer.concat(chunks).toString()) || {}).input || {}; stats.lastInputKeys = Object.keys(inp).sort(); stats.lastPrompt = String(inp.prompt || '').slice(0, 80); } catch { /* body not JSON */ }
      if (cfg.maxQueue > 0 && queueDepth(now) >= cfg.maxQueue) { stats.rejected429++; return json(res, 429, { error: 'Too many requests' }); }
      let w = 0; for (let i = 1; i < freeAt.length; i++) if (freeAt[i] < freeAt[w]) w = i;
      const start = Math.max(now, freeAt[w]);
      const dur = Math.max(1, cfg.genMs + Math.round((Math.random() * 2 - 1) * cfg.jitterMs));
      freeAt[w] = start + dur;
      const id = crypto.randomUUID() + '-mock';
      jobs.set(id, { submittedAt: now, start, end: start + dur, fail: Math.random() < cfg.failRate, bodyBytes: size });
      stats.submitted++;
      stats.maxQueueDepth = Math.max(stats.maxQueueDepth, queueDepth(now));
      json(res, 200, { id, status: 'IN_QUEUE' });
    });
    return;
  }

  if (req.method === 'GET' && (m = url.pathname.match(/^\/v2\/[^/]+\/status\/(.+)$/))) {
    stats.statusCalls++;
    const j = jobs.get(decodeURIComponent(m[1]));
    if (!j) return json(res, 404, { error: 'job not found' });
    if (now < j.start) return json(res, 200, { id: m[1], status: 'IN_QUEUE' });
    if (now < j.end) return json(res, 200, { id: m[1], status: 'IN_PROGRESS' });
    if (j.fail) return json(res, 200, { id: m[1], status: 'FAILED', error: 'mock injected failure' });
    return json(res, 200, { id: m[1], status: 'COMPLETED', output: { images: [resultB64] } });
  }

  json(res, 404, { error: 'not found' });
}).listen(cfg.port, () => console.log('mock-ai listening', JSON.stringify(cfg)));
