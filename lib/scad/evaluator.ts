import { parse } from "./parser";
import {
  Arg, Assign, Contour, EvalOutput, Expr, LcElement, Param, Pos,
  RangeValue, ScadError, SceneNode, Stmt, Value, Vec3,
  fmtValue, isRange, iterateRange,
} from "./types";
import { COLOR_NAMES } from "./colors";
import { builtinFunctions } from "./stdlib";

// ---------------- scopes ----------------

interface FunctionDef {
  params: Param[];
  body: Expr;
  closure: Scope;
}

interface ModuleDef {
  params: Param[];
  body: Stmt;
  closure: Scope;
}

class Scope {
  vars = new Map<string, Value>();
  functions = new Map<string, FunctionDef>();
  modules = new Map<string, ModuleDef>();
  constructor(public parent: Scope | null) {}

  lookup(name: string): { found: boolean; value: Value } {
    if (this.vars.has(name)) return { found: true, value: this.vars.get(name) };
    return this.parent ? this.parent.lookup(name) : { found: false, value: undefined };
  }

  lookupFunction(name: string): FunctionDef | null {
    return this.functions.get(name) ?? this.parent?.lookupFunction(name) ?? null;
  }

  lookupModule(name: string): ModuleDef | null {
    return this.modules.get(name) ?? this.parent?.lookupModule(name) ?? null;
  }
}

/** Children passed to a user module, evaluated lazily in the caller's context. */
interface ChildrenCtx {
  stmts: Stmt[];
  scope: Scope;
  children: ChildrenCtx | null; // caller's own children (for nested children())
}

const MAX_RECURSION = 400;
const MAX_ELEMENTS = 2_000_000;

interface FnValue {
  __fn: true;
  params: Param[];
  body: Expr;
  closure: Scope;
}

function isFnValue(v: unknown): v is FnValue {
  return typeof v === "object" && v !== null && (v as FnValue).__fn === true;
}

// ---------------- evaluator ----------------

export class Evaluator {
  echo: string[] = [];
  warnings: string[] = [];
  private files: Record<string, string>;
  private includeStack: string[] = [];
  private depth = 0;
  private elementCount = 0;
  private rootMarked: SceneNode | null = null;
  private deadline: number;

  constructor(files: Record<string, string> = {}, timeLimitMs = 20000) {
    this.files = files;
    this.deadline = Date.now() + timeLimitMs;
  }

  run(source: string): EvalOutput {
    const ast = parse(source);
    const global = new Scope(null);
    // special variable defaults
    global.vars.set("$fn", 0);
    global.vars.set("$fa", 12);
    global.vars.set("$fs", 2);
    global.vars.set("$t", 0);
    global.vars.set("$preview", true);
    global.vars.set("$children", 0);
    global.vars.set("PI", Math.PI);

    const nodes = this.evalStatements(ast, global, null);
    let root: SceneNode = { type: "group", children: nodes };
    if (this.rootMarked) root = this.rootMarked;
    return { root, echo: this.echo, warnings: this.warnings };
  }

  private checkBudget(pos?: Pos) {
    if (Date.now() > this.deadline) {
      throw new ScadError("Evaluation time limit exceeded (infinite loop or model too complex?)", pos);
    }
    if (++this.elementCount > MAX_ELEMENTS) {
      throw new ScadError("Model element limit exceeded", pos);
    }
  }

  private warn(msg: string, pos?: Pos) {
    if (this.warnings.length < 100) {
      this.warnings.push(pos ? `${msg} (line ${pos.line})` : msg);
    }
  }

  // ---------------- statements ----------------

  private evalStatements(stmts: Stmt[], scope: Scope, children: ChildrenCtx | null): SceneNode[] {
    // pass 1: hoist module + function definitions (OpenSCAD allows forward use)
    for (const s of stmts) {
      if (s.kind === "moduleDef") scope.modules.set(s.name, { params: s.params, body: s.body, closure: scope });
      else if (s.kind === "functionDef") scope.functions.set(s.name, { params: s.params, body: s.body, closure: scope });
    }
    const out: SceneNode[] = [];
    for (const s of stmts) {
      const nodes = this.evalStatement(s, scope, children);
      out.push(...nodes);
    }
    return out;
  }

  private evalStatement(stmt: Stmt, scope: Scope, children: ChildrenCtx | null): SceneNode[] {
    this.checkBudget(stmt.kind === "noop" ? undefined : (stmt as { pos: Pos }).pos);

    switch (stmt.kind) {
      case "noop":
        return [];

      case "block": {
        const inner = new Scope(scope);
        return this.evalStatements(stmt.body, inner, children);
      }

      case "assign": {
        scope.vars.set(stmt.name, this.evalExpr(stmt.value, scope));
        return [];
      }

      case "moduleDef":
      case "functionDef":
        return []; // hoisted

      case "include": {
        return this.evalInclude(stmt.file, scope, children, false, stmt.pos);
      }
      case "use": {
        return this.evalInclude(stmt.file, scope, children, true, stmt.pos);
      }

      case "if": {
        const cond = truthy(this.evalExpr(stmt.cond, scope));
        if (cond) return this.evalStatement(stmt.then, new Scope(scope), children);
        if (stmt.else) return this.evalStatement(stmt.else, new Scope(scope), children);
        return [];
      }

      case "letStmt": {
        const inner = new Scope(scope);
        for (const a of stmt.assigns) inner.vars.set(a.name, this.evalExpr(a.value, inner));
        return this.evalStatement(stmt.body, inner, children);
      }

      case "for": {
        const groups = this.evalForLoop(stmt.assigns, 0, new Scope(scope), stmt.body, children, stmt.pos);
        if (stmt.intersection) {
          return [{ type: "intersection", children: groups.map((g) => ({ type: "group", children: g }) as SceneNode) }];
        }
        return groups.flat();
      }

      case "moduleCall":
        return this.evalModuleCall(stmt, scope, children);
    }
  }

  private evalForLoop(
    assigns: Assign[], idx: number, scope: Scope, body: Stmt,
    children: ChildrenCtx | null, pos: Pos,
  ): SceneNode[][] {
    if (idx >= assigns.length) {
      return [this.evalStatement(body, new Scope(scope), children)];
    }
    const a = assigns[idx];
    const val = this.evalExpr(a.value, scope);
    const out: SceneNode[][] = [];
    for (const item of iterableValues(val)) {
      this.checkBudget(pos);
      scope.vars.set(a.name, item);
      out.push(...this.evalForLoop(assigns, idx + 1, scope, body, children, pos));
    }
    return out;
  }

  private evalInclude(
    file: string, scope: Scope, children: ChildrenCtx | null, useOnly: boolean, pos: Pos,
  ): SceneNode[] {
    const content = this.files[file];
    if (content === undefined) {
      this.warn(`${useOnly ? "use" : "include"} <${file}>: file not found in workspace`, pos);
      return [];
    }
    if (this.includeStack.includes(file)) {
      this.warn(`Circular include of <${file}> ignored`, pos);
      return [];
    }
    this.includeStack.push(file);
    try {
      let ast: Stmt[];
      try {
        ast = parse(content);
      } catch (e) {
        this.warn(`Error parsing <${file}>: ${(e as Error).message}`, pos);
        return [];
      }
      if (useOnly) {
        // only definitions
        for (const s of ast) {
          if (s.kind === "moduleDef") scope.modules.set(s.name, { params: s.params, body: s.body, closure: scope });
          else if (s.kind === "functionDef") scope.functions.set(s.name, { params: s.params, body: s.body, closure: scope });
        }
        return [];
      }
      return this.evalStatements(ast, scope, children);
    } finally {
      this.includeStack.pop();
    }
  }

  // ---------------- module calls ----------------

  private evalModuleCall(stmt: Extract<Stmt, { kind: "moduleCall" }>, scope: Scope, children: ChildrenCtx | null): SceneNode[] {
    const { modifier } = stmt;

    // * disables the subtree entirely
    if (modifier.includes("*")) return [];

    let nodes = this.evalModuleCallInner(stmt, scope, children);

    if (modifier.includes("%")) {
      nodes = [{ type: "background", children: nodes }];
    }
    if (modifier.includes("#")) {
      nodes = [{ type: "highlight", children: nodes }];
    }
    if (modifier.includes("!")) {
      const node: SceneNode = { type: "group", children: nodes };
      if (!this.rootMarked) this.rootMarked = node;
      return [node];
    }
    return nodes;
  }

  private evalModuleCallInner(stmt: Extract<Stmt, { kind: "moduleCall" }>, scope: Scope, children: ChildrenCtx | null): SceneNode[] {
    const { name, args, child, pos } = stmt;

    const childStmts = child ? (child.kind === "block" ? child.body : [child]) : [];
    const evalChildren = (): SceneNode[] => {
      if (!child) return [];
      const inner = new Scope(scope);
      return this.evalStatement(child, inner, children);
    };

    // user-defined module takes precedence
    const userMod = scope.lookupModule(name);
    if (userMod && !BUILTIN_PRIORITY.has(name)) {
      return this.callUserModule(name, userMod, args, childStmts, scope, children, pos);
    }

    switch (name) {
      case "__wrap":
        return evalChildren();

      // ---- 3D primitives ----
      case "cube": return [this.makeCube(args, scope)];
      case "sphere": return [this.makeSphere(args, scope)];
      case "cylinder": return [this.makeCylinder(args, scope)];
      case "polyhedron": return [this.makePolyhedron(args, scope, pos)];

      // ---- 2D primitives ----
      case "square": return [this.makeSquare(args, scope)];
      case "circle": return [this.makeCircle(args, scope)];
      case "polygon": return [this.makePolygon(args, scope, pos)];
      case "text":
        this.warn("text() is not supported yet; ignored", pos);
        return [];

      // ---- extrusions ----
      case "linear_extrude": {
        const a = this.namedArgs(args, scope, ["height", "center", "convexity", "twist", "slices", "scale"]);
        const height = num(a.height ?? a._p[0], 100);
        const center = bool(a.center, false);
        const twist = num(a.twist, 0);
        const sc = a.scale === undefined ? [1, 1] : vec2(a.scale, [1, 1]);
        const slices = Math.max(1, Math.floor(num(a.slices, twist !== 0 ? Math.max(2, Math.abs(twist) / 6) : 1)));
        return [{ type: "linear_extrude", height, center, twist, slices, scale: sc as [number, number], children: evalChildren() }];
      }
      case "rotate_extrude": {
        const a = this.namedArgs(args, scope, ["angle", "convexity"]);
        const angle = num(a.angle, 360);
        const segments = this.fragments(scope, 100);
        return [{ type: "rotate_extrude", angle, segments, children: evalChildren() }];
      }

      // ---- transforms ----
      case "translate": {
        const a = this.namedArgs(args, scope, ["v"]);
        const v = vec3(a.v ?? a._p[0], [0, 0, 0]);
        return [{ type: "transform", matrix: translationMatrix(v), children: evalChildren() }];
      }
      case "rotate": {
        const a = this.namedArgs(args, scope, ["a", "v"]);
        const m = rotateMatrix(a.a ?? a._p[0], a.v ?? a._p[1]);
        return [{ type: "transform", matrix: m, children: evalChildren() }];
      }
      case "scale": {
        const a = this.namedArgs(args, scope, ["v"]);
        const raw = a.v ?? a._p[0];
        const v: Vec3 = typeof raw === "number" ? [raw, raw, raw] : vec3(raw, [1, 1, 1]);
        return [{ type: "transform", matrix: scaleMatrix(v), children: evalChildren() }];
      }
      case "mirror": {
        const a = this.namedArgs(args, scope, ["v"]);
        const v = vec3(a.v ?? a._p[0], [1, 0, 0]);
        return [{ type: "transform", matrix: mirrorMatrix(v), children: evalChildren() }];
      }
      case "multmatrix": {
        const a = this.namedArgs(args, scope, ["m"]);
        const m = a.m ?? a._p[0];
        return [{ type: "transform", matrix: multmatrixFrom(m), children: evalChildren() }];
      }
      case "resize": {
        const a = this.namedArgs(args, scope, ["newsize", "auto"]);
        const ns = vec3(a.newsize ?? a._p[0], [0, 0, 0]);
        const autoRaw = a.auto ?? a._p[1];
        const auto: [boolean, boolean, boolean] = Array.isArray(autoRaw)
          ? [truthy(autoRaw[0]), truthy(autoRaw[1]), truthy(autoRaw[2])]
          : autoRaw !== undefined
            ? [truthy(autoRaw), truthy(autoRaw), truthy(autoRaw)]
            : [false, false, false];
        // encoded as special transform resolved at geometry time
        return [{
          type: "transform",
          matrix: [NaN, ns[0], ns[1], ns[2], auto[0] ? 1 : 0, auto[1] ? 1 : 0, auto[2] ? 1 : 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          children: evalChildren(),
        }];
      }
      case "color": {
        const a = this.namedArgs(args, scope, ["c", "alpha"]);
        const rgba = parseColor(a.c ?? a._p[0], num(a.alpha ?? a._p[1], 1), (m) => this.warn(m, pos));
        return [{ type: "color", color: rgba, children: evalChildren() }];
      }

      // ---- booleans ----
      case "union": return [{ type: "union", children: evalChildren() }];
      case "difference": return [{ type: "difference", children: evalChildren() }];
      case "intersection": return [{ type: "intersection", children: evalChildren() }];
      case "hull": return [{ type: "hull", children: evalChildren() }];
      case "minkowski": {
        this.warn("minkowski() is not supported yet; rendering union of children instead", pos);
        return [{ type: "union", children: evalChildren() }];
      }
      case "offset": {
        this.warn("offset() is not supported yet; children rendered unmodified", pos);
        return evalChildren();
      }
      case "projection": {
        this.warn("projection() is not supported yet; ignored", pos);
        return [];
      }
      case "surface": {
        this.warn("surface() is not supported (no filesystem); ignored", pos);
        return [];
      }
      case "import": {
        this.warn("import() is not supported yet; ignored", pos);
        return [];
      }
      case "render": {
        return [{ type: "group", children: evalChildren() }];
      }

      // ---- children() ----
      case "children": {
        if (!children) {
          this.warn("children() called outside a module", pos);
          return [];
        }
        const a = this.namedArgs(args, scope, ["idx"]);
        const idxVal = a.idx ?? a._p[0];
        const all = children.stmts;
        const evalChildAt = (i: number): SceneNode[] => {
          if (i < 0 || i >= all.length) return [];
          return this.evalStatement(all[i], new Scope(children.scope), children.children);
        };
        if (idxVal === undefined) {
          const out: SceneNode[] = [];
          for (let i = 0; i < all.length; i++) out.push(...evalChildAt(i));
          return out;
        }
        if (typeof idxVal === "number") return evalChildAt(Math.floor(idxVal));
        if (isRange(idxVal)) {
          const out: SceneNode[] = [];
          for (const i of iterateRange(idxVal)) out.push(...evalChildAt(Math.floor(i)));
          return out;
        }
        if (Array.isArray(idxVal)) {
          const out: SceneNode[] = [];
          for (const i of idxVal) if (typeof i === "number") out.push(...evalChildAt(Math.floor(i)));
          return out;
        }
        return [];
      }

      // ---- echo / assert ----
      case "echo": {
        const parts: string[] = [];
        for (const arg of args) {
          const v = this.evalExpr(arg.value, scope);
          parts.push(arg.name ? `${arg.name} = ${fmtValue(v)}` : typeof v === "string" ? fmtValue(v) : fmtValue(v));
        }
        this.echo.push(`ECHO: ${parts.join(", ")}`);
        return child ? evalChildren() : [];
      }
      case "assert": {
        const a = this.namedArgs(args, scope, ["condition", "message"]);
        const cond = a.condition ?? a._p[0];
        if (!truthy(cond)) {
          const msg = a.message ?? a._p[1];
          throw new ScadError(`Assertion failed${msg !== undefined ? ": " + fmtValue(msg) : ""}`, pos);
        }
        return child ? evalChildren() : [];
      }

      default: {
        if (userMod) {
          return this.callUserModule(name, userMod, args, childStmts, scope, children, pos);
        }
        this.warn(`Unknown module '${name}' ignored`, pos);
        return [];
      }
    }
  }

  private callUserModule(
    name: string, def: ModuleDef, args: Arg[], childStmts: Stmt[],
    callerScope: Scope, callerChildren: ChildrenCtx | null, pos: Pos,
  ): SceneNode[] {
    if (++this.depth > MAX_RECURSION) {
      this.depth--;
      throw new ScadError(`Recursion limit exceeded in module '${name}'`, pos);
    }
    try {
      const moduleScope = new Scope(def.closure);
      this.bindParams(def.params, args, callerScope, moduleScope);
      // dynamic $-variable propagation: copy caller's visible $ vars unless bound
      this.propagateSpecials(callerScope, moduleScope);
      moduleScope.vars.set("$children", childStmts.length);
      const childrenCtx: ChildrenCtx = { stmts: childStmts, scope: callerScope, children: callerChildren };
      const body = def.body.kind === "block" ? def.body.body : [def.body];
      return this.evalStatements(body, moduleScope, childrenCtx);
    } finally {
      this.depth--;
    }
  }

  private propagateSpecials(from: Scope, to: Scope) {
    const seen = new Set<string>();
    let s: Scope | null = from;
    while (s) {
      for (const [k, v] of s.vars) {
        if (k.startsWith("$") && !seen.has(k)) {
          seen.add(k);
          if (!to.vars.has(k)) to.vars.set(k, v);
        }
      }
      s = s.parent;
    }
  }

  private bindParams(params: Param[], args: Arg[], callerScope: Scope, target: Scope) {
    const positional: Value[] = [];
    const named = new Map<string, Value>();
    for (const arg of args) {
      const v = this.evalExpr(arg.value, callerScope);
      if (arg.name) {
        named.set(arg.name, v);
        if (arg.name.startsWith("$")) target.vars.set(arg.name, v);
      } else {
        positional.push(v);
      }
    }
    params.forEach((p, i) => {
      if (named.has(p.name)) target.vars.set(p.name, named.get(p.name));
      else if (i < positional.length) target.vars.set(p.name, positional[i]);
      else if (p.default !== undefined) target.vars.set(p.name, this.evalExpr(p.default, target));
      else target.vars.set(p.name, undefined);
    });
  }

  /** Evaluate args into named + positional buckets. */
  private namedArgs(args: Arg[], scope: Scope, names: string[]): Record<string, Value> & { _p: Value[] } {
    const out: Record<string, Value> & { _p: Value[] } = { _p: [] } as Record<string, Value> & { _p: Value[] };
    let pi = 0;
    for (const arg of args) {
      const v = this.evalExpr(arg.value, scope);
      if (arg.name) {
        if (arg.name.startsWith("$")) scope.vars.set(arg.name, v);
        else out[arg.name] = v;
      } else {
        out._p.push(v);
        if (pi < names.length && out[names[pi]] === undefined) {
          // positional also mapped by callers via _p
        }
        pi++;
      }
    }
    return out;
  }

  /** OpenSCAD fragment count from $fn/$fa/$fs. */
  private fragments(scope: Scope, r: number): number {
    const fn = num(scope.lookup("$fn").value, 0);
    const fa = num(scope.lookup("$fa").value, 12);
    const fs = num(scope.lookup("$fs").value, 2);
    if (fn > 0) return Math.max(3, Math.min(512, Math.floor(fn)));
    if (r <= 0) return 3;
    const frag = Math.ceil(Math.max(Math.min(360 / fa, (r * 2 * Math.PI) / fs), 5));
    return Math.max(3, Math.min(512, frag));
  }

  // ---------------- primitives ----------------

  private makeCube(args: Arg[], scope: Scope): SceneNode {
    const a = this.namedArgs(args, scope, ["size", "center"]);
    const sizeRaw = a.size ?? a._p[0];
    const size: Vec3 = typeof sizeRaw === "number"
      ? [sizeRaw, sizeRaw, sizeRaw]
      : sizeRaw === undefined ? [1, 1, 1] : vec3(sizeRaw, [1, 1, 1]);
    const center = bool(a.center ?? a._p[1], false);
    return { type: "cube", size, center };
  }

  private makeSphere(args: Arg[], scope: Scope): SceneNode {
    const a = this.namedArgs(args, scope, ["r", "d"]);
    let r = 1;
    if (a.d !== undefined) r = num(a.d, 2) / 2;
    else if (a.r !== undefined) r = num(a.r, 1);
    else if (a._p[0] !== undefined) r = num(a._p[0], 1);
    return { type: "sphere", r, segments: this.fragments(scope, r) };
  }

  private makeCylinder(args: Arg[], scope: Scope): SceneNode {
    const a = this.namedArgs(args, scope, ["h", "r1", "r2", "center", "r", "d", "d1", "d2"]);
    const h = num(a.h ?? a._p[0], 1);
    let r1 = 1, r2 = 1;
    if (a.r !== undefined) { r1 = r2 = num(a.r, 1); }
    if (a._p[1] !== undefined && a.r1 === undefined && a.r === undefined && a.d === undefined) {
      // cylinder(h, r) positional, also cylinder(h, r1, r2)
      r1 = num(a._p[1], 1);
      r2 = a._p[2] !== undefined ? num(a._p[2], r1) : r1;
    }
    if (a.r1 !== undefined) r1 = num(a.r1, 1);
    if (a.r2 !== undefined) r2 = num(a.r2, 1);
    if (a.d !== undefined) { r1 = r2 = num(a.d, 2) / 2; }
    if (a.d1 !== undefined) r1 = num(a.d1, 2) / 2;
    if (a.d2 !== undefined) r2 = num(a.d2, 2) / 2;
    const center = bool(a.center, false);
    const segments = this.fragments(scope, Math.max(r1, r2));
    return { type: "cylinder", h, r1, r2, center, segments };
  }

  private makePolyhedron(args: Arg[], scope: Scope, pos: Pos): SceneNode {
    const a = this.namedArgs(args, scope, ["points", "faces", "convexity", "triangles"]);
    const ptsRaw = a.points ?? a._p[0];
    const facesRaw = a.faces ?? a.triangles ?? a._p[1];
    if (!Array.isArray(ptsRaw) || !Array.isArray(facesRaw)) {
      this.warn("polyhedron() requires points and faces", pos);
      return { type: "group", children: [] };
    }
    const points: Vec3[] = ptsRaw.map((p) => vec3(p, [0, 0, 0]));
    const faces: number[][] = facesRaw.map((f) =>
      Array.isArray(f) ? f.map((x) => Math.floor(num(x, 0))) : [],
    );
    return { type: "polyhedron", points, faces };
  }

  private makeSquare(args: Arg[], scope: Scope): SceneNode {
    const a = this.namedArgs(args, scope, ["size", "center"]);
    const sizeRaw = a.size ?? a._p[0];
    const size: [number, number] = typeof sizeRaw === "number"
      ? [sizeRaw, sizeRaw]
      : sizeRaw === undefined ? [1, 1] : vec2(sizeRaw, [1, 1]);
    const center = bool(a.center ?? a._p[1], false);
    const [w, hgt] = size;
    const x0 = center ? -w / 2 : 0;
    const y0 = center ? -hgt / 2 : 0;
    return {
      type: "shape2d",
      contours: [{ points: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + hgt], [x0, y0 + hgt]], hole: false }],
    };
  }

  private makeCircle(args: Arg[], scope: Scope): SceneNode {
    const a = this.namedArgs(args, scope, ["r", "d"]);
    let r = 1;
    if (a.d !== undefined) r = num(a.d, 2) / 2;
    else if (a.r !== undefined) r = num(a.r, 1);
    else if (a._p[0] !== undefined) r = num(a._p[0], 1);
    const seg = this.fragments(scope, r);
    const points: [number, number][] = [];
    for (let i = 0; i < seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      points.push([r * Math.cos(ang), r * Math.sin(ang)]);
    }
    return { type: "shape2d", contours: [{ points, hole: false }] };
  }

  private makePolygon(args: Arg[], scope: Scope, pos: Pos): SceneNode {
    const a = this.namedArgs(args, scope, ["points", "paths", "convexity"]);
    const ptsRaw = a.points ?? a._p[0];
    if (!Array.isArray(ptsRaw)) {
      this.warn("polygon() requires points", pos);
      return { type: "group", children: [] };
    }
    const pts: [number, number][] = ptsRaw.map((p) => vec2(p, [0, 0]));
    const pathsRaw = a.paths ?? a._p[1];
    const contours: Contour[] = [];
    if (Array.isArray(pathsRaw) && pathsRaw.length > 0) {
      pathsRaw.forEach((path, idx) => {
        if (!Array.isArray(path)) return;
        const contour = path.map((i) => pts[Math.floor(num(i, 0))]).filter(Boolean) as [number, number][];
        contours.push({ points: contour, hole: idx > 0 });
      });
    } else {
      contours.push({ points: pts, hole: false });
    }
    return { type: "shape2d", contours };
  }

  // ---------------- expressions ----------------

  evalExpr(e: Expr, scope: Scope): Value {
    switch (e.kind) {
      case "num": return e.value;
      case "str": return e.value;
      case "bool": return e.value;
      case "undef": return undefined;

      case "ident": {
        const r = scope.lookup(e.name);
        if (!r.found) {
          this.warn(`Unknown variable '${e.name}'`, e.pos);
          return undefined;
        }
        return r.value;
      }

      case "vector": {
        const out: Value[] = [];
        for (const item of e.items) this.evalLcElement(item, scope, out);
        return out;
      }

      case "range": {
        const start = num(this.evalExpr(e.start, scope), 0);
        const end = num(this.evalExpr(e.end, scope), 0);
        let step = e.step ? num(this.evalExpr(e.step, scope), 1) : 1;
        if (step === 0) step = 1;
        const r: RangeValue = { __range: true, start, step, end };
        return r;
      }

      case "binary": return this.evalBinary(e.op, e.left, e.right, scope);

      case "unary": {
        const v = this.evalExpr(e.operand, scope);
        if (e.op === "!") return !truthy(v);
        if (e.op === "-") return negate(v);
        return v; // unary +
      }

      case "ternary":
        return truthy(this.evalExpr(e.cond, scope))
          ? this.evalExpr(e.then, scope)
          : this.evalExpr(e.else, scope);

      case "index": {
        const target = this.evalExpr(e.target, scope);
        const idx = this.evalExpr(e.index, scope);
        if (Array.isArray(target) && typeof idx === "number") {
          const i = Math.floor(idx);
          return i >= 0 && i < target.length ? target[i] : undefined;
        }
        if (typeof target === "string" && typeof idx === "number") {
          const i = Math.floor(idx);
          return i >= 0 && i < target.length ? target[i] : undefined;
        }
        return undefined;
      }

      case "member": {
        const target = this.evalExpr(e.target, scope);
        if (Array.isArray(target)) {
          const idx = { x: 0, y: 1, z: 2 }[e.name];
          if (idx !== undefined && idx < target.length) return target[idx];
        }
        return undefined;
      }

      case "let": {
        const inner = new Scope(scope);
        for (const a of e.assigns) inner.vars.set(a.name, this.evalExpr(a.value, inner));
        return this.evalExpr(e.body, inner);
      }

      case "assertExpr": {
        const a = this.namedArgs(e.args, scope, ["condition", "message"]);
        const cond = a.condition ?? a._p[0];
        if (!truthy(cond)) {
          const msg = a.message ?? a._p[1];
          throw new ScadError(`Assertion failed${msg !== undefined ? ": " + fmtValue(msg) : ""}`, e.pos);
        }
        return e.body ? this.evalExpr(e.body, scope) : undefined;
      }

      case "echoExpr": {
        const parts: string[] = [];
        for (const arg of e.args) {
          const v = this.evalExpr(arg.value, scope);
          parts.push(arg.name ? `${arg.name} = ${fmtValue(v)}` : fmtValue(v));
        }
        this.echo.push(`ECHO: ${parts.join(", ")}`);
        return e.body ? this.evalExpr(e.body, scope) : undefined;
      }

      case "function": {
        const fn: FnValue = { __fn: true, params: e.params, body: e.body, closure: scope };
        return fn as unknown as Value;
      }

      case "call": return this.evalCall(e.name, e.args, scope, e.pos);
    }
  }

  private evalLcElement(el: LcElement, scope: Scope, out: Value[]) {
    this.checkBudget();
    switch (el.kind) {
      case "lcExpr":
        out.push(this.evalExpr(el.expr, scope));
        return;
      case "lcEach": {
        const v = this.evalExpr(el.expr, scope);
        if (Array.isArray(v)) out.push(...v);
        else if (isRange(v)) for (const x of iterateRange(v)) out.push(x);
        else if (v !== undefined) out.push(v);
        return;
      }
      case "lcFor": {
        const inner = new Scope(scope);
        this.lcForRec(el.assigns, 0, inner, el.body, out);
        return;
      }
      case "lcForC": {
        const inner = new Scope(scope);
        for (const a of el.init) inner.vars.set(a.name, this.evalExpr(a.value, inner));
        let guard = 0;
        while (truthy(this.evalExpr(el.cond, inner))) {
          this.checkBudget(el.pos);
          if (++guard > 1_000_000) throw new ScadError("C-style for loop iteration limit", el.pos);
          this.evalLcElement(el.body, inner, out);
          const updates = el.update.map((a) => [a.name, this.evalExpr(a.value, inner)] as const);
          for (const [n, v] of updates) inner.vars.set(n, v);
        }
        return;
      }
      case "lcIf": {
        if (truthy(this.evalExpr(el.cond, scope))) this.evalLcElement(el.then, scope, out);
        else if (el.else) this.evalLcElement(el.else, scope, out);
        return;
      }
      case "lcLet": {
        const inner = new Scope(scope);
        for (const a of el.assigns) inner.vars.set(a.name, this.evalExpr(a.value, inner));
        this.evalLcElement(el.body, inner, out);
        return;
      }
    }
  }

  private lcForRec(assigns: Assign[], idx: number, scope: Scope, body: LcElement, out: Value[]) {
    if (idx >= assigns.length) {
      this.evalLcElement(body, scope, out);
      return;
    }
    const a = assigns[idx];
    const val = this.evalExpr(a.value, scope);
    for (const item of iterableValues(val)) {
      this.checkBudget(a.pos);
      scope.vars.set(a.name, item);
      this.lcForRec(assigns, idx + 1, scope, body, out);
    }
  }

  private evalBinary(op: string, leftE: Expr, rightE: Expr, scope: Scope): Value {
    if (op === "&&") {
      const l = this.evalExpr(leftE, scope);
      if (!truthy(l)) return false;
      return truthy(this.evalExpr(rightE, scope));
    }
    if (op === "||") {
      const l = this.evalExpr(leftE, scope);
      if (truthy(l)) return true;
      return truthy(this.evalExpr(rightE, scope));
    }

    const l = this.evalExpr(leftE, scope);
    const r = this.evalExpr(rightE, scope);

    switch (op) {
      case "+": return addValues(l, r);
      case "-": return addValues(l, negate(r));
      case "*": return mulValues(l, r);
      case "/": return divValues(l, r);
      case "%": return typeof l === "number" && typeof r === "number" ? l % r : undefined;
      case "^": return typeof l === "number" && typeof r === "number" ? Math.pow(l, r) : undefined;
      case "==": return valueEquals(l, r);
      case "!=": return !valueEquals(l, r);
      case "<": return compare(l, r) < 0;
      case "<=": return compare(l, r) <= 0;
      case ">": return compare(l, r) > 0;
      case ">=": return compare(l, r) >= 0;
    }
    return undefined;
  }

  private evalCall(name: string, args: Arg[], scope: Scope, pos: Pos): Value {
    // user-defined function first
    const userFn = scope.lookupFunction(name);
    if (userFn) {
      return this.invokeFn(userFn.params, userFn.body, userFn.closure, args, scope, name, pos);
    }
    // variable holding a function literal
    const v = scope.lookup(name);
    if (v.found && isFnValue(v.value)) {
      const fn = v.value;
      return this.invokeFn(fn.params, fn.body, fn.closure, args, scope, name, pos);
    }

    const builtin = builtinFunctions[name];
    if (builtin) {
      const positional: Value[] = [];
      const named: Record<string, Value> = {};
      for (const a of args) {
        const val = this.evalExpr(a.value, scope);
        if (a.name) named[a.name] = val;
        else positional.push(val);
      }
      try {
        return builtin(positional, named, (m: string) => this.warn(m, pos));
      } catch (err) {
        throw new ScadError(`${name}(): ${(err as Error).message}`, pos);
      }
    }

    this.warn(`Unknown function '${name}'`, pos);
    return undefined;
  }

  private invokeFn(params: Param[], body: Expr, closure: Scope, args: Arg[], callerScope: Scope, name: string, pos: Pos): Value {
    if (++this.depth > MAX_RECURSION) {
      this.depth--;
      throw new ScadError(`Recursion limit exceeded in function '${name}'`, pos);
    }
    try {
      this.checkBudget(pos);
      const fnScope = new Scope(closure);
      this.bindParams(params, args, callerScope, fnScope);
      this.propagateSpecials(callerScope, fnScope);
      return this.evalExpr(body, fnScope);
    } finally {
      this.depth--;
    }
  }
}

// Builtin modules that must not be shadowed accidentally by hoisting pass-1 (none for now)
const BUILTIN_PRIORITY = new Set<string>([]);

// ---------------- value helpers ----------------

export function truthy(v: Value): boolean {
  if (v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !isNaN(v);
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function num(v: Value, def: number): number {
  return typeof v === "number" && isFinite(v) ? v : def;
}

function bool(v: Value, def: boolean): boolean {
  if (v === undefined) return def;
  return truthy(v);
}

function vec3(v: Value, def: Vec3): Vec3 {
  if (typeof v === "number") return [v, v, v];
  if (Array.isArray(v)) {
    return [num(v[0], def[0]), num(v[1] ?? 0, 0), num(v[2] ?? 0, 0)];
  }
  return def;
}

function vec2(v: Value, def: [number, number]): [number, number] {
  if (typeof v === "number") return [v, v];
  if (Array.isArray(v)) return [num(v[0], def[0]), num(v[1] ?? 0, 0)];
  return def;
}

function iterableValues(val: Value): Value[] {
  if (isRange(val)) return [...iterateRange(val)];
  if (Array.isArray(val)) return val;
  if (val === undefined) return [];
  return [val];
}

function negate(v: Value): Value {
  if (typeof v === "number") return -v;
  if (Array.isArray(v)) return v.map(negate);
  return undefined;
}

function addValues(l: Value, r: Value): Value {
  if (typeof l === "number" && typeof r === "number") return l + r;
  if (Array.isArray(l) && Array.isArray(r)) {
    const n = Math.min(l.length, r.length);
    const out: Value[] = [];
    for (let i = 0; i < n; i++) out.push(addValues(l[i], r[i]));
    return out;
  }
  return undefined;
}

function mulValues(l: Value, r: Value): Value {
  if (typeof l === "number" && typeof r === "number") return l * r;
  if (typeof l === "number" && Array.isArray(r)) return r.map((x) => mulValues(l, x));
  if (Array.isArray(l) && typeof r === "number") return l.map((x) => mulValues(x, r));
  if (Array.isArray(l) && Array.isArray(r)) {
    // dot product / matrix multiply
    const lIsMat = l.length > 0 && Array.isArray(l[0]);
    const rIsMat = r.length > 0 && Array.isArray(r[0]);
    if (!lIsMat && !rIsMat) {
      // dot product
      const n = Math.min(l.length, r.length);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const p = mulValues(l[i], r[i]);
        if (typeof p !== "number") return undefined;
        sum += p;
      }
      return sum;
    }
    if (lIsMat && !rIsMat) {
      // matrix * vector
      return l.map((row) => mulValues(row, r));
    }
    if (!lIsMat && rIsMat) {
      // vector * matrix
      const cols = (r[0] as Value[]).length;
      const out: Value[] = [];
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let i = 0; i < Math.min(l.length, r.length); i++) {
          const rv = (r[i] as Value[])[c];
          const p = mulValues(l[i], rv);
          if (typeof p !== "number") return undefined;
          sum += p;
        }
        out.push(sum);
      }
      return out;
    }
    // matrix * matrix
    return l.map((row) => mulValues(row, r));
  }
  return undefined;
}

function divValues(l: Value, r: Value): Value {
  if (typeof l === "number" && typeof r === "number") return l / r;
  if (Array.isArray(l) && typeof r === "number") return l.map((x) => divValues(x, r));
  return undefined;
}

function valueEquals(l: Value, r: Value): boolean {
  if (typeof l !== typeof r) return false;
  if (typeof l === "number") return l === r;
  if (typeof l === "boolean" || typeof l === "string") return l === r;
  if (l === undefined) return r === undefined;
  if (Array.isArray(l) && Array.isArray(r)) {
    if (l.length !== r.length) return false;
    return l.every((x, i) => valueEquals(x, r[i]));
  }
  if (isRange(l) && isRange(r)) return l.start === r.start && l.step === r.step && l.end === r.end;
  return false;
}

function compare(l: Value, r: Value): number {
  if (typeof l === "number" && typeof r === "number") return l < r ? -1 : l > r ? 1 : 0;
  if (typeof l === "string" && typeof r === "string") return l < r ? -1 : l > r ? 1 : 0;
  if (typeof l === "boolean" && typeof r === "boolean") return (l ? 1 : 0) - (r ? 1 : 0);
  return NaN;
}

// ---------------- matrices (column-major, three.js layout) ----------------

function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function translationMatrix(v: Vec3): number[] {
  const m = identity();
  m[12] = v[0]; m[13] = v[1]; m[14] = v[2];
  return m;
}

function scaleMatrix(v: Vec3): number[] {
  const m = identity();
  m[0] = v[0]; m[5] = v[1]; m[10] = v[2];
  return m;
}

function mirrorMatrix(v: Vec3): number[] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len === 0) return identity();
  const x = v[0] / len, y = v[1] / len, z = v[2] / len;
  // Householder reflection I - 2nn^T
  return [
    1 - 2 * x * x, -2 * x * y, -2 * x * z, 0,
    -2 * x * y, 1 - 2 * y * y, -2 * y * z, 0,
    -2 * x * z, -2 * y * z, 1 - 2 * z * z, 0,
    0, 0, 0, 1,
  ];
}

function matMul(a: number[], b: number[]): number[] {
  // column-major 4x4: result = a * b
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function rotAxis(axis: Vec3, deg: number): number[] {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len === 0) return identity();
  const x = axis[0] / len, y = axis[1] / len, z = axis[2] / len;
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [
    x * x * C + c, y * x * C + z * s, z * x * C - y * s, 0,
    x * y * C - z * s, y * y * C + c, z * y * C + x * s, 0,
    x * z * C + y * s, y * z * C - x * s, z * z * C + c, 0,
    0, 0, 0, 1,
  ];
}

function rotateMatrix(aVal: Value, vVal: Value): number[] {
  if (typeof aVal === "number" && Array.isArray(vVal)) {
    return rotAxis(vec3(vVal, [0, 0, 1]), aVal);
  }
  if (typeof aVal === "number") {
    return rotAxis([0, 0, 1], aVal);
  }
  if (Array.isArray(aVal)) {
    const [rx, ry, rz] = vec3(aVal, [0, 0, 0]);
    // OpenSCAD applies X, then Y, then Z
    return matMul(rotAxis([0, 0, 1], rz), matMul(rotAxis([0, 1, 0], ry), rotAxis([1, 0, 0], rx)));
  }
  return identity();
}

function multmatrixFrom(v: Value): number[] {
  // OpenSCAD matrix is row-major list of rows: m[row][col], 4x4 or 3x4
  if (!Array.isArray(v)) return identity();
  const m = identity();
  for (let row = 0; row < Math.min(4, v.length); row++) {
    const rowV = v[row];
    if (!Array.isArray(rowV)) continue;
    for (let col = 0; col < Math.min(4, rowV.length); col++) {
      const x = rowV[col];
      if (typeof x === "number") m[col * 4 + row] = x;
    }
  }
  return m;
}

function parseColor(c: Value, alpha: number, warn: (m: string) => void): [number, number, number, number] {
  if (typeof c === "string") {
    const s = c.trim().toLowerCase();
    if (s.startsWith("#")) {
      const hex = s.slice(1);
      const expand = (h: string) => parseInt(h.length === 1 ? h + h : h, 16) / 255;
      if (hex.length === 3 || hex.length === 4) {
        const r = expand(hex[0]), g = expand(hex[1]), b = expand(hex[2]);
        const a = hex.length === 4 ? expand(hex[3]) : alpha;
        return [r, g, b, a];
      }
      if (hex.length === 6 || hex.length === 8) {
        const r = expand(hex.slice(0, 2)), g = expand(hex.slice(2, 4)), b = expand(hex.slice(4, 6));
        const a = hex.length === 8 ? expand(hex.slice(6, 8)) : alpha;
        return [r, g, b, a];
      }
      warn(`Invalid hex color '${c}'`);
      return [1, 0.82, 0, alpha];
    }
    const named = COLOR_NAMES[s];
    if (named) return [named[0], named[1], named[2], alpha];
    warn(`Unknown color '${c}'`);
    return [1, 0.82, 0, alpha];
  }
  if (Array.isArray(c)) {
    const r = num(c[0], 1), g = num(c[1], 1), b = num(c[2], 1);
    const a = c.length > 3 ? num(c[3], alpha) : alpha;
    return [clamp01(r), clamp01(g), clamp01(b), clamp01(a)];
  }
  return [1, 0.82, 0, alpha];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
