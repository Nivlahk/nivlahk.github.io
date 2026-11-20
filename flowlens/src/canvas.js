// Vertex canvas — a port of Vertex's render.js ideas onto FlowLens graph models:
//   layered rows (Vertex depth/YSTEP), branches spread in XSTEP slots around their decision, merge dots centred
//   between the branches they join, loop exits held below the loop body, except-handlers as islands to the left
//   behind an amber `try` bracket, functions in side-by-side columns, blank-line blocks as shells with header bars.
//   Everything is draggable: nodes, and blocks by their header. Blocks collapse; their label/colour live in the source.
import { TYPE_FILL } from './core/types.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const PAD_X = 20, PAD_Y = 10, LINE_H = 15, MAX_W = 260, CELL_H = 22, CELL_PAD = 8, BADGE_H = 18;
const ROW_GAP = 42, COL_GAP = 140, BLOCK_GAP = 34, HEADER_H = 18, BLOCK_PAD = 12;

const FILL = {
  start: '#007f00', end: '#7f0000', fn: '#92700a', ret: '#333333', raise: '#7f0000', process: '#333333', call: '#92700a', effect: '#92700a',
  output: '#ED8936', input: '#007f00', param: '#007f00', import: '#007f00', decision: '#004b8d', fork: '#5c2d91', dot: '#bbbbbb', phi: '#bbbbbb',
  handler: '#333333', finally: '#333333', badge: '#222831', dead: '#7f0000', state: '#7a4d2e', free: '#333333', const: '#1c1c24', var: '#333333',
};
const SHAPE = { start: 'ellipse', end: 'ellipse', fn: 'ellipse', ret: 'ellipse', raise: 'ellipse', free: 'ellipse', decision: 'diamond', fork: 'circle', dot: 'dot', phi: 'dot', output: 'para', input: 'para', param: 'para', var: 'var' };
const EDGE_COLOR = { yes: '#4ade80', no: '#f87171', flow: '#aaaaaa', case: '#c4b5fd', exc: '#f59e0b', data: '#9aa4b2', dataweak: '#9aa4b2', dataover: '#9aa4b2', phi: '#bbbbbb', mut: '#92700a', call: '#d4a017', maybe: '#d4a017' };
const DASHED = new Set(['exc', 'dataweak', 'dataover', 'phi', 'mut', 'call', 'maybe']);
// Vertex's type colours, lightened for text so tinted names stay readable on the #333 node fill
const TEXT_TINT = { string: '#fb923c', integer: '#93c5fd', float: '#5eead4', boolean: '#a5b4fc', none: '#fca5a5', list: '#cbd5e1', dict: '#fdba74', range: '#f9a8d4' };
void TYPE_FILL;

const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

let mctx = null;
function measure(s, size = 12, weight = 400) {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
  return mctx.measureText(s).width;
}
function wrap(text, maxW, size = 12, weight = 400) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      if (measure(cur + w, size, weight) > maxW && cur.trim()) { out.push(cur.trimEnd()); cur = w.trimStart(); } else cur += w;
    }
    out.push(cur);
  }
  return out;
}

// ---------------- geometry per node ----------------
export function geom(n) {
  const shape = SHAPE[n.vx] || 'rect';
  if (shape === 'dot') return { shape, w: 16, h: 16 };
  if (shape === 'var') {
    const t = n.table;
    const badgeW = measure(t.header, 11, 600) + 20;
    const single = t.rows.length === 1 && !t.rows[0][1];
    if (single) {
      const lines = wrap(t.rows[0][0].replace(/​/g, ''), MAX_W - PAD_X * 2);
      const tw = Math.max(...lines.map((l) => measure(l)));
      const bw = Math.max(tw + PAD_X * 2, 60, badgeW); const bh = Math.max(lines.length * LINE_H + PAD_Y * 2, 30);
      return { shape, w: bw, h: bh + BADGE_H - 4, lines, bodyH: bh, badgeW };
    }
    const cols = t.rows.some((r) => r[1]) ? 2 : 1;
    const colW = [0, 1].slice(0, cols).map((c) => Math.max(36, ...t.rows.map((r) => measure(String(r[c] || '').replace(/​/g, '')) + CELL_PAD * 2)));
    const tw = Math.max(colW.reduce((a, b) => a + b, 0), 80, badgeW);
    if (tw > colW.reduce((a, b) => a + b, 0)) { const k = tw / colW.reduce((a, b) => a + b, 0); colW.forEach((_, i) => (colW[i] *= k)); }
    return { shape, w: tw, h: BADGE_H + t.rows.length * CELL_H, table: true, colW, bodyH: t.rows.length * CELL_H, badgeW };
  }
  const lines = wrap(n.label || '', MAX_W - PAD_X * 2);
  const tw = Math.max(...lines.map((l) => measure(l)), 10);
  const th = lines.length * LINE_H;
  let w = Math.max(tw + PAD_X * 2, 60); let h = Math.max(th + PAD_Y * 2, 30);
  if (shape === 'ellipse') { w = Math.max(w * 1.15, 70); h = Math.max(h * 1.2, 36); }
  if (shape === 'diamond') { w = Math.max(tw * 1.55 + 34, 90); h = Math.max(th * 1.7 + 30, 52); }
  if (shape === 'para') w += 18;
  if (shape === 'circle') { const d = Math.max(w * 0.85, h); w = d; h = d; }
  return { shape, w, h, lines };
}

// ---------------- layout ----------------
export function layoutColumn(nodes, edges, groupsOf, bandGroups, opts) {
  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const E = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const outs = new Map(nodes.map((n) => [n.id, []])); const ins = new Map(nodes.map((n) => [n.id, []]));
  E.forEach((e) => { outs.get(e.from).push(e); ins.get(e.to).push(e); });
  // source order (Vertex orders by line, then segment); nodes without a span sit just before what they feed
  const ord = new Map();
  nodes.forEach((n, i) => { const sp = n.span || (n.spans && n.spans[0]); if (sp) ord.set(n.id, sp.sl * 1e4 + Math.min(sp.sc, 999) + i * 1e-3); });
  for (let pass = 0; pass < 6; pass++) {
    for (const n of nodes) {
      if (ord.has(n.id)) continue;
      const o = outs.get(n.id).map((e) => ord.get(e.to)).filter((v) => v != null);
      const i2 = ins.get(n.id).map((e) => ord.get(e.from)).filter((v) => v != null);
      if (o.length) ord.set(n.id, Math.min(...o) - 0.5); else if (i2.length) ord.set(n.id, Math.max(...i2) + 0.5);
    }
  }
  nodes.forEach((n, i) => { if (!ord.has(n.id)) ord.set(n.id, 1e9 + i); });
  const O = (id) => ord.get(id);

  // back edges by DFS in source order
  const back = new Set(); const state = new Map();
  const roots = nodes.filter((n) => !ins.get(n.id).length).sort((a, b) => O(a.id) - O(b.id)).map((n) => n.id);
  const rest = nodes.slice().sort((a, b) => O(a.id) - O(b.id)).map((n) => n.id);
  const dfs = (start) => {
    const stack = [[start, 0]]; state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const kids = outs.get(top[0]).slice().sort((a, b) => O(a.to) - O(b.to));
      if (top[1] >= kids.length) { state.set(top[0], 2); stack.pop(); continue; }
      const e = kids[top[1]++];
      const s = state.get(e.to);
      if (s === 1) back.add(e);
      else if (!s) { state.set(e.to, 1); stack.push([e.to, 0]); }
    }
  };
  for (const r of roots.concat(rest)) if (!state.get(r)) dfs(r);
  const F = E.filter((e) => !back.has(e));

  // loop exits sit below the whole loop body (Vertex: "the false path exits sequentially")
  const loops = [];
  const backByHead = new Map();
  for (const be of back) { if (!backByHead.has(be.to)) backByHead.set(be.to, []); backByHead.get(be.to).push(be.from); }
  for (const [h, tails] of backByHead) {
    const body = new Set([h]); const st = tails.slice();
    while (st.length) { const v = st.pop(); if (body.has(v)) continue; body.add(v); ins.get(v).forEach((e) => { if (!back.has(e)) st.push(e.from); }); }
    const exits = new Set();
    for (const m of body) for (const e of outs.get(m)) if (!body.has(e.to) && !back.has(e)) exits.add(e.to);
    loops.push({ body: [...body], exits: [...exits] });
    outs.get(h).forEach((e) => { const dn = byId.get(e.to); if (dn) dn._loopDecision = true; });
  }
  loops.sort((a, b) => a.body.length - b.body.length); // inner loops first

  // longest-path depth over the forward DAG, then constraints: loop exits below the loop body
  // (Vertex: "the false path exits sequentially"), and each block below the block before it
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  const topo = []; {
    const indeg = new Map(nodes.map((n) => [n.id, 0])); F.forEach((e) => indeg.set(e.to, indeg.get(e.to) + 1));
    const q = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id).sort((a, b) => O(a) - O(b));
    while (q.length) { const v = q.shift(); topo.push(v); for (const e of F) if (e.from === v) { indeg.set(e.to, indeg.get(e.to) - 1); if (!indeg.get(e.to)) q.push(e.to); } }
    for (const n of nodes) if (!topo.includes(n.id)) topo.push(n.id);
  }
  const fOut = new Map(nodes.map((n) => [n.id, []])); F.forEach((e) => fOut.get(e.from).push(e.to));
  const relax = () => { for (const v of topo) for (const w of fOut.get(v)) if (depth.get(v) + 1 > depth.get(w)) depth.set(w, depth.get(v) + 1); };
  relax();
  const safe = new Map(depth);
  const limit = nodes.length + 2;
  for (let round = 0; round < 40; round++) {
    let moved = false;
    for (const L of loops) {
      const md = Math.max(...L.body.map((m) => depth.get(m)));
      for (const t of L.exits) if (depth.get(t) <= md) { depth.set(t, md + 1); moved = true; }
    }
    for (const list of bandGroups) {
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1].members.filter((m) => ids.has(m)); const cur = list[i].members.filter((m) => ids.has(m));
        if (!prev.length || !cur.length) continue;
        const maxPrev = Math.max(...prev.map((m) => depth.get(m)));
        const minCur = Math.min(...cur.map((m) => depth.get(m)));
        if (minCur <= maxPrev) { const d = maxPrev + 1 - minCur; cur.forEach((m) => depth.set(m, depth.get(m) + d)); moved = true; }
      }
    }
    if (!moved) break;
    relax();
    if (Math.max(...depth.values()) > limit) { for (const [k, v] of safe) depth.set(k, v); break; }
  }
  const virt = [];

  // geometry
  const G = new Map(nodes.map((n) => [n.id, n._g]));
  const widths = nodes.map((n) => G.get(n.id).w).sort((a, b) => a - b);
  const XSTEP = Math.max(130, Math.min(240, (widths[Math.floor(widths.length / 2)] || 120) + 50));

  // rows
  const layers = new Map();
  for (const n of nodes) { const d = depth.get(n.id); if (!layers.has(d)) layers.set(d, []); layers.get(d).push(n.id); }
  const ds = [...layers.keys()].sort((a, b) => a - b);
  const Y = new Map(); let y = 0; let prevBlocks = null;
  for (const d of ds) {
    const h = Math.max(...layers.get(d).map((id) => G.get(id).h));
    const blocks = new Set(layers.get(d).map((id) => groupsOf(id)).filter(Boolean));
    if (prevBlocks && blocks.size && ![...blocks].some((b) => prevBlocks.has(b))) y += BLOCK_GAP;
    y += h / 2;
    Y.set(d, y);
    y += h / 2 + ROW_GAP;
    if (blocks.size) prevBlocks = blocks;
  }

  // x — Vertex branch slots, connector centring, then per-row collision resolution
  const X = new Map();
  const fwdOut = (id) => F.filter((e) => e.from === id).sort((a, b) => (a.label === 'yes' ? -1 : b.label === 'yes' ? 1 : 0) || O(a.to) - O(b.to));
  for (const d of ds) {
    const row = layers.get(d).slice().sort((a, b) => O(a) - O(b));
    const pref = new Map();
    for (const id of row) {
      const n = byId.get(id);
      const ps = ins.get(id).filter((e) => !back.has(e) && X.has(e.from));
      if (n.vx === 'handler' && opts.handlerAnchor) {
        const a = opts.handlerAnchor(id, X);
        if (a != null) { pref.set(id, a - XSTEP * 2.2); continue; }
      }
      if (!ps.length) { pref.set(id, 0); continue; }
      if (ps.length === 1) {
        const p = ps[0].from; const pn = byId.get(p);
        const kids = fwdOut(p).filter((e) => ps[0] === e || true);
        const spread = (pn.vx === 'decision' || pn.vx === 'fork') && !pn._loopDecision && kids.length > 1;
        if (spread) {
          const k = kids.length; const idx = kids.findIndex((e) => e.to === id);
          pref.set(id, X.get(p) + (idx - (k - 1) / 2) * XSTEP);
        } else pref.set(id, X.get(p));
      } else {
        const xs = ps.map((e) => X.get(e.from));
        pref.set(id, (Math.min(...xs) + Math.max(...xs)) / 2);
      }
    }
    // snap to the half-step grid (Vertex snaps to XSTEP), then push apart anything that overlaps
    const snap = (v) => Math.round(v / (XSTEP / 2)) * (XSTEP / 2);
    const items = row.map((id) => ({ id, x: snap(pref.get(id)), w: G.get(id).w })).sort((a, b) => a.x - b.x || O(a.id) - O(b.id));
    const before = items.reduce((s, it) => s + it.x, 0);
    for (let i = 1; i < items.length; i++) {
      const min = items[i - 1].x + items[i - 1].w / 2 + 34 + items[i].w / 2;
      if (items[i].x < min) items[i].x = min;
    }
    const shift = items.length > 1 ? (before - items.reduce((s, it) => s + it.x, 0)) / items.length : 0;
    items.forEach((it) => X.set(it.id, it.x + (items.length > 1 ? shift : 0)));
  }
  const pos = new Map();
  for (const n of nodes) pos.set(n.id, { x: X.get(n.id), y: Y.get(depth.get(n.id)), w: G.get(n.id).w, h: G.get(n.id).h });
  return { pos, back, XSTEP, depth, virt };
}

// ---------------- the canvas ----------------
export class VertexCanvas {
  constructor(host, hooks) {
    this.host = host; this.hooks = hooks;
    this.svg = null; this.model = null; this.pos = new Map(); this.records = new Map(); this.elems = new Map();
    this.layoutState = { nodes: {}, blocks: {} };
  }

  // stable keys survive edits that don't touch a node's own text
  keyOf(n) { return `${n.vx}|${n.table ? n.table.header : n.label}`; }

  render(model, { colors = {}, layoutState }) {
    this.model = model; this.colors = colors;
    this.layoutState = layoutState || { nodes: {}, blocks: {} };
    const groups = model.groups || [];
    const gById = new Map(groups.map((g) => [g.id, g]));
    const nodes = model.nodes.map((n) => ({ ...n }));
    // node keys
    const seen = new Map();
    for (const n of nodes) { const k = this.keyOf(n); const c = seen.get(k) || 0; seen.set(k, c + 1); n._key = k + '#' + c; }
    // group keys
    for (const g of groups) g._key = g.vx === 'sblock' ? `sb|${g.parent || ''}|${g.seg ? g.seg.firstText : g.segIndex}` : `${g.vx}|${g.label}|${g.id}`;
    const collapsed = new Set(groups.filter((g) => (this.layoutState.blocks[g._key] || {}).collapsed).map((g) => g.id));
    const ancestors = (pid) => { const a = []; for (let p = pid; p; p = (gById.get(p) || {}).parent) a.push(p); return a; };
    for (const n of nodes) { n._anc = ancestors(n.parent); n._hidden = n._anc.some((a) => collapsed.has(a)); n._g = geom(n); }
    const visibleNodes = nodes.filter((n) => !n._hidden);
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const membersOf = (gid) => nodes.filter((n) => n._anc.includes(gid)).map((n) => n.id);
    // collapsed blocks stand in for their members as a single header-sized node
    const proxies = groups.filter((g) => collapsed.has(g.id) && !ancestors(g.parent).some((a) => collapsed.has(a))).map((g) => {
      const label = '▸ ' + (g.label || 'block') + `  (${membersOf(g.id).length})`;
      return { id: '@' + g.id, vx: 'proxy', label, parent: g.parent, _anc: ancestors(g.parent), _g: { shape: 'proxy', w: Math.max(measure(label, 11, 600) + 30, 120), h: HEADER_H + 8 }, span: g.span, _group: g };
    });
    const hiddenTo = new Map();
    for (const n of nodes) if (n._hidden) { const top = n._anc.slice().reverse().find((a) => collapsed.has(a)); hiddenTo.set(n.id, '@' + top); }
    const mapId = (id) => (hiddenTo.has(id) ? hiddenTo.get(id) : id);
    const groupTarget = (id) => (gById.has(id) ? (membersOf(id).map(mapId)[0] || null) : id);
    let edges = model.edges.map((e) => ({ ...e, a: mapId(groupTarget(e.from)), b: mapId(e.to) })).filter((e) => e.a && e.b && !(e.a === e.b && hiddenTo.has(e.from)));
    const layoutNodes = visibleNodes.concat(proxies);

    // columns (module altitude): each laid out alone, then placed side by side like Vertex's function columns
    const colOf = (n) => n._anc.find((a) => (gById.get(a) || {}).vx === 'col') || '';
    const cols = new Map();
    for (const n of layoutNodes) { const c = colOf(n); if (!cols.has(c)) cols.set(c, []); cols.get(c).push(n); }
    const colOrder = [...cols.keys()].sort((a, b) => groups.findIndex((g) => g.id === a) - groups.findIndex((g) => g.id === b));
    const bandable = (g) => g.vx === 'sblock' || g.vx === 'stmtbox';
    const groupsOf = (id) => { const n = nodeById.get(id) || proxies.find((p) => p.id === id); return n ? n._anc.find((a) => (gById.get(a) || {}).vx === 'sblock') : null; };
    const pos = new Map(); let cursorX = 0; this.back = new Set();
    for (const c of colOrder) {
      const cn = cols.get(c);
      const cIds = new Set(cn.map((n) => n.id));
      const bandGroups = [];
      const byParent = new Map();
      for (const g of groups) if (bandable(g)) { const k = g.parent || ''; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(g); }
      for (const list of byParent.values()) {
        const withM = list.map((g) => ({ g, members: (collapsed.has(g.id) ? ['@' + g.id] : membersOf(g.id).filter((m) => cIds.has(m))) })).filter((x) => x.members.length);
        const ordOf = (x) => Math.min(...x.members.map((m) => { const n = nodeById.get(m) || proxies.find((p) => p.id === m); const sp = n && (n.span || (n.spans && n.spans[0])); return sp ? sp.sl : 1e9; }));
        withM.sort((a, b) => ordOf(a) - ordOf(b));
        if (withM.length > 1) bandGroups.push(withM);
      }
      const handlerAnchor = (id, X) => {
        const tg = groups.find((g) => g.vx === 'try' && model.edges.some((e) => e.from === g.id && e.to === id));
        if (!tg) return null;
        const xs = membersOf(tg.id).filter((m) => X.has(m)).map((m) => X.get(m));
        return xs.length ? Math.min(...xs) : null;
      };
      const L = layoutColumn(cn, edges.map((e) => ({ ...e, from: e.a, to: e.b })), groupsOf, bandGroups, { handlerAnchor });
      L.back.forEach((e) => this.back.add(e.from + '>' + e.to));
      let minX = Infinity; let maxX = -Infinity;
      for (const [id, p] of L.pos) { minX = Math.min(minX, p.x - p.w / 2); maxX = Math.max(maxX, p.x + p.w / 2); }
      const dx = cursorX - minX + 60;
      for (const [id, p] of L.pos) pos.set(id, { ...p, x: p.x + dx, y: p.y + 70 });
      cursorX = maxX + dx + COL_GAP;
    }
    // user moves: per-node offsets, then per-block offsets (by header drag)
    const allNodes = layoutNodes;
    for (const n of allNodes) {
      const p = pos.get(n.id); if (!p) continue;
      const key = n._key || ('proxy|' + n._group._key);
      const off = this.layoutState.nodes[key];
      if (off) { p.x += off.dx; p.y += off.dy; }
      for (const a of n._anc) { const g = gById.get(a); const bo = g && this.layoutState.blocks[g._key]; if (bo && (bo.dx || bo.dy)) { p.x += bo.dx || 0; p.y += bo.dy || 0; } }
    }
    this.pos = pos; this.nodes = allNodes; this.edges = edges; this.groups = groups; this.gById = gById; this.membersOf = membersOf; this.collapsed = collapsed;
    this.draw();
  }

  // ---------------- drawing ----------------
  draw() {
    const host = this.host;
    host.innerHTML = '';
    const svg = el('svg', { xmlns: NS, 'font-family': FONT_FAMILY }, host);
    this.svg = svg;
    this.gShells = el('g', {}, svg); this.gEdges = el('g', {}, svg); this.gNodes = el('g', {}, svg);
    this.records = new Map(); this.elems = new Map();
    for (const n of this.nodes) this.drawNode(n);
    this.drawShells();
    this.drawEdges();
    this.fitBounds();
  }

  fitBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x1, y1, x2, y2) => { minX = Math.min(minX, x1); minY = Math.min(minY, y1); maxX = Math.max(maxX, x2); maxY = Math.max(maxY, y2); };
    for (const p of this.pos.values()) grow(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2);
    for (const b of this.shellBoxes || []) grow(b.x - 70, b.y, b.x + b.w, b.y + b.h);
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 400; maxY = 300; }
    const pad = 60;
    this.bounds = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    this.svg.setAttribute('viewBox', `${this.bounds.x} ${this.bounds.y} ${this.bounds.w} ${this.bounds.h}`);
    this.svg.setAttribute('width', this.bounds.w); this.svg.setAttribute('height', this.bounds.h);
  }

  label(parent, lines, cx, cy, opts = {}) {
    const size = opts.size || 12;
    const t = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': size, fill: opts.fill || '#eeeeee', 'font-weight': opts.weight || 400 }, parent);
    const start = cy - (LINE_H * lines.length) / 2 + LINE_H / 2;
    const names = opts.tint ? Object.keys(this.colors).filter((k) => TEXT_TINT[this.colors[k]] && /^[A-Za-z_]\w*$/.test(k)) : [];
    const re = names.length ? new RegExp('\\b(' + names.sort((a, b) => b.length - a.length).join('|') + ')\\b', 'g') : null;
    lines.forEach((line, i) => {
      const y = start + i * LINE_H;
      if (!re) { const ts = el('tspan', { x: cx, y }, t); ts.textContent = line; return; }
      let last = 0; let m; let first = true; re.lastIndex = 0;
      const add = (s, c) => { const ts = el('tspan', first ? { x: cx, y } : {}, t); first = false; ts.textContent = s; if (c) ts.setAttribute('fill', c); };
      while ((m = re.exec(line))) { if (m.index > last) add(line.slice(last, m.index)); add(m[0], TEXT_TINT[this.colors[m[0]]]); last = m.index + m[0].length; }
      if (last < line.length || first) add(line.slice(last));
    });
    return t;
  }

  drawNode(n) {
    const p = this.pos.get(n.id); if (!p) return;
    const g = el('g', { 'data-fl': n.id, transform: `translate(${p.x},${p.y})` }, this.gNodes);
    if (n.dim) g.setAttribute('opacity', '0.35');
    const G = n._g; const w = G.w; const h = G.h;
    const fill = n.fill || FILL[n.vx] || '#333333';
    const stroke = n.vx === 'handler' || n.vx === 'finally' ? '#f59e0b' : n.vx === 'const' ? '#555555' : '#cccccc';
    const dash = n.dashed || n.vx === 'dead' || n.vx === 'free' || n.vx === 'finally' ? '4 3' : null;
    const common = { fill, stroke, 'stroke-width': n.vx === 'effect' ? 2.5 : 1.5, 'stroke-dasharray': dash, class: 'shape' };
    let shapeEl;
    switch (G.shape) {
      case 'proxy': {
        const gr = n._group; const col = gr.color || null;
        shapeEl = el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 6, fill: col || 'rgba(40,40,70,0.9)', 'fill-opacity': col ? 0.3 : 1, stroke: col || 'rgba(255,255,255,0.15)', class: 'shape' }, g);
        this.label(g, [n.label], 0, 0, { size: 11, weight: 600, fill: '#e5e7eb' });
        g.dataset.block = gr.id;
        break;
      }
      case 'ellipse': shapeEl = el('ellipse', { cx: 0, cy: 0, rx: w / 2, ry: h / 2, ...common }, g); break;
      case 'diamond': shapeEl = el('polygon', { points: `0,${-h / 2} ${w / 2},0 0,${h / 2} ${-w / 2},0`, ...common }, g); break;
      case 'circle': shapeEl = el('circle', { cx: 0, cy: 0, r: w / 2, ...common }, g); break;
      case 'dot': shapeEl = el('circle', { cx: 0, cy: 0, r: 8, fill: '#bbbbbb', stroke: '#cccccc', 'stroke-width': 1.5, class: 'shape' }, g); break;
      case 'para': { const s = 12; shapeEl = el('polygon', { points: `${-w / 2 + s},${-h / 2} ${w / 2},${-h / 2} ${w / 2 - s},${h / 2} ${-w / 2},${h / 2}`, ...common }, g); break; }
      case 'var': {
        const t = n.table; const top = -h / 2;
        const badgeColor = t.fill || '#222831';
        shapeEl = el('rect', { x: -w / 2, y: top + BADGE_H - 4, width: w, height: G.bodyH, rx: 4, fill: '#333333', stroke: '#cccccc', 'stroke-width': 1.5, class: 'shape' }, g);
        if (G.table) {
          let cy = top + BADGE_H;
          t.rows.forEach((r, ri) => {
            let cx = -w / 2;
            el('rect', { x: cx, y: cy, width: w, height: CELL_H, fill: ri % 2 ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.04)' }, g);
            G.colW.forEach((cw, ci) => {
              if (ci) el('line', { x1: cx, y1: cy, x2: cx, y2: cy + CELL_H, stroke: '#4b5563', 'stroke-width': 0.6 }, g);
              const txt = String(r[ci] || '').replace(/​/g, '');
              if (txt) this.label(g, [txt], cx + cw / 2, cy + CELL_H / 2 + 1, { tint: true });
              cx += cw;
            });
            if (ri) el('line', { x1: -w / 2, y1: cy, x2: w / 2, y2: cy, stroke: '#4b5563', 'stroke-width': 0.6 }, g);
            cy += CELL_H;
          });
        } else {
          this.label(g, G.lines, 0, top + BADGE_H - 4 + G.bodyH / 2, { tint: true });
        }
        const bw = Math.min(w, Math.max(G.badgeW, 40));
        el('rect', { x: -bw / 2, y: top, width: bw, height: BADGE_H, rx: 4, fill: badgeColor, stroke: '#cccccc', 'stroke-width': 1 }, g);
        this.label(g, [t.header], 0, top + BADGE_H / 2 + 1, { size: 11, weight: 600 });
        break;
      }
      default: shapeEl = el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 4, ...common }, g);
    }
    if (G.shape !== 'var' && G.shape !== 'dot' && G.shape !== 'proxy') {
      const tint = !['fn', 'start', 'end', 'badge', 'dead', 'param', 'state', 'call', 'effect', 'output', 'input', 'import', 'raise', 'decision', 'fork'].includes(n.vx);
      this.label(g, G.lines, 0, 0, { tint, fill: n.vx === 'const' ? '#aaaaaa' : '#eeeeee', weight: n.vx === 'badge' || n.vx === 'dead' ? 600 : 400 });
    }
    if (n.vx === 'phi') { const t = el('text', { x: 13, y: 4, 'font-size': 11, fill: '#bbbbbb' }, g); t.textContent = n.label; }
    void shapeEl;
    if (!n._group) {
      this.records.set(n.id, { id: n.id, vx: n.vx, spans: n.spans || (n.span ? [n.span] : []), key: n._key });
      this.elems.set(n.id, [g]);
    }
    this.hooks.bindNode(g, n);
  }

  // group boxes are measured from what they contain (Vertex renderBlockBg)
  boxOf(gid) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      if (!n._anc.includes(gid) || n.id === '@' + gid) continue;
      const p = this.pos.get(n.id); if (!p) continue;
      minX = Math.min(minX, p.x - p.w / 2); maxX = Math.max(maxX, p.x + p.w / 2); minY = Math.min(minY, p.y - p.h / 2); maxY = Math.max(maxY, p.y + p.h / 2);
    }
    for (const g of this.groups) {
      if (g.parent !== gid) continue;
      const b = this.boxOf(g.id); if (!b) continue;
      minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX); minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
    }
    if (!isFinite(minX)) return null;
    const pad = this.gById.get(gid).vx === 'try' ? 6 : BLOCK_PAD + (this.groups.some((g) => g.parent === gid && g.vx !== 'try' && g.vx !== 'bb') ? 8 : 0);
    return { minX: minX - pad, minY: minY - pad - (this.gById.get(gid).vx === 'try' || this.gById.get(gid).vx === 'bb' ? 0 : HEADER_H), maxX: maxX + pad, maxY: maxY + pad };
  }

  drawShells() {
    this.gShells.innerHTML = '';
    this.shellBoxes = [];
    const depthOf = (g) => { let d = 0; for (let p = g.parent; p; p = (this.gById.get(p) || {}).parent) d++; return d; };
    const order = this.groups.slice().sort((a, b) => depthOf(a) - depthOf(b));
    for (const g of order) {
      if (g.vx === 'col' || this.collapsed.has(g.id)) continue;
      if ([...this.collapsed].some((c) => { for (let p = g.parent; p; p = (this.gById.get(p) || {}).parent) if (p === c) return true; return false; })) continue;
      const b = this.boxOf(g.id); if (!b) continue;
      const x = b.minX, y = b.minY, w = b.maxX - b.minX, h = b.maxY - b.minY;
      const sg = el('g', { 'data-group': g.id }, this.gShells);
      if (g.vx === 'try') {
        // Vertex's amber try bracket
        const bx = x - 10, arm = 10;
        el('path', { d: `M ${bx + arm} ${y} L ${bx} ${y} L ${bx} ${y + h} L ${bx + arm} ${y + h}`, fill: 'none', stroke: '#f59e0b', 'stroke-width': 2 }, sg);
        const t = el('text', { x: bx - 5, y: y + h / 2 + 4, 'text-anchor': 'end', 'font-family': 'ui-monospace, monospace', 'font-size': 11, fill: '#f59e0b' }, sg); t.textContent = 'try';
        this.shellBoxes.push({ x: bx - 30, y, w: w + 40, h, id: g.id, bracket: { x: bx, y: y + h / 2 } });
        continue;
      }
      if (g.vx === 'bb') {
        el('rect', { x, y, width: w, height: h, rx: 6, fill: 'none', stroke: '#3a3a5c', 'stroke-dasharray': '3 3' }, sg);
        this.shellBoxes.push({ x, y, w, h, id: g.id });
        continue;
      }
      const col = (g.color || '').trim();
      el('rect', { x, y, width: w, height: h, rx: 8, fill: col || 'rgba(255,255,255,0.025)', 'fill-opacity': col ? 0.07 : 1, stroke: col || 'rgba(255,255,255,0.09)', 'stroke-opacity': col ? 0.45 : 1 }, sg);
      const header = el('rect', { x, y, width: w, height: HEADER_H, rx: 5, fill: col || 'rgba(40,40,70,0.9)', 'fill-opacity': col ? 0.24 : 1, stroke: col || 'rgba(255,255,255,0.07)', 'stroke-opacity': col ? 0.7 : 1, class: 'blockhdr' }, sg);
      header.dataset.block = g.id;
      const lbl = el('text', { x: x + 8, y: y + HEADER_H - 5, 'font-size': g.vx === 'classcol' ? 11 : 10, 'font-weight': g.vx === 'classcol' ? 600 : 400, fill: col ? '#e5e7eb' : '#9ca3af', class: 'blocklbl' }, sg);
      lbl.textContent = g.label || 'Block';
      lbl.dataset.block = g.id;
      const chev = el('text', { x: x + w - 12, y: y + HEADER_H - 5, 'font-size': 10, fill: '#9ca3af', class: 'blockchev', 'text-anchor': 'middle' }, sg);
      chev.textContent = '▾'; chev.dataset.block = g.id;
      this.shellBoxes.push({ x, y, w, h, id: g.id });
      this.hooks.bindBlock(sg, g);
      if (g.span) { this.records.set(g.id, { id: g.id, vx: 'group', spans: [g.span], group: true }); this.elems.set(g.id, [sg]); }
    }
  }

  // Vertex drawEdge: quadratic curves, bowing around nodes; back edges swing out to the side, alternating
  drawEdges() {
    this.gEdges.innerHTML = '';
    let bowSign = 1;
    const shellById = new Map((this.shellBoxes || []).map((b) => [b.id, b]));
    for (const e of this.edges) {
      const fromGroup = this.gById.has(e.from) && !this.collapsed.has(e.from);
      const fp = fromGroup ? null : this.pos.get(e.a); const tp = this.pos.get(e.b);
      if (!tp) continue;
      const color = e.color || EDGE_COLOR[e.vx] || '#aaaaaa';
      const dash = DASHED.has(e.vx) ? (e.vx === 'maybe' ? '2 3' : '5 4') : null;
      let d; let lx, ly;
      if (fromGroup) {
        const sb = shellById.get(e.from); if (!sb || !sb.bracket) continue;
        const x1 = sb.bracket.x, y1 = sb.bracket.y, x2 = tp.x + tp.w / 2, y2 = tp.y;
        const c = x1 - 40;
        d = `M ${x1} ${y1} C ${c} ${y1} ${c} ${y2} ${x2} ${y2}`;
        this.arrow(d, color, dash, x2, y2, Math.atan2(0, 1) + Math.PI, null);
        continue;
      }
      if (!fp) continue;
      const x1 = fp.x, y1 = fp.y + fp.h / 2, x2 = tp.x, y2 = tp.y - tp.h / 2;
      const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
      if (e.a === e.b) {
        const r = fp.w / 2 + 30;
        d = `M ${fp.x + fp.w / 2} ${fp.y} C ${fp.x + r + 30} ${fp.y - 40} ${fp.x + r + 30} ${fp.y + 40} ${fp.x + fp.w / 2} ${fp.y + 6}`;
        this.arrow(d, color, dash, fp.x + fp.w / 2, fp.y + 6, Math.PI, e.label ? [fp.x + r + 34, fp.y] : null, e.label, color);
        continue;
      }
      let cpX;
      if (this.back.has(e.a + '>' + e.b)) {
        // back edge: leave from the side, swing wide, come back into the target's side
        const side = bowSign; bowSign *= -1;
        const sx = fp.x + side * fp.w / 2, sy = fp.y, tx = tp.x + side * tp.w / 2, ty = tp.y;
        const out = 46 + Math.min(Math.abs(sx - tx) * 0.15, 40);
        const cx = side > 0 ? Math.max(sx, tx) + out : Math.min(sx, tx) - out;
        d = `M ${sx} ${sy} C ${cx} ${sy} ${cx} ${ty} ${tx} ${ty}`;
        this.arrow(d, color, dash, tx, ty, side > 0 ? Math.PI : 0, e.label ? [cx, (sy + ty) / 2] : null, e.label, color);
        continue;
      }
      const nat = 0.3 * (x2 - x1);
      const avoid = this.clearance(x1, y1, x2, y2, e.a, e.b);
      cpX = midX + nat + (avoid ? -Math.sign(avoid) * 90 : 0);
      d = `M ${x1} ${y1} Q ${cpX} ${midY} ${x2} ${y2}`;
      const ang = Math.atan2(y2 - midY, x2 - cpX);
      lx = (x1 + 2 * cpX + x2) / 4; ly = (y1 + 2 * midY + y2) / 4;
      this.arrow(d, color, dash, x2, y2, ang, e.label ? [lx + 6, ly] : null, e.label, color);
    }
  }

  clearance(x1, y1, x2, y2, a, b) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy); if (!len) return 0;
    const ux = dx / len, uy = dy / len, midX = (x1 + x2) / 2; let sum = 0, cnt = 0;
    for (const [id, p] of this.pos) {
      if (id === a || id === b) continue;
      const t = Math.max(0, Math.min(1, ((p.x - x1) * ux + (p.y - y1) * uy) / len));
      const px = x1 + t * ux * len, py = y1 + t * uy * len;
      if (Math.abs(p.x - px) < p.w / 2 + 14 && Math.abs(p.y - py) < p.h / 2 + 14) { sum += p.x - midX; cnt++; }
    }
    return cnt ? sum / cnt || 1 : 0;
  }

  arrow(d, color, dash, x2, y2, ang, labelAt, label, lcolor) {
    el('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': dash }, this.gEdges);
    const AS = 7;
    el('polygon', { points: [[x2, y2], [x2 - AS * Math.cos(ang - Math.PI / 7), y2 - AS * Math.sin(ang - Math.PI / 7)], [x2 - AS * Math.cos(ang + Math.PI / 7), y2 - AS * Math.sin(ang + Math.PI / 7)]].map((p) => p.join(',')).join(' '), fill: color }, this.gEdges);
    if (labelAt && label) {
      const t = el('text', { x: labelAt[0], y: labelAt[1], 'font-size': 11, fill: lcolor || color, 'text-anchor': 'start', 'paint-order': 'stroke', stroke: '#0f0f14', 'stroke-width': 3 }, this.gEdges);
      t.textContent = label;
    }
  }

  // ---------------- moving things ----------------
  moveNode(id, dx, dy) {
    const p = this.pos.get(id); if (!p) return;
    p.x += dx; p.y += dy;
    const g = this.gNodes.querySelector(`g[data-fl="${CSS.escape(id)}"]`);
    if (g) g.setAttribute('transform', `translate(${p.x},${p.y})`);
  }
  commitNode(id, dx, dy) {
    const n = this.nodes.find((x) => x.id === id); if (!n) return;
    const key = n._key || ('proxy|' + n._group._key);
    const o = this.layoutState.nodes[key] || { dx: 0, dy: 0 };
    this.layoutState.nodes[key] = { dx: o.dx + dx, dy: o.dy + dy };
  }
  moveBlock(gid, dx, dy) {
    for (const n of this.nodes) if (n._anc.includes(gid) || n.id === '@' + gid) this.moveNode(n.id, dx, dy);
  }
  commitBlock(gid, dx, dy) {
    const g = this.gById.get(gid); const st = this.layoutState.blocks[g._key] || {};
    this.layoutState.blocks[g._key] = { ...st, dx: (st.dx || 0) + dx, dy: (st.dy || 0) + dy };
  }
  toggleCollapse(gid) {
    const g = this.gById.get(gid); const st = this.layoutState.blocks[g._key] || {};
    this.layoutState.blocks[g._key] = { ...st, collapsed: !st.collapsed };
  }
  redrawLinks(refit = true) { this.drawShells(); this.drawEdges(); if (refit) this.fitBounds(); }
}
