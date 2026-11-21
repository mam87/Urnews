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
  reels: () => svg('<rect x="6" y="2" width="12" height="20" rx="3"/><path d="m10 9 5 3-5 3z"/>'),
  trend: () => svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
  cloud: () => svg('<path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1 .5 8.5z"/>'),
  map: () => svg('<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  user: () => svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  grid: () => svg('<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>'),
  close: () => svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  ball: () => svg('<circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10z"/><path d="M12 7V3M16 10l4-1.5M14.5 14.5 17 18M9.5 14.5 7 18M8 10 4 8.5"/>'),
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

  // world clocks: the same moment in the big news capitals (updates every 30 s)
  const CLOCKS = [["Asia/Amman", L("عمّان", "Amman")], ["Europe/London", L("لندن", "London")], ["America/New_York", L("نيويورك", "New York")], ["Asia/Dubai", L("دبي", "Dubai")], ["Asia/Tokyo", L("طوكيو", "Tokyo")]];
  const clockEls = CLOCKS.map(([tz, name]) => { const b = h("b", { class: "num" }); return { tz, b, el: h("span", { class: "wclock" }, name, " ", b) }; });
  const drawClocks = () => clockEls.forEach(({ tz, b }) => { b.textContent = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); });
  drawClocks(); setInterval(drawClocks, 30_000);
  const strip = h("div", { class: "topstrip" },
    h("div", { class: "wrap" },
      h("span", { class: "today" }, todayLabel()),
      h("span", { class: "wclocks", "aria-label": L("الوقت الآن حول العالم", "Time now around the world") }, clockEls.map((c) => c.el)),
      h("span", { class: "push" },
        h("a", { href: "sources.html", class: "hide-sm" }, L("المصادر", "Sources")),
        h("button", { type: "button", class: "linklike", lang: EN ? "ar" : "en", onclick: () => setLang(EN ? "ar" : "en") }, EN ? "العربية" : "English"),
        h("button", { type: "button", class: "linklike", onclick: settingsDialog }, L("حجم الخط والإعدادات", "Text size & settings")))));

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

  // Pages of the platform (first row on wide screens) and news sections (second row); one scrolling row on phones.
  const PAGES = [
    ["index.html", "home", L("الرئيسية", "Home"), ICONS.home, ""],
    ["intel.html", "intel", L("الذكاء العالمي", "Global intelligence"), ICONS.pulse, "intel-link"],
    ["breaking.html", "breaking", L("عاجل عالمي", "Global breaking"), ICONS.bolt, "breaking-link"],
    ["trends.html", "trends", L("ترند الآن", "Trending"), ICONS.trend, "trend-link"],
    ["sports.html", "sports", L("المركز الرياضي", "Sports Centre"), ICONS.ball, "sports-link"],
    ["reels.html", "reels", L("ريلز", "Reels"), ICONS.reels, "reels-link"],
    ["weather.html", "weather", L("الطقس", "Weather"), ICONS.cloud, ""],
    ["live.html", "live", L("بث مباشر", "Live TV"), ICONS.tv, "live-link"],
    ["map.html", "map", L("خريطة العالم", "World map"), ICONS.map, ""],
    ["mine.html", "mine", L("لحظتي", "My Lahza"), ICONS.user, ""],
  ];
  const isCur = (key) => (key === "home" ? active === "home" && !cat && !q : active === key);
  const catLink = ([slug, name]) => h("a", { href: `index.html?cat=${slug}`, "aria-current": cat === slug ? "page" : null, dataset: { cat: slug } },
    h("span", { class: "dot", style: `background:var(--c-${slug})`, "aria-hidden": "true" }), name);
  const nav = h("nav", { class: "catnav", "aria-label": L("الأقسام", "Sections") },
    h("div", { class: "wrap nav-pages" }, PAGES.map(([href, key, label, icon, cls]) =>
      h("a", { href, class: cls || null, "aria-current": isCur(key) ? "page" : null }, icon(), label))),
    h("div", { class: "wrap nav-cats" }, CATEGORIES.map(catLink)));

  const footer = h("footer", { class: "site" },
    h("div", { class: "wrap" },
      h("div", { class: "cols" },
        h("div", {},
          h("div", { class: "brand" }, h("span", { class: "mark" }, ICONS.pulse()), L("لحظة", "Lahza")),
          h("p", { style: "margin:0" }, L("منصة أخبار عالمية: تجمع العناوين آلياً على مدار الساعة من الخلاصات الرسمية لمصادر موثوقة من كل مناطق العالم، وترتّب الأحداث حسب أهميتها العالمية، وتعرض عنواناً ومقتطفاً مع رابط واضح للخبر الكامل لدى مصدره. حقوق المحتوى محفوظة لأصحابها.", "A global news platform: headlines are collected automatically, around the clock, from the official feeds of trusted publishers in every region, ranked by global importance, and shown as a headline and short excerpt with a clear link to the full story at its source. All content rights belong to their owners."))),
        h("div", {}, h("h4", {}, L("الأقسام", "Sections")),
          h("ul", { class: "two" }, CATEGORIES.map(([slug, name]) => h("li", {}, h("a", { href: `index.html?cat=${slug}` }, name))))),
        h("div", {}, h("h4", {}, L("المنصة", "Platform")),
          h("ul", {},
            h("li", {}, h("a", { href: "intel.html" }, L("مركز لحظة للذكاء العالمي", "Lahza Global Intelligence"))),
            h("li", {}, h("a", { href: "breaking.html" }, L("الأخبار العاجلة العالمية", "Global breaking news"))),
            h("li", {}, h("a", { href: "trends.html" }, L("ترند الآن حول العالم", "Trending worldwide"))),
            h("li", {}, h("a", { href: "sports.html" }, L("المركز الرياضي والنتائج المباشرة", "Sports centre & live scores"))),
            h("li", {}, h("a", { href: "reels.html" }, L("لحظة ريلز: فيديوهات قصيرة", "Lahza Reels: short videos"))),
            h("li", {}, h("a", { href: "weather.html" }, L("الطقس حسب مدينتك", "Weather for your city"))),
            h("li", {}, h("a", { href: "live.html" }, L("البث المباشر", "Live TV"))),
            h("li", {}, h("a", { href: "map.html" }, L("خريطة الأخبار العالمية", "World news map"))))),
        h("div", {}, h("h4", {}, L("الموقع", "Site")),
          h("ul", {},
            h("li", {}, h("a", { href: "mine.html" }, L("لحظتي: المحفوظات وما أتابعه", "My Lahza: saved & following"))),
            h("li", {}, h("a", { href: "sources.html" }, L("المصادر ومنهجية العمل", "Sources & methodology"))),
            h("li", {}, h("button", { type: "button", class: "linklike", onclick: settingsDialog }, L("إعدادات القراءة", "Reading settings"))),
            h("li", {}, h("button", { type: "button", class: "linklike", lang: EN ? "ar" : "en", onclick: () => setLang(EN ? "ar" : "en") }, EN ? "العربية" : "English")),
            h("li", {}, h("a", { href: "admin.html" }, L("دخول المحررين", "Editors")))))),
      h("div", { class: "legal" }, L("التصنيفات وعلامات التحقق وترتيب الأهمية آلية وقد تخطئ؛ «حسب المصدر» تعني أن الموقع لم يتحقق من الخبر بشكل مستقل. جميع الأوقات بتوقيت عمّان.", "Sections, verification labels and importance scores are automatic and can be wrong; “as reported” means we have not verified the story independently. All times are Amman time (UTC+3)."))));

  // "More" sheet (phones): every page and section in one place
  function moreSheet() {
    const d = h("dialog", { class: "more-sheet", "aria-label": L("كل الصفحات والأقسام", "All pages and sections") },
      h("div", { class: "ms-head" }, h("b", {}, L("تصفّح لحظة", "Browse Lahza")),
        h("button", { class: "icon-btn", type: "button", "aria-label": L("إغلاق", "Close"), onclick: () => d.close() }, ICONS.close())),
      h("div", { class: "ms-grid" }, PAGES.map(([href, key, label, icon, cls]) =>
        h("a", { href, class: cls || null, "aria-current": isCur(key) ? "page" : null }, icon(), h("span", {}, label)))),
      h("h4", {}, L("الأقسام", "Sections")),
      h("div", { class: "ms-cats" }, CATEGORIES.map(catLink)),
      h("div", { class: "ms-foot" },
        h("button", { class: "btn", type: "button", onclick: () => { d.close(); settingsDialog(); } }, ICONS.gear(), L("الإعدادات", "Settings")),
        h("button", { class: "btn", type: "button", lang: EN ? "ar" : "en", onclick: () => setLang(EN ? "ar" : "en") }, EN ? "العربية" : "English"),
        h("a", { class: "btn", href: "sources.html" }, L("المصادر", "Sources"))));
    d.addEventListener("close", () => d.remove());
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    document.body.append(d);
    d.showModal();
  }

  const bottombar = h("nav", { class: "bottombar", "aria-label": L("تنقل سريع", "Quick navigation") },
    h("a", { href: "index.html", "aria-current": isCur("home") ? "page" : null }, ICONS.home(), L("الرئيسية", "Home")),
    h("a", { href: "trends.html", "aria-current": isCur("trends") ? "page" : null }, ICONS.trend(), L("ترند", "Trending")),
    h("a", { href: "reels.html", class: "reels-ic" }, ICONS.reels(), L("ريلز", "Reels")),
    h("a", { href: "sports.html", "aria-current": isCur("sports") ? "page" : null }, ICONS.ball(), L("رياضة", "Sports")),
    h("button", { type: "button", "aria-haspopup": "dialog", onclick: moreSheet }, ICONS.grid(), L("المزيد", "More")));

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
