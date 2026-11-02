/* Live micro-previews for the three project cards on the home page.
   Each one acts out the app's core move in a ~300x170 SVG, runs only while
   it is on screen, and holds a still final frame for reduced-motion users. */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const SANS = 'Inter, ui-sans-serif, system-ui, sans-serif';
  const C = { ink: '#f7f4ec', muted: '#c2a69a', dim: '#7d5c4e', line: '#5a2a18', well: '#120804', accent: '#ff9d61', orange: '#ff6b35' };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const svgFor = host => el('svg', { viewBox: '0 0 300 170', width: '100%', 'aria-hidden': 'true' }, host);
  const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  /* piecewise keyframes: [[t, v], ...] held flat outside the range */
  const kf = (t, f) => {
    if (t <= f[0][0]) return f[0][1];
    for (let i = 1; i < f.length; i++) if (t < f[i][0]) {
      const [t0, a] = f[i - 1], [t1, b] = f[i];
      return a + (b - a) * ease((t - t0) / (t1 - t0));
    }
    return f[f.length - 1][1];
  };

  /* runs render(t) in a loop while the preview is visible */
  function loop(host, duration, render, finalT) {
    if (reduce) { render(finalT); return; }
    let start = performance.now(), raf = 0, visible = false, pausedAt = 0;
    const frame = now => { render(((now - start) / 1000) % duration); raf = requestAnimationFrame(frame); };
    const sync = () => {
      const run = visible && !document.hidden;
      if (run && !raf) { start = performance.now() - pausedAt * 1000; raf = requestAnimationFrame(frame); }
      if (!run && raf) { cancelAnimationFrame(raf); raf = 0; pausedAt = ((performance.now() - start) / 1000) % duration; }
    };
    new IntersectionObserver(es => { visible = es[0].isIntersecting; sync(); }).observe(host);
    document.addEventListener('visibilitychange', sync);
    render(0);
  }

  /* ---------- SPOKEN: spoken phrases become Vertex code, then it runs ---------- */
  function spoken(host) {
    const svg = svgFor(host), g = el('g', {}, svg);
    const CMD = new Set(['then', 'ok', 'pair', 'times', 'two', 'five', 'run']);
    const phrases = [
      { say: 'define double with put then', at: .5, code: [['define', 'kw'], [' double', 'fn'], [' with', 'kw'], [' put', 'id']] },
      { say: 'give put times two ok', at: 3.1, code: [['    give', 'kw'], [' put', 'id'], [' *', 'op'], [' 2', 'num']] },
      { say: 'print double five pair', at: 5.5, code: [['print', 'kw'], [' double', 'fn'], ['(', 'op'], ['5', 'num'], [')', 'op']] },
      { say: 'run', at: 7.9, code: null }
    ];
    const WORD = .27, TYPE = .55;
    phrases.forEach(p => { p.words = p.say.split(' '); p.end = p.at + p.words.length * WORD; });
    const COL = { kw: C.accent, fn: C.ink, id: '#ffd2b0', op: C.muted, num: '#8fd3ff' };

    const ring = el('circle', { cx: 18, cy: 19, r: 7, fill: 'none', stroke: C.orange, 'stroke-width': 1.5 }, g);
    const mic = el('circle', { cx: 18, cy: 19, r: 6.5, fill: C.orange }, g);
    el('rect', { x: 16.2, y: 13.2, width: 3.6, height: 7, rx: 1.8, fill: C.well }, g);
    el('path', { d: 'M14.6 18.6a3.4 3.4 0 0 0 6.8 0M18 22v2.4', fill: 'none', stroke: C.well, 'stroke-width': 1.3, 'stroke-linecap': 'round' }, g);
    const said = el('text', { x: 34, y: 23, 'font-family': SANS, 'font-size': 11.5, 'font-style': 'italic' }, g);

    el('rect', { x: 8, y: 36, width: 284, height: 94, rx: 6, fill: C.well, stroke: C.line }, g);
    const runBtn = el('rect', { x: 250, y: 42, width: 36, height: 15, rx: 4, fill: 'none', stroke: C.line }, g);
    const runTxt = el('text', { x: 268, y: 52.5, 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 8.5, fill: C.muted }, g);
    runTxt.textContent = 'Run ▶';
    const lines = [0, 1, 2].map(i => {
      const n = el('text', { x: 16, y: 62 + i * 21, 'font-family': MONO, 'font-size': 10, fill: C.dim }, g);
      n.textContent = i + 1;
      return el('text', { x: 30, y: 62 + i * 21, 'font-family': MONO, 'font-size': 11, style: 'white-space:pre' }, g);
    });
    el('rect', { x: 8, y: 136, width: 284, height: 27, rx: 6, fill: C.well, stroke: C.line }, g);
    const out = el('text', { x: 18, y: 153.5, 'font-family': MONO, 'font-size': 11 }, g);

    let last = '';
    loop(host, 12, t => {
      g.setAttribute('opacity', Math.min(1, t / .3, (12 - t) / .4));
      const cur = [...phrases].reverse().find(p => t >= p.at);
      const speaking = cur && t < cur.end + .15;
      ring.setAttribute('r', speaking ? 7 + (t * 14 % 7) : 7);
      ring.setAttribute('opacity', speaking ? 1 - (t * 2 % 1) : 0);
      mic.setAttribute('fill', speaking ? C.orange : C.dim);
      const shown = cur ? cur.words.slice(0, Math.min(cur.words.length, Math.floor((t - cur.at) / WORD) + 1)) : [];
      const key = shown.join(' ');
      if (key !== last) {
        last = key;
        said.textContent = '';
        if (!shown.length) { const s = el('tspan', { fill: C.dim }, said); s.textContent = 'tap the mic and speak…'; }
        shown.forEach((w, i) => { const s = el('tspan', { fill: CMD.has(w) ? C.accent : C.ink, 'font-weight': CMD.has(w) ? 700 : 400 }, said); s.textContent = (i ? ' ' : '“') + w + (i === shown.length - 1 && shown.length === cur.words.length ? '”' : ''); });
      }
      phrases.slice(0, 3).forEach((p, i) => {
        const total = p.code.reduce((a, [s]) => a + s.length, 0);
        let n = Math.round(total * Math.max(0, Math.min(1, (t - p.end) / TYPE)));
        lines[i].textContent = '';
        for (const [s, k] of p.code) {
          if (n <= 0) break;
          const sp = el('tspan', { fill: COL[k] }, lines[i]); sp.textContent = s.slice(0, n); n -= s.length;
        }
      });
      const ran = t >= phrases[3].end;
      const flash = ran && t < phrases[3].end + .45;
      runBtn.setAttribute('fill', flash ? C.orange : 'none');
      runTxt.setAttribute('fill', flash ? C.well : ran ? C.accent : C.muted);
      out.textContent = '';
      const a = el('tspan', { fill: C.dim }, out); a.textContent = '› ';
      if (t >= phrases[3].end + .35) { const b = el('tspan', { fill: C.ink }, out); b.textContent = '10'; }
    }, 11.5);
  }

  /* ---------- SYNTAX: words drop into nested containers, which become a tree ---------- */
  function syntax(host) {
    const svg = svgFor(host), g = el('g', {}, svg);
    const HEAD = { Story: ['#e09f00', '#f2b632'], Actor: ['#a0693a', '#dfa06b'], Command: ['#2f78f0', '#7aaeff'] };
    const WCOL = { D: '#6b7280', N: '#a0693a', V: '#2f78f0' };
    const words = [['the', 'D', 28], ['dog', 'N', 32], ['chased', 'V', 46], ['a', 'D', 18], ['cat', 'N', 30]];
    const T1 = 1.1, T2 = 4.8, END = 10.5;      // boxes appear, boxes become a tree, loop
    const bx = 28, tx = 10;                     // centring offsets for box and tree layouts
    // name, box [x,y,w,h], tree centre [x,y], parent
    const nodes = [
      ['Story', [8, 34, 244, 84], [120, 14], null],
      ['Actor', [16, 50, 82, 60], [63, 56], 0],
      ['Command', [104, 50, 140, 60], [178, 56], 0],
      ['Actor', [166, 64, 70, 40], [216, 98], 2]
    ];
    const boxChip = [[24, 84], [58, 84], [112, 84], [174, 84], [198, 84]];
    const leafX = [44, 82, 140, 198, 234], LEAF_Y = 146, parentOf = [1, 1, 2, 3, 3];
    let rowX = (300 - (words.reduce((a, w) => a + w[2], 0) + 24)) / 2;
    const row = words.map(w => { const x = rowX; rowX += w[2] + 6; return x; });
    const pillW = s => s.length * 5.4 + 14;

    const edges = el('g', { stroke: C.dim, 'stroke-width': 1.2 }, g);
    const edge = (p, c) => el('line', { x1: p[0], y1: p[1], x2: c[0], y2: c[1] }, edges);
    nodes.forEach(n => { if (n[3] !== null) { const p = nodes[n[3]][2]; edge([p[0] + tx, p[1] + 15], [n[2][0] + tx, n[2][1]]); } });
    words.forEach((w, i) => { const p = nodes[parentOf[i]][2]; edge([p[0] + tx, p[1] + 15], [leafX[i] + tx, LEAF_Y]); });

    const boxes = nodes.map(([name, b, c], i) => {
      const [stroke, text] = HEAD[name], appear = T1 + i * .2;
      const r = el('rect', { fill: stroke + '2e', stroke: stroke + 'aa', 'stroke-width': 1.2 }, g);
      const l = el('text', { 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 9, 'font-weight': 700, fill: text }, g);
      l.textContent = name;
      const pw = pillW(name), lw = name.length * 5.4;
      return { r, l, f: {
        o: [[appear, 0], [appear + .35, 1]],
        x: [[T2, b[0] + bx], [T2 + 1, c[0] + tx - pw / 2]], y: [[T2, b[1]], [T2 + 1, c[1]]],
        w: [[T2, b[2]], [T2 + 1, pw]], h: [[T2, b[3]], [T2 + 1, 15]], rx: [[T2, 6], [T2 + 1, 7.5]],
        lx: [[T2, b[0] + bx + 6 + lw / 2], [T2 + 1, c[0] + tx]], ly: [[T2, b[1] + 11], [T2 + 1, c[1] + 10.5]]
      } };
    });
    const chips = words.map(([s, cat, w], i) => {
      const grp = el('g', {}, g);
      el('rect', { width: w, height: 16, rx: 8, fill: WCOL[cat] }, grp);
      const t = el('text', { x: w / 2, y: 11.5, 'text-anchor': 'middle', 'font-family': SANS, 'font-size': 10.5, 'font-weight': 700, fill: '#fff' }, grp);
      t.textContent = s;
      const drop = T1 + .9 + i * .14;
      return { grp, f: {
        x: [[drop, row[i]], [drop + .6, boxChip[i][0] + bx], [T2 + .1, boxChip[i][0] + bx], [T2 + 1.1, leafX[i] + tx - w / 2]],
        y: [[drop, 8], [drop + .6, boxChip[i][1]], [T2 + .1, boxChip[i][1]], [T2 + 1.1, LEAF_Y]]
      } };
    });

    loop(host, END, t => {
      g.setAttribute('opacity', Math.min(1, t / .3, (END - t) / .5));
      edges.setAttribute('opacity', kf(t, [[T2 + .6, 0], [T2 + 1.2, 1]]));
      for (const { r, l, f } of boxes) {
        const o = kf(t, f.o);
        r.setAttribute('opacity', o); l.setAttribute('opacity', o);
        r.setAttribute('x', kf(t, f.x)); r.setAttribute('y', kf(t, f.y));
        r.setAttribute('width', kf(t, f.w)); r.setAttribute('height', kf(t, f.h)); r.setAttribute('rx', kf(t, f.rx));
        l.setAttribute('x', kf(t, f.lx)); l.setAttribute('y', kf(t, f.ly));
      }
      for (const { grp, f } of chips) grp.setAttribute('transform', `translate(${kf(t, f.x)},${kf(t, f.y)})`);
    }, 9);
  }

  /* ---------- NEFS: real Tessera glyphs; one feature changes, one stroke changes ---------- */
  const TESSERA = {"strokes":{"4":"M42.1,91.2 42.2,92.0 42.3,92.7 42.5,93.5 42.7,94.2 43.1,94.9 43.5,95.5 43.9,96.2 44.4,96.7 45.0,97.2 45.6,97.7 46.3,98.1 47.0,98.4 47.7,98.7 48.4,98.9 49.2,99.0 50.0,99.0 50.7,99.0 51.5,98.9 52.2,98.7 52.9,98.4 53.6,98.1 54.3,97.7 54.9,97.2 55.5,96.7 56.0,96.2 56.5,95.5 56.8,94.9 57.2,94.2 57.4,93.5 57.6,92.7 57.7,92.0 57.8,91.2 57.8,8.7 57.7,7.9 57.6,7.2 57.4,6.4 57.2,5.7 56.8,5.0 56.5,4.4 56.0,3.7 55.5,3.2 54.9,2.7 54.3,2.2 53.6,1.8 52.9,1.5 52.2,1.2 51.5,1.0 50.7,0.9 50.0,0.9 49.2,0.9 48.4,1.0 47.7,1.2 47.0,1.5 46.3,1.8 45.6,2.2 45.0,2.7 44.4,3.2 43.9,3.7 43.5,4.4 43.1,5.0 42.7,5.7 42.5,6.4 42.3,7.2 42.2,7.9 42.1,8.7 42.1,91.2Z","8":"M91.2,20.9 92.0,20.9 92.7,20.7 93.5,20.6 94.2,20.3 94.9,20.0 95.5,19.6 96.2,19.1 96.7,18.6 97.2,18.0 97.7,17.4 98.1,16.8 98.4,16.1 98.7,15.3 98.9,14.6 99.0,13.8 99.0,13.1 99.0,12.3 98.9,11.6 98.7,10.8 98.4,10.1 98.1,9.4 97.7,8.7 97.2,8.1 96.7,7.6 96.2,7.0 95.5,6.6 94.9,6.2 94.2,5.9 93.5,5.6 92.7,5.4 92.0,5.3 91.2,5.3 8.7,5.3 7.9,5.3 7.2,5.4 6.4,5.6 5.7,5.9 5.0,6.2 4.4,6.6 3.7,7.0 3.2,7.6 2.7,8.1 2.2,8.7 1.8,9.4 1.5,10.1 1.2,10.8 1.0,11.6 0.9,12.3 0.9,13.1 0.9,13.8 1.0,14.6 1.2,15.3 1.5,16.1 1.8,16.8 2.2,17.4 2.7,18.0 3.2,18.6 3.7,19.1 4.4,19.6 5.0,20.0 5.7,20.3 6.4,20.6 7.2,20.7 7.9,20.9 8.7,20.9 91.2,20.9Z","11":"M43.8,90.5 44.1,91.1 44.5,91.6 44.9,92.1 45.4,92.6 45.9,93.0 46.5,93.4 47.1,93.7 47.7,93.9 48.3,94.1 49.0,94.3 49.6,94.3 50.3,94.3 51.0,94.3 51.6,94.1 52.2,93.9 52.9,93.7 53.4,93.4 54.0,93.0 54.5,92.6 55.0,92.1 55.4,91.6 55.8,91.1 56.1,90.5 93.6,14.2 93.9,13.6 94.1,13.0 94.2,12.3 94.3,11.6 94.3,11.0 94.3,10.3 94.1,9.6 94.0,9.0 93.7,8.4 93.4,7.8 93.0,7.2 92.6,6.7 92.1,6.2 91.6,5.7 91.1,5.4 90.5,5.0 89.9,4.8 89.2,4.6 88.6,4.4 87.9,4.3 87.2,4.3 86.6,4.4 85.9,4.5 85.2,4.7 84.6,4.9 84.0,5.3 83.4,5.6 82.9,6.0 82.4,6.5 82.0,7.0 81.6,7.6 81.3,8.2 50.0,71.9 18.6,8.2 18.3,7.6 17.9,7.0 17.5,6.5 17.0,6.0 16.5,5.6 15.9,5.3 15.3,4.9 14.7,4.7 14.0,4.5 13.4,4.4 12.7,4.3 12.0,4.3 11.3,4.4 10.7,4.6 10.0,4.8 9.4,5.0 8.8,5.4 8.3,5.7 7.8,6.2 7.3,6.7 6.9,7.2 6.5,7.8 6.2,8.4 5.9,9.0 5.8,9.6 5.6,10.3 5.6,11.0 5.6,11.6 5.7,12.3 5.8,13.0 6.0,13.6 6.3,14.2 43.8,90.5Z","14":"M5.4,84.1 4.9,84.7 4.4,85.2 4.1,85.9 3.8,86.5 3.5,87.2 3.3,87.9 3.2,88.6 3.2,89.3 3.2,90.1 3.3,90.8 3.5,91.5 3.8,92.2 4.1,92.8 4.4,93.4 4.9,94.0 5.4,94.5 5.9,95.0 6.5,95.5 7.1,95.8 7.8,96.1 8.4,96.4 9.1,96.6 9.9,96.7 10.6,96.7 11.3,96.7 12.0,96.6 12.7,96.4 13.4,96.1 14.1,95.8 14.7,95.5 15.3,95.0 15.8,94.5 94.5,15.8 95.0,15.3 95.5,14.7 95.8,14.1 96.1,13.4 96.4,12.7 96.6,12.0 96.7,11.3 96.7,10.6 96.7,9.9 96.6,9.1 96.4,8.4 96.1,7.8 95.8,7.1 95.5,6.5 95.0,5.9 94.5,5.4 94.0,4.9 93.4,4.4 92.8,4.1 92.2,3.8 91.5,3.5 90.8,3.3 90.1,3.2 89.3,3.2 88.6,3.2 87.9,3.3 87.2,3.5 86.5,3.8 85.9,4.1 85.2,4.4 84.7,4.9 84.1,5.4 5.4,84.1Z","18":"M45.5,42.7 45.0,43.2 44.6,43.7 44.3,44.3 44.0,44.9 43.8,45.5 43.6,46.1 43.5,46.8 43.5,47.5 43.5,90.0 43.5,90.6 43.6,91.2 43.7,91.8 43.9,92.4 44.2,93.0 44.6,93.6 44.9,94.1 45.4,94.6 45.8,95.0 46.3,95.4 46.9,95.7 47.5,96.0 48.1,96.2 48.7,96.3 49.3,96.4 50.0,96.5 50.6,96.4 51.2,96.3 51.8,96.2 52.4,96.0 53.0,95.7 53.6,95.4 54.1,95.0 54.6,94.6 55.0,94.1 55.4,93.6 55.7,93.0 56.0,92.4 56.2,91.8 56.3,91.2 56.4,90.6 56.5,90.0 56.5,50.3 94.4,14.7 94.8,14.2 95.2,13.7 95.6,13.2 95.9,12.6 96.1,12.0 96.3,11.4 96.4,10.8 96.5,10.2 96.4,9.5 96.4,8.9 96.2,8.3 96.0,7.7 95.8,7.1 95.5,6.5 95.1,6.0 94.7,5.5 94.2,5.1 93.7,4.7 93.2,4.3 92.6,4.0 92.0,3.8 91.4,3.6 90.8,3.5 90.2,3.5 89.5,3.5 88.9,3.5 88.3,3.7 87.7,3.9 87.1,4.1 86.5,4.4 86.0,4.8 85.5,5.2 45.5,42.7Z","20":"M84.7,50.8 85.2,51.2 85.7,51.6 86.3,51.9 86.8,52.2 87.4,52.4 88.1,52.6 88.7,52.7 89.3,52.7 90.0,52.7 90.6,52.6 91.2,52.4 91.8,52.2 92.4,51.9 92.9,51.6 93.5,51.2 93.9,50.8 94.4,50.3 94.7,49.8 95.1,49.3 95.3,48.7 95.6,48.1 95.7,47.5 95.8,46.8 95.8,46.2 95.8,45.6 95.7,44.9 95.6,44.3 95.3,43.7 95.1,43.1 94.7,42.6 94.4,42.1 93.9,41.6 58.3,6.0 57.8,5.6 57.3,5.2 56.8,4.8 56.2,4.6 55.6,4.4 55.0,4.2 54.3,4.1 53.7,4.1 53.1,4.1 52.4,4.2 51.8,4.4 51.2,4.6 50.6,4.8 50.1,5.2 49.6,5.6 49.1,6.0 48.7,6.5 48.3,7.0 48.0,7.5 47.7,8.1 47.5,8.7 47.3,9.3 47.2,9.9 47.2,10.6 47.2,11.2 47.3,11.8 47.5,12.5 47.7,13.1 48.0,13.6 48.3,14.2 48.7,14.7 49.1,15.2 84.7,50.8Z","22":"M41.6,93.9 42.1,94.4 42.6,94.7 43.1,95.1 43.7,95.3 44.3,95.6 44.9,95.7 45.6,95.8 46.2,95.8 46.8,95.8 47.5,95.7 48.1,95.6 48.7,95.3 49.3,95.1 49.8,94.7 50.3,94.4 50.8,93.9 51.2,93.5 51.6,92.9 51.9,92.4 52.2,91.8 52.4,91.2 52.6,90.6 52.7,90.0 52.7,89.3 52.7,88.7 52.6,88.1 52.4,87.4 52.2,86.8 51.9,86.3 51.6,85.7 51.2,85.2 50.8,84.7 15.2,49.1 14.7,48.7 14.2,48.3 13.6,48.0 13.1,47.7 12.5,47.5 11.8,47.3 11.2,47.2 10.6,47.2 9.9,47.2 9.3,47.3 8.7,47.5 8.1,47.7 7.5,48.0 7.0,48.3 6.5,48.7 6.0,49.1 5.6,49.6 5.2,50.1 4.8,50.6 4.6,51.2 4.4,51.8 4.2,52.4 4.1,53.1 4.1,53.7 4.1,54.3 4.2,55.0 4.4,55.6 4.6,56.2 4.8,56.8 5.2,57.3 5.6,57.8 6.0,58.3 41.6,93.9Z"},"sym":{"p":{"place":["bilabial",[4,22]],"manner":["plosive",[]],"voicing":["voiceless",[20]]},"b":{"place":["bilabial",[4,22]],"manner":["plosive",[]],"voicing":["voiced",[]]},"m":{"place":["bilabial",[4,22]],"manner":["nasal",[18]],"voicing":["voiced",[]]},"n":{"place":["alveolar",[14]],"manner":["nasal",[18]],"voicing":["voiced",[]]},"d":{"place":["alveolar",[14]],"manner":["plosive",[]],"voicing":["voiced",[]]},"g":{"place":["velar",[8]],"manner":["plosive",[]],"voicing":["voiced",[]]},"k":{"place":["velar",[8]],"manner":["plosive",[]],"voicing":["voiceless",[20]]},"t":{"place":["alveolar",[14]],"manner":["plosive",[]],"voicing":["voiceless",[20]]},"s":{"place":["alveolar",[14]],"manner":["fricative",[11]],"voicing":["voiceless",[20]]},"z":{"place":["alveolar",[14]],"manner":["fricative",[11]],"voicing":["voiced",[]]},"v":{"place":["labiodental",[4]],"manner":["fricative",[11]],"voicing":["voiced",[]]},"f":{"place":["labiodental",[4]],"manner":["fricative",[11]],"voicing":["voiceless",[20]]}}};
  function nefs(host) {
    const svg = svgFor(host);
    const CATS = [['place', '#ff9d61'], ['manner', '#7aaeff'], ['voicing', '#f06ba8']];
    const ORDER = 'p b m n d g k t s z v f'.split(' ');
    el('rect', { x: 10, y: 10, width: 116, height: 116, rx: 8, fill: C.well, stroke: C.line }, svg);
    const glyph = el('svg', { x: 18, y: 18, width: 100, height: 100, viewBox: '-6 -6 112 112' }, svg);
    const paths = {};
    for (const id in TESSERA.strokes) {
      paths[id] = el('path', { d: TESSERA.strokes[id], 'fill-rule': 'evenodd' }, glyph);
      paths[id].style.cssText = 'transition:opacity .35s ease, fill .35s ease;opacity:0';
    }
    const sym = el('text', { x: 140, y: 38, 'font-family': 'Georgia, serif', 'font-size': 26, fill: C.ink }, svg);
    const delta = el('text', { x: 140, y: 126, 'font-family': MONO, 'font-size': 8.5, fill: C.accent }, svg);
    const rows = CATS.map(([cat, col], i) => {
      const y = 56 + i * 22;
      const hl = el('rect', { x: 136, y: y - 11, width: 156, height: 19, rx: 4, fill: col, opacity: 0 }, svg);
      hl.style.transition = 'opacity .5s ease';
      el('rect', { x: 141, y: y - 5, width: 8, height: 8, rx: 2, fill: col }, svg);
      const k = el('text', { x: 155, y: y + 2.5, 'font-family': MONO, 'font-size': 8.5, fill: C.muted }, svg);
      k.textContent = cat;
      const v = el('text', { x: 198, y: y + 3, 'font-family': SANS, 'font-size': 10.5, fill: C.ink }, svg);
      return { hl, v };
    });
    const chips = ORDER.map((s, i) => {
      const x = 9 + i * 24, grp = el('g', { tabindex: 0, role: 'button', 'aria-label': `Show the Tessera glyph for ${s}` }, svg);
      grp.style.cursor = 'pointer';
      const r = el('rect', { x, y: 138, width: 21, height: 22, rx: 5, fill: 'none', stroke: C.line }, grp);
      const t = el('text', { x: x + 10.5, y: 153, 'text-anchor': 'middle', 'font-family': 'Georgia, serif', 'font-size': 13, fill: C.muted }, grp);
      t.textContent = s;
      const pick = e => { e.preventDefault(); show(s, true); };
      grp.addEventListener('click', pick);
      grp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') pick(e); });
      return { s, r, t };
    });
    svg.removeAttribute('aria-hidden');
    let cur = null, idx = 0, holdUntil = 0;
    function show(s, byUser) {
      const prev = cur && TESSERA.sym[cur], next = TESSERA.sym[s];
      const colour = {};
      CATS.forEach(([cat, col], i) => {
        const [val, ids] = next[cat];
        ids.forEach(id => { colour[id] = col; });
        rows[i].v.textContent = ids.length ? val : `${val} · blank`;
        rows[i].v.setAttribute('fill', ids.length ? C.ink : C.muted);
        const changed = prev && prev[cat][0] !== val;
        rows[i].hl.setAttribute('opacity', changed ? .22 : 0);
      });
      for (const id in paths) {
        paths[id].style.opacity = colour[id] ? 1 : 0;
        if (colour[id]) paths[id].style.fill = colour[id];
      }
      const diff = prev && CATS.filter(([c]) => prev[c][0] !== next[c][0]);
      delta.textContent = diff && diff.length === 1 ? `${cur} → ${s}: one feature, one stroke` : '';
      sym.textContent = `/${s}/`;
      chips.forEach(c => { const on = c.s === s; c.r.setAttribute('fill', on ? C.orange : 'none'); c.r.setAttribute('stroke', on ? C.orange : C.line); c.t.setAttribute('fill', on ? C.well : C.muted); });
      cur = s; idx = ORDER.indexOf(s);
      if (byUser) holdUntil = performance.now() + 7000;
    }
    show('p');
    if (reduce) return;
    let visible = false;
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(host);
    setInterval(() => {
      if (!visible || document.hidden || performance.now() < holdUntil) return;
      show(ORDER[(idx + 1) % ORDER.length]);
    }, 1800);
  }

  const kinds = { spoken, syntax, nefs };
  document.querySelectorAll('[data-preview]').forEach(h => kinds[h.dataset.preview] && kinds[h.dataset.preview](h));
})();
