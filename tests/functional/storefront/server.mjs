// Local storefront harness: serves a stub product page + the REAL widget assets from the extension.
// Widget API base is http://localhost:8080 (local replica). No Shopify, no live host.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const EXT = path.join(REPO, 'fitfyce-shopify', 'extensions', 'tryon-widget');
const FIX = path.join(REPO, 'tests', 'performance', 'fixtures');
const API = process.env.API_BASE || 'http://localhost:8080';
const SHOP = process.env.SHOP || 'perf-test.myshopify.com';
const modal = fs.readFileSync(path.join(EXT, 'snippets', 'tryon-modal.liquid'), 'utf8')
  .replace(/\{%-?[\s\S]*?-?%\}/g, '').replace(/\{\{-?[\s\S]*?-?\}\}/g, '');
const img = 'http://localhost:5190/garment.jpg';
// the replica runs in Docker and cannot reach the host's localhost, so the product image the widget forwards to the API is a data URI
const dataImg = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(FIX, 'garment.jpg')).toString('base64');
const variants = JSON.stringify([{ id: 1001, title: 'M', option1: 'M', price: 249900, available: true }, { id: 1002, title: 'L', option1: 'L', price: 249900, available: true }]);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Synthetic Product</title><link rel="stylesheet" href="/tryon-modal.css"></head>
<body style="font-family:sans-serif;max-width:900px;margin:20px auto">
<h1>Cotton T-Shirt (synthetic)</h1><img src="${img}" width="300"><p>Rs. 2,499.00</p>
<form action="/cart/add" method="post"><input name="id" value="1001"><button type="submit" id="atc">Add to cart</button></form>
<div id="tryfit-embed-root" data-proxy-url="http://localhost:5190/apps/tryfit" data-shop="${SHOP}" data-currency="INR" data-widget-id="harness"
 data-page-type="product" data-product-id="1" data-product-title="Cotton T-Shirt" data-product-handle="cotton-t-shirt"
 data-storefront-url="/products/cotton-t-shirt" data-product-tryon="true" data-variants="${esc(variants)}" data-options="[]"
 data-clothing-images="{}" data-product-images="${esc(JSON.stringify([{ src: dataImg }]))}" data-featured-image="${dataImg}"
 data-selected-variant-id="1001" style="display:none"></div>
${modal}
<script src="/tryon-widget.js"></script></body></html>`;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.html': 'text/html' };
http.createServer((q, s) => {
  const p = new URL(q.url, 'http://x').pathname;
  if (p.startsWith('/apps/tryfit/')) {  // same-origin app-proxy stand-in: forward to the local replica
    const chunks = []; q.on('data', (c) => chunks.push(c));
    q.on('end', () => {
      const t = new URL(API); const body = Buffer.concat(chunks);
      const h = { ...q.headers, host: t.host }; delete h.origin; delete h.referer; if (body.length) h['content-length'] = body.length;
      const pr = http.request({ host: t.hostname, port: t.port, method: q.method, path: q.url.replace('/apps/tryfit', ''), headers: h }, (r) => { s.writeHead(r.statusCode, r.headers); r.pipe(s); });
      pr.on('error', () => { s.writeHead(502); s.end('proxy error'); }); pr.end(body);
    });
    return;
  }
  // MOCKED Shopify storefront cart (no real cart/checkout exists here); records what the widget posts
  if (p === '/cart/add.js' && q.method === 'POST') { const c = []; q.on('data', (d) => c.push(d)); q.on('end', () => { globalThis.lastCart = { t: Date.now(), ct: q.headers['content-type'], body: Buffer.concat(c).toString().slice(0, 600) }; s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(JSON.stringify({ id: 1001, quantity: 1, title: 'Cotton T-Shirt' })); }); return; }
  if (p === '/cart.js') { s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify({ item_count: 1, items: [] })); }
  if (p === '/__last_cart') { s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify(globalThis.lastCart || null)); }
  const send = (f) => { try { const b = fs.readFileSync(f); s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' }); s.end(b); } catch { s.writeHead(404); s.end('nf'); } };
  if (p === '/') { s.writeHead(200, { 'Content-Type': 'text/html' }); return s.end(page); }
  if (p === '/tryon-widget.js') return send(path.join(EXT, 'assets', 'tryon-widget.js'));
  if (p === '/tryon-modal.css') return send(path.join(EXT, 'assets', 'tryon-modal.css'));
  if (p === '/garment.jpg') return send(path.join(FIX, 'garment.jpg'));
  if (p === '/person.jpg') return send(path.join(FIX, 'person.jpg'));
  s.writeHead(404); s.end('nf');
}).listen(5190, () => console.log('harness on http://localhost:5190'));
