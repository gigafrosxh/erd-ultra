// Automatisches Layout für ER-Diagramme.

import { distToSegment } from "./geometry";
import { type ErDiagram, type ErNode, nodeSize } from "./model";

const isMain = (n: ErNode) => n.kind !== "attribute";

/** Platziert nur Knoten ohne Position (NaN). Sind alle neu, wird ein komplettes Layout berechnet. */
export function autoPlaceNewNodes(d: ErDiagram): void {
  const unplaced = d.nodes.filter((n) => !Number.isFinite(n.x) || !Number.isFinite(n.y));
  if (!unplaced.length) return;
  if (unplaced.length === d.nodes.length) {
    autoLayout(d);
    return;
  }
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const placed = () => d.nodes.filter((n) => Number.isFinite(n.x));
  const bbox = () => {
    const p = placed();
    if (!p.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return {
      minX: Math.min(...p.map((n) => n.x)),
      minY: Math.min(...p.map((n) => n.y)),
      maxX: Math.max(...p.map((n) => n.x)),
      maxY: Math.max(...p.map((n) => n.y)),
    };
  };
  const neighbours = (id: string) =>
    d.edges
      .filter((e) => e.kind !== "attr" && (e.from === id || e.to === id))
      .map((e) => byId.get(e.from === id ? e.to : e.from)!)
      .filter((n) => n && Number.isFinite(n.x));

  for (const n of unplaced) {
    if (n.kind === "attribute") continue;
    const nb = neighbours(n.id);
    if (nb.length) {
      const cx = nb.reduce((s, m) => s + m.x, 0) / nb.length;
      const cy = nb.reduce((s, m) => s + m.y, 0) / nb.length;
      if (nb.length === 1) {
        const sup = d.edges.find((e) => (e.kind === "sub" && e.to === n.id) || (e.kind === "super" && e.to === n.id));
        n.x = cx + (sup ? 0 : 220);
        n.y = cy + (sup ? 130 : 0);
      } else {
        n.x = cx;
        n.y = cy;
      }
      nudgeFree(d, n);
    } else {
      const b = bbox();
      n.x = b.maxX + 260;
      n.y = b.minY;
    }
  }
  // Attribute um ihren Besitzer herum
  const owners = new Set<string>();
  for (const n of unplaced) {
    if (n.kind !== "attribute") continue;
    const e = d.edges.find((x) => x.kind === "attr" && x.from === n.id);
    if (e) owners.add(e.to);
    else {
      const b = bbox();
      n.x = b.minX;
      n.y = b.maxY + 120;
    }
  }
  for (const o of owners) placeAttributes(d, o, true);
}

function nudgeFree(d: ErDiagram, n: ErNode) {
  for (let tries = 0; tries < 40; tries++) {
    const hit = d.nodes.some(
      (m) => m !== n && Number.isFinite(m.x) && Math.abs(m.x - n.x) < 120 && Math.abs(m.y - n.y) < 70,
    );
    if (!hit) return;
    n.y += 80;
    if (tries % 4 === 3) n.x += 140;
  }
}

/** Platziert die Attribute eines Besitzers kreisförmig, weg von dessen anderen Kanten. */
export function placeAttributes(d: ErDiagram, ownerId: string, onlyUnplaced = false, depth = 0): void {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const owner = byId.get(ownerId);
  if (!owner || !Number.isFinite(owner.x) || depth > 6) return;
  const attrs = d.edges
    .filter((e) => e.kind === "attr" && e.to === ownerId)
    .map((e) => byId.get(e.from)!)
    .filter((n) => n && n.kind === "attribute");
  if (!attrs.length) return;
  const todo = onlyUnplaced ? attrs.filter((a) => !Number.isFinite(a.x)) : attrs;

  // belegte Richtungen
  const used: number[] = [];
  for (const e of d.edges) {
    let other: ErNode | undefined;
    if (e.from === ownerId && e.kind !== "attr") other = byId.get(e.to);
    else if (e.to === ownerId) other = byId.get(e.from);
    else if (e.from === ownerId && e.kind === "attr") other = byId.get(e.to); // eigener Besitzer (zusammengesetzt)
    if (!other || !Number.isFinite(other.x)) continue;
    if ((todo as ErNode[]).includes(other)) continue;
    used.push(Math.atan2(other.y - owner.y, other.x - owner.x));
  }
  const angDist = (a: number, b: number) => {
    const d0 = Math.abs(a - b) % (2 * Math.PI);
    return d0 > Math.PI ? 2 * Math.PI - d0 : d0;
  };
  const chosen: number[] = [];
  const slots = 48;
  const os = nodeSize(owner);
  const extra = Math.max(0, todo.length + used.length - 4) * 9;
  // Linien zu verbundenen Knoten, die Attribute nicht überdecken sollen
  const segs: ErNode[] = [];
  for (const e of d.edges) {
    const other = e.from === ownerId ? byId.get(e.to) : e.to === ownerId ? byId.get(e.from) : undefined;
    if (other && Number.isFinite(other.x) && !(todo as ErNode[]).includes(other)) segs.push(other);
  }
  const boxes: { x: number; y: number; w: number; h: number }[] = attrs
    .filter((a) => !todo.includes(a) && Number.isFinite(a.x))
    .map((a) => ({ x: a.x, y: a.y, ...nodeSize(a) }));
  const posFor = (ang: number, w: number, h: number, grow = 0) => {
    const rx = os.w / 2 + w / 2 + 28 + extra + grow;
    const ry = os.h / 2 + h / 2 + 42 + extra + grow;
    return { x: Math.round(owner.x + Math.cos(ang) * rx), y: Math.round(owner.y + Math.sin(ang) * ry) };
  };
  for (const a of todo) {
    const as = nodeSize(a);
    const all = [...used, ...chosen];
    const cands: { ang: number; score: number }[] = [];
    for (let s = 0; s < slots; s++) {
      const ang = -Math.PI / 2 + (s / slots) * 2 * Math.PI;
      // leichte Bevorzugung von oben
      const score = (all.length ? Math.min(...all.map((u) => angDist(ang, u))) : Math.PI) - angDist(ang, -Math.PI / 2) * 0.02;
      cands.push({ ang, score });
    }
    cands.sort((x, y) => y.score - x.score);
    const collides = (p: { x: number; y: number }) =>
      segs.some((o) => [-as.w / 2 + 6, 0, as.w / 2 - 6].some((dx) => distToSegment({ x: p.x + dx, y: p.y }, owner, o) < as.h / 2 + 3)) ||
      boxes.some((b) => Math.abs(b.x - p.x) < (b.w + as.w) / 2 + 4 && Math.abs(b.y - p.y) < (b.h + as.h) / 2 + 2);
    let pick: { ang: number; p: { x: number; y: number } } | null = null;
    for (const grow of [0, 30, 60]) {
      for (const c of cands) {
        const p = posFor(c.ang, as.w, as.h, grow);
        if (!collides(p)) {
          pick = { ang: c.ang, p };
          break;
        }
      }
      if (pick) break;
    }
    if (!pick) pick = { ang: cands[0].ang, p: posFor(cands[0].ang, as.w, as.h) };
    chosen.push(pick.ang);
    a.x = pick.p.x;
    a.y = pick.p.y;
    boxes.push({ x: a.x, y: a.y, ...as });
  }
  for (const a of attrs) placeAttributes(d, a.id, onlyUnplaced, depth + 1);
}

/** Vollständiges Layout: Kräftebasiert für Entitäten/Beziehungen, danach Attribute. */
export function autoLayout(d: ErDiagram): void {
  const main = d.nodes.filter(isMain);
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const attrCount = new Map<string, number>();
  for (const e of d.edges) if (e.kind === "attr") attrCount.set(e.to, (attrCount.get(e.to) ?? 0) + 1);
  const links = d.edges.filter((e) => e.kind !== "attr" && isMain(byId.get(e.from)!) && isMain(byId.get(e.to)!));

  // Startpositionen: BFS-Schichten
  const adj = new Map<string, string[]>();
  for (const l of links) {
    adj.set(l.from, [...(adj.get(l.from) ?? []), l.to]);
    adj.set(l.to, [...(adj.get(l.to) ?? []), l.from]);
  }
  const seen = new Set<string>();
  let col = 0;
  let compY = 0;
  for (const start of main) {
    if (seen.has(start.id)) continue;
    const queue = [start.id];
    seen.add(start.id);
    const layers: string[][] = [];
    const depth = new Map([[start.id, 0]]);
    while (queue.length) {
      const id = queue.shift()!;
      const dep = depth.get(id)!;
      (layers[dep] ??= []).push(id);
      for (const nb of adj.get(id) ?? []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        depth.set(nb, dep + 1);
        queue.push(nb);
      }
    }
    layers.forEach((ids, li) => {
      ids.forEach((id, k) => {
        const n = byId.get(id)!;
        n.x = (col + li) * 300;
        n.y = compY + (k - (ids.length - 1) / 2) * 240;
      });
    });
    compY += Math.max(...layers.map((l) => l.length)) * 240 + 200;
    col = 0;
  }

  const radius = (n: ErNode) => {
    const s = nodeSize(n);
    const a = attrCount.get(n.id) ?? 0;
    return Math.max(s.w, s.h) / 2 + (a ? 70 + Math.min(a, 8) * 6 : 10);
  };
  const N = main.length;
  if (N > 1) {
    const iters = 400;
    for (let it = 0; it < iters; it++) {
      const temp = 40 * (1 - it / iters) + 1;
      const fx = new Map<string, number>();
      const fy = new Map<string, number>();
      for (const n of main) {
        fx.set(n.id, 0);
        fy.set(n.id, 0);
      }
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const a = main[i];
          const b = main[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dist = Math.hypot(dx, dy);
          if (dist < 0.01) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            dist = 0.5;
          }
          const minD = radius(a) + radius(b) + 30;
          const f = dist < minD ? ((minD - dist) / dist) * 0.5 : (2000 / (dist * dist)) * 0.2;
          fx.set(a.id, fx.get(a.id)! + dx * f);
          fy.set(a.id, fy.get(a.id)! + dy * f);
          fx.set(b.id, fx.get(b.id)! - dx * f);
          fy.set(b.id, fy.get(b.id)! - dy * f);
        }
      }
      for (const l of links) {
        const a = byId.get(l.from)!;
        const b = byId.get(l.to)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const ideal = (radius(a) + radius(b)) * 0.75 + 60;
        const f = ((dist - ideal) / dist) * 0.08;
        fx.set(a.id, fx.get(a.id)! + dx * f);
        fy.set(a.id, fy.get(a.id)! + dy * f);
        fx.set(b.id, fx.get(b.id)! - dx * f);
        fy.set(b.id, fy.get(b.id)! - dy * f);
        // Generalisierung: Oberklasse oben, Unterklassen unten
        if (l.kind === "super" || l.kind === "sub") {
          const want = l.kind === "super" ? 110 : 150;
          const err = b.y - a.y - want;
          fy.set(a.id, fy.get(a.id)! + err * 0.1);
          fy.set(b.id, fy.get(b.id)! - err * 0.1);
          fx.set(b.id, fx.get(b.id)! - dx * 0.02 * (l.kind === "super" ? 1 : 0));
        }
      }
      // Schwerkraft zur Mitte hält das Diagramm kompakt
      const cx = main.reduce((s, n) => s + n.x, 0) / N;
      const cy = main.reduce((s, n) => s + n.y, 0) / N;
      for (const n of main) {
        const vx = fx.get(n.id)! - (n.x - cx) * 0.035;
        const vy = fy.get(n.id)! - (n.y - cy) * 0.05;
        const len = Math.hypot(vx, vy);
        const s = len > temp ? temp / len : 1;
        n.x += vx * s;
        n.y += vy * s;
      }
    }
  } else if (N === 1) {
    main[0].x = 0;
    main[0].y = 0;
  }
  for (const n of main) {
    n.x = Math.round(n.x);
    n.y = Math.round(n.y);
  }
  for (const n of main) placeAttributes(d, n.id);
  for (const n of d.nodes) {
    if (!Number.isFinite(n.x)) {
      n.x = 0;
      n.y = 0;
    }
  }
}
