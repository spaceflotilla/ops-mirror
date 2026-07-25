import { createHmac, timingSafeEqual } from "node:crypto";

const HANDOFF_QUERY = "__fp_handoff";
const MAX_AGE_MS = 5 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

/** One-time cross-origin session handoff (orchestrator → router on different hosts). */
export function createHandoffToken(email: string, secret: string): string {
  const payload = JSON.stringify({
    email: email.trim().toLowerCase(),
    exp: Date.now() + MAX_AGE_MS,
  });
  const body = b64url(Buffer.from(payload, "utf8"));
  const sig = b64url(
    createHmac("sha256", secret).update(body, "utf8").digest(),
  );
  return `${body}.${sig}`;
}

export function verifyHandoffToken(
  token: string,
  secret: string,
): { email: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = b64url(
    createHmac("sha256", secret).update(body, "utf8").digest(),
  );
  try {
    const a = fromB64url(sig);
    const b = fromB64url(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(fromB64url(body).toString("utf8")) as {
      email?: string;
      exp?: number;
    };
    if (
      typeof parsed.email !== "string" ||
      typeof parsed.exp !== "number" ||
      Date.now() > parsed.exp
    ) {
      return null;
    }
    return { email: parsed.email.trim().toLowerCase() };
  } catch {
    return null;
  }
}

export function appendHandoffToUrl(
  returnTo: string,
  email: string,
  secret: string,
): string {
  const u = new URL(returnTo);
  u.searchParams.set(HANDOFF_QUERY, createHandoffToken(email, secret));
  return u.toString();
}

export function stripHandoffFromUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.delete(HANDOFF_QUERY);
  return u.toString();
}

export { HANDOFF_QUERY };
