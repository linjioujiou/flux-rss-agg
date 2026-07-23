/**
 * Cloudflare Pages Function: /api/feeds
 * Persist RSS feed sources in Workers KV (binding: FEEDS).
 *
 * GET  /api/feeds  → { feeds: Feed[] }
 * PUT  /api/feeds  → body { feeds: Feed[] } → { ok: true, feeds }
 * OPTIONS          → CORS preflight
 *
 * Single-tenant key: feeds:v1 (no auth; matches client app model).
 */

const FEEDS_KEY = "feeds:v1";
const MAX_FEEDS = 100;
const MAX_URL_LEN = 2048;
const MAX_TITLE_LEN = 200;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function onRequestGet(context) {
  const env = context.env || {};
  const kv = env.FEEDS;

  if (!kv) {
    return json(
      {
        error: "FEEDS KV 未绑定。请在 wrangler.toml / Cloudflare Dashboard 绑定命名空间。",
        feeds: [],
        storage: "unavailable",
      },
      503
    );
  }

  try {
    const raw = await kv.get(FEEDS_KEY, "json");
    const feeds = sanitizeFeeds(raw);
    return json({ feeds, storage: "kv" }, 200, {
      "Cache-Control": "no-store",
    });
  } catch (err) {
    return json(
      { error: err?.message || "读取订阅源失败", feeds: [], storage: "error" },
      500
    );
  }
}

export async function onRequestPut(context) {
  const env = context.env || {};
  const kv = env.FEEDS;

  if (!kv) {
    return json(
      {
        error: "FEEDS KV 未绑定。请在 wrangler.toml / Cloudflare Dashboard 绑定命名空间。",
      },
      503
    );
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "无效的 JSON 请求体" }, 400);
  }

  if (!Array.isArray(body?.feeds)) {
    return json({ error: "请求体需包含 feeds 数组" }, 400);
  }
  if (body.feeds.length > MAX_FEEDS) {
    return json({ error: `订阅源数量不能超过 ${MAX_FEEDS}` }, 400);
  }

  const feeds = sanitizeFeeds(body.feeds);

  try {
    await kv.put(FEEDS_KEY, JSON.stringify(feeds));
    return json({ ok: true, feeds, storage: "kv" }, 200, {
      "Cache-Control": "no-store",
    });
  } catch (err) {
    return json({ error: err?.message || "写入订阅源失败" }, 500);
  }
}

function sanitizeFeeds(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    if (out.length >= MAX_FEEDS) break;

    let url = String(item.url || "").trim();
    if (!url || url.length > MAX_URL_LEN) continue;

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) continue;

    if (seen.has(url)) continue;
    seen.add(url);

    const id = String(item.id || "").trim() || fallbackId(url);
    const title = String(item.title || parsed.hostname || url)
      .trim()
      .slice(0, MAX_TITLE_LEN);
    const color = String(item.color || "#7dd3fc").slice(0, 32);
    const addedAt = Number(item.addedAt);
    out.push({
      id: id.slice(0, 80),
      url,
      title: title || parsed.hostname,
      color,
      addedAt: Number.isFinite(addedAt) ? addedAt : Date.now(),
    });
  }
  return out;
}

function fallbackId(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
  return `f_${h.toString(36)}`;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, ...extra },
  });
}
