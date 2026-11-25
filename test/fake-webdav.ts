import http from "node:http";
import type { AddressInfo } from "node:net";

/** In-memory WebDAV server supporting MKCOL / PUT / PROPFIND, for tests. */
export async function startFakeDav(opts: { failPutFor?: (path: string) => boolean } = {}) {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  const requests: { method: string; path: string; auth?: string }[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      requests.push({ method: req.method ?? "", path: p, auth: req.headers.authorization });
      if (req.method === "MKCOL") {
        const d = p.replace(/\/$/, "");
        res.statusCode = dirs.has(d) ? 405 : 201;
        dirs.add(d);
      } else if (req.method === "PUT") {
        if (opts.failPutFor?.(p)) res.statusCode = 500;
        else {
          files.set(p, Buffer.concat(chunks));
          res.statusCode = 201;
        }
      } else if (req.method === "PROPFIND") {
        res.statusCode = 207;
      } else {
        res.statusCode = 405;
      }
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/dav`,
    files,
    dirs,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
