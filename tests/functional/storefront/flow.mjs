// Storefront shopper flow against the REAL widget code + local replica (AI MOCKED). Synthetic data only.
// Usage: node server.mjs &  then  node flow.mjs <outDir>
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { launch } from './cdp.mjs';
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const PERSON = path.resolve(HERE, '..', '..', 'performance', 'fixtures', 'person.jpg');
const NOTIMG = path.resolve(HERE, '..', '..', 'performance', 'fixtures', 'not-an-image.txt');
const OUT = process.argv[2] || 'flow-out'; fs.mkdirSync(OUT, { recursive: true });
const b = await launch({ width: 1100, height: 900 });
const steps = [];
const vis = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!e&&e.offsetParent!==null&&getComputedStyle(e).display!=='none'})()`;
async function waitFor(expr, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await b.eval(expr)) return true; } catch {} await b.sleep(300); } return false; }
async function step(name, fn) {
  let ok = false, note = '';
  try { const r = await fn(); ok = r === true || (r && r.ok); note = (r && r.note) || ''; } catch (e) { note = 'ERR ' + e.message.slice(0, 160); }
  await b.shot(path.join(OUT, `${String(steps.length + 1).padStart(2, '0')}-${name.replace(/\W+/g, '_')}.png`));
  steps.push({ step: name, result: ok ? 'PASS' : 'FAIL', note }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (note ? '  — ' + note : ''));
}
async function setFile(sel, file) {
  const { root } = await b.send('DOM.getDocument'); const { nodeId } = await b.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
  await b.send('DOM.setFileInputFiles', { nodeId, files: [file] });
}
await b.goto('http://localhost:5190/');
await step('widget button visible', async () => await waitFor(vis('#tryfit-open-btn'), 10000));
await step('open modal -> consent step', async () => { await b.eval(`document.querySelector('#tryfit-open-btn').click()`); return await waitFor(vis('#tryfit-step-privacy'), 5000); });
await step('accept consent -> upload step', async () => { await b.eval(`document.querySelector('#tryfit-accept-privacy').click()`); return await waitFor(vis('#tryfit-step-upload'), 5000); });
await step('reject non-image upload', async () => {
  await setFile('#tryfit-file-input', NOTIMG); await b.sleep(1500);
  const proc = await b.eval(vis('#tryfit-step-processing'));
  const msg = await b.eval(`(()=>{const e=[...document.querySelectorAll('.tryfit-step')].find(x=>x.offsetParent!==null&&getComputedStyle(x).display!=='none');return e?(e.innerText||'').replace(/\s+/g,' ').slice(0,90):''})()`);
  return { ok: !proc && /image file|JPEG|PNG/i.test(msg), note: `processing started=${proc}; shown: "${msg}"` };
});
const t0 = Date.now();
await step('valid upload -> processing', async () => { await setFile('#tryfit-file-input', PERSON); return await waitFor(vis('#tryfit-step-processing'), 15000); });
await step('processing -> result (mock GPU ~14s+)', async () => {
  const ok = await waitFor(vis('#tryfit-step-result'), 120000);
  return { ok, note: `${((Date.now() - t0) / 1000).toFixed(1)} s from upload` + (ok ? '' : ' (timeout)') };
});
await step('result image loaded', async () => {
  const r = await b.eval(`(()=>{const i=document.querySelector('#tryfit-result-img');return i?{src:(i.src||'').slice(0,60),w:i.naturalWidth,h:i.naturalHeight}:null})()`);
  return { ok: !!r && r.w > 0, note: JSON.stringify(r) };
});
await step('lead gate shown', async () => ({ ok: await b.eval(vis('#tryfit-lead-email')) || await b.eval(vis('#tryfit-lead-submit')), note: 'lead form (email field or submit) visible' }));
await step('lead submit w/ invalid email rejected', async () => {
  if (!(await b.eval(vis('#tryfit-lead-email')))) return { ok: false, note: 'no email field' };
  await b.eval(`(()=>{const e=document.querySelector('#tryfit-lead-email');e.value='not-an-email';e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#tryfit-lead-submit').click()})()`);
  await b.sleep(1200);
  return { ok: await b.eval(vis('#tryfit-lead-email')), note: 'form still shown after invalid email' };
});
await step('lead submit without consent is blocked', async () => {
  await b.eval(`(()=>{const e=document.querySelector('#tryfit-lead-email');e.value='qa-synthetic@example.invalid';e.dispatchEvent(new Event('input',{bubbles:true}));const p=document.querySelector('#tryfit-lead-phone');p.value='9000000000';p.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#tryfit-lead-submit').click()})()`);
  await b.sleep(1000);
  const err = await b.eval(`(document.querySelector('#tryfit-lead-error')||{}).innerText||''`);
  return { ok: /agree/i.test(err) && await b.eval(vis('#tryfit-lead-submit')), note: 'message: "' + err.slice(0, 70) + '"' };
});
await step('lead submit with consent unlocks look', async () => {
  await b.eval(`document.querySelector('#tryfit-lead-consent').click();document.querySelector('#tryfit-lead-submit').click()`);
  let posted = ''; for (let i = 0; i < 40 && !posted; i++) { await b.sleep(250); posted = b.log.responses.filter((r) => r.includes('/api/lead/capture')).join(' | '); }
  const ok = await waitFor(vis('[data-tryfit-action="add-cart"]'), 8000);
  return { ok: ok && /^200/.test(posted), note: 'lead capture response: ' + (posted || 'none') };
});
await b.eval(`window.__opened=[];window.open=function(u){if(u)window.__opened.push(String(u));const w={closed:false,focus(){},close(){},document:{write(){},close(){}}};let h='';Object.defineProperty(w,'location',{get(){return {set href(v){window.__opened.push(String(v))}}}});return w};window.__dl=[];const oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)window.__dl.push(this.download);else oc.call(this)}`);
const lastCart = async () => (await (await fetch('http://localhost:5190/__last_cart')).json());
await step('save image triggers a download', async () => {
  await b.eval(`document.querySelector('[data-tryfit-action="save-img"]').click()`);
  for (let i = 0; i < 40 && !(await b.eval('window.__dl.length')); i++) await b.sleep(400);
  const d = await b.eval('window.__dl'); const fb = await b.eval('window.__opened'); return { ok: d.length > 0, note: 'real downloads=' + d.length + '; fallback window.open(s) of image=' + fb.filter((u) => /results\//.test(u)).length + ' (result image has no CORS header, so fetch->blob download fails)' };
});
await step('share on WhatsApp opens wa.me link', async () => {
  await b.eval(`document.querySelector('[data-tryfit-action="share-wa"]').click()`); await b.sleep(1500);
  const o = await b.eval('window.__opened'); const w = o.find((u) => u.startsWith('https://wa.me/')); return { ok: !!w, note: (w || 'no wa.me link; opened: ' + o.join(' , ')).slice(0, 150) };
});
const FINAL = process.argv[3] || 'cart';
if (FINAL === 'buy') {
await step('buy now posts to cart (mock); checkout nav not followed', async () => {
  const t1 = Date.now(); await b.eval(`document.querySelector('[data-tryfit-action="buy-now"]').click()`); await b.sleep(2000);
  const last = await lastCart(); return { ok: !!last && last.t >= t1 && /1001/.test(last.body), note: 'fresh cart post: ' + JSON.stringify(last).slice(0, 110) + '; /checkout is a stub host' };
});
} else {
await step('add to cart sends correct variant (mock cart)', async () => {
  await b.eval(`document.querySelector('[data-tryfit-action="add-cart"]').click()`); await b.sleep(1500);
  const last = await lastCart(); return { ok: !!last && /1001/.test(last.body), note: JSON.stringify(last).slice(0, 160) };
});
}
const actions = [];
console.log('\nhosts contacted:', [...b.log.hosts].join(', '));
console.log('api responses:', b.log.responses.filter((r) => r.includes('/apps/tryfit')).join(' | '));
console.log('console errors:', b.log.console.filter((c) => /error|exception/i.test(c)).slice(0, 8));
fs.writeFileSync(path.join(OUT, 'flow.json'), JSON.stringify({ when: new Date().toISOString(), steps, hosts: [...b.log.hosts], apiResponses: b.log.responses.filter((r) => r.includes('/apps/tryfit')), actions, consoleErrors: b.log.console.filter((c) => /error|exception/i.test(c)) }, null, 1));
b.close();
