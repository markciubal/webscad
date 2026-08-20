// ---------- Runtime values ----------

export type Value =
  | number
  | boolean
  | string
  | Value[]
  | RangeValue
  | undefined;

export interface RangeValue {
  __range: true;
  start: number;
  step: number;
  end: number;
}

export function isRange(v: Value): v is RangeValue {
  return typeof v === "object" && v !== null && !Array.isArray(v) && (v as RangeValue).__range === true;
}

export function* iterateRange(r: RangeValue): Generator<number> {
  if (r.step === 0) return;
  const count = Math.floor((r.end - r.start) / r.step + 1e-9) + 1;
  const capped = Math.min(count, 1_000_000);
  for (let i = 0; i < capped; i++) yield r.start + i * r.step;
}

// ---------- AST ----------

export interface Pos {
  line: number;
  col: number;
}

export type Expr =
  | { kind: "num"; value: number; pos: Pos }
  | { kind: "str"; value: string; pos: Pos }
  | { kind: "bool"; value: boolean; pos: Pos }
  | { kind: "undef"; pos: Pos }
  | { kind: "ident"; name: string; pos: Pos }
  | { kind: "vector"; items: LcElement[]; pos: Pos }
  | { kind: "range"; start: Expr; step?: Expr; end: Expr; pos: Pos }
  | { kind: "binary"; op: string; left: Expr; right: Expr; pos: Pos }
  | { kind: "unary"; op: string; operand: Expr; pos: Pos }
  | { kind: "ternary"; cond: Expr; then: Expr; else: Expr; pos: Pos }
  | { kind: "index"; target: Expr; index: Expr; pos: Pos }
  | { kind: "member"; target: Expr; name: string; pos: Pos }
  | { kind: "call"; name: string; args: Arg[]; pos: Pos }
  | { kind: "let"; assigns: Assign[]; body: Expr; pos: Pos }
  | { kind: "assertExpr"; args: Arg[]; body: Expr | null; pos: Pos }
  | { kind: "echoExpr"; args: Arg[]; body: Expr | null; pos: Pos }
  | { kind: "function"; params: Param[]; body: Expr; pos: Pos };

// Elements inside a vector literal / list comprehension
export type LcElement =
  | { kind: "lcExpr"; expr: Expr }
  | { kind: "lcEach"; expr: Expr; pos: Pos }
  | { kind: "lcFor"; assigns: Assign[]; body: LcElement; pos: Pos }
  | { kind: "lcForC"; init: Assign[]; cond: Expr; update: Assign[]; body: LcElement; pos: Pos }
  | { kind: "lcIf"; cond: Expr; then: LcElement; else: LcElement | null; pos: Pos }
  | { kind: "lcLet"; assigns: Assign[]; body: LcElement; pos: Pos };

export interface Arg {
  name?: string;
  value: Expr;
}

export interface Param {
  name: string;
  default?: Expr;
}

export interface Assign {
  name: string;
  value: Expr;
  pos: Pos;
}

export type Stmt =
  | { kind: "noop"; pos: Pos }
  | { kind: "block"; body: Stmt[]; pos: Pos }
  | { kind: "assign"; name: string; value: Expr; pos: Pos }
  | { kind: "moduleDef"; name: string; params: Param[]; body: Stmt; pos: Pos }
  | { kind: "functionDef"; name: string; params: Param[]; body: Expr; pos: Pos }
  | { kind: "moduleCall"; name: string; args: Arg[]; child: Stmt | null; modifier: string; pos: Pos }
  | { kind: "if"; cond: Expr; then: Stmt; else: Stmt | null; pos: Pos }
  | { kind: "for"; assigns: Assign[]; body: Stmt; intersection: boolean; pos: Pos }
  | { kind: "letStmt"; assigns: Assign[]; body: Stmt; pos: Pos }
  | { kind: "include"; file: string; pos: Pos }
  | { kind: "use"; file: string; pos: Pos };

// ---------- Scene (evaluator output) ----------

export type Vec3 = [number, number, number];
export type Mat4 = number[]; // 16 numbers, column-major (three.js order)

/** How align() positions the children's bounding box on one axis. */
export type AlignMode = "min" | "center" | "max" | null;

/** Resolved fragment count helper params carried on primitives. */
export interface Contour {
  points: [number, number][];
  hole: boolean;
}

export type SceneNode =
  | { type: "group"; children: SceneNode[] }
  | { type: "cube"; size: Vec3; center: boolean }
  | { type: "sphere"; r: number; segments: number }
  | { type: "cylinder"; h: number; r1: number; r2: number; center: boolean; segments: number }
  | { type: "polyhedron"; points: Vec3[]; faces: number[][] }
  | { type: "shape2d"; contours: Contour[] }
  | { type: "linear_extrude"; height: number; center: boolean; twist: number; slices: number; scale: [number, number]; children: SceneNode[] }
  | { type: "rotate_extrude"; angle: number; segments: number; children: SceneNode[] }
  | { type: "transform"; matrix: Mat4; children: SceneNode[] }
  | { type: "color"; color: [number, number, number, number]; children: SceneNode[] }
  | { type: "union"; children: SceneNode[] }
  | { type: "difference"; children: SceneNode[] }
  | { type: "intersection"; children: SceneNode[] }
  | { type: "hull"; children: SceneNode[] }
  | { type: "minkowski"; children: SceneNode[] }
  | { type: "align"; x: AlignMode; y: AlignMode; z: AlignMode; children: SceneNode[] }
  | { type: "highlight"; children: SceneNode[] }
  | { type: "background"; children: SceneNode[] };

export interface EvalOutput {
  root: SceneNode;
  echo: string[];
  warnings: string[];
}

export class ScadError extends Error {
  pos?: Pos;
  constructor(message: string, pos?: Pos) {
    super(message);
    this.pos = pos;
  }
}

export function fmtValue(v: Value): string {
  if (v === undefined) return "undef";
  if (typeof v === "number") {
    if (!isFinite(v)) return v > 0 ? "inf" : v < 0 ? "-inf" : "nan";
    return String(Math.round(v * 1e9) / 1e9);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return JSON.stringify(v);
  if (isRange(v)) return `[${fmtValue(v.start)} : ${fmtValue(v.step)} : ${fmtValue(v.end)}]`;
  return "[" + v.map(fmtValue).join(", ") + "]";
}
