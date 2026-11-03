// Abbildung ER-Diagramm → relationales Schema.

import { type ErAttribute, type ErDiagram, type ErEdge, type ErEntity, type ErNode, uid } from "../er/model";
import { layoutNewTables } from "./dsl";
import { type RelColumn, type RelSchema, type RelTable, guessType, toSqlName } from "./model";

/**
 * Strategien für Generalisierung/Spezialisierung:
 * - vertical:   Tabelle je Klasse, Untertabellen erben nur den Schlüssel (FK auf Obertabelle)
 * - horizontal: Tabelle je Klasse, Untertabellen enthalten alle geerbten Attribute
 * - perSubtype: nur Tabellen für Untertypen (mit allen geerbten Attributen), keine Obertabelle
 * - single:     eine Tabelle für die gesamte Hierarchie mit Typ-Spalte
 */
export type InheritanceStrategy = "vertical" | "horizontal" | "perSubtype" | "single";

export const STRATEGY_LABELS: Record<InheritanceStrategy, string> = {
  vertical: "Vertical Mapping (Tabelle je Klasse, FK auf Oberklasse)",
  horizontal: "Horizontal Mapping (Tabelle je Klasse, alle Attribute)",
  perSubtype: "Table per Sub-Entity-Type (nur Untertypen)",
  single: "Single Table (eine Tabelle mit Typ-Spalte)",
};

export interface MappingOptions {
  inheritance: InheritanceStrategy;
  /** Namen in snake_case / ohne Umlaute umwandeln */
  sqlNames: boolean;
  /** Tabellennamen klein schreiben */
  lowercase: boolean;
}

export const defaultMappingOptions: MappingOptions = { inheritance: "vertical", sqlNames: true, lowercase: true };

export interface MappingResult {
  schema: RelSchema;
  warnings: string[];
}

interface Col extends RelColumn {}

const isOne = (card: string | undefined): boolean => {
  if (!card) return false;
  const c = card.replace(/\s/g, "").toLowerCase();
  if (c === "1" || c === "0..1" || c === "1..1") return true;
  const m = c.match(/^\(?(\w+|\*)[,.]+(\w+|\*)\)?$/);
  if (m) return m[2] === "1";
  return false;
};

/** (min,max)-Notation: Kardinalität beschreibt die Teilnahme der Entität selbst */
const isMinMax = (card: string | undefined) => !!card && /[(,]|\.\./.test(card);

export function mapErToRelational(d: ErDiagram, opts: MappingOptions = defaultMappingOptions): MappingResult {
  const warnings: string[] = [];
  const byId = new Map<string, ErNode>(d.nodes.map((n) => [n.id, n]));
  const nm = (s: string) => {
    let r = opts.sqlNames ? toSqlName(s) : s;
    if (opts.lowercase) r = r.toLowerCase();
    return r || "unbenannt";
  };

  const attrsOf = (ownerId: string): ErAttribute[] =>
    d.edges
      .filter((e) => e.kind === "attr" && e.to === ownerId)
      .map((e) => byId.get(e.from))
      .filter((n): n is ErAttribute => !!n && n.kind === "attribute");

  /** Zusammengesetzte Attribute auflösen → Blätter */
  const flatten = (a: ErAttribute, prefix = ""): { attr: ErAttribute; name: string }[] => {
    const kids = attrsOf(a.id);
    if (!kids.length) return [{ attr: a, name: prefix + a.name }];
    return kids.flatMap((k) => flatten({ ...k, attrKind: a.attrKind === "key" && k.attrKind === "normal" ? "key" : k.attrKind }, ""));
  };

  const simpleCols = (ownerId: string): { cols: Col[]; multi: ErAttribute[] } => {
    const cols: Col[] = [];
    const multi: ErAttribute[] = [];
    for (const a of attrsOf(ownerId)) {
      if (a.attrKind === "derived") continue;
      if (a.attrKind === "multivalued") {
        multi.push(a);
        continue;
      }
      for (const leaf of flatten(a)) {
        if (leaf.attr.attrKind === "derived") continue;
        if (leaf.attr.attrKind === "multivalued") {
          multi.push(leaf.attr);
          continue;
        }
        const key = leaf.attr.attrKind === "key" || leaf.attr.attrKind === "partial";
        cols.push({
          name: nm(leaf.name),
          type: leaf.attr.dataType || guessType(nm(leaf.name)),
          pk: key || undefined,
          notNull: key || undefined,
        });
      }
    }
    return { cols, multi };
  };

  const entities = d.nodes.filter((n): n is ErEntity => n.kind === "entity");
  const edgesOfKind = (k: ErEdge["kind"]) => d.edges.filter((e) => e.kind === k);

  // Hierarchie
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  const isaOfSuper = new Map<string, ErNode>();
  for (const sup of edgesOfKind("super")) {
    const isa = byId.get(sup.to);
    if (!isa) continue;
    isaOfSuper.set(sup.from, isa);
    for (const sub of edgesOfKind("sub").filter((e) => e.from === isa.id)) {
      parentOf.set(sub.to, sup.from);
      childrenOf.set(sup.from, [...(childrenOf.get(sup.from) ?? []), sub.to]);
    }
  }
  const rootOf = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur)!;
    }
    return cur;
  };
  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    let cur = parentOf.get(id);
    while (cur && !out.includes(cur)) {
      out.unshift(cur);
      cur = parentOf.get(cur);
    }
    return out;
  };
  const descendants = (id: string): string[] => {
    const out: string[] = [];
    const walk = (x: string) => {
      for (const c of childrenOf.get(x) ?? []) {
        if (out.includes(c)) continue;
        out.push(c);
        walk(c);
      }
    };
    walk(id);
    return out;
  };

  const tables = new Map<string, RelTable>(); // entityId → Tabelle
  const allTables: RelTable[] = [];
  const usedNames = new Set<string>();
  const newTable = (name: string): RelTable => {
    let n = name;
    let i = 2;
    while (usedNames.has(n)) n = `${name}_${i++}`;
    usedNames.add(n);
    const t: RelTable = { id: uid("t"), name: n, x: NaN, y: NaN, columns: [] };
    allTables.push(t);
    return t;
  };
  const addCol = (t: RelTable, c: Col): Col => {
    let n = c.name;
    let i = 2;
    while (t.columns.some((x) => x.name === n)) n = `${c.name}_${i++}`;
    const col = { ...c, name: n };
    t.columns.push(col);
    return col;
  };
  const pkCols = (t: RelTable) => t.columns.filter((c) => c.pk);
  const multis: { owner: string; attr: ErAttribute }[] = [];

  const weakIds = new Set(entities.filter((e) => e.weak).map((e) => e.id));
  const assocIds = new Set(entities.filter((e) => e.associative).map((e) => e.id));

  // 1) Tabellen für Entitäten nach Vererbungsstrategie
  for (const e of entities) {
    const root = rootOf(e.id);
    const inHierarchy = root !== e.id || childrenOf.has(e.id);
    const own = simpleCols(e.id);
    for (const m of own.multi) multis.push({ owner: e.id, attr: m });
    if (!inHierarchy) {
      const t = newTable(nm(e.name));
      for (const c of own.cols) addCol(t, c);
      tables.set(e.id, t);
      continue;
    }
    const s = opts.inheritance;
    if (s === "single") {
      if (root !== e.id) continue; // in Wurzel enthalten
      const t = newTable(nm(e.name));
      for (const c of own.cols) addCol(t, c);
      const isa = isaOfSuper.get(e.id);
      const desc = descendants(e.id);
      const disjoint = !isa || isa.kind !== "isa" || isa.disjoint;
      if (disjoint && desc.length) {
        addCol(t, { name: nm(`${e.name}_typ`), type: "char(1)", notNull: isa?.kind === "isa" && isa.total ? true : undefined, note: `Typ: ${desc.map((x) => byId.get(x)!.name).join(", ")}` });
      } else {
        for (const x of desc) addCol(t, { name: nm(`ist_${byId.get(x)!.name}`), type: "boolean", notNull: true });
      }
      for (const x of desc) {
        for (const c of simpleCols(x).cols) addCol(t, { ...c, pk: undefined, notNull: undefined, note: `nur ${byId.get(x)!.name}` });
        tables.set(x, t);
      }
      tables.set(e.id, t);
    } else if (s === "vertical") {
      const t = newTable(nm(e.name));
      if (root !== e.id) t.note = `ist ein ${byId.get(parentOf.get(e.id)!)!.name}`;
      for (const c of own.cols) addCol(t, root === e.id ? c : { ...c, pk: undefined });
      tables.set(e.id, t);
    } else {
      const hasChildren = childrenOf.has(e.id);
      if (s === "perSubtype" && hasChildren) {
        const isa = isaOfSuper.get(e.id);
        if (isa?.kind === "isa" && !isa.total) {
          warnings.push(`"${e.name}": Spezialisierung ist partiell – bei "Table per Sub-Entity-Type" gehen Instanzen ohne Untertyp verloren.`);
        }
        continue;
      }
      const t = newTable(nm(e.name));
      for (const a of ancestors(e.id)) for (const c of simpleCols(a).cols) addCol(t, c);
      for (const c of own.cols) addCol(t, root === e.id || ancestors(e.id).length === 0 ? c : { ...c, pk: c.pk && !pkCols(t).length });
      tables.set(e.id, t);
    }
  }

  // 2) Schlüssel ergänzen (Ersatzschlüssel), außer bei schwachen und assoziativen Entitäten
  const ensureKey = (eid: string) => {
    const t = tables.get(eid);
    if (!t || pkCols(t).length || weakIds.has(eid) || assocIds.has(eid)) return;
    const e = byId.get(eid)!;
    if (parentOf.has(eid) && opts.inheritance === "vertical") return; // erbt Schlüssel
    t.columns.unshift({ name: "id", type: "int", pk: true, notNull: true, note: "Ersatzschlüssel" });
    warnings.push(`"${e.name}" hat keinen Schlüssel – Ersatzschlüssel "id" ergänzt.`);
  };
  for (const e of entities) if (!parentOf.has(e.id)) ensureKey(e.id);
  if (opts.inheritance === "horizontal" || opts.inheritance === "perSubtype") {
    for (const e of entities) {
      const t = tables.get(e.id);
      if (!t || !parentOf.has(e.id) || pkCols(t).length) continue;
      t.columns.unshift({ name: "id", type: "int", pk: true, notNull: true });
    }
  }

  // Horizontal Mapping: Schlüssel der Untertabelle verweist auf die Obertabelle, B(id→A, a1, a2, b1)
  if (opts.inheritance === "horizontal") {
    for (const e of entities) {
      const p = parentOf.get(e.id);
      const t = tables.get(e.id);
      const pt = p ? tables.get(p) : undefined;
      if (!t || !pt) continue;
      const ppk = pt.columns.filter((c) => c.pk);
      t.columns.filter((c) => c.pk).forEach((c, i) => {
        if (ppk[i]) c.ref = { table: pt.name, column: ppk[i].name };
      });
    }
  }

  /** Fremdschlüssel von `t` auf alle PK-Spalten von `target` */
  const addFk = (t: RelTable, target: RelTable, o: { prefix?: string; pk?: boolean; notNull?: boolean; unique?: boolean; front?: boolean }): Col[] => {
    const out: Col[] = [];
    const pks = pkCols(target);
    if (!pks.length) {
      warnings.push(`Tabelle "${target.name}" hat keinen Primärschlüssel – Fremdschlüssel aus "${t.name}" nicht möglich.`);
      return out;
    }
    pks.forEach((p, i) => {
      let name: string;
      // Rollenname ersetzt den Tabellennamen: mitarbeiter_id + Rolle "Vorgesetzter" → vorgesetzter_id
      const bare = p.name.toLowerCase().startsWith(`${target.name.toLowerCase()}_`) ? p.name.slice(target.name.length + 1) : p.name;
      if (o.prefix) name = nm(`${o.prefix}_${bare}`);
      else if (p.name.toLowerCase() === "id" || t.columns.some((c) => c.name === p.name)) name = nm(`${target.name}_${p.name}`);
      else name = p.name;
      const col: Col = {
        name,
        type: p.type.replace(/serial/i, "int"),
        pk: o.pk || undefined,
        notNull: o.notNull || o.pk || undefined,
        unique: o.unique && pks.length === 1 ? true : undefined,
        ref: { table: target.name, column: p.name },
      };
      if (o.front) {
        const at = (frontPos.get(t) ?? 0) + i;
        let n = col.name;
        let k = 2;
        while (t.columns.some((x) => x.name === n)) n = `${col.name}_${k++}`;
        col.name = n;
        t.columns.splice(at, 0, col);
        out.push(col);
      } else out.push(addCol(t, col));
    });
    if (o.front) frontPos.set(t, (frontPos.get(t) ?? 0) + pks.length);
    return out;
  };
  const frontPos = new Map<RelTable, number>();

  // 3) Vertical: Untertabellen bekommen Schlüssel der Obertabelle
  if (opts.inheritance === "vertical") {
    const ordered = [...entities].sort((a, b) => ancestors(a.id).length - ancestors(b.id).length);
    for (const e of ordered) {
      const p = parentOf.get(e.id);
      if (!p) continue;
      const t = tables.get(e.id);
      const pt = tables.get(p);
      if (t && pt) addFk(t, pt, { pk: true, front: true });
    }
  }

  // 4) Schwache Entitäten: Schlüssel des Besitzers übernehmen
  const rels = d.nodes.filter((n) => n.kind === "relationship" || (n.kind === "entity" && n.associative));
  const roleEdges = (rid: string) => d.edges.filter((e) => e.kind === "role" && e.from === rid && byId.has(e.to));
  const handledRels = new Set<string>();
  const weakDone = new Set<string>();
  // Mehrere Besitzer (B(a#, c#, b)) und kaskadierende schwache Entitäten (C(a#, b#, c)) möglich
  for (let pass = 0; pass < 8; pass++) {
    for (const w of weakIds) {
      if (weakDone.has(w)) continue;
      const wt = tables.get(w);
      if (!wt) continue;
      const involved = rels.filter((r) => r.kind === "relationship" && roleEdges(r.id).some((e) => e.to === w));
      // w muss die abhängige Seite sein (total bzw. "n"), nicht der Besitzer einer weiteren schwachen Entität
      const dependent = (r: ErNode) => {
        const own = roleEdges(r.id).find((e) => e.to === w)!;
        if (isMinMax(own.card)) return isOne(own.card) && /^\(?\s*1\s*[,.]/.test(own.card!);
        return !!own.total || !isOne(own.card);
      };
      const identifying = involved.filter((r) => r.kind === "relationship" && r.identifying && dependent(r));
      const idRels = identifying.length ? identifying : involved.filter((r) => roleEdges(r.id).length === 2).slice(0, 1);
      if (!idRels.length) continue;
      const owners = idRels.flatMap((r) => roleEdges(r.id).filter((e) => e.to !== w).map((e) => ({ r, e })));
      if (!owners.length || owners.some(({ e }) => weakIds.has(e.to) && !weakDone.has(e.to))) continue;
      if (owners.some(({ e }) => !tables.get(e.to) || !pkCols(tables.get(e.to)!).length)) continue;
      for (const { e } of owners) addFk(wt, tables.get(e.to)!, { pk: true, front: true, prefix: e.role });
      for (const r of idRels) {
        for (const c of simpleCols(r.id).cols) addCol(wt, { ...c, pk: undefined });
        handledRels.add(r.id);
      }
      weakDone.add(w);
    }
  }
  for (const id of weakIds) {
    if (!weakDone.has(id)) {
      const t = tables.get(id);
      warnings.push(`Schwache Entität "${byId.get(id)!.name}" hat keine identifizierende Beziehung.`);
      if (t && !pkCols(t).length) t.columns.unshift({ name: "id", type: "int", pk: true, notNull: true });
    }
  }

  // 5) Assoziative Entitäten (Aggregation): Schlüssel = Fremdschlüssel der Teilnehmer
  for (const aid of assocIds) {
    const t = tables.get(aid);
    if (!t) continue;
    const roles = roleEdges(aid);
    const hasOwnKey = pkCols(t).length > 0;
    for (const r of roles) {
      const target = tables.get(r.to);
      if (target) addFk(t, target, { pk: !hasOwnKey, prefix: r.role, notNull: true });
    }
    if (!pkCols(t).length) t.columns.unshift({ name: "id", type: "int", pk: true, notNull: true });
  }

  // 6) Beziehungen
  for (const r of d.nodes) {
    if (r.kind !== "relationship" || handledRels.has(r.id)) continue;
    const roles = roleEdges(r.id).filter((e) => tables.has(e.to) || warnUnmapped(e));
    const relCols = simpleCols(r.id);
    for (const m of relCols.multi) warnings.push(`Mehrwertiges Attribut "${m.name}" an Beziehung "${r.name}" wird ignoriert.`);
    if (roles.length < 2) {
      if (roles.length === 1) warnings.push(`Beziehung "${r.name}" hat nur einen Teilnehmer.`);
      continue;
    }
    // "one"-Seite: Kardinalität 1 (Chen) bzw. max=1 (min,max)
    const minmax = roles.some((e) => isMinMax(e.card));
    const recursive = new Set(roles.map((e) => e.to)).size < roles.length;
    const prefixFor = (e: ErEdge) => (e.role ? e.role : recursive ? `${byId.get(e.to)!.name}_${roles.indexOf(e) + 1}` : undefined);

    if (roles.length === 2) {
      const [a, b] = roles;
      const oneA = isOne(a.card);
      const oneB = isOne(b.card);
      // Ziel der FK-Spalte bestimmen
      let fkSide: ErEdge | null = null; // Tabelle, die den Fremdschlüssel bekommt
      let refSide: ErEdge | null = null;
      if (!minmax) {
        if (oneA && !oneB) [fkSide, refSide] = [b, a];
        else if (oneB && !oneA) [fkSide, refSide] = [a, b];
        else if (oneA && oneB) [fkSide, refSide] = b.total && !a.total ? [b, a] : [a, b];
      } else {
        // (min,max): max=1 bei Entität X → X bekommt den FK
        if (oneA && !oneB) [fkSide, refSide] = [a, b];
        else if (oneB && !oneA) [fkSide, refSide] = [b, a];
        else if (oneA && oneB) [fkSide, refSide] = b.total && !a.total ? [b, a] : [a, b];
      }
      if (fkSide && refSide) {
        const ft = tables.get(fkSide.to)!;
        const rt = tables.get(refSide.to)!;
        const minOne = minmax ? /^\(?\s*1/.test(fkSide.card ?? "") : !!fkSide.total;
        const oneToOne = oneA && oneB;
        const prefix = refSide.role ?? (recursive ? r.name : undefined);
        addFk(ft, rt, { prefix: prefix ?? undefined, notNull: minOne || fkSide.total, unique: oneToOne });
        for (const c of relCols.cols) addCol(ft, { ...c, pk: undefined, notNull: undefined });
        continue;
      }
    }
    // N:M bzw. n-är → eigene Tabelle
    const t = newTable(nm(r.name));
    const manySides = roles.filter((e) => !isOne(e.card) || minmax);
    for (const e of roles) {
      const target = tables.get(e.to)!;
      const pk = roles.length === 2 || manySides.includes(e) || manySides.length === 0;
      addFk(t, target, { pk, prefix: prefixFor(e), notNull: true });
    }
    for (const c of relCols.cols) addCol(t, c);
  }

  // 7) Mehrwertige Attribute
  for (const { owner, attr } of multis) {
    const ot = tables.get(owner);
    if (!ot) continue;
    const t = newTable(nm(`${byId.get(owner)!.name}_${attr.name}`));
    addFk(t, ot, { pk: true, notNull: true });
    const kids = attrsOf(attr.id);
    if (kids.length) {
      for (const k of kids) addCol(t, { name: nm(k.name), type: k.dataType || guessType(nm(k.name)), pk: true, notNull: true });
    } else addCol(t, { name: nm(attr.name), type: attr.dataType || guessType(nm(attr.name)), pk: true, notNull: true });
  }

  function warnUnmapped(e: ErEdge): boolean {
    const n = byId.get(e.to);
    if (n) warnings.push(`"${n.name}" hat bei dieser Strategie keine eigene Tabelle – Beziehung kann nicht abgebildet werden.`);
    return false;
  }

  layoutNewTables(allTables, true);
  return { schema: { tables: allTables }, warnings: [...new Set(warnings)] };
}
