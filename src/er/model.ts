// Datenmodell für ER-Diagramme in Chen-Notation.

export type AttrKind = "normal" | "key" | "partial" | "multivalued" | "derived";

export interface ErEntity {
  kind: "entity";
  id: string;
  name: string;
  x: number;
  y: number;
  /** Schwache Entität (doppeltes Rechteck) */
  weak?: boolean;
  /** Aggregation / assoziative Entität (Raute im Rechteck) */
  associative?: boolean;
}

export interface ErRelationship {
  kind: "relationship";
  id: string;
  name: string;
  x: number;
  y: number;
  /** Identifizierende Beziehung einer schwachen Entität (doppelte Raute) */
  identifying?: boolean;
}

export interface ErAttribute {
  kind: "attribute";
  id: string;
  name: string;
  x: number;
  y: number;
  attrKind: AttrKind;
  /** Datentyp für die relationale Abbildung (optional) */
  dataType?: string;
}

export interface ErIsa {
  kind: "isa";
  id: string;
  /** Anzeige-Label, standardmäßig "d" bzw. "o" */
  name: string;
  x: number;
  y: number;
  disjoint: boolean;
  total: boolean;
}

/** Freier Kommentar / Notiz im Diagramm */
export interface ErNote {
  kind: "note";
  id: string;
  name: string;
  x: number;
  y: number;
}

export type ErNode = ErEntity | ErRelationship | ErAttribute | ErIsa | ErNote;
export type ErNodeKind = ErNode["kind"];

/**
 * Kanten:
 * - attr:   Attribut → Besitzer (Entität, Beziehung oder zusammengesetztes Attribut)
 * - role:   Beziehung ↔ Entität (Teilnahme mit Kardinalität)
 * - super:  Oberklasse → ISA-Kreis
 * - sub:    ISA-Kreis → Unterklasse
 */
export type ErEdgeKind = "attr" | "role" | "super" | "sub";

export interface ErEdge {
  id: string;
  kind: ErEdgeKind;
  from: string;
  to: string;
  /** Kardinalität: 1, n, m, N, M, (0,1), (1,*), 0..n ... */
  card?: string;
  /** Rollenname, z.B. "Vorgesetzter" */
  role?: string;
  /** Totale Teilnahme → Doppellinie */
  total?: boolean;
}

export interface ErDiagram {
  nodes: ErNode[];
  edges: ErEdge[];
  /** Legende im Diagramm anzeigen */
  showLegend?: boolean;
}

let counter = 0;
export function uid(prefix = "n"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyDiagram(): ErDiagram {
  return { nodes: [], edges: [], showLegend: true };
}

export function nodeById(d: ErDiagram, id: string): ErNode | undefined {
  return d.nodes.find((n) => n.id === id);
}

export function isEntityLike(n: ErNode | undefined): n is ErEntity {
  return !!n && n.kind === "entity";
}

/** Abmessungen der Formen (Breite/Höhe) */
export function nodeSize(n: ErNode): { w: number; h: number } {
  const textW = Math.max(40, n.name.length * 7.6);
  switch (n.kind) {
    case "entity":
      return { w: Math.max(110, textW + 34), h: n.associative ? 70 : 48 };
    case "relationship":
      return { w: Math.max(120, textW + 60), h: 64 };
    case "attribute":
      return { w: Math.max(80, textW + 30), h: 36 };
    case "isa":
      return { w: 34, h: 34 };
    case "note": {
      const lines = n.name.split("\n");
      const longest = Math.max(...lines.map((l) => l.length));
      return { w: Math.max(120, longest * 7 + 24), h: lines.length * 17 + 18 };
    }
  }
}

/** Welche Kante entsteht, wenn man a mit b verbindet? */
export function inferEdgeKind(a: ErNode, b: ErNode): { kind: ErEdgeKind; from: string; to: string } | null {
  if (a.kind === "note" || b.kind === "note") return null;
  if (a.kind === "attribute" && b.kind !== "isa") return { kind: "attr", from: a.id, to: b.id };
  if (b.kind === "attribute" && a.kind !== "isa") return { kind: "attr", from: b.id, to: a.id };
  if (a.kind === "relationship" && b.kind === "entity") return { kind: "role", from: a.id, to: b.id };
  if (b.kind === "relationship" && a.kind === "entity") return { kind: "role", from: b.id, to: a.id };
  // Aggregation: assoziative Entität verbindet Entitäten wie eine Beziehung
  if (a.kind === "entity" && a.associative && b.kind === "entity" && !b.associative) return { kind: "role", from: a.id, to: b.id };
  if (b.kind === "entity" && b.associative && a.kind === "entity" && !a.associative) return { kind: "role", from: b.id, to: a.id };
  if (a.kind === "entity" && b.kind === "isa") return { kind: "super", from: a.id, to: b.id };
  if (a.kind === "isa" && b.kind === "entity") return { kind: "sub", from: a.id, to: b.id };
  return null;
}
