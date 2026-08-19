import { Value, fmtValue, isRange, iterateRange } from "./types";

type Warn = (msg: string) => void;
export type BuiltinFn = (positional: Value[], named: Record<string, Value>, warn: Warn) => Value;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function n(v: Value): number {
  if (typeof v === "number") return v;
  return NaN;
}

function toList(v: Value): Value[] {
  if (Array.isArray(v)) return v;
  if (isRange(v)) return [...iterateRange(v)];
  if (typeof v === "string") return v.split("");
  return [];
}

/** Deterministic PRNG (mulberry32) so renders are reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let randCounter = 12345;

export const builtinFunctions: Record<string, BuiltinFn> = {
  // trig (degrees)
  sin: (p) => Math.sin(n(p[0]) * D2R),
  cos: (p) => Math.cos(n(p[0]) * D2R),
  tan: (p) => Math.tan(n(p[0]) * D2R),
  asin: (p) => Math.asin(n(p[0])) * R2D,
  acos: (p) => Math.acos(n(p[0])) * R2D,
  atan: (p) => Math.atan(n(p[0])) * R2D,
  atan2: (p) => Math.atan2(n(p[0]), n(p[1])) * R2D,

  // math
  abs: (p) => Math.abs(n(p[0])),
  sign: (p) => Math.sign(n(p[0])),
  sqrt: (p) => Math.sqrt(n(p[0])),
  exp: (p) => Math.exp(n(p[0])),
  ln: (p) => Math.log(n(p[0])),
  log: (p) => Math.log10(n(p[0])),
  pow: (p) => Math.pow(n(p[0]), n(p[1])),
  floor: (p) => Math.floor(n(p[0])),
  ceil: (p) => Math.ceil(n(p[0])),
  round: (p) => Math.round(n(p[0])),

  min: (p) => {
    const vals = p.length === 1 && Array.isArray(p[0]) ? (p[0] as Value[]) : p;
    const nums = vals.filter((v): v is number => typeof v === "number");
    return nums.length ? Math.min(...nums) : undefined;
  },
  max: (p) => {
    const vals = p.length === 1 && Array.isArray(p[0]) ? (p[0] as Value[]) : p;
    const nums = vals.filter((v): v is number => typeof v === "number");
    return nums.length ? Math.max(...nums) : undefined;
  },

  norm: (p) => {
    if (!Array.isArray(p[0])) return undefined;
    let sum = 0;
    for (const x of p[0] as Value[]) {
      if (typeof x !== "number") return undefined;
      sum += x * x;
    }
    return Math.sqrt(sum);
  },
  cross: (p) => {
    const a = p[0], b = p[1];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 3 || b.length !== 3) return undefined;
    const [ax, ay, az] = a as number[];
    const [bx, by, bz] = b as number[];
    return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  },

  // lists & strings
  len: (p) => {
    const v = p[0];
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    return undefined;
  },
  concat: (p) => {
    const out: Value[] = [];
    for (const v of p) {
      if (Array.isArray(v)) out.push(...v);
      else out.push(v);
    }
    return out;
  },
  str: (p) => p.map((v) => (typeof v === "string" ? v : fmtValue(v))).join(""),
  chr: (p) => {
    const out: string[] = [];
    for (const v of p) {
      if (typeof v === "number") out.push(String.fromCharCode(v));
      else if (Array.isArray(v)) for (const x of v) if (typeof x === "number") out.push(String.fromCharCode(x));
    }
    return out.join("");
  },
  ord: (p) => (typeof p[0] === "string" && p[0].length > 0 ? p[0].charCodeAt(0) : undefined),

  reverse: (p) => toList(p[0]).slice().reverse(),

  lookup: (p) => {
    const key = n(p[0]);
    const table = p[1];
    if (!Array.isArray(table) || table.length === 0) return undefined;
    const rows = table
      .filter((r): r is Value[] => Array.isArray(r) && typeof r[0] === "number" && typeof r[1] === "number")
      .map((r) => [r[0] as number, r[1] as number] as const)
      .sort((a, b) => a[0] - b[0]);
    if (rows.length === 0) return undefined;
    if (key <= rows[0][0]) return rows[0][1];
    if (key >= rows[rows.length - 1][0]) return rows[rows.length - 1][1];
    for (let i = 0; i < rows.length - 1; i++) {
      const [x0, y0] = rows[i];
      const [x1, y1] = rows[i + 1];
      if (key >= x0 && key <= x1) {
        return x1 === x0 ? y0 : y0 + ((key - x0) / (x1 - x0)) * (y1 - y0);
      }
    }
    return undefined;
  },

  rands: (p) => {
    const min = n(p[0]);
    const max = n(p[1]);
    const count = Math.max(0, Math.floor(n(p[2])));
    const seed = typeof p[3] === "number" ? p[3] : randCounter++;
    const rng = mulberry32(Math.floor(seed * 1000003));
    const out: number[] = [];
    for (let i = 0; i < Math.min(count, 100000); i++) out.push(min + rng() * (max - min));
    return out;
  },

  search: (p, _named, warn) => {
    // simplified search(match_value, string_or_vector)
    const matchVal = p[0];
    const target = p[1];
    if (typeof matchVal === "string" && typeof target === "string") {
      const out: Value[] = [];
      for (const ch of matchVal) {
        const idx = target.indexOf(ch);
        out.push(idx >= 0 ? [idx] : []);
      }
      return out;
    }
    if (Array.isArray(target)) {
      const matches = Array.isArray(matchVal) ? matchVal : [matchVal];
      const out: Value[] = [];
      for (const m of matches) {
        const found: number[] = [];
        target.forEach((t, i) => {
          const cmp = Array.isArray(t) ? t[0] : t;
          if (cmp === m) found.push(i);
        });
        out.push(found.length ? [found[0]] : []);
      }
      return out;
    }
    warn("search(): unsupported argument types");
    return [];
  },

  // type predicates
  is_undef: (p) => p[0] === undefined,
  is_bool: (p) => typeof p[0] === "boolean",
  is_num: (p) => typeof p[0] === "number",
  is_string: (p) => typeof p[0] === "string",
  is_list: (p) => Array.isArray(p[0]),
  is_function: (p) => typeof p[0] === "object" && p[0] !== null && !Array.isArray(p[0]) && !isRange(p[0]),

  version: () => [2026, 1, 0] as Value[],
  version_num: () => 20260100,

  // misc
  parent_module: (_p, _n, warn) => {
    warn("parent_module() is not supported");
    return "";
  },
};
