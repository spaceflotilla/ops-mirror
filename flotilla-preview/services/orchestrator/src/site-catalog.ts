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

/** Branches known from webhook/publish registry when live GitLab listing is unavailable. */
async function catalogFromRegistry(
  store: RegistryStore,
  paths: string[],
  gitlabBaseUrl: string,
  opts: {
    gitlabConfigured: boolean;
    message: string;
  },
): Promise<SiteCatalogResponse> {
  const all = await store.list();
  const projects: SiteProjectCatalog[] = [];

  for (const path of paths) {
    const matching = all.filter((p) => p.projectPath === path);
    const webUrl = `${gitlabBaseUrl}/${path}`;
    const rows: SiteBranchRow[] = matching.map((entry) => ({
      name: entry.branch,
      slug: entry.slug,
      commitSha: entry.commitSha,
      commitTitle: entry.commitTitle ?? entry.description,
      previewCapable: true,
      inRegistry: true,
      preview: entry,
      gitlabBranchUrl: `${webUrl}/-/tree/${encodeURIComponent(entry.branch)}`,
    }));
    rows.sort((a, b) => {
      const ta = a.preview?.updatedAt
        ? new Date(a.preview.updatedAt).getTime()
        : 0;
      const tb = b.preview?.updatedAt
        ? new Date(b.preview.updatedAt).getTime()
        : 0;
      return tb - ta || a.name.localeCompare(b.name);
    });
    projects.push({
      path,
      webUrl,
      branches: rows,
    });
  }

  return {
    gitlabConfigured: opts.gitlabConfigured,
    gitlabBaseUrl,
    refreshedAt: new Date().toISOString(),
    projects,
    message: opts.message,
  };
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
    const data = await catalogFromRegistry(store, paths, gitlabBaseUrl, {
      gitlabConfigured: false,
      message:
        "Showing branches from the preview registry only — set GITLAB_ACCESS_TOKEN (read_api) for the full GitLab branch list.",
    });
    cache = { expires: now + TTL_MS, data };
    return data;
  }

  // Prefer registry when catalog is explicitly disabled (e.g. private GitLab DNS).
  if (process.env.GITLAB_CATALOG_DISABLED === "1") {
    const data = await catalogFromRegistry(store, paths, gitlabBaseUrl, {
      gitlabConfigured: true,
      message:
        "Live GitLab branch listing is disabled (GITLAB_CATALOG_DISABLED=1). Showing webhook-registered preview branches. Unset that variable when Railway can reach GitLab.",
    });
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
      if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|unreachable|ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
        dnsFailure = msg;
        break;
      }
      projects.push({
        path,
        error: msg,
        branches: [],
      });
    }
  }

  if (dnsFailure) {
    const data = await catalogFromRegistry(store, paths, gitlabBaseUrl, {
      gitlabConfigured: true,
      message:
        "GitLab is not reachable from Railway — showing webhook-registered preview branches. Fix DNS/TLS or set GITLAB_TLS_INSECURE=1 for a self-signed cert.",
    });
    cache = { expires: now + TTL_MS, data };
    return data;
  }

  const data: SiteCatalogResponse = {
    gitlabConfigured: true,
    gitlabBaseUrl,
    refreshedAt: new Date().toISOString(),
    projects,
  };
  cache = { expires: now + TTL_MS, data };
  return data;
}
