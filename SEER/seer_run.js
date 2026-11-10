#!/usr/bin/env node
/* SEER run service helper -- runs on the server only, never shipped to browsers.
 *
 * Loads your private SEER tool page (the full assembly editor / soak tester, with the
 * assembler, simulator, control-flow compiler and register allocator), and answers one
 * request read as JSON on stdin with one JSON result on stdout:
 *
 *   request : {action: "run" | "check" | "lower", source: "<assembly>", regDepth: 4..256,
 *              toggles: {cf, symbolic, capability, metaCf}}
 *   result  : {ok, allocationHtml, cfHtml,                       // always
 *              source,                                           // "lower" only
 *              halted, steps, cycles, registers, readBeforeWrite // "run" only
 *              simError}                                         // "run", when the program fails
 *
 * Nothing in the result contains machine code: no bytes, no opcode numbers, no trace.
 *
 * Usage:  node seer_run.js /path/to/private/seer_tool.html < request.json
 *    or:  SEER_TOOL_HTML=/path/to/seer_tool.html node seer_run.js < request.json
 */
'use strict';
const fs = require('fs'), vm = require('vm');

const toolPath = process.argv[2] || process.env.SEER_TOOL_HTML;
if (!toolPath) { process.stdout.write(JSON.stringify({ok: false, error: 'server misconfigured: no tool path'})); process.exit(0); }
const MAX_SOURCE = 200000, MAX_STEPS = 10000000;

/* ---- a do-nothing DOM: every element remembers value/checked/innerHTML; everything else is a no-op ---- */
function stub() {
  const fn = function () { return stub(); };
  return new Proxy(fn, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => '';
      if (p === 'then') return undefined;           // never look like a Promise
      if (p === 'length') return 0;
      if (!(p in t)) t[p] = stub();
      return t[p];
    },
    set(t, p, v) { t[p] = v; return true; },
    apply() { return stub(); },
  });
}
function element() {
  const el = stub();
  Object.assign(el, {value: '', checked: false, innerHTML: '', textContent: '', hidden: false, disabled: false,
    style: stub(), dataset: {}, children: [], options: [],
    classList: {add() {}, remove() {}, toggle() {}, contains() { return false; }},
    querySelectorAll() { return []; }, getElementsByTagName() { return []; }, getElementsByClassName() { return []; }});
  return el;
}
const elements = new Map();
const document = stub();
Object.assign(document, {
  getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
  createElement() { return element(); },
  querySelector() { return element(); }, querySelectorAll() { return []; },
  addEventListener() {}, removeEventListener() {}, body: element(), head: element(), documentElement: element(),
});
const store = {};
const ctx = {
  document, console: {log() {}, warn() {}, error() {}, info() {}, debug() {}},
  navigator: {}, location: {href: '', search: '', hash: ''},
  localStorage: {getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }},
  setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  requestAnimationFrame() { return 0; }, alert() {}, confirm() { return false; }, prompt() { return null; },
  TextEncoder, TextDecoder, URL, Blob: function () {}, performance: {now: () => Date.now()},
};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
for (const id of ['capModeToggle', 'itbAssume', 'softResetToggle']) document.getElementById(id).checked = true;
document.getElementById('regDepthSlider').value = '6';
document.getElementById('imemBudgetSlider').value = '3';

/* ---- the driver runs inside the tool's own script scope, so it can see its const/let tables ---- */
const DRIVER = `
;globalThis.__seerRun = function (req) {
  const E = id => document.getElementById(id);
  const di = REG_DEPTH_VALUES.indexOf(Number(req.regDepth));
  E('regDepthSlider').value = String(di >= 0 ? di : 6);
  const t = req.toggles || {};
  E('cfToggle').checked = !!t.cf; E('symbolicRegsToggle').checked = !!t.symbolic;
  E('capabilityToggle').checked = !!t.capability; E('metaCfToggle').checked = !!t.metaCf;
  E('itbAssume').checked = true; E('capModeToggle').checked = true;
  E('sourceInput').value = String(req.source || '');
  E('allocationPanel').innerHTML = ''; E('cfErrors').innerHTML = '';
  const eff = getEffectiveSource();
  const out = {ok: true, allocationHtml: String(E('allocationPanel').innerHTML || ''), cfHtml: String(E('cfErrors').innerHTML || '')};
  if (req.action === 'lower') { out.source = eff; return out; }
  if (req.action !== 'run') return out;
  const res = simulateProgram(eff, ${MAX_STEPS}, getRegDepth());
  if (res.error) { out.simError = String(res.error); return out; }
  const regs = {};
  for (let i = 0; i < 256; i++) if (res.reg[i] !== 0n) regs['r' + i] = res.reg[i].toString();
  let rbw = []; try { rbw = readBeforeWriteRegs(eff, res.trace); } catch (e) {}
  return Object.assign(out, {halted: !!res.halted, steps: Number(res.steps), cycles: Number(res.cycles),
                             registers: regs, readBeforeWrite: rbw.map(Number)});
};`;

/* errors may name opcode numbers or byte addresses; keep the words, drop the numbers that describe the encoding */
const clean = s => String(s)
  .replace(/\s*\(0x[0-9a-f]{1,2}\)/gi, '')
  .replace(/unknown opcode 0x[0-9a-f]+/gi, 'unknown instruction')
  .replace(/\(([a-z0-9.]+|\?)\)(?=:)/gi, '($1)');

function main(req) {
  const html = fs.readFileSync(toolPath, 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
  vm.createContext(ctx);
  vm.runInContext(code + DRIVER, ctx, {timeout: 5000, filename: 'seer_tool.js'});
  return ctx.__seerRun(req);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; if (input.length > MAX_SOURCE * 2) { process.stdout.write(JSON.stringify({ok: false, error: 'request too large'})); process.exit(0); } });
process.stdin.on('end', () => {
  let out;
  try {
    const req = JSON.parse(input || '{}');
    if (typeof req.source !== 'string' || req.source.length > MAX_SOURCE) throw new Error('source missing or too large');
    if (!['run', 'check', 'lower'].includes(req.action)) throw new Error('unknown action');
    out = main(req);
    if (out.simError) out.simError = clean(out.simError);
  } catch (e) { out = {ok: false, error: clean(e && e.message || e)}; }
  process.stdout.write(JSON.stringify(out));
});
