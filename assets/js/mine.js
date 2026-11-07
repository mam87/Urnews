// «لحظتي» (mine.html): a personal page kept only in this browser — a "For you" feed from followed countries and
// sections, saved stories, and follow management. No registration; nothing is sent to the server except the
// public queries needed to show the stories.
import { sb, h, configured, ARTICLE_COLS, CATEGORIES, CAT_NAME, loadSources, friendlyError, toast, date } from "./common.js";
import { renderChrome } from "./layout.js";
import { EN, L, langFilter, countryName, flag, allCountries } from "./i18n.js";
import { card } from "./cards.js";
import { storyHref } from "./stories.js";
import { savedList, removeSaved, clearSaved, follows, toggleFollow } from "./saved.js";

const chrome = renderChrome({ active: "mine" });
const root = document.getElementById("app");
document.title = L("لحظتي — لحظة", "My Lahza — Lahza");
const TABS = [["foryou", L("لك", "For you")], ["saved", L("المحفوظات", "Saved")], ["follow", L("ما أتابعه", "Following")]];
let tab = TABS.some(([k]) => k === new URLSearchParams(location.search).get("tab")) ? new URLSearchParams(location.search).get("tab") : "foryou";
const tabsEl = h("nav", { class: "sp-tabs sub", "aria-label": L("أقسام الصفحة", "Page sections") });
const body = h("div", {});
root.replaceChildren(
  h("div", { class: "section-head" }, h("h1", { class: "map-h1" }, L("لحظتي", "My Lahza")),
    h("span", { class: "meta" }, L("محفوظة على هذا الجهاز فقط، دون تسجيل", "Kept on this device only, no sign-up"))),
  tabsEl, body);

function drawTabs() {
  tabsEl.replaceChildren(...TABS.map(([k, t]) => h("button", { type: "button", "aria-pressed": String(k === tab), onclick: () => { tab = k; const u = new URL(location.href); u.searchParams.set("tab", k); history.replaceState(null, "", u); show(); } },
    t, k === "saved" ? h("span", { class: "count num" }, " ", savedList().length) : null)));
}

async function forYou() {
  const f = follows();
  if (!f.countries.length && !f.cats.length) {
    body.replaceChildren(h("div", { class: "state" }, h("h3", {}, L("لم تتابع شيئاً بعد", "You don't follow anything yet")),
      h("p", {}, L("تابِع دولاً أو أقساماً لتظهر أخبارها هنا.", "Follow countries or sections to see their news here.")),
      h("button", { class: "btn btn-primary", type: "button", onclick: () => { tab = "follow"; show(); } }, L("اختر ما تتابعه", "Choose what to follow"))));
    return;
  }
  body.replaceChildren(h("p", { class: "note" }, L("آخر الأخبار من: ", "Latest from: "),
    [...f.countries.map((c) => `${flag(c)} ${countryName(c)}`), ...f.cats.map((c) => CAT_NAME[c] || c)].join(L("، ", ", "))),
    h("ul", { class: "skeleton", "aria-hidden": "true" }, h("li"), h("li"), h("li")));
  const ors = [f.countries.length ? `countries.ov.{${f.countries.join(",")}}` : null, f.cats.length ? `category.in.(${f.cats.join(",")})` : null].filter(Boolean).join(",");
  try {
    const [{ data, error }, srcs] = await Promise.all([
      langFilter(sb.from("news_articles").select(ARTICLE_COLS).eq("status", "published").is("duplicate_of", null).or(ors))
        .order("published_at", { ascending: false }).limit(40),
      loadSources()]);
    if (error) throw error;
    const seen = new Set();
    const rows = data.filter((a) => { const k = a.cluster_id ? "c" + a.cluster_id : "a" + a.id; if (seen.has(k)) return false; seen.add(k); return true; });
    body.querySelector(".skeleton").replaceWith(rows.length ? h("ul", { class: "feed" }, rows.map((a) => card(a, srcs.get(a.source_id))))
      : h("div", { class: "state" }, L("لا أخبار جديدة مما تتابعه الآن.", "Nothing new from what you follow right now.")));
    chrome.setLiveState("polling", new Date());
  } catch (e) { body.querySelector(".skeleton")?.replaceWith(h("div", { class: "state" }, friendlyError(e))); }
}

async function saved() {
  const list = savedList();
  if (!list.length) {
    body.replaceChildren(h("div", { class: "state" }, h("h3", {}, L("لا محفوظات بعد", "Nothing saved yet")),
      h("p", {}, L("اضغط «حفظ» في صفحة أي خبر أو تقرير لتجده هنا لاحقاً.", "Tap “Save” on any story or report to find it here later."))));
    return;
  }
  body.replaceChildren(h("ul", { class: "skeleton", "aria-hidden": "true" }, h("li"), h("li")));
  const ids = list.filter((x) => x.kind === "article").map((x) => x.id);
  let found = new Map(), srcs = new Map();
  try {
    if (ids.length) {
      const [{ data, error }, s] = await Promise.all([sb.from("news_articles").select(ARTICLE_COLS).in("id", ids.slice(0, 150)).eq("status", "published"), loadSources()]);
      if (error) throw error;
      found = new Map(data.map((a) => [a.id, a])); srcs = s;
    }
  } catch (e) { toast(friendlyError(e)); }
  const remove = (x) => h("button", { class: "btn btn-sm", type: "button", "aria-label": L("إزالة من المحفوظات", "Remove from saved"), onclick: () => { removeSaved(x.kind, x.id); drawTabs(); saved(); } }, L("إزالة", "Remove"));
  const rows = list.map((x) => {
    if (x.kind === "article" && found.has(x.id)) { const li = card(found.get(x.id), srcs.get(found.get(x.id).source_id)); li.append(h("div", { class: "saved-tools" }, remove(x))); return li; }
    return h("li", { class: "card saved-plain" }, h("div", {}),
      h("div", {}, h("h3", {}, h("a", { href: x.kind === "story" ? storyHref(x.id) : `article.html?id=${x.id}` }, x.title || L("خبر محفوظ", "Saved story"))),
        h("p", { class: "note" }, x.kind === "story" ? L("تقرير كامل", "Full report") : L("قد لا يعود هذا الخبر متاحاً (نحتفظ بالأخبار 30 يوماً).", "This story may no longer be available (stories are kept for 30 days)."),
          " · ", L("حُفظ ", "Saved "), date(x.at)),
        h("div", { class: "saved-tools" }, remove(x))));
  });
  body.replaceChildren(h("ul", { class: "feed" }, rows),
    h("div", { class: "toolbar", style: "margin-top:14px" }, h("button", { class: "btn btn-danger", type: "button", onclick: () => { if (confirm(L("حذف كل المحفوظات من هذا الجهاز؟", "Delete all saved items on this device?"))) { clearSaved(); drawTabs(); saved(); } } }, L("حذف الكل", "Delete all"))));
}

function manage() {
  const f = follows();
  const chipFor = (type, v, label) => h("button", { class: "chip follow-chip", type: "button", "aria-label": L("إلغاء متابعة ", "Unfollow ") + label, onclick: () => { toggleFollow(type, v); manage(); } }, label, " ✕");
  const csel = h("select", { "aria-label": L("اختر دولة", "Choose a country") }, h("option", { value: "" }, L("— أضف دولة —", "— Add a country —")),
    allCountries().filter((c) => !f.countries.includes(c)).map((c) => h("option", { value: c }, `${flag(c)} ${countryName(c)}`)));
  csel.addEventListener("change", () => { if (csel.value) { toggleFollow("countries", csel.value); toast(L("أُضيف إلى متابعاتك", "Added")); manage(); } });
  body.replaceChildren(
    h("section", { class: "map-panel", style: "margin-bottom:14px" }, h("h2", {}, L("الدول", "Countries")),
      h("div", { class: "follow-chips" }, f.countries.length ? f.countries.map((c) => chipFor("countries", c, `${flag(c)} ${countryName(c)}`)) : h("span", { class: "note" }, L("لا دول بعد.", "None yet."))),
      h("div", { class: "toolbar", style: "margin-top:10px" }, csel)),
    h("section", { class: "map-panel" }, h("h2", {}, L("الأقسام", "Sections")),
      h("div", { class: "follow-chips" }, CATEGORIES.map(([slug, name]) => h("button", { type: "button", class: "chip follow-chip", "aria-pressed": String(f.cats.includes(slug)),
        onclick: () => { toggleFollow("cats", slug); manage(); } }, f.cats.includes(slug) ? "✓ " : "+ ", name)))),
    h("p", { class: "note" }, L("يمكنك أيضاً المتابعة من صفحة أي دولة أو قسم، ومن خريطة الأخبار.", "You can also follow from any country or section page, and from the news map.")));
}

function show() { drawTabs(); if (!configured) return; ({ foryou: forYou, saved, follow: manage })[tab](); }
show();
chrome.refreshTicker().catch(() => {});
