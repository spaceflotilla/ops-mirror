import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import httpProxy from "http-proxy";
import { PREVIEW_SLUG_REGEX, type PreviewEntry } from "@flotilla/shared";
import {
  loadRouterAuth,
  loginRedirectUrl,
  previewUserAllowed,
  registerSession,
} from "./auth-session.js";

const proxy = httpProxy.createProxyServer({
  ws: true,
  xfwd: true,
});

proxy.on("error", (err, _req, res) => {
  if (res && "writeHead" in res && typeof res.writeHead === "function") {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Preview proxy error: ${err.message}`);
  }
});

async function fetchPreview(
  orchestratorUrl: string,
  slug: string,
  token: string | undefined,
): Promise<PreviewEntry | null> {
  const url = new URL(`/api/previews/${encodeURIComponent(slug)}`, orchestratorUrl);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`orchestrator ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as PreviewEntry;
}

/** `/slug/foo?x=1` → `/foo?x=1` */
function stripSlugFromRawUrl(rawUrl: string, slug: string): string {
  const q = rawUrl.indexOf("?");
  const pathOnly = q >= 0 ? rawUrl.slice(0, q) : rawUrl;
  const query = q >= 0 ? rawUrl.slice(q) : "";
  const prefix = `/${slug}`;
  let path: string;
  if (pathOnly === prefix || pathOnly === `${prefix}/`) path = "/";
  else if (pathOnly.startsWith(`${prefix}/`))
    path = pathOnly.slice(prefix.length) || "/";
  else path = pathOnly || "/";
  return `${path}${query}`;
}

function requestFullUrl(request: FastifyRequest): string {
  const xf = request.headers["x-forwarded-proto"];
  const proto = (Array.isArray(xf) ? xf[0] : xf) ?? "http";
  const host = request.headers.host ?? "localhost";
  const path = request.raw.url ?? "/";
  return `${proto}://${host}${path}`;
}

async function main() {
  const port = Number(process.env.PORT ?? "3102");
  const orchestratorUrl =
    process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:3101";
  const internalToken = process.env.INTERNAL_API_TOKEN;
  const authCfg = loadRouterAuth();

  const app = Fastify({ logger: true, trustProxy: true });
  await registerSession(app, authCfg);

  app.all("/health", async () => ({ ok: true, service: "preview-router" }));

  app.all("/*", async (request: FastifyRequest, reply: FastifyReply) => {
    const rawPath = request.raw.url?.split("?")[0] ?? "/";

    const segments = rawPath.split("/").filter(Boolean);
    const slug = segments[0];
    if (!slug || !PREVIEW_SLUG_REGEX.test(slug)) {
      return reply
        .code(404)
        .type("text/plain")
        .send("Not a preview path (expected /project-color-animal/...)");
    }

    if (!authCfg.authDisabled) {
      const email = request.session.get("userEmail");
      if (!previewUserAllowed(email, authCfg)) {
        const dest = loginRedirectUrl(requestFullUrl(request), authCfg);
        return reply.redirect(dest);
      }
    }

    const entry = await fetchPreview(orchestratorUrl, slug, internalToken);
    if (!entry) {
      return reply.code(404).type("text/plain").send("Unknown preview slug");
    }
    if (entry.archived) {
      return reply.code(410).type("text/plain").send("Preview archived");
    }

    const target = new URL(entry.targetUrl);
    const outgoingPath = stripSlugFromRawUrl(request.raw.url ?? "/", slug);

    reply.hijack();

    proxy.once("proxyReq", (proxyReq) => {
      proxyReq.path = outgoingPath;
    });

    proxy.web(
      request.raw,
      reply.raw,
      {
        target: `${target.origin}`,
        changeOrigin: true,
        secure: target.protocol === "https:",
      },
      (err) => {
        if (err && !reply.raw.writableEnded) {
          reply.raw.statusCode = 502;
          reply.raw.end(err.message);
        }
      },
    );
  });

  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(
    { port, orchestratorUrl, authDisabled: authCfg.authDisabled },
    "preview-router listening",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
