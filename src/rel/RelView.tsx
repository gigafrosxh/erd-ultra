// Arbeitsbereich für relationale Schemas.

import { useEffect, useRef, useState } from "react";
import { DslHelp } from "../er/ErView";
import { uid } from "../er/model";
import { CodeEditor, type CodeError, REL_LANG } from "../ui/CodeEditor";
import { Icon } from "../ui/Icon";
import { SplitPane } from "../ui/SplitPane";
import { useViewport } from "../ui/viewport";
import { layoutNewTables, parseRelDsl, serializeRelDsl } from "./dsl";
import { type InheritanceStrategy, type MappingOptions, STRATEGY_LABELS } from "./mapping";
import { type RelColumn, type RelSchema, type RelTable, tableHeight, tableWidth } from "./model";
import { REL_DARK, REL_LIGHT, RelShapes, relBounds, rowY } from "./RelSvg";
import { DIALECT_LABELS, type SqlDialect, schemaToSql } from "./sql";

interface Props {
  schema: RelSchema;
  text: string;
  dark: boolean;
  mapping: MappingOptions;
  autoSync: boolean;
  dialect: SqlDialect;
  warnings: string[];
  active: boolean;
  fitSignal: number;
  onSchema: (s: RelSchema, text: string, mergeKey?: string) => void;
  onText: (text: string, s: RelSchema | null) => void;
  onMapping: (m: MappingOptions) => void;
  onAutoSync: (v: boolean) => void;
  onGenerate: () => void;
  onDialect: (d: SqlDialect) => void;
  onExportSql: () => void;
  toast: (msg: string, kind?: "error" | "info") => void;
  registerFit: (fn: () => void) => void;
}

type Mode =
  | { kind: "none" }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: "drag"; id: string; ox: number; oy: number; wx: number; wy: number; key: string }
  | { kind: "connect"; table: string; col: number; x: number; y: number };

const TYPES = ["int", "bigint", "serial", "varchar(50)", "varchar(100)", "varchar(255)", "char(1)", "text", "date", "time", "timestamp", "boolean", "decimal(10,2)", "float"];
const COLORS = ["", "#2563eb", "#0891b2", "#059669", "#65a30d", "#d97706", "#dc2626", "#db2777", "#7c3aed", "#475569"];

export function RelView(p: Props) {
  const { schema, text, dark } = p;
  const pal = dark ? REL_DARK : REL_LIGHT;
  const svgRef = useRef<SVGSVGElement>(null);
  const { view, setView, toWorld, zoomAt, fit } = useViewport(svgRef);
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [selected, setSelected] = useState<string | null>(null);
  const [errors, setErrors] = useState<CodeError[]>([]);
  const [tab, setTab] = useState<"diagram" | "notation" | "sql">("diagram");
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  const change = (s: RelSchema, key?: string) => p.onSchema(s, serializeRelDsl(s), key);
  const doFit = () => fit(relBounds(schemaRef.current), 1.1);
  useEffect(() => p.registerFit(doFit));
  // Einpassen, sobald die Ansicht sichtbar ist (bei verstecktem Tab ist die Fläche 0×0)
  const fittedFor = useRef(-1);
  useEffect(() => {
    if (!p.active || fittedFor.current === p.fitSignal) return;
    fittedFor.current = p.fitSignal;
    setTimeout(doFit, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fitSignal, p.active]);

  const parseTimer = useRef<number | undefined>(undefined);
  const onCode = (src: string) => {
    window.clearTimeout(parseTimer.current);
    p.onText(src, null);
    parseTimer.current = window.setTimeout(() => {
      const r = parseRelDsl(src, schemaRef.current);
      setErrors(r.errors.map((e) => ({ message: e.message, from: e.from, to: e.to })));
      if (!r.errors.length) p.onText(src, r.schema);
    }, 280);
  };

  const patchTable = (id: string, fn: (t: RelTable) => RelTable, key?: string) => {
    const old = schema.tables.find((t) => t.id === id);
    if (!old) return;
    const next = fn(old);
    // Umbenennungen in Fremdschlüsseln nachziehen
    const renamedCols = new Map<string, string>();
    if (next.columns.length === old.columns.length) old.columns.forEach((c, i) => c.name !== next.columns[i].name && renamedCols.set(c.name, next.columns[i].name));
    const fix = (c: RelColumn): RelColumn =>
      c.ref?.table === old.name ? { ...c, ref: { table: next.name, column: renamedCols.get(c.ref.column) ?? c.ref.column } } : c;
    change({ tables: schema.tables.map((t) => (t.id === id ? { ...next, columns: next.columns.map(fix) } : { ...t, columns: t.columns.map(fix) })) }, key);
  };

  const addTable = (x?: number, y?: number) => {
    let name = "tabelle";
    let i = 2;
    while (schema.tables.some((t) => t.name === name)) name = `tabelle_${i++}`;
    const t: RelTable = { id: uid("t"), name, x: x ?? NaN, y: y ?? NaN, columns: [{ name: "id", type: "int", pk: true, notNull: true }] };
    const tables = [...schema.tables, t];
    if (!Number.isFinite(t.x)) layoutNewTables(tables);
    change({ tables });
    setSelected(t.id);
  };

  const deleteTable = (id: string) => {
    const t = schema.tables.find((x) => x.id === id);
    if (!t) return;
    change({
      tables: schema.tables
        .filter((x) => x.id !== id)
        .map((x) => ({ ...x, columns: x.columns.map((c) => (c.ref?.table === t.name ? { ...c, ref: undefined } : c)) })),
    });
    setSelected(null);
  };

  useEffect(() => {
    if (!p.active || tab !== "diagram") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, .cm-editor")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        deleteTable(selected);
      } else if (e.key === "0") doFit();
      else if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const target = e.target as Element;
    const w = toWorld(e.clientX, e.clientY);
    const handle = target.closest("[data-colhandle]")?.getAttribute("data-colhandle");
    if (handle) {
      const [tid, idx] = handle.split(":");
      setMode({ kind: "connect", table: tid, col: Number(idx), x: w.x, y: w.y });
      return;
    }
    const tid = target.closest("[data-table]")?.getAttribute("data-table");
    if (tid) {
      setSelected(tid);
      const t = schema.tables.find((x) => x.id === tid)!;
      setMode({ kind: "drag", id: tid, ox: t.x, oy: t.y, wx: w.x, wy: w.y, key: `tdrag-${Date.now()}` });
      return;
    }
    setMode({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    if (mode.kind === "pan") {
      setView((v) => ({ ...v, x: mode.vx + e.clientX - mode.sx, y: mode.vy + e.clientY - mode.sy }));
      if (!mode.moved && Math.abs(e.clientX - mode.sx) + Math.abs(e.clientY - mode.sy) > 3) setMode({ ...mode, moved: true });
    } else if (mode.kind === "drag") {
      const s = schemaRef.current;
      change({ tables: s.tables.map((t) => (t.id === mode.id ? { ...t, x: Math.round(mode.ox + w.x - mode.wx), y: Math.round(mode.oy + w.y - mode.wy) } : t)) }, mode.key);
    } else if (mode.kind === "connect") setMode({ ...mode, x: w.x, y: w.y });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (mode.kind === "pan" && !mode.moved) setSelected(null);
    if (mode.kind === "connect") {
      const w = toWorld(e.clientX, e.clientY);
      const target = schema.tables.find((t) => w.x >= t.x && w.x <= t.x + tableWidth(t) && w.y >= t.y && w.y <= t.y + tableHeight(t));
      const src = schema.tables.find((t) => t.id === mode.table);
      if (target && src) {
        // Zielspalte: angezeigte Zeile oder erster Primärschlüssel
        const idx = Math.floor((w.y - target.y - 34) / 26);
        let col = target.columns[idx];
        if (!col || !col.pk) col = target.columns.find((c) => c.pk) ?? col;
        if (col) {
          patchTable(src.id, (t) => ({ ...t, columns: t.columns.map((c, i) => (i === mode.col ? { ...c, ref: { table: target.name, column: col!.name } } : c)) }));
          p.toast(`${src.name}.${src.columns[mode.col].name} → ${target.name}.${col.name}`, "info");
        }
      }
    }
    setMode({ kind: "none" });
  };

  const sel = schema.tables.find((t) => t.id === selected);

  const toolbar = (
    <div className="rel-toolbar">
      <div className="seg small">
        <button className={tab === "diagram" ? "on" : ""} onClick={() => setTab("diagram")}>
          <Icon name="diagram" size={15} /> Diagramm
        </button>
        <button className={tab === "notation" ? "on" : ""} onClick={() => setTab("notation")}>
          <Icon name="book" size={15} /> Notation
        </button>
        <button className={tab === "sql" ? "on" : ""} onClick={() => setTab("sql")}>
          <Icon name="database" size={15} /> SQL
        </button>
      </div>
      <span className="grow" />
      <label className="inline-field" title="Abbildung von Generalisierung/Spezialisierung">
        <span>Vererbung</span>
        <select value={p.mapping.inheritance} onChange={(e) => p.onMapping({ ...p.mapping, inheritance: e.target.value as InheritanceStrategy })}>
          {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="check compact" title="Schema bei jeder Änderung am ER-Diagramm neu erzeugen">
        <input type="checkbox" checked={p.autoSync} onChange={(e) => p.onAutoSync(e.target.checked)} />
        Auto-Sync
      </label>
      <button className="btn primary" onClick={p.onGenerate} title="Relationales Schema aus dem ER-Diagramm erzeugen">
        <Icon name="refresh" size={15} /> Aus ER erzeugen
      </button>
      <button className="btn" onClick={() => addTable()}>
        <Icon name="plus" size={15} /> Tabelle
      </button>
    </div>
  );

  const diagram = (
    <div className="er-canvas-wrap">
      <svg ref={svgRef} className="canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDoubleClick={(e) => {
        const real = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
        if (real.closest("[data-table]")) return;
        const w = toWorld(e.clientX, e.clientY);
        addTable(Math.round(w.x), Math.round(w.y));
      }}>
        <defs>
          <pattern id="rel-grid" width={24 * view.k} height={24 * view.k} patternUnits="userSpaceOnUse" x={view.x % (24 * view.k)} y={view.y % (24 * view.k)}>
            <circle cx={1} cy={1} r={1} fill={dark ? "#1e293b" : "#d8dee9"} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#rel-grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <RelShapes schema={schema} pal={pal} selected={selected} />
          {mode.kind === "connect" &&
            (() => {
              const t = schema.tables.find((x) => x.id === mode.table)!;
              return <line x1={t.x + tableWidth(t)} y1={rowY(t, mode.col)} x2={mode.x} y2={mode.y} stroke={pal.select} strokeWidth={2} strokeDasharray="6 4" />;
            })()}
        </g>
      </svg>
      <div className="zoom-controls">
        <button title="Verkleinern" onClick={() => zoomAt(1 / 1.2)}>
          <Icon name="zoomOut" size={16} />
        </button>
        <button title="Alles anzeigen (0)" onClick={doFit}>
          <Icon name="fit" size={16} />
        </button>
        <button title="Vergrößern" onClick={() => zoomAt(1.2)}>
          <Icon name="zoomIn" size={16} />
        </button>
        <span className="sep" />
        <button
          title="Automatisch anordnen"
          onClick={() => {
            const tables = structuredClone(schema.tables);
            layoutNewTables(tables, true);
            change({ tables });
            setTimeout(doFit, 30);
          }}
        >
          <Icon name="layout" size={16} />
        </button>
      </div>
      {schema.tables.length === 0 && (
        <div className="empty-hint">
          <Icon name="table" size={28} />
          <h2>Noch keine Tabellen</h2>
          <p>Erzeuge das Schema mit „Aus ER erzeugen“, schreibe es rechts als Code oder lege per Doppelklick eine Tabelle an.</p>
        </div>
      )}
      {p.warnings.length > 0 && (
        <div className="warnings">
          {p.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
      {sel ? (
        <div className="props-float">
          <TableProps t={sel} schema={schema} patch={(fn, key) => patchTable(sel.id, fn, key)} onDelete={() => deleteTable(sel.id)} />
        </div>
      ) : (
        <div className="props-toggle static">
          <SchemaInfo schema={schema} />
        </div>
      )}
    </div>
  );

  const notation = (
    <div className="notation">
      <h3>Relationales Schema</h3>
      <p className="muted small">
        <span className="u">Primärschlüssel</span> unterstrichen, Fremdschlüssel als <span className="fk">spalte→tabelle</span>
      </p>
      {schema.tables.map((t) => (
        <div key={t.id} className="notation-row">
          <b>{t.name}</b>(
          {t.columns.map((c, i) => (
            <span key={i}>
              {i > 0 && ", "}
              <span className={`${c.pk ? "u" : ""} ${c.ref ? "fk" : ""}`} title={c.ref ? `→ ${c.ref.table}.${c.ref.column}` : c.type}>
                {c.name}
                {c.ref ? `→${c.ref.table}` : ""}
              </span>
            </span>
          ))}
          )
        </div>
      ))}
      {schema.tables.some((t) => t.columns.some((c) => c.ref)) && (
        <>
          <h4>Fremdschlüssel</h4>
          {schema.tables.flatMap((t) =>
            t.columns
              .filter((c) => c.ref)
              .map((c) => (
                <div key={`${t.id}${c.name}`} className="muted small mono">
                  {t.name}.{c.name} → {c.ref!.table}.{c.ref!.column}
                </div>
              )),
          )}
        </>
      )}
    </div>
  );

  const sqlText = schemaToSql(schema, p.dialect);
  const sql = (
    <div className="sql-view">
      <div className="rel-toolbar">
        <label className="inline-field">
          <span>Dialekt</span>
          <select value={p.dialect} onChange={(e) => p.onDialect(e.target.value as SqlDialect)}>
            {Object.entries(DIALECT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <span className="grow" />
        <button
          className="btn"
          onClick={() => {
            navigator.clipboard?.writeText(sqlText);
            p.toast("SQL kopiert", "info");
          }}
        >
          <Icon name="copy" size={15} /> Kopieren
        </button>
        <button className="btn" onClick={p.onExportSql}>
          <Icon name="download" size={15} /> .sql speichern
        </button>
      </div>
      <pre className="code-block">{sqlText}</pre>
    </div>
  );

  return (
    <div className="rel-view">
      {toolbar}
      <SplitPane storageKey="rel-split" initial={0.66}>
        {tab === "diagram" ? diagram : tab === "notation" ? notation : sql}
        <div className="code-pane">
          <div className="pane-head">
            <Icon name="code" size={16} />
            <span>Schema-Code</span>
            <span className="grow" />
            {errors.length > 0 ? <span className="badge error">{errors.length} Fehler</span> : <span className="badge ok">synchron</span>}
            <DslHelp kind="rel" />
          </div>
          <CodeEditor value={text} onChange={onCode} errors={errors} language={REL_LANG} placeholderText={"table kunde {\n  id int pk\n  name varchar(100) not null\n}"} />
        </div>
      </SplitPane>
    </div>
  );
}

function SchemaInfo({ schema }: { schema: RelSchema }) {
  const cols = schema.tables.reduce((s, t) => s + t.columns.length, 0);
  const fks = schema.tables.reduce((s, t) => s + t.columns.filter((c) => c.ref).length, 0);
  return (
    <div className="props">
      <h3>Schema</h3>
      <p className="muted small">
        {schema.tables.length} Tabellen · {cols} Spalten · {fks} Fremdschlüssel
      </p>
      <p className="muted tiny">Tabelle anklicken zum Bearbeiten · vom rechten Spaltenrand auf eine Tabelle ziehen = Fremdschlüssel · Doppelklick = neue Tabelle</p>
    </div>
  );
}

function TableProps({ t, schema, patch, onDelete }: { t: RelTable; schema: RelSchema; patch: (fn: (t: RelTable) => RelTable, key?: string) => void; onDelete: () => void }) {
  const setCol = (i: number, c: Partial<RelColumn>, key?: string) => patch((x) => ({ ...x, columns: x.columns.map((col, j) => (j === i ? { ...col, ...c } : col)) }), key);
  const move = (i: number, d: number) =>
    patch((x) => {
      const cols = [...x.columns];
      const j = i + d;
      if (j < 0 || j >= cols.length) return x;
      [cols[i], cols[j]] = [cols[j], cols[i]];
      return { ...x, columns: cols };
    });
  return (
    <div className="props wide">
      <h3>Tabelle</h3>
      <label className="field">
        <span>Name</span>
        <input value={t.name} onChange={(e) => patch((x) => ({ ...x, name: e.target.value }), `tname-${t.id}`)} />
      </label>
      <div className="colors">
        {COLORS.map((c) => (
          <button key={c || "default"} className={`swatch ${(t.color ?? "") === c ? "on" : ""}`} style={{ background: c || "var(--accent)" }} title={c ? c : "Standard"} onClick={() => patch((x) => ({ ...x, color: c || undefined }))} />
        ))}
      </div>
      <div className="col-editor">
        <div className="col-head">
          <span>Spalte</span>
          <span>Typ</span>
          <span title="Primärschlüssel">PK</span>
          <span title="NOT NULL">NN</span>
          <span title="UNIQUE">UQ</span>
          <span />
        </div>
        {t.columns.map((c, i) => (
          <div key={i} className="col-row-wrap">
            <div className="col-row">
              <input value={c.name} onChange={(e) => setCol(i, { name: e.target.value }, `cname-${t.id}-${i}`)} />
              <input list="sql-types" value={c.type} onChange={(e) => setCol(i, { type: e.target.value }, `ctype-${t.id}-${i}`)} />
              <input type="checkbox" checked={!!c.pk} onChange={(e) => setCol(i, { pk: e.target.checked || undefined, notNull: e.target.checked || c.notNull })} />
              <input type="checkbox" checked={!!c.notNull || !!c.pk} disabled={c.pk} onChange={(e) => setCol(i, { notNull: e.target.checked || undefined })} />
              <input type="checkbox" checked={!!c.unique} onChange={(e) => setCol(i, { unique: e.target.checked || undefined })} />
              <span className="col-btns">
                <button className="icon-btn" title="Nach oben" onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="icon-btn" title="Entfernen" onClick={() => patch((x) => ({ ...x, columns: x.columns.filter((_, j) => j !== i) }))}>
                  <Icon name="x" size={13} />
                </button>
              </span>
            </div>
            <div className="col-ref">
              <span>FK →</span>
              <select
                value={c.ref ? `${c.ref.table}.${c.ref.column}` : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return setCol(i, { ref: undefined });
                  const [table, ...rest] = v.split(".");
                  setCol(i, { ref: { table, column: rest.join(".") } });
                }}
              >
                <option value="">kein Fremdschlüssel</option>
                {schema.tables.flatMap((x) =>
                  x.columns
                    .filter((col) => col.pk || col.unique)
                    .map((col) => (
                      <option key={`${x.id}.${col.name}`} value={`${x.name}.${col.name}`}>
                        {x.name}.{col.name}
                      </option>
                    )),
                )}
              </select>
            </div>
          </div>
        ))}
        <datalist id="sql-types">
          {TYPES.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </div>
      <div className="row-actions">
        <button className="btn" onClick={() => patch((x) => ({ ...x, columns: [...x.columns, { name: `spalte${x.columns.length + 1}`, type: "varchar(100)" }] }))}>
          <Icon name="plus" size={15} /> Spalte
        </button>
        <button className="btn danger" onClick={onDelete}>
          <Icon name="trash" size={15} /> Tabelle löschen
        </button>
      </div>
    </div>
  );
}
