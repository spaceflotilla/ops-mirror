import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { RegistryStore } from "./registry-store.js";
import {
  parseGitLabWebhook,
  previewEntryFromPush,
  slugFromMerge,
} from "./gitlab-webhook.js";
import { applyDeployStub } from "./deploy-stub.js";
import { PreviewEntrySchema } from "@flotilla/shared";
import {
  canAccessApi,
  loadAuthEnv,
  registerAuthPlugins,
  sendApiUnauthorized,
} from "./auth-setup.js";
import { getSiteCatalog, invalidateSiteCatalogCache } from "./site-catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GITLAB_TOKEN_HEADER = "x-gitlab-token";

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

  const app = Fastify({ logger: true });
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(",") ?? true,
  });

  await registerAuthPlugins(app, authEnv);

  app.get("/health", async () => ({ ok: true, service: "orchestrator" }));

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

    const withDeploy = applyDeployStub({
      ...base,
      status: "building",
    });
    const entry = PreviewEntrySchema.parse(withDeploy);
    await store.upsert(entry);
    invalidateSiteCatalogCache();

    return {
      ok: true,
      handled: true,
      slug: entry.slug,
      previewUrlPath: `/${entry.slug}`,
    };
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
