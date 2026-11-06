// Shared page chrome: date strip, masthead, breaking ticker, category navigation, footer,
// reader settings, mobile bottom bar and back-to-top.
import { sb, h, CATEGORIES, time, ago, initTheme, setupSearchToggle, configured, todayLabel, getPrefs, setPrefs, FONT_STEPS } from "./common.js";
import { EN, L, setLang, langFilter, titleOf, titleDir } from "./i18n.js";

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
  globe: () => svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
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
    h("h3", { id: "set-title" }, L("إعدادات القراءة", "Reading settings")),
    h("p", { class: "note", style: "margin:0 0 6px" }, L("تُحفظ على هذا الجهاز فقط.", "Saved on this device only.")),
    h("div", { class: "opt" }, h("span", { class: "lbl" }, L("حجم الخط", "Text size")),
      seg(L("حجم الخط", "Text size"), EN ? FONT_STEPS.map(([v], i) => [v, ["Small", "Normal", "Large", "Larger", "Huge"][i]]) : FONT_STEPS, p.fs, (v) => setPrefs({ fs: v })),
      h("div", { class: "preview" }, L("مثال: هذا هو حجم النص الذي ستقرأ به الأخبار والعناوين في الموقع.", "Example: this is the size you will read headlines and news in."))),
    h("div", { class: "opt" }, h("span", { class: "lbl" }, L("المظهر", "Appearance")),
      seg(L("المظهر", "Appearance"), [["auto", L("تلقائي", "Auto")], ["light", L("فاتح", "Light")], ["dark", L("داكن", "Dark")]], p.theme, (v) => setPrefs({ theme: v }))),
    h("div", { class: "opt" }, h("span", { class: "lbl" }, L("طريقة العرض", "Layout")),
      seg(L("طريقة العرض", "Layout"), [["comfy", L("مريحة مع المقتطفات", "Comfortable, with excerpts")], ["compact", L("مختصرة (عناوين فقط)", "Compact (headlines only)")]], p.density, (v) => setPrefs({ density: v }))),
    h("div", { class: "opt" }, h("span", { class: "lbl" }, L("اللغة", "Language")),
      seg(L("اللغة", "Language"), [["ar", "العربية"], ["en", "English"]], EN ? "en" : "ar", (v) => setLang(v))),
    h("div", { class: "opt" }, sw(L("إخفاء الصور (يوفر استهلاك الإنترنت)", "Hide images (saves data)"), p.noimg, (v) => setPrefs({ noimg: v }))),
    h("div", { class: "opt" }, sw(L("إيقاف حركة شريط العاجل", "Stop the breaking-news ticker animation"), p.motion === "reduce", (v) => setPrefs({ motion: v ? "reduce" : "auto" }))),
    h("div", { class: "toolbar", style: "justify-content:space-between;margin:14px 0 0" },
      h("button", { class: "btn", type: "button", onclick: () => { setPrefs({ theme: "auto", fs: "1", noimg: false, motion: "auto", density: "comfy" }); d.close(); } }, L("استعادة الافتراضي", "Reset")),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => d.close() }, L("تم", "Done"))));
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
    h("span", { class: "live-dot" }), h("span", { class: "live-text" }, L("جارٍ الاتصال…", "Connecting…")));

  const searchForm = (cls, id) => h("form", { class: cls, id, action: "index.html", role: "search" },
    h("label", { class: "sr-only", for: id + "-q" }, L("بحث في الأخبار", "Search news")),
    h("input", { id: id + "-q", name: "q", type: "search", placeholder: L("ابحث في الأخبار…", "Search the news…"), value: q, maxlength: "100", autocomplete: "off" }),
    cls === "search" ? ICONS.search() : null);

  const strip = h("div", { class: "topstrip" },
    h("div", { class: "wrap" },
      h("span", {}, todayLabel()),
      h("span", { class: "sep-dot hide-sm", "aria-hidden": "true" }),
      h("span", { class: "hide-sm" }, L("بتوقيت عمّان", "Amman time")),
      h("span", { class: "push" },
        h("a", { href: "live.html" }, L("البث المباشر", "Live TV")),
        h("a", { href: "sources.html", class: "hide-sm" }, L("المصادر", "Sources")),
        h("button", { type: "button", class: "linklike", lang: EN ? "ar" : "en", style: "border:0;background:none;padding:0;cursor:pointer;color:var(--ink-2);font:inherit;font-weight:700", onclick: () => setLang(EN ? "ar" : "en") }, EN ? "العربية" : "English"),
        h("button", { type: "button", class: "linklike", style: "border:0;background:none;padding:0;cursor:pointer;color:var(--ink-2);font:inherit", onclick: settingsDialog }, L("حجم الخط والإعدادات", "Text size & settings")))));

  const header = h("header", { class: "masthead" },
    h("div", { class: "wrap bar" },
      h("a", { class: "brand", href: "index.html", "aria-label": L("لحظة — الصفحة الرئيسية", "Lahza — home") },
        h("span", { class: "mark" }, ICONS.pulse()), L("لحظة", "Lahza"), h("small", {}, L("الخبر لحظة بلحظة", "World news, minute by minute"))),
      h("div", { class: "mast-tools" },
        livePill,
        searchForm("search", "s1"),
        h("button", { class: "icon-btn search-toggle", id: "search-toggle", type: "button", "aria-label": L("بحث", "Search") }, ICONS.search()),
        h("button", { class: "icon-btn lang-btn", type: "button", lang: EN ? "ar" : "en", "aria-label": L("Switch to English", "التبديل إلى العربية"), title: L("English", "العربية"), onclick: () => setLang(EN ? "ar" : "en") }, EN ? "ع" : "EN"),
        h("button", { class: "icon-btn", id: "theme-toggle", type: "button", "aria-label": L("تبديل الوضع الليلي", "Toggle dark mode") }, ICONS.theme()),
        h("button", { class: "icon-btn", id: "settings-btn", type: "button", "aria-label": L("إعدادات القراءة وحجم الخط", "Reading settings"), onclick: settingsDialog }, ICONS.gear()))),
    h("div", { class: "wrap" }, h("div", { class: "search-mobile", id: "search-mobile" }, searchForm("", "s2"))));

  const tickerTrack = h("div", { class: "ticker-track", id: "ticker-track" }, h("div", { class: "ticker-empty" }, L("جارٍ تحميل الأخبار العاجلة…", "Loading breaking news…")));
  const ticker = h("section", { class: "ticker", "aria-label": L("شريط الأخبار العاجلة", "Breaking news ticker") },
    h("div", { class: "wrap" }, h("a", { class: "ticker-label", href: "breaking.html" }, L("عاجل", "Breaking")), tickerTrack));

  const nav = h("nav", { class: "catnav", "aria-label": L("الأقسام", "Sections") },
    h("div", { class: "wrap" },
      h("a", { href: "index.html", "aria-current": active === "home" && !cat && !q ? "page" : null }, L("الرئيسية", "Home")),
      h("a", { href: "breaking.html", class: "breaking-link", "aria-current": active === "breaking" ? "page" : null }, L("عاجل عالمي", "Global breaking")),
      h("a", { href: "live.html", class: "live-link", "aria-current": active === "live" ? "page" : null }, L("بث مباشر", "Live TV")),
      CATEGORIES.map(([slug, name]) => h("a", { href: `index.html?cat=${slug}`, "aria-current": cat === slug ? "page" : null, dataset: { cat: slug } },
        h("span", { class: "dot", style: `background:var(--c-${slug})`, "aria-hidden": "true" }), name))));

  const footer = h("footer", { class: "site" },
    h("div", { class: "wrap" },
      h("div", { class: "cols" },
        h("div", {},
          h("div", { class: "brand" }, h("span", { class: "mark" }, ICONS.pulse()), L("لحظة", "Lahza")),
          h("p", { style: "margin:0" }, L("منصة أخبار عالمية: تجمع العناوين آلياً على مدار الساعة من الخلاصات الرسمية لمصادر موثوقة من كل مناطق العالم، وترتّب الأحداث حسب أهميتها العالمية، وتعرض عنواناً ومقتطفاً مع رابط واضح للخبر الكامل لدى مصدره. حقوق المحتوى محفوظة لأصحابها.", "A global news platform: headlines are collected automatically, around the clock, from the official feeds of trusted publishers in every region, ranked by global importance, and shown as a headline and short excerpt with a clear link to the full story at its source. All content rights belong to their owners."))),
        h("div", {}, h("h4", {}, L("الأقسام", "Sections")),
          h("ul", {}, CATEGORIES.slice(0, 5).map(([slug, name]) => h("li", {}, h("a", { href: `index.html?cat=${slug}` }, name))))),
        h("div", {}, h("h4", {}, L("الموقع", "Site")),
          h("ul", {},
            h("li", {}, h("a", { href: "breaking.html" }, L("الأخبار العاجلة العالمية", "Global breaking news"))),
            h("li", {}, h("a", { href: "live.html" }, L("البث المباشر", "Live TV"))),
            h("li", {}, h("a", { href: "sources.html" }, L("المصادر ومنهجية العمل", "Sources & methodology"))),
            h("li", {}, h("button", { type: "button", style: "border:0;background:none;padding:0;cursor:pointer;color:inherit;font:inherit", onclick: settingsDialog }, L("إعدادات القراءة", "Reading settings"))),
            h("li", {}, h("a", { href: "admin.html" }, L("دخول المحررين", "Editors")))))),
      h("div", { class: "legal" }, L("التصنيفات وعلامات التحقق وترتيب الأهمية آلية وقد تخطئ؛ «حسب المصدر» تعني أن الموقع لم يتحقق من الخبر بشكل مستقل. جميع الأوقات بتوقيت عمّان.", "Sections, verification labels and importance scores are automatic and can be wrong; “as reported” means we have not verified the story independently. All times are Amman time (UTC+3)."))));

  const bottombar = h("nav", { class: "bottombar", "aria-label": L("تنقل سريع", "Quick navigation") },
    h("a", { href: "index.html", "aria-current": active === "home" && !cat && !q ? "page" : null }, ICONS.home(), L("الرئيسية", "Home")),
    h("a", { href: "breaking.html", "aria-current": active === "breaking" ? "page" : null }, ICONS.bolt(), L("عاجل", "Breaking")),
    h("a", { href: "live.html", class: "live-ic", "aria-current": active === "live" ? "page" : null }, ICONS.tv(), L("بث مباشر", "Live")),
    h("button", { type: "button", onclick: () => { const box = document.getElementById("search-mobile"); box.classList.add("open"); scrollTo({ top: 0 }); box.querySelector("input")?.focus(); } }, ICONS.search(), L("بحث", "Search")),
    h("button", { type: "button", onclick: settingsDialog }, ICONS.gear(), L("الإعدادات", "Settings")));

  const toTop = h("button", { class: "to-top", type: "button", "aria-label": L("العودة للأعلى", "Back to top"), onclick: () => scrollTo({ top: 0, behavior: "smooth" }) }, ICONS.up());
  addEventListener("scroll", () => toTop.classList.toggle("show", scrollY > 900), { passive: true });

  document.body.prepend(strip, header, ticker, nav);
  document.body.append(footer, bottombar, toTop);
  initTheme();
  setupSearchToggle();

  let lastRun = null;
  const setLiveState = (state, lastUpdated) => {
    if (lastUpdated) lastRun = lastUpdated;
    livePill.dataset.state = state;
    const label = (EN ? { live: "Live", polling: "Auto-refresh", paused: "Paused", offline: "Offline", connecting: "Connecting…" } : { live: "مباشر", polling: "تحديث دوري", paused: "متوقف مؤقتاً", offline: "غير متصل", connecting: "جارٍ الاتصال…" })[state] || state;
    const txt = livePill.querySelector(".live-text");
    txt.replaceChildren(label, lastRun ? h("span", { class: "lbl-long" }, L(" · آخر تحديث ", " · updated ") + time(lastRun)) : "");
    livePill.title = lastRun ? L("آخر جلب ناجح للأخبار: ", "Last successful fetch: ") + ago(lastRun) : "";
  };

  async function refreshTicker() {
    if (!configured) return;
    const { data, error } = await langFilter(sb.from("news_articles")
      .select("id,title,title_en,language,published_at,cluster_id")
      .eq("status", "published").eq("is_breaking", true).is("duplicate_of", null)
      .gt("breaking_until", new Date().toISOString()))
      .order("published_at", { ascending: false }).limit(20);
    if (error) { tickerTrack.replaceChildren(h("div", { class: "ticker-empty" }, L("تعذّر تحميل العاجل", "Could not load breaking news"))); return; }
    // one headline per event (the oldest report of each event is dropped in favour of the newest)
    const seenEv = new Set();
    const rows = data.filter((a) => { const k = a.cluster_id ? "c" + a.cluster_id : "a" + a.id; if (seenEv.has(k)) return false; seenEv.add(k); return true; }).slice(0, 12);
    data.splice(0, data.length, ...rows);
    if (!data.length) { tickerTrack.replaceChildren(h("div", { class: "ticker-empty" }, L("لا أخبار عاجلة في هذه اللحظة", "No breaking news right now"))); return; }
    const group = () => h("span", { class: "ticker-group" }, data.map((a, i) => [
      i ? h("span", { class: "sep", "aria-hidden": "true" }) : null,
      h("a", { href: `article.html?id=${a.id}`, dir: titleDir(a) }, titleOf(a), h("span", { class: "t-time" }, time(a.published_at))),
    ]));
    const g2 = group(); g2.setAttribute("aria-hidden", "true"); g2.querySelectorAll("a").forEach((x) => x.setAttribute("tabindex", "-1"));
    const move = h("div", { class: "ticker-move" }, group(), g2);
    const chars = data.reduce((n, a) => n + titleOf(a).length, 0);
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
