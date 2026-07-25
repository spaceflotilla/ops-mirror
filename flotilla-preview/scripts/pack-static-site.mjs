#!/usr/bin/env node
/**
 * Build a Railway static-site pack: site/ + Dockerfile + railway.toml
 * Usage: node pack-static-site.mjs <deployRoot> <siteSourceDir> [--spa]
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const deployRoot = resolve(process.argv[2] || "");
const siteSource = resolve(process.argv[3] || "");
const spa = process.argv.includes("--spa");

if (!deployRoot || !siteSource) {
  console.error("Usage: node pack-static-site.mjs <deployRoot> <siteSourceDir> [--spa]");
  process.exit(1);
}
if (!existsSync(siteSource)) {
  console.error("Missing site source:", siteSource);
  process.exit(1);
}

rmSync(deployRoot, { recursive: true, force: true });
mkdirSync(join(deployRoot, "site"), { recursive: true });
cpSync(siteSource, join(deployRoot, "site"), { recursive: true });

const serveCmd = spa
  ? 'serve -s site -l tcp://0.0.0.0:${PORT}'
  : 'serve site -l tcp://0.0.0.0:${PORT}';

const dockerfile = [
  "FROM node:22-bookworm-slim",
  "WORKDIR /app",
  "RUN npm install -g serve@14",
  "COPY site ./site",
  "ENV PORT=3000",
  "EXPOSE 3000",
  `CMD ["sh", "-c", "${serveCmd}"]`,
  "",
].join("\n");

writeFileSync(join(deployRoot, "Dockerfile"), dockerfile);

writeFileSync(
  join(deployRoot, "railway.toml"),
  `[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/"
healthcheckTimeout = 90
restartPolicyType = "ON_FAILURE"
`,
);

console.log("Packed", siteSource, "->", deployRoot, spa ? "(SPA)" : "(static)");
