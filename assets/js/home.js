// Home / category / search page.
import { sb, h, ARTICLE_COLS, CAT_NAME, configured, loadSources, friendlyError, notConfiguredState, store, ago } from "./common.js";
import { renderChrome, fetchStatus, ICONS } from "./layout.js";
import { card, leadBlock, rankScore } from "./cards.js";
import { Live } from "./live.js";

const params = new URLSearchParams(location.search);
const cat = CAT_NAME[params.get("cat")] ? params.get("cat") : null;
const q = (params.get("q") || "").trim().slice(0, 100);
const PAGE = 30;

const chrome = renderChrome({ active: "home" });
const root = document.getElementById("app");

const state = {
  sort: store.get("nabd-sort") === "top" ? "top" : "latest",
  maxId: 0,
  oldest: null,
  shown: new Set(),          // article ids on screen
  clusterCard: new Map(),    // cluster_id -> li
  clusterSize: new Map(),    // cluster_id -> number of distinct sources
  queue: [],                 // new articles waiting (paused / scrolled)
  sources: new Map(),
  unseen: 0,
};

function baseQuery() {
  let qb = sb.from("news_articles").select(ARTICLE_COLS).eq("status", "published").is("duplicate_of", null);
  if (cat) qb = qb.contains("categories", [cat]);
  return qb;
}

async function loadClusterSizes(rows) {
  const ids = [...new Set(rows.map((r) => r.cluster_id).filter((x) => x && !state.clusterSize.has(x)))];
  if (!ids.length) return;
  const { data } = await sb.from("news_clusters").select("id,source_count").in("id", ids.slice(0, 200));
  for (const c of data || []) state.clusterSize.set(c.id, c.source_count);
}

const title = cat ? CAT_NAME[cat] : q ? `نتائج البحث: ${q}` : "آخر الأخبار";
document.title = `${cat ? CAT_NAME[cat] + " — " : q ? "بحث — " : ""}نبض الأخبار`;

const feedEl = h("ul", { class: "feed", id: "feed", "aria-live": "off" });
const bannerBtn = h("button", { type: "button", onclick: () => flushQueue(true) });
const banner = h("div", { class: "new-banner", hidden: true }, bannerBtn);
const pauseBtn = h("button", { class: "btn", type: "button", "aria-pressed": "false", title: "إيقاف/استئناف التحديث المباشر" }, ICONS.pause(), "إيقاف التحديث");
const sortSeg = h("div", { class: "seg", role: "group", "aria-label": "ترتيب" },
  h("button", { type: "button", "aria-pressed": String(state.sort === "latest"), dataset: { sort: "latest" } }, "الأحدث"),
  h("button", { type: "button", "aria-pressed": String(state.sort === "top"), dataset: { sort: "top" } }, "الأهم"));
const metaEl = h("span", { class: "meta num" });
const loadMoreBtn = h("button", { class: "btn", type: "button", onclick: () => loadMore() }, "المزيد من الأخبار");
const loadMore_ = h("div", { class: "load-more", hidden: true }, loadMoreBtn);
const leadSlot = h("div");
const breakingPanel = h("ul", { class: "mini-list" });
const statusPanel = h("div", { class: "src-status" });

function skeleton() { return h("ul", { class: "skeleton", "aria-hidden": "true" }, Array.from({ length: 6 }, () => h("li"))); }

function layout() {
  root.replaceChildren(
    h("div", { class: "grid" },
      h("div", {},
        q ? null : leadSlot,
        h("div", { class: "section-head" }, h("h2", {}, title), metaEl,
          q ? null : h("div", { class: "tools" }, sortSeg, pauseBtn)),
        banner, feedEl, loadMore_),
      h("aside", {},
        h("section", { class: "panel" }, h("h2", {}, h("span", { class: "chip breaking" }, "عاجل"), "الآن"), breakingPanel,
          h("a", { href: "breaking.html", class: "note" }, "كل الأخبار العاجلة ←")),
        h("section", { class: "panel" }, h("h2", {}, "حالة المصادر"), statusPanel,
          h("p", { class: "note" }, "يجلب الخادم الأخبار تلقائياً كل دقيقتين تقريباً، ولكل مصدر فترة جلب تحترم شروطه. ", h("a", { href: "sources.html" }, "المنهجية"))))));
}

function renderRows(rows, { prepend = false, isNew = false } = {}) {
  const frag = document.createDocumentFragment();
  for (const a of rows) {
    if (state.shown.has(a.id)) continue;
    state.shown.add(a.id);
    state.maxId = Math.max(state.maxId, a.id);
    const size = state.clusterSize.get(a.cluster_id) || 1;
    if (a.cluster_id && state.clusterCard.has(a.cluster_id)) {
      // Same event already on screen: update its coverage count instead of a second card.
      const old = state.clusterCard.get(a.cluster_id);
      const fresh = card(JSON.parse(old.dataset.json), state.sources.get(Number(old.dataset.src)), { clusterSize: size, isNew });
      fresh.dataset.json = old.dataset.json; fresh.dataset.src = old.dataset.src;
      old.replaceWith(fresh);
      state.clusterCard.set(a.cluster_id, fresh);
      continue;
    }
    const li = card(a, state.sources.get(a.source_id), { clusterSize: size, isNew });
    li.dataset.json = JSON.stringify(a);
    li.dataset.src = a.source_id;
    if (a.cluster_id) state.clusterCard.set(a.cluster_id, li);
    frag.append(li);
  }
  prepend ? feedEl.prepend(frag) : feedEl.append(frag);
}

function emptyState() {
  feedEl.replaceChildren(h("li", { class: "state" },
    h("h3", {}, q ? "لا نتائج مطابقة" : "لا توجد أخبار بعد"),
    q ? "جرّب كلمات أقل أو أكثر عمومية." : "ستظهر الأخبار هنا تلقائياً فور جلبها من المصادر."));
}

async function loadInitial() {
  feedEl.replaceChildren(skeleton());
  state.shown.clear(); state.clusterCard.clear(); state.oldest = null;
  let rows;
  if (q) {
    const { data, error } = await sb.rpc("news_search_articles", { p_q: q, p_category: cat, p_limit: 50, p_before: null });
    if (error) throw error;
    rows = data;
  } else if (state.sort === "top") {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data, error } = await baseQuery().gt("published_at", since).order("published_at", { ascending: false }).limit(200);
    if (error) throw error;
    await loadClusterSizes(data);
    rows = [...data].sort((a, b) => rankScore(b, state.clusterSize.get(b.cluster_id)) - rankScore(a, state.clusterSize.get(a.cluster_id))).slice(0, 60);
  } else {
    const { data, error } = await baseQuery().order("published_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE);
    if (error) throw error;
    rows = data;
  }
  await loadClusterSizes(rows);
  feedEl.replaceChildren();
  if (!rows.length) emptyState();
  renderRows(rows);
  for (const r of rows) state.maxId = Math.max(state.maxId, r.id);
  state.oldest = rows.length ? rows[rows.length - 1].published_at : null;
  loadMore_.hidden = !!q || state.sort === "top" || rows.length < PAGE;
  metaEl.textContent = q ? `${rows.length} نتيجة` : "";
}

async function loadLead() {
  if (q) return;
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  let lq = sb.from("news_articles").select("id,source_id,title,summary,category,published_at,cluster_id,verification,is_breaking,breaking_until,importance,pinned")
    .eq("status", "published").is("duplicate_of", null).gt("published_at", since);
  if (cat) lq = lq.contains("categories", [cat]);
  const { data, error } = await lq.order("importance", { ascending: false }).order("published_at", { ascending: false }).limit(60);
  if (error || !data?.length) { leadSlot.replaceChildren(); return; }
  await loadClusterSizes(data);
  const seen = new Set();
  const top = [...data].sort((a, b) => rankScore(b, state.clusterSize.get(b.cluster_id)) - rankScore(a, state.clusterSize.get(a.cluster_id)))
    .filter((a) => { const k = a.cluster_id || "a" + a.id; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
  leadSlot.replaceChildren(leadBlock(top, state.sources, state.clusterSize) || "");
}

async function loadMore() {
  if (!state.oldest) return;
  loadMoreBtn.disabled = true;
  try {
    const { data, error } = await baseQuery().lt("published_at", state.oldest).order("published_at", { ascending: false }).limit(PAGE);
    if (error) throw error;
    await loadClusterSizes(data);
    renderRows(data);
    state.oldest = data.length ? data[data.length - 1].published_at : null;
    loadMore_.hidden = data.length < PAGE;
  } catch (e) {
    loadMore_.append(h("div", { class: "note" }, friendlyError(e)));
  } finally { loadMoreBtn.disabled = false; }
}

async function loadSide() {
  const now = new Date().toISOString();
  const [{ data: br }, status] = await Promise.all([
    sb.from("news_articles").select("id,title,published_at").eq("status", "published").eq("is_breaking", true).is("duplicate_of", null)
      .gt("breaking_until", now).order("published_at", { ascending: false }).limit(6),
    fetchStatus().catch(() => null),
  ]);
  breakingPanel.replaceChildren(...(br?.length ? br.map((a) => h("li", {}, h("a", { href: `article.html?id=${a.id}` }, a.title), h("span", { class: "t num" }, ago(a.published_at))))
    : [h("li", { class: "note" }, "لا أخبار عاجلة حالياً.")]));
  const srcs = [...state.sources.values()].filter((s) => s.enabled);
  statusPanel.replaceChildren(
    ...srcs.slice(0, 14).map((s) => {
      const stale = !s.last_success_at || Date.now() - new Date(s.last_success_at).getTime() > 3600_000;
      return h("div", {}, h("span", { class: "dot" + (stale ? " stale" : "") }), s.name_ar, h("span", { class: "when num" }, s.last_success_at ? ago(s.last_success_at) : "لم يُجلب بعد"));
    }),
    status ? h("div", { class: "note", style: "margin-top:6px" }, `${status.sources_healthy} من ${status.sources_active} مصادر تعمل الآن · ${status.articles_24h} خبراً خلال 24 ساعة`) : "");
  return status;
}

/* ---------- live ---------- */
function updateBanner() {
  const n = state.queue.length;
  banner.hidden = n === 0;
  bannerBtn.textContent = n === 1 ? "خبر جديد واحد — اعرضه" : `${n} أخبار جديدة — اعرضها`;
  document.title = (document.hidden && state.unseen ? `(${state.unseen}) ` : "") + document.title.replace(/^\(\d+\) /, "");
}

function flushQueue(scroll = false) {
  const rows = state.queue.splice(0).sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
  for (const a of rows) renderRows([a], { prepend: true, isNew: true });
  if (feedEl.querySelector(".state")) feedEl.querySelector(".state").remove();
  updateBanner();
  if (scroll) feedEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function tick() {
  if (q) return;
  const status = await loadSide();
  live.onState && chrome.setLiveState(live.state(), status?.last_run_at);
  chrome.refreshTicker();
  const { data, error } = await baseQuery().gt("id", state.maxId).order("id", { ascending: true }).limit(50);
  if (error || !data?.length) return;
  await loadClusterSizes(data);
  // refresh sizes for clusters we already show (new coverage)
  const known = data.filter((a) => a.cluster_id && state.clusterCard.has(a.cluster_id)).map((a) => a.cluster_id);
  if (known.length) { known.forEach((c) => state.clusterSize.delete(c)); await loadClusterSizes(data); }
  for (const a of data) {
    state.maxId = Math.max(state.maxId, a.id);
    if (state.shown.has(a.id) || state.queue.some((x) => x.id === a.id)) continue;
    if (a.cluster_id && state.clusterCard.has(a.cluster_id)) { renderRows([a], { isNew: true }); continue; }
    if (state.sort === "top") continue; // ranked view refreshes on demand
    state.queue.push(a);
    if (document.hidden) state.unseen++;
  }
  if (!live.paused && window.scrollY < 500) flushQueue(); else updateBanner();
  if (state.queue.length === 0) loadLead();
}

async function onChanged(id) {
  const { data } = await sb.from("news_articles").select(ARTICLE_COLS).eq("id", id).maybeSingle();
  const li = feedEl.querySelector(`li[data-id="${id}"]`);
  if (!data || data.status !== "published") { li?.remove(); state.shown.delete(id); }
  else if (li) {
    const fresh = card(data, state.sources.get(data.source_id), { clusterSize: state.clusterSize.get(data.cluster_id) || 1 });
    fresh.dataset.json = JSON.stringify(data); fresh.dataset.src = data.source_id;
    li.replaceWith(fresh);
    if (data.cluster_id) state.clusterCard.set(data.cluster_id, fresh);
  }
  chrome.refreshTicker();
  loadLead();
}

const live = new Live({ onTick: tick, onChanged, onState: (s) => chrome.setLiveState(s) });

pauseBtn.addEventListener("click", () => {
  const p = !live.paused;
  live.setPaused(p);
  pauseBtn.setAttribute("aria-pressed", String(p));
  pauseBtn.replaceChildren(p ? ICONS.play() : ICONS.pause(), p ? "استئناف التحديث" : "إيقاف التحديث");
  if (!p) flushQueue();
});
sortSeg.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sort]");
  if (!b || b.dataset.sort === state.sort) return;
  state.sort = b.dataset.sort; store.set("nabd-sort", state.sort);
  sortSeg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  loadInitial().catch(showError);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) { state.unseen = 0; updateBanner(); } });

function showError(e) {
  console.error(e);
  feedEl.replaceChildren(h("li", { class: "state" }, h("div", { class: "error-box" }, friendlyError(e), " ",
    h("button", { class: "btn", type: "button", onclick: () => boot() }, "إعادة المحاولة"))));
}

async function boot() {
  layout();
  if (!configured) return notConfiguredState(feedEl);
  try {
    state.sources = await loadSources();
    await Promise.all([loadInitial(), loadLead()]);
    const status = await loadSide();
    chrome.setLiveState("connecting", status?.last_run_at);
    chrome.refreshTicker();
    if (!q) live.start(); else chrome.setLiveState("paused", status?.last_run_at);
  } catch (e) { showError(e); }
}
boot();

// keep relative times fresh without re-rendering cards
import { time as fmtTime, isToday, shortDate } from "./common.js";
setInterval(() => {
  for (const li of feedEl.querySelectorAll("li.card")) {
    try {
      const a = JSON.parse(li.dataset.json);
      const t = li.querySelector(".time");
      t.replaceChildren(h("b", {}, fmtTime(a.published_at)), isToday(a.published_at) ? ago(a.published_at) : shortDate(a.published_at));
    } catch { /* ignore */ }
  }
}, 60_000);
