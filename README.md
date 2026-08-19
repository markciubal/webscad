# WebSCAD

**OpenSCAD in your browser.** A parametric 3D CAD environment inspired by [OpenSCAD](https://github.com/openscad/openscad), rebuilt for the web: write OpenSCAD-language code, watch it render live in WebGL, and export STL/OBJ for 3D printing — with everything running locally on your device. No server round-trips, no accounts, no uploads: your files live in your browser's localStorage and all geometry is computed in your device's memory.

![WebSCAD](https://img.shields.io/badge/status-alpha-orange) ![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **OpenSCAD language interpreter** written in TypeScript — a real tokenizer/parser/evaluator, not a WASM port
  - Variables, arithmetic, vectors, ranges, string ops, ternaries
  - `module` / `function` definitions with recursion, named + positional + default arguments
  - `for`, `intersection_for`, `if`/`else`, `let`, list comprehensions (`[for (...) ...]`, `each`, nested `if`/`let`, C-style `for`)
  - `children()` (all / by index / by range), `$children`
  - Special variables `$fn`, `$fa`, `$fs` with OpenSCAD's fragment formula, dynamic `$var` propagation through calls
  - `include <file>` / `use <file>` resolving against your workspace files
  - `echo()`, `assert()` (statement and expression forms), function literals
  - Math/list/string builtins: trig in degrees, `norm`, `cross`, `concat`, `str`, `lookup`, `rands` (deterministic), `search`, type predicates, …
- **Geometry & CSG** — three.js + [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg)
  - 3D: `cube`, `sphere`, `cylinder` (cones included), `polyhedron`
  - 2D: `square`, `circle`, `polygon` (with hole paths), extruded via `linear_extrude` (twist/scale/slices supported) and `rotate_extrude` (partial angles supported)
  - Booleans: `union`, `difference`, `intersection`, plus `hull()` (3D convex hull and 2D)
  - Transforms: `translate`, `rotate` (Euler & axis-angle), `scale`, `mirror`, `multmatrix`, `resize`, `color` (names / hex / rgba)
  - Modifiers: `*` disable, `!` root, `#` highlight, `%` background
- **Modern web app** — Next.js (App Router) + TypeScript
  - CodeMirror 6 editor with OpenSCAD syntax highlighting and autocompletion
  - Geometry compiles in a **Web Worker** (main-thread fallback), so the UI never freezes; hung renders time out and recover
  - WebGL viewer with orbit controls, Z-up grid, auto-framing
  - Workspace persisted to **localStorage** with multiple files, auto-save, import of local `.scad` files
  - Export **binary STL**, **OBJ**, or the `.scad` source — all generated client-side
  - Bundled examples: CSG demo, parametric gear, twisted vase, recursive tree, and more

## Getting started

```bash
npm install
npm run dev     # http://localhost:3000
```

- **Ctrl+Enter** (or F5) renders; the *auto* checkbox re-renders as you type.
- Files are saved automatically in your browser. Use *New / Rename / Delete / Open…* in the toolbar to manage them.
- `include <other.scad>` / `use <other.scad>` refer to other files in your workspace by name.
- **⬇ STL** exports a binary STL of the current model (background `%` geometry excluded).

```bash
npm run smoke   # headless interpreter + CSG test suite
npm run build   # production build
```

## Architecture

```
lib/scad/
  lexer.ts       tokens (handles include<...>, modifiers, comments)
  parser.ts      recursive-descent parser → AST
  evaluator.ts   AST → scene tree (scopes, modules, $vars, loops, list comprehensions)
  stdlib.ts      builtin functions
  geometry.ts    primitives, extrusions, triangulation, 2D contours
  csg.ts         scene tree → meshes (booleans via three-bvh-csg, hull, resize)
  compile.ts     one-call pipeline: source → triangle buffers
  compile.worker.ts  Web Worker wrapper (transfers buffers zero-copy)
lib/export/      binary/ASCII STL + OBJ writers
lib/storage.ts   localStorage workspace
components/      React UI: editor, WebGL viewer, toolbar, console
```

The evaluator produces an abstract scene tree (no three.js dependency), which the CSG compiler lowers to world-space triangle soup. Union children are kept as separate meshes (preserving per-subtree colors, like OpenSCAD's preview); `difference`/`intersection` operands are CSG-merged first, so booleans are exact meshes you can export.

## Known limitations (roadmap)

- `text()`, `surface()`, `import()`, `projection()`, `offset()` are not implemented yet (warnings, not errors)
- `minkowski()` falls back to a union with a warning
- 2D booleans are approximated: `difference()` in 2D turns subtracted outlines into holes (fine for the common washer/plate cases); 2D `intersection()` uses the first child
- No `$t` animation timeline yet (the variable exists and defaults to 0)

## Contributing

PRs welcome. `npm run smoke` must pass; add a test line for any new language feature.

## License

MIT. This is an independent clean-room implementation of the OpenSCAD language — it shares no code with OpenSCAD itself (which is GPL-2.0).
