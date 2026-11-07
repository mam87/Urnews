// Sports centre (sports.html): live scores and fixtures by day, competitions (table, scorers, assists, bracket),
// match centre (goals, cards, substitutions, half-time), team and player pages, each with related Lahza news.
// Data comes only from the provider via sports-data.js; nothing is simulated. Every view shows when the data was
// last fetched, marks delayed (cached) data, and carries the provider's attribution link.
import { sb, h, time, shortDate, date as longDate, ammanDay, configured, ARTICLE_COLS, loadSources } from "./common.js";
import { renderChrome } from "./layout.js";
import { EN, L, langFilter } from "./i18n.js";
import { card } from "./cards.js";
import { sports, ATTRIBUTION } from "./sports-data.js";
import { SPORTS, COMPETITIONS, COMP_BY_SLUG, COMP_BY_NAME, teamAr, teamAliases } from "./sports-names.js";

const chrome = renderChrome({ active: "sports" });
const root = document.getElementById("app");
const P = new URLSearchParams(location.search);
const SPORT = SPORTS.some(([s]) => s === P.get("sport")) ? P.get("sport") : "football";
const today = () => ammanDay(Date.now());
/** replaceChildren that skips empty slots (null/false would otherwise render as text). */
const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

// ---------- small helpers ----------
const tName = (n) => (EN ? n : teamAr(n) || n);
const sportMeta = (s) => SPORTS.find(([k]) => k === s) || SPORTS[0];
const compName = (nameOrSlug) => { const c = COMP_BY_SLUG[nameOrSlug] || COMP_BY_NAME[String(nameOrSlug || "").toLowerCase()]; return c ? (EN ? c[3] : c[2]) : nameOrSlug; };
const url = (o) => "sports.html?" + new URLSearchParams(Object.entries({ sport: SPORT, ...o }).filter(([, v]) => v !== null && v !== undefined && v !== "")).toString();
const logo = (src, cls = "lg") => src ? h("img", { class: cls, src, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", width: "24", height: "24", onerror: (e) => e.target.remove() }) : h("span", { class: cls + " lg-empty", "aria-hidden": "true" });
const shiftDay = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dayLabel = (d) => (d === today() ? L("اليوم", "Today") : d === shiftDay(today(), -1) ? L("أمس", "Yesterday") : d === shiftDay(today(), 1) ? L("غداً", "Tomorrow") : longDate(d + "T12:00:00+03:00"));
const clock = (t) => new Intl.DateTimeFormat(EN ? "en-GB" : "ar-JO-u-nu-latn", { timeZone: "Asia/Amman", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(t);

function attribution() {
  return h("p", { class: "sp-attrib" }, L("بيانات النتائج والجداول: ", "Scores & tables data: "),
    h("a", { href: ATTRIBUTION.href, target: "_blank", rel: "noopener", title: ATTRIBUTION.title }, ATTRIBUTION.label),
    L(" · قد تتأخر النتائج المباشرة قليلاً عن الملعب. الأوقات بتوقيت عمّان.", " · Live scores can lag slightly behind the stadium. Times are Amman time."));
}

/** "Updated hh:mm:ss" line; marks data served from cache after a failed refresh. */
function freshness(res) {
  if (!res) return h("div", { class: "sp-fresh" });
  if (!res.fetchedAt) return h("div", { class: "sp-fresh bad" }, L("تعذّر جلب البيانات من المزوّد الآن.", "Could not fetch data from the provider right now."));
  return h("div", { class: "sp-fresh" + (res.stale ? " warn" : "") },
    L("آخر تحديث ناجح: ", "Last successful update: "), h("b", { class: "num" }, clock(res.fetchedAt)),
    res.stale ? h("span", { class: "chip v-allegation" }, L("بيانات متأخرة — المزوّد لا يستجيب، نعرض آخر نسخة", "Delayed — provider not responding, showing last copy")) : null);
}

function errorState(res, retry) {
  const msg = res?.error === "not_found" ? L("لم نجد هذه الصفحة لدى مزوّد البيانات.", "The data provider has no such page.")
    : res?.error === "rate_limited" ? L("بلغنا حد الطلبات المسموح مؤقتاً. حاول بعد دقيقة.", "Request limit reached for now. Try again in a minute.")
    : L("مزوّد البيانات الرياضية لا يستجيب حالياً. لم نعرض أي نتيجة غير مؤكدة.", "The sports data provider is not responding. No unverified score is shown.");
  return h("div", { class: "state" }, h("h3", {}, L("البيانات غير متاحة", "Data unavailable")), h("p", {}, msg),
    retry ? h("button", { class: "btn", type: "button", onclick: retry }, L("إعادة المحاولة", "Try again")) : null);
}

// ---------- polling: refresh only while the tab is visible, at a rate that fits what is on screen ----------
let pollTimer = null, pollFn = null, pollEvery = 0;
function poll(fn, everyMs) {
  clearTimeout(pollTimer); pollFn = fn; pollEvery = everyMs;
  chrome.setLiveState(everyMs ? (everyMs <= 60e3 ? "live" : "polling") : "paused", new Date());
  if (everyMs) pollTimer = setTimeout(tick, everyMs);
}
function tick() { if (document.visibilityState === "visible" && pollFn) pollFn(true); else if (pollEvery) pollTimer = setTimeout(tick, pollEvery); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && pollFn && pollEvery) { clearTimeout(pollTimer); pollFn(true); } });

// ---------- match rows ----------
function statusCell(m) {
  if (m.status === "live") return h("span", { class: "st live" }, h("span", { class: "live-dot" }), m.minute != null ? `${m.minute}'` : (m.statusText || L("مباشر", "Live")));
  if (m.status === "finished") return h("span", { class: "st fin" }, L("انتهت", "FT"));
  if (m.status === "upcoming") return h("span", { class: "st up num" }, m.time ? time(m.time) : "—");
  return h("span", { class: "st" }, m.statusText || "—");
}
const score = (v) => (v === null || v === undefined ? "–" : String(v));

function matchRow(m) {
  const scored = m.homeScore !== null && m.awayScore !== null && m.status !== "upcoming";
  const win = scored ? (m.homeScore > m.awayScore ? "h" : m.awayScore > m.homeScore ? "a" : "") : "";
  const inner = [
    statusCell(m),
    h("span", { class: "tm home" + (win === "h" ? " win" : "") }, h("span", { class: "nm" }, tName(m.home)), logo(m.homeLogo)),
    h("span", { class: "sc num" + (m.status === "live" ? " live" : "") }, scored ? `${score(m.homeScore)} - ${score(m.awayScore)}` : L("ضد", "v")),
    h("span", { class: "tm away" + (win === "a" ? " win" : "") }, logo(m.awayLogo), h("span", { class: "nm" }, tName(m.away))),
  ];
  return m.slug ? h("a", { class: "mrow", href: url({ match: m.slug }) }, inner) : h("div", { class: "mrow" }, inner);
}

function groupByComp(list) {
  const groups = new Map();
  for (const m of list) { const k = m.competition || L("أخرى", "Other"); if (!groups.has(k)) groups.set(k, { name: k, logo: m.competitionLogo, items: [] }); groups.get(k).items.push(m); }
  const order = (g) => { const c = COMP_BY_NAME[g.name.toLowerCase()]; return c ? COMPETITIONS.indexOf(c) : 100; };
  return [...groups.values()].sort((a, b) => order(a) - order(b) || b.items.some((m) => m.status === "live") - a.items.some((m) => m.status === "live") || a.name.localeCompare(b.name));
}

function matchList(list) {
  return h("div", { class: "mlist" }, groupByComp(list).map((g) => {
    const c = COMP_BY_NAME[g.name.toLowerCase()];
    return h("section", { class: "mgroup" },
      h("h3", {}, logo(g.logo, "lg sm"), c ? h("a", { href: url({ comp: c[0] }) }, compName(c[0])) : g.name, h("span", { class: "count num" }, g.items.length)),
      g.items.sort((a, b) => (a.time || "").localeCompare(b.time || "")).map(matchRow));
  }));
}

/** Matches for one Amman calendar day: the provider's days are UTC, so two UTC days are merged and filtered. */
async function dayFixtures({ day, competition, force }) {
  const live = day === today();
  const [a, b] = await Promise.all([shiftDay(day, -1), day].map((d) => sports.fixtures({ sport: SPORT, date: d, competition, live, force })));
  if (!a.data && !b.data) return { data: null, fetchedAt: null, stale: false, error: b.error || a.error };
  const seen = new Set();
  const data = [...(a.data || []), ...(b.data || [])].filter((m) => m.time && ammanDay(m.time) === day && !seen.has(m.url || m.home + m.away + m.time) && seen.add(m.url || m.home + m.away + m.time));
  return { data, fetchedAt: Math.min(a.fetchedAt || Infinity, b.fetchedAt || Infinity), stale: a.stale || b.stale || !a.data || !b.data, error: a.error || b.error };
}

function dayNav(day, onPick) {
  const input = h("input", { type: "date", value: day, "aria-label": L("اختر يوماً", "Pick a day"), onchange: (e) => isDate(e.target.value) && onPick(e.target.value) });
  return h("div", { class: "sp-days" },
    h("button", { class: "btn", type: "button", onclick: () => onPick(shiftDay(day, -1)), "aria-label": L("اليوم السابق", "Previous day") }, EN ? "‹" : "›"),
    [-1, 0, 1].map((n) => { const d = shiftDay(today(), n); return h("button", { class: "btn", type: "button", "aria-pressed": String(d === day), onclick: () => onPick(d) }, dayLabel(d)); }),
    h("button", { class: "btn", type: "button", onclick: () => onPick(shiftDay(day, 1)), "aria-label": L("اليوم التالي", "Next day") }, EN ? "›" : "‹"),
    input);
}

// ---------- related Lahza news ----------
async function relatedNews(aliases, title = L("آخر الأخبار", "Latest news")) {
  const box = h("section", { class: "sp-news" }, h("div", { class: "section-head" }, h("h2", {}, title)));
  if (!configured) return box;
  // aliases null → the latest sports stories; otherwise stories whose headline names the team / player / competition
  const terms = aliases ? [...new Set(aliases)].filter(Boolean).slice(0, 6) : [];
  if (aliases && !terms.length) return box;
  let qb = langFilter(sb.from("news_articles").select(ARTICLE_COLS).eq("status", "published").is("duplicate_of", null).eq("category", "sports"));
  if (terms.length) qb = qb.or(terms.flatMap((a) => [`title.ilike.*${a}*`, `title_en.ilike.*${a}*`]).join(","));
  try {
    const [{ data, error }, srcs] = await Promise.all([
      qb.order("published_at", { ascending: false }).limit(8),
      loadSources()]);
    if (error) throw error;
    box.append(data.length ? h("ul", { class: "feed" }, data.map((a) => card(a, srcs.get(a.source_id))))
      : h("p", { class: "note" }, L("لا أخبار حديثة مرتبطة في مصادر لحظة الآن.", "No recent related stories in Lahza's sources.")));
  } catch { box.append(h("p", { class: "note" }, L("تعذّر تحميل الأخبار المرتبطة.", "Could not load related news."))); }
  return box;
}

// ---------- header / navigation ----------
function header(sub) {
  const form = h("form", { class: "sp-search", role: "search", action: "sports.html" },
    h("input", { type: "hidden", name: "sport", value: SPORT }),
    h("label", { class: "sr-only", for: "spq" }, L("ابحث عن فريق أو لاعب أو بطولة", "Search a team, player or competition")),
    h("input", { id: "spq", name: "q", type: "search", minlength: "2", maxlength: "60", value: P.get("q") || "", placeholder: L("ابحث عن فريق أو لاعب أو بطولة…", "Team, player or competition…") }));
  return h("div", { class: "sp-head" },
    h("div", { class: "section-head" }, h("h1", {}, h("a", { href: url({}) }, L("المركز الرياضي", "Sports Centre"))), sub ? h("span", { class: "meta" }, sub) : null),
    h("nav", { class: "sp-tabs", "aria-label": L("الرياضات", "Sports") }, SPORTS.map(([s, ar, en, ic]) =>
      h("a", { href: "sports.html?sport=" + s, "aria-current": s === SPORT ? "page" : null }, ic, " ", EN ? en : ar))),
    SPORT === "football" ? h("nav", { class: "sp-chips", "aria-label": L("البطولات", "Competitions") }, COMPETITIONS.map((c) =>
      h("a", { href: url({ comp: c[0] }), "aria-current": P.get("comp") === c[0] ? "page" : null }, EN ? c[3] : c[2]))) : null,
    form);
}

// ---------- views ----------
async function viewDay() {
  let day = isDate(P.get("date")) ? P.get("date") : today();
  let mode = SPORT === "football" ? (P.get("all") === "1" ? "all" : "top") : "all";
  let liveOnly = false;
  const body = h("div", {});
  const fresh = h("div", {});
  const controls = h("div", { class: "sp-controls" });
  root.replaceChildren(header(L("نتائج ومباريات مباشرة", "Live scores & fixtures")), controls, fresh, body, attribution());
  document.title = L("المركز الرياضي — لحظة", "Sports Centre — Lahza");

  const drawControls = () => controls.replaceChildren(
    dayNav(day, (d) => { day = d; history.replaceState(null, "", url({ date: d === today() ? null : d, all: mode === "all" && SPORT === "football" ? 1 : null })); drawControls(); load(); }),
    h("div", { class: "sp-filters" },
      SPORT === "football" ? h("div", { class: "seg", role: "group" },
        [["top", L("البطولات الكبرى", "Major competitions")], ["all", L("كل المباريات", "All matches")]].map(([v, t]) =>
          h("button", { type: "button", "aria-pressed": String(mode === v), onclick: () => { mode = v; drawControls(); load(); } }, t))) : null,
      h("button", { class: "btn", type: "button", "aria-pressed": String(liveOnly), onclick: () => { liveOnly = !liveOnly; drawControls(); load(); } }, h("span", { class: "live-dot" }), L("المباشر فقط", "Live only"))));
  drawControls();

  async function load(force = false) {
    if (!force) put(body, h("ul", { class: "skeleton", "aria-hidden": "true" }, h("li"), h("li"), h("li")));
    const res = await dayFixtures({ day, force });
    fresh.replaceChildren(freshness(res));
    if (!res.data) { put(body, errorState(res, () => load(true))); poll(load, day === today() ? 120e3 : 0); return; }
    let list = res.data;
    if (mode === "top") list = list.filter((m) => COMP_BY_NAME[(m.competition || "").toLowerCase()]);
    if (liveOnly) list = list.filter((m) => m.status === "live");
    const live = res.data.some((m) => m.status === "live");
    if (!list.length) {
      put(body, h("div", { class: "state" },
        h("h3", {}, liveOnly ? L("لا مباريات مباشرة الآن", "No live matches right now") : L("لا مباريات في هذا اليوم", "No matches on this day")),
        mode === "top" && res.data.length ? h("button", { class: "btn", type: "button", onclick: () => { mode = "all"; drawControls(); load(); } }, L(`عرض كل المباريات (${res.data.length})`, `Show all matches (${res.data.length})`)) : null));
    } else put(body, matchList(list));
    // live matches: every 30 s; today otherwise every 5 min; other days: no polling
    poll(load, day !== today() ? 0 : live ? 30e3 : 300e3);
  }
  await load();
  body.after(await relatedNews(null, L("آخر الأخبار الرياضية", "Latest sports news")));
}

async function viewComp(slug) {
  const c = COMP_BY_SLUG[slug];
  const name = c ? compName(slug) : slug;
  document.title = name + L(" — لحظة", " — Lahza");
  let tab = P.get("tab") || (c && !c[4] && c[5] ? "bracket" : "matches");
  let day = isDate(P.get("date")) ? P.get("date") : today();
  const tabs = h("nav", { class: "sp-tabs sub", "aria-label": name });
  const fresh = h("div", {});
  const body = h("div", {});
  root.replaceChildren(header(name), tabs, fresh, body, attribution());

  const TABS = [["matches", L("المباريات", "Matches")], ...(c?.[4] !== false ? [["table", L("الترتيب", "Table")], ["scorers", L("الهدافون", "Top scorers")], ["assists", L("صناعة الأهداف", "Assists")]] : []), ...(c?.[5] ? [["bracket", L("الأدوار الإقصائية", "Bracket")]] : [])];
  const drawTabs = () => tabs.replaceChildren(...TABS.map(([k, t]) => h("button", { type: "button", "aria-pressed": String(k === tab), onclick: () => { tab = k; history.replaceState(null, "", url({ comp: slug, tab: k })); drawTabs(); load(); } }, t)));
  drawTabs();

  async function findDay(dir) {
    put(body, h("p", { class: "note" }, L("نبحث عن أقرب يوم مباريات…", "Looking for the nearest match day…")));
    for (let i = 1; i <= 10; i++) { const d = shiftDay(day, dir * i); const r = await dayFixtures({ day: d, competition: slug }); if (r.data?.length) { day = d; return load(); } if (!r.data) break; }
    put(body, h("div", { class: "state" }, L("لم نجد مباريات خلال الأيام العشرة.", "No matches found within ten days.")));
  }

  async function load(force = false) {
    poll(null, 0);
    if (!force) put(body, h("ul", { class: "skeleton", "aria-hidden": "true" }, h("li"), h("li")));
    if (tab === "matches") {
      const res = await dayFixtures({ day, competition: slug, force });
      fresh.replaceChildren(freshness(res));
      if (!res.data) return put(body, errorState(res, () => load(true)));
      put(body, dayNav(day, (d) => { day = d; load(); }),
        res.data.length ? matchList(res.data) : h("div", { class: "state" }, h("h3", {}, L("لا مباريات في هذا اليوم", "No matches on this day")),
          h("div", { class: "toolbar", style: "justify-content:center" },
            h("button", { class: "btn", type: "button", onclick: () => findDay(-1) }, L("آخر يوم مباريات", "Previous match day")),
            h("button", { class: "btn btn-primary", type: "button", onclick: () => findDay(1) }, L("أقرب يوم مباريات قادم", "Next match day")))));
      const live = res.data.some((m) => m.status === "live");
      poll(load, day !== today() ? 0 : live ? 30e3 : 300e3);
      return;
    }
    if (tab === "table") {
      const res = await sports.standings({ sport: SPORT, slug });
      fresh.replaceChildren(freshness(res));
      if (!res.data) return put(body, errorState(res, () => load(true)));
      return put(body, ...(res.data.tables || []).map(standingsTable));
    }
    if (tab === "scorers" || tab === "assists") {
      const res = await sports.scorers({ sport: SPORT, slug, stat: tab === "assists" ? "assists" : "goals" });
      fresh.replaceChildren(freshness(res));
      if (!res.data) return put(body, errorState(res, () => load(true)));
      return put(body, scorersTable(res.data.scorers || [], tab));
    }
    if (tab === "bracket") {
      const res = await sports.bracket({ sport: SPORT, slug });
      fresh.replaceChildren(freshness(res));
      if (!res.data) return put(body, errorState(res, () => load(true)));
      return put(body, bracketView(res.data));
    }
  }
  await load();
  if (c) body.after(await relatedNews([c[2], c[3], c[1]]));
}

function standingsTable(t) {
  const rows = t.rows || [];
  const promos = new Map(rows.filter((r) => r.promo_name).map((r) => [r.promo_name, r.promo_color]));
  return h("div", { class: "sp-table" },
    t.group ? h("h3", {}, t.group) : null,
    h("div", { class: "table-wrap" }, h("table", { class: "standings" },
      h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, L("الفريق", "Team")), h("th", {}, L("لعب", "P")), h("th", { class: "sp-opt" }, L("فاز", "W")), h("th", { class: "sp-opt" }, L("تعادل", "D")), h("th", { class: "sp-opt" }, L("خسر", "L")), h("th", { class: "sp-opt" }, L("الأهداف", "Goals")), h("th", {}, L("الفارق", "GD")), h("th", {}, L("النقاط", "Pts")))),
      h("tbody", {}, rows.map((r) => h("tr", {},
        h("td", { class: "num", style: /^#[0-9a-f]{3,8}$/i.test(r.promo_color || "") ? `border-inline-start: 4px solid ${r.promo_color}` : "" }, r.pos),
        h("td", {}, h("a", { class: "tcell", href: url({ team: r.team_slug }) }, logo(r.team_logo), tName(r.team))),
        h("td", { class: "num" }, r.p), h("td", { class: "num sp-opt" }, r.w), h("td", { class: "num sp-opt" }, r.d), h("td", { class: "num sp-opt" }, r.l),
        h("td", { class: "num sp-opt", dir: "ltr" }, `${r.gf}:${r.ga}`), h("td", { class: "num", dir: "ltr" }, r.gd > 0 ? "+" + r.gd : r.gd), h("td", { class: "num pts" }, r.pts)))))),
    promos.size ? h("ul", { class: "sp-legend" }, [...promos].map(([n, col]) => h("li", {}, h("span", { style: `background:${/^#[0-9a-f]{3,8}$/i.test(col) ? col : "transparent"}` }), n))) : null);
}

function scorersTable(list, tab) {
  if (!list.length) return h("div", { class: "state" }, L("لا بيانات بعد لهذه البطولة.", "No data yet for this competition."));
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, L("اللاعب", "Player")), h("th", { class: "sp-opt" }, L("الفريق", "Team")), h("th", {}, L("أهداف", "Goals")), h("th", {}, L("صناعة", "Assists")), h("th", { class: "sp-opt" }, L("مباريات", "Apps")))),
    h("tbody", {}, list.map((s) => h("tr", {},
      h("td", { class: "num" }, s.rank),
      h("td", {}, h("a", { class: "tcell", href: url({ player: s.player_slug }) }, logo(s.player_logo || s.team_logo), s.player)),
      h("td", { class: "sp-opt" }, h("a", { href: url({ team: s.team_slug }) }, tName(s.team))),
      h("td", { class: "num" + (tab !== "assists" ? " pts" : "") }, s.goals), h("td", { class: "num" + (tab === "assists" ? " pts" : "") }, s.assists), h("td", { class: "num sp-opt" }, s.matches))))));
}

function bracketView(b) {
  const rounds = b.rounds || [];
  if (!rounds.length) return h("div", { class: "state" }, L("لا أدوار إقصائية منشورة بعد.", "No knockout rounds published yet."));
  return h("div", { class: "sp-bracket" }, rounds.map((r) => h("section", { class: "mgroup" }, h("h3", {}, r.name),
    (r.matchups || []).map((m) => matchRow({ home: m.home, away: m.away, homeLogo: m.home_logo, awayLogo: m.away_logo, homeScore: m.home_score ?? null, awayScore: m.away_score ?? null, status: m.home_score != null ? "finished" : "upcoming", statusText: m.status || "", time: null, slug: null })))));
}

const INCIDENT = (t = "") => {
  const s = t.toLowerCase();
  if (s.includes("own goal")) return ["⚽", L("هدف عكسي", "Own goal")];
  if (s.includes("penalty") && s.includes("miss")) return ["❌", L("ركلة جزاء ضائعة", "Missed penalty")];
  if (s.includes("penalty")) return ["⚽", L("هدف من ركلة جزاء", "Penalty goal")];
  if (s.includes("goal")) return ["⚽", L("هدف", "Goal")];
  if (s.includes("second yellow") || s.includes("yellow red")) return ["🟨🟥", L("إنذار ثانٍ وطرد", "Second yellow")];
  if (s.includes("red")) return ["🟥", L("بطاقة حمراء", "Red card")];
  if (s.includes("yellow")) return ["🟨", L("بطاقة صفراء", "Yellow card")];
  if (s.includes("sub")) return ["🔁", L("تبديل", "Substitution")];
  if (s.includes("var")) return ["📺", "VAR"];
  return ["•", t];
};

async function viewMatch(slug) {
  const fresh = h("div", {});
  const body = h("div", {}, h("ul", { class: "skeleton", "aria-hidden": "true" }, h("li"), h("li")));
  root.replaceChildren(header(), fresh, body, attribution());
  let newsShown = false;

  async function load(force = false) {
    const res = await sports.match({ sport: SPORT, slug, live: true, force });
    fresh.replaceChildren(freshness(res));
    if (!res.data) { put(body, errorState(res, () => load(true))); return poll(null, 0); }
    const m = res.data;
    document.title = `${tName(m.home)} ${score(m.homeScore)}-${score(m.awayScore)} ${tName(m.away)} — ${L("لحظة", "Lahza")}`;
    const c = COMP_BY_NAME[(m.competition || "").toLowerCase()];
    const board = h("section", { class: "scoreboard" + (m.status === "live" ? " is-live" : "") },
      h("div", { class: "sb-comp" }, logo(m.competitionLogo, "lg sm"), c ? h("a", { href: url({ comp: c[0] }) }, compName(c[0])) : m.competition,
        m.time ? h("span", { class: "num" }, " · ", longDate(m.time), " · ", time(m.time)) : null),
      h("div", { class: "sb-main" },
        h("div", { class: "sb-team" }, logo(m.homeLogo, "lg xl"), h("b", {}, tName(m.home))),
        h("div", { class: "sb-score" },
          h("div", { class: "num big" }, m.status === "upcoming" ? (m.time ? time(m.time) : "—") : `${score(m.homeScore)} - ${score(m.awayScore)}`),
          statusCell(m),
          m.htHome !== null && m.htAway !== null && m.status !== "upcoming" ? h("div", { class: "sb-ht num" }, L("الشوط الأول: ", "Half-time: "), `${m.htHome} - ${m.htAway}`) : null),
        h("div", { class: "sb-team" }, logo(m.awayLogo, "lg xl"), h("b", {}, tName(m.away)))));

    const inc = [...m.incidents].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    const timeline = inc.length ? h("section", { class: "incidents" }, h("div", { class: "section-head" }, h("h2", {}, L("مجريات المباراة", "Match events"))),
      h("ol", {}, inc.map((x) => { const [ic, label] = INCIDENT(x.type); return h("li", { class: "side-" + (x.side === "away" ? "away" : "home") },
        h("span", { class: "min num" }, x.time != null ? `${x.time}'` : ""), h("span", { class: "ic", "aria-hidden": "true" }, ic),
        h("span", {}, h("b", {}, label), x.player ? " — " + x.player : "", " ", h("span", { class: "sub" }, "(", tName(x.side === "away" ? m.away : m.home), ")"),
          x.is_goal && x.home_score != null ? h("span", { class: "num gscore" }, ` ${x.home_score}-${x.away_score}`) : null)); })))
      : h("p", { class: "note" }, m.status === "upcoming" ? L("لم تبدأ المباراة بعد.", "The match has not started yet.") : L("لا تفاصيل أحداث متاحة لهذه المباراة من المزوّد.", "The provider has no event details for this match."));

    const statRows = m.stats.filter((s) => s && (s.home !== undefined || s.away !== undefined));
    const stats = statRows.length ? h("section", {}, h("div", { class: "section-head" }, h("h2", {}, L("إحصاءات", "Statistics"))),
      h("div", { class: "table-wrap" }, h("table", {}, h("tbody", {}, statRows.map((s) => h("tr", {}, h("td", { class: "num" }, s.home ?? "–"), h("th", { style: "text-align:center" }, s.name || s.type || s.label || ""), h("td", { class: "num", style: "text-align:end" }, s.away ?? "–"))))))) : null;

    put(body, board, timeline, stats,
      m.url ? h("p", { class: "note" }, h("a", { href: m.url, target: "_blank", rel: "noopener" }, L("صفحة المباراة لدى مزوّد البيانات ↗", "Match page at the data provider ↗"))) : null);
    if (!newsShown) { newsShown = true; body.after(await relatedNews([...teamAliases(m.home), ...teamAliases(m.away)])); }
    const soon = m.status === "upcoming" && m.time && new Date(m.time) - Date.now() < 20 * 60e3;
    poll(load, m.status === "live" ? 30e3 : soon ? 60e3 : 0);
  }
  await load();
}

function form(matches, teamName) {
  const fin = matches.filter((m) => m.status === "finished" && m.homeScore !== null).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 5);
  return fin.map((m) => { const home = m.home === teamName; const f = home ? m.homeScore - m.awayScore : m.awayScore - m.homeScore;
    const k = f > 0 ? "w" : f < 0 ? "l" : "d"; return h("span", { class: "form " + k, title: `${tName(m.home)} ${m.homeScore}-${m.awayScore} ${tName(m.away)}` }, { w: L("ف", "W"), d: L("ت", "D"), l: L("خ", "L") }[k]); });
}

async function viewTeam(slug) {
  const fresh = h("div", {});
  const body = h("div", {}, h("ul", { class: "skeleton", "aria-hidden": "true" }, h("li"), h("li")));
  root.replaceChildren(header(), fresh, body, attribution());
  const res = await sports.team({ sport: SPORT, slug });
  fresh.replaceChildren(freshness(res));
  if (!res.data) return put(body, errorState(res, () => location.reload()));
  const { team, matches } = res.data;
  document.title = tName(team.name) + L(" — لحظة", " — Lahza");
  const live = matches.filter((m) => m.status === "live");
  const past = matches.filter((m) => m.status === "finished").sort((a, b) => b.time.localeCompare(a.time)).slice(0, 10);
  const next = matches.filter((m) => m.status === "upcoming").sort((a, b) => a.time.localeCompare(b.time)).slice(0, 6);
  const dated = (m) => h("div", { class: "dated" }, h("span", { class: "d num" }, shortDate(m.time)), matchRow(m));
  put(body, 
    h("section", { class: "sp-profile" }, logo(team.logo, "lg xl"), h("div", {}, h("h2", {}, tName(team.name)), EN || !teamAr(team.name) ? null : h("div", { class: "sub", dir: "ltr" }, team.name),
      past.length ? h("div", { class: "forms", "aria-label": L("آخر 5 نتائج", "Last 5 results") }, L("آخر النتائج: ", "Form: "), form(matches, team.name)) : null)),
    live.length ? h("section", { class: "mgroup" }, h("h3", {}, L("مباشر الآن", "Live now")), live.map(matchRow)) : null,
    h("section", { class: "mgroup" }, h("h3", {}, L("المباريات القادمة", "Upcoming fixtures")), next.length ? next.map(dated) : h("p", { class: "note" }, L("لا مباريات قادمة منشورة.", "No upcoming fixtures published."))),
    h("section", { class: "mgroup" }, h("h3", {}, L("آخر النتائج", "Recent results")), past.length ? past.map(dated) : h("p", { class: "note" }, L("لا نتائج سابقة.", "No previous results."))));
  if (live.length) poll(() => location.reload(), 60e3);
  body.after(await relatedNews(teamAliases(team.name), L("أخبار ", "News: ") + tName(team.name)));
}

async function viewPlayer(slug) {
  const fresh = h("div", {});
  const body = h("div", {}, h("ul", { class: "skeleton", "aria-hidden": "true" }, h("li")));
  root.replaceChildren(header(), fresh, body, attribution());
  const res = await sports.player({ sport: SPORT, slug });
  fresh.replaceChildren(freshness(res));
  if (!res.data) return put(body, errorState(res, () => location.reload()));
  const { player, stats = {} } = res.data;
  document.title = player.name + L(" — لحظة", " — Lahza");
  const F = [["matches", L("مباريات", "Apps")], ["goals", L("أهداف", "Goals")], ["assists", L("صناعة", "Assists")], ["minutes", L("دقائق", "Minutes")],
    ["shots", L("تسديدات", "Shots")], ["shots_on_target", L("على المرمى", "On target")], ["key_passes", L("تمريرات مفتاحية", "Key passes")], ["dribbles", L("مراوغات", "Dribbles")],
    ["passes_accuracy", L("دقة التمرير %", "Pass accuracy %")], ["tackles", L("افتكاك", "Tackles")], ["yellow_cards", L("صفراء", "Yellow")], ["red_cards", L("حمراء", "Red")]];
  put(body, 
    h("section", { class: "sp-profile" }, logo(player.logo, "lg xl"), h("div", {}, h("h2", { dir: "auto" }, player.name),
      stats.team ? h("div", { class: "sub" }, logo(stats.team_logo, "lg sm"), tName(stats.team)) : null)),
    stats.competition ? h("p", { class: "note" }, L("الإحصاءات المتاحة من المزوّد في: ", "Statistics available from the provider for: "), h("b", {}, compName(stats.competition))) : null,
    h("div", { class: "stats" }, F.filter(([k]) => stats[k] !== undefined && stats[k] !== null).map(([k, t]) => h("div", { class: "stat" }, h("div", { class: "v num" }, stats[k]), h("div", { class: "k" }, t)))));
  body.after(await relatedNews([player.name, player.name.split(" ").slice(-1)[0]].filter((s) => s && s.length >= 4), L("أخبار ", "News: ") + player.name));
}

async function viewSearch(q) {
  const fresh = h("div", {});
  const body = h("div", {}, h("ul", { class: "skeleton", "aria-hidden": "true" }, h("li")));
  root.replaceChildren(header(L("نتائج البحث", "Search results")), fresh, body, attribution());
  const res = await sports.search({ sport: SPORT, q });
  fresh.replaceChildren(freshness(res));
  if (!res.data) return put(body, errorState(res, () => location.reload()));
  const grp = (title, items, link) => items?.length ? h("section", { class: "mgroup" }, h("h3", {}, title), items.map((x) => h("a", { class: "mrow simple", href: link(x) }, logo(x.logo), h("span", {}, tName(x.name))))) : null;
  const known = COMPETITIONS.filter((c) => [c[1], c[2], c[3]].some((n) => n.toLowerCase().includes(q.toLowerCase())));
  const out = [
    known.length ? h("section", { class: "mgroup" }, h("h3", {}, L("بطولات نغطيها", "Competitions we cover")), known.map((c) => h("a", { class: "mrow simple", href: url({ comp: c[0] }) }, h("span", {}, EN ? c[3] : c[2])))) : null,
    grp(L("فرق", "Teams"), res.data.teams, (x) => url({ team: x.slug })),
    grp(L("بطولات", "Competitions"), res.data.competitions, (x) => url({ comp: x.slug })),
    grp(L("لاعبون", "Players"), res.data.players, (x) => url({ player: x.slug })),
  ].filter(Boolean);
  put(body, ...(out.length ? out : [h("div", { class: "state" }, L("لا نتائج. جرّب الاسم بالإنجليزية، مثل Barcelona.", "No results. Try another spelling."))]));
}

// ---------- route ----------
const clean = (s) => (s || "").replace(/[^a-z0-9-]/gi, "").slice(0, 120);
try {
  if (P.get("match")) await viewMatch(clean(P.get("match")));
  else if (P.get("team")) await viewTeam(clean(P.get("team")));
  else if (P.get("player")) await viewPlayer(clean(P.get("player")));
  else if (P.get("comp")) await viewComp(clean(P.get("comp")));
  else if ((P.get("q") || "").trim().length >= 2) await viewSearch(P.get("q").trim().slice(0, 60));
  else await viewDay();
} catch (e) {
  console.error(e);
  root.replaceChildren(errorState({ error: "unavailable" }, () => location.reload()));
}
chrome.refreshTicker().catch(() => {});
