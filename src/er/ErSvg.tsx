// Darstellung eines ER-Diagramms in Chen-Notation (für Editor und Export).

import type { ReactNode } from "react";
import { type EdgeGeom, diagramBounds, edgeGeometry } from "./geometry";
import { type ErDiagram, type ErNode, nodeSize } from "./model";

export interface ErPalette {
  bg: string;
  line: string;
  label: string;
  shapeText: string;
  entityFill: string;
  entityStroke: string;
  relFill: string;
  relStroke: string;
  attrFill: string;
  attrStroke: string;
  isaFill: string;
  isaStroke: string;
  noteFill: string;
  noteStroke: string;
  select: string;
  legendFill: string;
  legendStroke: string;
}

export const LIGHT: ErPalette = {
  bg: "#ffffff",
  line: "#334155",
  label: "#0f172a",
  shapeText: "#0f172a",
  entityFill: "#dbeafe",
  entityStroke: "#2563eb",
  relFill: "#fef3c7",
  relStroke: "#d97706",
  attrFill: "#ffffff",
  attrStroke: "#64748b",
  isaFill: "#ede9fe",
  isaStroke: "#7c3aed",
  noteFill: "#fefce8",
  noteStroke: "#ca8a04",
  select: "#6366f1",
  legendFill: "#f8fafc",
  legendStroke: "#cbd5e1",
};

export const DARK: ErPalette = {
  bg: "#0b1120",
  line: "#94a3b8",
  label: "#e2e8f0",
  shapeText: "#f1f5f9",
  entityFill: "#1e3a5f",
  entityStroke: "#60a5fa",
  relFill: "#4a3510",
  relStroke: "#fbbf24",
  attrFill: "#111827",
  attrStroke: "#94a3b8",
  isaFill: "#2e1065",
  isaStroke: "#a78bfa",
  noteFill: "#3f3a12",
  noteStroke: "#facc15",
  select: "#818cf8",
  legendFill: "#111827",
  legendStroke: "#334155",
};

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

interface Props {
  diagram: ErDiagram;
  pal: ErPalette;
  selectedNodes?: Set<string>;
  selectedEdge?: string | null;
  /** Für Export: keine Interaktions-Attribute */
  exportMode?: boolean;
  hideNodeIds?: Set<string>;
}

export function ErShapes({ diagram, pal, selectedNodes, selectedEdge, exportMode, hideNodeIds }: Props) {
  const geoms = edgeGeometry(diagram);
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const bounds = diagramBounds(diagram);
  return (
    <g fontFamily={FONT}>
      <g>
        {geoms.map((g) => (
          <EdgeView key={g.edge.id} g={g} pal={pal} selected={selectedEdge === g.edge.id} exportMode={exportMode} target={byId.get(g.edge.to)} />
        ))}
      </g>
      <g>
        {diagram.nodes.map((n) =>
          hideNodeIds?.has(n.id) ? null : <NodeView key={n.id} n={n} pal={pal} selected={!!selectedNodes?.has(n.id)} exportMode={exportMode} />,
        )}
      </g>
      {diagram.showLegend && bounds && diagram.nodes.length > 0 && <Legend x={bounds.maxX + 60} y={bounds.minY} pal={pal} />}
    </g>
  );
}

function EdgeView({ g, pal, selected, exportMode, target }: { g: EdgeGeom; pal: ErPalette; selected: boolean; exportMode?: boolean; target?: ErNode }) {
  const { edge: e, a, b, nor, dir } = g;
  const stroke = selected ? pal.select : pal.line;
  const sw = selected ? 2.2 : 1.4;
  const lines: ReactNode[] = [];
  const double = !!e.total;
  if (double) {
    for (const s of [-2.4, 2.4]) {
      lines.push(<line key={s} x1={a.x + nor.x * s} y1={a.y + nor.y * s} x2={b.x + nor.x * s} y2={b.y + nor.y * s} stroke={stroke} strokeWidth={sw * 0.85} />);
    }
  } else {
    lines.push(<line key="l" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={sw} />);
  }
  // Teilmengen-Symbol (⊂) an Unterklassen-Kanten
  let subset: ReactNode = null;
  if (e.kind === "sub") {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const r = 8;
    // Bogen öffnet sich zum ISA-Kreis (Richtung a)
    const p1 = { x: mx + nor.x * r, y: my + nor.y * r };
    const p2 = { x: mx - nor.x * r, y: my - nor.y * r };
    const sweep = 1;
    subset = <path d={`M ${p1.x} ${p1.y} A ${r} ${r} 0 0 ${sweep} ${p2.x} ${p2.y}`} fill="none" stroke={stroke} strokeWidth={1.6} transform={`translate(${dir.x * 3} ${dir.y * 3})`} />;
  }
  // "total" an der Oberklassen-Kante einer totalen Spezialisierung
  let superLabel: ReactNode = null;
  if (e.kind === "super" && e.total) {
    superLabel = (
      <text x={(a.x + b.x) / 2 + nor.x * 14} y={(a.y + b.y) / 2 + nor.y * 14} textAnchor="middle" dominantBaseline="central" fontSize={11.5} fill={pal.isaStroke} stroke={pal.bg} strokeWidth={4} paintOrder="stroke" style={{ pointerEvents: "none" }}>
        total
      </text>
    );
  }
  // Kardinalität/Rolle nahe der Entität (Endpunkt b)
  let label: ReactNode = null;
  const text = e.kind === "role" ? [e.card, e.role ? `(${e.role})` : ""].filter(Boolean).join(" ") : "";
  if (text) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = Math.min(g.off ? 34 : 26, len * 0.35);
    const side = g.off ? 14 : 11;
    const px = b.x - dir.x * t + nor.x * side;
    const py = b.y - dir.y * t + nor.y * side;
    label = (
      <text x={px} y={py} textAnchor="middle" dominantBaseline="central" fontSize={12.5} fontWeight={600} fill={pal.label} stroke={pal.bg} strokeWidth={4} paintOrder="stroke" style={{ pointerEvents: "none" }}>
        {text}
      </text>
    );
  }
  void target;
  return (
    <g data-edge={exportMode ? undefined : e.id}>
      {!exportMode && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12} style={{ cursor: "pointer" }} />}
      {lines}
      {subset}
      {superLabel}
      {label}
    </g>
  );
}

function underline(n: ErNode, w: number, pal: ErPalette, dashed: boolean) {
  const tw = Math.min(w - 16, n.name.length * 7.3);
  return <line x1={n.x - tw / 2} y1={n.y + 9} x2={n.x + tw / 2} y2={n.y + 9} stroke={pal.shapeText} strokeWidth={1.2} strokeDasharray={dashed ? "4 3" : undefined} />;
}

export function NodeView({ n, pal, selected, exportMode }: { n: ErNode; pal: ErPalette; selected: boolean; exportMode?: boolean }) {
  const { w, h } = nodeSize(n);
  const x = n.x - w / 2;
  const y = n.y - h / 2;
  const halo = selected ? <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} rx={10} fill="none" stroke={pal.select} strokeWidth={1.5} strokeDasharray="5 4" /> : null;
  const label = (bold = false, dy = 0) => (
    <text x={n.x} y={n.y + dy} textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={bold ? 650 : 500} fill={pal.shapeText} style={{ userSelect: "none" }}>
      {n.name}
    </text>
  );
  let body: ReactNode;
  switch (n.kind) {
    case "entity": {
      if (n.associative) {
        const dw = w - 14;
        const dh = h - 14;
        body = (
          <>
            <rect x={x} y={y} width={w} height={h} rx={3} fill={pal.entityFill} stroke={pal.entityStroke} strokeWidth={1.8} />
            <polygon points={`${n.x},${n.y - dh / 2} ${n.x + dw / 2},${n.y} ${n.x},${n.y + dh / 2} ${n.x - dw / 2},${n.y}`} fill={pal.relFill} stroke={pal.relStroke} strokeWidth={1.6} />
            {label(true)}
          </>
        );
      } else {
        body = (
          <>
            <rect x={x} y={y} width={w} height={h} rx={3} fill={pal.entityFill} stroke={pal.entityStroke} strokeWidth={1.8} />
            {n.weak && <rect x={x + 5} y={y + 5} width={w - 10} height={h - 10} rx={2} fill="none" stroke={pal.entityStroke} strokeWidth={1.4} />}
            {label(true)}
          </>
        );
      }
      break;
    }
    case "relationship": {
      const pts = (inset: number) => {
        const hw = w / 2 - inset * 1.9;
        const hh = h / 2 - inset;
        return `${n.x},${n.y - hh} ${n.x + hw},${n.y} ${n.x},${n.y + hh} ${n.x - hw},${n.y}`;
      };
      body = (
        <>
          <polygon points={pts(0)} fill={pal.relFill} stroke={pal.relStroke} strokeWidth={1.8} strokeLinejoin="round" />
          {n.identifying && <polygon points={pts(6)} fill="none" stroke={pal.relStroke} strokeWidth={1.4} strokeLinejoin="round" />}
          {label(false)}
        </>
      );
      break;
    }
    case "attribute": {
      const rx = w / 2;
      const ry = h / 2;
      const dashed = n.attrKind === "derived";
      body = (
        <>
          <ellipse cx={n.x} cy={n.y} rx={rx} ry={ry} fill={pal.attrFill} stroke={pal.attrStroke} strokeWidth={1.5} strokeDasharray={dashed ? "5 4" : undefined} />
          {n.attrKind === "multivalued" && <ellipse cx={n.x} cy={n.y} rx={rx - 4.5} ry={ry - 4.5} fill="none" stroke={pal.attrStroke} strokeWidth={1.3} />}
          {label(n.attrKind === "key")}
          {(n.attrKind === "key" || n.attrKind === "partial") && underline(n, w, pal, n.attrKind === "partial")}
        </>
      );
      break;
    }
    case "isa": {
      body = (
        <>
          <circle cx={n.x} cy={n.y} r={w / 2} fill={pal.isaFill} stroke={pal.isaStroke} strokeWidth={1.8} />
          <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" fontSize={14} fontWeight={700} fill={pal.shapeText} style={{ userSelect: "none" }}>
            {n.name || (n.disjoint ? "d" : "o")}
          </text>
        </>
      );
      break;
    }
    case "note": {
      const lines = n.name.split("\n");
      body = (
        <>
          <path d={`M ${x} ${y} H ${x + w - 12} L ${x + w} ${y + 12} V ${y + h} H ${x} Z`} fill={pal.noteFill} stroke={pal.noteStroke} strokeWidth={1.2} />
          <path d={`M ${x + w - 12} ${y} V ${y + 12} H ${x + w}`} fill="none" stroke={pal.noteStroke} strokeWidth={1.2} />
          <text x={x + 12} y={y + 9} fontSize={12.5} fill={pal.shapeText} style={{ userSelect: "none" }}>
            {lines.map((l, i) => (
              <tspan key={i} x={x + 12} dy={i === 0 ? 13 : 17}>
                {l}
              </tspan>
            ))}
          </text>
        </>
      );
      break;
    }
  }
  return (
    <g data-node={exportMode ? undefined : n.id} style={exportMode ? undefined : { cursor: "move" }}>
      {halo}
      {body}
    </g>
  );
}

export const LEGEND_W = 230;
export const LEGEND_H = 300;

function Legend({ x, y, pal }: { x: number; y: number; pal: ErPalette }) {
  const row = (i: number) => y + 38 + i * 26;
  const items: [ReactNode, string][] = [];
  const cx = x + 38;
  const r = (i: number, shape: ReactNode, text: string) => items.push([<g key={i}>{shape}</g>, text]);
  r(0, <rect x={cx - 22} y={row(0) - 10} width={44} height={20} rx={2} fill={pal.entityFill} stroke={pal.entityStroke} strokeWidth={1.4} />, "Entität");
  r(1, <><rect x={cx - 22} y={row(1) - 10} width={44} height={20} rx={2} fill={pal.entityFill} stroke={pal.entityStroke} strokeWidth={1.4} /><rect x={cx - 18} y={row(1) - 6} width={36} height={12} fill="none" stroke={pal.entityStroke} strokeWidth={1} /></>, "schwache Entität");
  r(2, <polygon points={`${cx},${row(2) - 11} ${cx + 24},${row(2)} ${cx},${row(2) + 11} ${cx - 24},${row(2)}`} fill={pal.relFill} stroke={pal.relStroke} strokeWidth={1.4} />, "Beziehung");
  r(3, <><polygon points={`${cx},${row(3) - 11} ${cx + 24},${row(3)} ${cx},${row(3) + 11} ${cx - 24},${row(3)}`} fill={pal.relFill} stroke={pal.relStroke} strokeWidth={1.4} /><polygon points={`${cx},${row(3) - 7} ${cx + 16},${row(3)} ${cx},${row(3) + 7} ${cx - 16},${row(3)}`} fill="none" stroke={pal.relStroke} strokeWidth={1} /></>, "identifizierende Beziehung");
  r(4, <ellipse cx={cx} cy={row(4)} rx={22} ry={10} fill={pal.attrFill} stroke={pal.attrStroke} strokeWidth={1.3} />, "Attribut");
  r(5, <><ellipse cx={cx} cy={row(5)} rx={22} ry={10} fill={pal.attrFill} stroke={pal.attrStroke} strokeWidth={1.3} /><line x1={cx - 10} y1={row(5) + 4} x2={cx + 10} y2={row(5) + 4} stroke={pal.shapeText} /></>, "Schlüssel (unterstrichen)");
  r(6, <><ellipse cx={cx} cy={row(6)} rx={22} ry={10} fill={pal.attrFill} stroke={pal.attrStroke} strokeWidth={1.3} /><ellipse cx={cx} cy={row(6)} rx={18} ry={6.5} fill="none" stroke={pal.attrStroke} strokeWidth={1} /></>, "mehrwertiges Attribut");
  r(7, <ellipse cx={cx} cy={row(7)} rx={22} ry={10} fill={pal.attrFill} stroke={pal.attrStroke} strokeWidth={1.3} strokeDasharray="4 3" />, "abgeleitetes Attribut");
  r(8, <><line x1={cx - 22} y1={row(8) - 2.4} x2={cx + 22} y2={row(8) - 2.4} stroke={pal.line} /><line x1={cx - 22} y1={row(8) + 2.4} x2={cx + 22} y2={row(8) + 2.4} stroke={pal.line} /></>, "totale Teilnahme");
  r(9, <><circle cx={cx} cy={row(9)} r={10} fill={pal.isaFill} stroke={pal.isaStroke} strokeWidth={1.4} /><text x={cx} y={row(9)} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700} fill={pal.shapeText}>d</text></>, "Spezialisierung d/o");
  return (
    <g style={{ pointerEvents: "none" }}>
      <rect x={x} y={y} width={LEGEND_W} height={LEGEND_H} rx={8} fill={pal.legendFill} stroke={pal.legendStroke} />
      <text x={x + 14} y={y + 20} fontSize={12.5} fontWeight={700} fill={pal.label}>
        Legende
      </text>
      {items.map(([shape, text], i) => (
        <g key={i}>
          {shape}
          <text x={x + 72} y={row(i)} dominantBaseline="central" fontSize={11.5} fill={pal.label}>
            {text}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Vollständiges, eigenständiges SVG-Element für den Export. */
export function ErExportSvg({ diagram, pal }: { diagram: ErDiagram; pal: ErPalette }) {
  const b = diagramBounds(diagram) ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  let maxX = b.maxX;
  let maxY = b.maxY;
  if (diagram.showLegend && diagram.nodes.length) {
    maxX = Math.max(maxX, b.maxX + 60 + LEGEND_W);
    maxY = Math.max(maxY, b.minY + LEGEND_H);
  }
  const pad = 40;
  const x = b.minX - pad;
  const y = b.minY - pad;
  const w = maxX - b.minX + pad * 2;
  const h = maxY - b.minY + pad * 2;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={w} height={h} viewBox={`${x} ${y} ${w} ${h}`}>
      <rect x={x} y={y} width={w} height={h} fill={pal.bg} />
      <ErShapes diagram={diagram} pal={pal} exportMode />
    </svg>
  );
}
