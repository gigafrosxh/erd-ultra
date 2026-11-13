// SQL-DDL aus dem relationalen Schema erzeugen.

import type { RelSchema } from "./model";

export type SqlDialect = "postgres" | "mysql" | "sqlite" | "sqlserver";

export const DIALECT_LABELS: Record<SqlDialect, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  sqlite: "SQLite",
  sqlserver: "SQL Server",
};

// Häufige Schlüsselwörter, die in mindestens einem Dialekt reserviert sind und als Name maskiert werden müssen
const RESERVED = new Set(
  `add all alter and any as asc authorization begin between both by case cast check collate column commit constraint create cross
current current_date current_time current_timestamp current_user database date day default delete desc describe distinct do drop
else end except exec exists explain false fetch file for foreign from full function grant group having hour identity if in index
inner insert intersect interval into is join key keys leading left level like limit match merge minute month natural not null
of offset on only or order outer over partition percent plan position primary procedure public range rank read references
return returning revoke right rollback row rows schema second select session_user set show some table then time timestamp to
top trailing transaction trigger true union unique update usage user using value values view when where window with write year`.split(/\s+/),
);

/** Bezeichner für den Dialekt maskieren, falls nötig (Sonderzeichen oder reserviertes Wort) */
export function quoteIdent(name: string, dialect: SqlDialect = "postgres"): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name.toLowerCase())) return name;
  if (dialect === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  if (dialect === "sqlserver") return `[${name.replace(/]/g, "]]")}]`;
  return `"${name.replace(/"/g, '""')}"`;
}

/** Datentyp in die Schreibweise des Dialekts übersetzen */
export function mapType(type: string, dialect: SqlDialect): string {
  const t = type.trim().toLowerCase();
  const args = t.match(/\(.*\)$/)?.[0] ?? "";
  const base = t.replace(/\(.*\)$/, "").trim();
  if (dialect === "sqlite") {
    if (/int|bool|serial|bit/.test(base)) return "INTEGER";
    if (/dec|num|float|double|real/.test(base)) return "REAL";
    if (/blob|bytea|binary/.test(base)) return "BLOB";
    return "TEXT";
  }
  const bool = base === "boolean" || base === "bool" || base === "bit";
  if (dialect === "postgres") {
    if (bool) return "BOOLEAN";
    if (base === "tinyint") return "SMALLINT";
    if (base === "datetime" || base === "datetime2") return "TIMESTAMP";
    if (base === "double") return "DOUBLE PRECISION";
    if (base === "nvarchar") return `VARCHAR${args.toUpperCase() === "(MAX)" ? "" : args}`;
    if (base === "blob" || base === "varbinary" || base === "binary") return "BYTEA";
  } else if (dialect === "mysql") {
    if (bool) return "TINYINT(1)";
    if (base === "bytea") return "BLOB";
    if (base === "datetime2") return "DATETIME";
    if (base === "serial") return "INT AUTO_INCREMENT";
  } else if (dialect === "sqlserver") {
    if (bool) return "BIT";
    if (base === "text") return "NVARCHAR(MAX)";
    if (base === "timestamp") return "DATETIME2";
    if (base === "double" || base === "double precision") return "FLOAT";
    if (base === "serial") return "INT IDENTITY";
    if (base === "bytea" || base === "blob") return "VARBINARY(MAX)";
  }
  return type.toUpperCase();
}

export function schemaToSql(schema: RelSchema, dialect: SqlDialect = "postgres"): string {
  const q = (s: string) => quoteIdent(s, dialect);
  const out: string[] = [];
  const fks: string[] = [];
  for (const t of schema.tables) {
    const lines: string[] = [];
    for (const c of t.columns) {
      let l = `  ${q(c.name)} ${mapType(c.type, dialect)}`;
      if (c.notNull || c.pk) l += " NOT NULL";
      if (c.unique && !c.pk) l += " UNIQUE";
      lines.push(l);
    }
    const pk = t.columns.filter((c) => c.pk);
    if (pk.length) lines.push(`  PRIMARY KEY (${pk.map((c) => q(c.name)).join(", ")})`);
    // Fremdschlüssel gruppieren (zusammengesetzte Schlüssel)
    const groups: { table: string; cols: string[]; refs: string[] }[] = [];
    for (const c of t.columns) {
      if (!c.ref) continue;
      const target = schema.tables.find((x) => x.name === c.ref!.table);
      const targetPk = target ? target.columns.filter((x) => x.pk).length : 1;
      const g = groups[groups.length - 1];
      if (g && g.table === c.ref.table && g.cols.length < targetPk && !g.refs.includes(c.ref.column)) {
        g.cols.push(c.name);
        g.refs.push(c.ref.column);
      } else groups.push({ table: c.ref.table, cols: [c.name], refs: [c.ref.column] });
    }
    for (const g of groups) {
      const fk = `FOREIGN KEY (${g.cols.map(q).join(", ")}) REFERENCES ${q(g.table)} (${g.refs.map(q).join(", ")})`;
      if (dialect === "sqlite") lines.push(`  ${fk}`);
      else fks.push(`ALTER TABLE ${q(t.name)} ADD ${fk};`);
    }
    // Jede Zeile der Notiz einzeln auskommentieren, sonst landet ab der zweiten Zeile Text als SQL in der DDL
    const comment = t.note ? `${t.note.split(/\r\n|\r|\n/).map((l) => `-- ${l}`.trimEnd()).join("\n")}\n` : "";
    out.push(`${comment}CREATE TABLE ${q(t.name)} (\n${lines.join(",\n")}\n);`);
  }
  if (fks.length) out.push("", ...fks);
  return out.join("\n\n").replace(/\n\n\n+/g, "\n\n") + "\n";
}
