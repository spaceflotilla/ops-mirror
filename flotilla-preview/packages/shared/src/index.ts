import { z } from "zod";

export {
  isEmailAllowed,
  parseList,
} from "./auth-allowlist.js";

export {
  HANDOFF_QUERY,
  appendHandoffToUrl,
  createHandoffToken,
  stripHandoffFromUrl,
  verifyHandoffToken,
} from "./handoff.js";

/** Path segment: project-color-animal (lowercase kebab) */
export const PREVIEW_SLUG_REGEX =
  /^[a-z0-9][a-z0-9-]*-[a-z]+-[a-z]+$/;

export const PreviewStatusSchema = z.enum([
  "pending",
  "building",
  "ready",
  "failed",
  "archived",
]);

export type PreviewStatus = z.infer<typeof PreviewStatusSchema>;

/** User-set label to distinguish branches of the same project (not deploy state). */
export const PreviewFlagSchema = z.enum([
  "latest",
  "production",
  "prototype",
  "deprecated",
  "broken",
]);

export type PreviewFlag = z.infer<typeof PreviewFlagSchema>;

export const PREVIEW_FLAG_LABELS: Record<PreviewFlag, string> = {
  latest: "Latest",
  production: "Production",
  prototype: "Prototype",
  deprecated: "Deprecated",
  broken: "Broken",
};

export const PreviewEntrySchema = z.object({
  slug: z.string().regex(PREVIEW_SLUG_REGEX),
  /** GitLab project path, e.g. flotilla/orbit */
  projectPath: z.string(),
  /** Branch name as pushed */
  branch: z.string(),
  commitSha: z.string().optional(),
  commitTitle: z.string().optional(),
  /** Human summary for tiles (defaults to commit title) */
  description: z.string().optional(),
  /** Where the static / SSR preview actually runs (Railway public URL) */
  targetUrl: z.string().url(),
  status: PreviewStatusSchema,
  archived: z.boolean(),
  /** Curated branch role — auto Latest or set by humans in the dashboard */
  flag: PreviewFlagSchema.optional(),
  /**
   * When true, `flag` was set by a human and must not be overwritten by
   * auto-Latest reconciliation (except clearing auto Latest from siblings).
   */
  flagManual: z.boolean().optional(),
  /** ISO timestamps */
  createdAt: z.string(),
  updatedAt: z.string(),
  lastDeployAt: z.string().optional(),
  lastError: z.string().optional(),
  /** When a tile screenshot was last captured for this preview */
  screenshotAt: z.string().optional(),
});

export type PreviewEntry = z.infer<typeof PreviewEntrySchema>;

export const RegistryFileSchema = z.object({
  version: z.literal(1),
  previews: z.record(z.string(), PreviewEntrySchema),
});

export type RegistryFile = z.infer<typeof RegistryFileSchema>;

/**
 * Branch names must look like: orbit-green-apple or fundraise-pipeline-red-fox
 * (project slug may contain hyphens; last two segments are color + animal)
 */
export function branchToSlug(branch: string): string | null {
  const b = branch.trim().toLowerCase();
  const parts = b.split("-").filter(Boolean);
  if (parts.length < 3) return null;
  const animal = parts[parts.length - 1]!;
  const color = parts[parts.length - 2]!;
  const projectParts = parts.slice(0, -2);
  if (projectParts.length === 0) return null;
  const project = projectParts.join("-");
  const slug = `${project}-${color}-${animal}`;
  return PREVIEW_SLUG_REGEX.test(slug) ? slug : null;
}

export function parseGitRefToBranch(ref: string): string | null {
  const prefix = "refs/heads/";
  if (!ref.startsWith(prefix)) return null;
  return ref.slice(prefix.length);
}
