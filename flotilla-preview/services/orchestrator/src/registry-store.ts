import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import {
  PreviewEntry,
  PreviewEntrySchema,
  RegistryFile,
  RegistryFileSchema,
} from "@flotilla/shared";

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
      const merged: PreviewEntry = prev
        ? { ...entry, createdAt: prev.createdAt }
        : entry;
      data.previews[entry.slug] = PreviewEntrySchema.parse(merged);
      await this.save(data);
    });
  }

  async get(slug: string): Promise<PreviewEntry | undefined> {
    const data = await this.load();
    return data.previews[slug];
  }

  async list(): Promise<PreviewEntry[]> {
    const data = await this.load();
    return Object.values(data.previews);
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
      await this.save(data);
    });
  }
}
