// ER-DSL: Parser (Text → Diagramm) und Generator (Diagramm → Text).
//
// Beispiel:
//   entity Mitarbeiter {
//     key personal_nr: int
//     name
//     multi telefon
//     derived alter
//     adresse { strasse, plz, ort }
//   }
//   weak entity Raum { partial nr }
//   relationship leitet (Mitarbeiter 1, Gehege n) { seit: date }
//   relationship "ist Vorgesetzter von" (Mitarbeiter 1 as Vorgesetzter, Mitarbeiter n as Untergebener)
//   identifying relationship hat (Gebaeude 1, Raum n total)
//   isa Tier disjoint total { Saeugetier, Vogel, Reptil }
//   note "Freitext"

import { DslError, TokenStream, quoteName } from "../lib/lexer";
import { autoPlaceNewNodes } from "./layout";
import {
  type AttrKind,
  type ErAttribute,
  type ErDiagram,
  type ErEdge,
  type ErEntity,
  type ErIsa,
  type ErNode,
  type ErRelationship,
  uid,
} from "./model";

const RESERVED = new Set([
  "entity",
  "weak",
  "associative",
  "aggregation",
  "relationship",
  "rel",
  "identifying",
  "isa",
  "attribute",
  "note",
  "key",
  "pk",
  "partial",
  "multi",
  "multivalued",
  "derived",
  "as",
  "total",
  "disjoint",
  "overlapping",
]);

const ATTR_MODS: Record<string, AttrKind> = {
  key: "key",
  pk: "key",
  partial: "partial",
  multi: "multivalued",
  multivalued: "multivalued",
  derived: "derived",
};

export interface ParseResult {
  diagram: ErDiagram;
  errors: DslError[];
}

interface Draft {
  node: ErNode;
  key: string;
}

/** Text → Diagramm. Positionen werden über semantische Schlüssel aus `previous` übernommen. */
export function parseErDsl(src: string, previous?: ErDiagram): ParseResult {
  const drafts: Draft[] = [];
  const byKey = new Map<string, Draft>();
  const edges: ErEdge[] = [];
  const relCount = new Map<string, number>();
  const isaCount = new Map<string, number>();
  let noteCount = 0;

  const add = (node: ErNode, key: string): Draft => {
    const d = { node, key };
    drafts.push(d);
    byKey.set(key, d);
    return d;
  };

  const entity = (name: string): ErEntity => {
    const key = `E:${name}`;
    const ex = byKey.get(key);
    if (ex) return ex.node as ErEntity;
    return add({ kind: "entity", id: uid(), name, x: NaN, y: NaN }, key).node as ErEntity;
  };

  const ts = new TokenStream(src);

  const parseType = (): string => {
    const t = ts.name("Datentyp", false);
    let type = t.value;
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
    return type;
  };

  const parseAttrList = (ownerId: string, ownerKey: string) => {
    ts.expect("{");
    while (!ts.is("}")) {
      if (ts.peek().type === "eof") throw new DslError('"}" erwartet', ts.peek());
      if (ts.accept(",") || ts.accept(";")) continue;
      parseAttr(ownerId, ownerKey);
    }
    ts.expect("}");
  };

  const parseAttr = (ownerId: string, ownerKey: string) => {
    let attrKind: AttrKind = "normal";
    for (;;) {
      const t = ts.peek();
      const mod = t.type === "ident" ? ATTR_MODS[t.value.toLowerCase()] : undefined;
      // "key" allein als Attributname erlauben, wenn danach kein Name folgt
      const after = ts.toks[ts.toks.indexOf(t) + 1];
      if (mod && after && (after.type === "ident" || after.type === "string")) {
        ts.next();
        attrKind = mod;
      } else break;
    }
    const nameTok = ts.name("Attributname");
    const key = `${ownerKey}/A:${nameTok.value}`;
    const attr: ErAttribute = { kind: "attribute", id: uid(), name: nameTok.value, x: NaN, y: NaN, attrKind };
    if (ts.accept(":", false)) attr.dataType = parseType();
    add(attr, key);
    edges.push({ id: uid("e"), kind: "attr", from: attr.id, to: ownerId });
    if (ts.is("{", false)) parseAttrList(attr.id, key);
  };

  const parseCard = (): string => {
    let card = "";
    const stop = () => ts.is(",") || ts.is(")") || ts.isKw("as") || ts.isKw("total") || ts.isKw("partial") || ts.peek().type === "string";
    if (ts.is("(")) {
      let depth = 0;
      do {
        const t = ts.next();
        if (t.type === "eof") throw new DslError('")" erwartet', t);
        if (t.value === "(") depth++;
        if (t.value === ")") depth--;
        card += t.value;
      } while (depth > 0);
      return card;
    }
    while (!stop()) {
      const t = ts.next();
      if (t.type === "eof") throw new DslError('")" erwartet', t);
      if (t.value === "[" || t.value === "]") continue;
      card += t.value;
    }
    return card;
  };

  const parseParticipants = (ownerId: string) => {
    if (ts.accept("(")) {
      while (!ts.is(")")) {
        if (ts.accept(",")) continue;
        const ent = entity(ts.name("Entitätsname").value);
        const edge: ErEdge = { id: uid("e"), kind: "role", from: ownerId, to: ent.id };
        const card = parseCard();
        if (card) edge.card = card;
        for (;;) {
          if (ts.acceptKw("as")) edge.role = ts.name("Rollenname").value;
          else if (ts.peek().type === "string") edge.role = ts.next().value;
          else if (ts.acceptKw("total")) edge.total = true;
          else if (ts.acceptKw("partial")) edge.total = false;
          else break;
        }
        edges.push(edge);
        if (!ts.is(")") && !ts.is(",")) throw new DslError('"," oder ")" erwartet', ts.peek());
      }
      ts.expect(")");
    }
  };

  const parseRelationship = (identifying: boolean) => {
    const nameTok = ts.name("Beziehungsname");
    const n = relCount.get(nameTok.value) ?? 0;
    relCount.set(nameTok.value, n + 1);
    const key = `R:${nameTok.value}#${n}`;
    const rel: ErRelationship = { kind: "relationship", id: uid(), name: nameTok.value, x: NaN, y: NaN };
    if (identifying) rel.identifying = true;
    add(rel, key);
    parseParticipants(rel.id);
    if (ts.is("{", false)) parseAttrList(rel.id, key);
  };

  const parseIsa = () => {
    let sup: ErEntity | undefined;
    const first = ts.peek();
    const isMod = (v: string) =>
      ["d", "o", "disjoint", "disjunkt", "overlapping", "überlappend", "ueberlappend", "total", "partial", "partiell"].includes(
        v.toLowerCase(),
      );
    if ((first.type === "ident" || first.type === "string") && !(first.type === "ident" && isMod(first.value))) {
      sup = entity(ts.next().value);
    }
    const isa: ErIsa = { kind: "isa", id: uid(), name: "d", x: NaN, y: NaN, disjoint: true, total: false };
    ts.accept("[");
    for (;;) {
      ts.accept(",");
      const t = ts.peek();
      if (t.type !== "ident" || !isMod(t.value)) break;
      ts.next();
      const v = t.value.toLowerCase();
      if (["d", "disjoint", "disjunkt"].includes(v)) isa.disjoint = true;
      else if (["o", "overlapping", "überlappend", "ueberlappend"].includes(v)) isa.disjoint = false;
      else if (v === "total") isa.total = true;
      else isa.total = false;
    }
    ts.accept("]");
    if (ts.peek().type === "string" && !ts.is("{")) isa.name = ts.next().value;
    else isa.name = isa.disjoint ? "d" : "o";
    const supName = sup?.name ?? "";
    const n = isaCount.get(supName) ?? 0;
    isaCount.set(supName, n + 1);
    add(isa, `I:${supName}#${n}`);
    if (sup) edges.push({ id: uid("e"), kind: "super", from: sup.id, to: isa.id, total: isa.total || undefined });
    const subs: string[] = [];
    if (ts.accept("{")) {
      while (!ts.is("}")) {
        if (ts.accept(",")) continue;
        if (ts.peek().type === "eof") throw new DslError('"}" erwartet', ts.peek());
        subs.push(ts.name("Unterklasse").value);
      }
      ts.expect("}");
    } else if (ts.accept("->")) {
      subs.push(ts.name("Unterklasse").value);
      while (ts.accept(",", false)) subs.push(ts.name("Unterklasse").value);
    }
    for (const s of subs) edges.push({ id: uid("e"), kind: "sub", from: isa.id, to: entity(s).id });
  };

  const errors: DslError[] = [];
  while (ts.peek().type !== "eof") {
    const start = ts.i;
    try {
      const t = ts.next();
      const kw = t.type === "ident" ? t.value.toLowerCase() : "";
      if (t.value === ";" || t.value === ",") continue;
      if (kw === "entity" || kw === "weak" || kw === "associative" || kw === "aggregation") {
        const weak = kw === "weak";
        const assoc = kw === "associative" || kw === "aggregation";
        if (kw !== "entity") ts.acceptKw("entity");
        const e = entity(ts.name("Entitätsname").value);
        if (weak) e.weak = true;
        if (assoc) e.associative = true;
        if (ts.is("(", false)) parseParticipants(e.id);
        if (ts.is("{", false)) parseAttrList(e.id, `E:${e.name}`);
      } else if (kw === "relationship" || kw === "rel") {
        parseRelationship(false);
      } else if (kw === "identifying") {
        if (!ts.acceptKw("relationship")) ts.acceptKw("rel");
        parseRelationship(true);
      } else if (kw === "isa" || kw === "specialization" || kw === "generalization") {
        parseIsa();
      } else if (kw === "attribute") {
        let attrKind: AttrKind = "normal";
        while (ts.peek().type === "ident" && ATTR_MODS[ts.peek().value.toLowerCase()]) attrKind = ATTR_MODS[ts.next().value.toLowerCase()];
        const nm = ts.name("Attributname").value;
        const a: ErAttribute = { kind: "attribute", id: uid(), name: nm, x: NaN, y: NaN, attrKind };
        if (ts.accept(":", false)) a.dataType = parseType();
        add(a, `A:${nm}`);
        if (ts.is("{", false)) parseAttrList(a.id, `A:${nm}`);
      } else if (kw === "note") {
        const txt = ts.name("Notiztext").value;
        add({ kind: "note", id: uid(), name: txt, x: NaN, y: NaN }, `N:${noteCount++}`);
      } else {
        throw new DslError(
          `Unbekannte Anweisung "${t.value}". Erlaubt: entity, weak entity, associative entity, relationship, identifying relationship, isa, attribute, note`,
          t,
        );
      }
    } catch (e) {
      if (!(e instanceof DslError)) throw e;
      errors.push(e);
      // bis zur nächsten Zeile mit Schlüsselwort am Anfang überspringen
      if (ts.i === start) ts.i++;
      let depth = 0;
      while (ts.toks[ts.i].type !== "eof") {
        const t = ts.toks[ts.i];
        if (t.value === "{") depth++;
        if (t.value === "}") depth = Math.max(0, depth - 1);
        const prev = ts.toks[ts.i - 1];
        if (depth === 0 && prev?.type === "nl" && t.type === "ident" && RESERVED.has(t.value.toLowerCase())) break;
        ts.i++;
      }
    }
  }

  // Positionen und IDs aus dem vorherigen Diagramm übernehmen
  const idMap = new Map<string, string>();
  if (previous) matchPrevious(drafts, edges, previous, idMap);
  for (const e of edges) {
    e.from = idMap.get(e.from) ?? e.from;
    e.to = idMap.get(e.to) ?? e.to;
  }
  // Kanten-IDs stabil halten, damit Auswahl erhalten bleibt
  if (previous) {
    const sig = (e: ErEdge) => `${e.kind}|${e.from}|${e.to}`;
    const pool = new Map<string, string[]>();
    for (const e of previous.edges) {
      const s = sig(e);
      pool.set(s, [...(pool.get(s) ?? []), e.id]);
    }
    for (const e of edges) {
      const ids = pool.get(sig(e));
      if (ids?.length) e.id = ids.shift()!;
    }
  }

  const diagram: ErDiagram = { nodes: drafts.map((d) => d.node), edges, showLegend: previous?.showLegend ?? true };
  autoPlaceNewNodes(diagram);
  return { diagram, errors };
}

/**
 * Ordnet neu geparste Knoten den bisherigen zu (gleiche ID und Position).
 * Erst über den Namen, dann – bei Umbenennungen – über die Reihenfolge.
 */
function matchPrevious(drafts: Draft[], edges: ErEdge[], previous: ErDiagram, idMap: Map<string, string>) {
  const prevKeys = semanticKeys(previous);
  const used = new Set<string>();
  const take = (d: Draft, old: ErNode) => {
    used.add(old.id);
    idMap.set(d.node.id, old.id);
    d.node.id = old.id;
    d.node.x = old.x;
    d.node.y = old.y;
  };
  const main = drafts.filter((d) => d.node.kind !== "attribute");
  for (const d of main) {
    const old = prevKeys.get(d.key);
    if (old && old.kind === d.node.kind && !used.has(old.id)) take(d, old);
  }
  for (const kind of ["entity", "relationship", "isa", "note"] as const) {
    const newUn = main.filter((d) => d.node.kind === kind && !idMap.has(d.node.id) && !used.has(d.node.id));
    const oldUn = previous.nodes.filter((n) => n.kind === kind && !used.has(n.id));
    if (newUn.length && newUn.length === oldUn.length) newUn.forEach((d, i) => take(d, oldUn[i]));
  }
  // Attribute: über Besitzer + Name, sonst Reihenfolge
  const oldOwner = new Map<string, string>();
  for (const e of previous.edges) if (e.kind === "attr" && !oldOwner.has(e.from)) oldOwner.set(e.from, e.to);
  const newOwner = new Map<string, string>();
  for (const e of edges) if (e.kind === "attr" && !newOwner.has(e.from)) newOwner.set(e.from, e.to);
  const attrs = drafts.filter((d) => d.node.kind === "attribute");
  const pending: Draft[] = [];
  for (const d of attrs) {
    const tmpOwner = newOwner.get(d.node.id);
    const owner = tmpOwner ? idMap.get(tmpOwner) ?? tmpOwner : undefined;
    const old = previous.nodes.find((n) => n.kind === "attribute" && !used.has(n.id) && n.name === d.node.name && oldOwner.get(n.id) === owner);
    if (old) take(d, old);
    else pending.push(d);
  }
  const byOwner = new Map<string, Draft[]>();
  for (const d of pending) {
    const tmpOwner = newOwner.get(d.node.id);
    const owner = tmpOwner ? idMap.get(tmpOwner) ?? tmpOwner : "";
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), d]);
  }
  for (const [owner, list] of byOwner) {
    const oldUn = previous.nodes.filter((n) => n.kind === "attribute" && !used.has(n.id) && (oldOwner.get(n.id) ?? "") === owner);
    if (list.length === oldUn.length) list.forEach((d, i) => take(d, oldUn[i]));
  }
}

/** Semantischer Schlüssel jedes Knotens (für die Zuordnung zwischen Text und Grafik). */
export function semanticKeys(d: ErDiagram): Map<string, ErNode> {
  const out = new Map<string, ErNode>();
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const ownerOf = new Map<string, string>();
  for (const e of d.edges) if (e.kind === "attr" && !ownerOf.has(e.from)) ownerOf.set(e.from, e.to);
  const keyOf = new Map<string, string>();
  const relCount = new Map<string, number>();
  const isaCount = new Map<string, number>();
  let notes = 0;
  for (const n of d.nodes) {
    if (n.kind === "entity") keyOf.set(n.id, `E:${n.name}`);
    else if (n.kind === "relationship") {
      const c = relCount.get(n.name) ?? 0;
      relCount.set(n.name, c + 1);
      keyOf.set(n.id, `R:${n.name}#${c}`);
    } else if (n.kind === "isa") {
      const supEdge = d.edges.find((e) => e.kind === "super" && e.to === n.id);
      const sup = supEdge ? byId.get(supEdge.from)?.name ?? "" : "";
      const c = isaCount.get(sup) ?? 0;
      isaCount.set(sup, c + 1);
      keyOf.set(n.id, `I:${sup}#${c}`);
    } else if (n.kind === "note") keyOf.set(n.id, `N:${notes++}`);
  }
  const attrKey = (id: string, depth = 0): string => {
    const cached = keyOf.get(id);
    if (cached) return cached;
    const n = byId.get(id)!;
    const owner = ownerOf.get(id);
    const k = owner && depth < 20 && byId.has(owner) ? `${attrKey(owner, depth + 1)}/A:${n.name}` : `A:${n.name}`;
    keyOf.set(id, k);
    return k;
  };
  for (const n of d.nodes) if (n.kind === "attribute") attrKey(n.id);
  for (const n of d.nodes) out.set(keyOf.get(n.id)!, n);
  return out;
}

// ---------------------------------------------------------------------------
// Diagramm → Text

const q = (s: string) => quoteName(s, RESERVED);

export function serializeErDsl(d: ErDiagram): string {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const attrsOf = new Map<string, ErAttribute[]>();
  const owned = new Set<string>();
  for (const e of d.edges) {
    if (e.kind !== "attr") continue;
    const a = byId.get(e.from);
    if (!a || a.kind !== "attribute" || owned.has(a.id) || !byId.has(e.to)) continue;
    owned.add(a.id);
    attrsOf.set(e.to, [...(attrsOf.get(e.to) ?? []), a]);
  }
  const MOD: Record<AttrKind, string> = { normal: "", key: "key ", partial: "partial ", multivalued: "multi ", derived: "derived " };

  const attrBlock = (ownerId: string, indent: string, seen: Set<string>): string[] => {
    const list = attrsOf.get(ownerId) ?? [];
    const out: string[] = [];
    for (const a of list) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      let line = `${indent}${MOD[a.attrKind]}${q(a.name)}${a.dataType ? `: ${a.dataType}` : ""}`;
      const children = attrsOf.get(a.id) ?? [];
      if (children.length) {
        const inner = attrBlock(a.id, "", seen);
        line += inner.every((l) => !l.includes("{")) && inner.join(", ").length < 60 ? ` { ${inner.join(", ")} }` : ` {\n${attrBlock(a.id, indent + "  ", new Set()).join("\n")}\n${indent}}`;
      }
      out.push(line);
    }
    return out;
  };

  const withBlock = (head: string, ownerId: string) => {
    const lines = attrBlock(ownerId, "  ", new Set());
    return lines.length ? `${head} {\n${lines.join("\n")}\n}` : head;
  };

  const participants = (ownerId: string) =>
    d.edges
      .filter((e) => e.kind === "role" && e.from === ownerId && byId.has(e.to))
      .map((e) => {
        let s = q(byId.get(e.to)!.name);
        if (e.card) s += ` ${e.card}`;
        if (e.role) s += ` as ${q(e.role)}`;
        if (e.total) s += " total";
        return s;
      });
  const parts: string[] = [];
  const entities = d.nodes.filter((n): n is ErEntity => n.kind === "entity");
  for (const e of entities) {
    const prefix = e.weak ? "weak entity" : e.associative ? "associative entity" : "entity";
    const ps = e.associative ? participants(e.id) : [];
    parts.push(withBlock(`${prefix} ${q(e.name)}${ps.length ? ` (${ps.join(", ")})` : ""}`, e.id));
  }
  const rels = d.nodes.filter((n): n is ErRelationship => n.kind === "relationship");
  if (rels.length) parts.push("");
  for (const r of rels) {
    const ps = participants(r.id);
    const head = `${r.identifying ? "identifying relationship" : "relationship"} ${q(r.name)} (${ps.join(", ")})`;
    parts.push(withBlock(head, r.id));
  }
  const isas = d.nodes.filter((n): n is ErIsa => n.kind === "isa");
  if (isas.length) parts.push("");
  for (const i of isas) {
    const supEdge = d.edges.find((e) => e.kind === "super" && e.to === i.id && byId.has(e.from));
    const subs = d.edges.filter((e) => e.kind === "sub" && e.from === i.id && byId.has(e.to)).map((e) => q(byId.get(e.to)!.name));
    const sup = supEdge ? `${q(byId.get(supEdge.from)!.name)} ` : "";
    const label = i.name && i.name !== (i.disjoint ? "d" : "o") ? ` "${i.name}"` : "";
    parts.push(`isa ${sup}${i.disjoint ? "disjoint" : "overlapping"} ${i.total ? "total" : "partial"}${label} { ${subs.join(", ")} }`);
  }
  const loose = d.nodes.filter((n): n is ErAttribute => n.kind === "attribute" && !owned.has(n.id));
  if (loose.length) parts.push("");
  for (const a of loose) {
    parts.push(withBlock(`attribute ${MOD[a.attrKind]}${q(a.name)}`, a.id));
  }
  const notes = d.nodes.filter((n) => n.kind === "note");
  if (notes.length) parts.push("");
  for (const n of notes) parts.push(`note ${JSON.stringify(n.name)}`);
  return parts.join("\n").replace(/^\n+/, "") + "\n";
}

export function newNodeId(): string {
  return uid();
}

const COMMENT_LINE = /^\s*(#|\/\/)/;

/** Schlüssel einer Code-Zeile zum Wiederfinden nach dem Neu-Erzeugen, z. B. "entity Kunde" oder "key kunden_nr" */
function lineKey(line: string): string {
  return line
    .trim()
    .split(/[({:,]/)[0]
    .replace(/["`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Kommentare aus dem bisherigen Code in neu erzeugten Code übernehmen: Ein Kommentarblock bleibt vor der
 * Zeile, vor der er stand. Kommentare am Ende bleiben am Ende, solche ohne Gegenstück wandern an den Anfang.
 */
export function keepComments(oldText: string, newText: string): string {
  const old = oldText.split("\n");
  const blocks: { key: string | null; lines: string[] }[] = [];
  let cur: string[] = [];
  for (const line of old) {
    if (COMMENT_LINE.test(line)) cur.push(line.trim());
    else if (line.trim() && cur.length) {
      blocks.push({ key: lineKey(line), lines: cur });
      cur = [];
    }
  }
  if (cur.length) blocks.push({ key: null, lines: cur });
  if (!blocks.length) return newText;

  const lines = newText.replace(/\n$/, "").split("\n");
  const before = new Map<number, string[]>();
  const head: string[] = [];
  const tail: string[] = [];
  const used = new Set<number>();
  for (const b of blocks) {
    if (b.key === null) {
      tail.push(...b.lines);
      continue;
    }
    const idx = lines.findIndex((l, i) => !used.has(i) && l.trim() && lineKey(l) === b.key);
    if (idx < 0) {
      head.push(...b.lines);
      continue;
    }
    used.add(idx);
    const indent = lines[idx].match(/^\s*/)![0];
    before.set(idx, [...(before.get(idx) ?? []), ...b.lines.map((l) => indent + l)]);
  }
  const out: string[] = [...head];
  if (head.length && lines[0]?.trim()) out.push("");
  lines.forEach((l, i) => out.push(...(before.get(i) ?? []), l));
  if (tail.length) out.push("", ...tail);
  return out.join("\n") + "\n";
}
