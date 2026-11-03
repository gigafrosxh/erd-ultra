// Dokumentzustand mit Rückgängig/Wiederholen.

import { useCallback, useRef, useState } from "react";
import { serializeErDsl } from "./er/dsl";
import { type ErDiagram, emptyDiagram } from "./er/model";
import { type GenOptions, defaultGenOptions } from "./data/generator";
import { type RelSchema, emptySchema } from "./rel/model";
import { serializeRelDsl } from "./rel/dsl";
import { type MappingOptions, defaultMappingOptions } from "./rel/mapping";
import type { SqlDialect } from "./rel/sql";

export interface Doc {
  er: ErDiagram;
  erText: string;
  rel: RelSchema;
  relText: string;
  mapping: MappingOptions;
  gen: GenOptions;
  dialect: SqlDialect;
  /** Relationales Schema automatisch aus dem ER-Diagramm ableiten */
  relAutoSync: boolean;
}

export function emptyDoc(): Doc {
  const er = emptyDiagram();
  const rel = emptySchema();
  return {
    er,
    erText: serializeErDsl(er),
    rel,
    relText: serializeRelDsl(rel),
    mapping: { ...defaultMappingOptions },
    gen: { ...defaultGenOptions, rows: {} },
    dialect: "postgres",
    relAutoSync: true,
  };
}

export const FILE_FORMAT = "erd-ultra";
export const FILE_VERSION = 1;

export function docToFile(doc: Doc): string {
  return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, app: "ERD-Ultra", ...doc }, null, 2);
}

export function docFromFile(text: string): Doc {
  const raw = JSON.parse(text);
  if (raw?.format !== FILE_FORMAT) throw new Error("Keine gültige ERD-Ultra-Datei (.erdu)");
  if (raw.version > FILE_VERSION) throw new Error("Datei stammt aus einer neueren ERD-Ultra-Version");
  const base = emptyDoc();
  const er: ErDiagram = raw.er ?? base.er;
  const rel: RelSchema = raw.rel ?? base.rel;
  return {
    er,
    erText: typeof raw.erText === "string" ? raw.erText : serializeErDsl(er),
    rel,
    relText: typeof raw.relText === "string" ? raw.relText : serializeRelDsl(rel),
    mapping: { ...base.mapping, ...raw.mapping },
    gen: { ...base.gen, ...raw.gen, rows: { ...(raw.gen?.rows ?? {}) } },
    dialect: raw.dialect ?? base.dialect,
    relAutoSync: raw.relAutoSync ?? true,
  };
}

interface History {
  past: Doc[];
  future: Doc[];
  lastKey: string | null;
  lastTime: number;
}

export interface DocStore {
  doc: Doc;
  /** Änderung übernehmen. Gleicher `mergeKey` innerhalb kurzer Zeit → ein Undo-Schritt. */
  update: (fn: (d: Doc) => Doc, mergeKey?: string) => void;
  replace: (d: Doc) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  markSaved: () => void;
}

export function useDocStore(initial: () => Doc): DocStore {
  const [doc, setDoc] = useState<Doc>(initial);
  const docRef = useRef(doc);
  docRef.current = doc;
  const hist = useRef<History>({ past: [], future: [], lastKey: null, lastTime: 0 });
  const [, force] = useState(0);
  const savedRef = useRef<Doc>(doc);
  const [savedVersion, setSavedVersion] = useState(0);

  const update = useCallback((fn: (d: Doc) => Doc, mergeKey?: string) => {
    const prev = docRef.current;
    const next = fn(prev);
    if (next === prev) return;
    const h = hist.current;
    const now = Date.now();
    const merge = mergeKey && h.lastKey === mergeKey && now - h.lastTime < 1500;
    if (!merge) {
      h.past.push(prev);
      if (h.past.length > 200) h.past.shift();
    }
    h.future = [];
    h.lastKey = mergeKey ?? null;
    h.lastTime = now;
    docRef.current = next;
    setDoc(next);
  }, []);

  const replace = useCallback((d: Doc) => {
    hist.current = { past: [], future: [], lastKey: null, lastTime: 0 };
    docRef.current = d;
    savedRef.current = d;
    setDoc(d);
    setSavedVersion((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    const h = hist.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(docRef.current);
    h.lastKey = null;
    docRef.current = prev;
    setDoc(prev);
    force((x) => x + 1);
  }, []);

  const redo = useCallback(() => {
    const h = hist.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(docRef.current);
    h.lastKey = null;
    docRef.current = next;
    setDoc(next);
    force((x) => x + 1);
  }, []);

  const markSaved = useCallback(() => {
    savedRef.current = docRef.current;
    setSavedVersion((v) => v + 1);
  }, []);

  void savedVersion;
  return {
    doc,
    update,
    replace,
    undo,
    redo,
    canUndo: hist.current.past.length > 0,
    canRedo: hist.current.future.length > 0,
    dirty: savedRef.current !== doc,
    markSaved,
  };
}
