# Flotilla ops (`web/ops`)

Source for the preview pipeline lives in **`flotilla-preview/`** (orchestrator, router, dashboard).

## Railway (GitHub mirror)

Railway must **not** build from the repository root: there is no `package.json` here.

For each service:

1. **Settings → Source → Root Directory:** `flotilla-preview`
2. **Settings → Build:** builder **Dockerfile** (not Railpack / Nixpacks auto-detect).
3. **Dockerfile path:** `docker/orchestrator.Dockerfile` (orchestrator) or `docker/router.Dockerfile` (router).

Orchestrator also needs a **volume** mounted at `/app/data` and `REGISTRY_PATH=/app/data/registry.json`.

See `flotilla-preview/README.md` and `flotilla-preview/docs/GITHUB_MIRROR.md`.
