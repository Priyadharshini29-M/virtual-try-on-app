/**
 * FitFyce ⇄ platform admin integration test (stores, wallets, wallet rules, VTO billing).
 *
 *   node tests/platform.e2e.js      needs: VTO on :8080 (start-local), local FitFyce on :8000 (XAMPP DB tryon_app)
 *
 * NOTE: runs against the LOCAL FitFyce database. It adds test ledger rows (a +5/-5 grant pair, a +1/-1 pair
 * and one VTO try-on charge that is then given back) and resets the wallet rules to the built-in defaults at the end.
 */
'use strict';
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VTO = 'http://localhost:8080';
const FF = process.env.FITFYCE_URL || 'http://localhost:8000';
const KEY = '4849b03972e29146903ee6f7f8e261420d749cc7';
const SHOP = 'fitfyce.myshopify.com';
const SHOTS = path.join(__dirname, 'screenshots');
const PHOTO = path.join(__dirname, 'fixtures', 'person.jpg');
const vtoSql = q => tsv(execFileSync('C:\\vto-runtime\\mariadb\\bin\\mariadb.exe', ['-uvto_user', '-pvto_local_pass', '-h127.0.0.1', '-P3307', 'vto_platform', '-B', '-e', q], { encoding: 'utf8' }));
const ffSql = q => tsv(execFileSync('C:\\xampp\\mysql\\bin\\mysql.exe', ['-uroot', 'tryon_app', '-B', '-e', q], { encoding: 'utf8' }));
const curl = args => execFileSync('curl', ['-s', ...args], { encoding: 'utf8' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
function tsv(out) {
  const l = out.split(/\r?\n/).filter(Boolean); if (!l.length) return [];
  const c = l[0].split('\t');
  return l.slice(1).map(r => Object.fromEntries(r.split('\t').map((v, i) => [c[i], v === 'NULL' ? null : v])));
}
async function waitFor(fn, ms = 5000) {           // returns elapsed ms, or null on timeout
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(50); }
  return null;
}
const results = [];
function check(id, name, pass, evidence) { results.push({ id, name, pass: !!pass, evidence }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}  ${evidence}`); }
const merchantId = () => +ffSql(`SELECT id FROM merchants WHERE shopify_domain='${SHOP}'`)[0].id;
const vtoStore = id => vtoSql(`SELECT * FROM stores WHERE id=${id}`)[0];
function tryon() {
  return JSON.parse(curl(['-H', `Origin: ${VTO}`, '-F', `photo=@${PHOTO}`, '-F', 'product_image=http://127.0.0.1:8081/demo/img/kurta-main-blue.jpg',
    '-F', 'trigger=product_button', '-F', 'plan=block', `${VTO}/backend/api/tryon.php?key=${KEY}`]));
}

(async () => {
  const browser = await chromium.launch();
  const admin = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  try {
    vtoSql(`DELETE FROM rate_limits; UPDATE sites SET fitfyce_shop='${SHOP}' WHERE id=1`);
    const mid = merchantId();

    /* P1 – nothing gets in without the shared secret */
    const ts = Math.floor(Date.now() / 1000).toString();
    const forged = crypto.createHmac('sha256', 'wrong-secret').update(`${ts}\nGET\n/platform/stores\n`).digest('hex');
    const c1 = curl(['-o', 'NUL', '-w', '%{http_code}', `${FF}/platform/stores`]);
    const c2 = curl(['-o', 'NUL', '-w', '%{http_code}', '-H', `X-Platform-Timestamp: ${ts}`, '-H', `X-Platform-Signature: ${forged}`, `${FF}/platform/stores`]);
    const c3 = curl(['-o', 'NUL', '-w', '%{http_code}', '-X', 'POST', '-d', '{"event":"store.updated","data":{"store":{"id":999,"shop_domain":"evil.myshopify.com"}}}', `${VTO}/backend/api/platform.php`]);
    check('P1', 'Unsigned / forged platform calls rejected', c1 === '401' && c2 === '401' && c3 === '401', `FitFyce /platform/stores unsigned=${c1} forged=${c2}; VTO platform.php unsigned=${c3}`);

    /* admin login */
    await admin.goto(VTO + '/admin/login.php');
    await admin.fill('input[name=email]', 'admin@test.local'); await admin.fill('input[name=password]', 'Admin@123456');
    await Promise.all([admin.waitForNavigation(), admin.click('button.btn')]);

    /* P2 – Sync now copies every FitFyce store and ledger row */
    await admin.goto(VTO + '/admin/stores.php');
    await Promise.all([admin.waitForNavigation(), admin.click('form:has(input[value=sync]) button')]);
    const flash = await admin.locator('.flash').first().innerText();
    const ffStores = +ffSql('SELECT COUNT(*) n FROM merchants')[0].n, vStores = +vtoSql('SELECT COUNT(*) n FROM stores')[0].n;
    const ffTx = +ffSql('SELECT COUNT(*) n FROM credit_transactions')[0].n, vTx = +vtoSql('SELECT COUNT(*) n FROM wallet_ledger')[0].n;
    const balOk = ffSql('SELECT id, wallet_credits FROM merchants').every(m => +vtoStore(m.id).wallet_credits === +m.wallet_credits);
    check('P2', 'Sync now: all stores + ledger + balances match FitFyce', ffStores === vStores && ffTx === vTx && balOk, `"${flash}" stores ${vStores}/${ffStores}, ledger ${vTx}/${ffTx}, balances equal=${balOk}`);
    await admin.screenshot({ path: path.join(SHOTS, '20-admin-stores.png'), fullPage: true });

    /* P3 – merchant logs in to the app → store row updated immediately */
    vtoSql(`UPDATE stores SET last_event='sync' WHERE id=${mid}`);
    const merchant = await (await browser.newContext()).newPage();
    const t3 = Date.now();
    await merchant.goto(`${FF}/auth/dev-login?shop=${SHOP}`);
    const loginMs = await waitFor(() => vtoStore(mid).last_event === 'login');
    const s3 = vtoStore(mid);
    check('P3', 'Merchant login reaches the admin panel', loginMs !== null, `store #${mid} last_event=${s3.last_event} last_login_at=${s3.last_login_at}; visible ${loginMs} ms after login (page load ${Date.now() - t3} ms total)`);

    /* P4 – wallet credited in FitFyce (same path as a Razorpay top-up) → admin immediately */
    const before = +vtoStore(mid).wallet_credits;
    const t4 = Date.now();
    execFileSync('C:\\xampp\\php\\php.exe', [path.join(__dirname, 'fitfyce-wallet.php'), String(mid), '5', 'integration test grant']);
    const ms4 = await waitFor(() => +vtoStore(mid).wallet_credits === before + 5);
    const lastTx = vtoSql(`SELECT id, delta, reason, balance_after, note FROM wallet_ledger WHERE store_id=${mid} ORDER BY id DESC LIMIT 1`)[0];
    check('P4', 'Wallet credit in FitFyce shows in admin immediately', ms4 !== null && lastTx.reason === 'admin_grant', `balance ${before} → ${vtoStore(mid).wallet_credits} in ${ms4} ms after the credit (script incl.: ${Date.now() - t4} ms); ledger #${lastTx.id} ${lastTx.delta} ${lastTx.reason} "${lastTx.note}"`);
    execFileSync('C:\\xampp\\php\\php.exe', [path.join(__dirname, 'fitfyce-wallet.php'), String(mid), '-5', 'integration test grant reversed']);
    await waitFor(() => +vtoStore(mid).wallet_credits === before);

    /* P5 – live admin page refreshes itself when FitFyce pushes */
    await admin.goto(`${VTO}/admin/store.php?id=${mid}`);
    await sleep(2500);                                                    // let the page take its first fingerprint
    execFileSync('C:\\xampp\\php\\php.exe', [path.join(__dirname, 'fitfyce-wallet.php'), String(mid), '1', 'live page test']);
    const ms5 = await waitFor(async () => (await admin.locator('.kpi b').first().innerText().catch(() => '')) === String(before + 1), 6000);
    await admin.screenshot({ path: path.join(SHOTS, '21-admin-store-detail.png'), fullPage: true });
    check('P5', 'Open admin page updates by itself (no manual refresh)', ms5 !== null, `store page showed balance ${before + 1} ${ms5} ms after the credit`);
    execFileSync('C:\\xampp\\php\\php.exe', [path.join(__dirname, 'fitfyce-wallet.php'), String(mid), '-1', 'live page test reversed']);
    await waitFor(() => +vtoStore(mid).wallet_credits === before);

    /* P6 – wallet rules saved in admin → FitFyce app uses them on the next request */
    await admin.goto(VTO + '/admin/wallet.php');
    const growthRow = admin.locator('tr:has(input[value="growth"])');
    await growthRow.locator('input[name$="[price]"]').fill('1799.00');
    await admin.fill('input[name="costs[tryon]"]', '2');
    const t6 = Date.now();
    await Promise.all([admin.waitForNavigation(), admin.click('button:has-text("Save wallet rules")')]);
    const flash6 = await admin.locator('.flash').first().innerText();
    await admin.screenshot({ path: path.join(SHOTS, '22-admin-wallet-rules.png'), fullPage: true });
    await merchant.goto(`${FF}/admin/wallet`);
    const appMs = Date.now() - t6;
    const html = await merchant.content();
    const ffRow = ffSql("SELECT value_json, updated_by FROM platform_settings WHERE setting_key='wallet.costs'")[0];
    check('P6', 'Wallet rules from admin are live in the FitFyce app', /1,?799/.test(html) && /"tryon":2/.test(ffRow.value_json),
      `"${flash6}"; FitFyce DB costs=${ffRow.value_json} by ${ffRow.updated_by}; merchant Credits page shows ₹1,799 Growth pack (${appMs} ms from Save to page rendered)`);
    await merchant.screenshot({ path: path.join(SHOTS, '23-fitfyce-credits-page.png'), fullPage: true });

    /* P7 – VTO website try-on is charged to the linked store at the new cost */
    const b7 = +ffSql(`SELECT wallet_credits b FROM merchants WHERE id=${mid}`)[0].b;
    const r7 = tryon();
    const ffTx7 = ffSql(`SELECT id, delta, reason, reference_type, reference_id FROM credit_transactions WHERE merchant_id=${mid} ORDER BY id DESC LIMIT 1`)[0];
    const sess = vtoSql(`SELECT id, status, credits_charged FROM tryon_sessions ORDER BY id DESC LIMIT 1`)[0];
    const mirror = vtoStore(mid);
    check('P7', 'VTO try-on debits the linked FitFyce wallet', r7.ok && +ffTx7.delta === -2 && ffTx7.reference_id === `vto-${sess.id}` && +mirror.wallet_credits === b7 - 2,
      `tryon #${sess.id} ${sess.status} credits_charged=${sess.credits_charged}; FitFyce ledger #${ffTx7.id} ${ffTx7.delta} ${ffTx7.reason} ${ffTx7.reference_type}/${ffTx7.reference_id}; admin balance ${b7} → ${mirror.wallet_credits}`);

    /* P8 – out of credits → shopper gets a neutral message, nothing is debited */
    await admin.goto(VTO + '/admin/wallet.php');
    await admin.fill('input[name="costs[tryon]"]', '1000');
    await Promise.all([admin.waitForNavigation(), admin.click('button:has-text("Save wallet rules")')]);
    const b8 = +ffSql(`SELECT wallet_credits b FROM merchants WHERE id=${mid}`)[0].b;
    const r8 = tryon();
    const a8 = +ffSql(`SELECT wallet_credits b FROM merchants WHERE id=${mid}`)[0].b;
    check('P8', 'Not enough credits: try-on refused, wallet untouched', !r8.ok && /not available/.test(r8.error) && a8 === b8, `shopper sees "${r8.error}"; balance ${b8} → ${a8}`);

    /* give the test charge back and restore the built-in wallet rules */
    execFileSync('C:\\xampp\\php\\php.exe', [path.join(__dirname, 'fitfyce-wallet.php'), String(mid), '2', 'integration test: refund VTO test try-on']);
    ffSql("DELETE FROM platform_settings WHERE setting_key LIKE 'wallet.%'");
    await admin.goto(VTO + '/admin/wallet.php');
    const restored = await admin.locator('input[name="costs[tryon]"]').inputValue();
    check('P9', 'Wallet rules reset to defaults after the test', restored === '1', `admin shows try-on cost ${restored} (FitFyce constants)`);

    /* P10 – new admin pages render cleanly */
    const pages = ['stores.php', `store.php?id=${mid}`, 'wallet.php', 'site.php?id=1', 'index.php', 'live.php'];
    const bad = [];
    for (const p of pages) {
      const r = await admin.request.get(`${VTO}/admin/${p}`); const body = await r.text();
      if (r.status() !== 200 || /(Warning|Notice|Deprecated|Fatal error|Uncaught)\b/.test(body)) bad.push(`${p}=${r.status()}`);
    }
    check('P10', 'Admin pages 200, no PHP warnings', !bad.length, bad.length ? bad.join(' ') : pages.map(p => p + '=200').join(' '));
  } catch (e) {
    check('X', 'unexpected error', false, e.stack || String(e));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(__dirname, 'platform-results.json'), JSON.stringify(results, null, 2));
    const failed = results.filter(r => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed → tests/platform-results.json`);
    process.exit(failed ? 1 : 0);
  }
})();
