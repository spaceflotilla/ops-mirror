#!/usr/bin/env node
/**
 * Pack a site directory as tar.gz and publish to ops-mirror snapshot storage.
 *
 *   node scripts/publish-preview.mjs --slug trades-amber-fox --dir ../trades
 *   INTERNAL_API_TOKEN=... ORCHESTRATOR_URL=https://ops-mirror-production.up.railway.app
 *
 * Keep packs small: exclude textures/, sprites/, videos, node_modules, .git
 */
import { createReadStream, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const slug = arg("--slug");
const dir = resolve(arg("--dir", "."));
const allow8k = process.argv.includes("--allow-8k");
const orch = (
  process.env.ORCHESTRATOR_URL ||
  "https://ops-mirror-production.up.railway.app"
).replace(/\/$/, "");
const token = process.env.INTERNAL_API_TOKEN;

if (!slug || !/^[a-z0-9][a-z0-9-]*-[a-z]+-[a-z]+$/.test(slug)) {
  console.error("Need --slug project-color-animal");
  process.exit(1);
}
if (!token) {
  console.error("Set INTERNAL_API_TOKEN");
  process.exit(1);
}
if (!existsSync(dir)) {
  console.error("Missing --dir", dir);
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "fp-pub-"));
const tarPath = join(tmp, `${slug}.tar.gz`);

// Exclude heavy / VCS paths so Railway volume stays small
const excludes = [
  "--exclude=.git",
  "--exclude=node_modules",
  "--exclude=textures/tiles",
  "--exclude=sprites",
  "--exclude=*.mp4",
  "--exclude=*.gltf",
  "--exclude=*.glb",
  "--exclude=_orbit-site-stage",
  "--exclude=rust_orbit/target",
];
if (!allow8k) excludes.push("--exclude=*8k*");

try {
  execFileSync(
    "tar",
    ["-czf", tarPath, "-C", dir, ...excludes, "."],
    { stdio: "inherit" },
  );
} catch {
  // Windows often lacks tar excludes the same way — try bsdtar / tar without excludes
  console.warn("tar with excludes failed; trying plain tar of directory");
  execFileSync("tar", ["-czf", tarPath, "-C", dir, "."], { stdio: "inherit" });
}

const buf = await new Promise((resolveBuf, reject) => {
  const chunks = [];
  createReadStream(tarPath)
    .on("data", (c) => chunks.push(c))
    .on("end", () => resolveBuf(Buffer.concat(chunks)))
    .on("error", reject);
});

console.log(`Uploading ${(buf.length / 1024 / 1024).toFixed(2)} MB → ${slug}`);

const res = await fetch(`${orch}/api/previews/${encodeURIComponent(slug)}/publish`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/gzip",
  },
  body: buf,
});
const text = await res.text();
console.log(res.status, text);
rmSync(tmp, { recursive: true, force: true });
if (!res.ok) process.exit(1);
