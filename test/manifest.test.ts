import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { changedFiles, loadState, saveState } from "../src/server/manifest.js";
import { scanDirectory } from "../src/server/scanner.js";

const entry = (relPath: string, size: number, mtimeMs: number) => ({ relPath, absPath: `/x/${relPath}`, size, mtimeMs });

describe("changedFiles", () => {
  it("returns new files and files whose size or mtime changed", () => {
    const previous = { same: { size: 1, mtimeMs: 10 }, bigger: { size: 1, mtimeMs: 10 }, touched: { size: 1, mtimeMs: 10 } };
    const files = [entry("same", 1, 10), entry("bigger", 2, 10), entry("touched", 1, 11), entry("new", 1, 10)];
    expect(changedFiles(files, previous).map((f) => f.relPath)).toEqual(["bigger", "touched", "new"]);
  });
});

describe("state file", () => {
  it("defaults to empty when missing and round-trips", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "backup-tool-"));
    const file = path.join(dir, "state.json");
    const state = await loadState(file);
    expect(state).toEqual({ version: 1, sources: {} });
    state.sources["/src"] = { remoteName: "src-1234", files: { a: { size: 1, mtimeMs: 2 } } };
    await saveState(file, state);
    expect(await loadState(file)).toEqual(state);
  });
});

describe("scanDirectory", () => {
  it("lists nested files with /-separated relative paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "backup-tool-"));
    await mkdir(path.join(root, "sub", "deeper"), { recursive: true });
    await writeFile(path.join(root, "top.txt"), "1");
    await writeFile(path.join(root, "sub", "deeper", "leaf.txt"), "22");
    const { files, skipped } = await scanDirectory(root);
    expect(files.map((f) => [f.relPath, f.size]).sort()).toEqual([
      ["sub/deeper/leaf.txt", 2],
      ["top.txt", 1],
    ]);
    expect(skipped).toEqual([]);
  });
});
