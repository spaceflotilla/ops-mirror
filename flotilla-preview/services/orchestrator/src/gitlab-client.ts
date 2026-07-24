import https from "node:https";
import { URL } from "node:url";

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

/** Self-hosted GitLab often uses a private CA; set GITLAB_TLS_INSECURE=1 to skip verify. */
function tlsInsecure(): boolean {
  return process.env.GITLAB_TLS_INSECURE === "1";
}

async function gitlabFetch<T>(path: string): Promise<T> {
  const tok = token();
  if (!tok) {
    throw new Error("GITLAB_ACCESS_TOKEN is not set");
  }
  const url = `${baseUrl()}/api/v4${path}`;
  try {
    const body = await httpsJson(url, {
      "PRIVATE-TOKEN": tok,
      Accept: "application/json",
    });
    return body as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `GitLab unreachable at ${baseUrl()}: ${msg}. If the cert is self-signed, set GITLAB_TLS_INSECURE=1. If GitLab is VPN-only, Railway cannot reach it.`,
    );
  }
}

function httpsJson(
  urlStr: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const u = new URL(urlStr);
  const insecure = tlsInsecure();
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers,
        rejectUnauthorized: !insecure,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(
              new Error(`GitLab ${res.statusCode} ${u.pathname}: ${text.slice(0, 200)}`),
            );
            return;
          }
          try {
            resolve(JSON.parse(text) as unknown);
          } catch {
            reject(new Error(`GitLab returned non-JSON from ${u.pathname}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
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
