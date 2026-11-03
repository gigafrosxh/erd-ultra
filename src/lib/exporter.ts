import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export function elementToSvgString(el: ReactElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${renderToStaticMarkup(el)}`;
}

/** SVG-Text → PNG-Bytes (Skalierung für hohe Auflösung). */
export async function svgToPng(svg: string, scale = 2): Promise<Uint8Array> {
  const m = svg.match(/<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/);
  const w = Number(m?.[1] ?? 800);
  const h = Number(m?.[2] ?? 600);
  // Begrenzung gegen zu große Canvas-Flächen
  const maxSide = 16000;
  const s = Math.min(scale, maxSide / w, maxSide / h);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG konnte nicht gerendert werden"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * s);
    canvas.height = Math.ceil(h * s);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(s, s);
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG-Export fehlgeschlagen"))), "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
