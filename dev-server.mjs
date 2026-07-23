import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const port = Number(process.env.PORT || 8788);
const kvFile = path.join(root, ".data", "feeds-kv.json");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

/** Simple file-backed mock of Workers KV for local dev */
function createFileKv() {
  const ensure = () => {
    const dir = path.dirname(kvFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(kvFile)) fs.writeFileSync(kvFile, "{}", "utf8");
  };
  const readAll = () => {
    ensure();
    try {
      return JSON.parse(fs.readFileSync(kvFile, "utf8") || "{}");
    } catch {
      return {};
    }
  };
  const writeAll = (obj) => {
    ensure();
    fs.writeFileSync(kvFile, JSON.stringify(obj, null, 2), "utf8");
  };
  return {
    async get(key, type) {
      const all = readAll();
      const v = all[key];
      if (v == null) return null;
      if (type === "json") {
        try {
          return typeof v === "string" ? JSON.parse(v) : v;
        } catch {
          return null;
        }
      }
      return typeof v === "string" ? v : JSON.stringify(v);
    },
    async put(key, value) {
      const all = readAll();
      all[key] = value;
      writeAll(all);
    },
    async delete(key) {
      const all = readAll();
      delete all[key];
      writeAll(all);
    },
  };
}

const rssApi = await import(pathToFileURL(path.join(root, "functions/api/rss.js")).href);
const feedsApi = await import(pathToFileURL(path.join(root, "functions/api/feeds.js")).href);
const mockKv = createFileKv();
const env = { FEEDS: mockKv };

async function toNode(res, response) {
  const body = Buffer.from(await response.arrayBuffer());
  const headers = Object.fromEntries(response.headers);
  res.writeHead(response.status, headers);
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://127.0.0.1:${port}`);

    if (u.pathname === "/api/rss") {
      if (req.method === "OPTIONS") {
        return toNode(res, await rssApi.onRequestOptions());
      }
      if (req.method === "GET") {
        return toNode(res, await rssApi.onRequestGet({ request: new Request(u), env }));
      }
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }

    if (u.pathname === "/api/feeds") {
      if (req.method === "OPTIONS") {
        return toNode(res, await feedsApi.onRequestOptions());
      }
      if (req.method === "GET") {
        return toNode(res, await feedsApi.onRequestGet({ request: new Request(u), env }));
      }
      if (req.method === "PUT") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks);
        const request = new Request(u, {
          method: "PUT",
          headers: {
            "Content-Type": req.headers["content-type"] || "application/json",
          },
          body: raw.length ? raw : undefined,
        });
        return toNode(res, await feedsApi.onRequestPut({ request, env }));
      }
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }

    let p = u.pathname === "/" ? "/index.html" : decodeURIComponent(u.pathname);
    p = path.normalize(p).replace(/^(\.\.[/\\])+/, "");
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(String(e.stack || e));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Flux RSS ready: http://127.0.0.1:${port}`);
  console.log(`Feeds KV mock: ${kvFile}`);
});
