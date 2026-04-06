import type { PreviewEntry } from "@flotilla/shared";

/**
 * MVP: no Railway API yet — builds a deterministic target URL you can replace
 * once Railway deploy automation is wired (see README).
 */
export function computeTargetUrl(slug: string): string {
  const template =
    process.env.PREVIEW_TARGET_URL_TEMPLATE ??
    "https://preview-{slug}.example.invalid";
  return template.replaceAll("{slug}", slug);
}

export function applyDeployStub(entry: PreviewEntry): PreviewEntry {
  const now = new Date().toISOString();
  return {
    ...entry,
    targetUrl: computeTargetUrl(entry.slug),
    status: "ready",
    updatedAt: now,
    lastDeployAt: now,
    lastError: undefined,
  };
}
