// Testdaten-Generator für relationale Schemas.

import { PHONE_NAME, ZIP_NAME, type RelColumn, type RelSchema, type RelTable } from "../rel/model";
import { type SqlDialect, quoteIdent } from "../rel/sql";

export type Value = string | number | boolean | null;
export type Row = Record<string, Value>;
export type Dataset = Record<string, Row[]>;

export interface GenOptions {
  seed: number;
  defaultRows: number;
  rows: Record<string, number>;
  /** Anteil NULL bei optionalen Spalten (0..1) */
  nullRate: number;
}

export const defaultGenOptions: GenOptions = { seed: 42, defaultRows: 10, rows: {}, nullRate: 0.1 };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VORNAMEN = ["Anna", "Ben", "Clara", "David", "Emma", "Felix", "Greta", "Hannah", "Jonas", "Lena", "Leon", "Mia", "Noah", "Paul", "Sophie", "Tim", "Lukas", "Marie", "Elias", "Laura", "Finn", "Lea", "Max", "Julia"];
const NACHNAMEN = ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz", "Hoffmann", "Koch", "Richter", "Klein", "Wolf", "Neumann", "Schwarz", "Braun", "Zimmermann", "Krüger", "Hartmann"];
const STAEDTE = ["Berlin", "Hamburg", "München", "Köln", "Frankfurt", "Stuttgart", "Düsseldorf", "Leipzig", "Dresden", "Wien", "Graz", "Zürich", "Bern", "Linz", "Bremen"];
const STRASSEN = ["Hauptstraße", "Schulstraße", "Gartenweg", "Bahnhofstraße", "Lindenallee", "Bergstraße", "Kirchgasse", "Ringstraße", "Waldweg", "Parkstraße"];
const TIERE = ["Leo", "Bella", "Simba", "Nala", "Coco", "Rocky", "Luna", "Kiki", "Bruno", "Polly", "Rex", "Mimi", "Zazu", "Balu", "Kaa"];
const ARTEN = ["Löwe", "Elefant", "Giraffe", "Zebra", "Pinguin", "Papagei", "Krokodil", "Python", "Adler", "Flamingo", "Tiger", "Gorilla"];
const FARBEN = ["rot", "blau", "grün", "gelb", "schwarz", "weiß", "braun", "grau", "orange"];
const WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const WOERTER = ["alpha", "beta", "gamma", "nord", "süd", "ost", "west", "neu", "alt", "groß", "klein", "zentral", "haupt", "neben"];
const FIRMEN = ["Muster GmbH", "Beispiel AG", "Nordlicht KG", "Alpen Logistik", "Sonnenschein GmbH", "Techwerk AG"];
const FELLARTEN = ["kurz", "lang", "dicht", "drahtig", "wollig", "glatt"];
const LOREM = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split(" ");

export function generateData(schema: RelSchema, opts: GenOptions = defaultGenOptions): Dataset {
  const rnd = mulberry32(opts.seed);
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const byName = new Map(schema.tables.map((t) => [t.name, t]));
  const data: Dataset = {};
  // Untertabellen (Schlüssel = Schlüssel der Obertabelle) teilen sich deren Zeilen ohne Überschneidung,
  // damit ein Datensatz bei disjunkter Spezialisierung nur in einer Untertabelle landet
  const takenParents = new Map<string, Set<string>>();

  // Topologische Reihenfolge (Referenzen zuerst)
  const order: RelTable[] = [];
  const state = new Map<string, number>();
  const visit = (t: RelTable) => {
    if (state.get(t.name) === 2 || state.get(t.name) === 1) return;
    state.set(t.name, 1);
    for (const c of t.columns) {
      const r = c.ref && byName.get(c.ref.table);
      if (r && r !== t) visit(r);
    }
    state.set(t.name, 2);
    order.push(t);
  };
  schema.tables.forEach(visit);

  for (const t of order) {
    const n = Math.max(0, opts.rows[t.name] ?? opts.defaultRows);
    const rows: Row[] = [];
    data[t.name] = rows;
    const pkCols = t.columns.filter((c) => c.pk);
    const pkSeen = new Set<string>();
    const uniqSeen = new Map<string, Set<string>>();

    // FK-Gruppen: Spalten, die gemeinsam auf eine (zusammengesetzte) PK zeigen
    const groups: { target: string; cols: RelColumn[] }[] = [];
    for (const c of t.columns) {
      if (!c.ref) continue;
      const target = byName.get(c.ref.table);
      const targetPkCount = target ? target.columns.filter((x) => x.pk).length : 1;
      const last = groups[groups.length - 1];
      if (last && last.target === c.ref.table && last.cols.length < targetPkCount && !last.cols.some((x) => x.ref!.column === c.ref!.column)) {
        last.cols.push(c);
      } else groups.push({ target: c.ref.table, cols: [c] });
    }

    const subtypeOf = groups.find((g) => g.target !== t.name && g.cols.length === pkCols.length && g.cols.every((c) => c.pk));
    const parentKey = (g: { cols: RelColumn[] }, src: Row) => JSON.stringify(g.cols.map((c) => src[c.ref!.column] ?? null));

    let attempts = 0;
    while (rows.length < n && attempts < n * 30) {
      attempts++;
      const i = rows.length;
      const row: Row = {};
      let exhausted = false;
      for (const g of groups) {
        let pool = g.target === t.name ? rows : data[g.target];
        if (g === subtypeOf && pool) {
          const taken = takenParents.get(g.target);
          if (taken) pool = pool.filter((r) => !taken.has(parentKey(g, r)));
          if (!pool.length) exhausted = true;
        }
        const optional = g.cols.every((c) => !c.notNull && !c.pk);
        if (!pool || !pool.length || (optional && rnd() < (g.target === t.name ? 0.3 : opts.nullRate))) {
          for (const c of g.cols) row[c.name] = null;
          continue;
        }
        const src = pick(pool);
        for (const c of g.cols) row[c.name] = src[c.ref!.column] ?? null;
      }
      if (exhausted) break;
      for (const c of t.columns) {
        if (c.ref) continue;
        if (!c.notNull && !c.pk && !c.unique && rnd() < opts.nullRate) {
          row[c.name] = null;
          continue;
        }
        row[c.name] = valueFor(c, t, i, pkCols.length === 1 && !!c.pk);
      }
      // Pflicht-FKs ohne Daten → Zeile ungültig
      if (t.columns.some((c) => c.ref && (c.notNull || c.pk) && row[c.name] === null && c.ref.table !== t.name && !data[c.ref.table]?.length)) break;
      if (pkCols.length) {
        const key = JSON.stringify(pkCols.map((c) => row[c.name]));
        if (pkSeen.has(key)) continue;
        pkSeen.add(key);
      }
      let dup = false;
      for (const c of t.columns.filter((c) => c.unique && !c.pk)) {
        const s = uniqSeen.get(c.name) ?? new Set<string>();
        uniqSeen.set(c.name, s);
        const k = JSON.stringify(row[c.name]);
        if (row[c.name] !== null && s.has(k)) dup = true;
        else s.add(k);
      }
      if (dup) continue;
      if (subtypeOf) {
        const taken = takenParents.get(subtypeOf.target) ?? new Set<string>();
        takenParents.set(subtypeOf.target, taken);
        taken.add(JSON.stringify(subtypeOf.cols.map((c) => row[c.name])));
      }
      rows.push(row);
    }
  }

  function valueFor(c: RelColumn, t: RelTable, i: number, seqPk: boolean): Value {
    const name = c.name.toLowerCase();
    const type = c.type.toLowerCase();
    const tname = t.name.toLowerCase();
    if (seqPk && /int|serial|number|numeric/.test(type)) return i + 1;
    if (/bool/.test(type) || /^ist_|^is_|^has_|faehig|fähig|giftig|aktiv/.test(name)) return /bool/.test(type) ? rnd() < 0.5 : rnd() < 0.5 ? 1 : 0;
    if (/char\(1\)/.test(type)) {
      const m = c.note?.match(/Typ:\s*(.*)$/);
      if (m) return pick(m[1].split(",").map((s) => s.trim().charAt(0).toUpperCase()));
      if (/geschlecht|gender/.test(name)) return pick(["m", "w", "d"]);
      return pick(["A", "B", "C"]);
    }
    if (/date|datum|geburt/.test(type) || (/date/.test(type) === false && /datum|geburt/.test(name) && !/int|char|text/.test(type))) {
      const year = /geburt/.test(name) ? int(1955, 2005) : int(2015, 2026);
      return `${year}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;
    }
    if (/timestamp|datetime/.test(type)) return `${int(2018, 2026)}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")} ${String(int(7, 19)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}:00`;
    if (/^time/.test(type)) return `${String(int(6, 20)).padStart(2, "0")}:${pick(["00", "15", "30", "45"])}:00`;
    if (/int|serial|number|numeric|decimal|float|double|real/.test(type)) return fitNumber(numberFor(c, name, type, i), type);
    return textFor(c, name, type, tname, i);
  }

  /** Zahl an den Wertebereich des Typs anpassen: decimal(p,s), tinyint, smallint */
  function fitNumber(v: number, type: string): number {
    const m = type.match(/(?:decimal|numeric|number)\s*\(\s*(\d+)\s*(?:,\s*(\d+))?\s*\)/);
    if (m) {
      const p = Number(m[1]);
      const sc = Number(m[2] ?? 0);
      const max = 10 ** (p - sc) - 10 ** -sc;
      if (Math.abs(v) > max) v = rnd() * max;
      const f = 10 ** sc;
      return Math.round(v * f) / f;
    }
    const max = /tinyint/.test(type) ? 127 : /smallint/.test(type) ? 32767 : Infinity;
    return v > max ? int(0, max) : v;
  }

  function numberFor(c: RelColumn, name: string, type: string, i: number): number {
    const dec = /decimal|numeric|float|double|real/.test(type);
    let v: number;
    if (/gehalt|lohn|salary/.test(name)) v = int(2200, 7500) + (dec ? int(0, 99) / 100 : 0);
    else if (/preis|price|kosten|betrag/.test(name)) v = int(1, 500) + (dec ? int(0, 99) / 100 : 0);
    else if (/plz|zip/.test(name)) return int(10000, 99999);
    else if (/jahr|year/.test(name)) return int(1990, 2026);
    else if (/alter|age/.test(name)) return int(1, 80);
    else if (/tragzeit/.test(name)) return int(20, 650);
    else if (/spannweite/.test(name)) return int(15, 300);
    else if (/temp/.test(name)) v = int(10, 30) + (dec ? int(0, 9) / 10 : 0);
    else if (/flaeche|fläche|groesse|größe/.test(name)) v = int(20, 5000);
    else if (/matrikel/.test(name)) return 100000 + i * 7 + int(0, 6);
    else if (c.pk || c.unique) return i + 1;
    else v = int(1, 100) + (dec ? int(0, 99) / 100 : 0);
    return dec ? Math.round(v * 100) / 100 : Math.round(v);
  }

  function textFor(c: RelColumn, name: string, type: string, tname: string, i: number): string {
    const persony = /person|mitarbeiter|kunde|student|pfleger|lehrer|angestellt|user|benutzer|employee|customer|patient|arzt/.test(tname);
    let s: string;
    if (/vorname|first/.test(name)) s = pick(VORNAMEN);
    else if (/nachname|last|familienname/.test(name)) s = pick(NACHNAMEN);
    else if (/email|mail/.test(name)) s = `${pick(VORNAMEN).toLowerCase()}.${pick(NACHNAMEN).toLowerCase().replace(/ü/g, "ue").replace(/ö/g, "oe").replace(/ä/g, "ae")}${int(1, 99)}@example.com`;
    else if (ZIP_NAME.test(name)) s = String(int(1067, 99998)).padStart(5, "0");
    else if (PHONE_NAME.test(name)) s = `+49 ${int(150, 179)} ${int(1000000, 9999999)}`;
    else if (/strasse|straße|street/.test(name)) s = `${pick(STRASSEN)} ${int(1, 120)}`;
    else if (/ort|stadt|city|wohnort/.test(name)) s = pick(STAEDTE);
    else if (/land|country/.test(name)) s = pick(["Deutschland", "Österreich", "Schweiz"]);
    else if (/wochentag|weekday/.test(name)) s = pick(WOCHENTAGE);
    else if (/farbe|color/.test(name)) s = pick(FARBEN);
    else if (/fell/.test(name)) s = pick(FELLARTEN);
    else if (/art$|^art|spezies|species|rasse/.test(name)) s = pick(ARTEN);
    else if (/firma|company|unternehmen/.test(name)) s = pick(FIRMEN);
    else if (/beschreibung|text|notiz|kommentar|description|bemerkung/.test(name)) s = Array.from({ length: int(4, 9) }, () => pick(LOREM)).join(" ");
    else if (/name|bezeichnung|titel|title/.test(name)) {
      if (/tier|animal/.test(tname) || /säuge|saeuge|vogel|reptil/.test(tname)) s = pick(TIERE);
      else if (persony) s = `${pick(VORNAMEN)} ${pick(NACHNAMEN)}`;
      else s = `${capitalize(tname)} ${capitalize(pick(WOERTER))} ${i + 1}`;
    } else s = `${c.name}_${i + 1}`;
    const max = Number(type.match(/\((\d+)\)/)?.[1] ?? 0);
    if (max && s.length > max) s = s.slice(0, max);
    return s;
  }
  return data;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function sqlLiteral(v: Value, dialect: SqlDialect = "postgres"): string {
  if (v === null) return "NULL";
  if (typeof v === "boolean") return dialect === "sqlserver" || dialect === "sqlite" ? (v ? "1" : "0") : v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  const s = `'${v.replace(/'/g, "''")}'`;
  return dialect === "sqlserver" && /[^\x00-\x7f]/.test(v) ? `N${s}` : s;
}

export function datasetToSql(schema: RelSchema, data: Dataset, dialect: SqlDialect = "postgres"): string {
  const q = (s: string) => quoteIdent(s, dialect);
  const out: string[] = [];
  const names = Object.keys(data); // bereits in topologischer Reihenfolge
  for (const tn of names) {
    const t = schema.tables.find((x) => x.name === tn);
    const rows = data[tn];
    if (!t || !rows.length) continue;
    const cols = t.columns.map((c) => q(c.name));
    out.push(`-- ${tn}`);
    out.push(`INSERT INTO ${q(tn)} (${cols.join(", ")}) VALUES`);
    out.push(rows.map((r) => `  (${t.columns.map((c) => sqlLiteral(r[c.name] ?? null, dialect)).join(", ")})`).join(",\n") + ";");
    out.push("");
  }
  return out.join("\n");
}

export function csvEscape(v: Value): string {
  if (v === null) return "";
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tableToCsv(t: RelTable, rows: Row[], sep = ","): string {
  const head = t.columns.map((c) => csvEscape(c.name)).join(sep);
  return [head, ...rows.map((r) => t.columns.map((c) => csvEscape(r[c.name] ?? null)).join(sep))].join("\n") + "\n";
}
