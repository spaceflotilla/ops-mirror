import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import {
  PreviewEntry,
  PreviewEntrySchema,
  RegistryFile,
  RegistryFileSchema,
} from "@flotilla/shared";

/** Recency for auto-Latest: deploy time, else first seen — not flag edits. */
function previewRecencyMs(p: PreviewEntry): number {
  const raw = p.lastDeployAt ?? p.createdAt;
  return new Date(raw).getTime() || 0;
}

/**
 * Ensure exactly one Latest per projectPath among non-archived previews.
 * - Default: newest by lastDeployAt/createdAt gets Latest (flagManual false).
 * - Manual Latest pin wins until cleared.
 * - Manual non-Latest (e.g. Broken on the newest) skips that entry; next eligible wins.
 */
export function reconcileLatestFlags(data: RegistryFile): void {
  const byProject = new Map<string, PreviewEntry[]>();
  for (const p of Object.values(data.previews)) {
    if (p.archived) continue;
    const list = byProject.get(p.projectPath) ?? [];
    list.push(p);
    byProject.set(p.projectPath, list);
  }

  const now = new Date().toISOString();

  for (const group of byProject.values()) {
    const manualPins = group.filter(
      (p) => p.flagManual && p.flag === "latest",
    );
    let winner: PreviewEntry | undefined;
    if (manualPins.length > 0) {
      manualPins.sort((a, b) => previewRecencyMs(b) - previewRecencyMs(a));
      winner = manualPins[0];
    } else {
      const sorted = [...group].sort(
        (a, b) => previewRecencyMs(b) - previewRecencyMs(a),
      );
      winner = sorted.find(
        (p) => !(p.flagManual && p.flag && p.flag !== "latest"),
      );
    }
    if (!winner) continue;

    for (const p of group) {
      if (p.slug === winner.slug) {
        const pinned = Boolean(winner.flagManual && winner.flag === "latest");
        if (p.flag !== "latest") {
          p.flag = "latest";
          if (!pinned) delete (p as { flagManual?: boolean }).flagManual;
          p.updatedAt = now;
        } else if (!pinned && p.flagManual) {
          delete (p as { flagManual?: boolean }).flagManual;
          p.updatedAt = now;
        }
        continue;
      }

      // Only one Latest per project — clear from everyone else.
      if (p.flag === "latest") {
        delete (p as { flag?: PreviewEntry["flag"] }).flag;
        delete (p as { flagManual?: boolean }).flagManual;
        p.updatedAt = now;
      }
    }
  }
}

export class RegistryStore {
  /** Serialize read-modify-write so concurrent webhooks cannot lose updates (single-process v1). */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async load(): Promise<RegistryFile> {
    try {
      const raw = await readFile(this.path, "utf-8");
      const json = JSON.parse(raw) as unknown;
      return RegistryFileSchema.parse(json);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return { version: 1, previews: {} };
      }
      throw e;
    }
  }

  async save(data: RegistryFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmp, this.path);
  }

  async upsert(entry: PreviewEntry): Promise<void> {
    await this.enqueue(async () => {
      const data = await this.load();
      const prev = data.previews[entry.slug];
      // Merge onto prev so omitted user fields (e.g. flag) survive webhook/publish.
      const merged: PreviewEntry = prev
        ? { ...prev, ...entry, createdAt: prev.createdAt }
        : entry;
      data.previews[entry.slug] = PreviewEntrySchema.parse(merged);
      reconcileLatestFlags(data);
      // Re-parse after reconcile mutations
      for (const slug of Object.keys(data.previews)) {
        data.previews[slug] = PreviewEntrySchema.parse(data.previews[slug]);
      }
      await this.save(data);
    });
  }

  /** Set or clear the curated branch flag (null clears). Marks flagManual. */
  async setFlag(
    slug: string,
    flag: PreviewEntry["flag"] | null,
  ): Promise<PreviewEntry | undefined> {
    return this.enqueue(async () => {
      const data = await this.load();
      const cur = data.previews[slug];
      if (!cur) return undefined;
      const next: PreviewEntry = { ...cur };
      if (flag == null) {
        delete (next as { flag?: PreviewEntry["flag"] }).flag;
        delete (next as { flagManual?: boolean }).flagManual;
      } else {
        next.flag = flag;
        next.flagManual = true;
      }
      data.previews[slug] = PreviewEntrySchema.parse(next);
      reconcileLatestFlags(data);
      for (const s of Object.keys(data.previews)) {
        data.previews[s] = PreviewEntrySchema.parse(data.previews[s]);
      }
      await this.save(data);
      return data.previews[slug];
    });
  }

  async get(slug: string): Promise<PreviewEntry | undefined> {
    const data = await this.load();
    return data.previews[slug];
  }

  async list(): Promise<PreviewEntry[]> {
    return this.enqueue(async () => {
      const data = await this.load();
      const before = JSON.stringify(data.previews);
      reconcileLatestFlags(data);
      const after = JSON.stringify(data.previews);
      if (before !== after) {
        for (const slug of Object.keys(data.previews)) {
          data.previews[slug] = PreviewEntrySchema.parse(data.previews[slug]);
        }
        await this.save(data);
      }
      return Object.values(data.previews);
    });
  }

  async markArchived(slug: string): Promise<void> {
    await this.enqueue(async () => {
      const data = await this.load();
      const cur = data.previews[slug];
      if (!cur) return;
      const now = new Date().toISOString();
      data.previews[slug] = {
        ...cur,
        archived: true,
        status: "archived",
        updatedAt: now,
      };
      reconcileLatestFlags(data);
      for (const s of Object.keys(data.previews)) {
        data.previews[s] = PreviewEntrySchema.parse(data.previews[s]);
      }
      await this.save(data);
    });
  }
}
