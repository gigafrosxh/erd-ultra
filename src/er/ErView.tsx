// ER-Arbeitsbereich: Werkzeuge, Zeichenfläche, Eigenschaften und Code.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor, type CodeError, ER_LANG } from "../ui/CodeEditor";
import { Icon, ShapeIcon } from "../ui/Icon";
import { SplitPane } from "../ui/SplitPane";
import { ErCanvas, type ErCanvasHandle, type ErSelection, type ErTool, ownedAttributes } from "./ErCanvas";
import { ErProperties } from "./ErProperties";
import { DARK, LIGHT } from "./ErSvg";
import { keepComments, parseErDsl, serializeErDsl } from "./dsl";
import { autoLayout } from "./layout";
import { type ErDiagram, type ErNode, nodeSize, uid } from "./model";

interface Props {
  diagram: ErDiagram;
  text: string;
  dark: boolean;
  onDiagram: (d: ErDiagram, text: string, mergeKey?: string) => void;
  onText: (text: string, d: ErDiagram | null) => void;
  toast: (msg: string, kind?: "error" | "info") => void;
  canvasRef: React.RefObject<ErCanvasHandle | null>;
  active: boolean;
  fitSignal: number;
  onExample: () => void;
  onOpen: () => void;
}

const TOOLS: { id: ErTool; label: string; key?: string; group: number }[] = [
  { id: "select", label: "Auswählen (V)", key: "v", group: 0 },
  { id: "connect", label: "Verbinden (C)", key: "c", group: 0 },
  { id: "entity", label: "Entität (E)", key: "e", group: 1 },
  { id: "weak", label: "Schwache Entität (W)", key: "w", group: 1 },
  { id: "associative", label: "Aggregation / assoziative Entität", group: 1 },
  { id: "relationship", label: "Beziehung (R)", key: "r", group: 2 },
  { id: "identifying", label: "Identifizierende Beziehung", group: 2 },
  { id: "attribute", label: "Attribut (A)", key: "a", group: 3 },
  { id: "key", label: "Schlüsselattribut (K)", key: "k", group: 3 },
  { id: "multivalued", label: "Mehrwertiges Attribut (M)", key: "m", group: 3 },
  { id: "derived", label: "Abgeleitetes Attribut (D)", key: "d", group: 3 },
  { id: "isa", label: "Generalisierung / Spezialisierung (I)", key: "i", group: 4 },
  { id: "note", label: "Notiz (N)", key: "n", group: 4 },
];

const PLACEHOLDER = `# ER-Diagramm als Code – Beispiel:
entity Kunde {
  key kunden_nr: int
  name
}
entity Bestellung { key bestell_nr: int, datum: date }
relationship gibt_auf (Kunde 1, Bestellung n total)`;

export function ErView({ diagram, text, dark, onDiagram, onText, toast, canvasRef, active, fitSignal, onExample, onOpen }: Props) {
  const [tool, setTool] = useState<ErTool>("select");
  const [selection, setSelection] = useState<ErSelection>({ nodes: new Set(), edge: null });
  const [errors, setErrors] = useState<CodeError[]>([]);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [showCode, setShowCode] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const hasSelection = selection.nodes.size > 0 || !!selection.edge;
  const diagramRef = useRef(diagram);
  diagramRef.current = diagram;
  const pal = dark ? DARK : LIGHT;
  const clipboard = useRef<{ nodes: ErNode[]; edges: ErDiagram["edges"] } | null>(null);

  // Grafische Änderung → Code neu erzeugen, Kommentare aus dem bisherigen Code bleiben erhalten
  const textRef = useRef(text);
  textRef.current = text;
  const change = useCallback((d: ErDiagram, mergeKey?: string) => onDiagram(d, keepComments(textRef.current, serializeErDsl(d)), mergeKey), [onDiagram]);

  // Code-Änderung → nach kurzer Pause parsen
  const parseTimer = useRef<number | undefined>(undefined);
  const onCode = (src: string) => {
    window.clearTimeout(parseTimer.current);
    onText(src, null);
    parseTimer.current = window.setTimeout(() => {
      const r = parseErDsl(src, diagramRef.current);
      setErrors(r.errors.map((e) => ({ message: e.message, from: e.from, to: e.to })));
      if (!r.errors.length) onText(src, r.diagram);
    }, 280);
  };
  useEffect(() => () => window.clearTimeout(parseTimer.current), []);

  // Auswahl bereinigen, wenn Elemente verschwinden
  useEffect(() => {
    const ids = new Set(diagram.nodes.map((n) => n.id));
    const nodes = new Set([...selection.nodes].filter((id) => ids.has(id)));
    const edge = selection.edge && diagram.edges.some((e) => e.id === selection.edge) ? selection.edge : null;
    if (nodes.size !== selection.nodes.size || edge !== selection.edge) setSelection({ nodes, edge });
  }, [diagram, selection]);

  const fittedFor = useRef(-1);
  useEffect(() => {
    if (!active || fittedFor.current === fitSignal) return;
    fittedFor.current = fitSignal;
    setTimeout(() => canvasRef.current?.fit(), 30);
  }, [fitSignal, canvasRef, active]);

  const deleteSelection = useCallback(() => {
    const d = diagramRef.current;
    if (selection.edge) {
      change({ ...d, edges: d.edges.filter((e) => e.id !== selection.edge) });
      setSelection({ nodes: new Set(), edge: null });
      return;
    }
    if (!selection.nodes.size) return;
    const del = new Set(selection.nodes);
    const owners = [...del].filter((id) => d.nodes.find((n) => n.id === id)?.kind !== "attribute");
    for (const a of ownedAttributes(d, owners)) del.add(a);
    for (const a of ownedAttributes(d, [...del])) del.add(a);
    change({ ...d, nodes: d.nodes.filter((n) => !del.has(n.id)), edges: d.edges.filter((e) => !del.has(e.from) && !del.has(e.to)) });
    setSelection({ nodes: new Set(), edge: null });
  }, [selection, change]);

  const doAutoLayout = () => {
    const d = structuredClone(diagramRef.current);
    autoLayout(d);
    change(d);
    setTimeout(() => canvasRef.current?.fit(), 30);
  };

  const copy = () => {
    const d = diagramRef.current;
    const ids = new Set(selection.nodes);
    for (const a of ownedAttributes(d, ids)) ids.add(a);
    clipboard.current = { nodes: d.nodes.filter((n) => ids.has(n.id)), edges: d.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  };
  const paste = () => {
    const c = clipboard.current;
    if (!c?.nodes.length) return;
    const d = diagramRef.current;
    const map = new Map(c.nodes.map((n) => [n.id, uid()]));
    const nodes = c.nodes.map((n) => {
      let name = n.name;
      if (n.kind === "entity" || n.kind === "relationship") {
        let i = 2;
        while (d.nodes.some((m) => m.kind === n.kind && m.name === name)) name = `${n.name} ${i++}`;
      }
      return { ...n, id: map.get(n.id)!, name, x: n.x + 40, y: n.y + 40 };
    });
    const edges = c.edges.map((e) => ({ ...e, id: uid("e"), from: map.get(e.from)!, to: map.get(e.to)! }));
    change({ ...d, nodes: [...d.nodes, ...nodes], edges: [...d.edges, ...edges] });
    setSelection({ nodes: new Set(nodes.filter((n) => n.kind !== "attribute").map((n) => n.id)), edge: null });
    clipboard.current = { nodes: nodes, edges };
  };

  // Tastatur
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, .cm-editor")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === "Escape") {
        setTool("select");
        setSelection({ nodes: new Set(), edge: null });
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection({ nodes: new Set(diagramRef.current.nodes.map((n) => n.id)), edge: null });
      } else if (mod && e.key.toLowerCase() === "c") {
        copy();
      } else if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        paste();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        copy();
        paste();
      } else if (e.key === "F2" && selection.nodes.size === 1) {
        startRename([...selection.nodes][0]);
      } else if (!mod && !e.altKey) {
        const tl = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (tl) setTool(tl.id);
        else if (e.key === "0") canvasRef.current?.fit();
        else if (e.key.startsWith("Arrow") && selection.nodes.size) {
          e.preventDefault();
          const step = e.shiftKey ? 20 : 4;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          const d = diagramRef.current;
          const ids = new Set(selection.nodes);
          for (const a of ownedAttributes(d, ids)) ids.add(a);
          change({ ...d, nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) }, "nudge");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const startRename = (id: string) => {
    const n = diagramRef.current.nodes.find((x) => x.id === id);
    if (!n || n.kind === "isa") return;
    setRenaming({ id, value: n.name });
  };
  const commitRename = () => {
    if (!renaming) return;
    const d = diagramRef.current;
    const v = renaming.value.trim();
    if (v) change({ ...d, nodes: d.nodes.map((n) => (n.id === renaming.id ? { ...n, name: v } : n)) });
    setRenaming(null);
  };

  const renameNode = renaming ? diagram.nodes.find((n) => n.id === renaming.id) : undefined;
  const renameBox = useMemo(() => {
    if (!renameNode || !canvasRef.current) return null;
    const view = canvasRef.current.view;
    const s = nodeSize(renameNode);
    const host = document.querySelector(".er-canvas-wrap")?.getBoundingClientRect();
    if (!host) return null;
    const p = canvasRef.current.toScreen(renameNode.x, renameNode.y);
    const w = Math.max(140, s.w * view.k);
    return { left: p.x - host.left - w / 2, top: p.y - host.top - 16, width: w };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameNode, renaming?.id]);

  const toolbar = (
    <div className="toolbar vertical">
      {TOOLS.map((t, i) => (
        <div key={t.id} className="tool-wrap">
          {i > 0 && TOOLS[i - 1].group !== t.group && <div className="tool-sep" />}
          <button className={`tool ${tool === t.id ? "on" : ""}`} title={t.label} onClick={() => setTool(t.id)}>
            <ShapeIcon kind={t.id} />
          </button>
        </div>
      ))}
    </div>
  );

  const canvas = (
    <div className="er-canvas-wrap">
      {toolbar}
      <ErCanvas
        ref={canvasRef}
        diagram={diagram}
        pal={pal}
        tool={tool}
        setTool={setTool}
        selection={selection}
        setSelection={setSelection}
        onChange={change}
        onRename={startRename}
        onError={(m) => toast(m, "error")}
        dark={dark}
      />
      {renaming && renameBox && (
        <input
          className="rename-input"
          ref={(el) => {
            if (el && document.activeElement !== el) {
              el.focus({ preventScroll: true });
              el.select();
            }
          }}
          style={{ left: renameBox.left, top: renameBox.top, width: renameBox.width }}
          value={renaming.value}
          onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(null);
          }}
        />
      )}
      <div className="zoom-controls">
        <button title="Verkleinern" onClick={() => canvasRef.current?.zoom(1 / 1.2)}>
          <Icon name="zoomOut" size={16} />
        </button>
        <button title="Alles anzeigen (0)" onClick={() => canvasRef.current?.fit()}>
          <Icon name="fit" size={16} />
        </button>
        <button title="Vergrößern" onClick={() => canvasRef.current?.zoom(1.2)}>
          <Icon name="zoomIn" size={16} />
        </button>
        <span className="sep" />
        <button title="Automatisch anordnen" onClick={doAutoLayout}>
          <Icon name="layout" size={16} />
        </button>
        <button title={showCode ? "Code ausblenden" : "Code einblenden"} className={showCode ? "on" : ""} onClick={() => setShowCode(!showCode)}>
          <Icon name="code" size={16} />
        </button>
      </div>
      {diagram.nodes.length === 0 && (
        <div className="empty-hint">
          <Icon name="sparkles" size={28} />
          <h2>Leeres Diagramm</h2>
          <p>Doppelklick auf die Fläche erstellt eine Entität, links findest du alle Chen-Symbole. Du kannst das Diagramm auch rechts als Code schreiben.</p>
          <div className="empty-actions">
            <button className="btn primary" onClick={onExample}>
              <Icon name="sparkles" size={15} /> Einfaches Beispiel laden
            </button>
            <button className="btn" onClick={onOpen}>
              <Icon name="folder" size={15} /> Datei öffnen…
            </button>
            {!showCode && (
              <button className="btn" onClick={() => setShowCode(true)}>
                <Icon name="code" size={15} /> Code einblenden
              </button>
            )}
          </div>
        </div>
      )}
      {!hasSelection && !showInfo && (
        <button className="props-toggle" onClick={() => setShowInfo(true)} title="Diagramm-Einstellungen">
          <Icon name="panel" size={15} /> Diagramm
        </button>
      )}
      <div className="props-float" hidden={!hasSelection && !showInfo}>
        {!hasSelection && (
          <button className="icon-btn close" title="Schließen" onClick={() => setShowInfo(false)}>
            <Icon name="x" size={15} />
          </button>
        )}
        <ErProperties
          diagram={diagram}
          selNodes={selection.nodes}
          selEdge={selection.edge}
          onChange={change}
          select={(nodes, edge = null) => setSelection({ nodes: new Set(nodes), edge })}
          onDelete={deleteSelection}
          onAutoLayout={doAutoLayout}
        />
      </div>
    </div>
  );

  if (!showCode) return canvas;
  return (
    <SplitPane storageKey="er-split" initial={0.68}>
      {canvas}
      <div className="code-pane">
        <div className="pane-head">
          <Icon name="code" size={16} />
          <span>ER-Code</span>
          <span className="grow" />
          {errors.length > 0 ? <span className="badge error">{errors.length} Fehler</span> : <span className="badge ok">synchron</span>}
          <DslHelp kind="er" />
        </div>
        <CodeEditor value={text} onChange={onCode} errors={errors} language={ER_LANG} placeholderText={PLACEHOLDER} />
      </div>
    </SplitPane>
  );
}

export function DslHelp({ kind }: { kind: "er" | "rel" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="help-wrap">
      <button className="icon-btn" title="Syntax-Hilfe" onClick={() => setOpen(!open)}>
        <Icon name="book" size={16} />
      </button>
      {open && (
        <div className="help-pop" onMouseLeave={() => setOpen(false)}>
          {kind === "er" ? (
            <pre>{`entity Name {            Entität
  key id: int            Schlüssel (unterstrichen)
  name                   einfaches Attribut
  multi telefon          mehrwertig
  derived alter          abgeleitet
  adresse { strasse, ort } zusammengesetzt
}
weak entity Raum { partial nr }

relationship arbeitet_in (Mitarbeiter n, Abteilung 1 total) {
  seit: date             Beziehungsattribut
}
relationship "ist Chef von" (Person 1 as Chef, Person n as Mitarbeiter)
identifying relationship hat (Gebäude 1, Raum n total)
relationship liefert (Lieferant (0,n), Teil (1,n), Projekt (0,n))

isa Person disjoint total { Student, Dozent }
isa Fahrzeug overlapping partial { Auto, Boot }

associative entity Belegung (Student n, Kurs m) { note }
note "Freitext"
# Kommentar`}</pre>
          ) : (
            <pre>{`table mitarbeiter {
  id         int pk
  name       varchar(100) not null
  email      varchar(255) unique
  chef_id    int -> mitarbeiter.id
}
table reinigung {
  mitarbeiter_id int pk -> mitarbeiter.id
  gehege_id      int pk [ref: > gehege.id]
  wochentag      varchar(10)
}
# Mehrere pk-Spalten = zusammengesetzter Schlüssel`}</pre>
          )}
        </div>
      )}
    </div>
  );
}
