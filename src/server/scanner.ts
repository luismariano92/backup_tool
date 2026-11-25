import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface FileEntry {
  /** Path relative to the scanned root, always "/"-separated (it is also the remote path suffix). */
  relPath: string;
  absPath: string;
  size: number;
  mtimeMs: number;
}

export interface ScanResult {
  files: FileEntry[];
  /** Absolute paths that could not be read (permissions, races). They are reported, not fatal. */
  skipped: string[];
}

/** Recursively lists regular files under `root`. Symlinks are not followed. */
export async function scanDirectory(root: string): Promise<ScanResult> {
  const files: FileEntry[] = [];
  const skipped: string[] = [];

  async function walk(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      skipped.push(dir);
      return;
    }
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absPath, relPath);
      } else if (entry.isFile()) {
        try {
          const st = await stat(absPath);
          files.push({ relPath, absPath, size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          skipped.push(absPath);
        }
      }
    }
  }

  await walk(root, "");
  return { files, skipped };
}
