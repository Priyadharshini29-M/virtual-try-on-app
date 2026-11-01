// Runs fitfyce-shopify/app/lib/shrink-image.client.js (the real file) in headless Chrome against synthetic big images.
// Usage: node server.mjs &   then   node shrink_test.mjs
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { launch } from './cdp.mjs';
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(HERE, '..', '..', '..', 'fitfyce-shopify', 'app', 'lib', 'shrink-image.client.js'), 'utf8')
  .replace(/export\s+async\s+function/, 'async function');
const b = await launch();
await b.goto('http://localhost:5190/');
await b.eval(src + '\nwindow.shrinkImageIfLarge = shrinkImageIfLarge; true');
const result = await b.eval(`(async () => {
  const mk = async (w, h, type, q) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    for (let i = 0; i < 400; i++) { x.fillStyle = 'rgb(' + (i*7%256) + ',' + (i*13%256) + ',' + (i*29%256) + ')'; x.fillRect((i*97)%w, (i*61)%h, w/6, h/6); }
    const img = x.getImageData(0, 0, w, h); for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random()*60)|0; img.data[i]=(img.data[i]+n)&255; img.data[i+1]=(img.data[i+1]+n)&255; }
    x.putImageData(img, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, type, q));
    return new File([blob], 'photo.' + (type === 'image/png' ? 'png' : 'jpg'), { type });
  };
  const dims = async (f) => { const bm = await createImageBitmap(f); const d = bm.width + 'x' + bm.height; bm.close(); return d; };
  const cases = [
    ['6000x4500 JPEG (big)', await mk(6000, 4500, 'image/jpeg', 0.98)],
    ['4000x3000 PNG (big)', await mk(4000, 3000, 'image/png')],
    ['800x1200 JPEG (small)', await mk(800, 1200, 'image/jpeg', 0.9)],
  ];
  const rows = [];
  for (const [label, f] of cases) {
    const out = await window.shrinkImageIfLarge(f);
    rows.push({ label, before: (f.size/1e6).toFixed(2) + ' MB ' + await dims(f), after: (out.size/1e6).toFixed(2) + ' MB ' + await dims(out), type: out.type, untouched: out === f });
  }
  const bad = await window.shrinkImageIfLarge(new File([new Uint8Array([1,2,3])], 'x.jpg', { type: 'image/jpeg' }));
  rows.push({ label: 'undecodable file', untouched: bad.size === 3 });
  return rows;
})()`);
console.table(result);
b.close();
