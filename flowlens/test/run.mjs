import Parser from '../node_modules/web-tree-sitter/tree-sitter.js';
import { D2 } from '../node_modules/@terrastruct/d2/dist/node-esm/index.js';
import { python } from '../src/adapters/python.js';
import { javascript } from '../src/adapters/javascript.js';
import { analyze, buildView } from '../src/core/views.js';
import { emitD2 } from '../src/core/emit.js';
import { SAMPLES } from '../src/samples.js';
import fs from 'fs';
await Parser.init();
const langs = { python, javascript };
const d2 = new D2();
const only = process.argv[2];
const render = process.argv.includes('--render');
fs.mkdirSync('/tmp/out', { recursive: true });
let fails = 0;
for (const [lid, set] of Object.entries(SAMPLES)) {
  const L = await Parser.Language.load(`node_modules/tree-sitter-wasms/out/tree-sitter-${lid}.wasm`);
  const p = new Parser(); p.setLanguage(L);
  for (const [name, src] of Object.entries(set)) {
    if (only && !name.startsWith(only)) continue;
    const tree = p.parse(src);
    const mod = langs[lid].module(tree.rootNode, src);
    const A = analyze(mod, langs[lid]);
    for (const scope of A.scopes) {
      for (const [view, alt] of [['control','statement'],['control','block'],['data','statement'],['data','block'],['both','statement'],['data','expression'],['both','expression'],['control','module']]) {
        if (alt === 'module' && scope.kind !== 'module') continue;
        let model, out;
        try {
          model = buildView(A, scope, view, alt, { direction: 'down', external: true, group: false, showSelf: false });
          out = emitD2(model);
          const r = await d2.compile(out.d2, { layout: process.env.LAYOUT || 'elk' });
          if (render) { const svg = await d2.render(r.diagram, r.renderOptions); fs.writeFileSync(`/tmp/out/${lid}_${name.replace(/\W+/g,'_')}_${scope.qual.replace(/\W+/g,'_')}_${view}_${alt}.svg`, svg); }
          console.log('ok  ', lid, name, '|', scope.qual, view, alt, '|', model.stats);
        } catch (e) {
          fails++;
          console.log('FAIL', lid, name, '|', scope.qual, view, alt, e.stack || e.message || e);
          if (out) fs.writeFileSync('/tmp/out/fail.d2', out.d2);
        }
      }
    }
  }
}
console.log('fails', fails);
process.exit(0);
