import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebDavClient } from "../src/server/webdav.js";
import { startFakeDav } from "./fake-webdav.js";

let dav: Awaited<ReturnType<typeof startFakeDav>> | undefined;
afterEach(async () => {
  await dav?.close();
  dav = undefined;
});

describe("WebDavClient", () => {
  it("creates each missing collection once, in order", async () => {
    dav = await startFakeDav();
    const client = new WebDavClient({ url: dav.url });
    await client.ensureDir("a/b/c");
    await client.ensureDir("a/b/d");
    const mkcols = dav.requests.filter((r) => r.method === "MKCOL").map((r) => r.path);
    expect(mkcols).toEqual(["/dav/a/", "/dav/a/b/", "/dav/a/b/c/", "/dav/a/b/d/"]);
  });

  it("uploads file contents with basic auth and encodes path segments", async () => {
    dav = await startFakeDav();
    const dir = await mkdtemp(path.join(tmpdir(), "backup-tool-"));
    const local = path.join(dir, "file.txt");
    await writeFile(local, "hello");
    const client = new WebDavClient({ url: dav.url, username: "u", password: "p" });

    await client.putFile("x/my file#1.txt", local, 5);

    expect(dav.files.get("/dav/x/my file#1.txt")?.toString()).toBe("hello");
    expect(dav.requests[0].auth).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });

  it("throws on a failed PUT", async () => {
    dav = await startFakeDav({ failPutFor: () => true });
    const dir = await mkdtemp(path.join(tmpdir(), "backup-tool-"));
    const local = path.join(dir, "f");
    await writeFile(local, "x");
    await expect(new WebDavClient({ url: dav.url }).putFile("f", local, 1)).rejects.toThrow(/HTTP 500/);
  });

  it("check() returns the PROPFIND status", async () => {
    dav = await startFakeDav();
    expect(await new WebDavClient({ url: dav.url }).check()).toBe(207);
  });
});
