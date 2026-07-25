#!/usr/bin/env node
/**
 * Build a same-origin orbit preview pack (UTF-8 safe).
 * Includes code, planet + 2K/8K earth textures, bump, and local TLE fallbacks.
 * Excludes sprites/tiles (too large / HostGator CORS).
 *
 *   node pack-orbit-preview.mjs <orbitSrc> <outDir>
 */
import {
  cpSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  copyFileSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

const src = resolve(process.argv[2] || "");
const out = resolve(process.argv[3] || "");

if (!src || !out || !existsSync(join(src, "index.html"))) {
  console.error("Usage: node pack-orbit-preview.mjs <orbitSrc> <outDir>");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const name of ["satellite-visualization.js"]) {
  cpSync(join(src, name), join(out, name));
}
if (existsSync(join(src, "src"))) {
  cpSync(join(src, "src"), join(out, "src"), { recursive: true });
}
const pkg = join(src, "rust_orbit", "pkg");
if (existsSync(pkg)) {
  cpSync(pkg, join(out, "rust_orbit", "pkg"), { recursive: true });
}

mkdirSync(join(out, "textures"), { recursive: true });
for (const ent of readdirSync(join(src, "textures"), { withFileTypes: true })) {
  if (!ent.isFile()) continue;
  if (ent.name === "README.md") continue;
  copyFileSync(join(src, "textures", ent.name), join(out, "textures", ent.name));
}

const tleSrc = join(src, "tle");
if (existsSync(tleSrc)) {
  mkdirSync(join(out, "tle"), { recursive: true });
  for (const ent of readdirSync(tleSrc, { withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.endsWith(".tle")) continue;
    copyFileSync(join(tleSrc, ent.name), join(out, "tle", ent.name));
  }
}

// UTF-8 only — never PowerShell Set-Content (mojibake).
// No HostGator rewrite: pack is self-contained for textures + TLE.
const html = readFileSync(join(src, "index.html"), "utf8");
const bridge = `<script>
/* orbit preview: same-origin assets (textures/, tle/); no HG rewrite */
window.__ORBIT_ASSET_BASE__ = "";
</script>
`;
const injected = html.includes("<head>")
  ? html.replace("<head>", `<head>\n${bridge}`)
  : bridge + html;
writeFileSync(join(out, "index.html"), injected, "utf8");

function dirBytes(p) {
  let n = 0;
  for (const ent of readdirSync(p, { withFileTypes: true })) {
    const fp = join(p, ent.name);
    if (ent.isDirectory()) n += dirBytes(fp);
    else n += statSync(fp).size;
  }
  return n;
}
console.log(
  `orbit pack → ${out} (${(dirBytes(out) / 1024 / 1024).toFixed(2)} MB)`,
);
