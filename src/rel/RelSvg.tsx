// Darstellung relationaler Schemas (Tabellen mit Fremdschlüssel-Linien).

import { HEAD_H, ROW_H, type RelSchema, type RelTable, tableHeight, tableWidth } from "./model";

export interface RelPalette {
  bg: string;
  card: string;
  cardStroke: string;
  head: string;
  headText: string;
  text: string;
  muted: string;
  line: string;
  pk: string;
  fk: string;
  nn: string;
  select: string;
  rowAlt: string;
}

export const REL_LIGHT: RelPalette = {
  bg: "#ffffff",
  card: "#ffffff",
  cardStroke: "#cbd5e1",
  head: "#2563eb",
  headText: "#ffffff",
  text: "#0f172a",
  muted: "#64748b",
  line: "#64748b",
  pk: "#d97706",
  fk: "#7c3aed",
  nn: "#dc2626",
  select: "#6366f1",
  rowAlt: "#f8fafc",
};

export const REL_DARK: RelPalette = {
  bg: "#0b1120",
  card: "#111827",
  cardStroke: "#334155",
  head: "#1d4ed8",
  headText: "#ffffff",
  text: "#e2e8f0",
  muted: "#94a3b8",
  line: "#94a3b8",
  pk: "#fbbf24",
  fk: "#a78bfa",
  nn: "#f87171",
  select: "#818cf8",
  rowAlt: "#0f172a",
};

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";

export const rowY = (t: RelTable, i: number) => t.y + HEAD_H + i * ROW_H + ROW_H / 2;

interface Link {
  key: string;
  from: RelTable;
  fromIdx: number;
  to: RelTable;
  toIdx: number;
  many: boolean;
}

export function schemaLinks(s: RelSchema): Link[] {
  const byName = new Map(s.tables.map((t) => [t.name, t]));
  const out: Link[] = [];
  for (const t of s.tables) {
    t.columns.forEach((c, i) => {
      if (!c.ref) return;
      const to = byName.get(c.ref.table);
      if (!to) return;
      const toIdx = to.columns.findIndex((x) => x.name === c.ref!.column);
      const pkCount = t.columns.filter((x) => x.pk).length;
      const many = !(c.unique || (c.pk && pkCount === 1));
      out.push({ key: `${t.id}:${c.name}`, from: t, fromIdx: i, to, toIdx: Math.max(0, toIdx), many });
    });
  }
  return out;
}

function linkPath(l: Link): { d: string; a: { x: number; y: number }; b: { x: number; y: number }; aDir: number; bDir: number } {
  const fw = tableWidth(l.from);
  const tw = tableWidth(l.to);
  const ay = rowY(l.from, l.fromIdx);
  const by = rowY(l.to, l.toIdx);
  if (l.from === l.to) {
    const x = l.from.x + fw;
    const d = `M ${x} ${ay} C ${x + 60} ${ay}, ${x + 60} ${by}, ${x} ${by}`;
    return { d, a: { x, y: ay }, b: { x, y: by }, aDir: 1, bDir: 1 };
  }
  const fromCx = l.from.x + fw / 2;
  const toCx = l.to.x + tw / 2;
  let ax: number;
  let bx: number;
  let aDir: number;
  let bDir: number;
  if (l.to.x > l.from.x + fw + 20) {
    ax = l.from.x + fw;
    bx = l.to.x;
    aDir = 1;
    bDir = -1;
  } else if (l.to.x + tw + 20 < l.from.x) {
    ax = l.from.x;
    bx = l.to.x + tw;
    aDir = -1;
    bDir = 1;
  } else {
    // übereinander: beide Seiten gleich
    const right = fromCx < toCx ? false : true;
    ax = right ? l.from.x + fw : l.from.x;
    bx = right ? l.to.x + tw : l.to.x;
    aDir = bDir = right ? 1 : -1;
  }
  const c = Math.max(40, Math.abs(bx - ax) * 0.45);
  const d = `M ${ax} ${ay} C ${ax + aDir * c} ${ay}, ${bx + bDir * c} ${by}, ${bx} ${by}`;
  return { d, a: { x: ax, y: ay }, b: { x: bx, y: by }, aDir, bDir };
}

export function RelShapes({ schema, pal, selected, exportMode }: { schema: RelSchema; pal: RelPalette; selected?: string | null; exportMode?: boolean }) {
  const links = schemaLinks(schema);
  return (
    <g fontFamily={FONT}>
      {links.map((l) => {
        const p = linkPath(l);
        const hl = selected === l.from.id || selected === l.to.id;
        return (
          <g key={l.key}>
            <path d={p.d} fill="none" stroke={hl ? pal.select : pal.line} strokeWidth={hl ? 2 : 1.4} />
            <text x={p.a.x + p.aDir * 10} y={p.a.y - 7} textAnchor="middle" fontSize={13} fontWeight={700} fill={hl ? pal.select : pal.muted}>
              {l.many ? "*" : "1"}
            </text>
            <text x={p.b.x + p.bDir * 10} y={p.b.y - 7} textAnchor="middle" fontSize={12} fontWeight={700} fill={hl ? pal.select : pal.muted}>
              1
            </text>
            <circle cx={p.b.x} cy={p.b.y} r={3} fill={hl ? pal.select : pal.line} />
          </g>
        );
      })}
      {schema.tables.map((t) => (
        <TableView key={t.id} t={t} pal={pal} selected={selected === t.id} exportMode={exportMode} />
      ))}
    </g>
  );
}

function TableView({ t, pal, selected, exportMode }: { t: RelTable; pal: RelPalette; selected: boolean; exportMode?: boolean }) {
  const w = tableWidth(t);
  const h = tableHeight(t);
  const head = t.color || pal.head;
  return (
    <g data-table={exportMode ? undefined : t.id} style={exportMode ? undefined : { cursor: "move" }}>
      {selected && <rect x={t.x - 5} y={t.y - 5} width={w + 10} height={h + 10} rx={12} fill="none" stroke={pal.select} strokeWidth={2} strokeDasharray="5 4" />}
      <rect x={t.x} y={t.y + 2} width={w} height={h} rx={8} fill="#000" opacity={0.06} />
      <rect x={t.x} y={t.y} width={w} height={h} rx={8} fill={pal.card} stroke={pal.cardStroke} />
      <path d={`M ${t.x} ${t.y + HEAD_H} V ${t.y + 8} Q ${t.x} ${t.y} ${t.x + 8} ${t.y} H ${t.x + w - 8} Q ${t.x + w} ${t.y} ${t.x + w} ${t.y + 8} V ${t.y + HEAD_H} Z`} fill={head} />
      <text x={t.x + 12} y={t.y + HEAD_H / 2} dominantBaseline="central" fontSize={13.5} fontWeight={700} fill={pal.headText}>
        {t.name}
      </text>
      {t.columns.map((c, i) => {
        const y = t.y + HEAD_H + i * ROW_H;
        const cy = y + ROW_H / 2;
        return (
          <g key={i} data-col={exportMode ? undefined : `${t.id}:${i}`}>
            {i % 2 === 1 && <rect x={t.x + 1} y={y} width={w - 2} height={ROW_H} fill={pal.rowAlt} />}
            {c.pk && (
              <g transform={`translate(${t.x + 10} ${cy - 6})`}>
                <circle cx={4} cy={4} r={3.2} fill="none" stroke={pal.pk} strokeWidth={1.6} />
                <path d="M 6.5 6.5 L 11 11 M 9 9 L 10.5 7.5" stroke={pal.pk} strokeWidth={1.6} fill="none" strokeLinecap="round" />
              </g>
            )}
            {!c.pk && c.ref && (
              <text x={t.x + 16} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700} fill={pal.fk}>
                FK
              </text>
            )}
            <text
              x={t.x + 30}
              y={cy}
              dominantBaseline="central"
              fontSize={12.5}
              fontWeight={c.pk ? 650 : 450}
              fontStyle={c.ref && !c.pk ? "italic" : undefined}
              textDecoration={c.pk ? "underline" : undefined}
              fill={pal.text}
            >
              {c.name}
            </text>
            <text x={t.x + w - 12} y={cy} textAnchor="end" dominantBaseline="central" fontSize={11.5} fontFamily={MONO} fill={pal.muted}>
              {c.type}
              {c.notNull && !c.pk ? <tspan fill={pal.nn}> (!)</tspan> : null}
              {c.unique && !c.pk ? <tspan fill={pal.fk}> U</tspan> : null}
            </text>
            {!exportMode && <circle data-colhandle={`${t.id}:${i}`} cx={t.x + w} cy={cy} r={5} fill={pal.select} opacity={0} className="col-handle" style={{ cursor: "crosshair" }} />}
          </g>
        );
      })}
      {!t.columns.length && (
        <text x={t.x + 12} y={t.y + HEAD_H + ROW_H / 2} dominantBaseline="central" fontSize={12} fill={pal.muted} fontStyle="italic">
          keine Spalten
        </text>
      )}
    </g>
  );
}

export function relBounds(s: RelSchema) {
  if (!s.tables.length) return null;
  return {
    minX: Math.min(...s.tables.map((t) => t.x)),
    minY: Math.min(...s.tables.map((t) => t.y)),
    maxX: Math.max(...s.tables.map((t) => t.x + tableWidth(t))) + 40,
    maxY: Math.max(...s.tables.map((t) => t.y + tableHeight(t))),
  };
}

export function RelExportSvg({ schema, pal }: { schema: RelSchema; pal: RelPalette }) {
  const b = relBounds(schema) ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const pad = 40;
  const x = b.minX - pad;
  const y = b.minY - pad;
  const w = b.maxX - b.minX + pad * 2 + 40;
  const h = b.maxY - b.minY + pad * 2;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={w} height={h} viewBox={`${x} ${y} ${w} ${h}`}>
      <rect x={x} y={y} width={w} height={h} fill={pal.bg} />
      <RelShapes schema={schema} pal={pal} exportMode />
    </svg>
  );
}
