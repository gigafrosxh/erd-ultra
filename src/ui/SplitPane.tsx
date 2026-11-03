import { type ReactNode, useEffect, useRef, useState } from "react";

/** Zweigeteilter Bereich mit verschiebbarem Trenner (Anteil wird gespeichert). */
export function SplitPane({ children, initial = 0.65, storageKey, min = 0.25, max = 0.85 }: { children: [ReactNode, ReactNode]; initial?: number; storageKey: string; min?: number; max?: number }) {
  const [ratio, setRatio] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`split:${storageKey}`));
      return v > 0 && v < 1 ? v : initial;
    } catch {
      return initial;
    }
  });
  const host = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(`split:${storageKey}`, String(ratio));
    } catch {
      /* ignorieren */
    }
  }, [ratio, storageKey]);

  return (
    <div className="split" ref={host}>
      <div className="split-a" style={{ flexBasis: `${ratio * 100}%` }}>
        {children[0]}
      </div>
      <div
        className="split-handle"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragging.current || !host.current) return;
          const r = host.current.getBoundingClientRect();
          setRatio(Math.min(max, Math.max(min, (e.clientX - r.left) / r.width)));
        }}
        onPointerUp={() => (dragging.current = false)}
      />
      <div className="split-b">{children[1]}</div>
    </div>
  );
}
