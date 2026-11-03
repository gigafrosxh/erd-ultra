// Relationales Schema

export interface RelRef {
  table: string;
  column: string;
}

export interface RelColumn {
  name: string;
  type: string;
  pk?: boolean;
  notNull?: boolean;
  unique?: boolean;
  ref?: RelRef;
  note?: string;
}

export interface RelTable {
  id: string;
  name: string;
  x: number;
  y: number;
  columns: RelColumn[];
  /** Kopfzeilenfarbe */
  color?: string;
  note?: string;
}

export interface RelSchema {
  tables: RelTable[];
}

export function emptySchema(): RelSchema {
  return { tables: [] };
}

export const TABLE_W = 250;
export const ROW_H = 26;
export const HEAD_H = 34;

export function tableHeight(t: RelTable): number {
  return HEAD_H + Math.max(1, t.columns.length) * ROW_H + 6;
}

export function tableWidth(t: RelTable): number {
  const longest = Math.max(t.name.length * 9, ...t.columns.map((c) => (c.name.length + c.type.length) * 7.4 + 70));
  return Math.max(TABLE_W, Math.ceil(longest / 10) * 10);
}

/** Datentyp anhand des Spaltennamens erraten */
export function guessType(name: string): string {
  const n = name.toLowerCase();
  if (/(^id$|_id$|^id_|nr$|_nr|nummer|^anzahl|menge|alter$|jahr$|tage$|_cm$|_kg$|_c$|^count|^qty|stock|plz$)/.test(n)) {
    if (n.endsWith("_c")) return "decimal(5,1)";
    return "int";
  }
  if (/(datum|date|geburt|_am$|^seit|^bis|tag$)/.test(n)) return n.includes("wochentag") ? "varchar(10)" : "date";
  if (/(zeit|time|uhr)/.test(n)) return "time";
  if (/(preis|gehalt|betrag|kosten|lohn|price|salary|amount|gewicht)/.test(n)) return "decimal(10,2)";
  if (/(^ist_|^is_|^has_|faehig|fähig|giftig|aktiv|flag)/.test(n)) return "boolean";
  if (/(typ$|type$|geschlecht)/.test(n)) return "char(1)";
  if (/(beschreibung|text|notiz|kommentar|description)/.test(n)) return "text";
  if (/(email|mail)/.test(n)) return "varchar(255)";
  return "varchar(100)";
}

export function sqlIdent(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

/** Bezeichner für SQL normalisieren: Umlaute ersetzen, Leerzeichen → _ */
export function toSqlName(name: string): string {
  return name
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "_$1");
}
