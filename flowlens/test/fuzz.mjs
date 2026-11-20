import Parser from '../node_modules/web-tree-sitter/tree-sitter.js';
import { python } from '../src/adapters/python.js';
import { javascript } from '../src/adapters/javascript.js';
import { analyze, buildView } from '../src/core/views.js';
import { emitD2 } from '../src/core/emit.js';
import fs from 'fs'; import path from 'path';
await Parser.init();
const [lid, dir, limit] = process.argv.slice(2);
const lang = { python, javascript }[lid];
const L = await Parser.Language.load(`node_modules/tree-sitter-wasms/out/tree-sitter-${lid}.wasm`);
const p = new Parser(); p.setLanguage(L);
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, f.name); if (f.isDirectory() && !/node_modules|test/.test(f.name)) walk(fp); else if (fp.endsWith(lid === 'python' ? '.py' : '.js')) files.push(fp); } };
walk(dir);
let n = 0, scopes = 0, fails = 0; const t0 = Date.now();
for (const f of files.slice(0, +limit || 200)) {
  const src = fs.readFileSync(f, 'utf8');
  if (src.length > 200000) continue;
  n++;
  let A;
  try { A = analyze(lang.module(p.parse(src).rootNode, src), lang); } catch (e) { fails++; console.log('ADAPT', f, e.stack.split('\n').slice(0,3).join(' | ')); continue; }
  for (const s of A.scopes) {
    scopes++;
    for (const [v, a] of [['control','statement'],['control','block'],['data','statement'],['both','block'],['data','expression'],['both','expression']]) {
      try { emitD2(buildView(A, s, v, a, { direction: 'down', external: true, showSelf: false })); }
      catch (e) { fails++; if (fails < 15) console.log('FAIL', f, s.qual, v, a, e.stack.split('\n').slice(0,3).join(' | ')); }
    }
  }
  try { emitD2(buildView(A, A.scopes[0], 'control', 'module', { external: true })); } catch (e) { fails++; console.log('MOD', f, e.message); }
}
console.log({ files: n, scopes, fails, ms: Date.now() - t0 });
