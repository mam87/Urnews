// Home / category / search page.
import { sb, h, ARTICLE_COLS, CAT_NAME, configured, loadSources, friendlyError, notConfiguredState, store, ago } from "./common.js";
import { fetchLatestStories, storyListItem } from "./stories.js";
import { renderChrome, fetchStatus, ICONS } from "./layout.js";
import { card, leadBlock, rankScore, sectionBlock } from "./cards.js";
import { Live } from "./live.js";
import { weatherPanel } from "./weather.js";
import { EN, L, REGION_NAME, countryName, flag, isCountry, langFilter, inLang } from "./i18n.js";
import { fetchGlobalEvents, eventRow } from "./global.js";

const params = new URLSearchParams(location.search);
const cat = CAT_NAME[params.get("cat")] ? params.get("cat") : null;
const q = (params.get("q") || "").trim().slice(0, 100);
const region = REGION_NAME[params.get("region")] ? params.get("region") : null;
const country = isCountry(params.get("country")) ? params.get("country") : null;
const geoName = country ? `${flag(country)} ${countryName(country)}` : region ? REGION_NAME[region] : null;
/** Category + region/country + language restrictions shared by every article query on this page. */
function scope(qb) {
  if (cat) qb = qb.contains("categories", [cat]);
  if (region) qb = qb.eq("region", region);
  if (country) qb = qb.contains("countries", [country]);
  return langFilter(qb);
}
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
  return scope(sb.from("news_articles").select(ARTICLE_COLS).eq("status", "published").is("duplicate_of", null));
}

async function loadClusterSizes(rows) {
  const ids = [...new Set(rows.map((r) => r.cluster_id).filter((x) => x && !state.clusterSize.has(x)))];
  if (!ids.length) return;
  const { data } = await sb.from("news_clusters").select("id,source_count").in("id", ids.slice(0, 200));
  for (const c of data || []) state.clusterSize.set(c.id, c.source_count);
}

const title = [cat ? CAT_NAME[cat] : null, geoName].filter(Boolean).join(" · ") || (q ? L(`نتائج البحث: ${q}`, `Search results: ${q}`) : L("آخر الأخبار من العالم", "Latest news worldwide"));
document.title = `${cat || geoName ? title + " — " : q ? L("بحث — ", "Search — ") : ""}${L("لحظة", "Lahza")}`;

const feedEl = h("ul", { class: "feed", id: "feed", "aria-live": "off" });
const bannerBtn = h("button", { type: "button", onclick: () => flushQueue(true) });
const banner = h("div", { class: "new-banner", hidden: true }, bannerBtn);
const pauseBtn = h("button", { class: "btn", type: "button", "aria-pressed": "false", title: L("إيقاف/استئناف التحديث المباشر", "Pause/resume live updates") }, ICONS.pause(), L("إيقاف التحديث", "Pause updates"));
const sortSeg = h("div", { class: "seg", role: "group", "aria-label": L("ترتيب", "Sort") },
  h("button", { type: "button", "aria-pressed": String(state.sort === "latest"), dataset: { sort: "latest" } }, L("الأحدث", "Latest")),
  h("button", { type: "button", "aria-pressed": String(state.sort === "top"), dataset: { sort: "top" } }, L("الأهم", "Top")));
const metaEl = h("span", { class: "meta num" });
const loadMoreBtn = h("button", { class: "btn", type: "button", onclick: () => loadMore() }, L("المزيد من الأخبار", "More news"));
const loadMore_ = h("div", { class: "load-more", hidden: true }, loadMoreBtn);
const leadSlot = h("div");
const sectionsSlot = h("div");
const breakingPanel = h("ul", { class: "mini-list" });
const statusPanel = h("div", { class: "src-status" });
const storiesList = h("ul", { class: "mini-list" });
const storiesPanel = h("section", { class: "panel stories-panel", hidden: true },
  h("h2", {}, h("span", { class: "chip story-chip" }, L("تقارير كاملة", "Full reports")), L("قصص مفصّلة بمصادرها", "in-depth, fully sourced")), storiesList);

function skeleton() { return h("ul", { class: "skeleton", "aria-hidden": "true" }, Array.from({ length: 6 }, () => h("li"))); }

function layout() {
  root.replaceChildren(
    h("div", { class: "grid" },
      h("div", {},
        q ? null : leadSlot,
        q || cat || region || country ? null : sectionsSlot,
        h("div", { class: "section-head" }, h("h2", {}, title), metaEl,
          q ? null : h("div", { class: "tools" }, sortSeg, pauseBtn)),
        banner, feedEl, loadMore_),
      h("aside", {},
        h("section", { class: "panel" }, h("h2", {}, h("span", { class: "chip breaking" }, L("عاجل", "Breaking")), L("عالمياً الآن", "worldwide now")), breakingPanel,
          h("a", { href: geoName ? `breaking.html?${region ? "region=" + region : "country=" + country}` : "breaking.html", class: "note" }, L("كل الأخبار العاجلة العالمية ←", "All global breaking news →"))),
        q ? null : storiesPanel,
        q ? null : weatherPanel(),
        h("section", { class: "panel" }, h("h2", {}, L("حالة المصادر", "Source status")), statusPanel,
          h("p", { class: "note" }, L("يجلب الخادم الأخبار تلقائياً كل دقيقة، ولكل مصدر فترة جلب تحترم شروطه. ", "News is fetched automatically every minute; each source has its own polite polling interval. "), h("a", { href: "sources.html" }, L("المنهجية", "Methodology")))))));
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
    h("h3", {}, q ? L("لا نتائج مطابقة", "No matching results") : L("لا توجد أخبار بعد", "No news yet")),
    q ? L("جرّب كلمات أقل أو أكثر عمومية.", "Try fewer or more general words.") : L("ستظهر الأخبار هنا تلقائياً فور جلبها من المصادر.", "News will appear here automatically as soon as it is fetched.")));
}

async function loadInitial() {
  feedEl.replaceChildren(skeleton());
  state.shown.clear(); state.clusterCard.clear(); state.oldest = null;
  let rows;
  if (q) {
    const { data, error } = await sb.rpc("news_search_articles", { p_q: q, p_category: cat, p_limit: 50, p_before: null });
    if (error) throw error;
    rows = data.filter(inLang);
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
  metaEl.textContent = q ? L(`${rows.length} نتيجة`, `${rows.length} results`) : "";
}

async function loadLead() {
  if (q) return;
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const lq = scope(sb.from("news_articles").select("id,source_id,title,title_en,language,translated,summary,category,countries,published_at,cluster_id,verification,is_breaking,breaking_until,importance,pinned,image_url")
    .eq("status", "published").is("duplicate_of", null).gt("published_at", since));
  const { data, error } = await lq.order("importance", { ascending: false }).order("published_at", { ascending: false }).limit(60);
  if (error || !data?.length) { leadSlot.replaceChildren(); return; }
  await loadClusterSizes(data);
  const seen = new Set();
  const top = [...data].sort((a, b) => rankScore(b, state.clusterSize.get(b.cluster_id)) - rankScore(a, state.clusterSize.get(a.cluster_id)))
    .filter((a) => { const k = a.cluster_id || "a" + a.id; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
  // Prefer a lead story with a picture when it is nearly as important as the top one.
  const hasImg = (a) => a.image_url && state.sources.get(a.source_id)?.allow_images;
  const iImg = top.findIndex(hasImg);
  if (iImg > 0 && rankScore(top[0], state.clusterSize.get(top[0].cluster_id)) - rankScore(top[iImg], state.clusterSize.get(top[iImg].cluster_id)) < 25) {
    top.unshift(top.splice(iImg, 1)[0]);
  }
  leadSlot.replaceChildren(leadBlock(top, state.sources, state.clusterSize) || "");
  state.leadIds = new Set(top.map((a) => a.id));
  if (!cat && !region && !country) loadSections();
}

// World first: Jordan, Palestine and the Arab world are sections like any other, never pinned to the top.
const SECTION_ORDER = ["world", "politics", "economy", "tech", "health", "environment", "arab", "palestine", "jordan", "sports", "security", "weather", "education", "entertainment"];
async function loadSections() {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data, error } = await langFilter(sb.from("news_articles").select("id,source_id,title,title_en,language,translated,summary,category,published_at,image_url,importance")
    .eq("status", "published").is("duplicate_of", null).gt("published_at", since))
    .order("published_at", { ascending: false }).limit(250);
  if (error || !data?.length) { sectionsSlot.replaceChildren(); return; }
  const lead = state.leadIds || new Set();
  const hasImg = (a) => a.image_url && state.sources.get(a.source_id)?.allow_images;
  const blocks = [];
  for (const slug of SECTION_ORDER) {
    const items = data.filter((a) => a.category === slug && !lead.has(a.id));
    if (items.length < 2) continue;
    const withImg = items.slice(0, 4).findIndex(hasImg);
    if (withImg > 0) items.unshift(items.splice(withImg, 1)[0]);
    blocks.push(sectionBlock(slug, items, state.sources));
    if (blocks.length === 6) break;
  }
  sectionsSlot.replaceChildren(...(blocks.length ? [h("div", { class: "sections" }, blocks)] : []));
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
  void now;
  const [events, status, stories] = await Promise.all([
    fetchGlobalEvents({ breakingOnly: true, region, country, limit: 6 }).catch(() => []),
    fetchStatus().catch(() => null),
    fetchLatestStories({ limit: 5, category: cat || null, country: country || null }).catch(() => []),
  ]);
  storiesPanel.hidden = !stories.length;
  storiesList.replaceChildren(...stories.map(storyListItem));
  breakingPanel.replaceChildren(...(events.length ? events.map(eventRow)
    : [h("li", { class: "note" }, L("لا أخبار عاجلة حالياً.", "No breaking news right now."))]));
  const srcs = [...state.sources.values()].filter((s) => s.enabled);
  statusPanel.replaceChildren(
    ...srcs.slice(0, 14).map((s) => {
      const stale = !s.last_success_at || Date.now() - new Date(s.last_success_at).getTime() > 3600_000;
      return h("div", {}, h("span", { class: "dot" + (stale ? " stale" : "") }), EN ? s.name_en || s.name_ar : s.name_ar, h("span", { class: "when num" }, s.last_success_at ? ago(s.last_success_at) : L("لم يُجلب بعد", "not fetched yet")));
    }),
    status ? h("div", { class: "note", style: "margin-top:6px" }, L(`${status.sources_healthy} من ${status.sources_active} مصادر تعمل الآن · ${status.articles_24h} خبراً خلال 24 ساعة`, `${status.sources_healthy} of ${status.sources_active} sources working · ${status.articles_24h} stories in 24 h`)) : "");
  return status;
}

/* ---------- live ---------- */
function updateBanner() {
  const n = state.queue.length;
  banner.hidden = n === 0;
  bannerBtn.textContent = EN ? (n === 1 ? "1 new story — show" : `${n} new stories — show`) : n === 1 ? "خبر جديد واحد — اعرضه" : `${n} أخبار جديدة — اعرضها`;
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
  if (!data || data.status !== "published" || !inLang(data)) { li?.remove(); state.shown.delete(id); }
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
  pauseBtn.replaceChildren(p ? ICONS.play() : ICONS.pause(), p ? L("استئناف التحديث", "Resume updates") : L("إيقاف التحديث", "Pause updates"));
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
    h("button", { class: "btn", type: "button", onclick: () => boot() }, L("إعادة المحاولة", "Try again")))));
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
