// Shared page chrome: date strip, masthead, breaking ticker, category navigation, footer,
// reader settings, mobile bottom bar and back-to-top.
import { sb, h, CATEGORIES, time, ago, initTheme, setupSearchToggle, configured, todayLabel, getPrefs, setPrefs, FONT_STEPS } from "./common.js";

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
  gear: () => svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  home: () => svg('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>'),
  bolt: () => svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  tv: () => svg('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 2 4 4 4-4"/>'),
  up: () => svg('<path d="m6 14 6-6 6 6"/>'),
};

function settingsDialog() {
  const p = getPrefs();
  const seg = (name, options, cur, onPick) => {
    const g = h("div", { class: "seg", role: "radiogroup", "aria-label": name },
      options.map(([v, label]) => h("button", { type: "button", role: "radio", "aria-pressed": String(String(cur) === String(v)), "aria-checked": String(String(cur) === String(v)), dataset: { v } }, label)));
    g.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]"); if (!b) return;
      g.querySelectorAll("button").forEach((x) => { const on = x === b; x.setAttribute("aria-pressed", String(on)); x.setAttribute("aria-checked", String(on)); });
      onPick(b.dataset.v);
    });
    return g;
  };
  const sw = (label, checked, onChange) => {
    const input = h("input", { type: "checkbox", checked });
    input.addEventListener("change", () => onChange(input.checked));
    return h("label", { class: "switch" }, h("span", {}, label), input);
  };
  const d = h("dialog", { class: "settings", "aria-labelledby": "set-title" },
    h("h3", { id: "set-title" }, "إعدادات القراءة"),
    h("p", { class: "note", style: "margin:0 0 6px" }, "تُحفظ على هذا الجهاز فقط."),
    h("div", { class: "opt" }, h("span", { class: "lbl" }, "حجم الخط"),
      seg("حجم الخط", FONT_STEPS, p.fs, (v) => setPrefs({ fs: v })),
      h("div", { class: "preview" }, "مثال: هذا هو حجم النص الذي ستقرأ به الأخبار والعناوين في الموقع.")),
    h("div", { class: "opt" }, h("span", { class: "lbl" }, "المظهر"),
      seg("المظهر", [["auto", "تلقائي"], ["light", "فاتح"], ["dark", "داكن"]], p.theme, (v) => setPrefs({ theme: v }))),
    h("div", { class: "opt" }, h("span", { class: "lbl" }, "طريقة العرض"),
      seg("طريقة العرض", [["comfy", "مريحة مع المقتطفات"], ["compact", "مختصرة (عناوين فقط)"]], p.density, (v) => setPrefs({ density: v }))),
    h("div", { class: "opt" }, sw("إخفاء الصور (يوفر استهلاك الإنترنت)", p.noimg, (v) => setPrefs({ noimg: v }))),
    h("div", { class: "opt" }, sw("إيقاف حركة شريط العاجل", p.motion === "reduce", (v) => setPrefs({ motion: v ? "reduce" : "auto" }))),
    h("div", { class: "toolbar", style: "justify-content:space-between;margin:14px 0 0" },
      h("button", { class: "btn", type: "button", onclick: () => { setPrefs({ theme: "auto", fs: "1", noimg: false, motion: "auto", density: "comfy" }); d.close(); } }, "استعادة الافتراضي"),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => d.close() }, "تم")));
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  document.body.append(d);
  d.showModal();
}

export function renderChrome({ active = "home" } = {}) {
  const params = new URLSearchParams(location.search);
  const q = params.get("q") || "";
  const cat = params.get("cat");
  const livePill = h("span", { class: "live-pill", id: "live-pill", "data-state": "connecting", role: "status", "aria-live": "polite" },
    h("span", { class: "live-dot" }), h("span", { class: "live-text" }, "جارٍ الاتصال…"));

  const searchForm = (cls, id) => h("form", { class: cls, id, action: "index.html", role: "search" },
    h("label", { class: "sr-only", for: id + "-q" }, "بحث في الأخبار"),
    h("input", { id: id + "-q", name: "q", type: "search", placeholder: "ابحث في الأخبار…", value: q, maxlength: "100", autocomplete: "off" }),
    cls === "search" ? ICONS.search() : null);

  const strip = h("div", { class: "topstrip" },
    h("div", { class: "wrap" },
      h("span", {}, todayLabel()),
      h("span", { class: "sep-dot hide-sm", "aria-hidden": "true" }),
      h("span", { class: "hide-sm" }, "بتوقيت عمّان"),
      h("span", { class: "push" },
        h("a", { href: "live.html" }, "البث المباشر"),
        h("a", { href: "sources.html", class: "hide-sm" }, "المصادر"),
        h("button", { type: "button", class: "linklike", style: "border:0;background:none;padding:0;cursor:pointer;color:var(--ink-2);font:inherit", onclick: settingsDialog }, "حجم الخط والإعدادات"))));

  const header = h("header", { class: "masthead" },
    h("div", { class: "wrap bar" },
      h("a", { class: "brand", href: "index.html", "aria-label": "نبض الأخبار — الصفحة الرئيسية" },
        h("span", { class: "mark" }, ICONS.pulse()), "نبض الأخبار", h("small", {}, "أخبار عاجلة ومباشرة")),
      h("div", { class: "mast-tools" },
        livePill,
        searchForm("search", "s1"),
        h("button", { class: "icon-btn search-toggle", id: "search-toggle", type: "button", "aria-label": "بحث" }, ICONS.search()),
        h("button", { class: "icon-btn", id: "theme-toggle", type: "button", "aria-label": "تبديل الوضع الليلي" }, ICONS.theme()),
        h("button", { class: "icon-btn", id: "settings-btn", type: "button", "aria-label": "إعدادات القراءة وحجم الخط", onclick: settingsDialog }, ICONS.gear()))),
    h("div", { class: "wrap" }, h("div", { class: "search-mobile", id: "search-mobile" }, searchForm("", "s2"))));

  const tickerTrack = h("div", { class: "ticker-track", id: "ticker-track" }, h("div", { class: "ticker-empty" }, "جارٍ تحميل الأخبار العاجلة…"));
  const ticker = h("section", { class: "ticker", "aria-label": "شريط الأخبار العاجلة" },
    h("div", { class: "wrap" }, h("a", { class: "ticker-label", href: "breaking.html" }, "عاجل"), tickerTrack));

  const nav = h("nav", { class: "catnav", "aria-label": "الأقسام" },
    h("div", { class: "wrap" },
      h("a", { href: "index.html", "aria-current": active === "home" && !cat && !q ? "page" : null }, "الرئيسية"),
      h("a", { href: "breaking.html", class: "breaking-link", "aria-current": active === "breaking" ? "page" : null }, "عاجل"),
      h("a", { href: "live.html", class: "live-link", "aria-current": active === "live" ? "page" : null }, "بث مباشر"),
      CATEGORIES.map(([slug, name]) => h("a", { href: `index.html?cat=${slug}`, "aria-current": cat === slug ? "page" : null, dataset: { cat: slug } },
        h("span", { class: "dot", style: `background:var(--c-${slug})`, "aria-hidden": "true" }), name))));

  const footer = h("footer", { class: "site" },
    h("div", { class: "wrap" },
      h("div", { class: "cols" },
        h("div", {},
          h("div", { class: "brand" }, h("span", { class: "mark" }, ICONS.pulse()), "نبض الأخبار"),
          h("p", { style: "margin:0" }, "يجمع العناوين آلياً على مدار الساعة من الخلاصات الرسمية لمصادر إخبارية موثوقة، ويعرض عنواناً ومقتطفاً مع رابط واضح للخبر الكامل لدى مصدره. حقوق المحتوى محفوظة لأصحابها.")),
        h("div", {}, h("h4", {}, "الأقسام"),
          h("ul", {}, CATEGORIES.slice(0, 5).map(([slug, name]) => h("li", {}, h("a", { href: `index.html?cat=${slug}` }, name))))),
        h("div", {}, h("h4", {}, "الموقع"),
          h("ul", {},
            h("li", {}, h("a", { href: "breaking.html" }, "الأخبار العاجلة")),
            h("li", {}, h("a", { href: "live.html" }, "البث المباشر")),
            h("li", {}, h("a", { href: "sources.html" }, "المصادر ومنهجية العمل")),
            h("li", {}, h("button", { type: "button", style: "border:0;background:none;padding:0;cursor:pointer;color:inherit;font:inherit", onclick: settingsDialog }, "إعدادات القراءة")),
            h("li", {}, h("a", { href: "admin.html" }, "دخول المحررين"))))),
      h("div", { class: "legal" }, "التصنيفات وعلامات التحقق آلية وقد تخطئ؛ «حسب المصدر» تعني أن الموقع لم يتحقق من الخبر بشكل مستقل. جميع الأوقات بتوقيت عمّان.")));

  const bottombar = h("nav", { class: "bottombar", "aria-label": "تنقل سريع" },
    h("a", { href: "index.html", "aria-current": active === "home" && !cat && !q ? "page" : null }, ICONS.home(), "الرئيسية"),
    h("a", { href: "breaking.html", "aria-current": active === "breaking" ? "page" : null }, ICONS.bolt(), "عاجل"),
    h("a", { href: "live.html", class: "live-ic", "aria-current": active === "live" ? "page" : null }, ICONS.tv(), "بث مباشر"),
    h("button", { type: "button", onclick: () => { const box = document.getElementById("search-mobile"); box.classList.add("open"); scrollTo({ top: 0 }); box.querySelector("input")?.focus(); } }, ICONS.search(), "بحث"),
    h("button", { type: "button", onclick: settingsDialog }, ICONS.gear(), "الإعدادات"));

  const toTop = h("button", { class: "to-top", type: "button", "aria-label": "العودة للأعلى", onclick: () => scrollTo({ top: 0, behavior: "smooth" }) }, ICONS.up());
  addEventListener("scroll", () => toTop.classList.toggle("show", scrollY > 900), { passive: true });

  document.body.prepend(strip, header, ticker, nav);
  document.body.append(footer, bottombar, toTop);
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
    const { data, error } = await sb.from("news_articles")
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
  const { data, error } = await sb.rpc("news_site_status");
  if (error) throw error;
  return data;
}
