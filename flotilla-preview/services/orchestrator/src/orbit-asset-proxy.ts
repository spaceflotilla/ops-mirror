import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";

const DEFAULT_UPSTREAM = "https://flotilla.space/orbit";

/** Allow only safe relative paths under the upstream orbit root. */
export function sanitizeOrbitAssetPath(raw: string): string | null {
  const cleaned = String(raw || "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
  if (!cleaned || cleaned.includes("\0")) return null;
  const parts = cleaned.split("/");
  for (const p of parts) {
    if (!p || p === "." || p === "..") return null;
  }
  // Reject absolute / scheme-like segments
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return null;
  return parts.join("/");
}

function upstreamBase(): string {
  return (
    process.env.ORBIT_ASSET_UPSTREAM ?? DEFAULT_UPSTREAM
  ).replace(/\/+$/, "");
}

function applyCors(reply: FastifyReply, request: FastifyRequest) {
  const origin = request.headers.origin;
  reply.header(
    "Access-Control-Allow-Origin",
    typeof origin === "string" && origin ? origin : "*",
  );
  reply.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  reply.header(
    "Access-Control-Allow-Headers",
    "Origin, Range, Content-Type, Accept",
  );
  reply.header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
  reply.header("Vary", "Origin");
}

async function proxyOrbitAsset(
  request: FastifyRequest,
  reply: FastifyReply,
  relPath: string,
) {
  const safe = sanitizeOrbitAssetPath(relPath);
  if (!safe) {
    return reply.code(400).type("text/plain").send("bad path");
  }

  applyCors(reply, request);

  if (request.method === "OPTIONS") {
    return reply.code(204).send();
  }

  const upstreamUrl = `${upstreamBase()}/${safe}`;
  const headers: Record<string, string> = {
    Accept: request.headers.accept ?? "*/*",
    "User-Agent": "ops-mirror-orbit-asset-proxy/1",
  };
  const range = request.headers.range;
  if (typeof range === "string" && range) headers.Range = range;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      redirect: "follow",
    });
  } catch (err) {
    request.log.warn({ err, upstreamUrl }, "orbit asset proxy fetch failed");
    return reply
      .code(502)
      .type("text/plain")
      .send("upstream orbit asset unreachable");
  }

  const passHeaders = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "last-modified",
    "etag",
    "cache-control",
  ] as const;
  for (const h of passHeaders) {
    const v = upstream.headers.get(h);
    if (v) reply.header(h, v);
  }
  if (!upstream.headers.get("cache-control")) {
    reply.header("cache-control", "public, max-age=86400");
  }

  reply.code(upstream.status);

  if (request.method === "HEAD" || upstream.status === 204 || !upstream.body) {
    return reply.send();
  }

  // Node 18+ Readable.fromWeb for streaming large sprites/GLTF/8K
  const nodeStream = Readable.fromWeb(
    upstream.body as import("stream/web").ReadableStream,
  );
  return reply.send(nodeStream);
}

/**
 * Same-origin (ops) proxy for HostGator orbit assets.
 * HostGator does not send Access-Control-Allow-Origin, so preview packs
 * cannot fetch sprites/GLTF/8K cross-origin; this path adds CORS.
 */
export async function registerOrbitAssetProxy(app: FastifyInstance) {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { "*": string };
    return proxyOrbitAsset(request, reply, params["*"] || "");
  };

  app.route({
    method: ["GET", "HEAD", "OPTIONS"],
    url: "/asset-proxy/orbit",
    handler: async (request, reply) =>
      proxyOrbitAsset(request, reply, "index.html"),
  });
  app.route({
    method: ["GET", "HEAD", "OPTIONS"],
    url: "/asset-proxy/orbit/*",
    handler,
  });

  app.log.info(
    { upstream: upstreamBase() },
    "orbit asset proxy registered at /asset-proxy/orbit/*",
  );
}
