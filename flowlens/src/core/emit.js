// emit — GraphModel → D2, in Vertex's palette (NODE_FILL / TYPE_FILL / edge colors from Vertex render.js).
const BG = '#0f0f14';
const INK = '#eeeeee';
const STROKE = '#cccccc';

// shape, fill, extra style
const VX = {
  start: ['oval', '#007f00'],
  end: ['oval', '#7f0000'],
  fn: ['oval', '#92700a'],
  ret: ['oval', '#333333'],
  raise: ['oval', '#7f0000'],
  process: ['rectangle', '#333333', { 'border-radius': 4 }],
  call: ['rectangle', '#92700a', { 'border-radius': 4 }],
  effect: ['rectangle', '#92700a', { 'border-radius': 4, 'stroke-width': 3 }],
  output: ['parallelogram', '#ED8936'],
  input: ['parallelogram', '#007f00'],
  param: ['parallelogram', '#007f00'],
  import: ['rectangle', '#007f00', { 'border-radius': 4 }],
  decision: ['diamond', '#004b8d'],
  fork: ['circle', '#5c2d91'],
  dot: ['circle', '#bbbbbb'],
  phi: ['circle', '#bbbbbb'],
  handler: ['rectangle', '#333333', { stroke: '#f59e0b', 'border-radius': 4 }],
  finally: ['rectangle', '#333333', { stroke: '#f59e0b', 'stroke-dash': 3, 'border-radius': 4 }],
  badge: ['rectangle', '#222831', { 'border-radius': 4, bold: true }],
  dead: ['rectangle', '#7f0000', { 'border-radius': 4, 'stroke-dash': 3, bold: true }],
  state: ['rectangle', '#7a4d2e', { 'border-radius': 4 }],
  free: ['oval', '#333333', { 'stroke-dash': 3 }],
  const: ['rectangle', '#1c1c24', { 'border-radius': 4, stroke: '#555555', 'font-color': '#aaaaaa' }],
  var: ['sql_table', '#222831'],
};
const GROUP = {
  try: { fill: 'transparent', stroke: '#f59e0b', 'stroke-width': 2, 'stroke-dash': 4, 'font-color': '#f59e0b', 'font-size': 12, bold: false, 'border-radius': 6 },
  block: { fill: '#17171e', stroke: '#26263a', 'font-color': '#9ca3af', 'font-size': 11, bold: false, 'border-radius': 8 },
  classcol: { fill: '#17171e', stroke: '#3a3a5c', 'font-color': '#cdd6f4', 'font-size': 14, bold: true, 'border-radius': 8 },
  col: { fill: 'transparent', stroke: 'transparent' },
  sblock: { fill: '#17171e', stroke: '#2a2a3e', 'font-color': '#9ca3af', 'font-size': 11, bold: false, 'border-radius': 8 },
  stmtbox: { fill: '#17171e', stroke: '#26263a', 'font-color': '#9ca3af', 'font-size': 11, bold: false, 'border-radius': 8 },
  bb: { fill: 'transparent', stroke: '#3a3a5c', 'stroke-dash': 3, 'border-radius': 6 },
};
const EDGE = {
  yes: { stroke: '#4ade80' }, no: { stroke: '#f87171' }, flow: { stroke: '#aaaaaa' }, case: { stroke: '#c4b5fd' },
  exc: { stroke: '#f59e0b', 'stroke-dash': 4 },
  data: { stroke: '#9aa4b2' }, dataweak: { stroke: '#9aa4b2', 'stroke-dash': 3 }, dataover: { stroke: '#9aa4b2', 'stroke-dash': 3 },
  phi: { stroke: '#bbbbbb', 'stroke-dash': 3 }, mut: { stroke: '#92700a', 'stroke-dash': 3 },
  call: { stroke: '#d4a017', 'stroke-dash': 5 }, maybe: { stroke: '#d4a017', 'stroke-dash': 2, opacity: 0.6 },
};

const val = (v) => (typeof v === 'string' && !/^[\w.-]+$/.test(v) ? JSON.stringify(v) : v);
const S = (o) => '{' + Object.entries(o).map(([k, v]) => `${k}: ${val(v)}`).join('; ') + '}';

export const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\n/g, '\\n') + '"';

export function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = ''; bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function nodeClass(vx) {
  const [shape, fill, extra = {}] = VX[vx] || VX.process;
  const style = { fill, stroke: STROKE, 'stroke-width': 2, 'font-color': INK, 'font-size': 13, bold: false, ...extra };
  if (vx === 'var') { style.stroke = '#333333'; delete style['stroke-width']; style.bold = true; }
  const dims = vx === 'dot' ? '; width: 16; height: 16' : vx === 'phi' ? '; width: 18; height: 18' : '';
  return `{shape: ${shape}${dims}; style: ${S(style)}}`;
}

export function emitD2(model) {
  const ids = new Map(); let k = 0;
  const sid = (id) => { if (!ids.has(id)) ids.set(id, (/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) ? id : 'i' + k++ + '_' + String(id).replace(/[^A-Za-z0-9_]/g, '_'))); return ids.get(id); };
  const parentOf = new Map();
  (model.groups || []).forEach((g) => parentOf.set(g.id, g.parent || null));
  model.nodes.forEach((n) => parentOf.set(n.id, n.parent || null));
  const path = (id) => { const p = []; for (let x = id; x; x = parentOf.get(x)) p.unshift(sid(x)); return p.join('.'); };

  const out = [];
  out.push(`vars: { d2-config: { theme-id: 200; theme-overrides: { N7: "${BG}"; N1: "${INK}"; N2: "${INK}"; B1: "#aaaaaa"; B2: "${INK}"; AA2: "${INK}"; AA4: "${INK}"; AB4: "${INK}" } } }`);
  out.push(`direction: ${model.direction || 'down'}`);
  if (model.grid) { out.push(`grid-columns: ${model.grid}`); out.push('grid-gap: 90'); }
  const used = new Set(model.nodes.map((n) => n.vx));
  out.push('classes: {');
  for (const vx of used) out.push(`  vx_${vx}: ${nodeClass(vx)}`);
  for (const g of new Set((model.groups || []).map((x) => x.vx))) if (GROUP[g]) out.push(`  gx_${g}: {style: ${S(GROUP[g])}}`);
  out.push('}');

  const map = new Map();
  const children = new Map();
  const push = (p, item) => { if (!children.has(p)) children.set(p, []); children.get(p).push(item); };
  for (const g of model.groups || []) push(g.parent || '', { g });
  for (const n of model.nodes) push(n.parent || '', { n });

  const writeLevel = (parent, ind) => {
    for (const item of children.get(parent) || []) {
      if (item.n) {
        const n = item.n;
        const extra = [];
        if (n.fill) extra.push(`style.fill: ${val(n.fill)}`);
        if (n.dashed) extra.push('style.stroke-dash: 3');
        if (n.dim) extra.push('style.opacity: 0.35');
        if (n.vx === 'phi') extra.push('label.near: outside-right-center');
        if (n.vx === 'var' && n.table) {
          out.push(`${ind}${sid(n.id)}: ${q(n.table.header)} {`);
          out.push(`${ind}  class: vx_var`);
          out.push(`${ind}  style.fill: ${val(n.table.fill)}`);
          if (n.dim) out.push(`${ind}  style.opacity: 0.35`);
          for (const [a, b] of n.table.rows) out.push(`${ind}  ${q(a || ' ')}: ${q(b || '')}`);
          out.push(`${ind}}`);
        } else {
          const lab = n.vx === 'dot' ? '""' : q(n.label);
          out.push(`${ind}${sid(n.id)}: ${lab} {class: vx_${n.vx}${extra.length ? '; ' + extra.join('; ') : ''}}`);
        }
        map.set(b64(path(n.id)), { id: n.id, vx: n.vx, spans: n.spans || (n.span ? [n.span] : []), label: n.label || (n.table && n.table.header) || '' });
      } else {
        const g = item.g;
        out.push(`${ind}${sid(g.id)}: ${q(g.label || '')} {`);
        if (GROUP[g.vx]) out.push(`${ind}  class: gx_${g.vx}`);
        if (g.vx !== 'col' && g.vx !== 'bb') out.push(`${ind}  label.near: top-left`);
        if (g.color) { out.push(`${ind}  style.stroke: ${val(g.color)}`); out.push(`${ind}  style.font-color: ${val(g.color)}`); }
        if (g.grid) { out.push(`${ind}  grid-columns: ${g.grid}`); out.push(`${ind}  grid-gap: 70`); }
        writeLevel(g.id, ind + '  ');
        out.push(`${ind}}`);
        if (g.span) map.set(b64(path(g.id)), { id: g.id, spans: [g.span], label: g.label, group: true });
      }
    }
  };
  writeLevel('', '');

  const known = new Set(parentOf.keys());
  for (const e of model.edges) {
    if (!known.has(e.from) || !known.has(e.to)) continue;
    const st = { ...(EDGE[e.vx] || EDGE.flow), 'stroke-width': 2, 'font-size': 12, italic: false };
    if (e.color) st.stroke = e.color;
    st['font-color'] = st.stroke;
    out.push(`${path(e.from)} -> ${path(e.to)}${e.label ? ': ' + q(e.label) : ''} {style: ${S(st)}}`);
  }
  // variable name → type color, so the page can tint names inside labels the way Vertex does
  const colors = {};
  if (model.env) for (const [name, t] of model.env) colors[name] = t;
  return { d2: out.join('\n') + '\n', map, colors };
}
