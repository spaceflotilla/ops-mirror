# Flotilla preview pipeline (MVP)

Monorepo for **deploy orchestrator** (GitLab webhooks → registry + stub “deploy”), **preview router** (path-based reverse proxy + session gate), and a **dashboard** (Flotilla-branded **tile** and **list** views of the same data).

GitLab is **repos + SCM only** — no `.gitlab-ci.yml` required for this flow.

**Railway / public CI:** If `gitlab.flotilla.space` is not reachable from the internet (e.g. VPN-only), mirror this repo to **GitHub** and connect Railway to GitHub. See [`docs/GITHUB_MIRROR.md`](docs/GITHUB_MIRROR.md).

## What you need to provide

| Item | Purpose |
|------|---------|
| **GitLab webhook URL** | `POST https://<your-orchestrator-host>/webhooks/gitlab` |
| **`GITLAB_WEBHOOK_SECRET`** | Same string as GitLab “Secret token” on the webhook |
| **Railway project(s)** | One service for orchestrator; one for router; later one per preview or dynamic deploy |
| **HostGator / DNS** | Reverse-proxy `flotilla.space` paths to router (and dashboard path to orchestrator if split) |
| **Google OAuth** | Client ID/secret; callback URL `{AUTH_PUBLIC_BASE_URL}/auth/google/callback` |
| **`SESSION_SECRET`** | Same 32+ byte string on orchestrator and router (session cookie is shared when users hit the same site) |
| **`INTERNAL_API_TOKEN`** | Same bearer token on orchestrator and router (router → orchestrator API) |
| **Allowlists** | `AUTH_ALLOWED_EMAIL_DOMAINS` and/or `AUTH_ALLOWED_EMAILS` |
| **GitLab token** | `GITLAB_ACCESS_TOKEN` (read_api) for **Site branches** tab — lists branches for repos in `config/site-projects.json` |

## Google OAuth (production)

1. In [Google Cloud Console](https://console.cloud.google.com/), create OAuth client (Web).  
2. **Authorized redirect URI:** `https://<your-orchestrator-host>/auth/google/callback` (must match `AUTH_PUBLIC_BASE_URL` exactly).  
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_PUBLIC_BASE_URL`, `SESSION_SECRET`, allowlists.  
4. Set `AUTH_TRUSTED_RETURN_ORIGINS` to every origin users may return to after login (e.g. `https://flotilla.space` and preview-router origin if different).  
5. Unset `AUTH_DISABLED` and `PUBLIC_READ_API` on the orchestrator for real deployments.  
6. Router: same `SESSION_SECRET`, `AUTH_ALLOWED_*`, `AUTH_ISSUER_URL` (or `AUTH_PUBLIC_BASE_URL`) as orchestrator, `INTERNAL_API_TOKEN`, unset `AUTH_DISABLED`.

**Same registrable domain:** For the session cookie to apply to both the dashboard and `/<slug>/` previews, serve both behind one host (path-based on `flotilla.space`) or set cookie `Domain` appropriately — see plan doc.

## Branch naming → URL slug

Use branches like `orbit-green-apple` or `fundraise-pipeline-red-fox`:

- Last two segments = **color** + **animal**
- Everything before that = **project** slug

That becomes path `/orbit-green-apple/` on the public site (via router).

### Branch name helper

From `ops/flotilla-preview`:

```bash
npm run new-branch -- orbit
```

Prints a random compliant branch name (e.g. `orbit-teal-puffin`) and suggested `git` commands. Project slug is the part before `-<color>-<animal>`.

## Railway (config templates)

Templates for each service (copy to `railway.toml` after `railway link`, or mirror in the dashboard):

| File | Service |
|------|---------|
| `railway-orchestrator.toml` | Webhook + dashboard + registry |
| `railway-router.toml` | Path-based preview reverse proxy |

**Orchestrator:** in the Railway service settings, add a **volume** with mount path `/app/data` so `registry.json` survives redeploys. Optionally set `REGISTRY_PATH=/app/data/registry.json`.

## Docker

From `ops/flotilla-preview`:

```bash
docker build -f docker/orchestrator.Dockerfile -t flotilla-preview-orchestrator .
docker build -f docker/router.Dockerfile -t flotilla-preview-router .
```

Mount a volume for `/app/data` on the orchestrator so `registry.json` persists.

## Local development

From `ops/flotilla-preview`:

```bash
npm install
npm run build -w @flotilla/shared
```

**Quick dev (no OAuth):** copy `.env.example` → `.env`, set `PUBLIC_READ_API=1` and `AUTH_DISABLED=1`.

Terminal 1 — orchestrator:

```bash
npm run dev:orchestrator
```

Terminal 2 — dashboard (proxies `/api` and `/auth` → orchestrator):

```bash
npm run dev:dashboard
```

Terminal 3 — router (optional):

```cmd
set AUTH_DISABLED=1
set ORCHESTRATOR_URL=http://127.0.0.1:3101
npm run dev:router
```

**OAuth locally:** Build the dashboard, run orchestrator with real Google env vars, `AUTH_PUBLIC_BASE_URL=http://127.0.0.1:3101`, `AUTH_TRUSTED_RETURN_ORIGINS` including `http://127.0.0.1:3102` if you use the router. Open **`http://127.0.0.1:3101`** (not Vite) so session cookies match the API origin.

### Fake a GitLab push webhook

```bash
curl -X POST http://127.0.0.1:3101/webhooks/gitlab ^
  -H "Content-Type: application/json" ^
  -d "{\"object_kind\":\"push\",\"ref\":\"refs/heads/orbit-green-apple\",\"checkout_sha\":\"abc123\",\"commits\":[{\"id\":\"abc123\",\"title\":\"demo\"}],\"project\":{\"path_with_namespace\":\"flotilla/orbit\"}}"
```

Open `http://localhost:5173` (dev proxy) or `http://127.0.0.1:3101` (built SPA).

- **Site branches** — all repos in `config/site-projects.json` (or `GITLAB_SITE_PROJECTS`), branches from GitLab merged with preview registry status. Set **`GITLAB_ACCESS_TOKEN`** on the orchestrator (same machine as the API). Use **Refresh from GitLab** to bypass the 2‑minute cache.
- **Previews** — **Tiles** / **List** for deployed registry entries only.

## Branding

Dashboard styling follows `react_deck/BRANDING_REFERENCE.md` (coral `#FF9770`, purple `#7F7EFF`, teal `#03CEA4`). **Mulish** is used as a web-available substitute for Proxima Nova / Avenir.

## Optional per-repo config

Add `flotilla-preview.yaml` at the repo root later (build command, output dir). Not consumed by the MVP yet — orchestrator stub does not build.

## Next implementation steps

1. Deploy orchestrator + router on **Railway** (see project instructions from the team or `railway-*.toml` templates).  
2. Real **Railway preview** deploy from orchestrator (CLI or API) per slug (replace stub).  
3. **HostGator** reverse proxy rules for preview paths + dashboard path.  
4. Per-preview ACL in registry + dashboard actions (redeploy / archive).
