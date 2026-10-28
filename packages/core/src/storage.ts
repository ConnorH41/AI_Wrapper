import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./db";

/**
 * Media lives behind a key so the backing store can change. The MVP writes to
 * the local filesystem to stay free; swapping in R2 means implementing this
 * interface and downloading to a temp path before handing files to ffmpeg.
 */
export type Storage = {
  put(key: string, data: Buffer | string, mime: string): Promise<string>;
  /** Absolute local path. Only meaningful while the store is the filesystem. */
  localPath(key: string): string;
  publicUrl(key: string): string;
};

const ROOT = process.env.MEDIA_ROOT
  ? path.resolve(process.env.MEDIA_ROOT)
  : path.join(REPO_ROOT, ".data", "media");

export const storage: Storage = {
  async put(key, data, _mime) {
    const target = localPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    return key;
  },

  localPath,

  publicUrl(key) {
    return `/api/media/${key}`;
  },
};

export function localPath(key: string): string {
  const target = path.resolve(ROOT, key);
  const relative = path.relative(ROOT, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Invalid storage key");
  }
  return target;
}

export function mediaRoot(): string {
  return ROOT;
}
