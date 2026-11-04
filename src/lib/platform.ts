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

/** Datei, die das Betriebssystem bei laufender App übergibt (macOS: Doppelklick im Finder) */
export function onFileOpened(fn: (path: string) => void): () => void {
  if (!isTauri) return () => {};
  let off: (() => void) | null = null;
  let stopped = false;
  import("@tauri-apps/api/event").then(({ listen }) =>
    listen("file-opened", async () => {
      const p = await invoke<string | null>("take_opened_file").catch(() => null);
      if (p) fn(p);
    }).then((u) => (stopped ? u() : (off = u))),
  );
  return () => {
    stopped = true;
    off?.();
  };
}

/** Schließen des Fensters abfangen. `allow` entscheidet, ob das Fenster wirklich geschlossen wird. */
export function onCloseRequested(allow: () => boolean | Promise<boolean>): () => void {
  // Browser und IDE-Plugin: der Autosave bzw. die IDE sichern den Stand
  if (!isTauri) return () => {};
  let off: (() => void) | null = null;
  let stopped = false;
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
    getCurrentWindow()
      .onCloseRequested(async (e) => {
        if (!(await allow())) e.preventDefault();
      })
      .then((u) => (stopped ? u() : (off = u))),
  );
  return () => {
    stopped = true;
    off?.();
  };
}

/** Ja/Nein-Rückfrage – nativ in der Desktop-App, sonst im Browser-Dialog */
export async function confirmDialog(message: string, okLabel = "Verwerfen"): Promise<boolean> {
  if (!isTauri) return confirm(message);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, { title: "ERD-Ultra", kind: "warning", okLabel, cancelLabel: "Abbrechen" });
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

/**
 * Neue Version direkt herunterladen, installieren und die App neu starten (Desktop-App).
 * Gibt false zurück, wenn kein passendes signiertes Update-Paket bereitsteht.
 */
export async function installUpdate(onProgress: (fraction: number | null) => void): Promise<boolean> {
  if (!isTauri) return false;
  // Erst prüfen, ob die App an ihrem Ort ersetzt werden kann – sonst scheitert es erst nach dem Download
  const problem = await invoke<string | null>("update_install_problem").catch(() => null);
  if (problem) throw new Error(problem);
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return false;
  let total = 0;
  let done = 0;
  await update.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength ?? 0;
    else if (e.event === "Progress") {
      done += e.data.chunkLength;
      onProgress(total ? done / total : null);
    } else onProgress(1);
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
  return true;
}

/** Technische Updater-Fehlermeldung um einen verständlichen Hinweis ergänzen */
export function explainUpdateError(raw: string): string {
  const hints: [RegExp, string][] = [
    [/read-only file system|os error 30/i, "Die App liegt an einem schreibgeschützten Ort (z. B. im geöffneten DMG). Zieh sie in den Ordner „Programme“ und starte sie von dort."],
    [/not on the same mount point/i, "Die App liegt auf einem anderen Laufwerk als der temporäre Ordner. Zieh sie in den Ordner „Programme“ und starte sie von dort."],
    [/authentication failed|cancel|move the new app into place/i, "Für den Ordner der App sind Administratorrechte nötig, die Passwortabfrage wurde abgebrochen oder ist fehlgeschlagen."],
    [/signature|minisign/i, "Das Update-Paket ist nicht korrekt signiert. Bitte die neue Version von der Release-Seite installieren."],
    [/permission denied|operation not permitted|os error 1\b|os error 13/i, "Keine Schreibrechte für den Ordner der App. Zieh sie in den Ordner „Programme“ oder installiere die neue Version von der Release-Seite."],
  ];
  const hint = hints.find(([re]) => re.test(raw))?.[1];
  return hint ? `${hint}\n\nTechnische Meldung: ${raw}` : raw;
}

/** Release-Seite im System-Browser öffnen */
export async function openReleasePage(url: string): Promise<void> {
  if (ide) await ide.call("openUrl", { url });
  else if (isTauri) await invoke("open_release_page", { url });
  else window.open(url, "_blank", "noopener");
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
