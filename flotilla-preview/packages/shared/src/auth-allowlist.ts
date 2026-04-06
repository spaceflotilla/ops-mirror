/**
 * Env-style allowlists: domains without @, lowercase emails.
 * Domain match: exact host or subdomain (e.g. flotilla.space matches user@x.flotilla.space).
 */
export function parseList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(
  email: string,
  allowedDomains: string[],
  allowedEmails: string[],
): boolean {
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return false;
  if (allowedEmails.includes(e)) return true;
  const host = e.split("@").pop() ?? "";
  if (!host) return false;
  for (const d of allowedDomains) {
    if (host === d || host.endsWith(`.${d}`)) return true;
  }
  return false;
}
