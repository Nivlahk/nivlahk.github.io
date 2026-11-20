// FlowLens — word (tree-sitter) → kind (UAST) → analysis (CFG, reaching defs, SSA values, calls) → emit (D2) → render (D2 wasm)
import * as monaco from './monaco.js';
import Parser from '../node_modules/web-tree-sitter/tree-sitter.js';
import { python } from './adapters/python.js';
import { javascript } from './adapters/javascript.js';
import { analyze, buildView } from './core/views.js';
import { emitD2 } from './core/emit.js';
import { syntaxErrors } from './core/word.js';
import { SAMPLES } from './samples.js';
import { VertexCanvas } from './canvas.js';
import { sourceSegments, applySourceBlocks } from './core/blocks.js';

const LANGS = { python, javascript };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem('flowlens:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('flowlens:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const state = {
  lang: store.get('lang', 'python'),
  view: store.get('view', 'control'),
  altitude: store.get('altitude', 'statement'),
  follow: store.get('follow', true),
  opts: Object.assign({ layout: 'auto', direction: 'down', external: false, group: false, showSelf: false, sketch: false }, store.get('opts', {})),
  scopeQual: null,
  A: null, map: new Map(), elems: new Map(),
  lastD2: '', d2Edited: false, needFit: true,
};
if (!LANGS[state.lang]) state.lang = 'python';

// ---------------- Monaco ----------------
self.MonacoEnvironment = {
  getWorker() {
    try { return new Worker(new URL('editor.worker.js', document.baseURI)); } catch { return new Worker(URL.createObjectURL(new Blob([''], { type: 'text/javascript' }))); }
  },
};
monaco.editor.defineTheme('flowlens', {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'keyword', foreground: 'ff7b72' }, { token: 'string', foreground: 'a5d6ff' }, { token: 'number', foreground: '79c0ff' },
    { token: 'comment', foreground: '8b949e', fontStyle: 'italic' }, { token: 'identifier', foreground: 'c9d1d9' }, { token: 'type', foreground: 'ffa657' },
    { token: 'delimiter', foreground: '8b949e' }, { token: 'keyword.d2', foreground: 'd2a8ff' }, { token: 'operator.d2', foreground: 'e3b341' },
  ],
  colors: {
    'editor.background': '#16161f', 'editor.foreground': '#cdd6f4', 'editorLineNumber.foreground': '#3d444d', 'editorLineNumber.activeForeground': '#8b949e',
    'editor.lineHighlightBackground': '#161b2280', 'editor.selectionBackground': '#264f78', 'editorIndentGuide.background1': '#21262d',
    'editorWidget.background': '#1c1c28', 'editorStickyScroll.background': '#16161f', 'editorGutter.background': '#16161f',
  },
});
monaco.languages.register({ id: 'd2' });
monaco.languages.setMonarchTokensProvider('d2', {
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/<->|->|<-|--/, 'operator.d2'],
      [/\b(direction|classes|class|shape|style|vars|d2-config|label|near|icon|tooltip|link)\b(?=\s*:)/, 'keyword.d2'],
      [/[{}[\];:]/, 'delimiter'],
      [/#[0-9a-fA-F]{3,8}\b/, 'number'],
      [/\b\d+(\.\d+)?\b/, 'number'],
    ],
  },
});

const editor = monaco.editor.create($('#editor'), {
  theme: 'flowlens', automaticLayout: true, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 13, lineHeight: 20,
  minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 10 }, renderLineHighlight: 'all', smoothScrolling: true,
  stickyScroll: { enabled: true }, tabSize: 4, glyphMargin: true, folding: true, bracketPairColorization: { enabled: true },
});
const d2Editor = monaco.editor.create($('#d2editor'), {
  theme: 'flowlens', automaticLayout: true, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, lineHeight: 18,
  minimap: { enabled: false }, scrollBeyondLastLine: false, language: 'd2', wordWrap: 'off', tabSize: 2,
});
const models = {};
function modelFor(lang) {
  if (!models[lang]) {
    const saved = store.get('code:' + lang, null);
    const first = Object.values(SAMPLES[lang])[0];
    models[lang] = monaco.editor.createModel(saved || first, LANGS[lang].monacoId);
    models[lang].updateOptions({ tabSize: lang === 'python' ? 4 : 2 });
  }
  return models[lang];
}

// ---------------- tree-sitter (grammars ship inside the page — nothing is fetched) ----------------
const dec = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
let parser;
const grammars = {};
async function grammar(id) {
  if (!grammars[id]) grammars[id] = await Parser.Language.load(dec(window.__WASM[id]));
  return grammars[id];
}

// ---------------- D2: the export layer, loaded only when the D2 pane asks for a preview ----------------
let d2 = null;
let d2Chain = Promise.resolve();
function loadD2() {
  if (window.__D2) return Promise.resolve(window.__D2);
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'd2.js';
    s.onload = () => res(window.__D2); s.onerror = () => rej(new Error('could not load d2.js'));
    document.head.appendChild(s);
  });
}
async function previewD2(src) {
  const box = $('#d2preview');
  box.innerHTML = '<div class="empty">laying out with D2…</div>';
  try {
    const D2 = await loadD2();
    if (!d2) d2 = new D2();
    const svg = await (d2Chain = d2Chain.then(async () => {
      const r = await d2.compile(src, { layout: state.opts.layout === 'elk' ? 'elk' : 'dagre', sketch: state.opts.sketch, pad: 30 });
      return d2.render(r.diagram, { ...r.renderOptions, pad: 30, sketch: state.opts.sketch });
    }, () => null));
    box.innerHTML = svg.replace(/^<\?xml[^>]*>/, '');
    const s = box.querySelector('svg'); if (s) { s.removeAttribute('width'); s.removeAttribute('height'); s.style.width = '100%'; s.style.height = '100%'; }
  } catch (e) {
    let msg = String(e && e.message || e);
    try { msg = JSON.parse(msg).map((x) => x.errmsg).join('\n'); } catch { /* plain */ }
    box.innerHTML = ''; const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'D2: ' + msg; box.appendChild(d);
  }
}

// ---------------- the Vertex canvas ----------------
const stage = $('#stage'); const viewport = $('#viewport');
const xf = { x: 0, y: 0, k: 1 };
const applyXf = () => (viewport.style.transform = `translate(${xf.x}px, ${xf.y}px) scale(${xf.k})`);
let natural = { w: 1, h: 1 };
let gesture = null; // node or block drag in progress

const layoutKey = () => `layout:${state.lang}:${state.altitude}:${state.view}:${state.altitude === 'module' ? '*' : state.scopeQual}`;
const saveLayout = () => store.set(layoutKey(), canvas.layoutState);

const canvas = new VertexCanvas(viewport, {
  bindNode(g, n) {
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      gesture = { kind: 'node', id: n.id, block: n._group ? n._group.id : null, x: e.clientX, y: e.clientY, tx: 0, ty: 0, moved: false };
    });
  },
  bindBlock(sg, g) {
    const hdr = sg.querySelector('.blockhdr'); const lbl = sg.querySelector('.blocklbl'); const chev = sg.querySelector('.blockchev');
    const start = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      gesture = { kind: 'block', id: g.id, x: e.clientX, y: e.clientY, tx: 0, ty: 0, moved: false };
    };
    [hdr, lbl].forEach((x) => x && x.addEventListener('pointerdown', start));
    if (chev) chev.addEventListener('pointerdown', (e) => { e.stopPropagation(); canvas.toggleCollapse(g.id); saveLayout(); renderCanvas(); });
    const editable = g.vx === 'sblock';
    [hdr, lbl].forEach((x) => x && x.addEventListener('dblclick', (e) => { e.stopPropagation(); if (editable) renameBlock(g, lbl); }));
    [hdr, lbl].forEach((x) => x && x.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); if (editable) colorBlock(g, e); }));
  },
});

window.addEventListener('pointermove', (e) => {
  if (!gesture) return;
  const dx = (e.clientX - gesture.x) / xf.k; const dy = (e.clientY - gesture.y) / xf.k;
  if (!gesture.moved && Math.abs(dx) + Math.abs(dy) < 3 / xf.k) return;
  gesture.moved = true;
  const sx = dx - gesture.tx; const sy = dy - gesture.ty;
  gesture.tx = dx; gesture.ty = dy;
  if (gesture.kind === 'node') canvas.moveNode(gesture.id, sx, sy); else canvas.moveBlock(gesture.id, sx, sy);
  canvas.redrawLinks(false);
});
window.addEventListener('pointerup', () => {
  const g = gesture; gesture = null;
  if (!g) return;
  if (!g.moved) {
    if (g.kind === 'node' && g.block) { canvas.toggleCollapse(g.block); saveLayout(); renderCanvas(); return; }
    if (g.kind === 'node') selectNode(g.id);
    return;
  }
  if (g.kind === 'node') canvas.commitNode(g.id, g.tx, g.ty); else canvas.commitBlock(g.id, g.tx, g.ty);
  saveLayout();
  const before = canvas.bounds;
  canvas.redrawLinks(true);
  const after = canvas.bounds;
  xf.x += (after.x - before.x) * xf.k; xf.y += (after.y - before.y) * xf.k;
  natural = { w: after.w, h: after.h };
  applyXf();
  highlightFromCursor();
});

function renderCanvas() {
  if (!state.view2) return;
  const t0 = performance.now();
  const before = canvas.bounds;
  canvas.render(state.view2, { colors: state.colors, layoutState: store.get(layoutKey(), { nodes: {}, blocks: {} }) });
  timing.layout = performance.now() - t0;
  state.map = canvas.records; state.elems = canvas.elems;
  natural = { w: canvas.bounds.w, h: canvas.bounds.h };
  if (state.needFit || !before) { fit(); state.needFit = false; }
  else { xf.x += (canvas.bounds.x - before.x) * xf.k; xf.y += (canvas.bounds.y - before.y) * xf.k; applyXf(); }
  hideOverlay();
  showTiming();
  highlightFromCursor();
}

$('#resetLayout').onclick = () => { store.set(layoutKey(), { nodes: {}, blocks: {} }); state.needFit = true; renderCanvas(); };

// block label and colour are source: they live in a `note` comment on the block's first line, exactly as in Vertex
function writeNote(g, label, color) {
  const seg = g.seg; const L = LANGS[state.lang];
  const prefix = L.id === 'python' ? '# note ' : '// note ';
  const body = [label, color].filter(Boolean).join(' ').trim();
  const model = editor.getModel();
  if (seg.noteLine) {
    const range = body ? new monaco.Range(seg.noteLine, 1, seg.noteLine, model.getLineMaxColumn(seg.noteLine))
      : new monaco.Range(seg.noteLine, 1, seg.noteLine + 1, 1);
    editor.executeEdits('flowlens-note', [{ range, text: body ? seg.indent + prefix + body : '' }]);
  } else if (body) {
    editor.executeEdits('flowlens-note', [{ range: new monaco.Range(seg.start, 1, seg.start, 1), text: seg.indent + prefix + body + '\n' }]);
  }
  editor.pushUndoStop();
}
function renameBlock(g, lbl) {
  const wrapR = $('#stageWrap').getBoundingClientRect(); const r = lbl.getBoundingClientRect();
  const inp = document.createElement('input');
  inp.className = 'blockedit'; inp.value = g.seg.label || '';
  inp.placeholder = 'block name';
  Object.assign(inp.style, { left: r.left - wrapR.left - 4 + 'px', top: r.top - wrapR.top - 4 + 'px' });
  $('#stageWrap').appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const finish = (ok) => { if (done) return; done = true; inp.remove(); if (ok) writeNote(g, inp.value.trim(), g.seg.color); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}
const BLOCK_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#64748b'];
function colorBlock(g, e) {
  const pop = $('#colorPop');
  pop.innerHTML = BLOCK_COLORS.map((c) => `<button style="background:${c}" data-c="${c}" title="${c}"></button>`).join('') + '<button class="none" data-c="" title="no colour">×</button>';
  const wrapR = $('#stageWrap').getBoundingClientRect();
  Object.assign(pop.style, { left: e.clientX - wrapR.left + 'px', top: e.clientY - wrapR.top + 'px' });
  pop.hidden = false;
  pop.onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; pop.hidden = true; writeNote(g, g.seg.label, b.dataset.c); };
}
document.addEventListener('pointerdown', (e) => { const pop = $('#colorPop'); if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true; });

function fit() {
  const r = stage.getBoundingClientRect();
  const k = Math.min((r.width - 30) / natural.w, (r.height - 30) / natural.h, 1.3);
  xf.k = Math.max(k, 0.08);
  xf.x = (r.width - natural.w * xf.k) / 2;
  xf.y = Math.max(15, (r.height - natural.h * xf.k) / 2);
  applyXf();
}

stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  const px = e.clientX - r.left; const py = e.clientY - r.top;
  const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
  if (e.ctrlKey || e.metaKey || mouseWheel) {
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
    const k = Math.min(4, Math.max(0.05, xf.k * f));
    xf.x = px - (px - xf.x) * (k / xf.k); xf.y = py - (py - xf.y) * (k / xf.k); xf.k = k;
  } else { xf.x -= e.deltaX; xf.y -= e.deltaY; }
  applyXf();
}, { passive: false });

let drag = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || gesture) return;
  drag = { x: e.clientX, y: e.clientY, ox: xf.x, oy: xf.y, moved: false };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (drag) {
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; stage.classList.add('panning'); }
    if (drag.moved) { xf.x = drag.ox + dx; xf.y = drag.oy + dy; applyXf(); }
    return;
  }
  if (gesture) return;
  const g = e.target.closest && e.target.closest('g[data-fl]');
  hoverNode(g ? g.dataset.fl : null);
});
stage.addEventListener('pointerup', () => { drag = null; stage.classList.remove('panning'); });
stage.addEventListener('pointerleave', () => hoverNode(null));
stage.addEventListener('dblclick', (e) => { if (!e.target.closest('g[data-fl], g[data-group]')) fit(); });
$('#fitBtn').onclick = fit;

const hoverDecos = editor.createDecorationsCollection();
let hovered = null;
function recFor(id) { return state.map.get(id) || null; }
function rangeOf(sp) {
  const m = editor.getModel();
  const el = Math.min(sp.el, m.getLineCount());
  return new monaco.Range(sp.sl, sp.sc, el, Math.min(sp.ec, m.getLineMaxColumn(el)));
}
function hoverNode(id) {
  if (id === hovered) return;
  hovered = id;
  const rec = id && recFor(id);
  if (!rec || !rec.spans.length) { hoverDecos.clear(); return; }
  hoverDecos.set(rec.spans.map((sp) => ({ range: rangeOf(sp), options: { className: 'fl-hover', linesDecorationsClassName: 'fl-glyph' } })));
}
let selecting = false;
function selectNode(id) {
  const rec = recFor(id);
  if (!rec || !rec.spans.length) return;
  const r = rangeOf(rec.spans[0]);
  selecting = true;
  editor.setSelection(new monaco.Selection(r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn));
  editor.revealRangeInCenterIfOutsideViewport(r);
  editor.focus();
  setTimeout(() => (selecting = false), 50);
  markHighlighted([id]);
}

// cursor → diagram: light up the most specific node(s) whose source contains the cursor
function highlightFromCursor() {
  const p = editor.getPosition();
  if (!p) return;
  let best = []; let bestSize = Infinity;
  for (const rec of state.map.values()) {
    for (const sp of rec.spans) {
      const inside = (p.lineNumber > sp.sl || p.lineNumber === sp.sl && p.column >= sp.sc) && (p.lineNumber < sp.el || p.lineNumber === sp.el && p.column <= sp.ec);
      if (!inside) continue;
      const size = (sp.el - sp.sl) * 10000 + (sp.el === sp.sl ? Math.min(sp.ec, 1000) - sp.sc : 500);
      if (size < bestSize) { bestSize = size; best = [rec.id]; } else if (size === bestSize && !best.includes(rec.id)) best.push(rec.id);
    }
  }
  markHighlighted(best);
}
function markHighlighted(ids) {
  viewport.querySelectorAll('g.hl').forEach((g) => g.classList.remove('hl'));
  for (const id of ids) (state.elems.get(id) || []).forEach((g) => g.classList.add('hl'));
}

// ---------------- pipeline ----------------
const timing = { parse: 0, analyze: 0, emit: 0, layout: 0 };
function showTiming() {
  $('#timing').textContent = `parse ${timing.parse.toFixed(1)}ms · analyze ${timing.analyze.toFixed(1)}ms · layout ${timing.layout.toFixed(1)}ms`;
}
function showOverlay(msg) { $('#overlayMsg').textContent = msg; $('#overlay').hidden = false; }
function hideOverlay() { $('#overlay').hidden = true; }

function scopeAt(A, line) {
  let best = null;
  for (const s of A.scopes) {
    if (!s.span || line < s.span.sl || line > s.span.el) continue;
    if (!best || s.span.el - s.span.sl <= best.span.el - best.span.sl) best = s;
  }
  return best;
}
function currentScope(A) {
  let s = A.scopes.find((x) => x.qual === state.scopeQual);
  if (!s) {
    const line = editor.getPosition() ? editor.getPosition().lineNumber : 1;
    s = (state.follow && scopeAt(A, line)) || A.scopes.find((x) => x.kind !== 'module') || A.scopes[0];
    state.scopeQual = s.qual;
  }
  return s;
}
function fillScopes(A) {
  const sel = $('#scope');
  const opts = A.scopes.map((s) => `${s.kind === 'method' ? '  ' : ''}${s.qual === '<module>' ? '‹module›' : s.qual}${s.kind === 'module' ? '' : '()'}`);
  const sig = opts.join('|');
  if (sel.dataset.sig !== sig) {
    sel.innerHTML = A.scopes.map((s, i) => `<option value="${encodeURIComponent(s.qual)}">${opts[i].replace(/</g, '&lt;')}</option>`).join('');
    sel.dataset.sig = sig;
  }
  sel.value = encodeURIComponent(state.scopeQual);
  sel.disabled = state.altitude === 'module';
}

function refresh({ force = false } = {}) {
  const L = LANGS[state.lang];
  const model = editor.getModel();
  const src = model.getValue();
  let t = performance.now();
  parser.setLanguage(grammars[L.grammar]);
  const tree = parser.parse(src);
  timing.parse = performance.now() - t;
  const errs = syntaxErrors(tree.rootNode);
  monaco.editor.setModelMarkers(model, 'flowlens', errs.map((e) => ({
    startLineNumber: e.span.sl, startColumn: e.span.sc, endLineNumber: e.span.el, endColumn: Math.max(e.span.ec, e.span.sc + 1), message: e.msg, severity: monaco.MarkerSeverity.Error,
  })));
  $('#errs').textContent = errs.length ? `${errs.length} syntax error${errs.length > 1 ? 's' : ''} — diagram shows what still parses` : '';
  t = performance.now();
  let view;
  try {
    const A = analyze(L.module(tree.rootNode, src), L);
    state.A = A;
    const scope = currentScope(A);
    fillScopes(A);
    view = buildView(A, scope, state.view, state.altitude, state.opts);
  } catch (e) {
    console.error(e);
    tree.delete();
    showOverlay('analysis error: ' + e.message);
    return;
  }
  tree.delete();
  timing.analyze = performance.now() - t;
  t = performance.now();
  applySourceBlocks(view, sourceSegments(src, L));
  const { d2: src2, colors } = emitD2(view);
  state.colors = colors;
  timing.emit = performance.now() - t;
  $('#stats').textContent = view.stats || '';
  if (!view.nodes.length) {
    viewport.innerHTML = ''; state.map = new Map(); state.view2 = null;
    showOverlay(state.view === 'data' ? 'no data flows in this scope — try Control, or pick a function from scope' : 'nothing to draw in this scope');
    showTiming();
    return;
  }
  if (view.nodes.length > 1500) { showOverlay(`${view.nodes.length} nodes — pick a smaller scope or a lower altitude`); return; }
  state.view2 = view;
  renderCanvas();
  if (src2 !== state.lastD2 || force) {
    state.lastD2 = src2;
    if (d2Editor.getValue() !== src2) { settingD2 = true; d2Editor.setValue(src2); settingD2 = false; }
    if ($('#d2pane').classList.contains('show') && $('#d2live').checked) previewD2(src2);
  }
}

let timer = 0;
const schedule = (ms = 220) => { clearTimeout(timer); timer = setTimeout(() => refresh(), ms); };

// ---------------- controls ----------------
function syncControls() {
  $$('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.view));
  $$('#altSeg button').forEach((b) => b.classList.toggle('on', b.dataset.a === state.altitude));
  $$('#viewSeg button').forEach((b) => (b.disabled = state.altitude === 'module'));
  $('#follow').checked = state.follow;
  $('#optLayout').value = state.opts.layout; $('#optDir').value = state.opts.direction;
  $('#optSketch').checked = state.opts.sketch; $('#optGroup').checked = state.opts.group;
  $('#optSelf').checked = state.opts.showSelf; $('#optExt').checked = state.opts.external;
  legend();
}

const LEGENDS = {
  control: [['start / end', '#007f00', 'round', '#7f0000'], ['function', '#92700a', 'round'], ['decision', '#004b8d', 'dia'], ['connector', '#bbbbbb', 'dot'],
    ['variable', '#60a5fa', 'badge'], ['call', '#92700a'], ['print', '#ED8936', 'para'], ['return', '#333333', 'round'], ['try / except', '#f59e0b', 'dash'],
    ['yes', '#4ade80', 'ln'], ['no', '#f87171', 'ln']],
  data: [['input', '#007f00', 'para'], ['variable', '#60a5fa', 'badge'], ['statement', '#333333'], ['outside name', '#333333', 'round dash'], ['def → use (colored by type)', '#60a5fa', 'ln']],
  both: [['decision', '#004b8d', 'dia'], ['connector', '#bbbbbb', 'dot'], ['variable', '#60a5fa', 'badge'], ['control', '#aaaaaa', 'ln'], ['def → use', '#9aa4b2', 'ln dash']],
  expression: [['input x₀', '#007f00', 'para'], ['value xₙ', '#60a5fa', 'badge'], ['dead store', '#7f0000', 'dash'], ['merge dot (φ)', '#bbbbbb', 'dot'],
    ['operation', '#333333'], ['call', '#92700a'], ['object state', '#7a4d2e'], ['decision', '#004b8d', 'dia']],
  module: [['function column', '#92700a', 'round'], ['class', '#3a3a5c'], ['call link', '#d4a017', 'ln dash'], ['maybe (by name)', '#d4a017', 'ln dot']],
  types: [['str', '#b45309'], ['int', '#60a5fa'], ['float', '#14b8a6'], ['bool', '#1e3a8a'], ['list', '#1e3a5f'], ['dict', '#7c2d12'], ['None', '#ef4444']],
};
function legend() {
  const key = state.altitude === 'module' ? 'module' : state.altitude === 'expression' ? 'expression' : state.view;
  const sw = ([t, c, k = '', c2]) => `<span><i class="${k}" style="--c:${c};--c2:${c2 || c}"></i>${t}</span>`;
  $('#legend').innerHTML = LEGENDS[key].map(sw).join('') + '<span class="sep"></span>' +
    LEGENDS.types.map(([t, c]) => `<span class="ty"><b style="background:${c}"></b>${t}</span>`).join('');
}

function setView(v) { if (state.view === v) return; state.view = v; store.set('view', v); state.needFit = true; syncControls(); refresh(); }
function setAltitude(a) { if (state.altitude === a) return; state.altitude = a; store.set('altitude', a); state.needFit = true; syncControls(); refresh(); }
$$('#viewSeg button').forEach((b) => (b.onclick = () => setView(b.dataset.v)));
$$('#altSeg button').forEach((b) => (b.onclick = () => setAltitude(b.dataset.a)));
const ALTS = ['module', 'block', 'statement', 'expression'];
window.addEventListener('keydown', (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-4]$/.test(e.code)) { e.preventDefault(); setAltitude(ALTS[+e.code.slice(5) - 1]); }
});
ALTS.forEach((a, i) => editor.addCommand(monaco.KeyMod.Alt | (monaco.KeyCode.Digit1 + i), () => setAltitude(a)));

function fillSamples() {
  $('#sample').innerHTML = '<option value="">—</option>' + Object.keys(SAMPLES[state.lang]).map((k) => `<option>${k}</option>`).join('');
}
$('#lang').innerHTML = Object.values(LANGS).map((l) => `<option value="${l.id}">${l.name}</option>`).join('');
$('#lang').onchange = async (e) => {
  state.lang = e.target.value; store.set('lang', state.lang);
  await grammar(LANGS[state.lang].grammar);
  editor.setModel(modelFor(state.lang));
  state.scopeQual = null; state.needFit = true;
  fillSamples(); refresh({ force: true });
};
$('#sample').onchange = (e) => {
  const v = e.target.value; if (!v) return;
  editor.getModel().setValue(SAMPLES[state.lang][v]);
  editor.setPosition({ lineNumber: 1, column: 1 });
  state.scopeQual = null; state.needFit = true;
  refresh({ force: true });
  e.target.value = '';
};
$('#scope').onchange = (e) => {
  state.scopeQual = decodeURIComponent(e.target.value); state.needFit = true;
  const s = state.A.scopes.find((x) => x.qual === state.scopeQual);
  if (s && s.span && state.follow) { const p = editor.getPosition(); if (!p || p.lineNumber < s.span.sl || p.lineNumber > s.span.el) { editor.setPosition({ lineNumber: s.span.sl, column: 1 }); editor.revealLineInCenterIfOutsideViewport(s.span.sl); } }
  refresh();
};
$('#follow').onchange = (e) => { state.follow = e.target.checked; store.set('follow', state.follow); };

const pop = $('#opts');
$('#optsBtn').onclick = (e) => {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  pop.style.top = r.bottom + 6 + 'px'; pop.style.right = Math.max(8, innerWidth - r.right) + 'px';
  pop.classList.toggle('show');
};
document.addEventListener('pointerdown', (e) => { if (!pop.contains(e.target) && e.target.id !== 'optsBtn') pop.classList.remove('show'); });
const optChange = (k, v, refit = true) => { state.opts[k] = v; store.set('opts', state.opts); if (refit) state.needFit = true; refresh({ force: true }); };
$('#optLayout').onchange = (e) => { state.opts.layout = e.target.value; store.set('opts', state.opts); if ($('#d2pane').classList.contains('show')) previewD2(d2Editor.getValue()); };
$('#optDir').onchange = (e) => optChange('direction', e.target.value);
$('#optSketch').onchange = (e) => { state.opts.sketch = e.target.checked; store.set('opts', state.opts); if ($('#d2pane').classList.contains('show')) previewD2(d2Editor.getValue()); };
$('#optGroup').onchange = (e) => optChange('group', e.target.checked);
$('#optSelf').onchange = (e) => optChange('showSelf', e.target.checked);
$('#optExt').onchange = (e) => optChange('external', e.target.checked);

// D2 source tab: the emitted D2 is editable — the frontend diagramming layer is just text
let settingD2 = false; let d2Timer = 0;
$('#tabD2').onclick = () => {
  const show = !$('#d2pane').classList.contains('show');
  $('#d2pane').classList.toggle('show', show); $('#tabD2').classList.toggle('on', show);
  if (show) { d2Editor.layout(); if ($('#d2live').checked) previewD2(d2Editor.getValue()); }
};
d2Editor.onDidChangeModelContent(() => {
  if (settingD2) return;
  clearTimeout(d2Timer);
  d2Timer = setTimeout(() => { if ($('#d2live').checked) previewD2(d2Editor.getValue()); }, 400);
});
$('#d2Reset').onclick = () => { settingD2 = true; d2Editor.setValue(state.lastD2); settingD2 = false; if ($('#d2live').checked) previewD2(state.lastD2); };
$('#d2Render').onclick = () => { $('#d2live').checked = true; previewD2(d2Editor.getValue()); };

const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1400); };
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(what + ' copied'); } catch { toast('clipboard blocked — select and copy from the D2 tab'); }
}
$('#copyD2').onclick = () => copy(d2Editor.getValue(), 'D2');
$('#copySvg').onclick = () => { const s = viewport.querySelector('svg'); if (s) copy(s.outerHTML, 'SVG'); };
$('#copyD2b').onclick = () => copy(state.lastD2, 'D2');

// splitter
const splitter = $('#splitter');
let splitting = false;
splitter.addEventListener('pointerdown', (e) => { splitting = true; splitter.classList.add('drag'); splitter.setPointerCapture(e.pointerId); });
splitter.addEventListener('pointermove', (e) => {
  if (!splitting) return;
  const r = $('#main').getBoundingClientRect();
  if (innerWidth <= 820) $('#main').style.gridTemplateRows = `${Math.min(80, Math.max(15, (e.clientY - r.top) / r.height * 100))}% 6px 1fr`;
  else $('#main').style.setProperty('--split', Math.min(80, Math.max(18, (e.clientX - r.left) / r.width * 100)) + '%');
});
splitter.addEventListener('pointerup', () => { splitting = false; splitter.classList.remove('drag'); });

// editor events
editor.onDidChangeModelContent(() => { store.set('code:' + state.lang, editor.getValue()); schedule(); });
let curTimer = 0;
editor.onDidChangeCursorPosition(() => {
  clearTimeout(curTimer);
  curTimer = setTimeout(() => {
    if (state.follow && !selecting && !gesture && state.A && state.altitude !== 'module') {
      const s = scopeAt(state.A, editor.getPosition().lineNumber);
      if (s && s.qual !== state.scopeQual) { state.scopeQual = s.qual; state.needFit = true; refresh(); return; }
    }
    highlightFromCursor();
  }, 90);
});

// ---------------- boot ----------------
(async () => {
  try {
    await Parser.init({ wasmBinary: dec(window.__WASM.runtime), locateFile: (f) => f });
    parser = new Parser();
    await Promise.all(Object.values(LANGS).map((l) => grammar(l.grammar)));
    $('#lang').value = state.lang;
    editor.setModel(modelFor(state.lang));
    fillSamples(); syncControls();
    $('#boot').remove();
    refresh({ force: true });
    if (document.fonts) document.fonts.ready.then(() => monaco.editor.remeasureFonts());
  } catch (e) {
    console.error(e);
    $('#boot').textContent = 'failed to start: ' + (e && e.message || e);
  }
})();
