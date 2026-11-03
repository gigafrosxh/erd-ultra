import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

export interface View {
  x: number;
  y: number;
  k: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function useViewport(svgRef: RefObject<SVGSVGElement | null>, initial: View = { x: 80, y: 80, k: 1 }) {
  const [view, setView] = useState<View>(initial);
  const viewRef = useRef(view);
  viewRef.current = view;

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = svgRef.current!.getBoundingClientRect();
      const v = viewRef.current;
      return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
    },
    [svgRef],
  );

  const toScreen = useCallback(
    (wx: number, wy: number) => {
      const r = svgRef.current?.getBoundingClientRect();
      const v = viewRef.current;
      return { x: (r?.left ?? 0) + wx * v.k + v.x, y: (r?.top ?? 0) + wy * v.k + v.y };
    },
    [svgRef],
  );

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const r = svgRef.current?.getBoundingClientRect();
      const px = cx ?? (r ? r.width / 2 : 0);
      const py = cy ?? (r ? r.height / 2 : 0);
      const k = Math.min(4, Math.max(0.1, v.k * factor));
      const f = k / v.k;
      return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    });
  }, [svgRef]);

  /** Inhalt einpassen. `insets`: von überlagernden Leisten belegte Ränder (px), die frei bleiben sollen. */
  const fit = useCallback(
    (b: Bounds | null, maxZoom = 1.2, insets: Partial<Record<"left" | "right" | "top" | "bottom", number>> = {}) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const { left = 0, right = 0, top = 0, bottom = 0 } = insets;
      const aw = Math.max(100, r.width - left - right);
      const ah = Math.max(100, r.height - top - bottom);
      if (!b) {
        setView({ x: left + aw / 2, y: top + ah / 2, k: 1 });
        return;
      }
      const pad = 40;
      const w = b.maxX - b.minX || 1;
      const h = b.maxY - b.minY || 1;
      const k = Math.max(0.1, Math.min(maxZoom, (aw - pad * 2) / w, (ah - pad * 2) / h));
      setView({ k, x: left + (aw - w * k) / 2 - b.minX * k, y: top + (ah - h * k) / 2 - b.minY * k });
    },
    [svgRef],
  );

  // Mausrad/Trackpad: Scrollen = Zoom zur Mausposition, Shift + Rad = verschieben
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const m = e.deltaMode === 1 ? 16 : 1;
        // Shift: vertikales Rad verschiebt waagrecht, Trackpad in beide Richtungen
        const dx = e.deltaX || e.deltaY;
        const dy = e.deltaX ? e.deltaY : 0;
        setView((v) => ({ ...v, x: v.x - dx * m, y: v.y - dy * m }));
        return;
      }
      const delta = e.deltaY || (e.ctrlKey || e.metaKey ? 0 : e.deltaX);
      const factor = Math.exp(-delta * (e.deltaMode === 1 ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey ? 2.5 : 1));
      zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef, zoomAt]);

  return { view, setView, toWorld, toScreen, zoomAt, fit };
}
