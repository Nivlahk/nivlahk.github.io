// kind/match — structural dispatch over UAST kinds to find what each piece of code defines (writes) and uses (reads).
// Tokens are variable names or dotted paths (self.total). A read of `a.b.c` falls back to `a.b`, then `a`, at resolution time.

export const parentTok = (t) => { const i = t.lastIndexOf('.'); return i < 0 ? null : t.slice(0, i); };
export const baseTok = (e) => (!e ? null : e.k === 'name' ? e.name : e.k === 'attr' ? e.path : null);

export function usesOf(e, lang, out = []) {
  if (!e) return out;
  switch (e.k) {
    case 'name': out.push({ v: e.name }); break;
    case 'const': break;
    case 'attr':
      if (e.path) out.push({ v: e.path });
      else usesOf(e.obj, lang, out);
      break;
    case 'index':
      usesOf(e.obj, lang, out);
      e.ins.forEach((i) => usesOf(i.e, lang, out));
      break;
    case 'call': {
      const c = e.callee;
      if (c && c.k === 'name') out.push({ v: c.name, call: true });
      else if (c && c.k === 'attr' && c.path) out.push({ v: c.path, call: true });
      else if (c && c.k === 'attr') usesOf(c.obj, lang, out);
      else usesOf(c, lang, out);
      e.ins.forEach((i) => usesOf(i.e, lang, out));
      break;
    }
    case 'scope': {
      const inner = [];
      e.body.forEach((b) => usesOf(b, lang, inner));
      const bound = new Set(e.bound);
      for (const u of inner) if (!bound.has(u.v.split('.')[0])) out.push(u);
      break;
    }
    case 'walrus':
      usesOf(e.value, lang, out);
      targetUses(e.target, lang, out);
      if (e.aug) { const t = baseTok(e.target); if (t) out.push({ v: t }); }
      break;
    case 'update': {
      targetUses(e.target, lang, out);
      const t = baseTok(e.target); if (t) out.push({ v: t });
      break;
    }
    default:
      (e.ins || []).forEach((i) => usesOf(i.e, lang, out));
  }
  return out;
}

// Definitions hidden inside expressions: walrus, x++, and mutating method calls (xs.append(v) → weak def of xs).
export function exprDefs(e, lang, out = []) {
  if (!e) return out;
  switch (e.k) {
    case 'walrus': targetDefs(e.target, out); exprDefs(e.value, lang, out); return out;
    case 'update': targetDefs(e.target, out); return out;
    case 'scope': case 'const': case 'name': return out;
    case 'call': {
      const c = e.callee;
      if (c && c.k === 'attr' && lang.mutators.has(c.name)) { const t = baseTok(c.obj); if (t) out.push({ v: t, weak: true, mut: c.name }); }
      if (c && c.k === 'attr') exprDefs(c.obj, lang, out);
      e.ins.forEach((i) => exprDefs(i.e, lang, out));
      return out;
    }
    case 'attr': exprDefs(e.obj, lang, out); return out;
    case 'index': exprDefs(e.obj, lang, out); e.ins.forEach((i) => exprDefs(i.e, lang, out)); return out;
    default: (e.ins || []).forEach((i) => exprDefs(i.e, lang, out)); return out;
  }
}

export function targetDefs(t, out = []) {
  if (!t) return out;
  if (t.k === 'name') out.push({ v: t.name });
  else if (t.k === 'attr') { if (t.path) out.push({ v: t.path }); }
  else if (t.k === 'index') { const b = baseTok(t.obj); if (b) out.push({ v: b, weak: true }); }
  else if (t.k === 'tuple') t.items.forEach((i) => targetDefs(i, out));
  return out;
}

export function targetUses(t, lang, out = []) {
  if (!t) return out;
  if (t.k === 'attr' && !t.path) usesOf(t.obj, lang, out);
  else if (t.k === 'index') { usesOf(t.obj, lang, out); t.ins.forEach((i) => usesOf(i.e, lang, out)); }
  else if (t.k === 'tuple') t.items.forEach((i) => targetUses(i, lang, out));
  return out;
}

// Header-level def/use for one CFG node (`part` says which piece of a compound statement the node stands for).
export function nodeDU(s, part, lang) {
  const defs = []; const uses = [];
  const ex = (e) => { usesOf(e, lang, uses); exprDefs(e, lang, defs); };
  switch (part || s.k) {
    case 'assign':
      ex(s.value);
      s.targets.forEach((t) => { targetDefs(t, defs); targetUses(t, lang, uses); });
      if (s.aug) s.targets.forEach((t) => { const b = baseTok(t); if (b) uses.push({ v: b }); });
      break;
    case 'expr': case 'return': case 'raise': ex(s.e); break;
    case 'assert': ex(s.e); (s.extra || []).forEach(ex); break;
    case 'if': case 'while': ex(s.test); break;
    case 'for': ex(s.iter); targetDefs(s.target, defs); targetUses(s.target, lang, uses); break;
    case 'cfor': if (s.test) ex(s.test); break;
    case 'with': s.items.forEach((i) => { ex(i.e); if (i.target) targetDefs(i.target, defs); }); break;
    case 'func': defs.push({ v: s.name, fn: true }); (s.defaults || []).forEach(ex); (s.decorators || []).forEach(ex); break;
    case 'class': defs.push({ v: s.name, fn: true }); s.bases.forEach(ex); break;
    case 'import': s.names.forEach((n) => defs.push({ v: n })); break;
    case 'del': s.targets.forEach((t) => targetUses(t, lang, uses)); break;
    case 'switch': ex(s.subject); break;
    case 'case': (s.binds || []).forEach((v) => defs.push({ v })); break;
    case 'handler': if (s.type) ex(s.type); if (s.name) defs.push({ v: s.name }); break;
  }
  // a weak def also reads the old value
  for (const d of defs) if (d.weak) uses.push({ v: d.v });
  return { defs, uses };
}
