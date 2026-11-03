// SQL-DDL aus dem relationalen Schema erzeugen.

import { type RelSchema, sqlIdent } from "./model";

export type SqlDialect = "postgres" | "mysql" | "sqlite" | "sqlserver";

export const DIALECT_LABELS: Record<SqlDialect, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  sqlite: "SQLite",
  sqlserver: "SQL Server",
};

function mapType(type: string, dialect: SqlDialect): string {
  const t = type.toLowerCase();
  if (dialect === "sqlite") {
    if (/int|bool/.test(t)) return "INTEGER";
    if (/dec|num|float|double|real/.test(t)) return "REAL";
    return "TEXT";
  }
  if (t === "boolean" || t === "bool") return dialect === "sqlserver" ? "BIT" : dialect === "mysql" ? "TINYINT(1)" : "BOOLEAN";
  if (t === "text" && dialect === "sqlserver") return "NVARCHAR(MAX)";
  if (t === "timestamp" && dialect === "sqlserver") return "DATETIME2";
  return type.toUpperCase();
}

export function schemaToSql(schema: RelSchema, dialect: SqlDialect = "postgres"): string {
  const q = (s: string) => (dialect === "mysql" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? `\`${s}\`` : sqlIdent(s));
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
    const comment = t.note ? `-- ${t.note}\n` : "";
    out.push(`${comment}CREATE TABLE ${q(t.name)} (\n${lines.join(",\n")}\n);`);
  }
  if (fks.length) out.push("", ...fks);
  return out.join("\n\n").replace(/\n\n\n+/g, "\n\n") + "\n";
}
