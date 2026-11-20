// JavaScript adapter: tree-sitter-javascript CST  →  the same kind-tagged UAST Python lowers to.
import { named, field, fields, head, mk, squash, span } from '../core/word.js';

export const javascript = {
  id: 'javascript',
  name: 'JavaScript',
  monacoId: 'javascript',
  grammar: 'javascript',
  builtins: new Set(('console Math JSON Object Array String Number Boolean Symbol Promise Map Set WeakMap Date RegExp Error TypeError RangeError ' +
    'parseInt parseFloat isNaN isFinite undefined NaN Infinity window document globalThis setTimeout clearTimeout setInterval fetch require module exports this arguments').split(' ')),
  mutators: new Set('push pop shift unshift splice sort reverse fill set add delete clear copyWithin'.split(' ')),
  selfNames: new Set(['this']),
  module(root, src) {
    return { k: 'module', body: block(root, src), span: span(root), text: '' };
  },
};

const LITERAL = new Set(['number', 'string', 'true', 'false', 'null', 'undefined', 'regex']);

function opText(n) {
  const f = field(n, 'operator');
  if (f) return f.text;
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (!c.isNamed) return c.type; }
  return '?';
}

function argsOf(argsN) {
  const ins = []; let i = 0;
  for (const a of argsN ? named(argsN) : []) {
    if (a.type === 'spread_element') ins.push({ e: expr(named(a)[0]), label: '...' });
    else ins.push({ e: expr(a), label: String(i++) });
  }
  return ins;
}

export function expr(n) {
  if (!n) return null;
  switch (n.type) {
    case 'identifier': case 'shorthand_property_identifier': return mk('name', n, { name: n.text });
    case 'this': case 'super': return mk('name', n, { name: n.type });
    case 'template_string': {
      const parts = named(n).filter((c) => c.type === 'template_substitution').map((c) => expr(named(c)[0]));
      return parts.length ? mk('build', n, { label: '`template`', ins: parts.map((e) => ({ e })) }) : mk('const', n);
    }
    case 'parenthesized_expression': return expr(named(n).pop());
    case 'binary_expression':
      return mk('op', n, { op: opText(n), ins: [{ e: expr(field(n, 'left')) }, { e: expr(field(n, 'right')) }] });
    case 'unary_expression': return mk('op', n, { op: opText(n), ins: [{ e: expr(field(n, 'argument')) }] });
    case 'await_expression': return mk('op', n, { op: 'await', ins: named(n).map((c) => ({ e: expr(c) })) });
    case 'yield_expression': return mk('op', n, { op: 'yield', ins: named(n).map((c) => ({ e: expr(c) })) });
    case 'ternary_expression':
      return mk('op', n, { op: '?:', ins: [{ e: expr(field(n, 'condition')), label: 'if' }, { e: expr(field(n, 'consequence')), label: 'then' }, { e: expr(field(n, 'alternative')), label: 'else' }] });
    case 'update_expression': return mk('update', n, { target: target(field(n, 'argument')), op: opText(n).replace(/(.)\1/, '$1') });
    case 'assignment_expression': return mk('walrus', n, { target: target(field(n, 'left')), value: expr(field(n, 'right')) });
    case 'augmented_assignment_expression':
      return mk('walrus', n, { target: target(field(n, 'left')), value: expr(field(n, 'right')), aug: opText(n).replace(/=$/, '') });
    case 'call_expression': {
      const fn = field(n, 'function');
      const a = field(n, 'arguments');
      if (a && a.type === 'template_string') return mk('call', n, { callee: expr(fn), ins: [{ e: expr(a) }] });
      return mk('call', n, { callee: expr(fn), ins: argsOf(a) });
    }
    case 'new_expression':
      return mk('call', n, { callee: expr(field(n, 'constructor')), ins: argsOf(field(n, 'arguments')), isNew: true });
    case 'member_expression': {
      const obj = expr(field(n, 'object'));
      const name = field(n, 'property').text;
      const base = obj && (obj.k === 'name' ? obj.name : obj.path);
      return mk('attr', n, { obj, name, path: base ? `${base}.${name}` : null });
    }
    case 'subscript_expression': return mk('index', n, { obj: expr(field(n, 'object')), ins: [{ e: expr(field(n, 'index')) }] });
    case 'arrow_function': case 'function': case 'function_expression': case 'generator_function': {
      const ps = field(n, 'parameters') || field(n, 'parameter');
      const body = field(n, 'body');
      return mk('scope', n, { label: n.type === 'arrow_function' ? '(…) => …' : 'function(…)', bound: paramsOf(ps), body: freeExprsIn(body) });
    }
    case 'array': return mk('build', n, { label: '[ ]', ins: named(n).map((c) => ({ e: expr(c.type === 'spread_element' ? named(c)[0] : c) })) });
    case 'object': {
      const ins = [];
      for (const p of named(n)) {
        if (p.type === 'pair') ins.push({ e: expr(field(p, 'value')), label: squash(field(p, 'key').text, 12) });
        else if (p.type === 'shorthand_property_identifier') ins.push({ e: mk('name', p, { name: p.text }), label: p.text });
        else if (p.type === 'spread_element') ins.push({ e: expr(named(p)[0]), label: '...' });
        else if (p.type === 'method_definition') ins.push({ e: expr(p), label: field(p, 'name').text });
      }
      return mk('build', n, { label: '{ }', ins });
    }
    case 'method_definition': return mk('scope', n, { label: 'method', bound: paramsOf(field(n, 'parameters')), body: freeExprsIn(field(n, 'body')) });
    case 'sequence_expression': return mk('build', n, { label: ', ', ins: named(n).map((c) => ({ e: expr(c) })) });
    case 'spread_element': return expr(named(n)[0]);
    default:
      if (LITERAL.has(n.type) || n.childCount === 0) return mk('const', n);
      return mk('other', n, { ins: named(n).map((c) => ({ e: expr(c) })).filter((x) => x.e) });
  }
}

// For closures we only need the names they read: lower the body as statements and keep its expressions.
function freeExprsIn(body) {
  if (!body) return [];
  if (body.type !== 'statement_block') return [expr(body)];
  const out = [];
  const walk = (n) => {
    if (/_expression$|^identifier$|^call_expression$/.test(n.type)) { out.push(expr(n)); return; }
    for (const c of named(n)) walk(c);
  };
  walk(body);
  return out;
}

function paramsOf(ps) {
  if (!ps) return [];
  if (ps.type === 'identifier') return [ps.text];
  const out = [];
  for (const p of named(ps)) collectTargetNames(target(p), out);
  return out;
}

export function target(n) {
  if (!n) return null;
  switch (n.type) {
    case 'identifier': case 'shorthand_property_identifier_pattern': return mk('name', n, { name: n.text });
    case 'member_expression': case 'subscript_expression': return expr(n);
    case 'array_pattern': return mk('tuple', n, { items: named(n).map(target) });
    case 'object_pattern': return mk('tuple', n, {
      items: named(n).map((p) => p.type === 'pair_pattern' ? target(field(p, 'value')) : p.type === 'object_assignment_pattern' ? target(field(p, 'left')) : target(p)),
      keys: named(n).map((p) => p.type === 'pair_pattern' ? field(p, 'key').text : p.text.split(/[=\s]/)[0]),
    });
    case 'assignment_pattern': return target(field(n, 'left'));
    case 'rest_pattern': return target(named(n)[0]);
    case 'parenthesized_expression': return target(named(n)[0]);
    default: return mk('other', n, { ins: [] });
  }
}

export function collectTargetNames(t, out) {
  if (!t) return out;
  if (t.k === 'name') out.push(t.name);
  else if (t.k === 'tuple') t.items.forEach((i) => collectTargetNames(i, out));
  return out;
}

function block(n, src) {
  if (!n) return [];
  if (n.type !== 'statement_block' && n.type !== 'program' && n.type !== 'class_body' && n.type !== 'switch_body') {
    const s = stmt(n, src); return s ? [].concat(s) : [];
  }
  const out = [];
  for (const c of named(n)) { const s = stmt(c, src); if (s) out.push(...[].concat(s)); }
  return out;
}

function funcFrom(n, name, fnNode, src) {
  const body = field(fnNode, 'body');
  const ps = field(fnNode, 'parameters') || field(fnNode, 'parameter');
  const bodyStmts = body && body.type === 'statement_block' ? block(body, src) : body ? [mk('return', body, { label: squash(body.text), e: expr(body), implicit: true })] : [];
  const hdr = body ? head(src, n, body, /(=>)?\s*$/) : squash(n.text);
  return mk('func', n, { label: hdr, name, params: paramsOf(ps), defaults: [], body: bodyStmts, bodySpan: body ? span(body) : null });
}

const FUNC_EXPR = new Set(['arrow_function', 'function', 'function_expression', 'generator_function']);

function stmt(n, src) {
  switch (n.type) {
    case 'expression_statement': {
      const c = named(n)[0];
      if (!c) return null;
      if (c.type === 'assignment_expression') {
        const r = field(c, 'right');
        const l = field(c, 'left');
        if (r && FUNC_EXPR.has(r.type) && (l.type === 'identifier' || l.type === 'member_expression')) return funcFrom(n, l.text, r, src);
        return mk('assign', n, { label: squash(n.text.replace(/;$/, '')), targets: [target(l)], value: expr(r) });
      }
      if (c.type === 'augmented_assignment_expression')
        return mk('assign', n, { label: squash(n.text.replace(/;$/, '')), targets: [target(field(c, 'left'))], value: expr(field(c, 'right')), aug: opText(c).replace(/=$/, '') });
      return mk('expr', n, { label: squash(n.text.replace(/;$/, '')), e: expr(c) });
    }
    case 'lexical_declaration': case 'variable_declaration': {
      const out = [];
      for (const d of named(n).filter((c) => c.type === 'variable_declarator')) {
        const nm = field(d, 'name'); const v = field(d, 'value');
        if (v && FUNC_EXPR.has(v.type) && nm.type === 'identifier') { out.push(funcFrom(d, nm.text, v, src)); continue; }
        if (!v) { out.push(mk('assign', d, { label: squash(n.text.split(/\s/)[0] + ' ' + d.text), targets: [target(nm)], value: null, annotation: true })); continue; }
        out.push(mk('assign', d, { label: squash((named(n).length > 1 ? '' : n.text.split(/\s/)[0] + ' ') + d.text), targets: [target(nm)], value: expr(v) }));
      }
      return out;
    }
    case 'statement_block': return block(n, src);
    case 'if_statement': {
      const cons = field(n, 'consequence');
      const alt = field(n, 'alternative');
      const s = mk('if', n, { label: head(src, n, cons), test: expr(field(n, 'condition')), then: block(cons, src), else: [] });
      if (alt) {
        const inner = named(alt)[0];
        if (inner && inner.type === 'if_statement') { const e = stmt(inner, src); e.elif = true; e.label = 'else ' + e.label; s.else = [e]; } else s.else = block(inner, src);
      }
      return s;
    }
    case 'for_statement': {
      const body = field(n, 'body');
      const init = field(n, 'initializer');
      const cond = field(n, 'condition');
      const inc = field(n, 'increment');
      const condE = cond && cond.type !== 'empty_statement' ? expr(cond.type === 'expression_statement' ? named(cond)[0] : cond) : null;
      return mk('cfor', n, {
        label: head(src, n, body), init: init && init.type !== 'empty_statement' ? [].concat(stmt(init, src) || []) : [], test: condE,
        update: inc ? [mk('expr', inc, { label: squash(inc.text), e: expr(inc) })] : [], body: block(body, src),
      });
    }
    case 'for_in_statement': {
      const body = field(n, 'body');
      return mk('for', n, { label: head(src, n, body), target: target(field(n, 'left')), iter: expr(field(n, 'right')), body: block(body, src), orelse: [] });
    }
    case 'while_statement': {
      const body = field(n, 'body');
      return mk('while', n, { label: head(src, n, body), test: expr(field(n, 'condition')), body: block(body, src), orelse: [] });
    }
    case 'do_statement': {
      const body = field(n, 'body');
      const c = field(n, 'condition');
      return mk('while', n, { label: 'while ' + squash(c ? c.text : ''), test: expr(c), body: block(body, src), orelse: [], doWhile: true });
    }
    case 'try_statement': {
      const h = field(n, 'handler'); const f = field(n, 'finalizer');
      const handlers = [];
      if (h) {
        const p = field(h, 'parameter'); const hb = field(h, 'body');
        handlers.push(mk('handler', h, { label: head(src, h, hb), type: null, name: p ? p.text : null, body: block(hb, src) }));
      }
      const final = f ? block(field(f, 'body'), src) : [];
      return mk('try', n, { label: 'try', body: block(field(n, 'body'), src), handlers, orelse: [], final, hasFinal: !!f });
    }
    case 'switch_statement': {
      const body = field(n, 'body');
      const cases = [];
      for (const c of body ? named(body) : []) {
        if (c.type !== 'switch_case' && c.type !== 'switch_default') continue;
        const v = field(c, 'value');
        const stmts = [];
        for (const b of fields(c, 'body')) { const s = stmt(b, src); if (s) stmts.push(...[].concat(s)); }
        if (!fields(c, 'body').length) for (const b of named(c)) if (b !== v) { const s = stmt(b, src); if (s) stmts.push(...[].concat(s)); }
        cases.push(mk('case', c, { label: c.type === 'switch_default' ? 'default' : 'case ' + squash(v ? v.text : ''), isDefault: c.type === 'switch_default', body: stmts, binds: [] }));
      }
      return mk('switch', n, { label: head(src, n, body), subject: expr(field(n, 'value')), cases, fallthrough: true });
    }
    case 'return_statement': return mk('return', n, { label: squash(n.text.replace(/;$/, '')), e: expr(named(n)[0]) });
    case 'throw_statement': return mk('raise', n, { label: squash(n.text.replace(/;$/, '')), e: expr(named(n)[0]) });
    case 'break_statement': return mk('break', n, { label: 'break' });
    case 'continue_statement': return mk('continue', n, { label: 'continue' });
    case 'empty_statement': return null;
    case 'function_declaration': case 'generator_function_declaration':
      return funcFrom(n, field(n, 'name').text, n, src);
    case 'class_declaration': {
      const body = field(n, 'body');
      const her = named(n).find((c) => c.type === 'class_heritage');
      const members = [];
      for (const m of body ? named(body) : []) {
        if (m.type === 'method_definition') {
          const f = funcFrom(m, field(m, 'name').text, m, src); f.isMethod = true; members.push(f);
        } else if (m.type === 'field_definition' || m.type === 'public_field_definition') {
          const prop = field(m, 'property'); const v = field(m, 'value');
          if (prop) members.push(mk('assign', m, { label: squash(m.text), targets: [mk('name', prop, { name: prop.text })], value: expr(v) }));
        }
      }
      return mk('class', n, { label: head(src, n, body), name: field(n, 'name').text, bases: her ? named(her).map(expr) : [], body: members });
    }
    case 'import_statement': {
      const names = [];
      const walk = (c) => {
        if (c.type === 'import_specifier') { const a = field(c, 'alias') || field(c, 'name'); names.push(a.text); return; }
        if (c.type === 'namespace_import') { names.push(named(c).pop().text); return; }
        if (c.type === 'identifier' && c.parent.type === 'import_clause') { names.push(c.text); return; }
        for (const k of named(c)) walk(k);
      };
      walk(n);
      return mk('import', n, { label: squash(n.text.replace(/;$/, '')), names });
    }
    case 'export_statement': {
      const d = field(n, 'declaration') || named(n).find((c) => /declaration|function|class/.test(c.type));
      return d ? stmt(d, src) : mk('expr', n, { label: squash(n.text), e: mk('other', n, { ins: [] }) });
    }
    case 'labeled_statement': return block(field(n, 'body'), src);
    case 'comment': case 'hash_bang_line': case 'ERROR': return null;
    default:
      return mk('expr', n, { label: squash(n.text), e: expr(n) });
  }
}
