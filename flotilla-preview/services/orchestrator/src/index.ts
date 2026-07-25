import { dirname, join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { RegistryStore } from "./registry-store.js";
import {
  parseGitLabWebhook,
  previewEntryFromPush,
  slugFromMerge,
} from "./gitlab-webhook.js";
import { applyDeployStub, snapshotModeEnabled } from "./deploy-stub.js";
import { PREVIEW_SLUG_REGEX, PreviewEntrySchema, PreviewFlagSchema, type PreviewFlag } from "@flotilla/shared";
import {
  canAccessApi,
  loadAuthEnv,
  registerAuthPlugins,
  sendApiUnauthorized,
} from "./auth-setup.js";
import { getSiteCatalog, invalidateSiteCatalogCache } from "./site-catalog.js";
import {
  capturePreviewScreenshot,
  screenshotFilePath,
  screenshotsDirFromRegistry,
  screenshotExists,
} from "./screenshot.js";
import {
  previewDir,
  previewSnapshotExists,
  previewsRootFromRegistry,
  publishTarGz,
} from "./preview-snapshots.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GITLAB_TOKEN_HEADER = "x-gitlab-token";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function contentTypeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function main() {
  const port = Number(process.env.PORT ?? "3101");
  const registryPath =
    process.env.REGISTRY_PATH ?? "./data/registry.json";
  const webhookSecret = process.env.GITLAB_WEBHOOK_SECRET;
  const internalToken = process.env.INTERNAL_API_TOKEN;
  const authEnv = loadAuthEnv();
  if (
    authEnv.googleClientId &&
    authEnv.googleClientSecret &&
    !authEnv.authDisabled &&
    authEnv.allowedDomains.length === 0 &&
    authEnv.allowedEmails.length === 0
  ) {
    console.warn(
      "[orchestrator] OAuth is configured but AUTH_ALLOWED_EMAIL_DOMAINS and AUTH_ALLOWED_EMAILS are empty — no logins will be allowed.",
    );
  }

  const store = new RegistryStore(registryPath);
  const shotsDir = screenshotsDirFromRegistry(registryPath);
  const previewsRoot = previewsRootFromRegistry(registryPath);

  const app = Fastify({ logger: true, bodyLimit: 85 * 1024 * 1024 });

  app.addContentTypeParser(
    "application/gzip",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );
  app.addContentTypeParser(
    "application/x-gzip",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  const refreshScreenshot = (slug: string, targetUrl: string) => {
    void (async () => {
      try {
        const ok = await capturePreviewScreenshot(slug, targetUrl, shotsDir);
        if (!ok) {
          app.log.warn({ slug, targetUrl }, "screenshot capture failed");
          return;
        }
        const cur = await store.get(slug);
        if (!cur) return;
        await store.upsert({
          ...cur,
          screenshotAt: new Date().toISOString(),
        });
        app.log.info({ slug }, "screenshot captured");
      } catch (err) {
        app.log.warn({ err, slug }, "screenshot capture error");
      }
    })();
  };

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(",") ?? true,
  });

  await registerAuthPlugins(app, authEnv);

  app.get("/health", async () => ({
    ok: true,
    service: "orchestrator",
    snapshotMode: snapshotModeEnabled(),
  }));

  app.get("/api/config", async () => ({
    routerPublicUrl:
      (process.env.ROUTER_PUBLIC_URL ?? "").replace(/\/$/, "") || null,
    snapshotMode: snapshotModeEnabled(),
  }));

  /** Serve per-slug static snapshots (version history without extra Railway services). */
  const sendPreviewFile = async (
    slug: string,
    relPath: string,
    reply: import("fastify").FastifyReply,
  ) => {
    if (!PREVIEW_SLUG_REGEX.test(slug)) {
      return reply.code(404).send("not found");
    }
    const root = previewDir(previewsRoot, slug);
    const cleaned = (relPath || "index.html").replace(/^\/+/, "") || "index.html";
    const abs = normalize(join(root, cleaned));
    if (!abs.startsWith(normalize(root))) {
      return reply.code(400).send("bad path");
    }
    try {
      const st = await stat(abs);
      if (st.isDirectory()) {
        return reply.redirect(`/p/${slug}/${cleaned.replace(/\/?$/, "/")}`);
      }
    } catch {
      // try index.html under dir
      try {
        const asIndex = normalize(join(root, cleaned, "index.html"));
        if (!asIndex.startsWith(normalize(root))) {
          return reply.code(400).send("bad path");
        }
        await access(asIndex);
        reply.type(contentTypeFor(asIndex));
        return reply.send(createReadStream(asIndex));
      } catch {
        return reply.code(404).type("text/plain").send("Preview snapshot missing — publish this slug");
      }
    }
    reply.type(contentTypeFor(abs));
    reply.header("cache-control", "public, max-age=60");
    return reply.send(createReadStream(abs));
  };

  app.get("/p/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    return reply.redirect(`/p/${slug}/`);
  });

  app.get("/p/:slug/", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    return sendPreviewFile(slug, "index.html", reply);
  });

  app.get("/p/:slug/*", async (request, reply) => {
    const params = request.params as { slug: string; "*": string };
    return sendPreviewFile(params.slug, params["*"], reply);
  });

  app.post("/webhooks/gitlab", async (request, reply) => {
    if (webhookSecret) {
      const token = request.headers[GITLAB_TOKEN_HEADER];
      const t = Array.isArray(token) ? token[0] : token;
      if (t !== webhookSecret) {
        return reply.code(401).send({ error: "invalid webhook token" });
      }
    }

    const dispatch = parseGitLabWebhook(request.body);

    if (dispatch.kind === "ignore") {
      return { ok: true, handled: false };
    }

    if (dispatch.kind === "merge") {
      const slug = slugFromMerge(dispatch);
      if (slug) {
        await store.markArchived(slug);
        invalidateSiteCatalogCache();
        return { ok: true, handled: true, archived: slug };
      }
      return { ok: true, handled: false };
    }

    const base = previewEntryFromPush(dispatch);
    if (!base) {
      app.log.warn(
        { branch: dispatch.branch },
        "branch name does not map to preview slug (expected project-color-animal)",
      );
      return { ok: true, handled: false, reason: "unmapped-branch" };
    }

    const hasSnap = await previewSnapshotExists(previewsRoot, base.slug);
    const withDeploy = applyDeployStub(
      { ...base, status: "building" },
      { snapshotReady: hasSnap },
    );
    const entry = PreviewEntrySchema.parse(withDeploy);
    await store.upsert(entry);
    invalidateSiteCatalogCache();
    if (hasSnap) refreshScreenshot(entry.slug, entry.targetUrl);

    return {
      ok: true,
      handled: true,
      slug: entry.slug,
      previewUrlPath: `/${entry.slug}`,
      snapshotReady: hasSnap,
      publishHint:
        "POST tar.gz to /api/previews/:slug/publish with Bearer INTERNAL_API_TOKEN",
    };
  });

  /**
   * Upload a site snapshot for a slug (.tar.gz body).
   * Called by GitLab CI or `scripts/publish-preview.mjs` after pushing a preview branch.
   */
  app.post("/api/previews/:slug/publish", async (request, reply) => {
    const h = request.headers.authorization;
    const bearer =
      typeof h === "string" && h.startsWith("Bearer ")
        ? h.slice("Bearer ".length)
        : undefined;
    if (!internalToken || bearer !== internalToken) {
      return sendApiUnauthorized(reply);
    }
    const { slug } = request.params as { slug: string };
    if (!PREVIEW_SLUG_REGEX.test(slug)) {
      return reply.code(400).send({ error: "invalid slug" });
    }
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length < 20) {
      return reply
        .code(400)
        .send({ error: "expected application/gzip tar.gz body" });
    }
    try {
      const result = await publishTarGz(previewsRoot, slug, body);
      const prev = await store.get(slug);
      const now = new Date().toISOString();
      const baseUrl = (
        process.env.AUTH_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`
      ).replace(/\/$/, "");
      const targetUrl = `${baseUrl}/p/${slug}/`;
      const entry = PreviewEntrySchema.parse({
        slug,
        projectPath: prev?.projectPath ?? "web/unknown",
        branch: prev?.branch ?? slug,
        commitSha: prev?.commitSha,
        commitTitle: prev?.commitTitle,
        description: prev?.description ?? prev?.commitTitle,
        targetUrl,
        status: "ready",
        archived: false,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        lastDeployAt: now,
      });
      await store.upsert(entry);
      invalidateSiteCatalogCache();
      refreshScreenshot(slug, targetUrl);
      return { ok: true, slug, targetUrl, ...result };
    } catch (err) {
      request.log.error({ err, slug }, "publish failed");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/api/previews", async (request, reply) => {
    if (!canAccessApi(request, authEnv, internalToken)) {
      return sendApiUnauthorized(reply);
    }
    const archived =
      (request.query as { archived?: string }).archived === "1";
    const all = await store.list();
    const filtered = archived
      ? all.filter((p) => p.archived)
      : all.filter((p) => !p.archived);
    filtered.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return { previews: filtered };
  });

  app.get("/api/previews/:slug", async (request, reply) => {
    if (!canAccessApi(request, authEnv, internalToken)) {
      return sendApiUnauthorized(reply);
    }
    const { slug } = request.params as { slug: string };
    const p = await store.get(slug);
    if (!p) return reply.code(404).send({ error: "not found" });
    return p;
  });

  /** Set curated branch flag (Latest / Production / …) without touching deploy status. */
  app.patch("/api/previews/:slug", async (request, reply) => {
    if (!canAccessApi(request, authEnv, internalToken)) {
      return sendApiUnauthorized(reply);
    }
    const { slug } = request.params as { slug: string };
    if (!PREVIEW_SLUG_REGEX.test(slug)) {
      return reply.code(400).send({ error: "invalid slug" });
    }
    const body = request.body as { flag?: unknown };
    if (!body || !("flag" in body)) {
      return reply.code(400).send({ error: "expected { flag }" });
    }
    let flag: PreviewFlag | null = null;
    if (body.flag === null || body.flag === "") {
      flag = null;
    } else {
      const parsed = PreviewFlagSchema.safeParse(body.flag);
      if (!parsed.success) {
        return reply.code(400).send({
          error:
            "flag must be latest|production|prototype|deprecated|broken or null",
        });
      }
      flag = parsed.data;
    }
    const updated = await store.setFlag(slug, flag);
    if (!updated) return reply.code(404).send({ error: "not found" });
    invalidateSiteCatalogCache();
    return updated;
  });

  app.get("/api/previews/:slug/screenshot", async (request, reply) => {
    if (!canAccessApi(request, authEnv, internalToken)) {
      return sendApiUnauthorized(reply);
    }
    const { slug } = request.params as { slug: string };
    const refresh =
      (request.query as { refresh?: string }).refresh === "1";
    const p = await store.get(slug);
    if (!p) return reply.code(404).send({ error: "not found" });

    const file = screenshotFilePath(shotsDir, slug);
    const have = await screenshotExists(shotsDir, slug);
    if (!have || refresh) {
      const ok = await capturePreviewScreenshot(slug, p.targetUrl, shotsDir);
      if (ok) {
        await store.upsert({
          ...p,
          screenshotAt: new Date().toISOString(),
        });
      } else if (!have) {
        return reply
          .code(404)
          .type("image/svg+xml")
          .send(
            `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect fill="#111827" width="960" height="540"/><text x="480" y="270" fill="#9aa3c7" font-family="system-ui,sans-serif" font-size="28" text-anchor="middle">Preview screenshot pending</text></svg>`,
          );
      }
    }

    try {
      await access(file);
    } catch {
      return reply.code(404).send({ error: "screenshot missing" });
    }
    reply.type("image/jpeg");
    reply.header("cache-control", "private, max-age=300");
    return reply.send(createReadStream(file));
  });

  app.get("/api/site-catalog", async (request, reply) => {
    if (!canAccessApi(request, authEnv, internalToken)) {
      return sendApiUnauthorized(reply);
    }
    const refresh =
      (request.query as { refresh?: string }).refresh === "1";
    return getSiteCatalog(store, refresh);
  });

  const dashboardDist =
    process.env.DASHBOARD_DIST?.trim() ||
    join(__dirname, "..", "..", "..", "apps", "dashboard", "dist");

  let dashboardServed = false;
  try {
    const { access } = await import("node:fs/promises");
    await access(join(dashboardDist, "index.html"));
    await app.register(fastifyStatic, {
      root: dashboardDist,
      prefix: "/",
    });
    dashboardServed = true;
    app.log.info({ dashboardDist }, "serving dashboard static files");
  } catch {
    app.log.info(
      { dashboardDist },
      "dashboard dist not found — API only (use Vite dev or run build)",
    );
  }

  if (dashboardServed) {
    app.setNotFoundHandler((request, reply) => {
      const url = request.raw.url?.split("?")[0] ?? "";
      if (
        url.startsWith("/api") ||
        url.startsWith("/webhooks") ||
        url.startsWith("/auth") ||
        url.startsWith("/p/") ||
        url === "/health"
      ) {
        return reply.code(404).send({ error: "not found" });
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(
    {
      port,
      registryPath,
      webhookSecretSet: Boolean(webhookSecret),
      authDisabled: authEnv.authDisabled,
      publicReadApi: authEnv.publicReadApi,
      dashboardServed,
    },
    "orchestrator listening",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
