// Dateizugriff: nativ über Tauri, im JetBrains-Plugin über die IDE-Brücke,
// im Browser über Download / Datei-Auswahl.

import { invoke } from "@tauri-apps/api/core";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Vom JetBrains-Plugin vor dem App-Start eingebundene Brücke (siehe jetbrains-plugin/). */
export interface IdeHost {
  /** "editor": eingebettet in einen Editor-Tab einer .erdu-Datei, "toolwindow": eigenes Tool-Fenster */
  mode: "editor" | "toolwindow";
  dark: boolean;
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  on(event: string, fn: (payload: any) => void): () => void;
}

export const ide: IdeHost | null = (typeof window !== "undefined" && (window as any).__ERDU_IDE__) || null;
export const isIde = ide !== null;

// Trackpad-Pinch aus der IDE als Strg+Mausrad weitergeben – die Zeichenflächen zoomen darauf bereits
// (Faktor wie in ui/viewport.ts: exp(-deltaY · 0.0025 · 2.5))
ide?.on("pinch", ({ factor, x, y }: { factor: number; x: number; y: number }) => {
  document.elementFromPoint(x, y)?.dispatchEvent(
    new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, clientX: x, clientY: y, deltaY: -Math.log(factor) / 0.00625 }),
  );
});
/** Dateien können direkt per Pfad gelesen/geschrieben werden */
export const hasFileSystem = isTauri || isIde;

export interface FileFilter {
  name: string;
  extensions: string[];
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function browserDownload(name: string, data: string | Uint8Array, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Speichern-Dialog. Gibt den Pfad (bzw. Dateinamen im Browser) zurück oder null bei Abbruch. */
export async function saveFileAs(defaultName: string, filters: FileFilter[], data: string | Uint8Array, mime = "application/octet-stream"): Promise<string | null> {
  if (ide) {
    return ide.call<string | null>("saveFileAs", { defaultName, filters, ...encode(data) });
  }
  if (!isTauri) {
    browserDownload(defaultName, data, mime);
    return defaultName;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: defaultName, filters });
  if (!path) return null;
  await writeFileTo(path, data);
  return path;
}

function encode(data: string | Uint8Array) {
  return typeof data === "string" ? { text: data } : { base64: toBase64(data) };
}

export async function writeFileTo(path: string, data: string | Uint8Array): Promise<void> {
  if (ide) {
    await ide.call("writeFile", { path, ...encode(data) });
    return;
  }
  if (!isTauri) throw new Error("Direktes Schreiben nur in der Desktop-App möglich");
  if (typeof data === "string") await invoke("write_text_file", { path, contents: data });
  else await invoke("write_binary_file", { path, base64: toBase64(data) });
}

export async function openFile(filters: FileFilter[]): Promise<{ path: string; name: string; text: string } | null> {
  if (ide) {
    const f = await ide.call<{ path: string; text: string } | null>("openFile", { filters });
    return f && { path: f.path, name: baseName(f.path), text: f.text };
  }
  if (!isTauri) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        resolve({ path: f.name, name: f.name, text: await f.text() });
      };
      input.click();
    });
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ multiple: false, directory: false, filters });
  if (!path || Array.isArray(path)) return null;
  const text = await invoke<string>("read_text_file", { path });
  return { path, name: baseName(path), text };
}

export async function readFileAt(path: string): Promise<string> {
  if (ide) return ide.call<string>("readFile", { path });
  return invoke<string>("read_text_file", { path });
}

/** Über das Betriebssystem übergebene Datei (Doppelklick auf .erdu) */
export async function startupFile(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return await invoke<string | null>("startup_file");
  } catch {
    return null;
  }
}

export async function setWindowTitle(title: string) {
  document.title = title;
  if (!isTauri) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  } catch {
    /* ignorieren */
  }
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
