import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataView } from "./data/DataView";
import { type ErCanvasHandle } from "./er/ErCanvas";
import { ErExportSvg, LIGHT } from "./er/ErSvg";
import { ErView } from "./er/ErView";
import { parseErDsl } from "./er/dsl";
import type { ErDiagram } from "./er/model";
import { SIMPLE_EXAMPLE } from "./examples";
import { elementToSvgString, svgToPng } from "./lib/exporter";
import {
  baseName,
  confirmDialog,
  hasFileSystem,
  ide,
  isTauri,
  onCloseRequested,
  onFileOpened,
  openFile,
  openReleasePage,
  readFileAt,
  saveFileAs,
  setWindowTitle,
  startupFile,
  writeFileTo,
} from "./lib/platform";
import { APP_VERSION, checkForUpdate, type UpdateInfo } from "./lib/update";
import { layoutNewTables, serializeRelDsl } from "./rel/dsl";
import { mapErToRelational } from "./rel/mapping";
import type { RelSchema } from "./rel/model";
import { REL_LIGHT, RelExportSvg } from "./rel/RelSvg";
import { RelView } from "./rel/RelView";
import { schemaToSql } from "./rel/sql";
import { type Doc, docFromFile, docToFile, emptyDoc, useDocStore } from "./store";
import { Icon } from "./ui/Icon";

type Tab = "er" | "rel" | "data";

const AUTOSAVE_KEY = "erd-ultra:autosave";
/** Autosave enthält Änderungen, die noch nicht in der Datei gespeichert sind */
const AUTOSAVE_DIRTY_KEY = "erd-ultra:autosave-dirty";
const DISCARD_MSG = "Ungespeicherte Änderungen verwerfen?";
const SKIP_UPDATE_KEY = "erd-ultra:skip-update";
/** Im JetBrains-Plugin als Editor einer .erdu-Datei: Inhalt kommt aus der IDE, nicht aus dem Autosave */
const inIdeEditor = ide?.mode === "editor";

function exampleDoc(): Doc {
  const er = parseErDsl(SIMPLE_EXAMPLE).diagram;
  return syncRel({ ...emptyDoc(), er, erText: SIMPLE_EXAMPLE }, true);
}

/** Relationales Schema aus dem ER-Diagramm ableiten (Positionen bleiben erhalten). */
function syncRel(d: Doc, force = false): Doc {
  if (!d.relAutoSync && !force) return d;
  const { schema } = mapErToRelational(d.er, d.mapping);
  const old = new Map(d.rel.tables.map((t) => [t.name, t]));
  const kept = schema.tables.some((t) => old.has(t.name));
  if (kept) {
    for (const t of schema.tables) {
      const o = old.get(t.name);
      if (o) {
        t.id = o.id;
        t.x = o.x;
        t.y = o.y;
        t.color = o.color;
      } else {
        t.x = NaN;
        t.y = NaN;
      }
    }
    layoutNewTables(schema.tables);
  }
  return { ...d, rel: schema, relText: serializeRelDsl(schema) };
}

function restoredDirty(): boolean {
  if (inIdeEditor) return false;
  try {
    return localStorage.getItem(AUTOSAVE_DIRTY_KEY) === "1" && !!localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return false;
  }
}

function initialDoc(): Doc {
  if (inIdeEditor) return emptyDoc();
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) return docFromFile(saved);
  } catch {
    /* ignorieren */
  }
  return emptyDoc();
}

interface Toast {
  id: number;
  msg: string;
  kind: "error" | "info";
}

export default function App() {
  const store = useDocStore(initialDoc, restoredDirty());
  const { doc, update } = store;
  const [tab, setTab] = useState<Tab>("er");
  const [dark, setDark] = useState(() => {
    if (ide) return ide.dark;
    try {
      const t = localStorage.getItem("erd-ultra:theme");
      if (t) return t === "dark";
    } catch {
      /* ignorieren */
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  const [path, setPath] = useState<string | null>(() => {
    if (inIdeEditor) return null;
    try {
      return localStorage.getItem("erd-ultra:path");
    } catch {
      return null;
    }
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [menu, setMenu] = useState<null | "file">(null);
  const [fitSignal, setFitSignal] = useState(1);
  const [available, setAvailable] = useState<UpdateInfo | null>(null);
  const erCanvas = useRef<ErCanvasHandle | null>(null);
  const relFit = useRef<() => void>(() => {});
  // IDE-Editor: zuletzt mit dem IDE-Dokument abgeglichener Inhalt und dessen Änderungsstatus
  const ideSynced = useRef<string | null>(null);
  const [ideModified, setIdeModified] = useState(false);
  const dirty = inIdeEditor ? ideModified : store.dirty;

  const toast = useCallback((msg: string, kind: "error" | "info" = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 5000 : 2600);
  }, []);

  // Beim Start nach einer neuen Version suchen (nur Desktop-App und IDE-Plugin; im IDE-Editor
  // nicht in jedem geöffneten .erdu-Tab, sondern einmal pro IDE-Sitzung im Tool-Fenster bzw. ersten Editor)
  const findUpdate = useCallback(
    async (manual: boolean) => {
      try {
        const u = await checkForUpdate();
        let skipped: string | null = null;
        try {
          skipped = localStorage.getItem(SKIP_UPDATE_KEY);
        } catch {
          /* ignorieren */
        }
        if (u && (manual || u.version !== skipped)) setAvailable(u);
        else if (manual) toast(`ERD-Ultra ${APP_VERSION} ist aktuell`, "info");
      } catch (e) {
        if (manual) toast(`Update-Prüfung fehlgeschlagen: ${e instanceof Error ? e.message : e}`, "error");
      }
    },
    [toast],
  );
  useEffect(() => {
    if (!isTauri && !ide) return;
    if (ide) {
      try {
        if (sessionStorage.getItem("erd-ultra:update-checked")) return;
        sessionStorage.setItem("erd-ultra:update-checked", "1");
      } catch {
        /* ignorieren */
      }
    }
    findUpdate(false);
  }, [findUpdate]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("erd-ultra:theme", dark ? "dark" : "light");
    } catch {
      /* ignorieren */
    }
  }, [dark]);

  // Automatisch lokal sichern (Wiederherstellung nach Absturz/Neustart)
  useEffect(() => {
    if (inIdeEditor) return;
    const h = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, docToFile(doc));
        localStorage.setItem(AUTOSAVE_DIRTY_KEY, store.dirty ? "1" : "0");
        if (path) localStorage.setItem("erd-ultra:path", path);
        else localStorage.removeItem("erd-ultra:path");
      } catch {
        /* ignorieren */
      }
    }, 400);
    return () => clearTimeout(h);
  }, [doc, path, store.dirty]);

  useEffect(() => {
    setWindowTitle(`${dirty ? "• " : ""}${path ? baseName(path) : "Unbenannt"} – ERD-Ultra`);
  }, [path, dirty]);

  // JetBrains-Plugin: Design der IDE folgen, Editor-Inhalt mit dem IDE-Dokument abgleichen
  useEffect(() => {
    if (!ide) return;
    const offs = [ide.on("theme", (d: boolean) => setDark(d))];
    if (inIdeEditor) {
      const load = (text: string) => {
        if (text === ideSynced.current) return;
        try {
          const d = text.trim() ? docFromFile(text) : emptyDoc();
          ideSynced.current = docToFile(d);
          store.replace(d);
          setFitSignal((x) => x + 1);
        } catch {
          // z. B. während die Datei im Text-Editor bearbeitet wird – letzten gültigen Stand behalten
        }
      };
      offs.push(ide.on("loadDoc", load));
      offs.push(ide.on("modified", (m: boolean) => setIdeModified(m)));
      ide
        .call<{ path: string; text: string; modified: boolean }>("ready")
        .then((f) => {
          setPath(f.path);
          setIdeModified(f.modified);
          load(f.text);
          if (ideSynced.current === null) toast("Datei konnte nicht gelesen werden – sie ist keine gültige ERD-Ultra-Datei.", "error");
        })
        .catch((e) => toast(String(e), "error"));
    }
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!inIdeEditor || ideSynced.current === null) return;
    const h = setTimeout(() => {
      const text = docToFile(doc);
      if (text === ideSynced.current) return;
      ideSynced.current = text;
      ide!.call("docChanged", { text }).catch((e) => toast(String(e), "error"));
    }, 250);
    return () => clearTimeout(h);
  }, [doc, toast]);

  // Datei, die per Doppelklick geöffnet wurde (beim Start oder bei laufender App)
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const openPath = async (p: string, ask: boolean) => {
    try {
      const d = docFromFile(await readFileAt(p));
      if (ask && dirtyRef.current && !(await confirmDialog(`${DISCARD_MSG}\n\n„${baseName(p)}“ wird geöffnet.`))) return;
      store.replace(d);
      setPath(p);
      setFitSignal((x) => x + 1);
    } catch (e) {
      toast(String(e), "error");
    }
  };
  useEffect(() => {
    startupFile().then((p) => {
      if (p) openPath(p, true);
    });
    return onFileOpened((p) => openPath(p, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desktop-App: vor dem Schließen nach ungespeicherten Änderungen fragen
  useEffect(() => onCloseRequested(async () => !dirtyRef.current || (await confirmDialog(`${DISCARD_MSG}\n\nERD-Ultra wird beendet.`, "Beenden"))), []);

  const mappingWarnings = useMemo(() => mapErToRelational(doc.er, doc.mapping).warnings, [doc.er, doc.mapping]);

  // ---- Änderungen
  const onErDiagram = useCallback(
    (er: ErDiagram, erText: string, mergeKey?: string) => update((d) => syncRel({ ...d, er, erText }), mergeKey),
    [update],
  );
  const onErText = useCallback(
    (erText: string, er: ErDiagram | null) => update((d) => (er ? syncRel({ ...d, er, erText }) : { ...d, erText }), "er-text"),
    [update],
  );
  const onRelSchema = useCallback(
    (rel: RelSchema, relText: string, mergeKey?: string) =>
      update((d) => {
        // Manuelle Strukturänderung am Schema → Auto-Sync aus, damit nichts überschrieben wird
        const structural = serializeRelDsl(rel) !== serializeRelDsl(d.rel);
        if (structural && d.relAutoSync) setTimeout(() => toast("Auto-Sync deaktiviert: Das Schema wurde manuell geändert.", "info"), 0);
        return { ...d, rel, relText, relAutoSync: structural ? false : d.relAutoSync };
      }, mergeKey),
    [update, toast],
  );
  const onRelText = useCallback(
    (relText: string, rel: RelSchema | null) =>
      update((d) => {
        if (!rel) return { ...d, relText };
        const structural = serializeRelDsl(rel) !== serializeRelDsl(d.rel);
        return { ...d, rel, relText, relAutoSync: structural ? false : d.relAutoSync };
      }, "rel-text"),
    [update],
  );

  // ---- Datei-Operationen
  const FILTER = [{ name: "ERD-Ultra Projekt", extensions: ["erdu"] }];
  const save = async (as = false) => {
    try {
      const content = docToFile(doc);
      if (inIdeEditor && !as) {
        ideSynced.current = content;
        await ide!.call("saveDoc", { text: content });
      } else if (inIdeEditor) {
        const p = await saveFileAs(baseName(path ?? "diagramm.erdu"), FILTER, content, "application/json");
        if (p) toast("Kopie gespeichert", "info");
        return;
      } else if (path && !as && hasFileSystem) {
        await writeFileTo(path, content);
      } else {
        const p = await saveFileAs(path ? baseName(path) : "diagramm.erdu", FILTER, content, "application/json");
        if (!p) return;
        setPath(p);
      }
      store.markSaved();
      toast("Gespeichert", "info");
    } catch (e) {
      toast(`Speichern fehlgeschlagen: ${e}`, "error");
    }
  };
  const open = async () => {
    try {
      if (!inIdeEditor && dirty && !(await confirmDialog(DISCARD_MSG))) return;
      const f = await openFile([...FILTER, { name: "ER-Code", extensions: ["erd", "txt"] }]);
      if (!f) return;
      if (inIdeEditor && f.name.toLowerCase().endsWith(".erdu")) {
        await ide!.call("openInEditor", { path: f.path });
        return;
      }
      if (inIdeEditor && dirty && !confirm("Den Inhalt dieser Datei durch den ER-Code ersetzen?")) return;
      if (f.name.toLowerCase().endsWith(".erdu")) {
        store.replace(docFromFile(f.text));
        setPath(f.path);
      } else {
        const r = parseErDsl(f.text);
        store.replace(syncRel({ ...emptyDoc(), er: r.diagram, erText: f.text }, true));
        if (!inIdeEditor) setPath(null);
        if (r.errors.length) toast(`${r.errors.length} Fehler im Code`, "error");
      }
      setFitSignal((x) => x + 1);
    } catch (e) {
      toast(`Öffnen fehlgeschlagen: ${e instanceof Error ? e.message : e}`, "error");
    }
  };
  const newDoc = async () => {
    if (dirty && !(await confirmDialog(DISCARD_MSG))) return;
    store.replace(emptyDoc());
    if (!inIdeEditor) setPath(null);
    setTab("er");
  };
  const loadExample = async () => {
    if (dirty && !(await confirmDialog(DISCARD_MSG))) return;
    store.replace(exampleDoc());
    if (!inIdeEditor) setPath(null);
    setMenu(null);
    setTab("er");
    setFitSignal((x) => x + 1);
  };

  const exportImage = async (format: "png" | "svg") => {
    try {
      // Export immer im hellen Design (Druck, Dokumente)
      const el = tab === "rel" ? <RelExportSvg schema={doc.rel} pal={REL_LIGHT} /> : <ErExportSvg diagram={doc.er} pal={LIGHT} />;
      const svg = elementToSvgString(el);
      const base = (path ? baseName(path).replace(/\.erdu$/i, "") : "diagramm") + (tab === "rel" ? "-schema" : "-er");
      if (format === "svg") {
        const p = await saveFileAs(`${base}.svg`, [{ name: "SVG", extensions: ["svg"] }], svg, "image/svg+xml");
        if (p) toast("SVG exportiert", "info");
      } else {
        const png = await svgToPng(svg, 2);
        const p = await saveFileAs(`${base}.png`, [{ name: "PNG-Bild", extensions: ["png"] }], png, "image/png");
        if (p) toast("PNG exportiert", "info");
      }
    } catch (e) {
      toast(`Export fehlgeschlagen: ${e}`, "error");
    }
  };
  const exportErCode = async () => {
    const p = await saveFileAs("diagramm.erd", [{ name: "ER-Code", extensions: ["erd", "txt"] }], doc.erText, "text/plain");
    if (p) toast("ER-Code exportiert", "info");
  };
  const exportSql = async () => {
    const p = await saveFileAs("schema.sql", [{ name: "SQL", extensions: ["sql"] }], schemaToSql(doc.rel, doc.dialect), "text/plain");
    if (p) toast("SQL exportiert", "info");
  };
  const saveData = async (name: string, data: string, kind: "sql" | "csv" | "json") => {
    const filters = { sql: [{ name: "SQL", extensions: ["sql"] }], csv: [{ name: "CSV", extensions: ["csv"] }], json: [{ name: "JSON", extensions: ["json"] }] }[kind];
    try {
      const p = await saveFileAs(name, filters, data, kind === "json" ? "application/json" : "text/plain");
      if (p) toast("Testdaten gespeichert", "info");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  // Globale Tastenkürzel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const inCode = (e.target as HTMLElement).closest?.(".cm-editor, input, textarea");
      if (k === "s") {
        e.preventDefault();
        save(e.shiftKey);
      } else if (k === "o") {
        e.preventDefault();
        open();
      } else if (k === "n" && !e.shiftKey) {
        e.preventDefault();
        newDoc();
      } else if (k === "e" && e.shiftKey) {
        e.preventDefault();
        exportImage("png");
      } else if (!inCode && k === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (!inCode && k === "y") {
        e.preventDefault();
        store.redo();
      } else if (k === "1" || k === "2" || k === "3") {
        e.preventDefault();
        setTab((["er", "rel", "data"] as Tab[])[Number(k) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".menu-wrap")) setMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const generateRel = () => {
    update((d) => syncRel({ ...d, relAutoSync: true }, true));
    toast("Schema aus dem ER-Diagramm erzeugt", "info");
    setTimeout(() => relFit.current(), 50);
  };

  const item = (label: string, action: () => void, shortcut?: string, icon?: string) => (
    <button
      className="menu-item"
      onClick={() => {
        setMenu(null);
        action();
      }}
    >
      {icon ? <Icon name={icon} size={16} /> : <span style={{ width: 16 }} />}
      <span className="grow">{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
  const mod = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Strg+";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={26} height={26} />
          <span>
            ERD<b>-Ultra</b>
          </span>
        </div>
        <div className="menu-wrap">
          <button className={`btn ghost ${menu === "file" ? "on" : ""}`} onClick={() => setMenu(menu === "file" ? null : "file")}>
            Datei <Icon name="chevron" size={14} />
          </button>
          {menu === "file" && (
            <div className="menu">
              {item("Neu", newDoc, `${mod}N`, "file")}
              {item("Öffnen…", open, `${mod}O`, "folder")}
              {item("Einfaches Beispiel laden", loadExample, undefined, "sparkles")}
              {item("Speichern", () => save(false), `${mod}S`, "save")}
              {item("Speichern unter…", () => save(true), `⇧${mod}S`)}
              <div className="menu-sep" />
              {item(tab === "rel" ? "Schema als PNG exportieren" : "ER-Diagramm als PNG exportieren", () => exportImage("png"), `⇧${mod}E`, "image")}
              {item(tab === "rel" ? "Schema als SVG exportieren" : "ER-Diagramm als SVG exportieren", () => exportImage("svg"), undefined, "image")}
              {item("ER-Code exportieren (.erd)", exportErCode, undefined, "code")}
              {item("SQL (CREATE TABLE) exportieren", exportSql, undefined, "database")}
              <div className="menu-sep" />
              {item("Nach Updates suchen…", () => findUpdate(true), undefined, "refresh")}
              <div className="menu-version">Version {APP_VERSION}</div>
            </div>
          )}
        </div>
        <div className="tabs">
          <button className={tab === "er" ? "on" : ""} onClick={() => setTab("er")}>
            <Icon name="diagram" size={16} /> ER-Diagramm
          </button>
          <button className={tab === "rel" ? "on" : ""} onClick={() => setTab("rel")}>
            <Icon name="table" size={16} /> Relationales Schema
          </button>
          <button className={tab === "data" ? "on" : ""} onClick={() => setTab("data")}>
            <Icon name="database" size={16} /> Testdaten
          </button>
        </div>
        <div className="top-actions">
          <span className="file-name" title={path ?? "Noch nicht gespeichert"}>
            {dirty && <i className="dot" />}
            {path ? baseName(path) : "Unbenannt"}
          </span>
          <button className="icon-btn" title={`Rückgängig (${mod}Z)`} disabled={!store.canUndo} onClick={store.undo}>
            <Icon name="undo" />
          </button>
          <button className="icon-btn" title={`Wiederholen (⇧${mod}Z)`} disabled={!store.canRedo} onClick={store.redo}>
            <Icon name="redo" />
          </button>
          <button className="icon-btn" title={`Speichern (${mod}S)`} onClick={() => save(false)}>
            <Icon name="save" />
          </button>
          <button className="btn" title="Als PNG exportieren" onClick={() => exportImage("png")}>
            <Icon name="image" size={16} /> PNG
          </button>
          <button className="icon-btn" title={dark ? "Helles Design" : "Dunkles Design"} onClick={() => setDark(!dark)}>
            <Icon name={dark ? "sun" : "moon"} />
          </button>
        </div>
      </header>
      <main className="workspace">
        <div className="view" hidden={tab !== "er"}>
          <ErView
            diagram={doc.er}
            text={doc.erText}
            dark={dark}
            onDiagram={onErDiagram}
            onText={onErText}
            toast={toast}
            canvasRef={erCanvas}
            active={tab === "er"}
            fitSignal={fitSignal}
            onExample={loadExample}
            onOpen={open}
          />
        </div>
        <div className="view" hidden={tab !== "rel"}>
          <RelView
            schema={doc.rel}
            text={doc.relText}
            dark={dark}
            mapping={doc.mapping}
            autoSync={doc.relAutoSync}
            dialect={doc.dialect}
            warnings={doc.relAutoSync ? mappingWarnings : []}
            active={tab === "rel"}
            fitSignal={fitSignal}
            onSchema={onRelSchema}
            onText={onRelText}
            onMapping={(m) => update((d) => syncRel({ ...d, mapping: m }, d.relAutoSync))}
            onAutoSync={(v) => update((d) => (v ? syncRel({ ...d, relAutoSync: true }, true) : { ...d, relAutoSync: false }))}
            onGenerate={generateRel}
            onDialect={(dialect) => update((d) => ({ ...d, dialect }))}
            onExportSql={exportSql}
            toast={toast}
            registerFit={(fn) => (relFit.current = fn)}
          />
        </div>
        {tab === "data" && (
          <div className="view">
            <DataView schema={doc.rel} gen={doc.gen} dialect={doc.dialect} onGen={(gen) => update((d) => ({ ...d, gen }), "gen")} onSave={saveData} toast={toast} />
          </div>
        )}
      </main>
      {available && (
        <div className="update-banner" role="status">
          <Icon name="download" size={18} />
          <div className="grow">
            <b>Neue Version verfügbar: {available.version}</b>
            <span>
              Installiert ist {APP_VERSION}.{ide ? " Das Plugin-ZIP liegt beim Release." : ""}
            </span>
          </div>
          <button
            className="btn primary"
            onClick={() => {
              openReleasePage(available.url).catch((e) => toast(String(e), "error"));
              setAvailable(null);
            }}
          >
            Aktualisieren
          </button>
          <button className="btn" onClick={() => setAvailable(null)} title="Beim nächsten Start erneut erinnern">
            Später
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              try {
                localStorage.setItem(SKIP_UPDATE_KEY, available.version);
              } catch {
                /* ignorieren */
              }
              setAvailable(null);
            }}
          >
            Überspringen
          </button>
        </div>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
