// Interaktive Zeichenfläche für ER-Diagramme.

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { type View, useViewport } from "../ui/viewport";
import { type ErPalette, ErShapes, LEGEND_H, LEGEND_W } from "./ErSvg";
import { diagramBounds, distToSegment, edgeGeometry, insideNode } from "./geometry";
import { type ErDiagram, type ErNode, inferEdgeKind, nodeSize, uid } from "./model";

export type ErTool =
  | "select"
  | "entity"
  | "weak"
  | "associative"
  | "relationship"
  | "identifying"
  | "attribute"
  | "key"
  | "multivalued"
  | "derived"
  | "isa"
  | "note"
  | "connect";

export interface ErSelection {
  nodes: Set<string>;
  edge: string | null;
}

export interface ErCanvasHandle {
  fit: () => void;
  zoom: (f: number) => void;
  center: (x: number, y: number) => void;
  toScreen: (x: number, y: number) => { x: number; y: number };
  view: View;
}

interface Props {
  diagram: ErDiagram;
  pal: ErPalette;
  tool: ErTool;
  setTool: (t: ErTool) => void;
  selection: ErSelection;
  setSelection: (s: ErSelection) => void;
  onChange: (d: ErDiagram, mergeKey?: string) => void;
  onRename: (id: string) => void;
  onError: (msg: string) => void;
  dark: boolean;
}

type Mode =
  | { kind: "none" }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: "drag"; ids: string[]; start: Map<string, { x: number; y: number }>; wx: number; wy: number; moved: boolean; key: string }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; additive: Set<string> }
  | { kind: "connect"; from: string; x: number; y: number };

export function makeNode(tool: ErTool, x: number, y: number, d: ErDiagram): ErNode | null {
  const unique = (base: string) => {
    let name = base;
    let i = 2;
    while (d.nodes.some((n) => n.name === name)) name = `${base} ${i++}`;
    return name;
  };
  const id = uid();
  switch (tool) {
    case "entity":
      return { kind: "entity", id, name: unique("Entität"), x, y };
    case "weak":
      return { kind: "entity", id, name: unique("SchwacheEntität"), x, y, weak: true };
    case "associative":
      return { kind: "entity", id, name: unique("Aggregation"), x, y, associative: true };
    case "relationship":
      return { kind: "relationship", id, name: unique("beziehung"), x, y };
    case "identifying":
      return { kind: "relationship", id, name: unique("hat"), x, y, identifying: true };
    case "attribute":
      return { kind: "attribute", id, name: "attribut", x, y, attrKind: "normal" };
    case "key":
      return { kind: "attribute", id, name: "id", x, y, attrKind: "key" };
    case "multivalued":
      return { kind: "attribute", id, name: "werte", x, y, attrKind: "multivalued" };
    case "derived":
      return { kind: "attribute", id, name: "abgeleitet", x, y, attrKind: "derived" };
    case "isa":
      return { kind: "isa", id, name: "d", x, y, disjoint: true, total: false };
    case "note":
      return { kind: "note", id, name: "Notiz", x, y };
    default:
      return null;
  }
}

/** Alle Attribute (rekursiv), die zu den gegebenen Knoten gehören */
export function ownedAttributes(d: ErDiagram, ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of d.edges) {
      if (e.kind === "attr" && e.to === id && !out.has(e.from)) {
        out.add(e.from);
        stack.push(e.from);
      }
    }
  }
  return out;
}

export const ErCanvas = forwardRef<ErCanvasHandle, Props>(function ErCanvas(
  { diagram, pal, tool, setTool, selection, setSelection, onChange, onRename, onError, dark },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { view, setView, toWorld, toScreen, zoomAt, fit } = useViewport(svgRef);
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [hover, setHover] = useState<string | null>(null);
  const diagramRef = useRef(diagram);
  diagramRef.current = diagram;
  const pendingRename = useRef<string | null>(null);

  const bounds = () => {
    const b = diagramBounds(diagram);
    if (b && diagram.showLegend) {
      b.maxX = Math.max(b.maxX, b.maxX + 60 + LEGEND_W);
      b.maxY = Math.max(b.maxY, b.minY + LEGEND_H);
    }
    return b;
  };

  useImperativeHandle(ref, () => ({
    fit: () => fit(bounds()),
    zoom: (f: number) => zoomAt(f),
    center: (x: number, y: number) => {
      const r = svgRef.current!.getBoundingClientRect();
      setView((v) => ({ ...v, x: r.width / 2 - x * v.k, y: r.height / 2 - y * v.k }));
    },
    toScreen,
    view,
  }));

  const nodeAt = (x: number, y: number, exclude?: string): ErNode | undefined => {
    for (let i = diagram.nodes.length - 1; i >= 0; i--) {
      const n = diagram.nodes[i];
      if (n.id !== exclude && insideNode(n, { x, y }, 4)) return n;
    }
    return undefined;
  };

  const connect = (fromId: string, toId: string) => {
    const a = diagram.nodes.find((n) => n.id === fromId);
    const b = diagram.nodes.find((n) => n.id === toId);
    if (!a || !b || a === b) return;
    const inf = inferEdgeKind(a, b);
    if (!inf) {
      onError(`${label(a)} und ${label(b)} können nicht direkt verbunden werden.`);
      return;
    }
    if (inf.kind === "attr" && diagram.edges.some((e) => e.kind === "attr" && e.from === inf.from)) {
      // Attribut umhängen
      const edges = diagram.edges.filter((e) => !(e.kind === "attr" && e.from === inf.from));
      const edge = { id: uid("e"), ...inf };
      onChange({ ...diagram, edges: [...edges, edge] });
      setSelection({ nodes: new Set(), edge: edge.id });
      return;
    }
    if (inf.kind === "super" && diagram.edges.some((e) => e.kind === "super" && e.to === inf.to)) {
      onError("Dieser Spezialisierungskreis hat bereits eine Oberklasse.");
      return;
    }
    const edge = { id: uid("e"), ...inf, ...(inf.kind === "role" ? { card: "n" } : {}) };
    if (inf.kind === "super") {
      const isa = diagram.nodes.find((n) => n.id === inf.to);
      if (isa?.kind === "isa" && isa.total) Object.assign(edge, { total: true });
    }
    onChange({ ...diagram, edges: [...diagram.edges, edge] });
    setSelection({ nodes: new Set(), edge: edge.id });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    const target = e.target as Element;
    const handle = target.closest("[data-handle]")?.getAttribute("data-handle");
    const nodeId = target.closest("[data-node]")?.getAttribute("data-node");
    const edgeId = target.closest("[data-edge]")?.getAttribute("data-edge");

    if (e.button === 1 || (e.button === 0 && e.altKey && !nodeId)) {
      setMode({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false });
      return;
    }
    if (handle) {
      setMode({ kind: "connect", from: handle, x: w.x, y: w.y });
      return;
    }
    if (nodeId) {
      if (tool === "connect") {
        setMode({ kind: "connect", from: nodeId, x: w.x, y: w.y });
        return;
      }
      if (tool !== "select") {
        // Neues Element direkt an angeklicktes anhängen (z.B. Attribut an Entität)
        createAt(w.x, w.y, nodeId);
        return;
      }
      let sel = selection.nodes;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        sel = new Set(sel);
        if (sel.has(nodeId)) sel.delete(nodeId);
        else sel.add(nodeId);
      } else if (!sel.has(nodeId)) sel = new Set([nodeId]);
      setSelection({ nodes: sel, edge: null });
      const ids = new Set(sel);
      ids.add(nodeId);
      // Attribute bewegen sich mit ihrem Besitzer
      const owners = [...ids].filter((id) => diagram.nodes.find((n) => n.id === id)?.kind !== "attribute");
      for (const a of ownedAttributes(diagram, owners)) ids.add(a);
      const start = new Map<string, { x: number; y: number }>();
      for (const n of diagram.nodes) if (ids.has(n.id)) start.set(n.id, { x: n.x, y: n.y });
      setMode({ kind: "drag", ids: [...ids], start, wx: w.x, wy: w.y, moved: false, key: `drag-${Date.now()}` });
      return;
    }
    if (edgeId) {
      setSelection({ nodes: new Set(), edge: edgeId });
      return;
    }
    // Kante in der Nähe?
    const near = edgeGeometry(diagram).find((g) => distToSegment(w, g.a, g.b) < 6 / view.k);
    if (near && tool === "select") {
      setSelection({ nodes: new Set(), edge: near.edge.id });
      return;
    }
    if (tool !== "select" && tool !== "connect") {
      createAt(w.x, w.y, null);
      return;
    }
    if (e.shiftKey) {
      setMode({ kind: "marquee", x0: w.x, y0: w.y, x1: w.x, y1: w.y, additive: new Set(selection.nodes) });
      return;
    }
    setMode({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false });
  };

  const createAt = (x: number, y: number, attachTo: string | null) => {
    const d = diagramRef.current;
    const n = makeNode(tool, x, y, d);
    if (!n) return;
    const owner = attachTo ? d.nodes.find((m) => m.id === attachTo) : selection.nodes.size === 1 ? d.nodes.find((m) => selection.nodes.has(m.id)) : undefined;
    const edges = [...d.edges];
    if (owner) {
      const inf = inferEdgeKind(n, owner);
      if (inf && (n.kind === "attribute" || attachTo)) {
        edges.push({ id: uid("e"), ...inf, ...(inf.kind === "role" ? { card: "n" } : {}) });
        if (attachTo) {
          // Neben dem Ziel platzieren statt darauf
          const s = nodeSize(owner);
          n.x = owner.x + (n.kind === "attribute" ? 0 : s.w / 2 + 120);
          n.y = owner.y - (n.kind === "attribute" ? s.h / 2 + 50 : 0);
        }
      }
    }
    onChange({ ...d, nodes: [...d.nodes, n], edges });
    setSelection({ nodes: new Set([n.id]), edge: null });
    setTool("select");
    // Umbenennen erst nach dem Loslassen starten, sonst verliert das Eingabefeld den Fokus
    if (n.kind !== "isa") pendingRename.current = n.id;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const m = modeRef.current;
    if (m.kind === "none") return;
    const w = toWorld(e.clientX, e.clientY);
    if (m.kind === "pan") {
      const dx = e.clientX - m.sx;
      const dy = e.clientY - m.sy;
      setView((v) => ({ ...v, x: m.vx + dx, y: m.vy + dy }));
      if (Math.abs(dx) + Math.abs(dy) > 3 && !m.moved) setMode({ ...m, moved: true });
    } else if (m.kind === "drag") {
      const dx = w.x - m.wx;
      const dy = w.y - m.wy;
      if (!m.moved && Math.abs(dx) + Math.abs(dy) < 2 / view.k) return;
      if (!m.moved) setMode({ ...m, moved: true });
      const d = diagramRef.current;
      const nodes = d.nodes.map((n) => {
        const s = m.start.get(n.id);
        return s ? { ...n, x: Math.round(s.x + dx), y: Math.round(s.y + dy) } : n;
      });
      onChange({ ...d, nodes }, m.key);
    } else if (m.kind === "marquee") {
      setMode({ ...m, x1: w.x, y1: w.y });
      const x0 = Math.min(m.x0, w.x);
      const x1 = Math.max(m.x0, w.x);
      const y0 = Math.min(m.y0, w.y);
      const y1 = Math.max(m.y0, w.y);
      const sel = new Set(m.additive);
      for (const n of diagram.nodes) if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1) sel.add(n.id);
      setSelection({ nodes: sel, edge: null });
    } else if (m.kind === "connect") {
      setMode({ ...m, x: w.x, y: w.y });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const m = modeRef.current;
    if (pendingRename.current) {
      const id = pendingRename.current;
      pendingRename.current = null;
      setTimeout(() => onRename(id), 30);
    }
    if (m.kind === "pan" && !m.moved) setSelection({ nodes: new Set(), edge: null });
    if (m.kind === "connect") {
      const w = toWorld(e.clientX, e.clientY);
      const target = nodeAt(w.x, w.y, m.from);
      if (target) connect(m.from, target.id);
      if (tool === "connect" && !e.shiftKey) setTool("select");
    }
    setMode({ kind: "none" });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // Wegen Pointer-Capture ist e.target immer das SVG → echtes Element unter dem Zeiger suchen
    const real = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    const nodeId = real.closest("[data-node]")?.getAttribute("data-node");
    if (nodeId) {
      onRename(nodeId);
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    if (real.closest("[data-edge], [data-handle]")) return;
    const d = diagramRef.current;
    const n = makeNode("entity", Math.round(w.x), Math.round(w.y), d)!;
    onChange({ ...d, nodes: [...d.nodes, n] });
    setSelection({ nodes: new Set([n.id]), edge: null });
    setTimeout(() => onRename(n.id), 0);
  };

  const hovered = hover ? diagram.nodes.find((n) => n.id === hover) : undefined;
  const singleSel = selection.nodes.size === 1 ? diagram.nodes.find((n) => selection.nodes.has(n.id)) : undefined;
  const handleNodes = [hovered, singleSel].filter((n, i, a): n is ErNode => !!n && n.kind !== "note" && a.indexOf(n) === i);
  const connectFrom = mode.kind === "connect" ? diagram.nodes.find((n) => n.id === mode.from) : undefined;
  const connectTarget = mode.kind === "connect" ? nodeAt(mode.x, mode.y, mode.from) : undefined;

  const grid = 24 * view.k;
  const cursor =
    mode.kind === "pan" && mode.moved ? "grabbing" : tool === "connect" ? "crosshair" : tool !== "select" ? "copy" : "default";

  return (
    <svg
      ref={svgRef}
      className="canvas"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onPointerOver={(e) => setHover((e.target as Element).closest("[data-node]")?.getAttribute("data-node") ?? null)}
      onPointerLeave={() => setHover(null)}
    >
      <defs>
        <pattern id="er-grid" width={grid} height={grid} patternUnits="userSpaceOnUse" x={view.x % grid} y={view.y % grid}>
          <circle cx={1} cy={1} r={1} fill={dark ? "#1e293b" : "#d8dee9"} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#er-grid)" />
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        <ErShapes diagram={diagram} pal={pal} selectedNodes={selection.nodes} selectedEdge={selection.edge} />
        {connectFrom && mode.kind === "connect" && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={connectFrom.x} y1={connectFrom.y} x2={mode.x} y2={mode.y} stroke={pal.select} strokeWidth={2} strokeDasharray="6 4" />
            {connectTarget && (
              <rect
                x={connectTarget.x - nodeSize(connectTarget).w / 2 - 6}
                y={connectTarget.y - nodeSize(connectTarget).h / 2 - 6}
                width={nodeSize(connectTarget).w + 12}
                height={nodeSize(connectTarget).h + 12}
                rx={10}
                fill="none"
                stroke={inferEdgeKind(connectFrom, connectTarget) ? "#22c55e" : "#ef4444"}
                strokeWidth={2}
              />
            )}
          </g>
        )}
        {mode.kind === "none" &&
          tool === "select" &&
          handleNodes.map((n) => {
            const s = nodeSize(n);
            const hx = n.x + s.w / 2 + (n.kind === "relationship" ? 4 : 10);
            return (
              <g key={n.id} data-handle={n.id} style={{ cursor: "crosshair" }} onPointerOver={() => setHover(n.id)}>
                <title>Ziehen, um zu verbinden</title>
                <circle cx={hx} cy={n.y} r={14} fill="transparent" />
                <circle cx={hx} cy={n.y} r={7.5} fill={pal.select} stroke={pal.bg} strokeWidth={2} />
                <path d={`M ${hx - 3.5} ${n.y} H ${hx + 3.5} M ${hx} ${n.y - 3.5} V ${n.y + 3.5}`} stroke="#fff" strokeWidth={1.6} />
              </g>
            );
          })}
        {mode.kind === "marquee" && (
          <rect
            x={Math.min(mode.x0, mode.x1)}
            y={Math.min(mode.y0, mode.y1)}
            width={Math.abs(mode.x1 - mode.x0)}
            height={Math.abs(mode.y1 - mode.y0)}
            fill={pal.select}
            fillOpacity={0.08}
            stroke={pal.select}
            strokeDasharray="4 3"
          />
        )}
      </g>
    </svg>
  );
});

function label(n: ErNode): string {
  const kind = { entity: "Entität", relationship: "Beziehung", attribute: "Attribut", isa: "Spezialisierung", note: "Notiz" }[n.kind];
  return `${kind} "${n.name}"`;
}
