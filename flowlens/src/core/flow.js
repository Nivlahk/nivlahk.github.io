// Data flow: reaching definitions over the CFG, then two altitudes of data-flow graph.
//   Statement altitude — def→use edges between statements (the data half of a program dependence graph)
//   Expression altitude — an SSA-style value graph: every definition is a versioned value (x₁, x₂…),
//                         operations are nodes, and φ nodes appear exactly where control flow merges values.
import { baseTok, parentTok } from './du.js';
import { squash } from './word.js';

export function reachingDefs(cfg) {
  const defs = [];
  for (const n of cfg.nodes) n.defIdx = n.defs.map((d) => { defs.push(Object.assign({ i: defs.length, node: n }, d)); return defs.length - 1; });
  const IN = new Map(); const OUT = new Map();
  cfg.nodes.forEach((n) => { IN.set(n.id, new Set()); OUT.set(n.id, new Set()); });
  let changed = true; let guard = 0;
  while (changed && guard++ < 500) {
    changed = false;
    for (const n of cfg.nodes) {
      const inS = new Set();
      for (const e of cfg.pred.get(n.id)) for (const d of OUT.get(e.from)) inS.add(d);
      IN.set(n.id, inS);
      const kills = n.defs.filter((d) => !d.weak).map((d) => d.v);
      const out = new Set();
      for (const d of inS) { const v = defs[d].v; if (!kills.some((k) => v === k || v.startsWith(k + '.'))) out.add(d); }
      n.defIdx.forEach((i) => out.add(i));
      if (out.size !== OUT.get(n.id).size) changed = true; // RD only grows, so size is a sound change test
      OUT.set(n.id, out);
    }
  }
  const resolve = (nodeId, tok) => {
    const inS = IN.get(nodeId);
    for (let t = tok; t; t = parentTok(t)) {
      const ds = []; for (const i of inS) if (defs[i].v === t) ds.push(defs[i]);
      if (ds.length) return { tok: t, ds: ds.sort((a, b) => a.i - b.i) };
    }
    return null;
  };
  return { defs, IN, OUT, resolve };
}

const isSelf = (lang, tok) => lang.selfNames.has(tok.split('.')[0]);

// ---------- statement altitude ----------
export function defUse(cfg, rd, lang, opts) {
  const edges = []; const free = new Set();
  for (const n of cfg.nodes) {
    if (n.kind === 'entry' || n.kind === 'exit') continue;
    for (const u of n.uses) {
      const r = rd.resolve(n.id, u.v);
      if (!r) {
        if (u.call && !u.v.includes('.')) continue;
        const base = u.v.split('.')[0];
        if (lang.builtins.has(base) && !(opts.showSelf && lang.selfNames.has(base))) continue;
        free.add(base);
        edges.push({ from: 'free:' + base, to: n.id, v: base });
        continue;
      }
      for (const d of r.ds) {
        if (u.call && d.fn) continue;
        if (!opts.showSelf && d.param && lang.selfNames.has(r.tok)) continue;
        edges.push({ from: d.param ? 'param:' + d.v : d.node.id, to: n.id, v: r.tok, weak: !!d.weak, loop: d.node.id === n.id });
      }
    }
  }
  return { edges, free: [...free] };
}

// ---------- expression altitude ----------
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (k) => String(k).split('').map((c) => SUB[+c]).join('');

export function valueGraph(cfg, rd, lang, opts) {
  const nodes = new Map(); const edges = [];
  let uid = 0;
  const N = (id, label, cls, owner, span) => { if (!nodes.has(id)) nodes.set(id, { id, label, cls, owner, span }); return id; };
  const fresh = (label, cls, owner, span) => N('v' + uid++, label, cls, owner, span);
  const E = (from, to, label = '', cls = '') => { if (from && to && !edges.some((e) => e.from === from && e.to === to && e.label === label)) edges.push({ from, to, label, cls }); };

  // version every definition in source order: x₀ (parameter), x₁, x₂ …
  const ver = new Map();
  const defId = (d) => (d.param ? 'p_' + d.v : 'd' + d.i);
  for (const d of rd.defs) {
    if (d.param) { d.label = d.v + sub(0); continue; }
    if (d.fn) continue;
    const k = (ver.get(d.v) || 0) + 1; ver.set(d.v, k);
    d.label = d.v + sub(k);
  }
  const ensureDef = (d) => {
    const id = defId(d);
    if (!nodes.has(id) && d.param) N(id, d.label, lang.selfNames.has(d.v) ? 'self' : 'param', null, d.node.span);
    if (!nodes.has(id)) N(id, d.fn ? (d.node.stmt && d.node.stmt.k === 'class' ? 'class ' : 'def ') + d.v : d.label, d.fn ? 'fndef' : d.weak ? 'defw' : 'def', d.node.id, d.node.span);
    return id;
  };

  const resolveVal = (nid, tok, isCall) => {
    const r = rd.resolve(nid, tok);
    if (!r) {
      if (isCall && !tok.includes('.')) return null;
      const base = tok.split('.')[0];
      if (lang.selfNames.has(base) && tok.includes('.')) return { id: N('st_' + tok, tok, 'state', null), tok };
      if (lang.builtins.has(base)) return null;
      return { id: N('free_' + base, base, 'free', null), tok: base };
    }
    if (isCall && r.ds.every((d) => d.fn)) return null;
    if (!opts.showSelf && r.ds.length === 1 && r.ds[0].param && lang.selfNames.has(r.tok) && tok !== r.tok) {
      return { id: N('st_' + tok, tok, 'state', null), tok };
    }
    if (r.ds.length === 1) return { id: ensureDef(r.ds[0]), tok: r.tok };
    const key = 'phi_' + r.ds.map((d) => d.i).join('_');
    if (!nodes.has(key)) {
      N(key, 'φ ' + r.tok, 'phi', null);
      r.ds.forEach((d) => E(ensureDef(d), key, '', 'phi'));
    }
    return { id: key, tok: r.tok };
  };

  const opLabel = (e, sym) => { const t = squash(e.text, 26); return t.length <= 24 && !t.includes('…') ? t : sym; };
  const link = (v, to, label) => { if (v && v.id) E(v.id, to, label); };
  const mat = (v, owner) => (v && v.id ? v.id : fresh(squash(v ? v.c : '?', 18), 'const', owner));

  // which defs a statement node has not yet bound (handles a, a = … and multiple targets)
  let pending = null;
  const takeDef = (nid, tok) => {
    const k = pending.findIndex((d) => d.v === tok);
    if (k < 0) return null;
    return pending.splice(k, 1)[0];
  };

  function ev(e, nid) {
    if (!e) return null;
    switch (e.k) {
      case 'name': { const r = resolveVal(nid, e.name); return r ? { id: r.id } : { c: e.name }; }
      case 'const': return { c: e.text };
      case 'attr': {
        if (e.path) {
          const r = resolveVal(nid, e.path);
          if (r && r.tok === e.path) return { id: r.id };
        }
        const o = ev(e.obj, nid);
        const id = fresh('.' + e.name, 'op', nid, e.span); link(o, id); return { id };
      }
      case 'index': {
        const o = ev(e.obj, nid);
        const id = fresh(opLabel(e, '[ ]'), 'op', nid, e.span);
        link(o, id); e.ins.forEach((i) => link(ev(i.e, nid), id, 'key'));
        return { id };
      }
      case 'call': {
        const c = e.callee;
        const cname = c ? squash(c.text, 22) : '?';
        const id = fresh((e.isNew ? 'new ' : '') + cname + '()', 'call', nid, e.span);
        if (c && c.k === 'name') { const r = resolveVal(nid, c.name, true); if (r) E(r.id, id, 'fn'); }
        else if (c && c.k === 'attr') {
          const r = c.path ? rd.resolve(nid, c.path) : null;
          if (r && r.tok === c.path && !r.ds.every((d) => d.fn)) link(resolveVal(nid, c.path, true), id, 'fn');
          else link(ev(c.obj, nid), id, 'self');
          if (lang.mutators.has(c.name)) {
            const t = baseTok(c.obj);
            const d = t && takeDef(nid, t);
            if (d) E(id, ensureDef(d), 'mutates', 'mut');
          }
        } else link(ev(c, nid), id, 'fn');
        const many = e.ins.length > 1;
        e.ins.forEach((a) => link(ev(a.e, nid), id, many || /\D/.test(a.label || '') ? a.label : ''));
        return { id };
      }
      case 'op': {
        const vals = e.ins.map((a) => ({ v: ev(a.e, nid), label: a.label }));
        if (!vals.some((x) => x.v && x.v.id)) return { c: e.text };
        const id = fresh(opLabel(e, e.op), 'op', nid, e.span);
        vals.forEach((x) => link(x.v, id, x.label || ''));
        return { id };
      }
      case 'build': case 'other': {
        const ins = (e.ins || []).map((a) => ({ v: ev(a.e, nid), label: a.label }));
        if (!ins.some((x) => x.v && x.v.id)) return { c: e.text };
        const id = fresh(opLabel(e, e.label || '…'), 'op', nid, e.span);
        ins.forEach((x) => link(x.v, id, e.k === 'build' && x.label && x.label !== 'key' && !/^\d+$/.test(x.label) ? x.label : ''));
        return { id };
      }
      case 'scope': {
        const id = fresh(squash(e.text, 24), 'call', nid, e.span);
        const bound = new Set(e.bound);
        const seen = new Set();
        const walkNames = (x) => {
          if (!x) return;
          if (x.k === 'name') { if (!bound.has(x.name) && !seen.has(x.name)) { seen.add(x.name); link(ev(x, nid), id, x.name); } return; }
          if (x.k === 'attr' && x.path && !bound.has(x.path.split('.')[0])) { if (!seen.has(x.path)) { seen.add(x.path); const r = ev(x, nid); link(r, id); } return; }
          for (const key of ['callee', 'obj', 'value', 'target']) if (x[key]) walkNames(x[key]);
          (x.ins || []).forEach((i) => walkNames(i.e)); (x.body || []).forEach(walkNames);
        };
        e.body.forEach(walkNames);
        return { id };
      }
      case 'walrus': {
        let v = ev(e.value, nid);
        if (e.aug) {
          const prior = ev(e.target, nid);
          const op = fresh(squash(e.text, 22), 'op', nid, e.span);
          link(prior, op); link(v, op); v = { id: op };
        }
        return bind(e.target, v, nid, '') || v;
      }
      case 'update': {
        const prior = ev(e.target, nid);
        const op = fresh(squash(e.text, 12), 'op', nid, e.span);
        link(prior, op);
        return bind(e.target, { id: op }, nid, '') || { id: op };
      }
      default: return null;
    }
  }

  function bind(t, v, nid, label) {
    if (!t) return null;
    switch (t.k) {
      case 'name': case 'attr': {
        const tok = t.k === 'name' ? t.name : t.path;
        if (!tok) { const o = ev(t.obj, nid); const id = fresh('.' + t.name + ' =', 'op', nid, t.span); link(o, id); link(v, id); return { id }; }
        const d = takeDef(nid, tok);
        if (!d) return null;
        const id = ensureDef(d);
        E(mat(v, nid), id, label);
        return { id };
      }
      case 'index': {
        const tok = baseTok(t.obj);
        const op = fresh(squash(t.text, 18) + ' =', 'op', nid, t.span);
        link(ev(t.obj, nid), op, 'old');
        t.ins.forEach((i) => link(ev(i.e, nid), op, 'key'));
        E(mat(v, nid), op, 'value');
        const d = tok && takeDef(nid, tok);
        if (d) E(op, ensureDef(d), '');
        return { id: op };
      }
      case 'tuple': {
        const src = mat(v, nid);
        t.items.forEach((it, i) => bind(it, { id: src }, nid, t.keys ? t.keys[i] : `[${i}]`));
        return { id: src };
      }
      default: return null;
    }
  }

  // params are the function's inputs: always shown
  rd.defs.filter((d) => d.param).forEach((d) => { if (opts.showSelf || !lang.selfNames.has(d.v)) ensureDef(d); });

  for (const n of cfg.nodes) {
    if (n.kind === 'entry' || n.kind === 'exit' || n.unreachable && !opts.showUnreachable) continue;
    const s = n.stmt;
    if (!s) continue;
    pending = n.defIdx.map((i) => rd.defs[i]);
    const nid = n.id;
    const sink = (label, cls) => N('k_' + nid, label, cls, nid, n.span);
    switch (n.part || s.k) {
      case 'assign': {
        if (!s.value) break;
        const t0 = s.targets[0];
        if (s.aug) {
          const prior = ev(t0, nid);
          const op = fresh(squash(s.label, 22), 'op', nid, s.span);
          link(prior, op); link(ev(s.value, nid), op);
          bind(t0, { id: op }, nid, '');
        } else if (s.targets.length === 1 && t0.k === 'tuple' && s.value.k === 'build' && s.value.ins.length === t0.items.length && !t0.keys) {
          const vals = s.value.ins.map((a) => ev(a.e, nid)); // evaluate every right side first: a, b = b, a + b
          t0.items.forEach((it, i) => bind(it, vals[i], nid, ''));
        } else {
          const v = ev(s.value, nid);
          const shared = s.targets.length > 1 ? { id: mat(v, nid) } : v;
          s.targets.forEach((t) => bind(t, shared, nid, ''));
        }
        break;
      }
      case 'expr': {
        const v = ev(s.e, nid);
        if (v && v.id && nodes.get(v.id) && nodes.get(v.id).cls === 'call') nodes.get(v.id).cls = 'effect';
        break;
      }
      case 'return': case 'raise': {
        const v = s.e ? ev(s.e, nid) : null;
        const k = sink(!v || !v.id ? squash(s.label, 28) : s.k === 'return' ? 'return' : squash(s.label.split(/[ (]/)[0], 10), s.k === 'return' ? 'return' : 'raise');
        link(v, k);
        break;
      }
      case 'if': case 'while': case 'cfor': case 'assert': case 'switch': {
        const e = s.k === 'switch' ? s.subject : s.test;
        if (!e) break;
        const k = sink(squash(n.label, 30), 'cond');
        link(ev(e, nid), k);
        break;
      }
      case 'for': {
        const k = sink(squash(n.label, 30), 'loop');
        link(ev(s.iter, nid), k, 'iter');
        bind(s.target, { id: k }, nid, s.target.k === 'tuple' ? '' : 'each');
        break;
      }
      case 'case': if ((s.binds || []).length) { const k = sink(squash(n.label, 28), 'case'); (cfg.pred.get(nid) || []).forEach((e) => { if (nodes.has('k_' + e.from)) E('k_' + e.from, k, 'match'); }); s.binds.forEach((nm) => { const d = takeDef(nid, nm); if (d) E(k, ensureDef(d)); }); } break;
      case 'with': s.items.forEach((it) => { const v = ev(it.e, nid); if (it.target) bind(it.target, v, nid, 'as'); }); break;
      case 'handler': if (s.name) { const d = takeDef(nid, s.name); if (d) E(sink(squash(n.label, 26), 'handler'), ensureDef(d)); } break;
      case 'import': { const k = sink(squash(n.label, 28), 'import'); s.names.forEach((nm) => { const d = takeDef(nid, nm); if (d) E(k, ensureDef(d)); }); break; }
      default: break;
    }
    // definitions the statement made that no expression produced (e.g. `x: int` or x++ inside a call) still exist
  }

  // a definition nothing reads is a dead store — keep it, mark it
  const hasOut = new Set(edges.map((e) => e.from));
  const hasIn = new Set(edges.map((e) => e.to));
  for (const v of nodes.values()) {
    if ((v.cls === 'def' || v.cls === 'defw') && !hasOut.has(v.id) && opts.scopeKind !== 'module' && !/^_/.test(v.label) && !lang.selfNames.has(v.label.split('.')[0])) v.cls = 'dead';
    if (v.cls === 'fndef' && !hasOut.has(v.id) && !hasIn.has(v.id)) nodes.delete(v.id);
  }
  return { nodes: [...nodes.values()], edges };
}
