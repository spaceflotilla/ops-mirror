const DEFAULT_GITLAB_URL = "https://gitlab.flotilla.space";

export type GitLabProject = {
  id: number;
  path_with_namespace: string;
  web_url: string;
  default_branch: string | null;
};

export type GitLabBranch = {
  name: string;
  commit?: { id?: string; short_id?: string; title?: string };
};

function baseUrl(): string {
  return (process.env.GITLAB_URL ?? DEFAULT_GITLAB_URL).replace(/\/$/, "");
}

function token(): string | undefined {
  const t = process.env.GITLAB_ACCESS_TOKEN?.trim();
  return t || undefined;
}

function projectIdEnc(pathWithNamespace: string): string {
  return encodeURIComponent(pathWithNamespace);
}

async function gitlabFetch<T>(path: string): Promise<T> {
  const tok = token();
  if (!tok) {
    throw new Error("GITLAB_ACCESS_TOKEN is not set");
  }
  const url = `${baseUrl()}/api/v4${path}`;
  const res = await fetch(url, {
    headers: {
      "PRIVATE-TOKEN": tok,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitLab ${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function isGitLabConfigured(): boolean {
  return Boolean(token());
}

export async function fetchProject(
  pathWithNamespace: string,
): Promise<GitLabProject> {
  return gitlabFetch<GitLabProject>(
    `/projects/${projectIdEnc(pathWithNamespace)}`,
  );
}

export async function fetchBranches(
  pathWithNamespace: string,
  perPage = 100,
): Promise<GitLabBranch[]> {
  const id = projectIdEnc(pathWithNamespace);
  const out: GitLabBranch[] = [];
  let page = 1;
  for (;;) {
    const batch = await gitlabFetch<GitLabBranch[]>(
      `/projects/${id}/repository/branches?per_page=${perPage}&page=${page}`,
    );
    out.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
    if (page > 20) break;
  }
  return out;
}
