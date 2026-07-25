import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const GOOGLE_OAUTH_AUTH = {
  authorizeHost: "https://accounts.google.com",
  authorizePath: "/o/oauth2/v2/auth",
  tokenHost: "https://www.googleapis.com",
  tokenPath: "/oauth2/v4/token",
} as const;
import { isEmailAllowed, parseList, appendHandoffToUrl } from "@flotilla/shared";
import { sessionKeyFromSecret } from "./session-key.js";

export type AuthEnv = {
  authDisabled: boolean;
  publicReadApi: boolean;
  publicBaseUrl: string;
  trustedReturnOrigins: string[];
  googleClientId?: string;
  googleClientSecret?: string;
  sessionSecret: string;
  cookieSecret: string;
  allowedDomains: string[];
  allowedEmails: string[];
};

export function loadAuthEnv(): AuthEnv {
  const authDisabled = process.env.AUTH_DISABLED === "1";
  const publicReadApi = process.env.PUBLIC_READ_API === "1";
  const publicBaseUrl = (
    process.env.AUTH_PUBLIC_BASE_URL ?? "http://127.0.0.1:3101"
  ).replace(/\/$/, "");
  const extra = parseList(process.env.AUTH_TRUSTED_RETURN_ORIGINS);
  const origins = new Set<string>();
  try {
    origins.add(new URL(publicBaseUrl).origin);
  } catch {
    /* ignore */
  }
  for (const o of extra) {
    try {
      origins.add(new URL(o.startsWith("http") ? o : `https://${o}`).origin);
    } catch {
      /* ignore */
    }
  }
  const trustedReturnOrigins = [...origins];
  return {
    authDisabled,
    publicReadApi,
    publicBaseUrl,
    trustedReturnOrigins,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    sessionSecret: process.env.SESSION_SECRET ?? "",
    cookieSecret: process.env.COOKIE_SECRET ?? process.env.SESSION_SECRET ?? "",
    allowedDomains: parseList(process.env.AUTH_ALLOWED_EMAIL_DOMAINS),
    allowedEmails: parseList(process.env.AUTH_ALLOWED_EMAILS),
  };
}

export function safeReturnTo(
  raw: string | undefined,
  fallback: string,
  trustedOrigins: string[],
): string {
  if (!raw?.trim()) return fallback;
  try {
    const u = new URL(raw);
    if (trustedOrigins.includes(u.origin)) return raw;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function canAccessApi(
  request: FastifyRequest,
  env: AuthEnv,
  internalToken: string | undefined,
): boolean {
  if (env.authDisabled) return true;
  if (env.publicReadApi && request.method === "GET") return true;
  const h = request.headers.authorization;
  const bearer =
    typeof h === "string" && h.startsWith("Bearer ")
      ? h.slice("Bearer ".length)
      : undefined;
  if (internalToken && bearer === internalToken) return true;
  const email = request.session.get("userEmail");
  if (
    typeof email === "string" &&
    isEmailAllowed(email, env.allowedDomains, env.allowedEmails)
  ) {
    return true;
  }
  return false;
}

const isProd = process.env.NODE_ENV === "production";

export async function registerAuthPlugins(
  app: FastifyInstance,
  env: AuthEnv,
): Promise<void> {
  // MVP / local: skip cookie + secure-session (native sodium) when auth is off.
  if (env.authDisabled) {
    app.log.warn("AUTH_DISABLED=1 — skipping session/OAuth plugins");
    app.get("/auth/google", async (_request, reply) =>
      reply
        .code(503)
        .type("text/plain")
        .send("Auth is disabled (AUTH_DISABLED=1)."),
    );
    app.get("/auth/google/callback", async (_request, reply) =>
      reply.code(503).send({ error: "auth disabled" }),
    );
    return;
  }

  let cookieSecret = env.cookieSecret;
  let sessionSecret = env.sessionSecret;
  if (Buffer.byteLength(cookieSecret, "utf8") < 32) {
    throw new Error(
      "COOKIE_SECRET (or SESSION_SECRET) must be at least 32 bytes for @fastify/cookie",
    );
  }
  if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes");
  }
  const resolved = { ...env, cookieSecret, sessionSecret };

  const cookie = (await import("@fastify/cookie")).default;
  const secureSession = (await import("@fastify/secure-session")).default;

  await app.register(cookie, {
    secret: resolved.cookieSecret,
  });

  await app.register(secureSession, {
    sessionName: "session",
    cookieName: "flotilla_preview_session",
    key: sessionKeyFromSecret(resolved.sessionSecret),
    cookie: {
      path: "/",
      secure: isProd,
      sameSite: "lax",
      httpOnly: true,
    },
  });

  const oauthConfigured =
    Boolean(resolved.googleClientId) &&
    Boolean(resolved.googleClientSecret);

  if (!oauthConfigured) {
    app.log.warn(
      "GOOGLE_CLIENT_ID/SECRET unset — /auth/google will return 503 until configured",
    );
    app.get("/auth/google", async (_request, reply) =>
      reply
        .code(503)
        .type("text/plain")
        .send(
          "Google OAuth is not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).",
        ),
    );
    app.get("/auth/google/callback", async (_request, reply) =>
      reply.code(503).send({ error: "oauth not configured" }),
    );
    return;
  }

  const oauthPlugin = (await import("@fastify/oauth2")).default;
  const callbackUri = `${resolved.publicBaseUrl}/auth/google/callback`;

  await app.register(oauthPlugin, {
    name: "googleOAuth2",
    scope: ["openid", "profile", "email"],
    credentials: {
      client: {
        id: resolved.googleClientId!,
        secret: resolved.googleClientSecret!,
      },
      auth: GOOGLE_OAUTH_AUTH,
    },
    callbackUri,
    cookie: {
      path: "/",
      secure: isProd,
      sameSite: "lax",
      httpOnly: true,
    },
    pkce: "S256",
  });

  const googleOauth = app.oauth2GoogleOAuth2;
  if (!googleOauth) {
    throw new Error("@fastify/oauth2 failed to register googleOAuth2");
  }

  const fallbackHome = `${resolved.publicBaseUrl}/`;

  app.get("/auth/google", async (request, reply) => {
    if (resolved.authDisabled) {
      return reply.redirect(fallbackHome);
    }
    const q = request.query as { return_to?: string };
    const returnTo = safeReturnTo(
      q.return_to,
      fallbackHome,
      resolved.trustedReturnOrigins,
    );
    request.session.set("oauthReturnTo", returnTo);
    const uri = await googleOauth.generateAuthorizationUri(request, reply);
    return reply.redirect(uri);
  });

  app.get("/auth/google/callback", async (request, reply) => {
    if (!oauthConfigured) {
      return reply.code(503).send("OAuth not configured");
    }
    try {
      const { token } =
        await googleOauth.getAccessTokenFromAuthorizationCodeFlow(
          request,
          reply,
        );
      const access = token.access_token as string;
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!res.ok) {
        return reply
          .code(502)
          .type("text/plain")
          .send("Failed to load Google profile");
      }
      const profile = (await res.json()) as { email?: string };
      const email = profile.email?.trim().toLowerCase();
      if (!email) {
        return reply.code(403).type("text/plain").send("No email on Google account");
      }
      if (
        !isEmailAllowed(email, resolved.allowedDomains, resolved.allowedEmails)
      ) {
        return reply
          .code(403)
          .type("text/html")
          .send(
            `<!doctype html><meta charset="utf-8"><title>Access denied</title><p>Email <strong>${email}</strong> is not allowed for this environment.</p>`,
          );
      }
      request.session.set("userEmail", email);
      const returnTo =
        (request.session.get("oauthReturnTo") as string | undefined) ??
        fallbackHome;
      request.session.set("oauthReturnTo", undefined);
      // Cross-origin return (preview router on another host): pass a short-lived handoff.
      try {
        const dest = new URL(returnTo);
        const self = new URL(resolved.publicBaseUrl);
        if (dest.origin !== self.origin) {
          return reply.redirect(
            appendHandoffToUrl(returnTo, email, resolved.sessionSecret),
          );
        }
      } catch {
        /* fall through */
      }
      return reply.redirect(returnTo);
    } catch (err) {
      request.log.error({ err }, "oauth callback failed");
      return reply.code(400).type("text/plain").send("OAuth callback failed");
    }
  });

  app.get("/auth/logout", async (request, reply) => {
    request.session.delete();
    return reply.redirect(fallbackHome);
  });

  app.get("/api/me", async (request, reply) => {
    if (resolved.authDisabled) {
      return { email: null as string | null, authDisabled: true };
    }
    const email = request.session.get("userEmail");
    if (
      typeof email !== "string" ||
      !isEmailAllowed(email, resolved.allowedDomains, resolved.allowedEmails)
    ) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { email };
  });
}

export function sendApiUnauthorized(reply: FastifyReply) {
  return reply.code(401).send({
    error: "unauthorized",
    loginPath: "/auth/google",
  });
}
