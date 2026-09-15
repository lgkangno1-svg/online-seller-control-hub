import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

export async function serveWebAsset(
  req: IncomingMessage,
  res: ServerResponse,
  distPath: string
): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (!req.url || req.url.startsWith("/api")) return false;

  const pathname = new URL(req.url, "http://localhost").pathname;
  const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const root = resolve(distPath);
  const candidate = resolve(root, requested);

  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    res.statusCode = 400;
    res.end("Bad request");
    return true;
  }

  const file = await findFile(candidate, root);
  if (!file) return false;

  const extension = extname(file).toLowerCase();
  res.statusCode = 200;
  res.setHeader("Content-Type", CONTENT_TYPES[extension] ?? "application/octet-stream");
  res.setHeader("Cache-Control", extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable");

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  res.end(await readFile(file));
  return true;
}

async function findFile(candidate: string, root: string): Promise<string | null> {
  try {
    if ((await stat(candidate)).isFile()) return candidate;
  } catch {
    // SPA fallback below.
  }

  const fallback = resolve(root, "index.html");
  try {
    return (await stat(fallback)).isFile() ? fallback : null;
  } catch {
    return null;
  }
}
