// word — shared helpers adapters use to absorb a tree-sitter CST into the kind-tagged UAST.
// Every UAST node carries `k` (its kind), `span` (1-based Monaco range) and `text`.

export function span(n) {
  return { sl: n.startPosition.row + 1, sc: n.startPosition.column + 1, el: n.endPosition.row + 1, ec: n.endPosition.column + 1 };
}

export function named(n) {
  const out = [];
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i);
    if (c.type !== 'comment') out.push(c);
  }
  return out;
}

export function field(n, name) {
  return n ? n.childForFieldName(name) : null;
}

export function fields(n, name) {
  return n ? n.childrenForFieldName(name).filter(Boolean) : [];
}

export function squash(s, max = 46) {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Header of a compound statement: source text from the statement start up to its body.
export function head(src, n, body, strip = /[:{]\s*$/) {
  if (!body) return squash(n.text.split('\n')[0]);
  return squash(src.slice(n.startIndex, body.startIndex).replace(strip, '').trim());
}

export function mk(k, n, extra) {
  return Object.assign({ k, span: span(n), text: n.text }, extra);
}

// Collect syntax errors so the editor can mark them.
export function syntaxErrors(root) {
  const out = [];
  const walk = (n) => {
    if (out.length > 50) return;
    if (n.type === 'ERROR' || n.isMissing) {
      out.push({ span: span(n), msg: n.isMissing ? `missing ${n.type}` : 'syntax error' });
      if (n.type === 'ERROR') return;
    }
    if (!n.hasError) return;
    for (let i = 0; i < n.childCount; i++) walk(n.child(i));
  };
  if (root.hasError) walk(root);
  return out;
}
