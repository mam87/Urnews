// Shared page chrome: masthead, breaking ticker, category navigation, footer.
import { sb, h, CATEGORIES, time, ago, initTheme, setupSearchToggle, configured } from "./common.js";

const svg = (path, vb = "0 0 24 24") => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", vb); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = path; // static, trusted icon markup only
  return s;
};
export const ICONS = {
  pulse: () => svg('<path d="M2 12h6l3-8 4 16 3-8h4"/>', "0 0 24 24"),
  search: () => svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  theme: () => svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  pause: () => svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
  play: () => svg('<path d="M7 5v14l11-7z"/>'),
  ext: () => svg('<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M20 14v6H4V4h6"/>'),
  share: () => svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>'),
};

export function renderChrome({ active = "home" } = {}) {
  const params = new URLSearchParams(location.search);
  const q = params.get("q") || "";
  const livePill = h("span", { class: "live-pill", id: "live-pill", "data-state": "connecting", role: "status", "aria-live": "polite" },
    h("span", { class: "live-dot" }), h("span", { class: "live-text" }, "جارٍ الاتصال…"));

  const searchForm = (cls, id) => h("form", { class: cls, id, action: "index.html", role: "search" },
    h("label", { class: "sr-only", for: id + "-q" }, "بحث في الأخبار"),
    h("input", { id: id + "-q", name: "q", type: "search", placeholder: "ابحث في الأخبار…", value: q, maxlength: "100", autocomplete: "off" }),
    cls === "search" ? ICONS.search() : null);

  const header = h("header", { class: "masthead" },
    h("div", { class: "wrap bar" },
      h("a", { class: "brand", href: "index.html", "aria-label": "نبض الأخبار — الصفحة الرئيسية" }, ICONS.pulse(), "نبض الأخبار", h("small", {}, "أخبار عاجلة ومباشرة")),
      h("div", { class: "mast-tools" },
        livePill,
        searchForm("search", "s1"),
        h("button", { class: "icon-btn search-toggle", id: "search-toggle", type: "button", "aria-label": "بحث" }, ICONS.search()),
        h("button", { class: "icon-btn", id: "theme-toggle", type: "button", "aria-label": "تبديل الوضع الليلي" }, ICONS.theme()))),
    h("div", { class: "wrap" }, h("div", { class: "search-mobile", id: "search-mobile" }, searchForm("", "s2"))));

  const tickerTrack = h("div", { class: "ticker-track", id: "ticker-track" }, h("div", { class: "ticker-empty" }, "جارٍ تحميل الأخبار العاجلة…"));
  const ticker = h("section", { class: "ticker", "aria-label": "شريط الأخبار العاجلة" },
    h("div", { class: "wrap" }, h("a", { class: "ticker-label", href: "breaking.html" }, "عاجل"), tickerTrack));

  const cat = params.get("cat");
  const nav = h("nav", { class: "catnav", "aria-label": "الأقسام" },
    h("div", { class: "wrap" },
      h("a", { href: "index.html", "aria-current": active === "home" && !cat && !q ? "page" : null }, "الرئيسية"),
      h("a", { href: "breaking.html", class: "breaking-link", "aria-current": active === "breaking" ? "page" : null }, "عاجل"),
      CATEGORIES.map(([slug, name]) => h("a", { href: `index.html?cat=${slug}`, "aria-current": cat === slug ? "page" : null }, name))));

  const footer = h("footer", { class: "site" },
    h("div", { class: "wrap" },
      h("div", {}, "نبض الأخبار يجمع العناوين آلياً من خلاصات RSS رسمية لمصادر إخبارية موثوقة، ويعرض عنواناً ومقتطفاً قصيراً مع رابط واضح للمصدر الأصلي. حقوق المحتوى محفوظة لأصحابها."),
      h("div", {}, "التصنيفات وعلامات التحقق آلية وقد تخطئ؛ عبارة «حسب المصدر» تعني أن الموقع لم يتحقق من الخبر بشكل مستقل. جميع الأوقات بتوقيت عمّان."),
      h("div", {}, h("a", { href: "sources.html" }, "المصادر ومنهجية العمل"), " · ", h("a", { href: "admin.html" }, "دخول المحررين"))));

  document.body.prepend(header, ticker, nav);
  document.body.append(footer);
  initTheme();
  setupSearchToggle();

  let lastRun = null;
  const setLiveState = (state, lastUpdated) => {
    if (lastUpdated) lastRun = lastUpdated;
    livePill.dataset.state = state;
    const label = { live: "مباشر", polling: "تحديث دوري", paused: "متوقف مؤقتاً", offline: "غير متصل", connecting: "جارٍ الاتصال…" }[state] || state;
    const txt = livePill.querySelector(".live-text");
    txt.replaceChildren(label, lastRun ? h("span", { class: "lbl-long" }, " · آخر تحديث " + time(lastRun)) : "");
    livePill.title = lastRun ? `آخر جلب ناجح للأخبار: ${ago(lastRun)}` : "";
  };

  async function refreshTicker() {
    if (!configured) return;
    const { data, error } = await sb.from("articles")
      .select("id,title,published_at")
      .eq("status", "published").eq("is_breaking", true).is("duplicate_of", null)
      .gt("breaking_until", new Date().toISOString())
      .order("published_at", { ascending: false }).limit(12);
    if (error) { tickerTrack.replaceChildren(h("div", { class: "ticker-empty" }, "تعذّر تحميل العاجل")); return; }
    if (!data.length) { tickerTrack.replaceChildren(h("div", { class: "ticker-empty" }, "لا أخبار عاجلة في هذه اللحظة")); return; }
    const group = () => h("span", { class: "ticker-group" }, data.map((a, i) => [
      i ? h("span", { class: "sep", "aria-hidden": "true" }) : null,
      h("a", { href: `article.html?id=${a.id}` }, a.title, h("span", { class: "t-time" }, time(a.published_at))),
    ]));
    const g2 = group(); g2.setAttribute("aria-hidden", "true"); g2.querySelectorAll("a").forEach((x) => x.setAttribute("tabindex", "-1"));
    const move = h("div", { class: "ticker-move" }, group(), g2);
    const chars = data.reduce((n, a) => n + a.title.length, 0);
    move.style.setProperty("--dur", Math.max(25, Math.round(chars / 5)) + "s"); // ~5 chars/sec, readable
    tickerTrack.replaceChildren(move);
  }
  return { setLiveState, refreshTicker };
}

export async function fetchStatus() {
  const { data, error } = await sb.rpc("site_status");
  if (error) throw error;
  return data;
}
