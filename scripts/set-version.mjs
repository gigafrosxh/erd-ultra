#!/usr/bin/env node
// Setzt die Version in package.json, tauri.conf.json und Cargo.toml.
// Aufruf: node scripts/set-version.mjs 1.2.3[-beta.1]

import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Aufruf: node scripts/set-version.mjs <version>");
  process.exit(1);
}

const json = (path, fn) => {
  const data = JSON.parse(readFileSync(path, "utf8"));
  fn(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};

json("package.json", (p) => (p.version = version));
json("src-tauri/tauri.conf.json", (c) => {
  c.version = version;
  // MSI erlaubt nur numerische Versionen → Pre-Release-Nummer als Build-Nummer
  const m = version.match(/^(\d+\.\d+\.\d+)(?:-[A-Za-z]+\.?(\d+))?/);
  c.bundle.windows = c.bundle.windows ?? {};
  c.bundle.windows.wix = { ...(c.bundle.windows.wix ?? {}), version: m[2] ? `${m[1]}.${m[2]}` : m[1] };
});
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").replace(/^version = ".*"$/m, `version = "${version}"`);
writeFileSync("src-tauri/Cargo.toml", cargo);
console.log(`Version gesetzt: ${version}`);
