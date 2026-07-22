/**
 * Flux · RSS Aggregate
 * Client app: localStorage feeds, CF Pages API proxy, liquid-glass UI
 */

const STORAGE_KEY = "flux.feeds.v1";
const STATE_KEY = "flux.state.v1";
const PREFS_KEY = "flux.prefs.v1";
const FONT_STEPS = [0.9, 0.95, 1, 1.08, 1.16, 1.28];
const DEFAULT_FONT_STEP = 2;

const PRESETS = [
  { name: "Hacker News", url: "https://hnrss.org/frontpage" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "阮一峰周刊", url: "https://www.ruanyifeng.com/blog/atom.xml" },
  { name: "Solidot", url: "https://www.solidot.org/index.rss" },
  { name: "GitHub Blog", url: "https://github.blog/feed/" },
];

const COLORS = [
  "#7dd3fc", "#a78bfa", "#6ee7b7", "#fbbf24",
  "#f472b6", "#34d399", "#60a5fa", "#fb7185",
  "#c084fc", "#2dd4bf",
];

/** @typedef {{ id: string, url: string, title: string, color: string, addedAt: number }} Feed */
/** @typedef {{ id: string, feedId: string, feedTitle: string, feedColor: string, title: string, link: string, snippet: string, content: string, publishedAt: number|null, author: string }} Article */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const reduceMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

/** Pause ambient orbs when tab hidden — unseen perf detail */
function bindAmbientPause() {
  const ambient = document.querySelector(".ambient");
  if (!ambient) return;
  const sync = () => {
    ambient.classList.toggle("is-paused", document.hidden || reduceMotion());
  };
  document.addEventListener("visibilitychange", sync);
  // Also react to reduced-motion changes
  const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  mq?.addEventListener?.("change", sync);
  sync();
}

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Animate segmented control pill under active button */
function updateSegPill(animate = true) {
  const seg = document.querySelector(".seg");
  if (!seg) return;
  let pill = seg.querySelector(".seg-pill");
  if (!pill) {
    pill = document.createElement("span");
    pill.className = "seg-pill";
    pill.setAttribute("aria-hidden", "true");
    seg.prepend(pill);
  }
  const active = seg.querySelector(".seg-btn.is-active") || seg.querySelector(".seg-btn");
  if (!active) return;
  const s = seg.getBoundingClientRect();
  const b = active.getBoundingClientRect();
  const x = b.left - s.left;
  const w = b.width;
  if (!animate || reduceMotion()) {
    pill.style.transitionDuration = "0ms";
  } else {
    pill.style.transitionDuration = "";
  }
  pill.style.width = `${w}px`;
  pill.style.transform = `translateX(${x}px)`;
}

/** Soft crossfade page title — skip if unchanged (high-freq nav) */
function setPageTitle(title, sub) {
  if (els.pageTitle.textContent === title && els.pageSub.textContent === sub) return;
  const wrap = document.querySelector(".page-title-wrap");
  if (!wrap || reduceMotion()) {
    els.pageTitle.textContent = title;
    els.pageSub.textContent = sub;
    return;
  }
  wrap.classList.add("is-swapping");
  window.setTimeout(() => {
    els.pageTitle.textContent = title;
    els.pageSub.textContent = sub;
    wrap.classList.remove("is-swapping");
  }, 90);
}

const els = {
  sidebar: $("#sidebar"),
  sidebarOpen: $("#sidebarOpen"),
  sidebarClose: $("#sidebarClose"),
  feedNav: $("#feedNav"),
  countAll: $("#countAll"),
  openAddFeed: $("#openAddFeed"),
  emptyAdd: $("#emptyAdd"),
  refreshAll: $("#refreshAll"),
  pageTitle: $("#pageTitle"),
  pageSub: $("#pageSub"),
  searchInput: $("#searchInput"),
  statusLine: $("#statusLine"),
  markAllRead: $("#markAllRead"),
  articleList: $("#articleList"),
  emptyState: $("#emptyState"),
  loadingState: $("#loadingState"),
  content: $(".content"),
  reader: $("#reader"),
  closeReader: $("#closeReader"),
  starBtn: $("#starBtn"),
  markUnreadBtn: $("#markUnreadBtn"),
  copyLinkBtn: $("#copyLinkBtn"),
  openOriginal: $("#openOriginal"),
  fontDec: $("#fontDec"),
  fontInc: $("#fontInc"),
  readerProgress: $("#readerProgress"),
  readerPos: $("#readerPos"),
  readerMeta: $("#readerMeta"),
  readerTitle: $("#readerTitle"),
  readerStats: $("#readerStats"),
  readerContent: $("#readerContent"),
  readerBody: $("#readerBody"),
  prevArticle: $("#prevArticle"),
  nextArticle: $("#nextArticle"),
  prevTitle: $("#prevTitle"),
  nextTitle: $("#nextTitle"),
  modalRoot: $("#modalRoot"),
  modalBackdrop: $("#modalBackdrop"),
  closeModal: $("#closeModal"),
  cancelModal: $("#cancelModal"),
  addFeedForm: $("#addFeedForm"),
  feedUrl: $("#feedUrl"),
  feedName: $("#feedName"),
  modalError: $("#modalError"),
  submitFeed: $("#submitFeed"),
  presets: $("#presets"),
  toastRoot: $("#toastRoot"),
};

/** App state */
const state = {
  /** @type {Feed[]} */
  feeds: [],
  /** @type {Article[]} */
  articles: [],
  /** @type {Set<string>} */
  readIds: new Set(),
  /** @type {Set<string>} */
  starredIds: new Set(),
  activeFeedId: "all",
  filter: "all", // all | unread | starred
  query: "",
  /** @type {string|null} */
  activeArticleId: null,
  loading: false,
  /** font step index into FONT_STEPS */
  fontStep: DEFAULT_FONT_STEP,
  _progressRaf: 0,
  /** Virtual list cache */
  _vlist: {
    items: /** @type {Article[]} */ ([]),
    start: 0,
    end: 0,
    row: 88,
    overscan: 10,
    bound: false,
    raf: 0,
  },
};

/* ---------- Storage ---------- */
function loadPersisted() {
  try {
    const feeds = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    state.feeds = Array.isArray(feeds) ? feeds : [];
  } catch {
    state.feeds = [];
  }
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
    state.readIds = new Set(s.readIds || []);
    state.starredIds = new Set(s.starredIds || []);
  } catch {
    /* ignore */
  }
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    const step = Number(prefs.fontStep);
    if (Number.isInteger(step) && step >= 0 && step < FONT_STEPS.length) {
      state.fontStep = step;
    }
  } catch {
    /* ignore */
  }
}

function saveFeeds() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.feeds));
}

function saveState() {
  localStorage.setItem(
    STATE_KEY,
    JSON.stringify({
      readIds: [...state.readIds].slice(-2000),
      starredIds: [...state.starredIds].slice(-500),
    })
  );
}

function savePrefs() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      fontStep: state.fontStep,
    })
  );
}

/* ---------- Utils ---------- */
function uid() {
  return crypto.randomUUID?.() || `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function colorFor(seed) {
  let h = 0;
  const str = String(seed || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(html) {
  const d = document.createElement("div");
  d.innerHTML = html || "";
  return (d.textContent || d.innerText || "").replace(/\s+/g, " ").trim();
}

/**
 * Peel common feed wrappers (Zhihu Daily, WeChat-ish shells, etc.)
 * Prefer the densest text-bearing content root.
 */
function extractContentRoot(root) {
  if (!root) return root;
  const candidates = [
    ".answer .content",
    ".content-inner .content",
    ".content-inner",
    ".RichText",
    ".Post-RichText",
    ".entry-content",
    ".article-content",
    ".post-content",
    ".post-body",
    ".article-body",
    ".story-body",
    ".main-content",
    ".content",
    "article",
  ];
  let best = null;
  let bestScore = 0;
  for (const sel of candidates) {
    for (const el of root.querySelectorAll(sel)) {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      // Prefer longer pure text; penalize chrome-heavy shells
      const score =
        text.length -
        el.querySelectorAll("img,script,style,nav,footer,figure").length * 40;
      if (score > bestScore && text.length >= 40) {
        best = el;
        bestScore = score;
      }
    }
  }
  return best || root;
}

/** Chrome-only CTA / footer link text (Zhihu, WeChat, generic) */
function isChromeLinkText(t) {
  const s = (t || "").replace(/\s+/g, " ").trim();
  if (!s) return true;
  return /查看知乎原文|查看知乎讨论|阅读原文|原文链接|查看原文|阅读全文|展开全文|View original|Read more|Continue reading/i.test(
    s
  );
}

/** Drop Zhihu/meta chrome and empty structural husks before sanitize */
function stripFeedChrome(root) {
  if (!root) return;
  const killSelectors = [
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "video",
    "audio",
    "picture",
    "source",
    "img",
    "figure",
    "figcaption",
    "button",
    "form",
    "input",
    "textarea",
    "select",
    "nav",
    "footer",
    "header",
    ".meta",
    ".avatar",
    ".author",
    ".bio",
    ".originUrl",
    ".view-more",
    ".img-place-holder",
    ".headline",
    ".question-title",
    ".js-question-holder",
    ".content-image",
    "[hidden]",
    "a.originUrl",
  ];
  for (const sel of killSelectors) {
    try {
      root.querySelectorAll(sel).forEach((n) => n.remove());
    } catch {
      /* ignore invalid selector edge cases */
    }
  }

  // Drop chrome-only links by visible text
  root.querySelectorAll("a").forEach((a) => {
    if (isChromeLinkText(a.textContent)) a.remove();
  });

  // Remove empty headings / empty shells
  root.querySelectorAll("h1,h2,h3,h4,h5,h6,div,span,section,figure,aside").forEach((el) => {
    if (!el.isConnected) return;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    const hasMedia = el.querySelector("img,video,audio,iframe,svg");
    if (!text && !hasMedia) el.remove();
  });
}

/**
 * Text-first reader body:
 * keep prose tags only — no images / layout wrappers / chrome.
 */
function sanitizeHtml(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html || "";

  // Work inside a disposable root so we can query
  const shell = document.createElement("div");
  shell.append(...tpl.content.childNodes);

  stripFeedChrome(shell);
  const contentRoot = extractContentRoot(shell);
  const source = contentRoot === shell ? shell : contentRoot.cloneNode(true);
  stripFeedChrome(source);

  // Text-only allowed set (no IMG/FIGURE/DIV layout shells)
  const allowed = new Set([
    "P",
    "BR",
    "A",
    "STRONG",
    "EM",
    "B",
    "I",
    "U",
    "S",
    "CODE",
    "PRE",
    "UL",
    "OL",
    "LI",
    "BLOCKQUOTE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HR",
    "TABLE",
    "THEAD",
    "TBODY",
    "TR",
    "TH",
    "TD",
    "SUP",
    "SUB",
  ]);
  // Unwrap these into children (layout husks)
  const unwrap = new Set([
    "DIV",
    "SPAN",
    "SECTION",
    "ARTICLE",
    "MAIN",
    "ASIDE",
    "HEADER",
    "FOOTER",
    "PICTURE",
    "CENTER",
    "FONT",
    "LABEL",
    "FIGURE",
    "FIGCAPTION",
  ]);
  // Drop entirely (media + chrome + non-prose)
  const drop = new Set([
    "IMG",
    "VIDEO",
    "AUDIO",
    "SOURCE",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "SCRIPT",
    "STYLE",
    "LINK",
    "META",
    "SVG",
    "CANVAS",
    "BUTTON",
    "FORM",
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "NOSCRIPT",
    "TEMPLATE",
  ]);

  // Iterative unwrap/drop until stable (avoids recursive re-walk hazards)
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 40) {
    changed = false;
    const els = [...source.querySelectorAll("*")];
    for (const el of els) {
      if (!el.isConnected) continue;
      const tag = el.tagName;
      if (drop.has(tag)) {
        el.remove();
        changed = true;
        continue;
      }
      if (unwrap.has(tag) || !allowed.has(tag)) {
        el.replaceWith(...el.childNodes);
        changed = true;
      }
    }
  }

  // Clean attributes + empty nodes on remaining allowed elements
  for (const el of [...source.querySelectorAll("*")]) {
    if (!el.isConnected) continue;
    const tag = el.tagName;
    // Strip all attributes except safe href on anchors
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      if (tag === "A" && n === "href") {
        if (/^\s*javascript:/i.test(attr.value) || /^\s*data:/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
        continue;
      }
      el.removeAttribute(attr.name);
    }
    if (tag === "A") {
      const href = el.getAttribute("href");
      if (!href) {
        // Keep link text, drop dead anchor shell
        el.replaceWith(...el.childNodes);
        continue;
      }
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (isChromeLinkText(t)) {
        el.remove();
        continue;
      }
    }
    if (/^H[1-6]$/.test(tag)) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t) el.remove();
    }
  }

  // Flatten nested emphasis: <strong><strong>x</strong></strong> → <strong>x</strong>
  let nestGuard = 0;
  let nestChanged = true;
  while (nestChanged && nestGuard++ < 20) {
    nestChanged = false;
    for (const tag of ["STRONG", "EM", "B", "I"]) {
      for (const el of [...source.querySelectorAll(tag)]) {
        if (!el.isConnected) continue;
        if (
          el.childNodes.length === 1 &&
          el.firstChild.nodeType === 1 &&
          el.firstChild.tagName === tag
        ) {
          el.replaceWith(el.firstChild);
          nestChanged = true;
        }
      }
    }
  }

  // Strip leftover comments
  const walker = document.createTreeWalker(source, NodeFilter.SHOW_COMMENT);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.remove());

  // Remove leftover empty elements (and chrome-only paragraphs)
  source.querySelectorAll("*").forEach((el) => {
    if (!el.isConnected) return;
    if (el.tagName === "BR" || el.tagName === "HR") return;
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!t || isChromeLinkText(t)) el.remove();
  });

  // Normalize: if only raw text nodes, wrap in <p>
  const htmlOut = source.innerHTML.trim();
  if (!htmlOut) return "";
  // If no block tags at all, wrap paragraphs by double newlines
  if (!/<(p|h[1-6]|ul|ol|li|blockquote|pre|table)\b/i.test(htmlOut)) {
    const plain = (source.textContent || "").replace(/\r/g, "").trim();
    if (!plain) return "";
    return plain
      .split(/\n{2,}/)
      .map((para) => para.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean)
      .map((para) => `<p>${escapeHtml(para)}</p>`)
      .join("");
  }
  return htmlOut;
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  const min = 60e3;
  const hour = 3600e3;
  const day = 86400e3;
  if (diff < min) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < day * 7) return `${Math.floor(diff / day)} 天前`;
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
}


function estimateReadMinutes(text) {
  const plain = stripHtml(text || "");
  if (!plain) return 1;
  const cjk = (plain.match(/[\u4e00-\u9fff]/g) || []).length;
  const other = Math.max(0, plain.length - cjk);
  const minutes = cjk / 320 + other / 900;
  return Math.max(1, Math.round(minutes));
}

function wordCountLabel(text) {
  const plain = stripHtml(text || "");
  if (!plain) return "0 字";
  const cjk = (plain.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = (plain.match(/[A-Za-z0-9]+/g) || []).length;
  if (cjk > words * 2) return `${plain.replace(/\s+/g, "").length} 字`;
  return words ? `${words} 词` : `${plain.length} 字`;
}

function applyFontScale() {
  const scale = FONT_STEPS[state.fontStep] ?? 1;
  const root = els.reader || document.querySelector(".reader");
  if (!root) return;
  root.style.setProperty("--reader-font", `${scale}rem`);
  root.style.setProperty("--reader-line", scale >= 1.16 ? "1.8" : "1.75");
  if (els.fontDec) els.fontDec.disabled = state.fontStep <= 0;
  if (els.fontInc) els.fontInc.disabled = state.fontStep >= FONT_STEPS.length - 1;
}

function changeFont(delta) {
  const next = Math.min(FONT_STEPS.length - 1, Math.max(0, state.fontStep + delta));
  if (next === state.fontStep) return;
  state.fontStep = next;
  savePrefs();
  applyFontScale();
}

function updateReaderProgress() {
  if (!els.readerBody || !els.readerProgress) return;
  const el = els.readerBody;
  const max = el.scrollHeight - el.clientHeight;
  const pct = max <= 0 ? 100 : Math.min(100, Math.max(0, (el.scrollTop / max) * 100));
  els.readerProgress.style.width = `${pct}%`;
}

function bindReaderScroll() {
  if (!els.readerBody || els.readerBody.dataset.progressBound === "1") return;
  els.readerBody.dataset.progressBound = "1";
  els.readerBody.addEventListener(
    "scroll",
    () => {
      if (state._progressRaf) return;
      state._progressRaf = requestAnimationFrame(() => {
        state._progressRaf = 0;
        updateReaderProgress();
      });
    },
    { passive: true }
  );
}

function neighborArticles(id = state.activeArticleId) {
  const list = filteredArticles();
  const idx = list.findIndex((a) => a.id === id);
  return {
    list,
    index: idx,
    prev: idx > 0 ? list[idx - 1] : null,
    next: idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null,
  };
}

function updateReaderChrome(article) {
  const { list, index, prev, next } = neighborArticles(article?.id);
  if (els.readerPos) {
    els.readerPos.textContent =
      index >= 0 ? `${index + 1} / ${Math.min(list.length, 200)}` : "—";
  }
  if (els.readerStats && article) {
    const mins = estimateReadMinutes(article.content || article.snippet);
    const count = wordCountLabel(article.content || article.snippet);
    const time = formatTime(article.publishedAt);
    els.readerStats.innerHTML = [
      `<span>${escapeHtml(String(mins))} 分钟阅读</span>`,
      `<span class="stat-sep">·</span>`,
      `<span>${escapeHtml(count)}</span>`,
      time ? `<span class="stat-sep">·</span><span>${escapeHtml(time)}</span>` : "",
    ].join("");
  }
  if (els.prevArticle) {
    els.prevArticle.disabled = !prev;
    if (els.prevTitle) els.prevTitle.textContent = prev ? prev.title : "没有更多了";
  }
  if (els.nextArticle) {
    els.nextArticle.disabled = !next;
    if (els.nextTitle) els.nextTitle.textContent = next ? next.title : "没有更多了";
  }
}

function goNeighbor(dir) {
  if (!state.activeArticleId) return;
  const { prev, next } = neighborArticles();
  const target = dir < 0 ? prev : next;
  if (!target) {
    toast(dir < 0 ? "已是第一篇" : "已是最后一篇");
    return;
  }
  openReader(target.id, { fromKeyboard: true });
}

function toggleStarActive() {
  if (!state.activeArticleId) return;
  if (state.starredIds.has(state.activeArticleId)) {
    state.starredIds.delete(state.activeArticleId);
    toast("已取消收藏");
  } else {
    state.starredIds.add(state.activeArticleId);
    toast("已收藏");
  }
  saveState();
  const starred = state.starredIds.has(state.activeArticleId);
  els.starBtn.classList.toggle("star-btn-on", starred);
  els.starBtn.setAttribute("aria-pressed", starred ? "true" : "false");
  if (!reduceMotion()) {
    els.starBtn.classList.remove("is-pop");
    void els.starBtn.offsetWidth;
    els.starBtn.classList.add("is-pop");
  }
  renderList({ animate: false, keepScroll: true });
  const article = state.articles.find((a) => a.id === state.activeArticleId);
  if (article) updateReaderChrome(article);
}

function markActiveUnread() {
  if (!state.activeArticleId) return;
  state.readIds.delete(state.activeArticleId);
  saveState();
  renderNav();
  renderList({ animate: false, keepScroll: true });
  toast("已标为未读");
}

async function copyActiveLink() {
  const article = state.articles.find((a) => a.id === state.activeArticleId);
  if (!article?.link) {
    toast("没有可复制的链接");
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(article.link);
    } else {
      const ta = document.createElement("textarea");
      ta.value = article.link;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast("链接已复制");
  } catch {
    toast("复制失败");
  }
}

function articleKey(feedId, link, title, publishedAt) {
  const base = `${feedId}|${link || ""}|${title || ""}|${publishedAt || ""}`;
  // short stable-ish hash
  let h = 2166136261;
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `a_${(h >>> 0).toString(36)}`;
}

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  els.toastRoot.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-in"));
  // Enter ~280ms feel; exit faster (Emil: exit quicker than enter)
  const hold = reduceMotion() ? 1600 : 2200;
  const outMs = reduceMotion() ? 0 : 140;
  setTimeout(() => {
    el.classList.add("is-out");
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), outMs + 40);
  }, hold);
}

/* ---------- API ---------- */
async function fetchFeed(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `请求失败 (${res.status})`);
    }
    return data;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("请求超时，请稍后重试");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Feed ops ---------- */
async function addFeed(url, name = "") {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("请输入订阅地址");
  if (state.feeds.some((f) => f.url === trimmed)) {
    throw new Error("该订阅源已存在");
  }

  const data = await fetchFeed(trimmed);
  const feed = {
    id: uid(),
    url: trimmed,
    title: (name || data.title || new URL(trimmed).hostname).trim(),
    color: colorFor(trimmed),
    addedAt: Date.now(),
  };
  state.feeds.unshift(feed);
  saveFeeds();
  mergeArticles(feed, data.items || []);
  renderNav();
  renderList({ animate: true });
  return feed;
}

function removeFeed(id) {
  state.feeds = state.feeds.filter((f) => f.id !== id);
  state.articles = state.articles.filter((a) => a.feedId !== id);
  if (state.activeFeedId === id) state.activeFeedId = "all";
  if (state.activeArticleId) {
    const still = state.articles.find((a) => a.id === state.activeArticleId);
    if (!still) closeReader();
  }
  saveFeeds();
  renderNav();
  renderList({ animate: true });
  toast("已移除订阅源");
}

function mergeArticles(feed, items) {
  const existing = new Map(state.articles.map((a) => [a.id, a]));
  for (const item of items) {
    const id = articleKey(feed.id, item.link, item.title, item.publishedAt);
    if (existing.has(id)) continue;
    /** @type {Article} */
    const article = {
      id,
      feedId: feed.id,
      feedTitle: feed.title,
      feedColor: feed.color,
      title: item.title || "(无标题)",
      link: item.link || "",
      snippet: item.snippet || stripHtml(item.content || "").slice(0, 180),
      content: item.content || item.snippet || "",
      publishedAt: item.publishedAt || null,
      author: item.author || "",
    };
    existing.set(id, article);
  }
  state.articles = [...existing.values()].sort(
    (a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)
  );
}

async function refreshAll() {
  if (!state.feeds.length) {
    toast("还没有订阅源");
    return;
  }
  if (state.loading) return; // prevent double-trigger spinner lock
  state.loading = true;
  renderLoading();
  setStatus("正在刷新全部订阅…");
  let ok = 0;
  let fail = 0;
  try {
    // Limit concurrency so one stuck host cannot stall the whole UI forever
    const queue = [...state.feeds];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const feed = queue.shift();
        if (!feed) break;
        try {
          const data = await fetchFeed(feed.url, { timeoutMs: 15000 });
          if (data.title && data.title !== feed.title && !feed.title) {
            feed.title = data.title;
          }
          // Keep user-chosen title; only fill empty
          if (data.title && feed.title.startsWith("http")) {
            feed.title = data.title;
            saveFeeds();
          }
          mergeArticles(feed, data.items || []);
          ok++;
          setStatus(`正在刷新… ${ok + fail}/${state.feeds.length}`);
        } catch (err) {
          console.warn("refresh fail", feed.url, err);
          fail++;
          setStatus(`正在刷新… ${ok + fail}/${state.feeds.length}`);
        }
      }
    });
    await Promise.all(workers);
    saveFeeds();
    renderNav();
    renderList({ animate: true });
    setStatus(
      fail
        ? `刷新完成：${ok} 成功，${fail} 失败`
        : `已更新 ${ok} 个订阅 · ${state.articles.length} 篇文章`
    );
    toast(fail ? `部分订阅刷新失败 (${fail})` : "全部订阅已刷新");
  } catch (err) {
    console.error("refreshAll fatal", err);
    setStatus("刷新失败，请重试");
    toast(err?.message || "刷新失败");
  } finally {
    state.loading = false;
    renderLoading();
  }
}

/* ---------- Filtering ---------- */
function filteredArticles() {
  let list = state.articles;
  if (state.activeFeedId !== "all") {
    list = list.filter((a) => a.feedId === state.activeFeedId);
  }
  if (state.filter === "unread") {
    list = list.filter((a) => !state.readIds.has(a.id));
  } else if (state.filter === "starred") {
    list = list.filter((a) => state.starredIds.has(a.id));
  }
  const q = state.query.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.feedTitle.toLowerCase().includes(q) ||
        a.snippet.toLowerCase().includes(q)
    );
  }
  return list;
}

/* ---------- Render ---------- */
function setStatus(text) {
  if (!els.statusLine) return;
  if (els.statusLine.textContent === text) return;
  // Progress strings during refresh are high-frequency — snap, no flash
  if (state.loading || reduceMotion()) {
    els.statusLine.textContent = text;
    els.statusLine.classList.remove("is-flash");
    return;
  }
  els.statusLine.classList.add("is-flash");
  window.setTimeout(() => {
    els.statusLine.textContent = text;
    els.statusLine.classList.remove("is-flash");
  }, 70);
}

function renderNav() {
  const allBtn = els.feedNav.querySelector('[data-id="all"]');
  // remove old feed items
  $$(".feed-item[data-id]:not([data-id='all'])", els.feedNav).forEach((n) => n.remove());

  const unreadAll = state.articles.filter((a) => !state.readIds.has(a.id)).length;
  els.countAll.textContent = String(unreadAll || state.articles.length);

  for (const feed of state.feeds) {
    const count = state.articles.filter(
      (a) => a.feedId === feed.id && !state.readIds.has(a.id)
    ).length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `feed-item${state.activeFeedId === feed.id ? " is-active" : ""}`;
    btn.dataset.id = feed.id;
    btn.innerHTML = `
      <span class="feed-dot" style="background:${feed.color};box-shadow:0 0 12px ${feed.color}80"></span>
      <span class="feed-meta">
        <span class="feed-title">${escapeHtml(feed.title)}</span>
        <span class="feed-count">${count || ""}</span>
      </span>
      <span class="feed-remove" data-remove="${feed.id}" title="移除" role="button" tabindex="0" aria-label="移除订阅">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </span>
    `;
    els.feedNav.appendChild(btn);
  }

  if (allBtn) {
    allBtn.classList.toggle("is-active", state.activeFeedId === "all");
  }

  const active =
    state.activeFeedId === "all"
      ? null
      : state.feeds.find((f) => f.id === state.activeFeedId);
  const title = active ? active.title : "全部文章";
  const sub = active
    ? active.url
    : state.feeds.length
      ? `${state.feeds.length} 个订阅源 · ${state.articles.length} 篇文章`
      : "聚合你的信息流";
  setPageTitle(title, sub);
}


/* ---------- Virtual list (Emil: high-freq scroll = no animation) ---------- */
function measureRowHeight() {
  const windowEl = els.articleList?.querySelector(".vlist-window");
  const cards = windowEl ? [...windowEl.querySelectorAll(".article-card")] : [];
  if (cards.length >= 2) {
    const first = cards[0].getBoundingClientRect();
    const last = cards[cards.length - 1].getBoundingClientRect();
    const avg = (last.bottom - first.top) / cards.length;
    if (avg > 48 && avg < 180) return Math.round(avg);
  }
  if (cards.length === 1) {
    const h = cards[0].getBoundingClientRect().height + 2;
    if (h > 48 && h < 180) return Math.round(h);
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--vrow").trim();
  const fromCss = parseFloat(raw);
  if (fromCss > 40) return fromCss;
  return 88;
}

function ensureVirtualListBound() {
  if (!els.articleList || state._vlist.bound) return;
  state._vlist.bound = true;
  const onScroll = () => {
    if (state._vlist.raf) return;
    state._vlist.raf = requestAnimationFrame(() => {
      state._vlist.raf = 0;
      paintVirtualWindow({ animate: false });
    });
  };
  els.articleList.addEventListener("scroll", onScroll, { passive: true });
  // Resize: re-measure row + repaint window (high-freq → no animation)
  if (typeof ResizeObserver !== "undefined") {
    let roRaf = 0;
    const ro = new ResizeObserver(() => {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        const next = measureRowHeight();
        if (Math.abs(next - (state._vlist.row || 0)) >= 2) {
          state._vlist.row = next;
          document.documentElement.style.setProperty("--vrow", `${next}px`);
          delete els.articleList.dataset.vRow;
          delete els.articleList.dataset.vCalibrated;
        }
        paintVirtualWindow({ animate: false });
      });
    });
    ro.observe(els.articleList);
  }
}

function createArticleCard(a) {
  const isRead = state.readIds.has(a.id);
  const isStar = state.starredIds.has(a.id);
  const card = document.createElement("button");
  card.type = "button";
  card.className = `article-card${state.activeArticleId === a.id ? " is-active" : ""}${isRead ? " is-read" : ""}`;
  card.dataset.id = a.id;
  card.setAttribute("role", "listitem");
  card.innerHTML = `
      <div class="article-main">
        <div class="article-source">
          <span class="source-dot" style="background:${a.feedColor}"></span>
          <span>${escapeHtml(a.feedTitle)}</span>
          ${isStar ? '<span class="star-mark" title="已收藏">★</span>' : ""}
        </div>
        <h3 class="article-title">${escapeHtml(a.title)}</h3>
        ${a.snippet ? `<p class="article-snippet">${escapeHtml(a.snippet)}</p>` : ""}
      </div>
      <div class="article-side">
        <span class="article-time">${escapeHtml(formatTime(a.publishedAt))}</span>
        ${!isRead ? '<span class="unread-pip" aria-label="未读"></span>' : ""}
      </div>
    `;
  return card;
}

function paintVirtualWindow({ animate = false } = {}) {
  const list = state._vlist.items;
  const scroller = els.articleList;
  if (!scroller || !list) return;

  if (!list.length) {
    scroller.innerHTML = `<div class="vlist-empty">没有匹配的文章</div>`;
    state._vlist.start = 0;
    state._vlist.end = 0;
    return;
  }

  const row = state._vlist.row || measureRowHeight();
  state._vlist.row = row;
  const overscan = state._vlist.overscan;
  const scrollTop = scroller.scrollTop;
  const viewH = scroller.clientHeight || 600;
  const total = list.length;

  let start = Math.floor(scrollTop / row) - overscan;
  if (start < 0) start = 0;
  let end = Math.ceil((scrollTop + viewH) / row) + overscan;
  if (end > total) end = total;
  if (end < start) end = start;

  // Skip DOM work if window unchanged and not forced rebuild
  const sameWindow =
    scroller.dataset.vStart === String(start) &&
    scroller.dataset.vEnd === String(end) &&
    scroller.dataset.vLen === String(total) &&
    scroller.dataset.vRow === String(row) &&
    !animate &&
    scroller.querySelector(".vlist-window");

  // Still need active/read class updates when state changes — detect via signature
  const sig = `${state.activeArticleId || ""}|${state.readIds.size}|${state.starredIds.size}|${state.filter}|${state.query}|${state.activeFeedId}`;
  const sameSig = scroller.dataset.vSig === sig;
  if (sameWindow && sameSig) return;

  state._vlist.start = start;
  state._vlist.end = end;
  scroller.dataset.vStart = String(start);
  scroller.dataset.vEnd = String(end);
  scroller.dataset.vLen = String(total);
  scroller.dataset.vRow = String(row);
  scroller.dataset.vSig = sig;

  const topH = start * row;
  const bottomH = Math.max(0, (total - end) * row);

  const shouldAnimate = animate && !reduceMotion() && start === 0;
  scroller.classList.toggle("is-animating", shouldAnimate);
  if (shouldAnimate) {
    window.clearTimeout(renderList._t);
    renderList._t = window.setTimeout(() => {
      scroller.classList.remove("is-animating");
    }, 360);
  }

  const frag = document.createDocumentFragment();

  const top = document.createElement("div");
  top.className = "vlist-spacer-top";
  top.style.height = `${topH}px`;
  top.setAttribute("aria-hidden", "true");
  frag.appendChild(top);

  const windowEl = document.createElement("div");
  windowEl.className = "vlist-window";
  windowEl.setAttribute("role", "presentation");
  for (let i = start; i < end; i++) {
    windowEl.appendChild(createArticleCard(list[i]));
  }
  frag.appendChild(windowEl);

  const bottom = document.createElement("div");
  bottom.className = "vlist-spacer-bottom";
  bottom.style.height = `${bottomH}px`;
  bottom.setAttribute("aria-hidden", "true");
  frag.appendChild(bottom);

  scroller.replaceChildren(frag);

  if (!scroller.dataset.vCalibrated) {
    requestAnimationFrame(() => {
      const measured = measureRowHeight();
      if (Math.abs(measured - row) >= 4) {
        state._vlist.row = measured;
        document.documentElement.style.setProperty("--vrow", `${measured}px`);
        scroller.dataset.vCalibrated = "1";
        delete scroller.dataset.vRow;
        paintVirtualWindow({ animate: false });
      } else {
        scroller.dataset.vCalibrated = "1";
      }
    });
  }
}

function scrollVirtualToId(id, { align = "nearest" } = {}) {
  const list = state._vlist.items;
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0 || !els.articleList) return;
  const row = state._vlist.row || measureRowHeight();
  const scroller = els.articleList;
  const top = idx * row;
  const bottom = top + row;
  const viewTop = scroller.scrollTop;
  const viewBottom = viewTop + scroller.clientHeight;

  let next = scroller.scrollTop;
  if (align === "start" || top < viewTop) {
    next = Math.max(0, top - 8);
  } else if (bottom > viewBottom) {
    next = Math.max(0, bottom - scroller.clientHeight + 8);
  } else {
    // already visible — still paint so active class updates
    paintVirtualWindow({ animate: false });
    return;
  }
  // High-frequency list nav: no smooth scroll (Emil)
  scroller.scrollTop = next;
  paintVirtualWindow({ animate: false });
}

function renderList({ animate = true, keepScroll = false } = {}) {
  const list = filteredArticles();
  ensureVirtualListBound();
  state._vlist.items = list;
  state._vlist.row = measureRowHeight();

  const noFeeds = state.feeds.length === 0;
  els.emptyState.hidden = !noFeeds;
  if (!noFeeds) {
    els.emptyState.classList.remove("is-shown");
  } else {
    requestAnimationFrame(() => els.emptyState.classList.add("is-shown"));
  }
  if (noFeeds) {
    els.articleList.hidden = true;
    els.articleList.replaceChildren();
    delete els.articleList.dataset.vStart;
    delete els.articleList.dataset.vEnd;
    delete els.articleList.dataset.vLen;
    delete els.articleList.dataset.vRow;
    delete els.articleList.dataset.vSig;
    delete els.articleList.dataset.vCalibrated;
    state._vlist.items = [];
    return;
  }
  els.articleList.hidden = false;

  // Filter/search/nav: reset to top unless keepScroll (e.g. star toggle)
  if (!keepScroll && animate !== false) {
    // only jump to top when data set identity likely changed
  }
  // Heuristic: if previous length differed a lot or filter changed via animate:true, reset
  if (animate && !keepScroll) {
    els.articleList.scrollTop = 0;
  }

  delete els.articleList.dataset.vSig;
  if (els.articleList.dataset.vLen && els.articleList.dataset.vLen !== String(list.length)) {
    delete els.articleList.dataset.vCalibrated;
  }
  paintVirtualWindow({ animate: Boolean(animate) && !keepScroll });

  // Keep reader chrome (pos / neighbors) in sync with current filter
  if (state.activeArticleId) {
    const art = state.articles.find((a) => a.id === state.activeArticleId);
    if (art) updateReaderChrome(art);
  }
}

function renderLoading() {
  if (els.loadingState) {
    els.loadingState.hidden = !state.loading;
    // Belt-and-suspenders: class + attribute (CSS must not keep display:flex forever)
    els.loadingState.classList.toggle("is-visible", state.loading);
    if (state.loading) {
      els.loadingState.removeAttribute("hidden");
    } else {
      els.loadingState.setAttribute("hidden", "");
    }
  }
  if (els.refreshAll) {
    els.refreshAll.disabled = state.loading;
    els.refreshAll.classList.toggle("is-loading", state.loading);
  }
}

function openReader(id, opts = {}) {
  const article = state.articles.find((a) => a.id === id);
  if (!article) return;

  const wasOpen = Boolean(state.activeArticleId);
  // High-frequency hops (j/k, list while open): no content fade delay
  const instant = Boolean(opts.instant || opts.fromKeyboard || wasOpen);
  state.activeArticleId = id;
  state.readIds.add(id);
  saveState();

  els.content.classList.remove("is-reader-closing");
  els.content.classList.add("has-reader");
  els.content.classList.toggle("is-reader-instant", instant);
  els.reader.setAttribute("aria-hidden", "false");
  applyFontScale();
  bindReaderScroll();

  els.readerTitle.textContent = article.title;
  els.readerMeta.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:6px">
      <span class="source-dot" style="background:${article.feedColor}"></span>
      ${escapeHtml(article.feedTitle)}
    </span>
    ${article.author ? `<span>· ${escapeHtml(article.author)}</span>` : ""}
  `;

  const body = article.content || article.snippet || "";
  const safe = sanitizeHtml(body);
  if (safe && stripHtml(safe).length > 0) {
    els.readerContent.innerHTML = safe;
  } else {
    const link = article.link
      ? `<a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">打开原文阅读</a>`
      : "暂无正文";
    els.readerContent.innerHTML = `<div class="reader-empty-hint">这篇订阅未提供完整正文。${link}</div>`;
  }

  els.openOriginal.href = article.link || "#";
  els.openOriginal.style.visibility = article.link ? "visible" : "hidden";
  if (els.copyLinkBtn) els.copyLinkBtn.disabled = !article.link;

  const starred = state.starredIds.has(id);
  els.starBtn.classList.toggle("star-btn-on", starred);
  els.starBtn.setAttribute("aria-pressed", starred ? "true" : "false");

  updateReaderChrome(article);

  // Reset scroll instantly — high-frequency list navigation (Emil: no smooth)
  if (els.readerBody) {
    els.readerBody.scrollTop = 0;
  }
  updateReaderProgress();

  renderNav();
  renderList({ animate: false });

  // Bring active card into view without smooth scrolling (frequent / virtual)
  scrollVirtualToId(id, { align: "nearest" });
}

async function closeReader() {
  state.activeArticleId = null;
  els.reader.setAttribute("aria-hidden", "true");
  if (els.readerProgress) els.readerProgress.style.width = "0%";
  if (els.readerPos) els.readerPos.textContent = "—";
  if (reduceMotion()) {
    els.content.classList.remove("has-reader", "is-reader-closing", "is-reader-instant");
    renderList({ animate: false });
    return;
  }
  els.content.classList.add("is-reader-closing");
  await wait(150); // match exit duration
  els.content.classList.remove("has-reader", "is-reader-closing", "is-reader-instant");
  renderList({ animate: false });
}

/* ---------- Modal ---------- */
function openModal(prefill = "") {
  els.modalError.hidden = true;
  els.modalError.textContent = "";
  els.feedUrl.value = prefill;
  els.feedName.value = "";
  setSubmitLoading(false);
  els.modalRoot.hidden = false;
  els.modalRoot.classList.remove("is-closing");
  // double rAF so transition from opacity 0 runs
  requestAnimationFrame(() => {
    els.modalRoot.classList.add("is-open");
    els.feedUrl.focus();
  });
}

async function closeModal() {
  if (reduceMotion()) {
    els.modalRoot.classList.remove("is-open", "is-closing");
    els.modalRoot.hidden = true;
    return;
  }
  els.modalRoot.classList.add("is-closing");
  els.modalRoot.classList.remove("is-open");
  await wait(160);
  els.modalRoot.classList.remove("is-closing");
  els.modalRoot.hidden = true;
}

function setSubmitLoading(on) {
  els.submitFeed.disabled = on;
  const label = els.submitFeed.querySelector(".btn-label");
  const spin = els.submitFeed.querySelector(".btn-spinner");
  if (label) label.hidden = on;
  if (spin) spin.hidden = !on;
}

function renderPresets() {
  els.presets.innerHTML = "";
  for (const p of PRESETS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "preset-chip";
    chip.textContent = p.name;
    chip.addEventListener("click", () => {
      els.feedUrl.value = p.url;
      els.feedName.value = p.name;
      els.feedUrl.focus();
    });
    els.presets.appendChild(chip);
  }
}

/* ---------- Events ---------- */
function bindEvents() {
  els.openAddFeed.addEventListener("click", () => openModal());
  els.emptyAdd.addEventListener("click", () => openModal());
  els.closeModal.addEventListener("click", closeModal);
  els.cancelModal.addEventListener("click", closeModal);
  els.modalBackdrop.addEventListener("click", closeModal);

  els.addFeedForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.modalError.hidden = true;
    setSubmitLoading(true);
    try {
      const feed = await addFeed(els.feedUrl.value, els.feedName.value);
      closeModal();
      toast(`已添加「${feed.title}」`);
      setStatus(`已添加订阅 · 共 ${state.articles.length} 篇`);
    } catch (err) {
      els.modalError.hidden = false;
      els.modalError.textContent = err.message || "添加失败";
    } finally {
      setSubmitLoading(false);
    }
  });

  els.refreshAll.addEventListener("click", () => refreshAll());

  els.feedNav.addEventListener("click", (e) => {
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      e.stopPropagation();
      const id = remove.getAttribute("data-remove");
      const feed = state.feeds.find((f) => f.id === id);
      if (feed && confirm(`移除订阅「${feed.title}」？`)) {
        removeFeed(id);
      }
      return;
    }
    const item = e.target.closest(".feed-item[data-id]");
    if (!item) return;
    state.activeFeedId = item.dataset.id;
    closeReader();
    renderNav();
    // Feed switching is frequent — no stagger; jump list to top
    els.articleList.scrollTop = 0;
    renderList({ animate: false, keepScroll: true });
    closeMobileSidebar();
  });

  els.articleList.addEventListener("click", (e) => {
    const card = e.target.closest(".article-card[data-id]");
    if (!card) return;
    openReader(card.dataset.id, {
      instant: Boolean(state.activeArticleId),
    });
  });

  els.closeReader.addEventListener("click", closeReader);

  els.starBtn.addEventListener("click", () => toggleStarActive());
  els.markUnreadBtn?.addEventListener("click", () => markActiveUnread());
  els.copyLinkBtn?.addEventListener("click", () => copyActiveLink());
  els.fontDec?.addEventListener("click", () => changeFont(-1));
  els.fontInc?.addEventListener("click", () => changeFont(1));
  els.prevArticle?.addEventListener("click", () => goNeighbor(-1));
  els.nextArticle?.addEventListener("click", () => goNeighbor(1));

  els.markAllRead.addEventListener("click", () => {
    const list = filteredArticles();
    for (const a of list) state.readIds.add(a.id);
    saveState();
    renderNav();
    renderList({ animate: false, keepScroll: true });
    toast("已全部标为已读");
  });

  $$(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".seg-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.filter = btn.dataset.filter;
      updateSegPill(true);
      // Filter is frequent — pill moves; list snaps top, no stagger
      els.articleList.scrollTop = 0;
      renderList({ animate: false, keepScroll: true });
    });
  });

  let searchTimer = 0;
  els.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.searchInput.value;
      // Search is high-frequency — no list stagger; keep relative top
      els.articleList.scrollTop = 0;
      renderList({ animate: false, keepScroll: true });
    }, 120);
  });

  window.addEventListener("resize", () => updateSegPill(false));

  // Keyboard: high-frequency actions stay instant (Emil)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!els.modalRoot.hidden) {
        closeModal();
        return;
      }
      if (state.activeArticleId) {
        closeReader();
        return;
      }
      closeMobileSidebar();
      return;
    }

    const tag = document.activeElement?.tagName;
    const typing =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      document.activeElement?.isContentEditable;
    if (typing) return;

    if (e.key === "/") {
      e.preventDefault();
      els.searchInput.focus();
      els.searchInput.select();
      return;
    }

    // Reader-only shortcuts — no animation delay
    if (state.activeArticleId) {
      if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") {
        e.preventDefault();
        goNeighbor(1);
        return;
      }
      if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") {
        e.preventDefault();
        goNeighbor(-1);
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        toggleStarActive();
        return;
      }
      if (e.key === "u" || e.key === "U") {
        e.preventDefault();
        markActiveUnread();
        return;
      }
      if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        if (els.openOriginal?.href && els.openOriginal.href !== "#") {
          window.open(els.openOriginal.href, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        changeFont(-1);
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        changeFont(1);
        return;
      }
      if (e.key === " " || e.key === "Spacebar") {
        // Space scrolls reader body; prevent page jump
        if (els.readerBody) {
          e.preventDefault();
          const page = Math.max(240, els.readerBody.clientHeight * 0.9);
          els.readerBody.scrollTop += e.shiftKey ? -page : page;
          updateReaderProgress();
        }
        return;
      }
    } else if (e.key === "Enter" || e.key === "j" || e.key === "J") {
      // List: open top visible article (vim-style j when nothing open)
      const first = filteredArticles()[0];
      if (first) {
        e.preventDefault();
        openReader(first.id, { fromKeyboard: true });
      }
    }
  });

  // Mobile sidebar
  els.sidebarOpen.addEventListener("click", () => {
    els.sidebar.classList.add("is-open");
    document.body.classList.add("sidebar-open");
  });
  els.sidebarClose.addEventListener("click", closeMobileSidebar);
  document.addEventListener("click", (e) => {
    if (!document.body.classList.contains("sidebar-open")) return;
    if (els.sidebar.contains(e.target) || els.sidebarOpen.contains(e.target)) return;
    closeMobileSidebar();
  });
}

function closeMobileSidebar() {
  els.sidebar.classList.remove("is-open");
  document.body.classList.remove("sidebar-open");
}

/* ---------- Boot ---------- */
async function boot() {
  const app = document.querySelector(".app");
  if (app && !reduceMotion()) app.classList.add("is-booting");

  loadPersisted();
  renderPresets();
  bindEvents();
  applyFontScale();
  bindReaderScroll();
  ensureVirtualListBound();
  bindAmbientPause();
  renderNav();
  renderList({ animate: true });
  renderLoading();
  updateSegPill(false);

  // First paint shell enter — rare, allowed delight
  if (app && !reduceMotion()) {
    await nextFrame();
    app.classList.remove("is-booting");
    app.classList.add("is-ready");
  } else if (app) {
    app.classList.add("is-ready");
  }

  if (state.feeds.length) {
    // Silent refresh on load
    refreshAll().catch(() => {});
  } else {
    setStatus("添加订阅源开始阅读");
  }
}

boot();
