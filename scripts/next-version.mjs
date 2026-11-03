#!/usr/bin/env node
// Ermittelt die nächste Version anhand der Git-Tags und Commit-Nachrichten.
//
// Regeln:
//  - Tag-Push vX.Y.Z[-pre]            → genau diese Version (Pre-Release, wenn "-" enthalten)
//  - Push auf main/master             → stabile Version, Erhöhung nach Commits seit dem letzten Release:
//        "BREAKING CHANGE" oder "type!:" → Major, "feat:" → Minor, sonst (fix:, chore:, …) → Patch
//  - Push auf release/*               → Release-Candidate  X.Y.Z-rc.N
//  - Push auf jeden anderen Branch    → Pre-Release        X.Y.Z-beta.N
//  - Manuell (workflow_dispatch)      → BUMP=major|minor|patch|prerelease
//
// Ausgabe (für GitHub Actions): version=…, tag=…, prerelease=true|false

import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const parse = (s) => {
  const m = s.match(SEMVER);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null, raw: s } : null;
};
const cmp = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch;
const fmt = (v) => `${v.major}.${v.minor}.${v.patch}`;

const refType = process.env.GITHUB_REF_TYPE ?? "branch";
const refName = process.env.GITHUB_REF_NAME ?? sh("git rev-parse --abbrev-ref HEAD");
const bumpInput = (process.env.BUMP ?? "").trim();

let version;
let prerelease;

if (refType === "tag") {
  const v = parse(refName);
  if (!v) {
    console.error(`Tag "${refName}" ist keine gültige Version (erwartet vX.Y.Z)`);
    process.exit(1);
  }
  version = refName.replace(/^v/, "");
  prerelease = !!v.pre;
} else {
  const tags = sh("git tag --list 'v*'").split("\n").map(parse).filter(Boolean);
  const stable = tags.filter((t) => !t.pre).sort(cmp);
  const last = stable[stable.length - 1] ?? { major: 0, minor: 0, patch: 0, raw: null };

  const range = last.raw ? `${last.raw}..HEAD` : "HEAD";
  const log = sh(`git log ${range} --format=%B%x1e`);
  const commits = log.split("\x1e").map((c) => c.trim()).filter(Boolean);

  let bump = "patch";
  if (commits.some((c) => /BREAKING[ -]CHANGE/.test(c) || /^\w+(\([^)]*\))?!:/m.test(c))) bump = "major";
  else if (commits.some((c) => /^feat(\([^)]*\))?:/im.test(c))) bump = "minor";
  if (["major", "minor", "patch"].includes(bumpInput)) bump = bumpInput;
  // Vor 1.0.0: Breaking Changes erhöhen nur Minor
  if (last.major === 0 && bump === "major" && bumpInput !== "major") bump = "minor";
  if (!last.raw && !bumpInput) bump = "none";

  const next = { ...last };
  if (bump === "major") Object.assign(next, { major: last.major + 1, minor: 0, patch: 0 });
  else if (bump === "minor") Object.assign(next, { minor: last.minor + 1, patch: 0 });
  else if (bump === "patch") next.patch = last.patch + 1;
  else Object.assign(next, { major: 0, minor: 1, patch: 0 }); // allererstes Release

  const isMain = ["main", "master"].includes(refName);
  const wantPre = bumpInput === "prerelease" || !isMain;
  if (!wantPre) {
    version = fmt(next);
    prerelease = false;
  } else {
    const channel = refName.startsWith("release/") ? "rc" : "beta";
    const base = fmt(next);
    const nums = tags
      .filter((t) => fmt(t) === base && t.pre?.startsWith(`${channel}.`))
      .map((t) => Number(t.pre.split(".")[1]) || 0);
    const n = (nums.length ? Math.max(...nums) : 0) + 1;
    version = `${base}-${channel}.${n}`;
    prerelease = true;
  }
}

const out = { version, tag: `v${version}`, prerelease: String(prerelease) };
console.log(JSON.stringify(out));
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
}
