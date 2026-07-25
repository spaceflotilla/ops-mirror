import { mkdir, rm, writeFile, access, readdir, cp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PREVIEW_SLUG_REGEX } from "@flotilla/shared";

const execFileAsync = promisify(execFile);

export function previewsRootFromRegistry(registryPath: string): string {
  return join(dirname(registryPath), "previews");
}

export function previewDir(root: string, slug: string): string {
  return join(root, slug);
}

export async function previewSnapshotExists(
  root: string,
  slug: string,
): Promise<boolean> {
  try {
    await access(join(previewDir(root, slug), "index.html"));
    return true;
  } catch {
    return false;
  }
}

export function snapshotPublicUrl(publicBase: string, slug: string): string {
  return `${publicBase.replace(/\/$/, "")}/p/${slug}/`;
}

/**
 * Replace snapshot for slug from a .tar.gz buffer.
 * Uses system `tar` (Railway bookworm).
 */
export async function publishTarGz(
  root: string,
  slug: string,
  tarGz: Buffer,
): Promise<{ bytes: number; filesHint: number }> {
  if (!PREVIEW_SLUG_REGEX.test(slug)) {
    throw new Error("invalid preview slug");
  }
  if (tarGz.length > 80 * 1024 * 1024) {
    throw new Error(
      "archive too large (max 80MB) — exclude textures/sprites/video",
    );
  }

  const dest = previewDir(root, slug);
  const tmpParent = join(root, ".tmp");
  const tmp = join(tmpParent, `${slug}-${Date.now()}`);
  const archivePath = join(tmpParent, `${slug}-${Date.now()}.tar.gz`);

  await mkdir(tmp, { recursive: true });
  await writeFile(archivePath, tarGz);

  try {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", tmp], {
      maxBuffer: 10 * 1024 * 1024,
    });
    const entries = await readdir(tmp, { withFileTypes: true });
    let source = tmp;
    if (
      entries.length === 1 &&
      entries[0]!.isDirectory() &&
      (entries[0]!.name === "site" || entries[0]!.name === "dist")
    ) {
      source = join(tmp, entries[0]!.name);
    }

    await rm(dest, { recursive: true, force: true });
    await mkdir(dirname(dest), { recursive: true });
    await cp(source, dest, { recursive: true });

    const files = await readdir(dest);
    return { bytes: tarGz.length, filesHint: files.length };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    await rm(archivePath, { force: true }).catch(() => undefined);
  }
}
