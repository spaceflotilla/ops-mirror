import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import secureSession from "@fastify/secure-session";
import { isEmailAllowed, parseList } from "@flotilla/shared";

function sessionKeyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

const isProd = process.env.NODE_ENV === "production";

const DEV_PLACEHOLDER = "local-dev-placeholder-32chars-min!!";

export type RouterAuthConfig = {
  authDisabled: boolean;
  sessionSecret: string;
  cookieSecret: string;
  authIssuerUrl: string;
  allowedDomains: string[];
  allowedEmails: string[];
};

export function loadRouterAuth(): RouterAuthConfig {
  const authDisabled = process.env.AUTH_DISABLED === "1";
  let sessionSecret = process.env.SESSION_SECRET ?? "";
  let cookieSecret =
    process.env.COOKIE_SECRET ?? process.env.SESSION_SECRET ?? "";
  if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
    if (authDisabled) sessionSecret = DEV_PLACEHOLDER;
    else {
      throw new Error("SESSION_SECRET must be at least 32 bytes (match orchestrator)");
    }
  }
  if (Buffer.byteLength(cookieSecret, "utf8") < 32) {
    if (authDisabled) cookieSecret = DEV_PLACEHOLDER;
    else cookieSecret = sessionSecret;
  }
  const authIssuerUrl = (
    process.env.AUTH_ISSUER_URL ??
    process.env.AUTH_PUBLIC_BASE_URL ??
    "http://127.0.0.1:3101"
  ).replace(/\/$/, "");
  return {
    authDisabled,
    sessionSecret,
    cookieSecret,
    authIssuerUrl,
    allowedDomains: parseList(process.env.AUTH_ALLOWED_EMAIL_DOMAINS),
    allowedEmails: parseList(process.env.AUTH_ALLOWED_EMAILS),
  };
}

export async function registerSession(app: FastifyInstance, cfg: RouterAuthConfig) {
  await app.register(cookie, { secret: cfg.cookieSecret });
  await app.register(secureSession, {
    sessionName: "session",
    cookieName: "flotilla_preview_session",
    key: sessionKeyFromSecret(cfg.sessionSecret),
    cookie: {
      path: "/",
      secure: isProd,
      sameSite: "lax",
      httpOnly: true,
    },
  });
}

export function previewUserAllowed(
  email: string | undefined,
  cfg: RouterAuthConfig,
): boolean {
  if (cfg.authDisabled) return true;
  if (typeof email !== "string") return false;
  return isEmailAllowed(email, cfg.allowedDomains, cfg.allowedEmails);
}

export function loginRedirectUrl(currentFullUrl: string, cfg: RouterAuthConfig): string {
  const ret = encodeURIComponent(currentFullUrl);
  return `${cfg.authIssuerUrl}/auth/google?return_to=${ret}`;
}
