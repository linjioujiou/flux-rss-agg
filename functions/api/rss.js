/**
 * Cloudflare Pages Function: GET /api/rss?url=
 * Fetches remote RSS/Atom and returns JSON.
 * Pure-JS XML extraction (no DOMParser) for Workers compatibility.
 */

const MAX_BYTES = 2_500_000;
const FETCH_TIMEOUT_MS = 12_000;
const UA = "FluxRSS/1.0 (+Cloudflare Pages; RSS aggregator)";

export async function onRequestGet(context) {
  const { request } = context;
  const reqUrl = new URL(request.url);
  const target = (reqUrl.searchParams.get("url") || "").trim();

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=300",
    "Content-Type": "application/json; charset=utf-8",
  };

  if (!target) return json({ error: "缺少 url 参数" }, 400, cors);

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: "无效的 URL" }, 400, cors);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return json({ error: "仅支持 http/https 协议" }, 400, cors);
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host.endsWith(".local") ||
    isPrivateIp(host)
  ) {
    return json({ error: "不允许访问该主机" }, 400, cors);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return json({ error: `上游返回 HTTP ${res.status}` }, 502, cors);
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return json({ error: "订阅内容过大" }, 413, cors);
    }

    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const feed = parseFeed(text);

    if (!feed.items.length && !feed.title) {
      return json({ error: "无法解析为 RSS/Atom 订阅" }, 422, cors);
    }

    return json(feed, 200, cors);
  } catch (err) {
    const msg =
      err?.name === "AbortError"
        ? "拉取订阅超时"
        : err?.message || "拉取订阅失败";
    return json({ error: msg }, 502, cors);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

function isPrivateIp(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/* ---------- Pure-JS RSS / Atom parser ---------- */

function parseFeed(xml) {
  const cleaned = String(xml || "")
    .replace(/^\uFEFF/, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  if (/<feed[\s>]/i.test(cleaned) && /<entry[\s>]/i.test(cleaned)) {
    return parseAtom(cleaned);
  }
  if (
    /<rss[\s>]/i.test(cleaned) ||
    /<channel[\s>]/i.test(cleaned) ||
    /<item[\s>]/i.test(cleaned)
  ) {
    return parseRss(cleaned);
  }
  if (/<feed[\s>]/i.test(cleaned)) return parseAtom(cleaned);
  return { title: "", description: "", link: "", items: [] };
}

function decodeEntities(str) {
  return String(str || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#0*34;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .trim();
}

/**
 * Feed bodies are often entity-encoded HTML (&lt;p&gt;...&lt;/p&gt;).
 * Decode until we get real tags or the string stabilizes.
 */
function decodeHtmlPayload(str) {
  let s = String(str || "");
  for (let i = 0; i < 4; i++) {
    const next = decodeEntities(s);
    if (next === s) break;
    s = next;
    // Stop once we have real tags and no more encoded open-tags
    if (/<[a-zA-Z][\s\S]*>/.test(s) && !/&lt;\/?[a-zA-Z]/.test(s)) break;
  }
  return s;
}

function stripTags(html) {
  return decodeEntities(String(html || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escTag(name) {
  return String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagText(block, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const n = escTag(name);
    const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}\\s*>`, "i");
    const m = block.match(re);
    if (m) {
      const v = decodeEntities(m[1]);
      if (v) return v;
    }
  }
  return "";
}

function tagHtml(block, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const n = escTag(name);
    const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}\\s*>`, "i");
    const m = block.match(re);
    if (m) {
      const raw = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").trim();
      // Always decode entity-encoded HTML so the client can render tags/images
      if (raw) return decodeHtmlPayload(raw);
    }
  }
  return "";
}

function attrFromTag(block, tagName, attr) {
  const n = escTag(tagName);
  const re = new RegExp(`<${n}\\b([^>]*)/?>`, "i");
  const m = block.match(re);
  if (!m) return "";
  const attrs = m[1];
  const am = attrs.match(
    new RegExp(`${escTag(attr)}\\s*=\\s*["']([^"']+)["']`, "i")
  );
  return am ? decodeEntities(am[1]) : "";
}

function allBlocks(xml, tagName) {
  const n = escTag(tagName);
  const re = new RegExp(`<${n}\\b[^>]*>[\\s\\S]*?</${n}\\s*>`, "gi");
  return xml.match(re) || [];
}

function parseDate(str) {
  if (!str) return null;
  const t = Date.parse(str);
  return Number.isNaN(t) ? null : t;
}

function parseRss(xml) {
  const channel = (xml.match(/<channel\b[^>]*>[\s\S]*?<\/channel\s*>/i) || [
    xml,
  ])[0];
  const title = tagText(channel, "title");
  const description = tagText(channel, "description");
  const linkMatch = channel.match(/<link(?:\s[^>]*)?>([^<]*)<\/link\s*>/i);
  const link = linkMatch ? decodeEntities(linkMatch[1]) : "";

  const items = allBlocks(xml, "item").map((item) => {
    const itemTitle = tagText(item, "title");
    let itemLink = tagText(item, "link");
    if (!itemLink) itemLink = attrFromTag(item, "enclosure", "url");
    if (!itemLink) itemLink = tagText(item, "guid");

    const content =
      tagHtml(item, ["content:encoded", "encoded", "description", "content"]) ||
      "";

    const snippet = stripTags(
      tagText(item, "description") || content
    ).slice(0, 220);

    const publishedAt = parseDate(
      tagText(item, ["pubDate", "dc:date", "date", "published"])
    );
    const author = tagText(item, ["dc:creator", "author", "creator"]);

    return {
      title: itemTitle,
      link: itemLink,
      snippet,
      content: content || snippet,
      publishedAt,
      author,
    };
  });

  return { title, description, link, items: items.slice(0, 80) };
}

function parseAtom(xml) {
  const head = xml.split(/<entry\b/i)[0] || xml;
  const title = tagText(head, "title");
  const description = tagText(head, ["subtitle", "summary"]);
  let link =
    attrFromLink(head, "alternate") ||
    attrFromLink(head, null) ||
    tagText(head, "link");

  const items = allBlocks(xml, "entry").map((entry) => {
    const itemTitle = tagText(entry, "title");
    const itemLink =
      attrFromLink(entry, "alternate") ||
      attrFromLink(entry, null) ||
      tagText(entry, "id");

    const content =
      tagHtml(entry, ["content", "summary"]) || "";
    const snippet = stripTags(
      tagText(entry, "summary") || content
    ).slice(0, 220);
    const publishedAt = parseDate(
      tagText(entry, ["published", "updated", "issued", "modified"])
    );

    let author = "";
    const authorBlock = entry.match(
      /<author\b[^>]*>[\s\S]*?<\/author\s*>/i
    );
    if (authorBlock) author = tagText(authorBlock[0], "name");
    if (!author) author = tagText(entry, "name");

    return {
      title: itemTitle,
      link: itemLink,
      snippet,
      content: content || snippet,
      publishedAt,
      author,
    };
  });

  return { title, description, link, items: items.slice(0, 80) };
}

function attrFromLink(block, rel) {
  const re = /<link\b([^>]*)\/?>/gi;
  let m;
  while ((m = re.exec(block))) {
    const attrs = m[1];
    const relM = attrs.match(/rel\s*=\s*["']([^"']+)["']/i);
    const hrefM = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefM) continue;
    const r = (relM?.[1] || "").toLowerCase();
    if (rel == null) return decodeEntities(hrefM[1]);
    if (r === rel) return decodeEntities(hrefM[1]);
  }
  return "";
}
