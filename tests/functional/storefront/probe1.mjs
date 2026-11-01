import { launch } from './cdp.mjs';
const out = process.argv[2];
const b = await launch();
await b.goto('http://localhost:5190/');
await b.sleep(2000);
console.log(JSON.stringify(await b.eval(`({
  booted: !!(window.TryFit && window.TryFit._booted),
  buttons: [...document.querySelectorAll('button,[role=button],a')].map(e=>({tag:e.tagName,id:e.id,cls:e.className&&String(e.className).slice(0,60),txt:(e.innerText||'').trim().slice(0,30),vis:e.offsetParent!==null})).filter(x=>/tryfit|try/i.test(x.id+x.cls+x.txt)).slice(0,15)
})`), null, 1));
console.log('hosts:', [...b.log.hosts]);
console.log('failed:', b.log.failed.length, '| responses:', b.log.responses.slice(0, 8));
console.log('console:', b.log.console.slice(0, 15));
await b.shot(out); b.close();
