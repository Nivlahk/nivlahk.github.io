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

  /* ---------- SYNTAX: a cursor builds the tree by hand, the way the app works:
     drop a container, then fill its open (dashed) slots with words and smaller
     containers until every slot is solid ---------- */
  function syntax(host) {
    const svg = svgFor(host), g = el('g', {}, svg);
    const LABEL = { Story: '#f2b632', Actor: '#dfa06b', Command: '#7aaeff' };
    const WCOL = { D: '#7a808c', N: '#a0693a', V: '#2f78f0' };
    const STEP = .95, T0 = .5, MOVE = .55;
    const s = i => T0 + i * STEP, d = i => s(i) + MOVE;   // drag i starts / drops
    const END = d(8) + 3.2;
    const N = { story: [130, 36], a1: [73, 66], cmd: [188, 66], a2: [226, 94] };
    const LEAF = { the: 54, dog: 92, chased: 150, a: 208, cat: 244 };
    const POS_Y = 130, WORD_Y = 146, DOCK = [-34, 96];
    const pillW = t => t.length * 5.4 + 14;
    const fade = (t, on, off = Infinity) => Math.max(0, Math.min(1, (t - on) / .2, (off - t) / .2));

    // edges: parent, child point, appear, solid-from
    const top = ([x, y]) => [x, y - 7.5], leafTop = x => [x, POS_Y - 9];
    const edgeDefs = [
      [N.story, top(N.a1), d(0), d(1)], [N.story, top(N.cmd), d(0), d(2)],
      [N.a1, leafTop(LEAF.the), d(3), d(3)], [N.a1, leafTop(LEAF.dog), d(1), d(4)],
      [N.cmd, leafTop(LEAF.chased), d(2), d(5)], [N.cmd, top(N.a2), d(5), d(6)],
      [N.a2, leafTop(LEAF.a), d(7), d(7)], [N.a2, leafTop(LEAF.cat), d(6), d(8)]
    ].map(([p, c, on, solid]) => ({ on, solid, l: el('line', { x1: p[0], y1: p[1] + 7.5, x2: c[0], y2: c[1], stroke: C.muted, 'stroke-width': 1.1 }, g) }));

    // open slots: label, centre, appear, filled
    const slotDefs = [
      ['Actor', N.a1, d(0), d(1)], ['Command', N.cmd, d(0), d(2)], ['N', [LEAF.dog, 140], d(1), d(4)],
      ['V', [LEAF.chased, 140], d(2), d(5)], ['Actor', N.a2, d(5), d(6)], ['N', [LEAF.cat, 140], d(6), d(8)]
    ].map(([txt, [x, y], on, off]) => {
      const grp = el('g', { opacity: 0 }, g), short = txt.length === 1, w = short ? 15 : pillW(txt);
      el('rect', { x: x - w / 2, y: y - 7.5, width: w, height: 15, rx: 7.5, fill: C.well, stroke: C.muted, 'stroke-width': 1.1, 'stroke-dasharray': '3 2.5' }, grp);
      const tt = el('text', { x, y: y + 3.2, 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 8.5, 'font-weight': 700, fill: LABEL[txt] || C.muted }, grp);
      tt.textContent = txt;
      return { grp, on, off };
    });

    // containers dragged in from the left (the palette): label, target, drag index, complete
    const nodes = [['Story', N.story, 0, d(8)], ['Actor', N.a1, 1, d(4)], ['Command', N.cmd, 2, d(8)], ['Actor', N.a2, 6, d(8)]]
      .map(([txt, to, i, done]) => {
        const grp = el('g', {}, g), w = pillW(txt);
        const box = el('rect', { x: -w / 2, y: -7.5, width: w, height: 15, rx: 4, fill: C.well, stroke: LABEL[txt], 'stroke-width': 1.1, 'stroke-dasharray': '3 2.5' }, grp);
        const tt = el('text', { y: 3.2, 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 9, 'font-weight': 700, fill: LABEL[txt] }, grp);
        tt.textContent = txt;
        return { grp, box, i, done, from: DOCK, to };
      });

    // words: start in a row on the bench, are dragged onto a slot, become leaves
    const wordDefs = [['the', 'D', 28, 3], ['dog', 'N', 32, 4], ['chased', 'V', 46, 5], ['a', 'D', 18, 7], ['cat', 'N', 30, 8]];
    let rx = (300 - (wordDefs.reduce((a, w) => a + w[2], 0) + 24)) / 2;
    const words = wordDefs.map(([txt, cat, w, i]) => {
      const x = LEAF[txt], from = [rx + w / 2, 14]; rx += w + 6;
      const chip = el('g', {}, g);
      el('rect', { x: -w / 2, y: -8, width: w, height: 16, rx: 8, fill: WCOL[cat] }, chip);
      const ct = el('text', { y: 3.6, 'text-anchor': 'middle', 'font-family': SANS, 'font-size': 10.5, 'font-weight': 700, fill: '#fff' }, chip);
      ct.textContent = txt;
      const leaf = el('g', { opacity: 0 }, g);
      const pt = el('text', { x, y: POS_Y, 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 8.5, fill: C.muted }, leaf);
      pt.textContent = cat;
      const wt = el('text', { x, y: WORD_Y, 'text-anchor': 'middle', 'font-family': SANS, 'font-size': 11.5, fill: C.ink }, leaf);
      wt.textContent = txt;
      const uw = txt.length * 6.4 + 4;
      el('rect', { x: x - uw / 2, y: WORD_Y + 4, width: uw, height: 2.5, rx: 1.2, fill: WCOL[cat] }, leaf);
      return { chip, leaf, i, from, to: [x, 140] };
    });

    const done = el('text', { x: 150, y: 17, 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 9.5, 'font-weight': 700, fill: '#4fd27a', opacity: 0 }, g);
    done.textContent = '✓ Story complete';

    // cursor follows whatever is being dragged
    const drags = [...nodes, ...words].sort((a, b) => a.i - b.i);
    const cx = [[0, 160]], cy = [[0, 110]];
    drags.forEach(o => { cx.push([s(o.i), o.from[0]], [d(o.i), o.to[0]]); cy.push([s(o.i), o.from[1]], [d(o.i), o.to[1]]); });
    cx.push([d(8) + .9, 280]); cy.push([d(8) + .9, 160]);
    const cursor = el('path', { d: 'M0 0V14l3.6-3.3 2.6 5.6 2.3-1-2.5-5.5H11Z', fill: C.ink, stroke: C.well, 'stroke-width': 1.1, 'stroke-linejoin': 'round' }, g);

    const at = (t, o) => [kf(t, [[s(o.i), o.from[0]], [d(o.i), o.to[0]]]), kf(t, [[s(o.i), o.from[1]], [d(o.i), o.to[1]]])];
    loop(host, END, t => {
      g.setAttribute('opacity', Math.min(1, t / .3, (END - t) / .5));
      for (const e of edgeDefs) {
        e.l.setAttribute('opacity', fade(t, e.on));
        e.l.setAttribute('stroke-dasharray', t < e.solid ? '3 3' : 'none');
        e.l.setAttribute('stroke', t < e.solid ? C.dim : C.muted);
      }
      for (const sl of slotDefs) sl.grp.setAttribute('opacity', t < sl.off ? fade(t, sl.on) : 0);
      for (const n of nodes) {
        const [x, y] = at(t, n);
        n.grp.setAttribute('transform', `translate(${x},${y})`);
        n.box.setAttribute('opacity', t < n.done ? 1 : Math.max(0, 1 - (t - n.done) / .4));
      }
      for (const w of words) {
        const [x, y] = at(t, w), dropped = t >= d(w.i);
        w.chip.setAttribute('transform', `translate(${x},${y})`);
        w.chip.setAttribute('opacity', dropped ? Math.max(0, 1 - (t - d(w.i)) / .2) : 1);
        w.leaf.setAttribute('opacity', fade(t, d(w.i)));
      }
      done.setAttribute('opacity', fade(t, d(8) + .35));
      cursor.setAttribute('transform', `translate(${kf(t, cx) + 1},${kf(t, cy) + 2})`);
    }, d(8) + 2);
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

  /* ---------- SEER: every indirect jump goes through the compiler's CN table ---------- */
  function seer(host) {
    const svg = svgFor(host), g = el('g', {}, svg);
    const GOOD = '#4fd27a', BAD = '#ff5a4f';
    el('rect', { x: 8, y: 8, width: 166, height: 154, rx: 6, fill: C.well, stroke: C.line }, g);
    const lines = [['main:', 'lab'], ['  li   r1, 1', ''], ['  jmpr r1', 'jmp'], ['add:', 'lab'], ['  add  r0, r1, r2', ''], ['  ret', ''], ['mul:', 'lab'], ['  …', '']];
    const LY = i => 26 + i * 18;
    const pcBar = el('rect', { x: 12, y: LY(2) - 11, width: 158, height: 15, rx: 3, fill: C.orange, opacity: 0 }, g);
    const liTxt = [];
    lines.forEach(([t, k], i) => {
      const tt = el('text', { x: 18, y: LY(i), 'font-family': MONO, 'font-size': 10, fill: k === 'lab' ? C.accent : C.ink, style: 'white-space:pre' }, g);
      tt.textContent = t;
      liTxt.push(tt);
    });
    const reg = el('text', { x: 112, y: LY(1), 'font-family': MONO, 'font-size': 9, 'font-weight': 700 }, g);

    el('text', { x: 186, y: 22, 'font-family': MONO, 'font-size': 8.5, fill: C.muted }, g).textContent = 'CN table';
    const rows = [['0', 'main'], ['1', 'add'], ['2', 'mul']].map(([n, name], i) => {
      const y = 30 + i * 20;
      const bg = el('rect', { x: 182, y, width: 110, height: 17, rx: 4, fill: C.well, stroke: C.line }, g);
      const a = el('text', { x: 190, y: y + 12, 'font-family': MONO, 'font-size': 9.5, fill: C.muted }, g); a.textContent = '#' + n;
      const b = el('text', { x: 212, y: y + 12, 'font-family': MONO, 'font-size': 9.5, fill: C.ink }, g); b.textContent = name;
      return bg;
    });
    const arrow = el('path', { d: `M182 ${30 + 20 + 8.5} C 150 ${30 + 20 + 8.5}, 160 ${LY(3) - 4}, 52 ${LY(3) - 4}`, fill: 'none', stroke: GOOD, 'stroke-width': 1.6, 'stroke-dasharray': 200, 'stroke-dashoffset': 200 }, g);
    const head = el('path', { d: `M52 ${LY(3) - 4} l6 -3.5 v7z`, fill: GOOD, opacity: 0 }, g);
    const verdict = el('text', { x: 186, y: 112, 'font-family': MONO, 'font-size': 9.5, 'font-weight': 700 }, g);
    const note = el('text', { x: 186, y: 126, 'font-family': SANS, 'font-size': 9, fill: C.muted }, g);
    const foot = el('text', { x: 186, y: 152, 'font-family': SANS, 'font-size': 8.5, fill: C.dim }, g);
    foot.textContent = 'Jumps only land where';
    const foot2 = el('text', { x: 186, y: 163, 'font-family': SANS, 'font-size': 8.5, fill: C.dim }, g);
    foot2.textContent = 'the compiler registered.';

    const END = 10;
    loop(host, END, t => {
      g.setAttribute('opacity', Math.min(1, t / .3, (END - t) / .4));
      const bad = t >= 5;                       // second half: r1 has been overwritten
      const u = bad ? t - 5 : t;
      pcBar.setAttribute('opacity', u > .4 ? .22 : 0);
      reg.textContent = u > .8 ? (bad ? 'r1 = 7' : 'r1 = 1') : '';
      liTxt[1].textContent = bad ? '  li   r1, 7' : '  li   r1, 1';
      liTxt[1].setAttribute('fill', bad ? BAD : C.ink);
      reg.setAttribute('fill', bad ? BAD : GOOD);
      rows.forEach((r, i) => {
        const look = u > 1.4 && u < 2.2;
        const hit = !bad && i === 1 && u >= 1.4;
        r.setAttribute('stroke', hit ? GOOD : bad && look ? BAD : C.line);
        r.setAttribute('fill', hit ? GOOD + '33' : C.well);
      });
      const drawn = !bad ? Math.max(0, Math.min(1, (u - 2) / .6)) : 0;
      arrow.setAttribute('stroke-dashoffset', 200 * (1 - drawn));
      head.setAttribute('opacity', drawn >= 1 ? 1 : 0);
      const show = u > 2.6;
      verdict.textContent = show ? (bad ? '✗ no entry #7' : '✓ lands on add') : '';
      verdict.setAttribute('fill', bad ? BAD : GOOD);
      note.textContent = show ? (bad ? 'jump refused' : 'a registered entry') : '';
    }, 4.2);
  }

  /* ---------- VERTEX: the code and its flowchart run side by side, in step ---------- */
  function vertex(host) {
    const svg = svgFor(host), g = el('g', {}, svg);
    const HL = '#ff6b3538', GOOD = '#4fd27a', BAD = '#ff8a7a';
    // code panel
    el('rect', { x: 8, y: 8, width: 132, height: 104, rx: 6, fill: C.well, stroke: C.line }, g);
    const band = el('rect', { x: 12, width: 124, height: 16, rx: 3, fill: HL, opacity: 0 }, g);
    const CODE = [[['make', 'kw'], [' n ', ''], ['5', 'num']], [['if', 'kw'], [' n ', ''], ['more', 'kw'], [' 3', 'num']], [['  print', 'kw'], [' "big"', 'str']], [['print', 'kw'], [' n', '']]];
    const LY = i => 30 + i * 19;
    const codeLines = CODE.map((parts, i) => {
      const tt = el('text', { x: 20, y: LY(i), 'font-family': MONO, 'font-size': 10.5, style: 'white-space:pre' }, g);
      return parts.map(([s, k]) => { const sp = el('tspan', { fill: k === 'kw' ? C.accent : k === 'str' || k === 'num' ? '#8fd3ff' : C.ink }, tt); sp.textContent = s; return sp; });
    });
    const vars = el('text', { x: 20, y: 104, 'font-family': MONO, 'font-size': 9, fill: C.muted }, g);
    // output panel
    el('rect', { x: 8, y: 118, width: 132, height: 44, rx: 6, fill: C.well, stroke: C.line }, g);
    const outs = [0, 1].map(i => el('text', { x: 18, y: 135 + i * 16, 'font-family': MONO, 'font-size': 10, fill: C.ink }, g));
    // flowchart
    const fc = el('g', {}, g);
    const node = (x, y, w, txt) => {
      const r = el('rect', { x: x - w / 2, y: y - 9, width: w, height: 18, rx: 4, fill: C.well, stroke: C.line }, fc);
      const tt = el('text', { x, y: y + 3.5, 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 9, fill: C.ink }, fc); tt.textContent = txt;
      return { r, tt };
    };
    const edge = d => { const p = el('path', { d, fill: 'none', stroke: C.dim, 'stroke-width': 1.2 }, fc); return p; };
    const E = { md: edge('M206 31 V45'), yes: edge('M206 73 V93'), bn: edge('M206 111 V131'), no: edge('M240 59 H280 V140 H234') };
    const tagYes = el('text', { x: 211, y: 86, 'font-family': MONO, 'font-size': 8, fill: C.muted }, fc); tagYes.textContent = 'yes';
    const tagNo = el('text', { x: 255, y: 54, 'font-family': MONO, 'font-size': 8, fill: C.muted }, fc); tagNo.textContent = 'no';
    const N = { make: node(206, 22, 66, 'make n 5'), big: node(206, 102, 76, 'print "big"'), pn: node(206, 140, 56, 'print n') };
    const dia = el('path', { d: 'M206 45 L240 59 L206 73 L172 59 Z', fill: C.well, stroke: C.line }, fc);
    const diaT = el('text', { x: 206, y: 62, 'text-anchor': 'middle', 'font-family': MONO, 'font-size': 8.5, fill: C.ink }, fc); diaT.textContent = 'n more 3?';
    N.dia = { r: dia, tt: diaT };
    const verdict = el('text', { x: 134, y: LY(1), 'text-anchor': 'end', 'font-family': MONO, 'font-size': 9, 'font-weight': 700 }, g);
    const token = el('circle', { r: 3.6, fill: C.orange, opacity: 0 }, fc);

    // two runs: n = 5 takes the yes branch, n = 2 takes the no branch
    const runs = [
      { n: 5, steps: [['make', 0, null], ['dia', 1, 'md'], ['big', 2, 'yes', 'big'], ['pn', 3, 'bn', '5']] },
      { n: 2, steps: [['make', 0, null], ['dia', 1, 'md'], ['pn', 3, 'no', '2']] }
    ];
    const STEP = 1.05, RUN = 4.9, END = RUN * 2, TRAVEL = .45;
    loop(host, END, t => {
      g.setAttribute('opacity', Math.min(1, t / .3, (END - t) / .4));
      const ri = t < RUN ? 0 : 1, run = runs[ri], u = t - ri * RUN;
      codeLines[0][2].textContent = String(run.n);
      N.make.tt.textContent = `make n ${run.n}`;
      const k = Math.min(run.steps.length - 1, Math.floor((u - .4) / STEP));
      const active = u < .4 ? null : run.steps[k];
      for (const key in N) { const on = active && active[0] === key; N[key].r.setAttribute('stroke', on ? C.orange : C.line); N[key].r.setAttribute('fill', on ? HL : C.well); }
      for (const key in E) { const used = run.steps.some((st, i) => i <= k && st[2] === key) && u >= .4; E[key].setAttribute('stroke', used ? C.accent : C.dim); }
      band.setAttribute('opacity', active ? 1 : 0);
      if (active) band.setAttribute('y', LY(active[1]) - 11.5);
      vars.textContent = active ? `n = ${run.n}` : '';
      const atDia = run.steps.findIndex(st => st[0] === 'dia');
      if (u >= .4 + atDia * STEP + .35) { const yes = run.n > 3; verdict.textContent = yes ? '→ yes' : '→ no'; verdict.setAttribute('fill', yes ? GOOD : BAD); }
      else verdict.textContent = '';
      const printed = run.steps.filter((st, i) => st[3] && u >= .4 + i * STEP + .2).map(st => st[3]);
      outs.forEach((o, i) => { o.textContent = printed[i] !== undefined ? '› ' + printed[i] : (i === 0 ? '›' : ''); o.setAttribute('fill', printed[i] !== undefined ? C.ink : C.dim); });
      // token rides the edge into the active step
      const st0 = .4 + k * STEP, path = active && active[2] && E[active[2]];
      if (path && u < st0 + TRAVEL) {
        const L = path.getTotalLength(), pt = path.getPointAtLength(L * ease(Math.max(0, (u - st0) / TRAVEL)));
        token.setAttribute('cx', pt.x); token.setAttribute('cy', pt.y); token.setAttribute('opacity', 1);
      } else token.setAttribute('opacity', 0);
    }, 3.9);
  }

  /* ---------- BRIDGE: a consonant you already make, and where the tongue moves to make the new one ---------- */
  function bridge(host) {
    const svg = svgFor(host), g = el('g', {}, svg);
    const GOLD = '#cba353', SERIF = 'Georgia, "Times New Roman", serif', TONGUE = '#c9705f';
    // tongue outlines share one shape so they can morph: M, four quadratic segments, then the root
    // upper contour: a start point then quadratic segments (each pair below shares a segment count so it can morph)
    const top = p => { let d = `M${p[0]} ${p[1]}`; for (let i = 2; i < p.length; i += 4) d += ` Q${p[i]} ${p[i + 1]} ${p[i + 2]} ${p[i + 3]}`; return d; };
    const shape = p => top(p) + ` L130 138 Q104 144 78 128 Q62 118 ${p[0]} ${p[1] + 2} Z`;
    const T = {
      k: [50, 104, 54, 96, 66, 94, 90, 90, 102, 72, 110, 60, 120, 64, 130, 70, 131, 104],
      q: [50, 104, 56, 98, 70, 98, 96, 96, 110, 86, 124, 72, 131, 82, 136, 90, 133, 104],
      t: [52, 102, 50, 84, 58, 73, 60, 71, 63, 72, 66, 74, 68, 80, 86, 96, 108, 90, 124, 86, 130, 104],
      ʈ: [52, 104, 56, 82, 66, 66, 72, 60, 80, 66, 78, 74, 72, 78, 86, 92, 108, 92, 124, 88, 130, 104]
    };
    const EX = [
      { lang: 'English → Arabic', n: '4 OF 10', a: 'k', b: 'q', from: 'velar', to: 'uvular', how: 'Tongue back slides from', how2: 'the soft palate to the uvula.', A: [113, 62], B: [130, 80] },
      { lang: 'English → Hindi', n: '9 OF 17', a: 't', b: 'ʈ', from: 'alveolar', to: 'retroflex', how: 'The tip curls up and back,', how2: 'behind the tooth ridge.', A: [58, 72], B: [72, 61] }
    ];
    // vocal tract, facing left
    el('rect', { x: 8, y: 8, width: 160, height: 154, rx: 6, fill: C.well, stroke: C.line }, g);
    const vt = el('g', { fill: 'none', stroke: C.muted, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
    el('path', { d: 'M42 30 Q34 46 30 60 Q26 70 34 74 Q38 76 40 80' }, vt);                       // nose and upper lip
    el('path', { d: 'M40 100 Q32 104 34 114 Q38 128 52 134 Q72 142 88 146' }, vt);              // lower lip and chin
    el('path', { d: 'M46 76 L46 84 M46 100 L46 94' }, vt);                                         // teeth
    el('path', { d: 'M46 76 Q52 70 58 70 Q62 66 70 62 Q90 54 108 58' }, vt);                     // tooth ridge and hard palate
    el('path', { d: 'M108 58 Q122 62 128 72 Q131 80 130 84', stroke: C.ink }, vt);              // soft palate and uvula
    el('path', { d: 'M150 54 Q148 90 150 152' }, vt);                                              // back of the throat
    el('path', { d: 'M58 42 Q100 34 150 40', 'stroke-dasharray': '3 3', 'stroke-width': 1 }, vt); // nasal cavity
    const tongue = el('path', { fill: TONGUE, opacity: .9 }, g);
    const ghost = el('path', { fill: 'none', stroke: C.ink, 'stroke-width': 1, 'stroke-dasharray': '2 2.5', opacity: .45 }, g);
    const contact = el('circle', { r: 4, fill: 'none', stroke: GOLD, 'stroke-width': 1.6 }, g);
    const placeLbl = el('text', { 'font-family': MONO, 'font-size': 7.5, fill: GOLD, 'text-anchor': 'middle' }, g);

    const lang = el('text', { x: 178, y: 21, 'font-family': SANS, 'font-size': 9, fill: C.muted }, g);
    const cnt = el('text', { x: 178, y: 33, 'font-family': MONO, 'font-size': 7.5, fill: C.dim, 'letter-spacing': '.08em' }, g);
    const pair = el('text', { x: 178, y: 72, 'font-family': SERIF, 'font-size': 32 }, g);
    const pa = el('tspan', { fill: C.ink }, pair), arrow = el('tspan', { fill: C.orange, 'font-size': 20, dx: 4 }, pair), pb = el('tspan', { fill: GOLD, dx: 4 }, pair);
    arrow.textContent = '→';
    el('text', { x: 178, y: 92, 'font-family': MONO, 'font-size': 7.5, fill: C.orange, 'letter-spacing': '.08em' }, g).textContent = 'PLACE MOVES';
    const fromTo = el('text', { x: 178, y: 106, 'font-family': SANS, 'font-size': 10.5, fill: C.ink }, g);
    const how = el('text', { x: 178, y: 128, 'font-family': SANS, 'font-size': 8.5, fill: C.muted }, g);
    const how2 = el('text', { x: 178, y: 140, 'font-family': SANS, 'font-size': 8.5, fill: C.muted }, g);

    const PER = 5.2, END = PER * EX.length;
    loop(host, END, t => {
      const k = Math.min(EX.length - 1, Math.floor(t / PER)), u = t - k * PER, ex = EX[k];
      g.setAttribute('opacity', Math.min(1, u / .3, (PER - u) / .3));
      const m = kf(u, [[1.3, 0], [2.6, 1]]);
      const A = T[ex.a], B = T[ex.b];
      tongue.setAttribute('d', shape(A.map((v, i) => v + (B[i] - v) * m)));
      ghost.setAttribute('d', top(A));
      ghost.setAttribute('opacity', m > .05 ? .45 : 0);
      const cx = ex.A[0] + (ex.B[0] - ex.A[0]) * m, cy = ex.A[1] + (ex.B[1] - ex.A[1]) * m;
      contact.setAttribute('cx', cx); contact.setAttribute('cy', cy);
      placeLbl.setAttribute('x', Math.min(144, Math.max(30, cx))); placeLbl.setAttribute('y', Math.min(cy - 10, 53));
      placeLbl.textContent = m < .5 ? ex.from : ex.to;
      lang.textContent = ex.lang; cnt.textContent = 'SOUND ' + ex.n;
      pa.textContent = ex.a; pb.textContent = ex.b;
      pa.setAttribute('fill', m < .5 ? C.ink : C.muted); pb.setAttribute('fill', m >= .5 ? GOLD : C.dim);
      fromTo.textContent = `${ex.from} → ${ex.to}`;
      how.textContent = ex.how; how2.textContent = ex.how2;
    }, 4);
  }

  const kinds = { spoken, syntax, nefs, seer, vertex, bridge };
  document.querySelectorAll('[data-preview]').forEach(h => kinds[h.dataset.preview] && kinds[h.dataset.preview](h));
})();
