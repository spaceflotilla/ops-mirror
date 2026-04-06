import { useCallback, useEffect, useState } from "react";

type PreviewEntry = {
  slug: string;
  projectPath: string;
  branch: string;
  commitSha?: string;
  commitTitle?: string;
  targetUrl: string;
  status: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastDeployAt?: string;
  lastError?: string;
};

type ViewMode = "tiles" | "list";
type MainTab = "previews" | "sites";

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
  const [mainTab, setMainTab] = useState<MainTab>("sites");
  const [archived, setArchived] = useState(false);
  const [items, setItems] = useState<PreviewEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("tiles");
  const [userEmail, setUserEmail] = useState<string | null | undefined>(
    undefined,
  );

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
  }, [loadMe]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (mainTab === "sites") void loadCatalog(false);
  }, [mainTab, loadCatalog]);

  const basePath = "";

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
          <code>orbit-green-apple</code>).{" "}
          <strong>Site branches</strong> lists every repo in the catalog from
          GitLab; <strong>Previews</strong> shows deployed registry entries.
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
                                  <span
                                    className={`pill status-${b.preview.status}`}
                                  >
                                    {b.preview.status}
                                  </span>
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
                                  <>
                                    <a
                                      className="link"
                                      href={`${basePath}/${b.slug}/`}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Site path
                                    </a>
                                    <a
                                      className="link secondary"
                                      href={b.preview.targetUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Target
                                    </a>
                                  </>
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
                {items.map((p) => (
                  <li key={p.slug} className="tile">
                    <div className="tile-title">{p.slug}</div>
                    <div className="tile-meta">{p.projectPath}</div>
                    <div className="tile-meta">
                      <span className={`pill status-${p.status}`}>
                        {p.status}
                      </span>
                      {p.archived && (
                        <span className="pill archived">archived</span>
                      )}
                    </div>
                    <div className="tile-meta branch">{p.branch}</div>
                    {p.commitTitle && (
                      <div className="tile-meta commit">{p.commitTitle}</div>
                    )}
                    {p.lastDeployAt && (
                      <div className="tile-meta subtle">
                        Deployed {new Date(p.lastDeployAt).toLocaleString()}
                      </div>
                    )}
                    <div className="tile-actions">
                      <a
                        className="link"
                        href={`${basePath}/${p.slug}/`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open on site path
                      </a>
                      <a
                        className="link secondary"
                        href={p.targetUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Raw target (Railway)
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}

          {!loading &&
            !(error?.startsWith("SIGN_IN_REQUIRED:")) &&
            view === "list" && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Slug</th>
                      <th>Project</th>
                      <th>Branch</th>
                      <th>Status</th>
                      <th>Commit</th>
                      <th>Updated</th>
                      <th>Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                      <tr key={p.slug}>
                        <td className="mono">{p.slug}</td>
                        <td>{p.projectPath}</td>
                        <td className="mono subtle">{p.branch}</td>
                        <td>
                          <span className={`pill status-${p.status}`}>
                            {p.status}
                          </span>
                          {p.archived && (
                            <span className="pill archived">archived</span>
                          )}
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
                            href={`${basePath}/${p.slug}/`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Site path
                          </a>
                          <a
                            className="link secondary"
                            href={p.targetUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Target
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
