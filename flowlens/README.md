# FlowLens

Monaco editor → tree-sitter CST → kind-tagged UAST → CFG / reaching defs / SSA value graph / call graph → D2 → SVG.

    npm install
    node build.mjs          # → dist/ (open dist/index.html through any static server)
    node test/run.mjs       # every sample × every view compiled through D2 (add --render for SVGs)
    node test/fuzz.mjs python /usr/lib/python3.12 500   # robustness sweep

Layout
- src/adapters/python.js, javascript.js — the only language-specific code (word: CST → UAST kinds)
- src/core/du.js     — kind/match: defs & uses per UAST kind
- src/core/cfg.js    — scopes, CFG (branches, loops, break/continue, try/except/finally, match/switch, assert), basic blocks
- src/core/flow.js   — reaching definitions, def→use graph, SSA-style value graph with φ nodes and dead-store marking
- src/core/calls.js  — module-altitude call graph
- src/core/views.js  — view × altitude → GraphModel
- src/core/emit.js   — GraphModel → D2 text + base64 id map for click-to-source
- src/main.js        — UI

Adding a language = one adapter that lowers its tree-sitter CST into the same kinds.
