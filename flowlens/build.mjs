import * as esbuild from 'esbuild';
import fs from 'fs';
fs.mkdirSync('dist', { recursive: true });
await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', outfile: 'dist/app.js', minify: true, loader: { '.ttf': 'dataurl' }, external: ['fs', 'path', 'module'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' });
await esbuild.build({ entryPoints: ['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'], bundle: true, format: 'iife', outfile: 'dist/editor.worker.js', minify: true, logLevel: 'warning' });
await esbuild.build({ entryPoints: ['src/d2-entry.js'], bundle: true, format: 'iife', outfile: 'dist/d2.js', minify: true, logLevel: 'warning' });
const b = (p) => fs.readFileSync(p).toString('base64');
fs.writeFileSync('dist/grammars.js', 'window.__WASM=' + JSON.stringify({
  runtime: b('node_modules/web-tree-sitter/tree-sitter.wasm'),
  python: b('node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm'),
  javascript: b('node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm'),
}) + ';');
fs.copyFileSync('src/index.html', 'dist/index.html');
for (const f of fs.readdirSync('dist')) console.log(f, (fs.statSync('dist/' + f).size / 1024).toFixed(0) + ' KB');
