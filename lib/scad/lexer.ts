import { Pos, ScadError } from "./types";

export type TokenType =
  | "num"
  | "str"
  | "ident"
  | "keyword"
  | "op"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  num?: number;
  pos: Pos;
}

const KEYWORDS = new Set([
  "module", "function", "if", "else", "for", "intersection_for", "let",
  "true", "false", "undef", "include", "use", "each", "assert", "echo",
]);

const TWO_CHAR_OPS = new Set(["==", "!=", "<=", ">=", "&&", "||"]);
const ONE_CHAR_OPS = new Set([
  "+", "-", "*", "/", "%", "^", "<", ">", "=", "!", "?", ":", ";", ",",
  "(", ")", "[", "]", "{", "}", ".", "#", "&", "|",
]);

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const pos = (): Pos => ({ line, col });

  function advance(n = 1) {
    for (let k = 0; k < n; k++) {
      if (src[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  }

  while (i < src.length) {
    const c = src[i];

    // whitespace
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      advance();
      continue;
    }

    // line comment
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") advance();
      continue;
    }

    // block comment
    if (c === "/" && src[i + 1] === "*") {
      const start = pos();
      advance(2);
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) advance();
      if (i >= src.length) throw new ScadError("Unterminated block comment", start);
      advance(2);
      continue;
    }

    // include / use with <path>
    if (c === "i" || c === "u") {
      const rest = src.slice(i);
      const m = rest.match(/^(include|use)\s*</);
      if (m) {
        const start = pos();
        advance(m[0].length);
        let file = "";
        while (i < src.length && src[i] !== ">") {
          file += src[i];
          advance();
        }
        if (i >= src.length) throw new ScadError("Unterminated include path", start);
        advance(); // >
        tokens.push({ type: "keyword", value: m[1], pos: start });
        tokens.push({ type: "str", value: file.trim(), pos: start });
        tokens.push({ type: "op", value: ";", pos: start });
        continue;
      }
    }

    // number
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const start = pos();
      let s = "";
      while (i < src.length && /[0-9]/.test(src[i])) { s += src[i]; advance(); }
      if (src[i] === ".") { s += "."; advance(); while (i < src.length && /[0-9]/.test(src[i])) { s += src[i]; advance(); } }
      if (src[i] === "e" || src[i] === "E") {
        let j = i + 1;
        if (src[j] === "+" || src[j] === "-") j++;
        if (/[0-9]/.test(src[j] ?? "")) {
          s += src[i]; advance();
          if (src[i] === "+" || src[i] === "-") { s += src[i]; advance(); }
          while (i < src.length && /[0-9]/.test(src[i])) { s += src[i]; advance(); }
        }
      }
      tokens.push({ type: "num", value: s, num: parseFloat(s), pos: start });
      continue;
    }

    // string
    if (c === '"') {
      const start = pos();
      advance();
      let s = "";
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") {
          advance();
          const e = src[i];
          if (e === "n") s += "\n";
          else if (e === "t") s += "\t";
          else if (e === "r") s += "\r";
          else if (e === '"') s += '"';
          else if (e === "\\") s += "\\";
          else s += e ?? "";
          advance();
        } else {
          s += src[i];
          advance();
        }
      }
      if (i >= src.length) throw new ScadError("Unterminated string", start);
      advance();
      tokens.push({ type: "str", value: s, pos: start });
      continue;
    }

    // identifier / keyword / special variable
    if (/[A-Za-z_$]/.test(c)) {
      const start = pos();
      let s = "";
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) { s += src[i]; advance(); }
      if (KEYWORDS.has(s)) tokens.push({ type: "keyword", value: s, pos: start });
      else tokens.push({ type: "ident", value: s, pos: start });
      continue;
    }

    // operators
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ type: "op", value: two, pos: pos() });
      advance(2);
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      tokens.push({ type: "op", value: c, pos: pos() });
      advance();
      continue;
    }

    throw new ScadError(`Unexpected character '${c}'`, pos());
  }

  tokens.push({ type: "eof", value: "", pos: pos() });
  return tokens;
}
