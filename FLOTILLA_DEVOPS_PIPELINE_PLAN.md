# Flotilla DevOps Pipeline Plan

## Objective
Build a deployment and preview workflow that reduces manual steps and makes every branch easy to review on a live URL before merge, with access control and a branch dashboard.

Target outcome:
- Cursor pushes feature/fix branches to GitLab automatically.
- Each active branch gets a human-readable preview URL (for example: `orbit-red-apple`).
- Previews are protected behind authentication.
- A dashboard shows active branches and links to live previews.
- Deployments update automatically when branch commits are pushed.

## Current State (as understood)
- Development is local in Cursor with manual localhost verification.
- Deployments to external access are manual through HostGator cPanel file manager.
- Password protection currently relies on cPanel basic auth.
- Git repos are hosted on `gitlab.flotilla.space`.
- Railway is available on a paid plan and already hosts some apps/data.

## Locked Architecture (v1)
1. **Source Control + deploy trigger (no GitLab CI dependency)**
   - GitLab is used for repos and software configuration management only.
   - Preview builds/deploys are **not** driven by GitLab CI pipelines.
   - Instead: **GitLab project webhooks** (push / merge events) call an external **deploy orchestrator** you own (hosted on Railway).
   - Orchestrator clones/fetches from GitLab, builds, deploys to Railway previews, and updates the registry.
   - Main branch remains production/stable.
2. **Preview Hosting**
   - Use Railway services for preview deployments per branch.
   - Branch slug naming convention: `<project>-<color>-<animal>`.
3. **Routing Layer**
   - A small "preview-router" service runs behind `flotilla.space`.
   - HostGator forwards unknown preview paths (`/<project>-<color>-<animal>`) to preview-router.
   - Router maps slug -> active Railway preview URL and reverse-proxies traffic.
4. **Authentication**
   - Replace basic auth with app-level auth (Google OAuth first, optional GitLab OAuth later).
   - Access control supports both domain allowlist and explicit email allowlist.
   - Per-preview ACL controls are required (not all users can view all previews).
5. **Dashboard**
   - "Dev Preview Dashboard" lists active preview environments as **tiles** and always offers a **detailed list view** of the same data (toggle or tabs).
   - Tiles include status, last commit, last deploy time, and link to preview.
   - Archive view exists and is hidden by default.
6. **Lifecycle**
   - On branch push: build -> deploy/update preview -> update dashboard metadata.
   - On branch merge/delete: archive by default. **Registry rows** (metadata: slug, commit, ACL, archive flags) are retained indefinitely unless manually removed. **Runtime** preview workloads on Railway may use auto-sleep, scale-to-zero, or a future TTL for inactive slugs to control cost — that does not imply deleting registry history.

## Implementation Tracks

### Track A: Foundation
- [x] Create `ops` workspace and plan docs.
- [x] Define naming conventions for branches and URLs.
- [x] Define metadata model for branch previews (ACL schema next).

### Track B: Deploy orchestration (external to GitLab CI)
- [ ] Configure GitLab **webhooks** per project (push, merge request merge, optional tag).
- [x] Implement **deploy orchestrator** (MVP): webhook receiver, token verify, push -> registry, merge -> archive stub.
- [ ] Create build + deploy script(s) for Railway previews (invoked by orchestrator, not `.gitlab-ci.yml`).
- [x] Add archive handling on merge webhook (slug mapped from source branch).

### Track C: Preview Registry + Router
- [x] Implement preview registry (JSON file v1 under `ops/flotilla-preview/data/`).
- [x] **v1 assumption:** single orchestrator process (or single writer). The JSON registry uses atomic rename writes and an in-process write queue; do not run multiple orchestrator replicas against the same file without switching to shared storage / locking.
- [x] Implement router service for slug -> preview destination (reverse proxy; auth gate placeholder).
- [ ] Add health checks + failed deploy states (deploy pipeline still stub).

### Track D: Auth + Access Control
- [x] Implement OAuth login (Google) on orchestrator; router shares session cookie (same `SESSION_KEY`) and allowlist.
- [x] Add domain and email allowlist (env-driven). Roles (admin, reviewer) still TODO.
- [ ] Add per-preview ACL grant/revoke workflow.

### Track E: Dashboard
- [x] Implement dashboard UI with environment tiles (MVP).
- [x] Detailed list view alongside tile view (same dataset).
- [x] Flotilla brand colors/typography on dashboard (see `react_deck/BRANDING_REFERENCE.md`).
- [ ] Add manual actions: open, redeploy, archive, unarchive, disable.
- [x] Add branch and commit metadata from webhook payload (GitLab API sync later).

### Track F: Cursor Workflow Defaults
- [x] Define default branch workflow instructions (`flotilla-preview/docs/CURSOR_WORKFLOW.md`).
- [x] Add standardized branch naming helper (script or Cursor rule).
- [x] Document "branch -> push -> preview link -> review -> merge/archive" flow.

## Delivery Phases

### Phase 1 (Fast MVP)
- Branch push triggers preview deploy via **webhook -> orchestrator** (not GitLab CI).
- Path-based friendly URL generation and registry entry.
- Auth gate with Google OAuth + domain/email allowlist.
- Basic tile dashboard.

### Phase 2 (Operational Hardening)
- Robust role permissions.
- Cleanup and retention policies.
- Better logs, failure notifications, and rollback helpers.

### Phase 3 (Scale + Governance)
- Multi-project support from one dashboard.
- Audit logs and access history.
- Promotion flow: preview -> staging -> production.

## Decisions and Clarifications
Status legend: `[OPEN]`, `[ANSWERED]`

1. [ANSWERED] **Primary deployment target for previews**
   - Decision: preview apps deploy on Railway.
   - Constraint: preview URLs must be path-based under `flotilla.space`.
2. [ANSWERED] **Auth model preference**
   - Decision: choose easiest sensible path -> Google OAuth first.
   - Future option: add GitLab OAuth if needed.
3. [ANSWERED] **Access policy**
   - Decision: use both domain allowlist and explicit email allowlist.
   - Requirement: per-preview grant/revoke controls.
4. [ANSWERED] **URL structure preference**
   - Decision: path-based under `flotilla.space/<project>-<color>-<animal>`.
5. [ANSWERED] **Project scope**
   - Decision: all projects, not just `orbit`.
6. [ANSWERED] **Environment teardown policy**
   - Decision: keep forever, archive by default when inactive/merged.
7. [ANSWERED] **Dashboard hosting location**
   - Decision: host where it best supports Git push deploy automation (Railway-preferred).
8. [ANSWERED] **GitLab integration method**
   - Decision: **avoid depending on GitLab internal CI/CD** beyond using Git as SCM.
   - Approach: **webhooks + external deploy orchestrator** (Railway-hosted) owns build/deploy logic.
   - Rationale: portability, less vendor lock-in to GitLab pipeline features, single place to evolve deploy behavior.
9. [ANSWERED] **Cursor default behavior**
   - Decision: new branch per task, push immediately, review via hosted preview (no local-only verification as default).

## Build Sequence (Remaining work in dependency order)

*Foundation already in repo: registry file schema, orchestrator webhook + registry API (MVP), router proxy, dashboard tiles + list, Google OAuth + allowlist, Dockerfiles.*

1. **Production wiring:** Deploy orchestrator + router (and optional static dashboard via orchestrator) to Railway; set secrets (`SESSION_SECRET`, Google OAuth, `GITLAB_WEBHOOK_SECRET`, `INTERNAL_API_TOKEN`, allowlists).
2. **HostGator / DNS:** Path-based routes to router; dashboard URL on same registrable domain as OAuth callback so session cookies apply to preview paths (or document a single-host path layout).
3. **GitLab:** Register **webhooks** per project to orchestrator; document `flotilla-preview.yaml` for build hints (**not** `.gitlab-ci.yml` as deploy driver).
4. **Deploy pipeline:** Replace stub deploy in orchestrator with real Railway (or other) preview deploy per slug.
5. **Hardening:** Health checks, failed deploy states, per-preview ACL in registry, dashboard manual actions (redeploy / archive / unarchive).
6. **Cursor:** Rule + `npm run new-branch` in `ops/flotilla-preview`; full flow in `docs/CURSOR_WORKFLOW.md`.

## Risks and Mitigations
- **Credential sprawl**: centralize secrets in Railway (orchestrator, router) and GitLab **project tokens** only where needed for clone/API; avoid scattering in repos.
- **Preview drift**: branch-based immutable deploy references and commit hash display.
- **Auth bypass risk**: enforce middleware auth checks in router/dashboard services.
- **Cost creep**: use Railway auto-sleep / scale-to-zero or TTL on **runtime** previews; keep registry metadata as needed (see Lifecycle).

## Progress Log
- 2026-03-23: Created `ops` workspace and initial implementation plan.
- 2026-03-23: Captured first clarification questions.
- 2026-03-23: Recorded user decisions for deployment target, URL scheme, auth/access model, archive policy, and branch-first workflow.
- 2026-03-23: Locked #8 — **webhook + external orchestrator**, explicitly **not** GitLab CI as deploy driver.
- 2026-03-23: Scaffolded monorepo `ops/flotilla-preview/` — `@flotilla/shared`, `@flotilla/orchestrator`, `@flotilla/router`, `@flotilla/dashboard` (see README).
- 2026-04-02: Added Cursor rule (`.cursor/rules/flotilla-preview-workflow.mdc`), `npm run new-branch` helper, `railway-orchestrator.toml` / `railway-router.toml` templates, README Railway/volume notes.

## Next Implementation Step
1) Deploy orchestrator + router + dashboard to Railway; set env vars; orchestrator volume `/app/data`.
2) Point first GitLab project webhook at orchestrator URL; set secret token.
3) Implement real Railway preview deploy from orchestrator (replace URL stub).
4) HostGator reverse proxy: path-based routes to router; enable Google OAuth (remove `AUTH_DISABLED`).
