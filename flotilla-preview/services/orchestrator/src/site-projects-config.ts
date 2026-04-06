import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

function parseProjectsEnv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function loadSiteProjectPaths(): Promise<string[]> {
  const envList = parseProjectsEnv(process.env.GITLAB_SITE_PROJECTS);
  if (envList.length > 0) return dedupe(envList);

  const configPath =
    process.env.SITE_PROJECTS_CONFIG?.trim() ||
    join(__dirname, "..", "..", "..", "config", "site-projects.json");

  try {
    const raw = await readFile(configPath, "utf-8");
    const json = JSON.parse(raw) as { projects?: unknown };
    const arr = Array.isArray(json.projects) ? json.projects : [];
    const paths = arr.filter((x): x is string => typeof x === "string");
    return dedupe(
      paths.map((p) => p.trim().replace(/\.git$/i, "")),
    );
  } catch {
    return [];
  }
}

function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const n = p.trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
