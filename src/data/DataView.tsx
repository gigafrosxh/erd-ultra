// Testdaten-Generator

import { useMemo, useState } from "react";
import type { RelSchema } from "../rel/model";
import { type SqlDialect, schemaToSql } from "../rel/sql";
import { Icon } from "../ui/Icon";
import { type Dataset, type GenOptions, datasetToSql, generateData, tableToCsv } from "./generator";

interface Props {
  schema: RelSchema;
  gen: GenOptions;
  dialect: SqlDialect;
  onGen: (g: GenOptions) => void;
  onSave: (name: string, data: string, kind: "sql" | "csv" | "json") => void;
  toast: (msg: string, kind?: "error" | "info") => void;
}

export function DataView({ schema, gen, dialect, onGen, onSave, toast }: Props) {
  const [current, setCurrent] = useState<string | null>(null);
  const [withDdl, setWithDdl] = useState(true);
  const data: Dataset = useMemo(() => generateData(schema, gen), [schema, gen]);
  const order = Object.keys(data);
  const cur = schema.tables.find((t) => t.name === (current && data[current] ? current : order[0]));
  const rows = cur ? data[cur.name] ?? [] : [];
  const total = order.reduce((s, k) => s + data[k].length, 0);

  const sql = () => (withDdl ? schemaToSql(schema, dialect) + "\n" : "") + datasetToSql(schema, data, dialect);

  if (!schema.tables.length) {
    return (
      <div className="data-view">
        <div className="empty-hint static">
          <Icon name="database" size={28} />
          <h2>Kein Schema vorhanden</h2>
          <p>Lege zuerst ein ER-Diagramm oder ein relationales Schema an. Die Testdaten werden dann automatisch passend zu Schlüsseln und Fremdschlüsseln erzeugt.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="data-view">
      <aside className="data-side">
        <h3>Einstellungen</h3>
        <label className="field">
          <span>Zeilen pro Tabelle</span>
          <input type="number" min={0} max={10000} value={gen.defaultRows} onChange={(e) => onGen({ ...gen, defaultRows: clamp(Number(e.target.value), 0, 10000) })} />
        </label>
        <label className="field">
          <span>Zufalls-Seed</span>
          <div className="input-row">
            <input type="number" value={gen.seed} onChange={(e) => onGen({ ...gen, seed: Number(e.target.value) || 0 })} />
            <button className="btn" title="Neue Daten" onClick={() => onGen({ ...gen, seed: Math.floor(Math.random() * 1e6) })}>
              <Icon name="refresh" size={15} />
            </button>
          </div>
        </label>
        <label className="field">
          <span>NULL-Anteil optionaler Spalten: {Math.round(gen.nullRate * 100)} %</span>
          <input type="range" min={0} max={0.6} step={0.05} value={gen.nullRate} onChange={(e) => onGen({ ...gen, nullRate: Number(e.target.value) })} />
        </label>
        <h4>Tabellen</h4>
        <div className="table-list">
          {order.map((name) => (
            <div key={name} className={`table-item ${cur?.name === name ? "on" : ""}`} onClick={() => setCurrent(name)}>
              <span className="grow">{name}</span>
              <input
                type="number"
                min={0}
                max={10000}
                title="Anzahl Zeilen"
                value={gen.rows[name] ?? gen.defaultRows}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onGen({ ...gen, rows: { ...gen.rows, [name]: clamp(Number(e.target.value), 0, 10000) } })}
              />
              <span className="muted tiny">{data[name].length}</span>
            </div>
          ))}
        </div>
        <p className="muted tiny">
          {total} Zeilen gesamt. Fremdschlüssel verweisen immer auf existierende Zeilen, Primärschlüssel sind eindeutig.
        </p>
        <h4>Export</h4>
        <label className="check">
          <input type="checkbox" checked={withDdl} onChange={(e) => setWithDdl(e.target.checked)} />
          CREATE TABLE mit exportieren
        </label>
        <div className="row-actions wrap">
          <button className="btn primary" onClick={() => onSave("testdaten.sql", sql(), "sql")}>
            <Icon name="download" size={15} /> SQL
          </button>
          <button className="btn" onClick={() => onSave("testdaten.json", JSON.stringify(data, null, 2), "json")}>
            <Icon name="download" size={15} /> JSON
          </button>
          {cur && (
            <button className="btn" onClick={() => onSave(`${cur.name}.csv`, tableToCsv(cur, rows), "csv")}>
              <Icon name="download" size={15} /> CSV ({cur.name})
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              navigator.clipboard?.writeText(sql());
              toast("SQL in die Zwischenablage kopiert", "info");
            }}
          >
            <Icon name="copy" size={15} /> Kopieren
          </button>
        </div>
      </aside>
      <section className="data-main">
        {cur && (
          <>
            <div className="pane-head">
              <Icon name="table" size={16} />
              <span>{cur.name}</span>
              <span className="muted small">{rows.length} Zeilen</span>
            </div>
            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th className="rownum">#</th>
                    {cur.columns.map((c) => (
                      <th key={c.name} title={c.type}>
                        <span className={c.pk ? "u" : ""}>{c.name}</span>
                        {c.ref && <em className="fk-tag">→ {c.ref.table}</em>}
                        <small>{c.type}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 500).map((r, i) => (
                    <tr key={i}>
                      <td className="rownum">{i + 1}</td>
                      {cur.columns.map((c) => {
                        const v = r[c.name];
                        return (
                          <td key={c.name} className={v === null ? "null" : typeof v === "number" ? "num" : ""}>
                            {v === null ? "NULL" : String(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 500 && <p className="muted small">Vorschau zeigt die ersten 500 Zeilen.</p>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const clamp = (v: number, a: number, b: number) => (Number.isFinite(v) ? Math.min(b, Math.max(a, Math.round(v))) : a);
