# Cursor workflow — Flotilla previews

## Branch per task

1. Create a new branch for each task/fix.
2. Name branches using **`{project}-{color}-{animal}`** so they map to a preview path:
   - Examples: `orbit-green-apple`, `fundraise-pipeline-red-fox`
3. Push the branch to `gitlab.flotilla.space` (no local-only verification as the default gate).
4. Wait for the **deploy orchestrator** to register the preview (or check the dashboard).
5. Open `https://flotilla.space/<slug>/` (behind auth when enabled) and verify.
6. Merge to `main` when satisfied; orchestrator marks the preview **archived** on merge webhook.

## Merge requests

Point MRs at `main`. After merge, the preview for the **source branch** should move to **archived** in the dashboard.

## If preview does not appear

- Confirm branch name matches `project-color-animal` (minimum three `-`-separated segments).
- Confirm GitLab webhook delivered (`Push events`, optional `Merge request events`).
- Check orchestrator logs on Railway.
