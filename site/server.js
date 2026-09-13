// Static server for the HMNUnet 3D explorer. Node >= 20, no dependencies.
//
// Environment:
//   PORT            port to listen on (Railway sets it; 8080 when unset, Railway's default target)
//   ALLOW_INDEXING  "1" drops the noindex header (off by default: the page embeds challenge data)
//
// Local use: node server.js [port] [--dev]   (--dev re-reads files on every request)
//
// Binary data lives on disk only as name.bin.gz. Clients that accept gzip get the file as is
// with Content-Encoding: gzip; anyone else gets it decompressed on the fly.

import { createServer } from "node:http";
import { createReadStream, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { brotliCompressSync, constants as zc, createGunzip, gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "public");
const ARGS = process.argv.slice(2);
const DEV = ARGS.includes("--dev");
const PORT = Number(process.env.PORT) || Number(ARGS.find((a) => /^\d+$/.test(a))) || 8080;
const INDEXING = process.env.ALLOW_INDEXING === "1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".bin": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
};
const TEXT = new Set([".html", ".js", ".css", ".json", ".svg", ".txt"]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

// Text assets are small: keep them in memory with brotli and gzip variants.
const assets = new Map();
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else register(full);
  }
}
function register(full) {
  const rel = "/" + relative(ROOT, full).split(sep).join("/");
  const stat = statSync(full);
  if (rel.endsWith(".bin.gz")) {
    const url = rel.slice(0, -3);
    assets.set(url, { kind: "gz", path: full, size: stat.size, etag: tag(`${url}:${stat.size}:${stat.mtimeMs}`) });
    return;
  }
  const ext = extname(full);
  if (!TYPES[ext]) return;
  if (TEXT.has(ext)) {
    const body = readFileSync(full);
    assets.set(rel, {
      kind: "text",
      type: TYPES[ext],
      body,
      br: DEV ? null : brotliCompressSync(body, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }),
      gz: DEV ? null : gzipSync(body, { level: 9 }),
      etag: tag(createHash("sha1").update(body).digest("hex")),
    });
  } else {
    assets.set(rel, { kind: "file", type: TYPES[ext], path: full, size: stat.size, etag: tag(`${rel}:${stat.size}:${stat.mtimeMs}`) });
  }
}
function tag(seed) {
  return `"${createHash("sha1").update(seed).digest("base64url").slice(0, 20)}"`;
}
function refresh(url) {
  const full = join(ROOT, ...url.split("/").filter(Boolean));
  if (!full.startsWith(ROOT + sep)) return;
  assets.delete(url);
  for (const candidate of [`${full}.gz`, full]) {
    try {
      if (statSync(candidate).isFile()) return register(candidate);
    } catch {}
  }
}
walk(ROOT);

function cacheControl(url) {
  if (DEV) return "no-store";
  if (url.startsWith("/vendor/")) return "public, max-age=604800";
  if (url.startsWith("/data/") && url !== "/data/manifest.json") return "public, max-age=31536000, immutable";
  return "no-cache";
}

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", CSP);
  if (!INDEXING) res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

const server = createServer((req, res) => {
  securityHeaders(res);
  let url;
  try {
    url = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Bad request");
  }

  if (url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    return res.end("ok");
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }

  const key = url === "/" ? "/index.html" : url;
  if (DEV) refresh(key);
  const asset = assets.get(key);
  if (!asset) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }

  const accept = String(req.headers["accept-encoding"] || "");
  const headers = { "Cache-Control": cacheControl(key), ETag: asset.etag, Vary: "Accept-Encoding" };
  if (req.headers["if-none-match"] === asset.etag) {
    res.writeHead(304, headers);
    return res.end();
  }

  if (asset.kind === "text") {
    let body = asset.body;
    if (asset.br && /\bbr\b/.test(accept)) {
      body = asset.br;
      headers["Content-Encoding"] = "br";
    } else if (asset.gz && /\bgzip\b/.test(accept)) {
      body = asset.gz;
      headers["Content-Encoding"] = "gzip";
    }
    res.writeHead(200, { ...headers, "Content-Type": asset.type, "Content-Length": body.length });
    return res.end(req.method === "HEAD" ? undefined : body);
  }

  if (asset.kind === "gz") {
    headers["Content-Type"] = TYPES[".bin"];
    if (/\bgzip\b/.test(accept)) {
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = asset.size;
      res.writeHead(200, headers);
      if (req.method === "HEAD") return res.end();
      return createReadStream(asset.path).pipe(res);
    }
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    return createReadStream(asset.path).pipe(createGunzip()).pipe(res);
  }

  res.writeHead(200, { ...headers, "Content-Type": asset.type, "Content-Length": asset.size });
  if (req.method === "HEAD") return res.end();
  createReadStream(asset.path).pipe(res);
});

// Listen on "::" (IPv6 and IPv4 on a dual-stack host) so the platform proxy reaches us over
// either family; fall back to IPv4 only where IPv6 is unavailable.
function listen(host) {
  const onError = (error) => {
    if (host === "::" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) return listen("0.0.0.0");
    console.error(`cannot listen on ${host} port ${PORT}: ${error.message}`);
    process.exit(1);
  };
  server.once("error", onError);
  server.listen(PORT, host, () => {
    server.off("error", onError);
    const family = host === "::" ? "IPv4 + IPv6" : "IPv4";
    console.log(`listening on port ${PORT} (${family}), ${assets.size} assets`);
  });
}
listen("::");
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
