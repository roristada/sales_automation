import { createReadStream, type ReadStream } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Where render outputs live (PLAN.md §2 StorageAdapter). Local disk for the single-machine setup;
 * an object-storage adapter (Supabase Storage / S3) can replace it without touching callers.
 * Shared by the web app (reads) and the worker (writes) — no Next-only imports here.
 */
export interface StorageAdapter {
  put(key: string, sourcePath: string): Promise<void>;
  size(key: string): Promise<number | null>;
  read(key: string, range?: { start: number; end: number }): ReadStream;
  removePrefix(prefix: string): Promise<void>;
}

/** Keys look like "<owner uuid>/<job uuid>/video.mp4"; anything else is rejected. */
const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[a-z0-9_.-]{1,64}$/;

export function assertKey(key: string) {
  if (!KEY.test(key)) throw new Error(`invalid storage key: ${key}`);
}

export class LocalDiskStorage implements StorageAdapter {
  constructor(private readonly root: string) {}

  private file(key: string) {
    assertKey(key);
    return path.join(this.root, ...key.split("/"));
  }

  async put(key: string, sourcePath: string) {
    const dest = this.file(key);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(sourcePath, dest);
  }

  async size(key: string) {
    try {
      return (await stat(this.file(key))).size;
    } catch {
      return null;
    }
  }

  read(key: string, range?: { start: number; end: number }) {
    return createReadStream(this.file(key), range);
  }

  async removePrefix(prefix: string) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(prefix)) throw new Error(`invalid storage prefix: ${prefix}`);
    await rm(path.join(this.root, ...prefix.split("/")), { recursive: true, force: true });
  }
}

/** Folder of the local disk store (also what backups copy). */
export function storageRoot(): string {
  return path.resolve(process.env.RENDER_STORAGE_DIR || "storage/renders");
}

export function getStorage(): StorageAdapter {
  return new LocalDiskStorage(storageRoot());
}
