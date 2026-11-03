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

  const fit = useCallback(
    (b: Bounds | null, maxZoom = 1.2) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!b) {
        setView({ x: r.width / 2, y: r.height / 2, k: 1 });
        return;
      }
      const pad = 60;
      const w = b.maxX - b.minX || 1;
      const h = b.maxY - b.minY || 1;
      const k = Math.max(0.1, Math.min(maxZoom, (r.width - pad * 2) / w, (r.height - pad * 2) / h));
      setView({ k, x: (r.width - w * k) / 2 - b.minX * k, y: (r.height - h * k) / 2 - b.minY * k });
    },
    [svgRef],
  );

  // Mausrad/Trackpad: Strg/⌘ + Rad = Zoom, sonst verschieben
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey ? 2.5 : 1));
        zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
      } else {
        const m = e.deltaMode === 1 ? 16 : 1;
        setView((v) => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX) * m, y: v.y - (e.shiftKey ? 0 : e.deltaY) * m }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef, zoomAt]);

  return { view, setView, toWorld, toScreen, zoomAt, fit };
}
