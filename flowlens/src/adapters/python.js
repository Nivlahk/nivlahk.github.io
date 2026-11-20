// Python adapter: tree-sitter-python CST  →  kind-tagged UAST.
// The analysis core never sees a tree-sitter node type; it only sees kinds.
import { named, field, fields, head, mk, squash, span } from '../core/word.js';

export const python = {
  id: 'python',
  name: 'Python',
  monacoId: 'python',
  grammar: 'python',
  builtins: new Set(('print len range enumerate zip map filter sorted reversed sum min max abs any all int float str bool list dict set tuple ' +
    'type isinstance issubclass open input iter next super object repr hash id round divmod pow chr ord format vars dir getattr setattr hasattr ' +
    'delattr callable staticmethod classmethod property Exception ValueError KeyError TypeError IndexError RuntimeError StopIteration ' +
    'NotImplementedError ZeroDivisionError AttributeError OSError IOError FileNotFoundError AssertionError True False None __name__ self cls frozenset bytes bytearray memoryview slice complex').split(' ')),
  mutators: new Set('append extend insert pop remove clear update add sort reverse setdefault discard popitem appendleft popleft extendleft write'.split(' ')),
  selfNames: new Set(['self', 'cls']),
  module(root, src) {
    return { k: 'module', body: block(root, src), span: span(root), text: '' };
  },
};

const LITERAL = new Set(['integer', 'float', 'true', 'false', 'none', 'ellipsis', 'concatenated_string']);

function opText(n) {
  const f = field(n, 'operator');
  if (f) return f.text;
  const ops = [];
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (!c.isNamed) ops.push(c.type); }
  return ops.join(' ');
}

export function expr(n) {
  if (!n) return null;
  switch (n.type) {
    case 'identifier': return mk('name', n, { name: n.text });
    case 'string': {
      const parts = named(n).filter((c) => c.type === 'interpolation').map((c) => expr(named(c)[0]));
      return parts.length ? mk('build', n, { label: 'f-string', ins: parts.map((e) => ({ e })) }) : mk('const', n);
    }
    case 'parenthesized_expression': return expr(named(n)[0]);
    case 'binary_operator':
    case 'boolean_operator':
      return mk('op', n, { op: opText(n), ins: [{ e: expr(field(n, 'left')) }, { e: expr(field(n, 'right')) }] });
    case 'comparison_operator': {
      const ops = []; let cur = [];
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c.isNamed) { if (cur.length) { ops.push(cur.join(' ')); cur = []; } } else cur.push(c.type);
      }
      return mk('op', n, { op: ops.join(' '), ins: named(n).map((c) => ({ e: expr(c) })) });
    }
    case 'not_operator': return mk('op', n, { op: 'not', ins: [{ e: expr(field(n, 'argument')) }] });
    case 'unary_operator': return mk('op', n, { op: opText(n), ins: [{ e: expr(field(n, 'argument')) }] });
    case 'await': return mk('op', n, { op: 'await', ins: named(n).map((c) => ({ e: expr(c) })) });
    case 'yield': return mk('op', n, { op: 'yield', ins: named(n).map((c) => ({ e: expr(c) })) });
    case 'conditional_expression': {
      const [a, c, b] = named(n);
      return mk('op', n, { op: 'if-else', ins: [{ e: expr(c), label: 'if' }, { e: expr(a), label: 'then' }, { e: expr(b), label: 'else' }] });
    }
    case 'call': {
      const fn = field(n, 'function');
      const argsN = field(n, 'arguments');
      const ins = [];
      if (argsN) {
        if (argsN.type === 'generator_expression') ins.push({ e: expr(argsN) });
        else {
          let i = 0;
          for (const a of named(argsN)) {
            if (a.type === 'keyword_argument') ins.push({ e: expr(field(a, 'value')), label: field(a, 'name').text });
            else if (a.type === 'list_splat') ins.push({ e: expr(named(a)[0]), label: '*' });
            else if (a.type === 'dictionary_splat') ins.push({ e: expr(named(a)[0]), label: '**' });
            else ins.push({ e: expr(a), label: String(i++) });
          }
        }
      }
      return mk('call', n, { callee: expr(fn), ins });
    }
    case 'attribute': {
      const obj = expr(field(n, 'object'));
      const name = field(n, 'attribute').text;
      const path = obj && (obj.k === 'name' ? obj.name : obj.path) ? `${obj.k === 'name' ? obj.name : obj.path}.${name}` : null;
      return mk('attr', n, { obj, name, path });
    }
    case 'subscript': {
      const subs = fields(n, 'subscript');
      return mk('index', n, { obj: expr(field(n, 'value')), ins: subs.map((s) => ({ e: expr(s) })) });
    }
    case 'slice': return mk('build', n, { label: 'slice', ins: named(n).map((c) => ({ e: expr(c) })) });
    case 'named_expression': { const nm = field(n, 'name'); return mk('walrus', n, { target: mk('name', nm, { name: nm.text }), value: expr(field(n, 'value')) }); }
    case 'lambda': {
      const ps = field(n, 'parameters');
      return mk('scope', n, { label: 'lambda', bound: ps ? params(ps) : [], body: [expr(field(n, 'body'))] });
    }
    case 'list_comprehension': case 'set_comprehension': case 'dictionary_comprehension': case 'generator_expression': {
      const bound = []; const body = [];
      for (const c of named(n)) {
        if (c.type === 'for_in_clause') {
          collectTargetNames(target(field(c, 'left')), bound);
          body.push(expr(field(c, 'right')));
        } else if (c.type === 'if_clause') body.push(expr(named(c)[0]));
        else if (c.type === 'pair') { body.push(expr(field(c, 'key')), expr(field(c, 'value'))); }
        else body.push(expr(c));
      }
      return mk('scope', n, { label: { list_comprehension: '[… for …]', set_comprehension: '{… for …}', dictionary_comprehension: '{k: v for …}', generator_expression: '(… for …)' }[n.type], bound, body });
    }
    case 'list': case 'tuple': case 'set': case 'expression_list':
      return mk('build', n, { label: n.type === 'list' ? '[ ]' : n.type === 'set' ? '{ }' : '( , )', ins: named(n).map((c) => ({ e: expr(c) })) });
    case 'dictionary': {
      const ins = [];
      for (const p of named(n)) {
        if (p.type === 'pair') ins.push({ e: expr(field(p, 'key')), label: 'key' }, { e: expr(field(p, 'value')), label: squash(field(p, 'key').text, 12) });
        else ins.push({ e: expr(named(p)[0] || p), label: '**' });
      }
      return mk('build', n, { label: '{ : }', ins });
    }
    case 'list_splat': case 'dictionary_splat': return expr(named(n)[0]);
    default:
      if (LITERAL.has(n.type)) return mk('const', n);
      if (n.childCount === 0) return mk('const', n);
      return mk('other', n, { ins: named(n).map((c) => ({ e: expr(c) })).filter((x) => x.e) });
  }
}

export function target(n) {
  if (!n) return null;
  switch (n.type) {
    case 'identifier': return mk('name', n, { name: n.text });
    case 'attribute': return expr(n);
    case 'subscript': return expr(n);
    case 'pattern_list': case 'tuple_pattern': case 'list_pattern': case 'tuple': case 'list': case 'expression_list':
      return mk('tuple', n, { items: named(n).map(target) });
    case 'list_splat_pattern': case 'list_splat': return target(named(n)[0]);
    case 'parenthesized_expression': return target(named(n)[0]);
    case 'as_pattern_target': return target(named(n)[0]);
    default: return mk('other', n, { ins: [] });
  }
}

export function collectTargetNames(t, out) {
  if (!t) return out;
  if (t.k === 'name') out.push(t.name);
  else if (t.k === 'tuple') t.items.forEach((i) => collectTargetNames(i, out));
  return out;
}

function params(ps) {
  const out = [];
  for (const p of named(ps)) {
    if (p.type === 'identifier') out.push(p.text);
    else if (p.type === 'default_parameter' || p.type === 'typed_default_parameter') out.push(field(p, 'name').text);
    else if (p.type === 'typed_parameter' || p.type === 'list_splat_pattern' || p.type === 'dictionary_splat_pattern') {
      const id = named(p).find((c) => c.type === 'identifier'); if (id) out.push(id.text);
    }
  }
  return out;
}

function block(n, src) {
  if (!n) return [];
  const out = [];
  for (const c of named(n)) { const s = stmt(c, src); if (s) out.push(s); }
  return out;
}

function elseBody(n, src) {
  const alt = fields(n, 'alternative').find((c) => c.type === 'else_clause');
  return alt ? block(field(alt, 'body') || named(alt).pop(), src) : [];
}

function stmt(n, src) {
  switch (n.type) {
    case 'expression_statement': {
      const kids = named(n);
      const c = kids[0];
      if (!c) return null;
      if (c.type === 'assignment') {
        const targets = []; let cur = c;
        while (cur && cur.type === 'assignment') {
          targets.push(target(field(cur, 'left')));
          const r = field(cur, 'right');
          if (!r) return mk('assign', n, { label: squash(n.text), targets, value: null, annotation: true });
          cur = r;
        }
        return mk('assign', n, { label: squash(n.text), targets, value: expr(cur) });
      }
      if (c.type === 'augmented_assignment') {
        return mk('assign', n, { label: squash(n.text), targets: [target(field(c, 'left'))], value: expr(field(c, 'right')), aug: field(c, 'operator').text.replace('=', '') });
      }
      const e = kids.length > 1 ? mk('build', n, { label: '( , )', ins: kids.map((k) => ({ e: expr(k) })) }) : expr(c);
      return mk('expr', n, { label: squash(n.text), e });
    }
    case 'if_statement': {
      const cons = field(n, 'consequence');
      const s = mk('if', n, { label: head(src, n, cons), test: expr(field(n, 'condition')), then: block(cons, src), else: [] });
      // elif chain → nested ifs in the else arm (exactly what the CFG wants)
      const alts = fields(n, 'alternative');
      let tail = s;
      for (const a of alts) {
        if (a.type === 'elif_clause') {
          const ac = field(a, 'consequence');
          const nested = mk('if', a, { label: head(src, a, ac), test: expr(field(a, 'condition')), then: block(ac, src), else: [], elif: true });
          tail.else = [nested]; tail = nested;
        } else if (a.type === 'else_clause') tail.else = block(field(a, 'body') || named(a).pop(), src);
      }
      return s;
    }
    case 'for_statement': {
      const body = field(n, 'body');
      return mk('for', n, { label: head(src, n, body), target: target(field(n, 'left')), iter: expr(field(n, 'right')), body: block(body, src), orelse: elseBody(n, src) });
    }
    case 'while_statement': {
      const body = field(n, 'body');
      return mk('while', n, { label: head(src, n, body), test: expr(field(n, 'condition')), body: block(body, src), orelse: elseBody(n, src) });
    }
    case 'try_statement': {
      const body = field(n, 'body');
      const handlers = []; let orelse = []; let final = [];
      for (const c of named(n)) {
        if (c.type === 'except_clause' || c.type === 'except_group_clause') {
          const kids = named(c);
          const blk = kids.find((k) => k.type === 'block');
          const pre = kids.filter((k) => k !== blk);
          let type = null; let name = null;
          if (pre[0] && pre[0].type === 'as_pattern') {
            type = expr(named(pre[0])[0]);
            const al = field(pre[0], 'alias'); if (al) name = al.text;
          } else if (pre[0]) { type = expr(pre[0]); if (pre[1] && pre[1].type === 'identifier') name = pre[1].text; }
          handlers.push(mk('handler', c, { label: head(src, c, blk), type, name, body: block(blk, src) }));
        } else if (c.type === 'else_clause') orelse = block(field(c, 'body') || named(c).pop(), src);
        else if (c.type === 'finally_clause') final = block(named(c).find((k) => k.type === 'block'), src);
      }
      return mk('try', n, { label: 'try', body: block(body, src), handlers, orelse, final, hasFinal: final.length > 0 });
    }
    case 'with_statement': {
      const body = field(n, 'body');
      const clause = named(n).find((c) => c.type === 'with_clause');
      const items = [];
      for (const it of clause ? named(clause) : []) {
        const v = field(it, 'value') || named(it)[0];
        if (v && v.type === 'as_pattern') items.push({ e: expr(named(v)[0]), target: target(field(v, 'alias')) });
        else if (v) items.push({ e: expr(v), target: null });
      }
      return mk('with', n, { label: head(src, n, body), items, body: block(body, src) });
    }
    case 'decorated_definition': {
      const def = field(n, 'definition');
      const s = stmt(def, src);
      if (s) s.decorators = named(n).filter((c) => c.type === 'decorator').map((d) => expr(named(d)[0]));
      return s;
    }
    case 'function_definition': {
      const body = field(n, 'body');
      const ps = field(n, 'parameters');
      const defaults = ps ? named(ps).filter((p) => /default/.test(p.type)).map((p) => expr(field(p, 'value'))) : [];
      return mk('func', n, { label: head(src, n, body), name: field(n, 'name').text, params: ps ? params(ps) : [], defaults, body: block(body, src), bodySpan: body ? span(body) : null });
    }
    case 'class_definition': {
      const body = field(n, 'body');
      const sup = field(n, 'superclasses');
      return mk('class', n, { label: head(src, n, body), name: field(n, 'name').text, bases: sup ? named(sup).map(expr) : [], body: block(body, src) });
    }
    case 'return_statement': return mk('return', n, { label: squash(n.text), e: expr(named(n)[0]) });
    case 'raise_statement': return mk('raise', n, { label: squash(n.text), e: expr(named(n)[0]) });
    case 'break_statement': return mk('break', n, { label: 'break' });
    case 'continue_statement': return mk('continue', n, { label: 'continue' });
    case 'pass_statement': return mk('pass', n, { label: 'pass' });
    case 'import_statement': case 'import_from_statement': case 'future_import_statement': {
      const names = [];
      for (const c of fields(n, 'name')) {
        if (c.type === 'aliased_import') names.push(field(c, 'alias').text);
        else names.push(n.type === 'import_statement' ? c.text.split('.')[0] : c.text.split('.').pop());
      }
      if (!names.length && /\*/.test(n.text)) names.push('*');
      return mk('import', n, { label: squash(n.text), names });
    }
    case 'global_statement': case 'nonlocal_statement':
      return mk('decl', n, { label: squash(n.text), names: named(n).map((c) => c.text) });
    case 'assert_statement': {
      const kids = named(n);
      return mk('assert', n, { label: squash(n.text), e: expr(kids[0]), extra: kids.slice(1).map(expr) });
    }
    case 'delete_statement': return mk('del', n, { label: squash(n.text), targets: named(n).map(target) });
    case 'match_statement': {
      const body = field(n, 'body');
      const cases = [];
      for (const c of body ? named(body) : []) {
        if (c.type !== 'case_clause') continue;
        const cons = field(c, 'consequence');
        const pats = named(c).filter((k) => k !== cons);
        const isDefault = pats.length === 1 && /^_\s*$/.test(pats[0].text.trim()) || pats.length === 1 && pats[0].text.trim() === '';
        const binds = [];
        const walk = (k) => {
          if (k.type === 'case_pattern') {
            const kids = named(k);
            if (kids.length === 1 && kids[0].type === 'dotted_name' && kids[0].namedChildCount === 1 && kids[0].text !== '_') { binds.push(kids[0].text); return; }
          }
          if (k.type === 'keyword_pattern') { const kv = named(k); if (kv[1] && kv[1].type === 'dotted_name' && kv[1].namedChildCount === 1) binds.push(kv[1].text); else kv.slice(1).forEach(walk); return; }
          if (k.type === 'as_pattern') { const kv = named(k); kv.slice(0, -1).forEach(walk); if (kv.length > 1) binds.push(kv[kv.length - 1].text); return; }
          if (k.type === 'splat_pattern') { const id = named(k)[0]; if (id && id.text !== '_') binds.push(id.text); return; }
          named(k).forEach(walk);
        };
        pats.forEach(walk);
        cases.push(mk('case', c, { label: head(src, c, cons), isDefault: isDefault || /^case\s+_\s*:/.test(c.text), body: block(cons, src), binds }));
      }
      return mk('switch', n, { label: head(src, n, body), subject: expr(field(n, 'subject')), cases, fallthrough: false });
    }
    case 'type_alias_statement': case 'print_statement': case 'exec_statement':
      return mk('expr', n, { label: squash(n.text), e: mk('other', n, { ins: named(n).map((c) => ({ e: expr(c) })) }) });
    case 'ERROR': return null;
    default:
      if (/statement|definition|clause/.test(n.type)) return mk('expr', n, { label: squash(n.text), e: mk('other', n, { ins: [] }) });
      return mk('expr', n, { label: squash(n.text), e: expr(n) });
  }
}
