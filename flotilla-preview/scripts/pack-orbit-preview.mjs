#!/usr/bin/env node
/**
 * Build an orbit preview pack (UTF-8 safe).
 * Includes code + small same-origin textures (2K Earth, planets, moon)
 * and a curated sprites/ set (skip huge GIFs — those load via asset proxy).
 * GLTF / 8K / oversized sprites load via ops-mirror /asset-proxy/orbit
 * (CORS-safe reverse proxy to HostGator). Does not pack tle/.
 *
 *   node pack-orbit-preview.mjs <orbitSrc> <outDir>
 *   ORBIT_ASSET_BASE=https://...  (optional override)
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
const skipTexture = (name) =>
  name === "README.md" || /8k/i.test(name) || name === "tiles";
for (const ent of readdirSync(join(src, "textures"), { withFileTypes: true })) {
  if (!ent.isFile()) continue;
  if (skipTexture(ent.name)) continue;
  copyFileSync(join(src, "textures", ent.name), join(out, "textures", ent.name));
}

const spritesSrc = join(src, "sprites");
const packedSpriteNames = [];
if (existsSync(spritesSrc)) {
  mkdirSync(join(out, "sprites"), { recursive: true });
  const MAX_SPRITE_BYTES = 900 * 1024; // ~0.9 MB
  let skipped = 0;
  for (const ent of readdirSync(spritesSrc, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    const fp = join(spritesSrc, ent.name);
    const sz = statSync(fp).size;
    if (sz > MAX_SPRITE_BYTES) {
      skipped += 1;
      continue;
    }
    copyFileSync(fp, join(out, "sprites", ent.name));
    packedSpriteNames.push(ent.name);
  }
  console.log(
    `sprites packed: ${packedSpriteNames.length} (skipped ${skipped} oversized)`,
  );
}

// No tle/ — CelesTrak only; pack must not ship offline TLE fallbacks.

// UTF-8 only — never PowerShell Set-Content (mojibake).
// Default: CORS-friendly ops proxy (HG production has no Access-Control-Allow-Origin).
const assetBase = (
  process.env.ORBIT_ASSET_BASE ||
  "https://ops-mirror-production.up.railway.app/asset-proxy/orbit/"
).replace(/\/?$/, "/");
const html = readFileSync(join(src, "index.html"), "utf8");
const bridge = `<script>
/* orbit preview: 2K textures + packed sprites same-origin; oversized sprites/gltf/8k via ops CORS proxy → HG */
window.__ORBIT_ASSET_BASE__ = ${JSON.stringify(assetBase)};
window.__ORBIT_PACKED_SPRITES__ = ${JSON.stringify(packedSpriteNames)};
window.__ORBIT_HORIZONS_PROXY__ = ${JSON.stringify(
  (
    process.env.ORBIT_HORIZONS_PROXY ||
    "https://ops-mirror-production.up.railway.app/asset-proxy/horizons"
  ).replace(/\/?$/, ""),
)};
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
