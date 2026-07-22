/**
 * Flux · RSS Aggregate
 * Client app: localStorage feeds, CF Pages API proxy, liquid-glass UI
 */

const STORAGE_KEY = "flux.feeds.v1";
const STATE_KEY = "flux.state.v1";

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

/** Soft crossfade page title */
function setPageTitle(title, sub) {
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
  }, 120);
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
  openOriginal: $("#openOriginal"),
  readerMeta: $("#readerMeta"),
  readerTitle: $("#readerTitle"),
  readerContent: $("#readerContent"),
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

/** Allow only safe-ish subset for reader content */
function sanitizeHtml(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html || "";
  const allowed = new Set([
    "P", "BR", "A", "STRONG", "EM", "B", "I", "U", "S", "CODE", "PRE",
    "UL", "OL", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6",
    "IMG", "FIGURE", "FIGCAPTION", "HR", "SPAN", "DIV", "TABLE", "THEAD",
    "TBODY", "TR", "TH", "TD", "SUP", "SUB",
  ]);
  const walk = (node) => {
    const children = [...node.childNodes];
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!allowed.has(child.tagName)) {
          child.replaceWith(...child.childNodes);
          continue;
        }
        // Strip event handlers / style / scripts
        for (const attr of [...child.attributes]) {
          const n = attr.name.toLowerCase();
          if (n.startsWith("on") || n === "style" || n === "srcset") {
            child.removeAttribute(attr.name);
            continue;
          }
          if ((n === "href" || n === "src") && /^\s*javascript:/i.test(attr.value)) {
            child.removeAttribute(attr.name);
          }
        }
        if (child.tagName === "A") {
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noopener noreferrer");
        }
        if (child.tagName === "IMG") {
          child.setAttribute("loading", "lazy");
          child.removeAttribute("width");
          child.removeAttribute("height");
        }
        walk(child);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
      }
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
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
  const hold = reduceMotion() ? 1800 : 2400;
  const outMs = reduceMotion() ? 0 : 160;
  setTimeout(() => {
    el.classList.add("is-out");
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), outMs + 40);
  }, hold);
}

/* ---------- API ---------- */
async function fetchFeed(url) {
  const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
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
  state.loading = true;
  renderLoading();
  setStatus("正在刷新全部订阅…");
  let ok = 0;
  let fail = 0;
  await Promise.all(
    state.feeds.map(async (feed) => {
      try {
        const data = await fetchFeed(feed.url);
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
      } catch (err) {
        console.warn("refresh fail", feed.url, err);
        fail++;
      }
    })
  );
  state.loading = false;
  renderLoading();
  renderNav();
  renderList({ animate: true });
  setStatus(
    fail
      ? `刷新完成：${ok} 成功，${fail} 失败`
      : `已更新 ${ok} 个订阅 · ${state.articles.length} 篇文章`
  );
  toast(fail ? `部分订阅刷新失败 (${fail})` : "全部订阅已刷新");
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
  if (reduceMotion()) {
    els.statusLine.textContent = text;
    return;
  }
  els.statusLine.classList.add("is-flash");
  window.setTimeout(() => {
    els.statusLine.textContent = text;
    els.statusLine.classList.remove("is-flash");
  }, 90);
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

function renderList({ animate = true } = {}) {
  const list = filteredArticles();
  els.articleList.innerHTML = "";

  const noFeeds = state.feeds.length === 0;
  els.emptyState.hidden = !noFeeds;
  if (!noFeeds) {
    els.emptyState.classList.remove("is-shown");
  } else {
    requestAnimationFrame(() => els.emptyState.classList.add("is-shown"));
  }
  if (noFeeds) {
    els.articleList.hidden = true;
    return;
  }
  els.articleList.hidden = false;

  if (!list.length) {
    els.articleList.innerHTML = `
      <div style="padding:40px 16px;text-align:center;color:var(--text-3);font-size:0.9rem">
        没有匹配的文章
      </div>`;
    return;
  }

  const shouldAnimate = animate && !reduceMotion();
  els.articleList.classList.toggle("is-animating", shouldAnimate);
  if (shouldAnimate) {
    // clear animating after stagger finishes so re-renders don't re-stagger always
    window.clearTimeout(renderList._t);
    renderList._t = window.setTimeout(() => {
      els.articleList.classList.remove("is-animating");
    }, 360);
  }

  const frag = document.createDocumentFragment();
  for (const a of list.slice(0, 200)) {
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
    frag.appendChild(card);
  }
  els.articleList.appendChild(frag);
}

function renderLoading() {
  els.loadingState.hidden = !state.loading;
  els.refreshAll.disabled = state.loading;
  els.refreshAll.classList.toggle("is-loading", state.loading);
}

function openReader(id) {
  const article = state.articles.find((a) => a.id === id);
  if (!article) return;

  state.activeArticleId = id;
  state.readIds.add(id);
  saveState();

  els.content.classList.remove("is-reader-closing");
  els.content.classList.add("has-reader");
  els.reader.setAttribute("aria-hidden", "false");
  els.readerTitle.textContent = article.title;
  els.readerMeta.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:6px">
      <span class="source-dot" style="background:${article.feedColor}"></span>
      ${escapeHtml(article.feedTitle)}
    </span>
    ${article.author ? `<span>· ${escapeHtml(article.author)}</span>` : ""}
    ${article.publishedAt ? `<span>· ${escapeHtml(formatTime(article.publishedAt))}</span>` : ""}
  `;
  const body = article.content || article.snippet || "";
  els.readerContent.innerHTML = sanitizeHtml(body) || "<p>暂无正文，请打开原文阅读。</p>";
  els.openOriginal.href = article.link || "#";
  els.openOriginal.style.visibility = article.link ? "visible" : "hidden";

  const starred = state.starredIds.has(id);
  els.starBtn.classList.toggle("star-btn-on", starred);
  els.starBtn.setAttribute("aria-pressed", starred ? "true" : "false");

  renderNav();
  renderList({ animate: false });
}

async function closeReader() {
  state.activeArticleId = null;
  els.reader.setAttribute("aria-hidden", "true");
  if (reduceMotion()) {
    els.content.classList.remove("has-reader", "is-reader-closing");
    renderList({ animate: false });
    return;
  }
  els.content.classList.add("is-reader-closing");
  await wait(160);
  els.content.classList.remove("has-reader", "is-reader-closing");
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
    // Feed switching is frequent navigation — no list stagger
    renderList({ animate: false });
    closeMobileSidebar();
  });

  els.articleList.addEventListener("click", (e) => {
    const card = e.target.closest(".article-card[data-id]");
    if (!card) return;
    openReader(card.dataset.id);
  });

  els.closeReader.addEventListener("click", closeReader);

  els.starBtn.addEventListener("click", () => {
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
    // Feedback pop — occasional action
    if (!reduceMotion()) {
      els.starBtn.classList.remove("is-pop");
      // reflow to restart animation
      void els.starBtn.offsetWidth;
      els.starBtn.classList.add("is-pop");
    }
    renderList({ animate: false });
  });

  els.markAllRead.addEventListener("click", () => {
    const list = filteredArticles();
    for (const a of list) state.readIds.add(a.id);
    saveState();
    renderNav();
    renderList({ animate: false });
    toast("已全部标为已读");
  });

  $$(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".seg-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.filter = btn.dataset.filter;
      updateSegPill(true);
      // Filter is frequent list navigation — pill moves; list does not restagger
      renderList({ animate: false });
    });
  });

  let searchTimer = 0;
  els.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.searchInput.value;
      // Search is high-frequency — no list stagger (Emil)
      renderList({ animate: false });
    }, 120);
  });

  window.addEventListener("resize", () => updateSegPill(false));

  // Keyboard: "/" focuses search without animation (high frequency)
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
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "/" ) {
      e.preventDefault();
      els.searchInput.focus();
      els.searchInput.select();
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
