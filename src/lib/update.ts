// Prüft beim Start, ob auf GitHub eine neuere Version veröffentlicht wurde.
// Stabile Versionen sehen nur stabile Releases, Beta-/RC-Versionen auch Pre-Releases.

export const APP_VERSION: string = __APP_VERSION__;
export const RELEASES_URL = "https://github.com/gigafrosxh/erd-ultra/releases";
const API_URL = "https://api.github.com/repos/gigafrosxh/erd-ultra/releases?per_page=30";

export interface UpdateInfo {
  version: string;
  url: string;
  prerelease: boolean;
}

interface Semver {
  main: [number, number, number];
  pre: (string | number)[];
}

export function parseVersion(v: string): Semver | null {
  const m = v.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  if (!m) return null;
  return {
    main: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

/** Vergleich nach SemVer: negativ, wenn a älter als b ist. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.main[i] !== y.main[i]) return x.main[i] - y.main[i];
  // Version ohne Pre-Release-Teil ist neuer als jede Pre-Release derselben Version
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    if (typeof p === "number") return -1;
    if (typeof q === "number") return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

interface GhRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

/** Neueste passende Version, die neuer als `current` ist – sonst null. */
export function pickUpdate(releases: GhRelease[], current: string): UpdateInfo | null {
  const wantPre = (parseVersion(current)?.pre.length ?? 0) > 0;
  let best: UpdateInfo | null = null;
  for (const r of releases) {
    if (r.draft || (r.prerelease && !wantPre) || !parseVersion(r.tag_name)) continue;
    const version = r.tag_name.replace(/^v/, "");
    if (compareVersions(version, current) > 0 && (!best || compareVersions(version, best.version) > 0)) {
      best = { version, url: r.html_url, prerelease: r.prerelease };
    }
  }
  return best;
}

export async function checkForUpdate(current = APP_VERSION): Promise<UpdateInfo | null> {
  const res = await fetch(API_URL, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status}`);
  return pickUpdate((await res.json()) as GhRelease[], current);
}
