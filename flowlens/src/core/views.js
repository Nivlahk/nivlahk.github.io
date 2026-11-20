// Altitude × view → one GraphModel, drawn in Vertex's visual grammar (see Vertex render.js / graph.js):
//   Start/End ovals (green/red) · gold function ovals "name\n(params)" · blue Decision diamonds with yes/no edges ·
//   grey Connector dots at every merge and at every loop head · variable assignments as a type-colored title badge over
//   the value (lists/dicts as tables) · orange Output / green Input parallelograms · gold call boxes · purple Fork circles ·
//   a `try` bracket with its handler as a side island · each function its own column.
import { buildCFG, basicBlocks, collectScopes } from './cfg.js';
import { reachingDefs, defUse, valueGraph } from './flow.js';
import { callGraph, makeResolver, eachExpr } from './calls.js';
import { inferEnv, typeOf, colorOf, BADGE, DEFAULT_TITLE } from './types.js';
import { squash } from './word.js';

export function analyze(mod, lang) {
  const { scopes, classes } = collectScopes(mod, lang);
  return { mod, lang, scopes, classes, cache: new Map(), resolve: makeResolver(scopes, classes, lang) };
}

function scopeData(A, scope) {
  if (A.cache.has(scope.id)) return A.cache.get(scope.id);
  const cfg = buildCFG(scope, A.lang);
  const rd = reachingDefs(cfg);
  const env = inferEnv(cfg, scope);
  const d = { cfg, rd, env };
  A.cache.set(scope.id, d);
  return d;
}

// ---------------- node appearance ----------------
const OUTPUT_FN = /^(print|console\.(log|error|warn|info)|alert|document\.write|sys\.stdout\.write|pprint)$/;
const INPUT_FN = /^(input|prompt|readline|sys\.stdin\.readline)$/;
const calleeName = (e) => (e && e.k === 'call' && e.callee ? (e.callee.k === 'name' ? e.callee.name : e.callee.path || e.callee.name || '') : '');

function decisionLabel(n) {
  const s = n.stmt;
  let t;
  if (n.part === 'switch') return squash(s.subject ? s.subject.text : n.label, 26);
  if (n.part === 'cfor') t = s.test ? s.test.text : 'forever';
  else if (n.part === 'for') {
    t = n.label.replace(/^for\s*/, '');
    if (t.startsWith('(')) t = t.replace(/^\(\s*(const|let|var)?\s*/, '').replace(/\)\s*$/, '');
    t = 'next ' + t;
  } else if (n.part === 'assert') t = s.e ? s.e.text : n.label.replace(/^assert\s*/, '');
  else t = n.label.replace(/^(else\s+if|elif|if|while)\b\s*/, '');
  t = t.trim();
  if (/^\(.*\)$/.test(t)) t = t.slice(1, -1).trim();
  const parts = t.split(/\s+(and|or|&&|\|\|)\s+/);
  const lines = [parts[0]];
  for (let i = 1; i < parts.length; i += 2) lines.push(`${parts[i]} ${parts[i + 1] || ''}`.trim());
  return lines.map((l) => squash(l, 34)).join('\n') + '?';
}

function fnLabel(name, params) { return `${name}\n(${params.join(', ')})`; }

function uniqRows(rows) {
  const seen = new Map();
  return rows.map(([k, v]) => {
    const c = seen.get(k) || 0; seen.set(k, c + 1);
    return [k + '​'.repeat(c), v];
  });
}

function varTable(s, env) {
  const header = squash(s.targets.map((t) => t.text).join(' = '), 30);
  const v = s.value;
  if (!v) return { header, rows: [['—', '']], fill: DEFAULT_TITLE };
  if (s.aug) {
    const t = typeOf(s.targets[0], env) || typeOf(v, env);
    return { header, rows: [[`${s.aug}= ${squash(v.text, 34)}`, '']], fill: colorOf(t) || DEFAULT_TITLE };
  }
  const t = typeOf(v, env);
  const t0 = s.targets[0];
  if (s.targets.length === 1 && t0.k === 'tuple' && v.k === 'build' && v.ins.length === t0.items.length) {
    return { header, rows: uniqRows(t0.items.map((it, i) => [it.text, squash(v.ins[i].e.text, 30)])), fill: DEFAULT_TITLE };
  }
  if (v.k === 'build' && v.ins.length > 1 && v.ins.length <= 8 && v.ins.every((i) => i.e && i.e.text.length <= 20)) {
    if (t === 'dict' && v.label === '{ : }') {
      const rows = [];
      for (let i = 0; i + 1 < v.ins.length; i += 2) rows.push([v.ins[i].e.text, v.ins[i + 1].e.text]);
      return { header, rows: uniqRows(rows), fill: BADGE.dict };
    }
    if (t === 'dict') return { header, rows: uniqRows(v.ins.map((i) => [i.label || i.e.text, i.e.text === i.label ? '' : i.e.text])), fill: BADGE.dict };
    if (t === 'list') return { header, rows: uniqRows(v.ins.map((i, k) => [i.e.text, String(k)])), fill: BADGE.list };
  }
  return { header, rows: [[squash(v.text, 38), '']], fill: colorOf(t) || DEFAULT_TITLE };
}

export function nodeVx(n, scope, env) {
  const s = n.stmt;
  switch (n.kind) {
    case 'entry': return scope.kind === 'module' ? { vx: 'start', label: 'start' } : { vx: 'fn', label: fnLabel(scope.name, scope.params) };
    case 'exit': return { vx: 'end', label: 'end' };
    case 'cond':
      if (n.part === 'switch') return { vx: 'fork', label: squash(s.subject ? s.subject.text : n.label, 22) };
      return { vx: 'decision', label: decisionLabel(n) };
    case 'loop': return { vx: 'decision', label: decisionLabel(n) };
    case 'return': return { vx: 'ret', label: n.label };
    case 'raise': return { vx: 'raise', label: n.label };
    case 'handler': return { vx: 'handler', label: n.label };
    case 'finally': return { vx: 'finally', label: 'finally' };
    case 'case': return { vx: 'decision', label: n.label.replace(/^case\s*/, '') + '?' };
    case 'def': return { vx: 'fn', label: s.k === 'class' ? `class ${s.name}` : fnLabel(s.name, s.params || []) };
    case 'with': return { vx: 'process', label: n.label };
    default: break;
  }
  if (!s) return { vx: 'process', label: n.label };
  if (s.k === 'assign') {
    if (s.value && INPUT_FN.test(calleeName(s.value))) return { vx: 'input', label: n.label };
    return { vx: 'var', label: '', table: varTable(s, env) };
  }
  if (s.k === 'expr') {
    const cn = calleeName(s.e);
    if (OUTPUT_FN.test(cn)) return { vx: 'output', label: n.label };
    if (INPUT_FN.test(cn)) return { vx: 'input', label: n.label };
    if (s.e && (s.e.k === 'call' || s.e.k === 'op' && s.e.op === 'await')) return { vx: 'call', label: n.label };
    return { vx: 'process', label: n.label };
  }
  if (s.k === 'import') return { vx: 'import', label: n.label };
  return { vx: 'process', label: n.label };
}

// ---------------- control flowchart (Vertex's graph.js shape) ----------------
const YES = new Set(['true', 'next', 'ok', 'yes']);
const NO = new Set(['false', 'done', 'no', 'fails', 'no match']);

function edgeVx(e) {
  if (e.kind === 'exc') return { label: '', vx: 'exc' };
  if (YES.has(e.label)) return { label: 'yes', vx: 'yes' };
  if (NO.has(e.label)) return { label: e.label === 'no match' ? 'no match' : 'no', vx: 'no' };
  if (e.label && e.label.startsWith('case:')) return { label: e.label.slice(5), vx: 'case' };
  return { label: '', vx: 'flow' };
}

export function controlChart(A, scope, opts, prefix = '') {
  const { cfg, env } = scopeData(A, scope);
  const P = (id) => prefix + id;
  const nodes = new Map(); let edges = [];
  for (const n of cfg.nodes) {
    const look = nodeVx(n, scope, env);
    nodes.set(n.id, { id: P(n.id), cfgId: n.id, ...look, span: n.span, dim: n.unreachable && n.kind !== 'exit', kind: n.kind });
  }
  // fork edges carry their case pattern, the way Vertex labels branches
  for (const e of cfg.edges) {
    const to = cfg.byId.get(e.to);
    const label = to && to.kind === 'case' && cfg.byId.get(e.from).part === 'switch' ? 'case:' + squash(to.label.replace(/^case\s*/, ''), 24) : e.label;
    edges.push({ from: e.from, to: e.to, label, kind: e.kind });
  }
  // contract nodes Vertex never draws: break/continue (they are just edges), try headers (the bracket stands for them), case heads (the fork edge says it)
  const groups = [];
  const excFromTry = new Map();
  for (const tg of cfg.tryGroups) excFromTry.set(tg.tryId, tg);
  const contract = (id) => {
    const ins = edges.filter((e) => e.to === id); const outs = edges.filter((e) => e.from === id && e.kind !== 'exc');
    edges = edges.filter((e) => e.to !== id && e.from !== id);
    for (const a of ins) for (const b of outs) {
      const label = a.label || b.label;
      const kind = a.kind !== 'normal' && a.kind !== 'break' && a.kind !== 'continue' ? a.kind : b.kind === 'back' || a.kind === 'continue' ? 'back' : b.kind;
      if (!edges.some((x) => x.from === a.from && x.to === b.to && x.label === label)) edges.push({ from: a.from, to: b.to, label, kind });
    }
    nodes.delete(id);
  };
  for (const n of cfg.nodes) {
    if (n.kind === 'try') {
      const tg = excFromTry.get(n.id);
      for (const e of edges.filter((x) => x.from === n.id && x.kind === 'exc')) e.from = 'grp_' + n.id;
      contract(n.id);
      if (tg) groups.push({ id: 'grp_' + n.id, label: 'try', vx: 'try', members: tg.members, span: n.span });
    } else if (n.kind === 'jump' || n.kind === 'case') contract(n.id);
  }
  // Vertex: a loop is a connector dot (the loop head, where back edges land) followed by its decision
  for (const n of cfg.nodes) {
    if (n.kind !== 'loop' || !nodes.has(n.id)) continue;
    const dot = 'lh_' + n.id;
    nodes.set(dot, { id: P(dot), vx: 'dot', label: '', span: n.span, owner: n.id });
    edges.forEach((e) => { if (e.to === n.id) e.to = dot; });
    edges.push({ from: dot, to: n.id, label: '', kind: 'normal' });
  }
  // …and every other merge goes through a connector dot too (Vertex's if-join)
  for (const [id, nd] of [...nodes]) {
    if (nd.vx === 'dot' || nd.kind === 'handler') continue;
    const ins = edges.filter((e) => e.to === id && e.kind !== 'exc');
    if (ins.length < 2) continue;
    const dot = 'j_' + id;
    nodes.set(dot, { id: P(dot), vx: 'dot', label: '', span: null, owner: id });
    ins.forEach((e) => (e.to = dot));
    edges.push({ from: dot, to: id, label: '', kind: 'normal' });
  }
  // parents: try brackets (innermost wins), then the dots follow the node they feed
  const parent = new Map();
  for (const g of groups.slice().sort((a, b) => b.members.length - a.members.length)) {
    for (const m of g.members) { if (nodes.has(m)) { if (parent.has(m)) g.parent = g.parent || parent.get(m); parent.set(m, g.id); } }
  }
  for (const g of groups) {
    // nested try: a group's parent is the group that held its own try header's first member
    const outer = groups.filter((o) => o !== g && o.members.length > g.members.length && g.members.every((m) => o.members.includes(m)));
    g.parent = outer.length ? outer.sort((a, b) => a.members.length - b.members.length)[0].id : null;
  }
  for (const [id, nd] of nodes) if (nd.vx === 'dot' && nd.owner != null && parent.has(nd.owner)) parent.set(id, parent.get(nd.owner));

  if (opts.blocks) {
    // Vertex block shells around basic blocks of 2+ statements
    const bb = basicBlocks(cfg);
    let k = 0;
    for (const b of bb.blocks) {
      const live = b.members.filter((m) => nodes.has(m.id));
      if (live.length < 2) continue;
      const pars = new Set(live.map((m) => parent.get(m.id) || null));
      if (pars.size > 1) continue;
      const gid = 'blk_' + b.id;
      k++; groups.push({ id: gid, label: '', vx: 'bb', parent: [...pars][0], members: live.map((m) => m.id), span: live[0].span });
      live.forEach((m) => parent.set(m.id, gid));
    }
  }

  const outNodes = [...nodes.entries()].map(([id, nd]) => ({ ...nd, parent: parent.has(id) ? P(parent.get(id)) : null }));
  const outGroups = groups.map((g) => ({ id: P(g.id), label: g.label, vx: g.vx, parent: g.parent ? P(g.parent) : null, span: g.span }));
  const outEdges = edges.filter((e) => (nodes.has(e.from) || e.from.startsWith('grp_')) && nodes.has(e.to))
    .map((e) => ({ from: P(e.from), to: P(e.to), ...edgeVx(e) }));
  return { nodes: outNodes, groups: outGroups, edges: outEdges, cfg, env };
}

// ---------------- data views ----------------
function dataOverlay(A, scope, opts, chart, onlyData) {
  const { cfg, rd, env } = scopeData(A, scope);
  const du = defUse(cfg, rd, A.lang, opts);
  const present = new Set(chart.nodes.map((n) => n.cfgId).filter(Boolean));
  const agg = new Map();
  for (const e of du.edges) {
    let from = e.from;
    if (from.startsWith('param:')) from = onlyData ? from : cfg.entry.id;
    if (!from.includes(':') && !present.has(from)) continue;
    if (!present.has(e.to)) continue;
    const k = from + '>' + e.to;
    if (!agg.has(k)) agg.set(k, { from, to: e.to, vars: [], weak: true });
    const a = agg.get(k); if (!a.vars.includes(e.v)) a.vars.push(e.v); if (!e.weak) a.weak = false;
  }
  const extra = [];
  const used = new Set();
  for (const a of agg.values()) { used.add(a.from); used.add(a.to); }
  for (const p of scope.params) if (onlyData && (opts.showSelf || !A.lang.selfNames.has(p))) { used.add('param:' + p); }
  for (const id of used) {
    if (id.startsWith('param:')) extra.push({ id, vx: 'param', label: id.slice(6), span: cfg.entry.span, fill: colorOf(env.get(id.slice(6))) });
    else if (id.startsWith('free:')) extra.push({ id, vx: 'free', label: id.slice(5) });
  }
  const edges = [...agg.values()].map((a) => {
    const t = a.vars.length === 1 ? env.get(a.vars[0]) : null;
    return { from: a.from, to: a.to, label: a.vars.join(', '), vx: a.weak ? 'dataweak' : 'data', color: colorOf(t) || '#9aa4b2' };
  });
  return { extra, edges, used, count: agg.size, free: du.free };
}

function valueChart(A, scope, opts, withControl) {
  const { cfg, rd, env } = scopeData(A, scope);
  const vg = valueGraph(cfg, rd, A.lang, { ...opts, scopeKind: scope.kind });
  const groupOf = new Map(); const groups = [];
  const wantGroups = opts.group || withControl;
  if (wantGroups) {
    for (const v of vg.nodes) {
      if (!v.owner || groupOf.has(v.owner)) continue;
      const n = cfg.byId.get(v.owner);
      groupOf.set(v.owner, 'g' + v.owner);
      groups.push({ id: 'g' + v.owner, label: squash(n.label, 40), vx: 'stmtbox', span: n.span });
    }
  }
  const varOf = (label) => label.replace(/[₀-₉]+$/, '');
  const MAP = { param: 'param', self: 'free', def: 'badge', defw: 'badge', dead: 'dead', phi: 'phi', op: 'process', call: 'call', effect: 'effect', const: 'const', free: 'free', state: 'state',
    cond: 'decision', loop: 'decision', return: 'ret', raise: 'raise', handler: 'handler', import: 'import', case: 'decision', fndef: 'fn' };
  const nodes = vg.nodes.map((v) => {
    let label = v.label;
    if (v.cls === 'cond' || v.cls === 'loop') { const n = cfg.byId.get(v.owner); if (n) label = decisionLabel(n); }
    if (v.cls === 'phi') label = varOf(v.label.replace(/^φ /, ''));
    const fill = v.cls === 'def' || v.cls === 'defw' || v.cls === 'param' ? colorOf(env.get(varOf(label))) || (v.cls === 'param' ? null : DEFAULT_TITLE) : null;
    return { id: v.id, label, vx: MAP[v.cls] || 'process', fill, dashed: v.cls === 'defw', parent: wantGroups && v.owner ? groupOf.get(v.owner) : null, span: v.span || (v.owner && cfg.byId.get(v.owner).span) };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = vg.edges.map((e) => {
    const src = byId.get(e.from);
    const color = src && (src.vx === 'badge' || src.vx === 'param') ? src.fill : null;
    return { from: e.from, to: e.to, label: e.label, vx: e.cls === 'phi' ? 'phi' : e.cls === 'mut' ? 'mut' : 'flow', color };
  });
  if (withControl) {
    for (const g of groupOf.keys()) {
      const seen = new Set(); const stack = cfg.succ.get(g).map((e) => ({ to: e.to, label: e.label, kind: e.kind }));
      while (stack.length) {
        const s = stack.pop();
        if (seen.has(s.to)) continue; seen.add(s.to);
        if (groupOf.has(s.to)) { edges.push({ from: groupOf.get(g), to: groupOf.get(s.to), ...edgeVx(s) }); continue; }
        (cfg.succ.get(s.to) || []).forEach((e) => stack.push({ to: e.to, label: s.label || e.label, kind: s.kind === 'normal' ? e.kind : s.kind }));
      }
    }
  }
  const dead = vg.nodes.filter((v) => v.cls === 'dead').map((v) => v.label);
  const phis = vg.nodes.filter((v) => v.cls === 'phi').length;
  const stats = [`${vg.nodes.length} values`, `${phis} merge dot${phis === 1 ? '' : 's'} (φ)`];
  if (dead.length) stats.push(`dead store${dead.length > 1 ? 's' : ''}: ${dead.join(', ')}`);
  return { nodes, groups, edges, stats: stats.join(' · '), env };
}

// ---------------- module altitude: every function its own column, calls drawn between them ----------------
function moduleGrid(A, opts) {
  const cols = []; const nodes = []; const groups = []; const edges = [];
  const charts = new Map();
  let total = 0;
  const visible = A.scopes.filter((s) => s.kind !== 'module' || s.body.some((b) => b.k !== 'func' && b.k !== 'class'));
  for (const s of visible) { const { cfg } = scopeData(A, s); total += cfg.nodes.length; }
  if (total > 450) return null;
  const colFor = (s) => {
    const prefix = s.id + '_';
    const ch = controlChart(A, s, { ...opts, blocks: false }, prefix);
    charts.set(s.id, { ch, prefix });
    return ch;
  };
  const classCol = new Map();
  A.classes.forEach((c, i) => {
    const gid = 'cls' + i;
    classCol.set(c, gid);
    groups.push({ id: gid, label: 'class ' + c.name, vx: 'classcol', span: { sl: c.span.sl, sc: 1, el: c.span.sl, ec: 1000 }, grid: Math.min(c.methods.length || 1, 3) });
    cols.push(gid);
  });
  for (const s of visible) {
    const colId = 'col_' + s.id;
    const parent = s.kind === 'method' && s.cls ? classCol.get(s.cls) : null;
    groups.push({ id: colId, label: '', vx: 'col', parent });
    if (!parent) cols.push(colId);
    const ch = colFor(s);
    ch.nodes.forEach((n) => nodes.push({ ...n, parent: n.parent || colId }));
    ch.groups.forEach((g) => groups.push({ ...g, parent: g.parent || colId }));
    ch.edges.forEach((e) => edges.push(e));
  }
  // call links: from the node that makes the call to the callee's gold header
  const seen = new Set();
  for (const s of visible) {
    const { ch, prefix } = charts.get(s.id);
    for (const n of ch.nodes) {
      const c = n.cfgId && charts.get(s.id) && scopeData(A, s).cfg.byId.get(n.cfgId);
      if (!c || !c.stmt || c.kind === 'entry') continue;
      const st = c.stmt;
      const roots = [st.e, st.value, st.test, st.iter, st.subject].concat((st.items || []).map((i) => i.e));
      if (c.kind === 'def') continue;
      for (const r of roots) eachExpr(r, (e) => {
        if (e.k !== 'call') return;
        const hit = A.resolve(s, e);
        if (!hit || !charts.has(hit.scope.id)) return;
        const tgt = charts.get(hit.scope.id);
        const to = tgt.prefix + tgt.ch.cfg.entry.id;
        const key = n.id + '>' + to;
        if (seen.has(key)) return; seen.add(key);
        edges.push({ from: n.id, to, label: '', vx: hit.maybe ? 'maybe' : 'call' });
      });
    }
  }
  const env = new Map(); for (const sc of visible) for (const [k2, v2] of scopeData(A, sc).env) if (!env.has(k2)) env.set(k2, v2);
  return { nodes, groups, edges, env, grid: Math.min(cols.length, 5), stats: `${visible.length} columns · ${seen.size} call links` };
}

function callFallback(A, opts) {
  const g = callGraph(A.scopes, A.classes, A.lang, opts);
  const VX = { module: 'start', func: 'fn', method: 'fn', ext: 'process' };
  return {
    nodes: g.nodes.map((n) => ({ ...n, vx: VX[n.cls] || 'fn', label: n.scope ? fnLabel(n.scope.name, n.scope.params) : n.label })),
    groups: g.groups.map((x) => ({ ...x, vx: x.cls === 'classbox' ? 'classcol' : 'stmtbox' })),
    edges: g.edges.map((e) => ({ ...e, vx: e.cls === 'maybe' ? 'maybe' : 'call' })),
    stats: `${g.nodes.length} callables (too many statements for side-by-side columns)`,
  };
}

// ---------------- entry point ----------------
export function buildView(A, scope, view, altitude, opts) {
  if (altitude === 'module') {
    const m = moduleGrid(A, opts) || callFallback(A, opts);
    return { ...m, direction: opts.direction };
  }
  if (altitude === 'expression') {
    const v = valueChart(A, scope, opts, view !== 'data');
    return { ...v, direction: opts.direction };
  }
  const blocks = altitude === 'block';
  const ch = controlChart(A, scope, { ...opts, blocks });
  const stats = [];
  if (view === 'control') {
    stats.push(`${ch.nodes.filter((n) => n.vx !== 'dot').length} nodes`, `${ch.nodes.filter((n) => n.vx === 'dot').length} connector dots`);
    if (blocks) stats.push(`${ch.groups.filter((g) => g.vx === 'bb').length} basic blocks`);
    const dead = ch.nodes.filter((n) => n.dim).length; if (dead) stats.push(`${dead} unreachable`);
    return { ...ch, direction: opts.direction, stats: stats.join(' · ') };
  }
  const onlyData = view === 'data';
  const d = dataOverlay(A, scope, opts, ch, onlyData);
  if (onlyData) {
    // data view keeps Vertex's node shapes but drops control edges, dots and statements that touch no data
    const keep = new Set([...d.used]);
    const nodes = ch.nodes.filter((n) => n.cfgId != null && (keep.has(n.cfgId) || n.vx === 'ret') && n.kind !== 'entry' && n.kind !== 'exit');
    const keptIds = new Set(nodes.map((n) => n.cfgId));
    const groups = ch.groups.filter((g) => nodes.some((n) => n.parent === g.id) || ch.groups.some((c) => c.parent === g.id));
    const allNodes = nodes.concat(d.extra);
    const edges = d.edges.filter((e) => (keptIds.has(e.from) || e.from.includes(':')) && keptIds.has(e.to))
      .map((e) => ({ ...e, from: e.from.includes(':') ? e.from : nodes.find((n) => n.cfgId === e.from).id, to: nodes.find((n) => n.cfgId === e.to).id }));
    stats.push(`${d.count} def→use links`); if (d.free.length) stats.push(`reads from outside: ${d.free.join(', ')}`);
    return { nodes: allNodes, groups, edges, env: ch.env, direction: opts.direction, stats: stats.join(' · ') };
  }
  const idOf = new Map(ch.nodes.filter((n) => n.cfgId != null).map((n) => [n.cfgId, n.id]));
  const extra = d.extra.filter((x) => x.id.startsWith('free:'));
  const dataEdges = d.edges.map((e) => ({ ...e, from: e.from.includes(':') ? e.from : idOf.get(e.from), to: idOf.get(e.to), vx: 'dataover' })).filter((e) => e.from && e.to);
  stats.push(`${ch.nodes.filter((n) => n.vx !== 'dot').length} nodes`, `${d.count} def→use links`);
  return { nodes: ch.nodes.concat(extra), groups: ch.groups, edges: ch.edges.concat(dataEdges), env: ch.env, direction: opts.direction, stats: stats.join(' · ') };
}
