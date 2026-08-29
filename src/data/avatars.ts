import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export interface AvatarStore {
  /** Returns the relative path written (e.g. "bot-1.png"). */
  write(botId: string, mime: string, buffer: Buffer): string;
  read(relPath: string): Buffer | null;
  remove(relPath: string): void;
  getDir(): string;
}

export function createAvatarStore(dir: string): AvatarStore {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return {
    write(botId, mime, buffer) {
      const ext = MIME_TO_EXT[mime];
      if (!ext) throw new Error(`unsupported avatar MIME: ${mime}`);
      for (const name of readdirSync(dir)) {
        if (name.startsWith(`${botId}.`)) rmSync(join(dir, name), { force: true });
      }
      const rel = `${botId}.${ext}`;
      writeFileSync(join(dir, rel), buffer);
      return rel;
    },
    read(relPath) {
      const full = join(dir, relPath);
      // Audit SEC-12 (defense in depth): relPath is DB-sourced today, but a
      // future import/restore must not be able to point it outside dir.
      if (resolve(full) !== resolve(dir) && !resolve(full).startsWith(resolve(dir) + sep)) return null;
      if (!existsSync(full)) return null;
      return readFileSync(full);
    },
    remove(relPath) {
      const full = join(dir, relPath);
      if (resolve(full) !== resolve(dir) && !resolve(full).startsWith(resolve(dir) + sep)) return;
      rmSync(full, { force: true });
    },
    getDir() {
      return dir;
    },
  };
}
