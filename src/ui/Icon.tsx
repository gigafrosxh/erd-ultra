// Kleine Icon-Sammlung (Linien-Icons, 24×24)

const P: Record<string, string> = {
  pointer: "M5 3l13 7-6 1.5L9.5 18z",
  plus: "M12 5v14M5 12h14",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  save: "M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v6h8V3M7 21v-7h10v7",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5a1.5 1.5 0 1 1 0-.01",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  sun: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  fit: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  zoomIn: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4M8 11h6M11 8v6",
  zoomOut: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4M8 11h6",
  layout: "M4 4h6v6H4zM14 14h6v6h-6zM10 7h4a3 3 0 0 1 3 3v4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  code: "M8 8l-5 4 5 4M16 8l5 4-5 4M14 4l-4 16",
  table: "M4 5h16v14H4zM4 10h16M10 10v9",
  database: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  diagram: "M3 6h7v5H3zM14 13h7v5h-7zM6.5 11v4.5H14",
  sparkles: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z",
  refresh: "M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4",
  copy: "M8 8h11v13H8zM5 16H4V3h11v1",
  x: "M6 6l12 12M18 6L6 18",
  chevron: "M6 9l6 6 6-6",
  book: "M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z",
  panel: "M4 4h16v16H4zM14 4v16",
  key: "M15 4a5 5 0 1 1-4.9 6L4 16v4h4v-2h2v-2h2l1.9-1.9A5 5 0 0 1 15 4zM16.5 7.5h.01",
  info: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8h.01",
  play: "M7 4l12 8-12 8z",
};

export function Icon({ name, size = 18, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? ""} />
    </svg>
  );
}

/** Mini-Vorschau der Chen-Symbole für die Werkzeugleiste */
export function ShapeIcon({ kind }: { kind: string }) {
  const s = { stroke: "currentColor", strokeWidth: 1.6, fill: "none" } as const;
  switch (kind) {
    case "select":
      return <Icon name="pointer" />;
    case "connect":
      return <Icon name="link" />;
    case "entity":
      return <svg width={26} height={18} viewBox="0 0 26 18"><rect x={1.5} y={2.5} width={23} height={13} rx={1.5} {...s} fill="var(--er-entity)" /></svg>;
    case "weak":
      return <svg width={26} height={18} viewBox="0 0 26 18"><rect x={1.5} y={2.5} width={23} height={13} rx={1.5} {...s} fill="var(--er-entity)" /><rect x={4.5} y={5.5} width={17} height={7} {...s} strokeWidth={1.1} /></svg>;
    case "associative":
      return <svg width={26} height={18} viewBox="0 0 26 18"><rect x={1.5} y={1.5} width={23} height={15} rx={1.5} {...s} fill="var(--er-entity)" /><polygon points="13,3.5 21.5,9 13,14.5 4.5,9" {...s} strokeWidth={1.1} fill="var(--er-rel)" /></svg>;
    case "relationship":
      return <svg width={26} height={18} viewBox="0 0 26 18"><polygon points="13,1.5 24.5,9 13,16.5 1.5,9" {...s} fill="var(--er-rel)" /></svg>;
    case "identifying":
      return <svg width={26} height={18} viewBox="0 0 26 18"><polygon points="13,1.5 24.5,9 13,16.5 1.5,9" {...s} fill="var(--er-rel)" /><polygon points="13,5 19,9 13,13 7,9" {...s} strokeWidth={1.1} /></svg>;
    case "attribute":
      return <svg width={26} height={18} viewBox="0 0 26 18"><ellipse cx={13} cy={9} rx={11.5} ry={7} {...s} /></svg>;
    case "key":
      return <svg width={26} height={18} viewBox="0 0 26 18"><ellipse cx={13} cy={9} rx={11.5} ry={7} {...s} /><line x1={8} y1={11} x2={18} y2={11} {...s} /></svg>;
    case "multivalued":
      return <svg width={26} height={18} viewBox="0 0 26 18"><ellipse cx={13} cy={9} rx={11.5} ry={7} {...s} /><ellipse cx={13} cy={9} rx={8} ry={4} {...s} strokeWidth={1.1} /></svg>;
    case "derived":
      return <svg width={26} height={18} viewBox="0 0 26 18"><ellipse cx={13} cy={9} rx={11.5} ry={7} {...s} strokeDasharray="3 2.4" /></svg>;
    case "isa":
      return <svg width={26} height={18} viewBox="0 0 26 18"><circle cx={13} cy={9} r={7.5} {...s} fill="var(--er-isa)" /><text x={13} y={12.5} fontSize={9.5} fontWeight={700} textAnchor="middle" fill="currentColor">d</text></svg>;
    case "note":
      return <svg width={26} height={18} viewBox="0 0 26 18"><path d="M3 2.5h15l5 5v8H3z" {...s} fill="var(--er-note)" /></svg>;
    default:
      return null;
  }
}
