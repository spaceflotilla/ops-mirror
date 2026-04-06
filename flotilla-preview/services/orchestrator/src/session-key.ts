import { createHash } from "node:crypto";

/** 32-byte key for @fastify/secure-session, derived identically on orchestrator and router. */
export function sessionKeyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}
