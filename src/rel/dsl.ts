// Relationen-DSL (an DBML angelehnt).
//
//   table mitarbeiter {
//     id int pk
//     name varchar(100) not null
//     vorgesetzter_id int -> mitarbeiter.id
//   }
//   table reinigung {
//     mitarbeiter_id int pk -> mitarbeiter.id
//     gehege_id int pk [ref: > gehege.id]
//   }

import { DslError, TokenStream, quoteName } from "../lib/lexer";
import { uid } from "../er/model";
import { type RelColumn, type RelSchema, type RelTable, tableHeight, tableWidth } from "./model";

export interface RelParseResult {
  schema: RelSchema;
  errors: DslError[];
}

const RESERVED = new Set(["table", "pk", "primary", "not", "null", "unique", "ref", "note"]);

export function parseRelDsl(src: string, previous?: RelSchema): RelParseResult {
  const ts = new TokenStream(src);
  const tables: RelTable[] = [];
  const errors: DslError[] = [...ts.lexErrors];

  const parseRef = (col: RelColumn) => {
    const t = ts.name("Tabellenname", false);
    if (!ts.accept(".", false)) throw new DslError('"." erwartet (tabelle.spalte)', ts.peek(false));
    const c = ts.name("Spaltenname", false);
    col.ref = { table: t.value, column: c.value };
  };

  const parseMods = (col: RelColumn, inBracket: boolean) => {
    for (;;) {
      const t = ts.peek(false);
      if (t.type === "nl" || t.type === "eof" || t.value === "}" || (!inBracket && t.value === ",")) return;
      if (inBracket && t.value === "]") return;
      const v = t.value.toLowerCase();
      if (t.value === "," && inBracket) {
        ts.next(false);
      } else if (t.value === "[") {
        ts.next(false);
        parseMods(col, true);
        ts.expect("]", false);
      } else if (v === "pk") {
        ts.next(false);
        col.pk = true;
      } else if (v === "primary") {
        ts.next(false);
        if (!ts.acceptKw("key", false)) throw new DslError('"key" erwartet', ts.peek(false));
        col.pk = true;
      } else if (v === "not") {
        ts.next(false);
        if (!ts.acceptKw("null", false)) throw new DslError('"null" erwartet', ts.peek(false));
        col.notNull = true;
      } else if (v === "null") {
        ts.next(false);
        col.notNull = false;
      } else if (v === "unique") {
        ts.next(false);
        col.unique = true;
      } else if (t.value === "!") {
        ts.next(false);
        col.notNull = true;
      } else if (t.value === "->" || t.value === ">") {
        ts.next(false);
        parseRef(col);
      } else if (v === "ref" || v === "references" || v === "fk") {
        ts.next(false);
        ts.accept(":", false);
        ts.accept(">", false);
        ts.accept("->", false);
        parseRef(col);
      } else if (v === "note") {
        ts.next(false);
        ts.accept(":", false);
        col.note = ts.name("Notiz", false).value;
      } else {
        throw new DslError(`Unbekannter Spaltenzusatz "${t.value}"`, t);
      }
    }
  };

  while (ts.peek().type !== "eof") {
    const start = ts.i;
    try {
      const t = ts.next();
      if (t.value === ";") continue;
      if (t.type !== "ident" || t.value.toLowerCase() !== "table") {
        throw new DslError(`"table" erwartet, aber "${t.value}" gefunden`, t);
      }
      const name = ts.name("Tabellenname").value;
      const table: RelTable = { id: uid("t"), name, x: NaN, y: NaN, columns: [] };
      if (ts.peek(false).type === "string") table.note = ts.next(false).value;
      ts.expect("{");
      while (!ts.is("}")) {
        if (ts.peek().type === "eof") throw new DslError('"}" erwartet', ts.peek());
        if (ts.accept(",") || ts.accept(";")) continue;
        if (ts.isKw("note")) {
          ts.next();
          ts.accept(":", false);
          table.note = ts.name("Notiz", false).value;
          continue;
        }
        const cn = ts.name("Spaltenname");
        const col: RelColumn = { name: cn.value, type: "varchar(100)" };
        const tt = ts.peek(false);
        if ((tt.type === "ident" && !["pk", "not", "null", "unique", "ref", "primary", "references", "fk", "note"].includes(tt.value.toLowerCase())) || tt.type === "string") {
          ts.next(false);
          let type = tt.value;
          if (ts.is("(", false)) {
            ts.next(false);
            const parts: string[] = [];
            while (!ts.is(")", false)) {
              const p = ts.next(false);
              if (p.type === "eof" || p.type === "nl") throw new DslError('")" erwartet', p);
              parts.push(p.value);
            }
            ts.next(false);
            type += `(${parts.join("")})`;
          }
          if (ts.is("[", false) && ts.toks[ts.i + 1]?.value === "]") {
            ts.next(false);
            ts.next(false);
            type += "[]";
          }
          col.type = type;
        }
        parseMods(col, false);
        if (col.pk && col.notNull === undefined) col.notNull = true;
        table.columns.push(col);
      }
      ts.expect("}");
      tables.push(table);
    } catch (e) {
      if (!(e instanceof DslError)) throw e;
      errors.push(e);
      if (ts.i === start) ts.i++;
      while (ts.toks[ts.i].type !== "eof") {
        const t = ts.toks[ts.i];
        const prev = ts.toks[ts.i - 1];
        if (prev?.type === "nl" && t.type === "ident" && t.value.toLowerCase() === "table") break;
        ts.i++;
      }
    }
  }

  // Positionen übernehmen
  const prev = new Map((previous?.tables ?? []).map((t) => [t.name, t]));
  for (const t of tables) {
    const old = prev.get(t.name);
    if (old) {
      t.id = old.id;
      t.x = old.x;
      t.y = old.y;
      t.color = old.color;
    }
  }
  layoutNewTables(tables);
  return { schema: { tables }, errors };
}

/** Tabellen ohne Position in einem Raster anordnen. */
export function layoutNewTables(tables: RelTable[], force = false): void {
  const placed = tables.filter((t) => Number.isFinite(t.x) && !force);
  const todo = tables.filter((t) => !Number.isFinite(t.x) || force);
  if (!todo.length) return;
  if (force || !placed.length) {
    // Tabellen mit vielen Referenzen in die Mitte: einfache Sortierung nach Abhängigkeit
    const depth = new Map<string, number>();
    const byName = new Map(tables.map((t) => [t.name, t]));
    const dep = (t: RelTable, seen = new Set<string>()): number => {
      if (depth.has(t.name)) return depth.get(t.name)!;
      if (seen.has(t.name)) return 0;
      seen.add(t.name);
      let d = 0;
      for (const c of t.columns) {
        const r = c.ref && byName.get(c.ref.table);
        if (r && r !== t) d = Math.max(d, dep(r, seen) + 1);
      }
      depth.set(t.name, d);
      return d;
    };
    const cols: RelTable[][] = [];
    for (const t of todo) (cols[dep(t)] ??= []).push(t);
    let x = 0;
    for (const col of cols) {
      if (!col) continue;
      let y = 0;
      for (const t of col) {
        t.x = x;
        t.y = y;
        y += tableHeight(t) + 60;
      }
      x += Math.max(...col.map(tableWidth)) + 120;
    }
    return;
  }
  const maxX = Math.max(...placed.map((t) => t.x + tableWidth(t)));
  let y = Math.min(...placed.map((t) => t.y));
  for (const t of todo) {
    t.x = maxX + 120;
    t.y = y;
    y += tableHeight(t) + 50;
  }
}

const q = (s: string) => quoteName(s, RESERVED);

export function serializeRelDsl(s: RelSchema): string {
  return (
    s.tables
      .map((t) => {
        const w = Math.max(4, ...t.columns.map((c) => q(c.name).length));
        const tw = Math.max(4, ...t.columns.map((c) => c.type.length));
        const lines = t.columns.map((c) => {
          const mods: string[] = [];
          if (c.pk) mods.push("pk");
          if (c.notNull && !c.pk) mods.push("not null");
          if (c.unique) mods.push("unique");
          if (c.ref) mods.push(`-> ${q(c.ref.table)}.${q(c.ref.column)}`);
          if (c.note) mods.push(`note: ${JSON.stringify(c.note)}`);
          const typ = /^[\p{L}_][\p{L}\p{N}_]*(\([^)]*\))?(\[\])?$/u.test(c.type) ? c.type : JSON.stringify(c.type);
          return `  ${q(c.name).padEnd(w)} ${typ.padEnd(tw)} ${mods.join(" ")}`.trimEnd();
        });
        const note = t.note ? ` ${JSON.stringify(t.note)}` : "";
        return `table ${q(t.name)}${note} {\n${lines.join("\n")}\n}`;
      })
      .join("\n\n") + "\n"
  );
}

/** Lehrbuch-Notation: tier(tier_id, name, ↑gehege_id) */
export function relNotation(s: RelSchema): { table: string; cols: { name: string; pk: boolean; fk: boolean }[] }[] {
  return s.tables.map((t) => ({
    table: t.name,
    cols: t.columns.map((c) => ({ name: c.name, pk: !!c.pk, fk: !!c.ref })),
  }));
}
