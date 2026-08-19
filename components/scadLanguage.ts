"use client";

import { StreamLanguage, LanguageSupport } from "@codemirror/language";
import { CompletionContext, CompletionResult, completeFromList } from "@codemirror/autocomplete";

const KEYWORDS = new Set([
  "module", "function", "if", "else", "for", "intersection_for", "let",
  "include", "use", "each", "assert", "echo",
]);

const ATOMS = new Set(["true", "false", "undef", "PI"]);

const BUILTIN_MODULES = [
  "cube", "sphere", "cylinder", "polyhedron", "square", "circle", "polygon",
  "text", "linear_extrude", "rotate_extrude", "translate", "rotate", "scale",
  "mirror", "multmatrix", "resize", "color", "union", "difference",
  "intersection", "hull", "minkowski", "offset", "projection", "render",
  "children", "import", "surface",
];

const BUILTIN_FUNCTIONS = [
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "abs", "sign", "sqrt",
  "exp", "ln", "log", "pow", "floor", "ceil", "round", "min", "max", "norm",
  "cross", "len", "concat", "str", "chr", "ord", "lookup", "rands", "search",
  "is_undef", "is_bool", "is_num", "is_string", "is_list", "version", "reverse",
];

const BUILTINS = new Set([...BUILTIN_MODULES, ...BUILTIN_FUNCTIONS]);

interface ScadState {
  inBlockComment: boolean;
}

const scadStream = StreamLanguage.define<ScadState>({
  name: "openscad",
  startState: () => ({ inBlockComment: false }),
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.match(/^.*?\*\//)) state.inBlockComment = false;
      else stream.skipToEnd();
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.inBlockComment = true;
      return "comment";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^\d+\.?\d*(?:[eE][+-]?\d+)?/) || stream.match(/^\.\d+/)) return "number";
    if (stream.match(/^\$[A-Za-z0-9_]+/)) return "variableName.special";
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (word) {
      const w = (word as RegExpMatchArray)[0];
      if (KEYWORDS.has(w)) return "keyword";
      if (ATOMS.has(w)) return "atom";
      if (BUILTINS.has(w)) return "typeName";
      return "variableName";
    }
    if (stream.match(/^[+\-*/%^!<>=&|?:.]+/)) return "operator";
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", '"'] },
  },
});

const completions = [
  ...BUILTIN_MODULES.map((label) => ({ label, type: "function", detail: "module" })),
  ...BUILTIN_FUNCTIONS.map((label) => ({ label, type: "function", detail: "function" })),
  ...["module", "function", "if", "else", "for", "let", "each", "include", "use"].map(
    (label) => ({ label, type: "keyword" }),
  ),
  ...["$fn", "$fa", "$fs", "$t", "$children", "$preview"].map(
    (label) => ({ label, type: "variable", detail: "special" }),
  ),
  { label: "true", type: "constant" },
  { label: "false", type: "constant" },
  { label: "undef", type: "constant" },
  { label: "PI", type: "constant" },
];

const completionSource = completeFromList(completions);

function scadCompletions(context: CompletionContext): CompletionResult | Promise<CompletionResult | null> | null {
  const word = context.matchBefore(/[\w$]+/);
  if (!word && !context.explicit) return null;
  return completionSource(context);
}

export function openscadLanguage(): LanguageSupport {
  return new LanguageSupport(scadStream, [
    scadStream.data.of({ autocomplete: scadCompletions }),
  ]);
}
