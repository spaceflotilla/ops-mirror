import { useCallback, useEffect, useState } from "react";

type PreviewFlag =
  | "latest"
  | "production"
  | "prototype"
  | "deprecated"
  | "broken";

type PreviewEntry = {
  slug: string;
  projectPath: string;
  branch: string;
  commitSha?: string;
  commitTitle?: string;
  description?: string;
  targetUrl: string;
  status: string;
  archived: boolean;
  flag?: PreviewFlag;
  createdAt: string;
  updatedAt: string;
  lastDeployAt?: string;
  lastError?: string;
  screenshotAt?: string;
};

const PREVIEW_FLAGS: { value: PreviewFlag; label: string }[] = [
  { value: "latest", label: "Latest" },
  { value: "production", label: "Production" },
  { value: "prototype", label: "Prototype" },
  { value: "deprecated", label: "Deprecated" },
  { value: "broken", label: "Broken" },
];

function flagLabel(flag: PreviewFlag | undefined): string {
  if (!flag) return "";
  return PREVIEW_FLAGS.find((f) => f.value === flag)?.label ?? flag;
}

function FlagSelect({
  slug,
  flag,
  onChange,
}: {
  slug: string;
  flag?: PreviewFlag;
  onChange: (slug: string, flag: PreviewFlag | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <span className="flag-wrap">
      <select
        className={`flag-select${flag ? ` flag-${flag}` : " flag-unset"}`}
        value={flag ?? ""}
        disabled={busy}
        aria-label={`Flag for ${slug}`}
        title="Mark this preview’s role among branches of the same project"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value;
          const next = (v || null) as PreviewFlag | null;
          setBusy(true);
          setErr(null);
          void onChange(slug, next)
            .catch((ex) => {
              setErr(ex instanceof Error ? ex.message : String(ex));
            })
            .finally(() => setBusy(false));
        }}
      >
        <option value="">Set flag…</option>
        {PREVIEW_FLAGS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      {err && (
        <span className="flag-err" title={err}>
          !
        </span>
      )}
    </span>
  );
}

type ViewMode = "tiles" | "list";
type MainTab = "previews" | "sites";

type PreviewSortKey =
  | "slug"
  | "projectPath"
  | "branch"
  | "status"
  | "commit"
  | "updatedAt";

type SortDir = "asc" | "desc";

function comparePreviews(
  a: PreviewEntry,
  b: PreviewEntry,
  key: PreviewSortKey,
  dir: SortDir,
): number {
  const mul = dir === "asc" ? 1 : -1;
  const str = (x: string | undefined) => (x ?? "").toLowerCase();
  let cmp = 0;
  switch (key) {
    case "slug":
      cmp = str(a.slug).localeCompare(str(b.slug));
      break;
    case "projectPath":
      cmp = str(a.projectPath).localeCompare(str(b.projectPath));
      break;
    case "branch":
      cmp = str(a.branch).localeCompare(str(b.branch));
      break;
    case "status": {
      // Prefer user flag for sorting; fall back to deploy status.
      const fa = str(a.flag || a.status);
      const fb = str(b.flag || b.status);
      cmp = fa.localeCompare(fb);
      break;
    }
    case "commit":
      cmp = str(a.commitTitle || a.commitSha).localeCompare(
        str(b.commitTitle || b.commitSha),
      );
      break;
    case "updatedAt": {
      const ta = new Date(a.updatedAt).getTime() || 0;
      const tb = new Date(b.updatedAt).getTime() || 0;
      cmp = ta - tb;
      break;
    }
    default:
      cmp = 0;
  }
  return cmp * mul;
}

type SiteBranchRow = {
  name: string;
  slug: string | null;
  commitSha?: string;
  commitTitle?: string;
  previewCapable: boolean;
  inRegistry: boolean;
  preview?: PreviewEntry | null;
  gitlabBranchUrl: string;
};

type SiteProjectCatalog = {
  path: string;
  webUrl?: string;
  defaultBranch?: string | null;
  error?: string;
  branches: SiteBranchRow[];
};

type SiteCatalogResponse = {
  gitlabConfigured: boolean;
  gitlabBaseUrl: string;
  refreshedAt: string;
  projects: SiteProjectCatalog[];
  message?: string;
};

export function App() {
  const [mainTab, setMainTab] = useState<MainTab>("previews");
  const [archived, setArchived] = useState(false);
  const [items, setItems] = useState<PreviewEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("tiles");
  const [sortKey, setSortKey] = useState<PreviewSortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [userEmail, setUserEmail] = useState<string | null | undefined>(
    undefined,
  );
  const [routerPublicUrl, setRouterPublicUrl] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<SiteCatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) {
        setUserEmail(null);
        return;
      }
      const data = (await res.json()) as {
        email?: string | null;
        authDisabled?: boolean;
      };
      if (data.authDisabled) setUserEmail(null);
      else setUserEmail(data.email ?? null);
    } catch {
      setUserEmail(null);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) return;
      const data = (await res.json()) as { routerPublicUrl?: string | null };
      setRouterPublicUrl(
        typeof data.routerPublicUrl === "string" && data.routerPublicUrl
          ? data.routerPublicUrl.replace(/\/$/, "")
          : null,
      );
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = archived ? "?archived=1" : "";
      const res = await fetch(`/api/previews${q}`);
      if (res.status === 401) {
        const body = (await res.json().catch(() => ({}))) as {
          loginPath?: string;
        };
        setItems([]);
        setError(
          body.loginPath
            ? "SIGN_IN_REQUIRED:" + body.loginPath
            : "SIGN_IN_REQUIRED:/auth/google",
        );
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { previews: PreviewEntry[] };
      setItems(data.previews);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [archived]);

  const loadCatalog = useCallback(async (refresh = false) => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const q = refresh ? "?refresh=1" : "";
      const res = await fetch(`/api/site-catalog${q}`);
      if (res.status === 401) {
        const body = (await res.json().catch(() => ({}))) as {
          loginPath?: string;
        };
        setCatalog(null);
        setCatalogError(
          body.loginPath
            ? "SIGN_IN_REQUIRED:" + body.loginPath
            : "SIGN_IN_REQUIRED:/auth/google",
        );
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      setCatalog((await res.json()) as SiteCatalogResponse);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : String(e));
      setCatalog(null);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    void loadConfig();
  }, [loadMe, loadConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (mainTab === "sites") void loadCatalog(false);
  }, [mainTab, loadCatalog]);

  /** Prefer gated router URL; fall back to raw deploy URL if router not configured. */
  const previewHref = (slug: string, targetUrl: string) =>
    routerPublicUrl ? `${routerPublicUrl}/${slug}/` : targetUrl;

  const setPreviewFlag = useCallback(
    async (slug: string, flag: PreviewFlag | null) => {
      const res = await fetch(`/api/previews/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to set flag (${res.status})`);
      }
      const updated = (await res.json()) as PreviewEntry;
      setItems((prev) =>
        prev.map((p) => (p.slug === slug ? { ...p, ...updated } : p)),
      );
    },
    [],
  );

  const toggleSort = (key: PreviewSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "updatedAt" ? "desc" : "asc");
    }
  };

  const sortedItems = [...items].sort((a, b) =>
    comparePreviews(a, b, sortKey, sortDir),
  );

  const sortLabel = (key: PreviewSortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const signIn = (loginPath: string) => {
    const returnTo =
      window.location.origin +
      window.location.pathname +
      window.location.search;
    window.location.href = `${loginPath}?return_to=${encodeURIComponent(returnTo)}`;
  };

  const signInFromError = () => {
    const src = error?.match(/^SIGN_IN_REQUIRED:(.+)$/) ||
      catalogError?.match(/^SIGN_IN_REQUIRED:(.+)$/);
    signIn(src?.[1] ?? "/auth/google");
  };

  const needsSignIn =
    error?.startsWith("SIGN_IN_REQUIRED:") ||
    catalogError?.startsWith("SIGN_IN_REQUIRED:");

  const previewBlocked =
    Boolean(error?.startsWith("SIGN_IN_REQUIRED:")) ||
    Boolean(catalogError?.startsWith("SIGN_IN_REQUIRED:"));

  return (
    <div className="page">
      <header className="header">
        <div className="header-brand">
          <span className="wordmark">Flotilla</span>
          <span className="header-tag">preview environments</span>
        </div>
        <p className="sub">
          Branch names must end with{" "}
          <code>project-color-animal</code> (example:{" "}
          <code>orbit-green-apple</code>). Flag each tile as{" "}
          <strong>Latest</strong>, <strong>Production</strong>, prototype,
          deprecated, or broken so branches of the same project are easy to tell
          apart. Deploy state (building / failed) still shows when not ready.
        </p>

        <nav className="main-tabs" aria-label="Primary">
          <button
            type="button"
            className={mainTab === "sites" ? "active" : ""}
            onClick={() => setMainTab("sites")}
          >
            Site branches
          </button>
          <button
            type="button"
            className={mainTab === "previews" ? "active" : ""}
            onClick={() => setMainTab("previews")}
          >
            Previews
          </button>
        </nav>

        <div className="toolbar">
          {mainTab === "previews" && (
            <div className="view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={view === "tiles" ? "active" : ""}
                onClick={() => setView("tiles")}
              >
                Tiles
              </button>
              <button
                type="button"
                className={view === "list" ? "active" : ""}
                onClick={() => setView("list")}
              >
                List
              </button>
            </div>
          )}
          {mainTab === "previews" && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />
              Show archived
            </label>
          )}
          {mainTab === "previews" ? (
            <button type="button" onClick={() => void load()}>
              Refresh
            </button>
          ) : (
            <button type="button" onClick={() => void loadCatalog(true)}>
              Refresh from GitLab
            </button>
          )}
          {typeof userEmail === "string" && (
            <>
              <span className="user-chip" title={userEmail}>
                {userEmail}
              </span>
              <a className="link subtle" href="/auth/logout">
                Sign out
              </a>
            </>
          )}
        </div>
      </header>

      {needsSignIn && (
        <div className="banner signin">
          <p>
            <strong>Sign in</strong> with Google to use the dashboard
            (allowlisted email or domain).
          </p>
          <button type="button" className="btn-primary" onClick={signInFromError}>
            Sign in with Google
          </button>
        </div>
      )}

      {mainTab === "sites" && (
        <>
          {catalog?.message && (
            <div className="banner catalog-msg">
              <p>{catalog.message}</p>
            </div>
          )}
          {catalogError && !catalogError.startsWith("SIGN_IN_REQUIRED:") && (
            <div className="banner error">
              <strong>Site catalog failed.</strong> {catalogError}
            </div>
          )}
          {catalogLoading && <p className="muted">Loading GitLab branches…</p>}
          {!catalogLoading && catalog && (
            <div className="site-catalog">
              <p className="catalog-meta muted">
                GitLab:{" "}
                <a
                  className="link"
                  href={catalog.gitlabBaseUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {catalog.gitlabBaseUrl.replace(/^https?:\/\//, "")}
                </a>
                {catalog.gitlabConfigured ? "" : " (token not set)"} · Updated{" "}
                {new Date(catalog.refreshedAt).toLocaleString()}
              </p>

              {catalog.projects.map((proj) => (
                <details
                  key={proj.path}
                  className="site-project"
                  open={catalog.projects.length <= 6}
                >
                  <summary className="site-project-summary">
                    <span className="site-project-path">{proj.path}</span>
                    {proj.webUrl && (
                      <a
                        className="link secondary project-link"
                        href={proj.webUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        GitLab project
                      </a>
                    )}
                    {proj.defaultBranch && (
                      <span className="pill default-branch">
                        default: {proj.defaultBranch}
                      </span>
                    )}
                    <span className="branch-count">
                      {proj.error
                        ? "—"
                        : `${proj.branches.length} branch${proj.branches.length === 1 ? "" : "es"}`}
                    </span>
                  </summary>
                  {proj.error && (
                    <p className="project-error">{proj.error}</p>
                  )}
                  {!proj.error && proj.branches.length === 0 && (
                    <p className="muted">No branches returned.</p>
                  )}
                  {!proj.error && proj.branches.length > 0 && (
                    <div className="table-wrap nested">
                      <table className="data-table compact">
                        <thead>
                          <tr>
                            <th>Branch</th>
                            <th>Preview slug</th>
                            <th>Commit</th>
                            <th>Registry</th>
                            <th>Links</th>
                          </tr>
                        </thead>
                        <tbody>
                          {proj.branches.map((b) => (
                            <tr
                              key={b.name}
                              className={
                                b.previewCapable ? "row-preview-capable" : ""
                              }
                            >
                              <td className="mono">
                                <a
                                  className="link"
                                  href={b.gitlabBranchUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {b.name}
                                </a>
                              </td>
                              <td className="mono">
                                {b.slug ? (
                                  <span className="slug-val">{b.slug}</span>
                                ) : (
                                  <span className="subtle">—</span>
                                )}
                              </td>
                              <td className="commit-cell">
                                {b.commitSha && (
                                  <span className="mono subtle">
                                    {b.commitSha.slice(0, 8)}
                                  </span>
                                )}
                                {b.commitTitle && (
                                  <span className="commit-title">
                                    {b.commitTitle}
                                  </span>
                                )}
                              </td>
                              <td>
                                {b.previewCapable && b.inRegistry && b.preview ? (
                                  <div className="status-row">
                                    {b.preview.flag ? (
                                      <span
                                        className={`pill flag-${b.preview.flag}`}
                                      >
                                        {flagLabel(b.preview.flag)}
                                      </span>
                                    ) : null}
                                    {(b.preview.status !== "ready" ||
                                      !b.preview.flag) && (
                                      <span
                                        className={`pill status-${b.preview.status}`}
                                      >
                                        {b.preview.status}
                                      </span>
                                    )}
                                  </div>
                                ) : b.previewCapable ? (
                                  <span className="pill not-deployed">
                                    no preview
                                  </span>
                                ) : (
                                  <span className="subtle">n/a</span>
                                )}
                              </td>
                              <td className="links-cell">
                                {b.slug && b.preview && (
                                  <a
                                    className="link"
                                    href={previewHref(
                                      b.slug,
                                      b.preview.targetUrl,
                                    )}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open preview
                                  </a>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </details>
              ))}
            </div>
          )}
        </>
      )}

      {mainTab === "previews" && (
        <>
          {error && !error.startsWith("SIGN_IN_REQUIRED:") && (
            <div className="banner error">
              <strong>Could not load previews.</strong> {error}
              <div className="hint">
                For local API-only dev, set{" "}
                <code>PUBLIC_READ_API=1</code> on the orchestrator, or open the
                dashboard from the orchestrator URL after{" "}
                <code>npm run build</code> so <code>/api</code> shares your
                session cookie.
              </div>
            </div>
          )}

          {loading && <p className="muted">Loading…</p>}

          {!loading &&
            !error &&
            items.length === 0 &&
            !previewBlocked && (
              <p className="muted">
                No previews yet. Push a matching branch to GitLab (webhook) or
                check <strong>Site branches</strong> for branch names.
              </p>
            )}

          {!loading &&
            !(error?.startsWith("SIGN_IN_REQUIRED:")) &&
            view === "tiles" && (
              <ul className="tiles">
                {items.map((p) => {
                  const desc =
                    p.description?.trim() ||
                    p.commitTitle?.trim() ||
                    null;
                  const shotSrc = `/api/previews/${encodeURIComponent(p.slug)}/screenshot?v=${encodeURIComponent(p.screenshotAt ?? p.updatedAt)}`;
                  return (
                    <li key={p.slug} className="tile">
                      <a
                        className="tile-shot"
                        href={previewHref(p.slug, p.targetUrl)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open preview ${p.slug}`}
                      >
                        <img
                          src={shotSrc}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            const el = e.currentTarget;
                            el.onerror = null;
                            el.src =
                              "data:image/svg+xml," +
                              encodeURIComponent(
                                `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect fill="#161f33" width="100%" height="100%"/><text x="50%" y="50%" fill="#9aa3c7" font-family="system-ui,sans-serif" font-size="28" text-anchor="middle" dominant-baseline="middle">No screenshot yet</text></svg>`,
                              );
                          }}
                        />
                      </a>
                      <div className="tile-body">
                        <div className="tile-title">{p.slug}</div>
                        {desc && (
                          <p className="tile-desc">{desc}</p>
                        )}
                        <div className="tile-meta">{p.projectPath}</div>
                        <div className="tile-meta status-row">
                          <FlagSelect
                            slug={p.slug}
                            flag={p.flag}
                            onChange={setPreviewFlag}
                          />
                          {p.status !== "ready" && (
                            <span className={`pill status-${p.status}`}>
                              {p.status}
                            </span>
                          )}
                          {p.archived && (
                            <span className="pill archived">archived</span>
                          )}
                        </div>
                        <div className="tile-meta branch">{p.branch}</div>
                        {p.lastDeployAt && (
                          <div className="tile-meta subtle">
                            Deployed {new Date(p.lastDeployAt).toLocaleString()}
                          </div>
                        )}
                        <div className="tile-actions">
                          <a
                            className="link"
                            href={previewHref(p.slug, p.targetUrl)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open preview
                          </a>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

          {!loading &&
            !(error?.startsWith("SIGN_IN_REQUIRED:")) &&
            view === "list" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {(
                        [
                          ["slug", "Slug"],
                          ["projectPath", "Project"],
                          ["branch", "Branch"],
                          ["status", "Flag"],
                          ["commit", "Commit"],
                          ["updatedAt", "Updated"],
                        ] as const
                      ).map(([key, label]) => (
                        <th key={key} aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                          <button
                            type="button"
                            className={
                              sortKey === key
                                ? "th-sort active"
                                : "th-sort"
                            }
                            onClick={() => toggleSort(key)}
                          >
                            {label}
                            <span className="th-sort-ind" aria-hidden>
                              {sortLabel(key)}
                            </span>
                          </button>
                        </th>
                      ))}
                      <th>Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((p) => (
                      <tr key={p.slug}>
                        <td className="mono">{p.slug}</td>
                        <td>{p.projectPath}</td>
                        <td className="mono subtle">{p.branch}</td>
                        <td>
                          <div className="status-row">
                            <FlagSelect
                              slug={p.slug}
                              flag={p.flag}
                              onChange={setPreviewFlag}
                            />
                            {p.status !== "ready" && (
                              <span className={`pill status-${p.status}`}>
                                {p.status}
                              </span>
                            )}
                            {p.archived && (
                              <span className="pill archived">archived</span>
                            )}
                          </div>
                        </td>
                        <td className="commit-cell">
                          {p.commitSha && (
                            <span className="mono subtle">
                              {p.commitSha.slice(0, 7)}
                            </span>
                          )}
                          {p.commitTitle && (
                            <span className="commit-title">{p.commitTitle}</span>
                          )}
                        </td>
                        <td className="subtle nowrap">
                          {new Date(p.updatedAt).toLocaleString()}
                        </td>
                        <td className="links-cell">
                          <a
                            className="link"
                            href={previewHref(p.slug, p.targetUrl)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open preview
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}
    </div>
  );
}
