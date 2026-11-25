import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

export interface DirEntry {
  name: string;
  path: string;
}

const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/** True if `p` is inside one of `roots` (or `roots` is empty, meaning no restriction). */
export function isAllowed(p: string, roots: string[]): boolean {
  if (roots.length === 0) return true;
  return roots.some((root) => {
    const rel = path.relative(norm(root), norm(path.resolve(p)));
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
  });
}

/** Top-level entries for the folder picker: configured roots, else drive letters / "/". */
export function listRoots(roots: string[]): string[] {
  if (roots.length > 0) return roots;
  if (process.platform !== "win32") return ["/"];
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    .split("")
    .map((l) => `${l}:\\`)
    .filter((d) => existsSync(d));
}

export async function listDirs(dir: string): Promise<DirEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
