import { tokenize, Token } from "./lexer";
import { Arg, Assign, Expr, LcElement, Param, ScadError, Stmt } from "./types";

export function parse(src: string): Stmt[] {
  return new Parser(tokenize(src)).parseProgram();
}

class Parser {
  private toks: Token[];
  private i = 0;

  constructor(toks: Token[]) {
    this.toks = toks;
  }

  private peek(offset = 0): Token {
    return this.toks[Math.min(this.i + offset, this.toks.length - 1)];
  }

  private next(): Token {
    const t = this.toks[this.i];
    if (t.type !== "eof") this.i++;
    return t;
  }

  private at(type: string, value?: string): boolean {
    const t = this.peek();
    return t.type === type && (value === undefined || t.value === value);
  }

  private atOp(value: string): boolean {
    return this.at("op", value);
  }

  private expectOp(value: string): Token {
    if (!this.atOp(value)) {
      const t = this.peek();
      throw new ScadError(`Expected '${value}' but found '${t.value || t.type}'`, t.pos);
    }
    return this.next();
  }

  private expectIdent(): Token {
    if (this.peek().type !== "ident") {
      const t = this.peek();
      throw new ScadError(`Expected identifier but found '${t.value || t.type}'`, t.pos);
    }
    return this.next();
  }

  // ---------- program ----------

  parseProgram(): Stmt[] {
    const stmts: Stmt[] = [];
    while (!this.at("eof")) {
      stmts.push(this.parseStatement());
    }
    return stmts;
  }

  // ---------- statements ----------

  parseStatement(): Stmt {
    const t = this.peek();

    if (this.atOp(";")) {
      this.next();
      return { kind: "noop", pos: t.pos };
    }

    if (this.atOp("{")) {
      this.next();
      const body: Stmt[] = [];
      while (!this.atOp("}")) {
        if (this.at("eof")) throw new ScadError("Unclosed '{'", t.pos);
        body.push(this.parseStatement());
      }
      this.next();
      return { kind: "block", body, pos: t.pos };
    }

    if (this.at("keyword", "include")) {
      this.next();
      const file = this.next(); // str
      if (this.atOp(";")) this.next();
      return { kind: "include", file: file.value, pos: t.pos };
    }

    if (this.at("keyword", "use")) {
      this.next();
      const file = this.next();
      if (this.atOp(";")) this.next();
      return { kind: "use", file: file.value, pos: t.pos };
    }

    if (this.at("keyword", "module")) {
      this.next();
      const name = this.expectIdent().value;
      const params = this.parseParamList();
      const body = this.parseStatement();
      return { kind: "moduleDef", name, params, body, pos: t.pos };
    }

    if (this.at("keyword", "function")) {
      this.next();
      const name = this.expectIdent().value;
      const params = this.parseParamList();
      this.expectOp("=");
      const body = this.parseExpr();
      this.expectOp(";");
      return { kind: "functionDef", name, params, body, pos: t.pos };
    }

    // assignment:  ident = expr ;
    if (t.type === "ident" && this.peek(1).type === "op" && this.peek(1).value === "=" &&
        !(this.peek(2).type === "op" && this.peek(2).value === "=")) {
      const name = this.next().value;
      this.next(); // =
      const value = this.parseExpr();
      this.expectOp(";");
      return { kind: "assign", name, value, pos: t.pos };
    }

    return this.parseModuleInstantiation();
  }

  /** Parses a module instantiation (incl. if/for/let/echo/assert), with modifiers. */
  private parseModuleInstantiation(): Stmt {
    const t = this.peek();

    // modifiers ! # % *
    if (this.atOp("!") || this.atOp("#") || this.atOp("%") || this.atOp("*")) {
      const mod = this.next().value;
      const inner = this.parseModuleInstantiation();
      if (inner.kind === "moduleCall") {
        return { ...inner, modifier: mod + inner.modifier };
      }
      // wrap non-call (if/for) — represent as group call
      return { kind: "moduleCall", name: "__wrap", args: [], child: inner, modifier: mod, pos: t.pos };
    }

    if (this.at("keyword", "if")) {
      this.next();
      this.expectOp("(");
      const cond = this.parseExpr();
      this.expectOp(")");
      const then = this.parseStatement();
      let els: Stmt | null = null;
      if (this.at("keyword", "else")) {
        this.next();
        els = this.parseStatement();
      }
      return { kind: "if", cond, then, else: els, pos: t.pos };
    }

    if (this.at("keyword", "for") || this.at("keyword", "intersection_for")) {
      const isInter = this.next().value === "intersection_for";
      this.expectOp("(");
      const assigns = this.parseAssignList(")");
      this.expectOp(")");
      const body = this.parseStatement();
      return { kind: "for", assigns, body, intersection: isInter, pos: t.pos };
    }

    if (this.at("keyword", "let")) {
      this.next();
      this.expectOp("(");
      const assigns = this.parseAssignList(")");
      this.expectOp(")");
      const body = this.parseStatement();
      return { kind: "letStmt", assigns, body, pos: t.pos };
    }

    if (this.at("keyword", "echo") || this.at("keyword", "assert")) {
      const name = this.next().value;
      const args = this.parseArgList();
      // echo()/assert() as statements may have a child or a ;
      let child: Stmt | null = null;
      if (this.atOp(";")) this.next();
      else child = this.parseStatement();
      return { kind: "moduleCall", name, args, child, modifier: "", pos: t.pos };
    }

    // regular module call: ident ( args ) child
    if (t.type === "ident") {
      const name = this.next().value;
      const args = this.parseArgList();
      let child: Stmt | null = null;
      if (this.atOp(";")) {
        this.next();
      } else {
        child = this.parseStatement();
      }
      return { kind: "moduleCall", name, args, child, modifier: "", pos: t.pos };
    }

    throw new ScadError(`Unexpected token '${t.value || t.type}'`, t.pos);
  }

  private parseParamList(): Param[] {
    this.expectOp("(");
    const params: Param[] = [];
    while (!this.atOp(")")) {
      const name = this.expectIdent().value;
      let def: Expr | undefined;
      if (this.atOp("=")) {
        this.next();
        def = this.parseExpr();
      }
      params.push({ name, default: def });
      if (this.atOp(",")) this.next();
      else break;
    }
    this.expectOp(")");
    return params;
  }

  private parseArgList(): Arg[] {
    this.expectOp("(");
    const args: Arg[] = [];
    while (!this.atOp(")")) {
      // named arg?
      if (this.peek().type === "ident" && this.peek(1).type === "op" && this.peek(1).value === "=" &&
          !(this.peek(2).type === "op" && this.peek(2).value === "=")) {
        const name = this.next().value;
        this.next(); // =
        const value = this.parseExpr();
        args.push({ name, value });
      } else {
        args.push({ value: this.parseExpr() });
      }
      if (this.atOp(",")) this.next();
      else break;
    }
    this.expectOp(")");
    return args;
  }

  private parseAssignList(end: string): Assign[] {
    const assigns: Assign[] = [];
    while (!this.atOp(end)) {
      const pos = this.peek().pos;
      const name = this.expectIdent().value;
      this.expectOp("=");
      const value = this.parseExpr();
      assigns.push({ name, value, pos });
      if (this.atOp(",")) this.next();
      else break;
    }
    return assigns;
  }

  // ---------- expressions ----------

  parseExpr(): Expr {
    return this.parseTernary();
  }

  private parseTernary(): Expr {
    const cond = this.parseOr();
    if (this.atOp("?")) {
      const pos = this.next().pos;
      const then = this.parseExpr();
      this.expectOp(":");
      const els = this.parseExpr();
      return { kind: "ternary", cond, then, else: els, pos };
    }
    return cond;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.atOp("||")) {
      const pos = this.next().pos;
      const right = this.parseAnd();
      left = { kind: "binary", op: "||", left, right, pos };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseEquality();
    while (this.atOp("&&")) {
      const pos = this.next().pos;
      const right = this.parseEquality();
      left = { kind: "binary", op: "&&", left, right, pos };
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseComparison();
    while (this.atOp("==") || this.atOp("!=")) {
      const op = this.next();
      const right = this.parseComparison();
      left = { kind: "binary", op: op.value, left, right, pos: op.pos };
    }
    return left;
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();
    while (this.atOp("<") || this.atOp("<=") || this.atOp(">") || this.atOp(">=")) {
      const op = this.next();
      const right = this.parseAdditive();
      left = { kind: "binary", op: op.value, left, right, pos: op.pos };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.atOp("+") || this.atOp("-")) {
      const op = this.next();
      const right = this.parseMultiplicative();
      left = { kind: "binary", op: op.value, left, right, pos: op.pos };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseExponent();
    while (this.atOp("*") || this.atOp("/") || this.atOp("%")) {
      const op = this.next();
      const right = this.parseExponent();
      left = { kind: "binary", op: op.value, left, right, pos: op.pos };
    }
    return left;
  }

  private parseExponent(): Expr {
    const left = this.parseUnary();
    if (this.atOp("^")) {
      const op = this.next();
      const right = this.parseExponent(); // right associative
      return { kind: "binary", op: "^", left, right, pos: op.pos };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.atOp("-") || this.atOp("+") || this.atOp("!")) {
      const op = this.next();
      const operand = this.parseUnary();
      return { kind: "unary", op: op.value, operand, pos: op.pos };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.atOp("[")) {
        const pos = this.next().pos;
        const index = this.parseExpr();
        this.expectOp("]");
        e = { kind: "index", target: e, index, pos };
      } else if (this.atOp(".")) {
        const pos = this.next().pos;
        const name = this.expectIdent().value;
        e = { kind: "member", target: e, name, pos };
      } else if (this.atOp("(") && e.kind === "ident") {
        // call: only ident(...) — OpenSCAD has no first-class call-on-expr except function literals
        const args = this.parseArgList();
        e = { kind: "call", name: e.name, args, pos: e.pos };
      } else {
        break;
      }
    }
    return e;
  }

  /** True when the next token can begin an expression. */
  private atExprStart(): boolean {
    const t = this.peek();
    if (t.type === "num" || t.type === "str" || t.type === "ident") return true;
    if (t.type === "keyword") {
      return ["true", "false", "undef", "let", "assert", "echo", "function"].includes(t.value);
    }
    if (t.type === "op") {
      return ["(", "[", "-", "+", "!"].includes(t.value);
    }
    return false;
  }

  private parsePrimary(): Expr {
    const t = this.peek();

    if (t.type === "num") {
      this.next();
      return { kind: "num", value: t.num!, pos: t.pos };
    }
    if (t.type === "str") {
      this.next();
      return { kind: "str", value: t.value, pos: t.pos };
    }
    if (this.at("keyword", "true")) { this.next(); return { kind: "bool", value: true, pos: t.pos }; }
    if (this.at("keyword", "false")) { this.next(); return { kind: "bool", value: false, pos: t.pos }; }
    if (this.at("keyword", "undef")) { this.next(); return { kind: "undef", pos: t.pos }; }

    if (this.at("keyword", "let")) {
      this.next();
      this.expectOp("(");
      const assigns = this.parseAssignList(")");
      this.expectOp(")");
      const body = this.parseExpr();
      return { kind: "let", assigns, body, pos: t.pos };
    }

    if (this.at("keyword", "assert")) {
      this.next();
      const args = this.parseArgList();
      // assert(...) expr  — expression form
      const body = this.atExprStart() ? this.parseExpr() : null;
      return { kind: "assertExpr", args, body, pos: t.pos };
    }

    if (this.at("keyword", "echo")) {
      this.next();
      const args = this.parseArgList();
      const body = this.atExprStart() ? this.parseExpr() : null;
      return { kind: "echoExpr", args, body, pos: t.pos };
    }

    if (this.at("keyword", "function")) {
      // function literal: function (params) expr
      this.next();
      const params = this.parseParamList();
      const body = this.parseExpr();
      return { kind: "function", params, body, pos: t.pos };
    }

    if (t.type === "ident") {
      this.next();
      return { kind: "ident", name: t.value, pos: t.pos };
    }

    if (this.atOp("(")) {
      this.next();
      const e = this.parseExpr();
      this.expectOp(")");
      return e;
    }

    if (this.atOp("[")) {
      return this.parseVectorOrRange();
    }

    throw new ScadError(`Unexpected token '${t.value || t.type}' in expression`, t.pos);
  }

  private parseVectorOrRange(): Expr {
    const open = this.expectOp("[");

    if (this.atOp("]")) {
      this.next();
      return { kind: "vector", items: [], pos: open.pos };
    }

    // Check for list-comprehension starters
    if (this.at("keyword", "for") || this.at("keyword", "each") || this.at("keyword", "if") || this.at("keyword", "let")) {
      const items: LcElement[] = [];
      items.push(this.parseLcElement());
      while (this.atOp(",")) {
        this.next();
        if (this.atOp("]")) break;
        items.push(this.parseLcElement());
      }
      this.expectOp("]");
      return { kind: "vector", items, pos: open.pos };
    }

    const first = this.parseExpr();

    // range [a : b] or [a : s : b]
    if (this.atOp(":")) {
      this.next();
      const second = this.parseExpr();
      if (this.atOp(":")) {
        this.next();
        const third = this.parseExpr();
        this.expectOp("]");
        return { kind: "range", start: first, step: second, end: third, pos: open.pos };
      }
      this.expectOp("]");
      return { kind: "range", start: first, end: second, pos: open.pos };
    }

    const items: LcElement[] = [{ kind: "lcExpr", expr: first }];
    while (this.atOp(",")) {
      this.next();
      if (this.atOp("]")) break;
      items.push(this.parseLcElement());
    }
    this.expectOp("]");
    return { kind: "vector", items, pos: open.pos };
  }

  private parseLcElement(): LcElement {
    const t = this.peek();

    if (this.at("keyword", "for")) {
      this.next();
      this.expectOp("(");
      const assigns = this.parseAssignList(")");
      // C-style for: for (init; cond; update)
      if (this.atOp(";")) {
        this.next();
        const cond = this.parseExpr();
        this.expectOp(";");
        const update = this.parseAssignList(")");
        this.expectOp(")");
        const body = this.parseLcElement();
        return { kind: "lcForC", init: assigns, cond, update, body, pos: t.pos };
      }
      this.expectOp(")");
      const body = this.parseLcElement();
      return { kind: "lcFor", assigns, body, pos: t.pos };
    }

    if (this.at("keyword", "each")) {
      this.next();
      // each can precede another lc element or expr
      const inner = this.parseLcElement();
      if (inner.kind === "lcExpr") {
        return { kind: "lcEach", expr: inner.expr, pos: t.pos };
      }
      return inner; // each for(...) — for already flattens
    }

    if (this.at("keyword", "if")) {
      this.next();
      this.expectOp("(");
      const cond = this.parseExpr();
      this.expectOp(")");
      const then = this.parseLcElement();
      let els: LcElement | null = null;
      if (this.at("keyword", "else")) {
        this.next();
        els = this.parseLcElement();
      }
      return { kind: "lcIf", cond, then, else: els, pos: t.pos };
    }

    if (this.at("keyword", "let")) {
      this.next();
      this.expectOp("(");
      const assigns = this.parseAssignList(")");
      this.expectOp(")");
      const body = this.parseLcElement();
      return { kind: "lcLet", assigns, body, pos: t.pos };
    }

    return { kind: "lcExpr", expr: this.parseExpr() };
  }
}
