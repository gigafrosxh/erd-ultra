import { type ErDiagram, type ErEdge, type ErNode, nodeSize } from "./model";

export interface Pt {
  x: number;
  y: number;
}

export function insideNode(n: ErNode, p: Pt, pad = 0): boolean {
  const { w, h } = nodeSize(n);
  const dx = Math.abs(p.x - n.x);
  const dy = Math.abs(p.y - n.y);
  const a = w / 2 + pad;
  const b = h / 2 + pad;
  switch (n.kind) {
    case "entity":
    case "note":
      return dx <= a && dy <= b;
    case "relationship":
      return dx / a + dy / b <= 1;
    case "attribute":
    case "isa":
      return (dx / a) ** 2 + (dy / b) ** 2 <= 1;
  }
}

/** Schnittpunkt der Strecke from→to mit dem Rand von n (from liegt innen). */
export function clipToNode(n: ErNode, from: Pt, to: Pt): Pt {
  if (!insideNode(n, from)) return from;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const p = { x: from.x + (to.x - from.x) * mid, y: from.y + (to.y - from.y) * mid };
    if (insideNode(n, p)) lo = mid;
    else hi = mid;
  }
  return { x: from.x + (to.x - from.x) * hi, y: from.y + (to.y - from.y) * hi };
}

export interface EdgeGeom {
  edge: ErEdge;
  a: Pt;
  b: Pt;
  /** Normalisierter Richtungsvektor a→b */
  dir: Pt;
  /** Normale */
  nor: Pt;
  /** Versatz bei Mehrfachkanten (0 = keine) */
  off: number;
}

/** Geometrie aller Kanten inkl. Versatz bei Mehrfachkanten (z.B. rekursive Beziehungen). */
export function edgeGeometry(d: ErDiagram): EdgeGeom[] {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const groups = new Map<string, ErEdge[]>();
  for (const e of d.edges) {
    const k = [e.from, e.to].sort().join("|");
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const out: EdgeGeom[] = [];
  for (const e of d.edges) {
    const A = byId.get(e.from);
    const B = byId.get(e.to);
    if (!A || !B) continue;
    const grp = groups.get([e.from, e.to].sort().join("|"))!;
    const idx = grp.indexOf(e);
    let dx = B.x - A.x;
    let dy = B.y - A.y;
    let len = Math.hypot(dx, dy) || 1;
    // Normale immer bezogen auf die sortierte Richtung, damit Versätze nicht kollidieren
    const sign = e.from < e.to ? 1 : -1;
    const nx = (-dy / len) * sign;
    const ny = (dx / len) * sign;
    const off = (idx - (grp.length - 1) / 2) * 34;
    const ca = { x: A.x + nx * off, y: A.y + ny * off };
    const cb = { x: B.x + nx * off, y: B.y + ny * off };
    const a = clipToNode(A, ca, cb);
    const b = clipToNode(B, cb, ca);
    dx = b.x - a.x;
    dy = b.y - a.y;
    len = Math.hypot(dx, dy) || 1;
    const nor = { x: -dy / len, y: dx / len };
    // Normale so ausrichten, dass sie vom Kantenbündel weg zeigt (für Beschriftungen)
    const away = off !== 0 && nor.x * nx + nor.y * ny < 0 === off > 0 ? { x: -nor.x, y: -nor.y } : nor;
    out.push({ edge: e, a, b, dir: { x: dx / len, y: dy / len }, nor: off !== 0 ? away : nor, off });
  }
  return out;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function diagramBounds(d: ErDiagram): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!d.nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of d.nodes) {
    const { w, h } = nodeSize(n);
    minX = Math.min(minX, n.x - w / 2);
    maxX = Math.max(maxX, n.x + w / 2);
    minY = Math.min(minY, n.y - h / 2);
    maxY = Math.max(maxY, n.y + h / 2);
  }
  return { minX, minY, maxX, maxY };
}
