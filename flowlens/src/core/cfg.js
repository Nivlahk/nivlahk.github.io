// Scopes + control-flow graphs, built from the kind-tagged UAST. Language-agnostic.
import { nodeDU } from './du.js';

// ---------- scopes ----------
export function collectScopes(mod, lang) {
  const scopes = [];
  const classes = [];
  const moduleScope = { id: 's0', kind: 'module', name: '<module>', qual: '<module>', params: [], body: mod.body, span: null, parent: null };
  scopes.push(moduleScope);
  const visit = (stmts, parent, cls) => {
    for (const s of stmts) {
      if (s.k === 'func') {
        const kind = cls ? 'method' : parent.kind === 'module' ? 'func' : 'nested';
        const qual = cls ? `${cls.name}.${s.name}` : parent.kind === 'module' ? s.name : `${parent.qual}.${s.name}`;
        const sc = { id: 's' + scopes.length, kind, name: s.name, qual, params: s.params, body: s.body, span: s.span, stmt: s, parent, cls };
        scopes.push(sc);
        if (cls) cls.methods.push(sc);
        visit(s.body, sc, null);
      } else if (s.k === 'class') {
        const c = { name: s.name, qual: parent.kind === 'module' ? s.name : `${parent.qual}.${s.name}`, stmt: s, methods: [], parent, span: s.span };
        classes.push(c);
        visit(s.body, parent, c);
      } else {
        for (const key of ['then', 'else', 'body', 'orelse', 'final', 'init', 'update']) if (Array.isArray(s[key])) visit(s[key], parent, null);
        if (s.handlers) s.handlers.forEach((h) => visit(h.body, parent, null));
        if (s.cases) s.cases.forEach((c) => visit(c.body, parent, null));
      }
    }
  };
  visit(mod.body, moduleScope, null);
  return { scopes, classes };
}

const headSpan = (sp) => sp && { sl: sp.sl, sc: sp.sc, el: sp.sl, ec: 1000 };
const isTrue = (e) => e && e.k === 'const' && /^(True|true|1)$/.test(e.text.trim());

// ---------- CFG ----------
export function buildCFG(scope, lang) {
  const nodes = []; const edges = [];
  const add = (kind, label, stmt, opts = {}) => {
    const n = { id: 'n' + nodes.length, kind, label, stmt, span: opts.span !== undefined ? opts.span : stmt ? stmt.span : null, part: opts.part, depth: ctxDepth };
    const du = stmt && kind !== 'entry' && kind !== 'exit' && kind !== 'try' && kind !== 'finally' ? nodeDU(stmt, opts.part, lang) : { defs: [], uses: [] };
    n.defs = du.defs; n.uses = du.uses;
    nodes.push(n);
    return n;
  };
  const edge = (from, to, label = '', kind = 'normal') => {
    if (!edges.some((e) => e.from === from && e.to === to && e.label === label)) edges.push({ from, to, label, kind });
  };
  const connect = (preds, n) => preds.forEach((p) => edge(p.id, n.id, p.label || '', p.kind || 'normal'));
  let ctxDepth = 0;
  const loops = []; const tries = []; const tryGroups = [];

  const entryLabel = scope.kind === 'module' ? 'start' : scope.stmt.label;
  const entry = add('entry', entryLabel, null, { span: headSpan(scope.span) });
  entry.defs = scope.params.map((p) => ({ v: p, param: true }));
  const exit = { id: 'exit', kind: 'exit', label: 'end', stmt: null, span: null, defs: [], uses: [] };
  const toExit = []; // [{id,label,kind}]

  const lowerList = (stmts, preds) => { for (const s of stmts) preds = lower(s, preds); return preds; };
  const firstSince = (i, fallback) => (nodes[i] ? nodes[i].id : fallback);

  const routeRaise = (n, label) => {
    for (let i = tries.length - 1; i >= 0; i--) {
      const t = tries[i];
      if (t.catches) { t.raises.push({ id: n.id, label, kind: 'exc' }); return; }
      if (t.hasFinal) { t.finalPending.push({ id: n.id, label, kind: 'exc', exc: true }); return; }
    }
    toExit.push({ id: n.id, label, kind: 'exc' });
  };
  const routeReturn = (n) => {
    for (let i = tries.length - 1; i >= 0; i--) if (tries[i].hasFinal) { tries[i].finalPending.push({ id: n.id, label: 'return', kind: 'return', ret: true }); return; }
    toExit.push({ id: n.id, label: '', kind: 'return' });
  };

  function lower(s, preds) {
    switch (s.k) {
      case 'if': {
        const c = add('cond', s.label, s, { span: headSpan(s.span), part: 'if' });
        connect(preds, c);
        ctxDepth++;
        const t = lowerList(s.then, [{ id: c.id, label: 'true', kind: 'true' }]);
        const f = s.else.length ? lowerList(s.else, [{ id: c.id, label: 'false', kind: 'false' }]) : [{ id: c.id, label: 'false', kind: 'false' }];
        ctxDepth--;
        return t.concat(f);
      }
      case 'while': {
        if (s.doWhile) {
          const start = nodes.length;
          const loop = { breaks: [], continues: [] };
          loops.push(loop); ctxDepth++;
          const b = lowerList(s.body, preds);
          ctxDepth--; loops.pop();
          const c = add('loop', s.label, s, { span: headSpan(s.span), part: 'while' });
          connect(b.concat(loop.continues), c);
          edge(c.id, firstSince(start, c.id), 'true', 'back');
          return [{ id: c.id, label: 'false', kind: 'false' }].concat(loop.breaks);
        }
        const c = add('loop', s.label, s, { span: headSpan(s.span), part: 'while' });
        connect(preds, c);
        const loop = { breaks: [], continues: [] };
        loops.push(loop); ctxDepth++;
        const b = lowerList(s.body, [{ id: c.id, label: 'true', kind: 'true' }]);
        ctxDepth--; loops.pop();
        b.concat(loop.continues).forEach((p) => edge(p.id, c.id, p.label || '', 'back'));
        let out = isTrue(s.test) ? [] : [{ id: c.id, label: 'false', kind: 'false' }];
        if (s.orelse.length) out = lowerList(s.orelse, out);
        return out.concat(loop.breaks);
      }
      case 'for': {
        const c = add('loop', s.label, s, { span: headSpan(s.span), part: 'for' });
        connect(preds, c);
        const loop = { breaks: [], continues: [] };
        loops.push(loop); ctxDepth++;
        const b = lowerList(s.body, [{ id: c.id, label: 'next', kind: 'true' }]);
        ctxDepth--; loops.pop();
        b.concat(loop.continues).forEach((p) => edge(p.id, c.id, p.label || '', 'back'));
        let out = [{ id: c.id, label: 'done', kind: 'false' }];
        if (s.orelse.length) out = lowerList(s.orelse, out);
        return out.concat(loop.breaks);
      }
      case 'cfor': {
        preds = lowerList(s.init, preds);
        const c = add('loop', s.label, s, { span: headSpan(s.span), part: 'cfor' });
        connect(preds, c);
        const loop = { breaks: [], continues: [] };
        loops.push(loop); ctxDepth++;
        const b = lowerList(s.body, [{ id: c.id, label: 'true', kind: 'true' }]);
        ctxDepth--; loops.pop();
        let tail = b.concat(loop.continues);
        if (s.update.length) {
          const start = nodes.length;
          tail = lowerList(s.update, tail);
          nodes.slice(start).forEach((n) => (n.kind = 'stmt'));
        }
        tail.forEach((p) => edge(p.id, c.id, p.label || '', 'back'));
        return (s.test ? [{ id: c.id, label: 'false', kind: 'false' }] : []).concat(loop.breaks);
      }
      case 'break': case 'continue': {
        const n = add('jump', s.k, s);
        connect(preds, n);
        const loop = s.k === 'break' ? loops[loops.length - 1] : [...loops].reverse().find((l) => !l.isSwitch);
        if (loop) (s.k === 'break' ? loop.breaks : loop.continues).push({ id: n.id, label: s.k, kind: s.k });
        return [];
      }
      case 'return': {
        const n = add('return', s.label, s);
        connect(preds, n);
        routeReturn(n);
        return [];
      }
      case 'raise': {
        const n = add('raise', s.label, s);
        connect(preds, n);
        routeRaise(n, 'raise');
        return [];
      }
      case 'assert': {
        const n = add('cond', s.label, s, { part: 'assert' });
        connect(preds, n);
        routeRaise(n, 'fails');
        return [{ id: n.id, label: 'ok', kind: 'true' }];
      }
      case 'try': {
        const t = add('try', 'try', s, { span: headSpan(s.span) });
        connect(preds, t);
        const ctx = { catches: s.handlers.length > 0, hasFinal: s.hasFinal, raises: [], finalPending: [] };
        tries.push(ctx); ctxDepth++;
        const bodyStart = nodes.length;
        const b = lowerList(s.body, [{ id: t.id }]);
        tries.pop();
        const tg = { tryId: t.id, members: nodes.slice(bodyStart).map((n) => n.id), handlers: [], finallyId: null };
        tryGroups.push(tg);
        // handlers and else run outside the catching region but still inside finally's reach
        const fctx = { catches: false, hasFinal: s.hasFinal, raises: [], finalPending: ctx.finalPending };
        if (s.hasFinal) tries.push(fctx);
        let normal = s.orelse.length ? lowerList(s.orelse, b) : b;
        for (const h of s.handlers) {
          const hn = add('handler', h.label, h, { span: headSpan(h.span), part: 'handler' });
          tg.handlers.push(hn.id);
          edge(t.id, hn.id, 'raises', 'exc');
          ctx.raises.forEach((r) => edge(r.id, hn.id, r.label, 'exc'));
          normal = normal.concat(lowerList(h.body, [{ id: hn.id }]));
        }
        if (s.hasFinal) tries.pop();
        ctxDepth--;
        if (!s.hasFinal) return normal;
        const f = add('finally', 'finally', s, { span: null });
        tg.finallyId = f.id;
        connect(normal, f);
        ctx.finalPending.forEach((p) => edge(p.id, f.id, p.label, p.kind));
        const fe = lowerList(s.final, [{ id: f.id }]);
        if (ctx.finalPending.some((p) => p.ret)) fe.forEach((p) => toExit.push({ id: p.id, label: 'return', kind: 'return' }));
        if (ctx.finalPending.some((p) => p.exc)) fe.forEach((p) => routeRaise({ id: p.id }, 're-raise'));
        return fe;
      }
      case 'with': {
        const w = add('with', s.label, s, { span: headSpan(s.span), part: 'with' });
        connect(preds, w);
        ctxDepth++;
        const out = lowerList(s.body, [{ id: w.id }]);
        ctxDepth--;
        return out;
      }
      case 'switch': {
        const sw = add('cond', s.label, s, { span: headSpan(s.span), part: 'switch' });
        connect(preds, sw);
        const loop = { breaks: [], continues: null, isSwitch: true };
        // `break` inside a JS switch exits the switch; Python match has no break semantics of its own
        if (s.fallthrough) loops.push(loop);
        let out = []; let fall = [];
        ctxDepth++;
        for (const c of s.cases) {
          const cn = add('case', c.label, c, { span: headSpan(c.span) });
          edge(sw.id, cn.id, '', 'true');
          const exits = lowerList(c.body, [{ id: cn.id }].concat(fall));
          if (s.fallthrough) fall = exits; else out = out.concat(exits);
        }
        ctxDepth--;
        if (s.fallthrough) { loops.pop(); out = out.concat(fall); }
        if (!s.cases.some((c) => c.isDefault)) out.push({ id: sw.id, label: 'no match', kind: 'false' });
        return out.concat(loop.breaks);
      }
      case 'func': case 'class': {
        const n = add('def', s.label, s, { span: headSpan(s.span) });
        connect(preds, n);
        return [{ id: n.id }];
      }
      default: {
        const n = add('stmt', s.label, s);
        connect(preds, n);
        return [{ id: n.id }];
      }
    }
  }

  const tail = lowerList(scope.body, [{ id: entry.id }]);
  tail.forEach((p) => toExit.push(p));
  if (toExit.length) {
    exit.label = scope.kind === 'module' ? 'end' : 'exit';
    nodes.push(exit);
    toExit.forEach((p) => edge(p.id, exit.id, p.label || '', p.kind || 'normal'));
  }

  // reachability — code no path reaches is a real insight, so it is marked rather than dropped
  const succ = new Map(nodes.map((n) => [n.id, []]));
  const pred = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => { succ.get(e.from).push(e); pred.get(e.to).push(e); });
  const seen = new Set([entry.id]); const stack = [entry.id];
  while (stack.length) for (const e of succ.get(stack.pop())) if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); }
  nodes.forEach((n) => (n.unreachable = !seen.has(n.id)));

  return { nodes, edges, tryGroups, entry, exit: toExit.length ? exit : null, succ, pred, byId: new Map(nodes.map((n) => [n.id, n])) };
}

// ---------- basic blocks (Block altitude) ----------
const MERGE_A = new Set(['stmt', 'def']);
const MERGE_B = new Set(['stmt', 'def', 'jump', 'return', 'raise']);
export function basicBlocks(cfg) {
  const blockOf = new Map(); const blocks = [];
  for (const n of cfg.nodes) {
    if (blockOf.has(n.id)) continue;
    const b = { id: 'b' + blocks.length, members: [n], kind: n.kind };
    blocks.push(b); blockOf.set(n.id, b);
    let cur = n;
    for (;;) {
      if (!MERGE_A.has(cur.kind)) break;
      const out = cfg.succ.get(cur.id);
      if (out.length !== 1 || out[0].label) break;
      const nx = cfg.byId.get(out[0].to);
      if (!nx || blockOf.has(nx.id) || !MERGE_B.has(nx.kind) || cfg.pred.get(nx.id).length !== 1 || nx.unreachable !== n.unreachable) break;
      b.members.push(nx); blockOf.set(nx.id, b); cur = nx;
    }
    const last = b.members[b.members.length - 1];
    b.kind = b.members.length > 1 ? (['return', 'raise', 'jump'].includes(last.kind) ? last.kind : 'block') : n.kind;
    b.unreachable = n.unreachable;
  }
  const edges = [];
  for (const e of cfg.edges) {
    const a = blockOf.get(e.from); const z = blockOf.get(e.to);
    if (a === z && a.members.indexOf(cfg.byId.get(e.from)) < a.members.indexOf(cfg.byId.get(e.to))) continue;
    if (!edges.some((x) => x.from === a.id && x.to === z.id && x.label === e.label)) edges.push({ from: a.id, to: z.id, label: e.label, kind: e.kind });
  }
  return { blocks, edges, blockOf };
}
