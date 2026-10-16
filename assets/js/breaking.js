// Breaking news page: 48-hour timeline grouped by Amman day, live-updating.
import { sb, h, configured, loadSources, friendlyError, notConfiguredState, time, date, ammanDay, verificationChip, CAT_NAME } from "./common.js";
import { renderChrome, fetchStatus } from "./layout.js";
import { Live } from "./live.js";

const chrome = renderChrome({ active: "breaking" });
const root = document.getElementById("app");
document.title = "عاجل — نبض الأخبار";
const list = h("ol", { class: "timeline" });
let sources = new Map();
let lastIds = "";

async function load() {
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const { data, error } = await sb.from("news_articles")
    .select("id,title,summary,source_id,published_at,breaking_until,verification,category,cluster_id")
    .eq("status", "published").eq("is_breaking", true).is("duplicate_of", null)
    .gt("published_at", since).order("published_at", { ascending: false }).limit(100);
  if (error) throw error;
  const ids = data.map((a) => a.id).join(",");
  if (ids === lastIds) return;
  const fresh = new Set(data.map((a) => a.id).filter((x) => lastIds && !lastIds.split(",").includes(String(x))));
  lastIds = ids;
  if (!data.length) {
    list.replaceChildren(h("li", { class: "state", style: "display:block" }, h("h3", {}, "لا أخبار عاجلة خلال آخر 48 ساعة"), "ستظهر هنا فور ورودها."));
    return;
  }
  const out = [];
  let day = "";
  for (const a of data) {
    const d = ammanDay(a.published_at);
    if (d !== day) { day = d; out.push(h("li", { class: "day-sep", style: "display:block" }, date(a.published_at))); }
    const active = new Date(a.breaking_until) > new Date();
    out.push(h("li", { class: (active ? "" : "expired ") + (fresh.has(a.id) ? "card is-new" : "") },
      h("span", { class: "tl-time num" }, time(a.published_at)),
      h("span", { class: "tl-dot", "aria-hidden": "true" }),
      h("div", {},
        h("h3", {}, h("a", { href: `article.html?id=${a.id}` }, a.title)),
        a.summary ? h("p", { class: "note", style: "font-size:14px;margin:0" }, a.summary) : null,
        h("div", { class: "meta-row" }, h("span", { class: "src" }, sources.get(a.source_id)?.name_ar || ""), h("span", { class: "chip cat" }, CAT_NAME[a.category] || ""), verificationChip(a.verification)))));
  }
  list.replaceChildren(...out);
}

async function boot() {
  root.replaceChildren(h("div", { class: "section-head" }, h("h2", {}, "الأخبار العاجلة"), h("span", { class: "meta" }, "آخر 48 ساعة · بتوقيت عمّان")), list);
  if (!configured) return notConfiguredState(list);
  try {
    sources = await loadSources();
    await load();
    const s = await fetchStatus().catch(() => null);
    chrome.setLiveState("connecting", s?.last_run_at);
    chrome.refreshTicker();
    const live = new Live({
      onTick: async () => { await load(); chrome.refreshTicker(); const st = await fetchStatus().catch(() => null); chrome.setLiveState(live.state(), st?.last_run_at); },
      onChanged: () => { lastIds = ""; load(); chrome.refreshTicker(); },
      onState: (st) => chrome.setLiveState(st),
    });
    live.start();
  } catch (e) {
    list.replaceChildren(h("li", { class: "error-box", style: "display:block" }, friendlyError(e)));
  }
}
boot();
