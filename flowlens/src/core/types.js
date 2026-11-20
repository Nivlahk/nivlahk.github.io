// Vertex colors values by type (TYPE_FILL in Vertex's render.js). A small inference that is good enough to color badges and names.
export const TYPE_FILL = { string: '#b45309', integer: '#60a5fa', float: '#14b8a6', boolean: '#1e3a8a', range: '#ec4899', none: '#ef4444', list: '#6b7280', dict: '#7a4d2e' };
export const BADGE = { list: '#1e3a5f', dict: '#7c2d12' }; // Vertex's table-node badge colors
export const DEFAULT_TITLE = '#222831';

const INT_FN = /^(len|int|sum|round|ord|abs|count|index|find|indexOf|parseInt|Math\.(floor|ceil|round|trunc))$/;
const STR_FN = /^(str|repr|chr|format|join|lower|upper|strip|trim|toLowerCase|toUpperCase|toString|replace|input|prompt|String|JSON\.stringify)$/;
const BOOL_FN = /^(bool|isinstance|issubclass|callable|startswith|endswith|includes|has|hasattr|any|all|isdigit|isalpha|Boolean|Array\.isArray|isNaN)$/;
const LIST_FN = /^(list|sorted|split|map|filter|keys|values|items|Array\.from|slice|concat|reversed|enumerate|zip)$/;
const DICT_FN = /^(dict|Object\.assign|Object\.fromEntries|copy)$/;

export function typeOf(e, env = new Map()) {
  if (!e) return null;
  switch (e.k) {
    case 'const': {
      const t = e.text.trim();
      if (/^(True|False|true|false)$/.test(t)) return 'boolean';
      if (/^(None|null|undefined)$/.test(t)) return 'none';
      if (/^-?\d[\d_]*$/.test(t) || /^0[xob][\da-f_]+$/i.test(t)) return 'integer';
      if (/^-?[\d_]*\.\d+(e-?\d+)?$|^\d+e-?\d+$/i.test(t)) return 'float';
      if (/^[rbuf]*["'`]/i.test(t)) return 'string';
      return null;
    }
    case 'name': return env.get(e.name) || null;
    case 'attr': return e.path ? env.get(e.path) || null : null;
    case 'build':
      if (e.label === '[ ]') return 'list';
      if (e.label === '{ : }' || e.label === '{ }') return e.text.trim().startsWith('{') && (e.label === '{ : }' || /:/.test(e.text)) ? 'dict' : 'list';
      if (e.label === 'f-string' || e.label === '`template`') return 'string';
      if (e.label === '( , )') return 'list';
      return null;
    case 'scope': return /^\[|^\(/.test(e.text.trim()) ? 'list' : /^\{/.test(e.text.trim()) ? 'dict' : null;
    case 'call': {
      const c = e.callee; if (!c) return null;
      const name = c.k === 'name' ? c.name : c.k === 'attr' ? (c.path && /^(Math|Object|Array|JSON)\./.test(c.path) ? c.path : c.name) : '';
      if (name === 'range') return 'range';
      if (name === 'float' || name === 'parseFloat') return 'float';
      if (INT_FN.test(name)) return 'integer';
      if (STR_FN.test(name)) return 'string';
      if (BOOL_FN.test(name)) return 'boolean';
      if (LIST_FN.test(name)) return 'list';
      if (DICT_FN.test(name)) return 'dict';
      if (c.k === 'name' && /^[A-Z]/.test(name)) return null;
      return null;
    }
    case 'op': {
      const op = e.op;
      if (/^(==|!=|===|!==|<|>|<=|>=|in|not in|is|is not|not|!|and|or|&&|\|\|)( |$)/.test(op) || /[<>]=?|==/.test(op) && !/<<|>>/.test(op)) {
        if (op === 'and' || op === 'or' || op === '&&' || op === '||') { const a = typeOf(e.ins[0] && e.ins[0].e, env); return a === 'boolean' ? 'boolean' : a; }
        return 'boolean';
      }
      const ts = e.ins.map((i) => typeOf(i.e, env));
      if (op === '/' ) return 'float';
      if (ts.includes('string') && op === '+') return 'string';
      if (ts.includes('list') && (op === '+' || op === '*')) return 'list';
      if (ts.includes('float')) return 'float';
      if (ts.length && ts.every((t) => t === 'integer') || op === '//' || op === '%') return 'integer';
      if (op === '-' && ts.length === 1) return ts[0];
      if (op === 'if-else' || op === '?:') return ts[1] || ts[2] || null;
      return ts.find(Boolean) || null;
    }
    case 'index': { const o = typeOf(e.obj, env); return o === 'string' ? 'string' : null; }
    case 'walrus': return typeOf(e.value, env);
    default: return null;
  }
}

// One pass over a scope's CFG: the first typed definition of a name decides its color.
export function inferEnv(cfg, scope) {
  const env = new Map();
  const params = scope.stmt && scope.stmt.params ? scope.stmt.params : [];
  (scope.stmt && scope.stmt.defaults || []).forEach((d, i) => {
    const t = typeOf(d, env); const p = params[params.length - (scope.stmt.defaults.length - i)];
    if (t && p) env.set(p, t);
  });
  for (let pass = 0; pass < 2; pass++) {
    for (const n of cfg.nodes) {
      const s = n.stmt;
      if (!s) continue;
      if (s.k === 'assign' && s.value && !s.aug) {
        const t = typeOf(s.value, env);
        for (const tg of s.targets) {
          const key = tg.k === 'name' ? tg.name : tg.k === 'attr' ? tg.path : null;
          if (key && t && !env.has(key)) env.set(key, t);
          if (tg.k === 'tuple' && s.value.k === 'build' && s.value.ins.length === tg.items.length) {
            tg.items.forEach((it, i) => { const ti = typeOf(s.value.ins[i].e, env); if (it.k === 'name' && ti && !env.has(it.name)) env.set(it.name, ti); });
          }
        }
      } else if (s.k === 'assign' && s.aug) {
        const tg = s.targets[0]; const key = tg.k === 'name' ? tg.name : null;
        if (key && !env.has(key)) { const t = typeOf(s.value, env); if (t) env.set(key, t); }
      } else if (s.k === 'for' && n.part === 'for' && s.target.k === 'name' && !env.has(s.target.name)) {
        const it = typeOf(s.iter, env);
        if (it === 'range') env.set(s.target.name, 'integer');
        else if (it === 'string') env.set(s.target.name, 'string');
      }
    }
  }
  return env;
}

export const colorOf = (t) => (t && TYPE_FILL[t]) || null;
