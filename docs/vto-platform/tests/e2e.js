/**
 * End-to-end acceptance run for the VTO injection platform (spec: docs/injection-skill.md, section 12).
 *
 *   node tests/e2e.js                      (server must be running: bash start-local.sh)
 *   SERVER_LOG=path/to/server.log node tests/e2e.js   also scans the PHP server log for warnings
 *
 * Steps a–g from the test plan. Every step opens a NEW browser context so the 60 s
 * Cache-Control on config.php never hides freshly learned / activated selectors.
 * Output: tests/screenshots/*.png, tests/results.json, tests/console.log
 */
'use strict';
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.env.VTO_BASE || 'http://localhost:8080';
const SITE_ID = 1;
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
const PHOTO = path.join(__dirname, 'fixtures', 'person.jpg');
const MARIADB = process.env.VTO_MARIADB || 'C:\\vto-runtime\\mariadb\\bin\\mariadb.exe';
const DB_ARGS = ['-uvto_user', '-pvto_local_pass', '-h127.0.0.1', '-P3307', 'vto_platform'];
const ADMIN = { email: 'admin@test.local', password: 'Admin@123456' };

fs.mkdirSync(SHOTS, { recursive: true });

/* ---------------- DB helpers (mariadb CLI, tab-separated) ---------------- */
function sql(q) {
  const out = execFileSync(MARIADB, [...DB_ARGS, '-B', '-e', q], { encoding: 'utf8' });
  const lines = out.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const cols = lines[0].split('\t');
  return lines.slice(1).map(l => {
    const v = l.split('\t'); const o = {};
    cols.forEach((c, i) => { o[c] = v[i] === 'NULL' ? null : v[i]; });
    return o;
  });
}
const selectorsTable = () => sql(
  `SELECT id, page_type, target, selector, source, confidence, hits, misses, status
     FROM selectors WHERE site_id = ${SITE_ID} ORDER BY page_type DESC, target, id`);
const lastEvents = (n = 6) => sql(
  `SELECT id, type, plan, page_type, meta FROM events WHERE site_id = ${SITE_ID} ORDER BY id DESC LIMIT ${n}`);

/* ---------------- run bookkeeping ---------------- */
const results = [];
const consoleLines = [];
const snapshots = {};
function check(id, name, pass, plan, evidence) {
  results.push({ id, name, pass: !!pass, plan: plan || '-', evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}  [plan: ${plan || '-'}]  ${evidence}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cleanVtoLog(text) {
  // console.log('%c[VTO]', 'color:…', ...args) → "[VTO] ...args"
  return text.replace(/^%c\[VTO\]\s+color:\S+\s*/, '[VTO] ');
}

/** New context + page that records the widget's [VTO] console lines under a label. */
async function openPage(browser, label, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => {
    const t = m.text();
    if (t.includes('[VTO]')) { const c = cleanVtoLog(t); logs.push(c); consoleLines.push(`[${label}] ${c}`); }
    else if (m.type() === 'error') consoleLines.push(`[${label}] console.error: ${t}`);
  });
  page.on('pageerror', e => consoleLines.push(`[${label}] pageerror: ${e.message}`));
  await page.goto(BASE + url);
  return { ctx, page, logs };
}
const winner = (logs, zone) => {
  const l = logs.find(x => x.includes(`zone ${zone} → injected by plan`));
  return l ? l.match(/injected by plan (\w+)/)[1] : null;
};
/** report.php is fire-and-forget (keepalive fetch); give the server a moment to write it */
async function settle(page) { await page.waitForLoadState('networkidle').catch(() => {}); await sleep(600); }

async function visitCollection(browser, label, { wantAfterScroll = false, shot } = {}) {
  const v = await openPage(browser, label, '/demo/index.html');
  await v.page.waitForFunction(() => document.querySelectorAll('.vto-icon.vto-card').length >= 4, null, { timeout: 20000 });
  const first = await v.page.locator('.vto-icon.vto-card').count();
  if (shot) await v.page.screenshot({ path: path.join(SHOTS, shot), fullPage: true });
  let after = first;
  if (wantAfterScroll) {
    await v.page.waitForFunction(() => document.querySelectorAll('.vto-icon.vto-card').length >= 8, null, { timeout: 15000 }).catch(() => {});
    after = await v.page.locator('.vto-icon.vto-card').count();
  }
  await settle(v.page);
  return { ...v, first, after, plan: winner(v.logs, 'cards') };
}

async function visitProduct(browser, label, { shot } = {}) {
  const v = await openPage(browser, label, '/demo/product.html');
  await v.page.waitForSelector('.vto-btn[data-vto="product"]', { timeout: 25000 });
  await v.page.waitForSelector('.vto-icon.vto-main', { timeout: 10000 }).catch(() => {});
  const layout = await v.page.evaluate(() => {
    const btn = document.querySelector('.vto-btn[data-vto="product"]');
    const prev = btn && btn.previousElementSibling;
    const icon = document.querySelector('.vto-icon.vto-main');
    return {
      prevTag: prev ? prev.tagName + '.' + prev.className : null,
      prevText: prev ? prev.textContent.trim() : null,
      iconInMedia: !!(icon && icon.closest('.media')),
    };
  });
  await settle(v.page);
  if (shot) await v.page.screenshot({ path: path.join(SHOTS, shot), fullPage: true });
  return { ...v, layout, plan: winner(v.logs, 'product') };
}

/* ======================================================================== */
(async () => {
  // clean slate for site 1 so the before/after tables are meaningful
  sql(`DELETE FROM selectors WHERE site_id=${SITE_ID}; DELETE FROM events WHERE site_id=${SITE_ID};
       DELETE FROM scans WHERE site_id=${SITE_ID}; DELETE FROM tryon_sessions WHERE site_id=${SITE_ID};
       DELETE FROM rate_limits;
       UPDATE sites SET plan_order='scrapy,block,inspect', status='pending' WHERE id=${SITE_ID}`);
  snapshots.selectors_initial = selectorsTable();

  const browser = await chromium.launch();
  try {
    /* ---- a) collection page: Plan B cards + infinite scroll ---- */
    const a = await visitCollection(browser, 'a', { wantAfterScroll: true, shot: '01-collection-initial.png' });
    await a.page.screenshot({ path: path.join(SHOTS, '02-collection-after-scroll.png'), fullPage: true });
    const aEvt = sql(`SELECT id, type, plan, meta FROM events WHERE site_id=${SITE_ID} AND page_type='collection' AND type='inject_ok' ORDER BY id DESC LIMIT 1`)[0];
    check('a1', 'Collection: card icons injected', a.first >= 4 && a.plan === 'block', a.plan,
      `${a.first} icons; log "${a.logs.find(l => l.includes('zone cards → injected')) || 'none'}"; event #${aEvt && aEvt.id} ${aEvt && aEvt.type}/${aEvt && aEvt.plan} ${aEvt && aEvt.meta}`);
    check('a2', 'Collection: more icons after infinite scroll (observer)', a.after >= 8 && a.after > a.first, a.plan,
      `${a.first} → ${a.after} card icons after the 2.5 s append`);
    await a.ctx.close();

    /* ---- b) product page: button after ADD TO BAG + main image icon, after late render ---- */
    const b = await visitProduct(browser, 'b', { shot: '03-product-button-icon.png' });
    const bRetries = b.logs.filter(l => l.includes('zone product plan') && l.includes('found nothing')).length;
    const bEvt = sql(`SELECT id, type, plan, meta FROM events WHERE site_id=${SITE_ID} AND page_type='product' AND type='inject_ok' ORDER BY id DESC LIMIT 1`)[0];
    check('b1', 'Product: Try-On button directly after "ADD TO BAG"',
      b.layout.prevText === 'ADD TO BAG' && b.plan === 'block', b.plan,
      `previous sibling = ${b.layout.prevTag} "${b.layout.prevText}"; ${bRetries} empty plan attempts before the 1.2 s render; event #${bEvt && bEvt.id} ${bEvt && bEvt.type}/${bEvt && bEvt.plan} ${bEvt && bEvt.meta}`);
    check('b2', 'Product: icon on main image', b.layout.iconInMedia, b.plan, `.vto-icon.vto-main inside .media`);

    /* ---- c) try-on: upload photo → Generate my look → result ---- */
    await b.page.click('.vto-btn[data-vto="product"]');
    await b.page.locator('[data-vto="modal"] input[type=file]').setInputFiles(PHOTO);
    await b.page.locator('[data-vto="modal"] .go').click();
    const resImg = b.page.locator('[data-vto="modal"] .res img');
    await resImg.waitFor({ timeout: 60000 }).catch(() => {});
    const resultSrc = await resImg.getAttribute('src').catch(() => null);
    const loaded = resultSrc ? await resImg.evaluate(im => im.complete && im.naturalWidth > 0).catch(() => false) : false;
    const errText = resultSrc ? '' : await b.page.locator('[data-vto="modal"] .res').innerText().catch(() => '');
    await sleep(300);
    await b.page.screenshot({ path: path.join(SHOTS, '04-tryon-modal-result.png') });
    const tr = sql(`SELECT id, provider, status, trigger_from, plan_used, duration_ms, result_image FROM tryon_sessions WHERE site_id=${SITE_ID} ORDER BY id DESC LIMIT 1`)[0];
    check('c', 'Try-on: upload → Generate my look → result image', loaded && tr && tr.status === 'done', tr && tr.plan_used,
      resultSrc ? `result ${resultSrc}; tryon_sessions #${tr.id} ${tr.provider}/${tr.status}/${tr.trigger_from}/${tr.plan_used} ${tr.duration_ms} ms` : `no result: ${errText}`);
    snapshots.tryon = tr;
    await b.ctx.close();

    /* ---- d) plan_order inspect first → Plan C injects the product page ---- */
    sql(`UPDATE sites SET plan_order='inspect,block,scrapy' WHERE id=${SITE_ID}`);
    const d = await visitProduct(browser, 'd', { shot: '05-product-plan-c.png' });
    const dEvt = sql(`SELECT id, type, plan, meta FROM events WHERE site_id=${SITE_ID} AND page_type='product' AND type='inject_ok' ORDER BY id DESC LIMIT 1`)[0];
    check('d', 'plan_order=inspect,block,scrapy → Plan C injects product page',
      d.plan === 'inspect' && d.layout.prevText === 'ADD TO BAG' && d.layout.iconInMedia, d.plan,
      `log "${d.logs.find(l => l.includes('zone product → injected')) || 'none'}"; event #${dEvt && dEvt.id} ${dEvt && dEvt.type}/${dEvt && dEvt.plan}`);
    await d.ctx.close();
    sql(`UPDATE sites SET plan_order='scrapy,block,inspect' WHERE id=${SITE_ID}`);

    /* ---- e) self-learning: 3 more visits → active → Plan A wins ---- */
    snapshots.selectors_before_learning = selectorsTable();
    const visits = [];
    for (let i = 1; i <= 3; i++) {
      const c = await visitCollection(browser, `e${i}-collection`); await c.ctx.close();
      const p = await visitProduct(browser, `e${i}-product`); await p.ctx.close();
      const st = selectorsTable().map(s => `${s.target}:${s.status}/${s.hits}`).join(' ');
      visits.push({ visit: i, collection: c.plan, product: p.plan, selectors: st });
    }
    snapshots.selectors_after_learning = selectorsTable();
    const learned = snapshots.selectors_after_learning.filter(s => s.source !== 'manual');
    const allActive = learned.length > 0 && learned.every(s => s.status === 'active');
    const c4 = await visitCollection(browser, 'e4-collection', { shot: '06-collection-plan-a.png' }); await c4.ctx.close();
    const p4 = await visitProduct(browser, 'e4-product', { shot: '07-product-plan-a.png' }); await p4.ctx.close();
    visits.push({ visit: 4, collection: c4.plan, product: p4.plan });
    snapshots.learning_visits = visits;
    check('e1', 'Learned selectors pending → active', allActive, 'block/inspect',
      learned.map(s => `#${s.id} ${s.page_type}.${s.target}="${s.selector}" ${s.source} hits=${s.hits} ${s.status}`).join('; '));
    check('e2', 'Next visit: Plan A (scrapy) wins on both pages', c4.plan === 'scrapy' && p4.plan === 'scrapy', 'scrapy',
      `visit plans ${visits.map(v => `#${v.visit}: cards=${v.collection} product=${v.product}`).join(' | ')}`);

    /* ---- f) Scrapy scan via queue + worker.py --once ---- */
    sql(`INSERT INTO scans (site_id, start_url, status) VALUES (${SITE_ID}, '${BASE}/demo/index.html', 'queued')`);
    const scanId = sql(`SELECT MAX(id) AS id FROM scans WHERE site_id=${SITE_ID}`)[0].id;
    let workerOut = '';
    try {
      workerOut = execFileSync(process.env.VTO_PYTHON || 'python', ['worker.py', '--once'],
        { cwd: path.join(ROOT, 'vto', 'scraper'), encoding: 'utf8', timeout: 300000 });
    } catch (e) { workerOut = (e.stdout || '') + (e.stderr || '') + e.message; }
    const scan = sql(`SELECT id, status, pages_crawled, selectors_found, started_at, finished_at, log FROM scans WHERE id=${scanId}`)[0];
    snapshots.scan = scan;
    snapshots.worker_output = workerOut;
    snapshots.selectors_after_scan = selectorsTable();
    const scrapySeen = snapshots.selectors_after_scan.filter(s => s.page_type === 'collection');
    check('f', 'Scan queued → worker.py --once → done, selectors saved', scan.status === 'done' && +scan.selectors_found > 0, 'scrapy',
      `scan #${scan.id} ${scan.status} pages=${scan.pages_crawled} selectors=${scan.selectors_found}; ${scrapySeen.map(s => `${s.target}="${s.selector}" ${s.status} conf=${s.confidence}`).join(', ')}`);

    /* ---- g) admin: login + every page 200, no PHP warnings ---- */
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/admin/login.php');
    await page.fill('input[name=email]', ADMIN.email);
    await page.fill('input[name=password]', ADMIN.password);
    await Promise.all([page.waitForNavigation(), page.click('button.btn')]);
    const loggedIn = page.url().includes('/admin/index.php');
    const pages = ['index.php', 'sites.php', `site.php?id=${SITE_ID}`, 'scans.php', `scans.php?id=${scanId}`,
                   'tryons.php', 'events.php', `events.php?export=csv`, 'admins.php'];
    const pageRes = [];
    for (const p of pages) {
      const r = await page.request.get(`${BASE}/admin/${p}`);
      const body = await r.text();
      const warn = /(Warning|Notice|Deprecated|Fatal error|Parse error|Uncaught)\b[^<]{0,120}/i.exec(body);
      pageRes.push({ page: p, status: r.status(), warning: warn ? warn[0] : null });
    }
    await page.goto(BASE + '/admin/index.php'); await page.screenshot({ path: path.join(SHOTS, '08-admin-dashboard.png'), fullPage: true });
    await page.goto(`${BASE}/admin/site.php?id=${SITE_ID}`); await page.screenshot({ path: path.join(SHOTS, '09-admin-site-detail.png'), fullPage: true });
    await page.goto(`${BASE}/admin/scans.php?id=${scanId}`); await page.screenshot({ path: path.join(SHOTS, '10-admin-scan-log.png'), fullPage: true });
    await page.goto(`${BASE}/admin/tryons.php`); await page.screenshot({ path: path.join(SHOTS, '11-admin-tryons.png'), fullPage: true });
    await ctx.close();

    let logWarnings = [];
    if (process.env.SERVER_LOG && fs.existsSync(process.env.SERVER_LOG)) {
      logWarnings = fs.readFileSync(process.env.SERVER_LOG, 'utf8').split(/\r?\n/)
        .filter(l => /PHP (Warning|Notice|Deprecated|Fatal|Parse)/.test(l));
    }
    const badPages = pageRes.filter(p => p.status !== 200 || p.warning);
    check('g', 'Admin: login + all pages 200, no PHP warnings', loggedIn && !badPages.length && !logWarnings.length, '-',
      `${pageRes.map(p => `${p.page}=${p.status}`).join(' ')}` +
      (badPages.length ? ` | BAD: ${JSON.stringify(badPages)}` : '') +
      (process.env.SERVER_LOG ? ` | server log PHP warnings: ${logWarnings.length}` : ' | server log not checked'));
    snapshots.admin_pages = pageRes;
    snapshots.server_log_warnings = logWarnings;
  } catch (err) {
    check('x', 'unexpected error', false, '-', err.stack || String(err));
  } finally {
    await browser.close();
    snapshots.events_tail = lastEvents(12);
    fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ results, snapshots }, null, 2));
    fs.writeFileSync(path.join(__dirname, 'console.log'), consoleLines.join('\n') + '\n');
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed → tests/results.json, tests/console.log, tests/screenshots/`);
    process.exit(failed ? 1 : 0);
  }
})();
