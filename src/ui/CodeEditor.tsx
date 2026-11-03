// Code-Editor (CodeMirror 6) mit Syntaxhervorhebung und Fehlermarkierung.

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic, linter, lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";

export interface CodeError {
  message: string;
  from: number;
  to: number;
}

function dslLanguage(keywords: string[], modifiers: string[]) {
  const kw = new Set(keywords);
  const mods = new Set(modifiers);
  return StreamLanguage.define<{ inBlock: boolean }>({
    startState: () => ({ inBlock: false }),
    token(stream, state) {
      if (state.inBlock) {
        if (stream.match(/.*?\*\//)) state.inBlock = false;
        else stream.skipToEnd();
        return "comment";
      }
      if (stream.eatSpace()) return null;
      if (stream.match("/*")) {
        state.inBlock = true;
        return "comment";
      }
      if (stream.match("#") || stream.match("//")) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) return "string";
      if (stream.match(/^\(\s*[\w*]+\s*,\s*[\w*]+\s*\)/)) return "number";
      if (stream.match(/^\d+(\.\d+)?/)) return "number";
      if (stream.match(/^(->|>|\.\.)/)) return "operator";
      const m = stream.match(/^[\p{L}_][\p{L}\p{N}_]*/u) as RegExpMatchArray | null;
      if (m) {
        const w = m[0].toLowerCase();
        if (kw.has(w)) return "keyword";
        if (mods.has(w)) return "modifier";
        return "variableName";
      }
      stream.next();
      return null;
    },
    languageData: { commentTokens: { line: "#" } },
  });
}

export const ER_LANG = dslLanguage(
  ["entity", "weak", "associative", "aggregation", "relationship", "rel", "identifying", "isa", "attribute", "note"],
  ["key", "pk", "partial", "multi", "multivalued", "derived", "as", "total", "disjoint", "overlapping", "d", "o", "n", "m"],
);
export const REL_LANG = dslLanguage(["table", "note"], ["pk", "primary", "key", "not", "null", "unique", "ref", "references", "fk"]);

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--cm-keyword)", fontWeight: "600" },
  { tag: t.modifier, color: "var(--cm-modifier)" },
  { tag: t.string, color: "var(--cm-string)" },
  { tag: t.number, color: "var(--cm-number)" },
  { tag: t.comment, color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: t.operator, color: "var(--cm-operator)" },
  { tag: t.variableName, color: "var(--cm-text)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--panel)", color: "var(--cm-text)" },
  ".cm-scroller": { fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace", lineHeight: "1.6" },
  ".cm-gutters": { backgroundColor: "var(--panel)", color: "var(--muted)", border: "none" },
  ".cm-activeLine": { backgroundColor: "var(--cm-active)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--cm-active)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--cm-selection) !important" },
  ".cm-placeholder": { color: "var(--muted)" },
});

interface Props {
  value: string;
  onChange: (v: string) => void;
  errors: CodeError[];
  language: StreamLanguage<unknown>;
  placeholderText?: string;
}

export function CodeEditor({ value, onChange, errors, language, placeholderText }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const applyingRef = useRef(false);

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          language,
          syntaxHighlighting(highlight),
          lintGutter(),
          linter(null),
          placeholder(placeholderText ?? ""),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          theme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !applyingRef.current) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Externe Änderungen (z.B. aus der Grafik) übernehmen, ohne den Cursor unnötig zu verlieren
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur === value) return;
    // minimale Änderung bestimmen
    let start = 0;
    while (start < cur.length && start < value.length && cur[start] === value[start]) start++;
    let endA = cur.length;
    let endB = value.length;
    while (endA > start && endB > start && cur[endA - 1] === value[endB - 1]) {
      endA--;
      endB--;
    }
    applyingRef.current = true;
    view.dispatch({ changes: { from: start, to: endA, insert: value.slice(start, endB) } });
    applyingRef.current = false;
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const len = view.state.doc.length;
    const diags: Diagnostic[] = errors.map((e) => ({
      from: Math.min(e.from, len),
      to: Math.min(Math.max(e.to, e.from + 1), len),
      severity: "error",
      message: e.message,
    }));
    view.dispatch(setDiagnostics(view.state, diags));
  }, [errors, value]);

  return <div className="code-editor" ref={host} />;
}
