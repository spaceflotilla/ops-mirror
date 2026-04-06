# Mirror `web/ops` to GitHub (for Railway and other public CI)

Self-hosted GitLab at `gitlab.flotilla.space` may be unreachable from Railway’s builders if it is VPN-only or not on the public internet. **GitHub** is usually reachable everywhere, so point **Railway at the GitHub mirror** and keep **GitLab as the place you push to day to day**.

## Recommended: GitLab “push” mirror → GitHub

GitLab pushes to GitHub whenever the GitLab repo updates (including new commits on `main`).

### 1. Create an empty GitHub repository

- GitHub → **New repository** (e.g. `ops` under your org or user).
- **Do not** add README, `.gitignore`, or license (avoids merge conflicts with your existing history).

### 2. Create a GitHub Personal Access Token (PAT)

- GitHub → **Settings** → **Developer settings** → **Personal access tokens**.
- **Fine-grained** (repo contents read/write for that repo only) or **classic** with `repo` scope.
- Copy the token once; you will paste it into GitLab (not into this repo).

### 3. Add the mirror in GitLab

In **`https://gitlab.flotilla.space/web/ops`**:

1. **Settings** → **Repository** → **Mirroring repositories** → **Add new**.
2. **Git repository URL** — HTTPS form (replace `OWNER`, `REPO`, `TOKEN`):

   ```text
   https://oauth2:<TOKEN>@github.com/<OWNER>/<REPO>.git
   ```

   Some GitLab versions accept username `git` + token as password instead of `oauth2`; if the UI has separate user/password fields, use username `git` and the PAT as password, URL `https://github.com/<OWNER>/<REPO>.git`.

3. **Mirror direction:** **Push** (GitLab → GitHub).
4. **Keep divergent refs** — optional; usually leave default unless you know you need it.
5. Save, then use **Update now** / **Sync** once to seed GitHub.

After the first successful sync, `main` on GitHub should match GitLab.

### 4. Point Railway at GitHub

- Railway project → connect the **GitHub** `OWNER/ops` repo (not GitLab).
- **Root directory:** `flotilla-preview` (unchanged).
- Redeploy or trigger a new deploy so Railway clones from GitHub.

### 5. Day-to-day workflow

- **Clone / push / MRs:** keep using **`gitlab.flotilla.space/web/ops`** as source of truth.
- After each push to GitLab, the mirror should update GitHub within about a minute (or immediately, depending on GitLab settings).
- If Railway must see a change, confirm the mirror on GitHub shows the new commit, then deploy.

## If the mirror fails

- Check GitLab **Admin →** mirror status / error message (auth, branch protection on GitHub, 2FA-only org rules).
- Confirm the PAT still has access to that repo and is not expired.
- **Protected branches** on GitHub can block force-updates; for a simple mirror, avoid extra rules on `main` until the mirror works.

## Optional: second remote on your laptop

From your local `ops` clone you can add GitHub for manual pushes or testing:

```bash
git remote add github https://github.com/<OWNER>/<REPO>.git
git push github main
```

Prefer **one** primary workflow (GitLab + automatic mirror) so GitLab and GitHub do not drift.
