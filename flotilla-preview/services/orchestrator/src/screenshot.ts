import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function screenshotsDirFromRegistry(registryPath: string): string {
  return join(dirname(registryPath), "screenshots");
}

export function screenshotFilePath(dir: string, slug: string): string {
  return join(dir, `${slug}.jpg`);
}

export async function screenshotExists(
  dir: string,
  slug: string,
): Promise<boolean> {
  try {
    await access(screenshotFilePath(dir, slug));
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture a JPEG of the public preview host (targetUrl, not the auth router).
 * Uses microlink, then thum.io as fallback. Returns true if a file was written.
 */
export async function capturePreviewScreenshot(
  slug: string,
  targetUrl: string,
  dir: string,
): Promise<boolean> {
  await mkdir(dir, { recursive: true });
  const dest = screenshotFilePath(dir, slug);
  const page = targetUrl.replace(/\/$/, "");

  const buf =
    (await tryMicrolink(page)) ?? (await tryThumIo(page)) ?? null;
  if (!buf || buf.length < 800) return false;
  await writeFile(dest, buf);
  return true;
}

async function tryMicrolink(pageUrl: string): Promise<Buffer | null> {
  try {
    const meta = new URL("https://api.microlink.io/");
    meta.searchParams.set("url", pageUrl);
    meta.searchParams.set("screenshot", "true");
    meta.searchParams.set("meta", "false");
    meta.searchParams.set("viewport.width", "1280");
    meta.searchParams.set("viewport.height", "720");
    const res = await fetch(meta, { signal: AbortSignal.timeout(40_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: string;
      data?: { screenshot?: { url?: string } };
    };
    const shot = json.data?.screenshot?.url;
    if (!shot) return null;
    const img = await fetch(shot, { signal: AbortSignal.timeout(40_000) });
    if (!img.ok) return null;
    return Buffer.from(await img.arrayBuffer());
  } catch {
    return null;
  }
}

async function tryThumIo(pageUrl: string): Promise<Buffer | null> {
  try {
    const shot = `https://image.thum.io/get/width/960/crop/540/noanimate/${pageUrl}`;
    const res = await fetch(shot, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("image")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
