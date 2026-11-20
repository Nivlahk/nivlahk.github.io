// Module altitude: who calls whom. Classes become containers holding their methods.
import { squash } from './word.js';

function eachExpr(e, fn) {
  if (!e || typeof e !== 'object') return;
  fn(e);
  for (const key of ['callee', 'obj', 'value', 'target']) if (e[key]) eachExpr(e[key], fn);
  (e.ins || []).forEach((i) => eachExpr(i.e, fn));
  (e.body || []).forEach((b) => eachExpr(b, fn));
  (e.items || []).forEach((b) => eachExpr(b, fn));
}

function stmtExprs(stmts, fn) {
  for (const s of stmts) {
    if (s.k === 'func') { (s.defaults || []).forEach((e) => eachExpr(e, fn)); (s.decorators || []).forEach((e) => eachExpr(e, fn)); continue; }
    if (s.k === 'class') { s.bases.forEach((e) => eachExpr(e, fn)); stmtExprs(s.body.filter((b) => b.k !== 'func'), fn); continue; }
    for (const key of ['e', 'value', 'test', 'iter', 'subject', 'type']) if (s[key]) eachExpr(s[key], fn);
    (s.targets || []).forEach((e) => eachExpr(e, fn));
    (s.extra || []).forEach((e) => eachExpr(e, fn));
    (s.items || []).forEach((i) => eachExpr(i.e, fn));
    for (const key of ['then', 'else', 'body', 'orelse', 'final', 'init', 'update']) if (Array.isArray(s[key])) stmtExprs(s[key], fn);
    (s.handlers || []).forEach((h) => stmtExprs(h.body, fn));
    (s.cases || []).forEach((c) => stmtExprs(c.body, fn));
  }
}

export function makeResolver(scopes, classes, lang) {
  const findFunc = (scope, name) => {
    for (let p = scope; p; p = p.parent) {
      const hit = scopes.find((x) => x.name === name && x.parent === p && x.kind !== 'method');
      if (hit) return hit;
    }
    return null;
  };
  const findClass = (name) => classes.find((c) => c.name === name);
  const ctor = (c) => c.methods.find((m) => m.name === '__init__' || m.name === 'constructor');
  const methodIn = (c, name, depth = 0) => {
    if (!c || depth > 8) return null;
    const m = c.methods.find((x) => x.name === name);
    if (m) return m;
    for (const b of c.stmt.bases || []) { const bc = b && b.k === 'name' && findClass(b.name); const r = bc && methodIn(bc, name, depth + 1); if (r) return r; }
    return null;
  };
  // → { scope, maybe } or null
  return (scope, e) => {
    const c = e.callee;
    if (!c) return null;
    if (c.k === 'name') {
      const f = findFunc(scope, c.name); if (f) return { scope: f };
      const cl = findClass(c.name); if (cl) { const k = ctor(cl); return k ? { scope: k } : null; }
      return null;
    }
    if (c.k === 'attr') {
      const recv = c.obj && c.obj.k === 'name' ? c.obj.name : null;
      if (recv && lang.selfNames.has(recv) && scope.cls) { const m = methodIn(scope.cls, c.name); if (m) return { scope: m }; }
      if (c.obj && c.obj.k === 'call' && c.obj.callee && c.obj.callee.text === 'super' && scope.cls) {
        const base = (scope.cls.stmt.bases || [])[0]; const bc = base && base.k === 'name' && findClass(base.name); const m = bc && methodIn(bc, c.name); if (m) return { scope: m };
      }
      const owners = classes.filter((cl) => cl.methods.some((m) => m.name === c.name));
      if (owners.length === 1) return { scope: owners[0].methods.find((m) => m.name === c.name), maybe: true };
    }
    return null;
  };
}

export { eachExpr };

export function callGraph(scopes, classes, lang, opts) {
  const nodes = []; const groups = []; const edges = [];
  const classOf = new Map(classes.map((c, i) => [c, 'c' + i]));
  classes.forEach((c, i) => groups.push({ id: 'c' + i, label: 'class ' + c.name, cls: 'classbox', span: { sl: c.span.sl, sc: 1, el: c.span.sl, ec: 1000 } }));
  for (const s of scopes) {
    if (s.kind === 'module') nodes.push({ id: s.id, label: 'module', cls: 'module', span: null });
    else nodes.push({ id: s.id, label: s.name + '()', cls: s.kind === 'method' ? 'method' : 'func', parent: s.cls ? classOf.get(s.cls) : null, span: { sl: s.span.sl, sc: 1, el: s.span.sl, ec: 1000 }, scope: s });
  }
  const ext = new Map();
  const counts = new Map();
  const addEdge = (from, to, cls = '') => { const k = from + '>' + to; counts.set(k, (counts.get(k) || { from, to, n: 0, cls })); counts.get(k).n++; };

  const findFunc = (scope, name) => {
    // innermost first: nested defs of this scope, then walking outward, then module level
    for (let p = scope; p; p = p.parent) {
      const hit = scopes.find((x) => x.name === name && x.parent === p && x.kind !== 'method');
      if (hit) return hit;
    }
    return null;
  };
  const findClass = (name) => classes.find((c) => c.name === name);
  const ctor = (c) => c.methods.find((m) => m.name === '__init__' || m.name === 'constructor');
  const methodIn = (c, name, depth = 0) => {
    if (!c || depth > 8) return null;
    const m = c.methods.find((x) => x.name === name);
    if (m) return m;
    for (const b of c.stmt.bases || []) { const bc = b && b.k === 'name' && findClass(b.name); const r = bc && methodIn(bc, name, depth + 1); if (r) return r; }
    return null;
  };

  for (const s of scopes) {
    const body = s.kind === 'module' ? s.body : s.body;
    stmtExprs(body, (e) => {
      if (e.k !== 'call' || !e.callee) return;
      const c = e.callee;
      if (c.k === 'name') {
        const f = findFunc(s, c.name);
        if (f) return addEdge(s.id, f.id);
        const cl = findClass(c.name);
        if (cl) { const k = ctor(cl); return addEdge(s.id, k ? k.id : classOf.get(cl), 'new'); }
      } else if (c.k === 'attr') {
        const recv = c.obj && c.obj.k === 'name' ? c.obj.name : null;
        if (recv && lang.selfNames.has(recv) && s.cls) { const m = methodIn(s.cls, c.name); if (m) return addEdge(s.id, m.id); }
        if (recv && lang.selfNames.has(recv) && s.parent && s.kind === 'nested') { /* closure over self — fall through */ }
        if (recv === 'super' || (c.obj && c.obj.k === 'call' && c.obj.callee && c.obj.callee.text === 'super')) {
          const base = s.cls && (s.cls.stmt.bases || [])[0];
          const bc = base && base.k === 'name' && findClass(base.name);
          const m = bc && methodIn(bc, c.name);
          if (m) return addEdge(s.id, m.id, 'super');
        }
        const owners = classes.filter((cl) => cl.methods.some((m) => m.name === c.name));
        if (owners.length) { owners.forEach((cl) => addEdge(s.id, cl.methods.find((m) => m.name === c.name).id, 'maybe')); return; }
      }
      if (!opts.external) return;
      const label = squash(c.text, 24) + '()';
      if (!ext.has(label)) ext.set(label, 'x' + ext.size);
      addEdge(s.id, ext.get(label), 'ext');
    });
  }
  if (ext.size) {
    groups.push({ id: 'ext', label: 'external & builtins', cls: 'extbox' });
    for (const [label, id] of ext) nodes.push({ id, label, cls: 'ext', parent: 'ext' });
  }
  for (const e of counts.values()) edges.push({ from: e.from, to: e.to, label: e.n > 1 ? '×' + e.n : e.cls === 'maybe' ? '?' : e.cls === 'new' ? 'new' : '', cls: e.cls === 'ext' ? 'extcall' : e.cls === 'maybe' ? 'maybe' : 'call' });
  // hide the module node when it calls nothing and nothing calls it
  const used = new Set(edges.flatMap((e) => [e.from, e.to]));
  return { nodes: nodes.filter((n) => n.cls !== 'module' || used.has(n.id)), groups, edges };
}
