import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const HORIZONS_UPSTREAM = "https://ssd.jpl.nasa.gov/api/horizons.api";

/** Query keys we forward to JPL Horizons (block everything else). */
const ALLOWED_KEYS = new Set([
  "format",
  "COMMAND",
  "MAKE_EPHEM",
  "EPHEM_TYPE",
  "CENTER",
  "VEC_TABLE",
  "START_TIME",
  "STOP_TIME",
  "STEP_SIZE",
  "OBJ_DATA",
  "QUANTITIES",
  "REF_PLANE",
  "OUT_UNITS",
]);

function applyCors(reply: FastifyReply, request: FastifyRequest) {
  const origin = request.headers.origin;
  reply.header(
    "Access-Control-Allow-Origin",
    typeof origin === "string" && origin ? origin : "*",
  );
  reply.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  reply.header(
    "Access-Control-Allow-Headers",
    "Origin, Content-Type, Accept",
  );
  reply.header("Vary", "Origin");
}

/**
 * Browser-safe proxy for JPL Horizons.
 * ssd.jpl.nasa.gov does not send Access-Control-Allow-Origin, so preview
 * packs (and HostGator-hosted orbit) cannot fetch ephemerides directly.
 */
export async function registerHorizonsProxy(app: FastifyInstance) {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    applyCors(reply, request);
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }

    const q = request.query as Record<string, string | string[] | undefined>;
    const params = new URLSearchParams();
    params.set("format", "json");
    for (const [key, raw] of Object.entries(q)) {
      if (!ALLOWED_KEYS.has(key) || key === "format") continue;
      const val = Array.isArray(raw) ? raw[0] : raw;
      if (val == null || val === "") continue;
      params.set(key, String(val));
    }

    if (!params.get("COMMAND")) {
      return reply.code(400).type("application/json").send({
        error: "COMMAND required",
      });
    }

    const upstreamUrl = `${HORIZONS_UPSTREAM}?${params.toString()}`;
    try {
      const upstream = await fetch(upstreamUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "ops-mirror-horizons-proxy/1",
        },
      });
      const text = await upstream.text();
      reply.header(
        "cache-control",
        "public, max-age=300",
      );
      // Pass through JSON (or error body) with upstream status
      const ct = upstream.headers.get("content-type") || "application/json";
      return reply.code(upstream.status).type(ct).send(text);
    } catch (err) {
      request.log.warn({ err, upstreamUrl }, "horizons proxy fetch failed");
      return reply.code(502).type("application/json").send({
        error: "upstream Horizons unreachable",
      });
    }
  };

  app.route({
    method: ["GET", "HEAD", "OPTIONS"],
    url: "/asset-proxy/horizons",
    handler,
  });

  app.log.info("horizons proxy registered at /asset-proxy/horizons");
}
