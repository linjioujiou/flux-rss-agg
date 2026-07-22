import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const port = Number(process.env.PORT || 8788);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

const api = await import(pathToFileURL(path.join(root, "functions/api/rss.js")).href);

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://127.0.0.1:${port}`);
    if (u.pathname === "/api/rss") {
      if (req.method === "OPTIONS") {
        const r = await api.onRequestOptions();
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end();
        return;
      }
      const r = await api.onRequestGet({ request: new Request(u) });
      const body = Buffer.from(await r.arrayBuffer());
      const headers = Object.fromEntries(r.headers);
      res.writeHead(r.status, headers);
      res.end(body);
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
});