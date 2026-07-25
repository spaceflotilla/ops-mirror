import type { PreviewEntry } from "@flotilla/shared";
import { snapshotPublicUrl } from "./preview-snapshots.js";

/**
 * Map GitLab path_with_namespace → deployed site URL (legacy shared hosts).
 * Format: web/orbit=https://...,web/trades=https://...
 * Prefer per-slug snapshots at {AUTH_PUBLIC_BASE_URL}/p/{slug}/ when enabled.
 */
export function parsePreviewUrlByProject(
  raw: string | undefined = process.env.PREVIEW_URL_BY_PROJECT,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw?.trim()) return out;
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim().replace(/\/$/, "");
    if (key && val) out[key] = val;
  }
  return out;
}

/** Derive project key from slug: orbit-cyan-otter → orbit */
export function projectKeyFromSlug(slug: string): string | null {
  const parts = slug.split("-").filter(Boolean);
  if (parts.length < 3) return null;
  return parts.slice(0, -2).join("-");
}

export function snapshotModeEnabled(): boolean {
  // Default on: versioned /p/{slug}/ on orchestrator volume (cheap history).
  return process.env.PREVIEW_SNAPSHOT_MODE !== "0";
}

/**
 * Resolve target URL for a preview entry.
 * Snapshot mode → https://ops…/p/{slug}/ (content published separately).
 * Else fall back to PREVIEW_URL_BY_PROJECT / template.
 */
export function computeTargetUrl(
  slug: string,
  projectPath?: string,
): string {
  if (snapshotModeEnabled()) {
    const base = (
      process.env.AUTH_PUBLIC_BASE_URL ?? "http://127.0.0.1:3101"
    ).replace(/\/$/, "");
    return snapshotPublicUrl(base, slug);
  }

  const byProject = parsePreviewUrlByProject();
  if (projectPath && byProject[projectPath]) {
    return byProject[projectPath];
  }
  const key = projectKeyFromSlug(slug);
  if (key) {
    const asWeb = `web/${key}`;
    if (byProject[asWeb]) return byProject[asWeb];
    if (byProject[key]) return byProject[key];
  }
  const template =
    process.env.PREVIEW_TARGET_URL_TEMPLATE ??
    "https://preview-{slug}.example.invalid";
  return template.replaceAll("{slug}", slug);
}

export function applyDeployStub(
  entry: PreviewEntry,
  opts?: { snapshotReady?: boolean },
): PreviewEntry {
  const now = new Date().toISOString();
  const description =
    entry.description?.trim() ||
    entry.commitTitle?.trim() ||
    undefined;
  const ready = opts?.snapshotReady === true;
  return {
    ...entry,
    description,
    targetUrl: computeTargetUrl(entry.slug, entry.projectPath),
    status: ready ? "ready" : snapshotModeEnabled() ? "building" : "ready",
    updatedAt: now,
    lastDeployAt: ready ? now : entry.lastDeployAt,
    lastError: undefined,
  };
}
