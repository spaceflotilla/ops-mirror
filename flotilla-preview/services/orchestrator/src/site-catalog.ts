import type { PreviewEntry } from "@flotilla/shared";
import { branchToSlug } from "@flotilla/shared";
import type { RegistryStore } from "./registry-store.js";
import {
  fetchBranches,
  fetchProject,
  isGitLabConfigured,
} from "./gitlab-client.js";
import { loadSiteProjectPaths } from "./site-projects-config.js";

export type SiteBranchRow = {
  name: string;
  slug: string | null;
  commitSha?: string;
  commitTitle?: string;
  previewCapable: boolean;
  inRegistry: boolean;
  preview?: PreviewEntry | null;
  gitlabBranchUrl: string;
};

export type SiteProjectCatalog = {
  path: string;
  webUrl?: string;
  defaultBranch?: string | null;
  error?: string;
  branches: SiteBranchRow[];
};

export type SiteCatalogResponse = {
  gitlabConfigured: boolean;
  gitlabBaseUrl: string;
  refreshedAt: string;
  projects: SiteProjectCatalog[];
  message?: string;
};

const TTL_MS = 120_000;
let cache: { expires: number; data: SiteCatalogResponse } | null = null;

export function invalidateSiteCatalogCache(): void {
  cache = null;
}

export async function getSiteCatalog(
  store: RegistryStore,
  forceRefresh: boolean,
): Promise<SiteCatalogResponse> {
  const now = Date.now();
  if (!forceRefresh && cache && cache.expires > now) {
    return cache.data;
  }

  const paths = await loadSiteProjectPaths();
  const gitlabBaseUrl = (
    process.env.GITLAB_URL ?? "https://gitlab.flotilla.space"
  ).replace(/\/$/, "");

  if (paths.length === 0) {
    const data: SiteCatalogResponse = {
      gitlabConfigured: isGitLabConfigured(),
      gitlabBaseUrl,
      refreshedAt: new Date().toISOString(),
      projects: [],
      message:
        "No site projects configured. Add paths to config/site-projects.json or set GITLAB_SITE_PROJECTS.",
    };
    cache = { expires: now + TTL_MS, data };
    return data;
  }

  if (!isGitLabConfigured()) {
    const data: SiteCatalogResponse = {
      gitlabConfigured: false,
      gitlabBaseUrl,
      refreshedAt: new Date().toISOString(),
      projects: paths.map((path) => ({
        path,
        branches: [],
        error:
          "GitLab token not configured — set GITLAB_ACCESS_TOKEN on the orchestrator.",
      })),
      message:
        "Set GITLAB_ACCESS_TOKEN (read_api) to load branches from GitLab. Site project paths still come from config/site-projects.json or GITLAB_SITE_PROJECTS.",
    };
    cache = { expires: now + TTL_MS, data };
    return data;
  }

  // Railway (public cloud) cannot resolve VPN-only / private DNS for GitLab.
  if (process.env.GITLAB_CATALOG_DISABLED === "1") {
    const data: SiteCatalogResponse = {
      gitlabConfigured: true,
      gitlabBaseUrl,
      refreshedAt: new Date().toISOString(),
      projects: paths.map((path) => ({
        path,
        branches: [],
      })),
      message:
        "Site branch listing is disabled (GITLAB_CATALOG_DISABLED=1). Use the Previews tab — entries appear when GitLab webhooks fire. GitLab → Railway webhooks still work without public DNS.",
    };
    cache = { expires: now + TTL_MS, data };
    return data;
  }

  const projects: SiteProjectCatalog[] = [];
  let dnsFailure: string | null = null;

  for (const path of paths) {
    if (dnsFailure) {
      projects.push({ path, branches: [], error: dnsFailure });
      continue;
    }
    try {
      const meta = await fetchProject(path);
      const rawBranches = await fetchBranches(path);
      const webUrl = meta.web_url.replace(/\/$/, "");
      const rows: SiteBranchRow[] = [];

      for (const b of rawBranches) {
        const name = b.name;
        const slug = branchToSlug(name);
        const previewCapable = slug !== null;
        const entry =
          previewCapable && slug ? await store.get(slug) : undefined;
        const sha = b.commit?.id;
        const gitlabBranchUrl = `${webUrl}/-/tree/${encodeURIComponent(name)}`;
        rows.push({
          name,
          slug,
          commitSha: sha,
          commitTitle: b.commit?.title,
          previewCapable,
          inRegistry: Boolean(entry),
          preview: entry ?? null,
          gitlabBranchUrl,
        });
      }

      rows.sort((a, b) => {
        if (a.previewCapable !== b.previewCapable)
          return a.previewCapable ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      projects.push({
        path,
        webUrl: meta.web_url,
        defaultBranch: meta.default_branch,
        branches: rows,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) {
        dnsFailure =
          "GitLab hostname is not reachable from Railway (private/VPN DNS). Webhooks still work. Use the Previews tab for live entries, or expose GitLab via tunnel/public DNS for this catalog.";
        projects.push({ path, branches: [], error: dnsFailure });
        continue;
      }
      projects.push({
        path,
        error: msg,
        branches: [],
      });
    }
  }

  const data: SiteCatalogResponse = {
    gitlabConfigured: true,
    gitlabBaseUrl,
    refreshedAt: new Date().toISOString(),
    projects,
    message: dnsFailure
      ? "Site branches need public DNS to gitlab.flotilla.space from Railway. Switch to Previews for webhook-registered environments."
      : undefined,
  };
  cache = { expires: now + TTL_MS, data };
  return data;
}
