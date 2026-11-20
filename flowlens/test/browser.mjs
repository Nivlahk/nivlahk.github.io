import puppeteer from 'puppeteer-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((q, r) => { const f = path.join('dist', decodeURIComponent(q.url.split('?')[0]) === '/' ? 'index.html' : q.url.split('?')[0]); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(8765);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
const p = await b.newPage();
await p.setViewport({ width: 1500, height: 900 });
const logs = [];
p.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
p.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
await p.goto('http://localhost:8765/', { waitUntil: 'load' });
const shot = async (name) => { await new Promise((r) => setTimeout(r, 300)); await p.screenshot({ path: `/tmp/shots/${name}.png` }); };
fs.mkdirSync('/tmp/shots', { recursive: true });
const waitSvg = async () => { await p.waitForFunction(() => document.querySelector('#viewport svg') && !document.querySelector('#busy').classList.contains('on'), { timeout: 30000 }); };
try { await waitSvg(); } catch (e) { logs.push('no svg: ' + e.message); }
const steps = (process.argv[2] || 'boot').split(' | ');
for (const s of steps) {
  if (s === 'boot') await shot('boot');
  else if (s.startsWith('click:')) { await p.click(s.slice(6)); await new Promise((r) => setTimeout(r, 200)); try { await waitSvg(); } catch {} }
  else if (s.startsWith('sample:')) { await p.select('#sample', s.slice(7)); await new Promise((r) => setTimeout(r, 300)); try { await waitSvg(); } catch {} }
  else if (s.startsWith('lang:')) { await p.select('#lang', s.slice(5)); await new Promise((r) => setTimeout(r, 400)); try { await waitSvg(); } catch {} }
  else if (s.startsWith('scope:')) { await p.select('#scope', encodeURIComponent(s.slice(6))); await new Promise((r) => setTimeout(r, 300)); try { await waitSvg(); } catch {} }
  else if (s.startsWith('shot:')) await shot(s.slice(5));
  else if (s.startsWith('eval:')) logs.push('EVAL ' + JSON.stringify(await p.evaluate(s.slice(5))));
  else if (s.startsWith('clicknode:')) {
    const pt = await p.evaluate((t) => { const g = [...document.querySelectorAll('#viewport g[data-fl]')].find((g) => g.textContent.includes(t)); if (!g) return null; const r = g.querySelector('.shape').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, s.slice(10));
    if (pt) { await p.mouse.move(pt[0], pt[1]); await new Promise((r) => setTimeout(r, 150)); await p.mouse.down(); await p.mouse.up(); await new Promise((r) => setTimeout(r, 300)); } else logs.push('node not found ' + s);
  }
  else if (s.startsWith('cursor:')) { const [l, c] = s.slice(7).split(':').map(Number); await p.evaluate(() => 0); await p.click('#editor .view-lines'); await p.keyboard.down('Control'); await p.keyboard.press('Home'); await p.keyboard.up('Control'); for (let i = 1; i < l; i++) await p.keyboard.press('ArrowDown'); for (let i = 1; i < c; i++) await p.keyboard.press('ArrowRight'); await new Promise((r) => setTimeout(r, 500)); }
  else if (s.startsWith('type:')) { await p.keyboard.type(s.slice(5)); await new Promise((r) => setTimeout(r, 800)); try { await waitSvg(); } catch {} }
  else if (s.startsWith('dragnode:') || s.startsWith('dragblock:')) {
    const [kind, txt, dx, dy] = s.split(':');
    const pt = await p.evaluate((kind, t) => {
      const els = kind === 'dragnode' ? [...document.querySelectorAll('#viewport g[data-fl]')] : [...document.querySelectorAll('#viewport .blocklbl')];
      const g = els.find((g) => g.textContent.includes(t)); if (!g) return null;
      const r = (g.querySelector('.shape') || g).getBoundingClientRect(); return [r.x + Math.min(r.width / 2, 30), r.y + r.height / 2];
    }, kind, txt);
    if (!pt) { logs.push('not found ' + s); continue; }
    await p.mouse.move(pt[0], pt[1]); await p.mouse.down();
    for (let i = 1; i <= 10; i++) { await p.mouse.move(pt[0] + (+dx * i) / 10, pt[1] + (+dy * i) / 10); await new Promise((r) => setTimeout(r, 20)); }
    await p.mouse.up(); await new Promise((r) => setTimeout(r, 300));
  }
  else if (s.startsWith('blockclick:')) {
    const [, txt, what] = s.split(':');
    const pt = await p.evaluate((t, what) => {
      const lbl = [...document.querySelectorAll('#viewport .blocklbl')].find((g) => g.textContent.includes(t)); if (!lbl) return null;
      const el = what === 'chev' ? lbl.parentNode.querySelector('.blockchev') : lbl;
      const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];
    }, txt, what);
    if (!pt) { logs.push('not found ' + s); continue; }
    if (what === 'chev') await p.mouse.click(pt[0], pt[1]);
    else if (what === 'dbl') await p.mouse.click(pt[0], pt[1], { clickCount: 2 });
    else if (what === 'right') await p.mouse.click(pt[0], pt[1], { button: 'right' });
    await new Promise((r) => setTimeout(r, 400));
  }
  else if (s.startsWith('key:')) { await p.keyboard.press(s.slice(4)); await new Promise((r) => setTimeout(r, 600)); }
  else if (s.startsWith('wait:')) await new Promise((r) => setTimeout(r, +s.slice(5)));
}
console.log(logs.filter((l) => !/Download the React|GPU stall/.test(l)).join('\n'));
await b.close(); srv.close();
