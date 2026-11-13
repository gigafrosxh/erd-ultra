// Gemeinsamer Tokenizer für die ER- und die Relationen-DSL.

export type TokType = "ident" | "string" | "number" | "punct" | "nl" | "eof";

export interface Token {
  type: TokType;
  value: string;
  line: number;
  col: number;
  pos: number;
  end: number;
}

export class DslError extends Error {
  line: number;
  col: number;
  from: number;
  to: number;
  constructor(msg: string, tok: { line: number; col: number; pos: number; end: number }) {
    super(msg);
    this.line = tok.line;
    this.col = tok.col;
    this.from = tok.pos;
    this.to = Math.max(tok.end, tok.pos + 1);
  }
}

const identStart = /[\p{L}_]/u;
const identPart = /[\p{L}\p{N}_]/u;

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };

/**
 * Zerlegt den Text in Tokens. Lexikalische Fehler (nicht geschlossene Zeichenkette oder Kommentar) werden in
 * `errors` gesammelt statt geworfen, damit der Editor sie anzeigen kann.
 */
export function tokenize(src: string, errors: DslError[] = []): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const push = (type: TokType, value: string, start: number) =>
    toks.push({ type, value, line, col: start - lineStart + 1, pos: start, end: i });

  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      i++;
      push("nl", "\n", i - 1);
      line++;
      lineStart = i;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    // Kommentare: # ... oder // ...
    if (c === "#" || (c === "/" && src[i + 1] === "/")) {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const start = i;
      const startLine = line;
      const startCol = start - lineStart + 1;
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      if (i >= src.length) {
        errors.push(new DslError("Nicht geschlossener Kommentar: \"*/\" fehlt", { line: startLine, col: startCol, pos: start, end: start + 2 }));
        break;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const start = i;
      i++;
      let s = "";
      while (i < src.length && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\" && i + 1 < src.length) {
          const n = src[i + 1];
          if (n === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
            s += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
            i += 6;
            continue;
          }
          s += ESCAPES[n] ?? n;
          i += 2;
          continue;
        }
        s += src[i++];
      }
      if (src[i] !== c) {
        errors.push(new DslError("Nicht geschlossene Zeichenkette", { line, col: start - lineStart + 1, pos: start, end: i }));
      } else i++;
      push("string", s, start);
      continue;
    }
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
      // Dezimalzahlen, aber nicht ".." (Bereich)
      if (src[i] === "." && /[0-9]/.test(src[i + 1] ?? "")) {
        i++;
        while (i < src.length && /[0-9]/.test(src[i])) i++;
      }
      push("number", src.slice(start, i), start);
      continue;
    }
    if (identStart.test(c)) {
      const start = i;
      while (i < src.length && identPart.test(src[i])) i++;
      push("ident", src.slice(start, i), start);
      continue;
    }
    const start = i;
    if (src.startsWith("..", i) || src.startsWith("->", i) || src.startsWith("<>", i) || src.startsWith("<-", i)) {
      i += 2;
      push("punct", src.slice(start, i), start);
      continue;
    }
    i++;
    push("punct", c, start);
  }
  toks.push({ type: "eof", value: "", line, col: i - lineStart + 1, pos: i, end: i });
  return toks;
}

export class TokenStream {
  toks: Token[];
  i = 0;
  /** Lexikalische Fehler aus dem Tokenizer */
  lexErrors: DslError[] = [];
  constructor(src: string) {
    this.toks = tokenize(src, this.lexErrors);
  }
  peek(skipNl = true): Token {
    let j = this.i;
    if (skipNl) while (this.toks[j].type === "nl") j++;
    return this.toks[j];
  }
  next(skipNl = true): Token {
    if (skipNl) this.skipNl();
    return this.toks[this.i++] ?? this.toks[this.toks.length - 1];
  }
  skipNl() {
    while (this.toks[this.i].type === "nl") this.i++;
  }
  is(value: string, skipNl = true): boolean {
    const t = this.peek(skipNl);
    return (t.type === "punct" || t.type === "ident") && t.value === value;
  }
  isKw(value: string, skipNl = true): boolean {
    const t = this.peek(skipNl);
    return t.type === "ident" && t.value.toLowerCase() === value;
  }
  accept(value: string, skipNl = true): boolean {
    if (this.is(value, skipNl)) {
      this.next(skipNl);
      return true;
    }
    return false;
  }
  acceptKw(value: string, skipNl = true): boolean {
    if (this.isKw(value, skipNl)) {
      this.next(skipNl);
      return true;
    }
    return false;
  }
  expect(value: string, skipNl = true): Token {
    const t = this.next(skipNl);
    if (t.value !== value || t.type === "string") {
      throw new DslError(`"${value}" erwartet, aber "${t.value || "Dateiende"}" gefunden`, t);
    }
    return t;
  }
  /** Name: Bezeichner oder Zeichenkette */
  name(what: string, skipNl = true): Token {
    const t = this.next(skipNl);
    if (t.type !== "ident" && t.type !== "string" && t.type !== "number") {
      throw new DslError(`${what} erwartet, aber "${t.value || "Dateiende"}" gefunden`, t);
    }
    return t;
  }
}

const simpleIdent = /^[\p{L}_][\p{L}\p{N}_]*$/u;

export function quoteName(name: string, reserved: Set<string> = new Set()): string {
  if (simpleIdent.test(name) && !reserved.has(name.toLowerCase())) return name;
  return quoteString(name);
}

/** Zeichenkette immer in Anführungszeichen, mit Escapes, die `tokenize` wieder einliest. */
export function quoteString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}
