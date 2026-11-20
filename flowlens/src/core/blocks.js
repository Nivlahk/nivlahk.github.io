// Vertex blocks: source separated by 2+ blank lines forms blocks. A `note` comment as the block's first line
// names it and optionally colors it — `# note Setup #3b82f6` (Python) / `// note Setup teal` (JS) —
// the same directive Vertex reads with parseBlockDirectiveFromNoteLine.
const BLANK_LINE_THRESH = 2;

const CSS_NAMES = new Set('red orange yellow green teal cyan blue indigo purple violet pink magenta brown gray grey white black gold silver lime navy maroon olive aqua coral salmon crimson tomato orchid plum khaki tan'.split(' '));
export const isColor = (t) => /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t) || CSS_NAMES.has(t.toLowerCase());

export function noteOf(line, lang) {
  const re = lang.id === 'python' ? /^\s*#\s*note\b\s*(.*)$/i : /^\s*\/\/\s*note\b\s*(.*)$/i;
  const m = String(line).match(re);
  if (!m) return null;
  let color = ''; const label = [];
  for (const part of m[1].trim().split(/\s+/).filter(Boolean)) {
    if (!color && isColor(part)) color = part; else label.push(part);
  }
  return { label: label.join(' '), color };
}

export function sourceSegments(src, lang) {
  const lines = src.split('\n');
  const segs = [];
  let start = null; let blanks = 0; let lastCode = 0;
  const close = (end) => { if (start != null) segs.push({ start, end }); };
  for (let i = 0; i < lines.length; i++) {
    const blank = !lines[i].trim();
    if (blank) { blanks++; continue; }
    if (start == null) start = i + 1;
    else if (blanks >= BLANK_LINE_THRESH) { close(lastCode); start = i + 1; }
    blanks = 0; lastCode = i + 1;
  }
  close(lastCode);
  // the directive is the block's first line — or the first line under a def/class header that opens the block
  const HEADER = /^\s*(async\s+def|def|class|function|async\s+function|export\s+(default\s+)?(function|class))\b|^\s*@/;
  for (const s of segs) {
    let i = s.start;
    while (i <= s.end && (HEADER.test(lines[i - 1]) || !lines[i - 1].trim())) i++;
    const cand = i <= s.end ? i : s.start;
    const d = noteOf(lines[cand - 1], lang) || noteOf(lines[s.start - 1], lang);
    const at = noteOf(lines[cand - 1], lang) ? cand : s.start;
    s.indent = lines[(d ? at : s.start) - 1].match(/^\s*/)[0];
    if (d) { s.noteLine = at; s.label = d.label; s.color = d.color; } else { s.noteLine = null; s.label = ''; s.color = ''; }
    const firstCode = lines.slice(s.start - 1, s.end).find((l) => l.trim() && !noteOf(l, lang));
    s.firstText = firstCode ? firstCode.trim().slice(0, 60) : '';
  }
  return segs;
}

// Wrap each column's top-level nodes (and try/statement groups) in the source block they belong to.
export function applySourceBlocks(model, segs) {
  if (!segs.length) return model;
  const segOf = (line) => segs.findIndex((s) => line >= s.start && line <= s.end);
  const groupById = new Map((model.groups || []).map((g) => [g.id, g]));
  const colOf = (id, isGroup) => {
    let p = isGroup ? groupById.get(id).parent : (model.nodes.find((n) => n.id === id) || {}).parent;
    while (p) { const g = groupById.get(p); if (!g) return null; if (g.vx === 'col') return p; p = g.parent; }
    return null;
  };
  // segment per node: from its span, else from its neighbours
  const seg = new Map();
  for (const n of model.nodes) { const sp = n.span || (n.spans && n.spans[0]); if (sp) { const k = segOf(sp.sl); if (k >= 0) seg.set(n.id, k); } }
  for (let pass = 0; pass < 4; pass++) {
    for (const e of model.edges) {
      if (seg.has(e.to) && !seg.has(e.from) && model.nodes.some((n) => n.id === e.from)) seg.set(e.from, seg.get(e.to));
      if (seg.has(e.from) && !seg.has(e.to)) seg.set(e.to, seg.get(e.from));
    }
  }
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const blocks = new Map(); const counter = new Map();
  const blockFor = (col, k) => {
    const id = `sb_${col || 'root'}_${k}`;
    if (!blocks.has(id)) {
      const c = (counter.get(col) || 0) + 1; counter.set(col, c);
      const s = segs[k];
      blocks.set(id, { id, vx: 'sblock', parent: col, label: s.label || `Block ${c}`, color: s.color, seg: s, segIndex: k, span: { sl: s.start, sc: 1, el: s.start, ec: 1000 } });
    }
    return id;
  };
  const topLevel = (parent) => !parent || (groupById.get(parent) || {}).vx === 'col';
  for (const n of model.nodes) {
    if (!topLevel(n.parent) || !seg.has(n.id)) continue;
    n.parent = blockFor(colOf(n.id, false) || n.parent || null, seg.get(n.id));
  }
  for (const g of model.groups || []) {
    if (g.vx === 'col' || g.vx === 'classcol' || !topLevel(g.parent)) continue;
    const first = model.nodes.find((n) => { let p = n.parent; while (p) { if (p === g.id) return true; p = (groupById.get(p) || {}).parent; } return false; });
    const k = first && first.span ? segOf(first.span.sl) : seg.get(first && first.id);
    if (k == null || k < 0) continue;
    g.parent = blockFor(g.parent || null, k);
  }
  // keep block order stable: blocks first so they wrap everything else
  model.groups = [...blocks.values()].concat(model.groups || []);
  void nodeById;
  return model;
}
