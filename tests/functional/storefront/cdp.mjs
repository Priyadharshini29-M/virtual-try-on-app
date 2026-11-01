// Minimal Chrome DevTools Protocol driver (Node built-in WebSocket; no dependencies).
// Chrome is started with every non-localhost host unresolvable, so nothing can reach the live site.
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export async function launch({ port = 9333, width = 1280, height = 900 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    `--window-size=${width},${height}`, '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 50; i++) {
    try { const t = await (await fetch(`http://localhost:${port}/json`)).json(); ws = t.find((x) => x.type === 'page')?.webSocketDebuggerUrl; if (ws) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ws) { proc.kill(); throw new Error('chrome did not start'); }
  const sock = new WebSocket(ws); await new Promise((r) => (sock.onopen = r));
  let id = 0; const pend = new Map(); const handlers = [];
  sock.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { const { res, rej } = pend.get(d.id); pend.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
    else handlers.forEach((h) => h(d));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params })); });
  const log = { console: [], hosts: new Set(), failed: [], responses: [] };
  handlers.push((d) => {
    if (d.method === 'Runtime.consoleAPICalled') log.console.push(`[${d.params.type}] ` + d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 220));
    if (d.method === 'Runtime.exceptionThrown') log.console.push('[exception] ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 220));
    if (d.method === 'Network.requestWillBeSent') { try { log.hosts.add(new URL(d.params.request.url).host); } catch {} }
    if (d.method === 'Network.loadingFailed') log.failed.push(d.params.errorText);
    if (d.method === 'Network.responseReceived') log.responses.push(`${d.params.response.status} ${d.params.response.url.slice(0, 110)}`);
  });
  for (const m of ['Page.enable', 'Runtime.enable', 'Network.enable']) await send(m);
  return {
    log, send,
    goto: async (u) => { await send('Page.navigate', { url: u }); await new Promise((r) => setTimeout(r, 2500)); },
    eval: async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error'); return r.result.value; },
    shot: async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    close: () => { try { sock.close(); } catch {} proc.kill(); },
  };
}
