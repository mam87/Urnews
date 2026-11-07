// «لحظة ريلز» (reels.html): full-screen vertical feed of YouTube Shorts from verified news and sports publishers.
// Videos play in YouTube's official embedded player (youtube-nocookie.com), one at a time, only when on screen.
// Metadata comes from news_videos (filled every 10 min by the database scheduler from the publishers' public feeds).
// Every card names the publisher, shows when it was published and links to the video on YouTube.
import { sb, h, configured, ago, time, shortDate, isToday, initTheme } from "./common.js";
import { EN, L, setLang } from "./i18n.js";
import { ICONS } from "./layout.js";

initTheme();
document.title = L("لحظة ريلز — فيديوهات إخبارية ورياضية قصيرة", "Lahza Reels — short news & sports videos");
const root = document.getElementById("app");
const P = new URLSearchParams(location.search);
const PAGE = 15;
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

let kind = ["news", "sports"].includes(P.get("kind")) ? P.get("kind") : "all";
let lang = ["ar", "en"].includes(P.get("l")) ? P.get("l") : "all";
let channels = new Map();
let items = [];
let done = false, loading = false;
let soundOn = false;      // becomes true after the reader unmutes once (a user gesture)
let captionsOn = false;
let active = null;        // the card currently playing

const store = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } } };
soundOn = store.get("reels-sound") === "1";

// ---------- shell ----------
const feed = h("div", { class: "reels-feed", id: "reels-feed", tabindex: "-1", "aria-label": L("الفيديوهات", "Videos") });
const chip = (label, on, onclick) => h("button", { type: "button", class: "rchip", "aria-pressed": String(on), onclick }, label);
const filters = h("div", { class: "reels-filters" });
function drawFilters() {
  filters.replaceChildren(
    ...[["all", L("الكل", "All")], ["news", L("أخبار", "News")], ["sports", L("رياضة", "Sports")]].map(([k, t]) => chip(t, kind === k, () => { kind = k; reset(); })),
    h("span", { class: "rsep", "aria-hidden": "true" }),
    ...[["all", L("كل اللغات", "All languages")], ["ar", "عربي"], ["en", "English"]].map(([k, t]) => chip(t, lang === k, () => { lang = k; reset(); })));
}
const top = h("header", { class: "reels-top" },
  h("a", { class: "rbtn", href: "index.html", "aria-label": L("العودة إلى لحظة", "Back to Lahza") }, ICONS.home()),
  h("a", { class: "reels-brand", href: "reels.html" }, ICONS.pulse(), L("لحظة ريلز", "Lahza Reels")),
  h("button", { class: "rbtn lang", type: "button", lang: EN ? "ar" : "en", onclick: () => setLang(EN ? "ar" : "en"), "aria-label": L("Switch to English", "التبديل إلى العربية") }, EN ? "ع" : "EN"),
  filters);
root.replaceChildren(top, feed);
drawFilters();

// ---------- player (official embed, controlled with the documented postMessage commands) ----------
function embedSrc(id) {
  const q = new URLSearchParams({ autoplay: "1", mute: soundOn ? "0" : "1", playsinline: "1", loop: "1", playlist: id, rel: "0",
    modestbranding: "1", enablejsapi: "1", origin: location.origin, hl: EN ? "en" : "ar" });
  if (captionsOn) { q.set("cc_load_policy", "1"); q.set("cc_lang_pref", EN ? "en" : "ar"); }
  return `https://www.youtube-nocookie.com/embed/${id}?${q}`;
}
const cmd = (card, func) => card?.querySelector("iframe")?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");

function play(card) {
  if (active && active !== card) stop(active);
  active = card;
  const v = card._v;
  const stage = card.querySelector(".rstage");
  if (!stage.querySelector("iframe")) {
    stage.append(h("iframe", { src: embedSrc(v.video_id), title: v.title, allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true,
      referrerpolicy: "strict-origin-when-cross-origin", loading: "eager" }));
  }
  card.dataset.state = "playing";
  syncButtons(card);
}
function stop(card) {
  card.querySelector(".rstage iframe")?.remove(); // frees the player: only one stream at a time (saves data)
  card.dataset.state = "idle";
  syncButtons(card);
  if (active === card) active = null;
}
function togglePause(card) {
  if (card.dataset.state === "playing") { cmd(card, "pauseVideo"); card.dataset.state = "paused"; }
  else if (card.dataset.state === "paused") { cmd(card, "playVideo"); card.dataset.state = "playing"; }
  else play(card);
  syncButtons(card);
}
function toggleSound(card) {
  soundOn = !soundOn; store.set("reels-sound", soundOn ? "1" : "0");
  if (card.dataset.state === "idle") play(card); else cmd(card, soundOn ? "unMute" : "mute");
  document.querySelectorAll(".reel").forEach(syncButtons);
}
function toggleCaptions(card) {
  captionsOn = !captionsOn;
  card.querySelector(".rstage iframe")?.remove(); // captions are a player parameter: reload this video with them on/off
  play(card);
  document.querySelectorAll(".reel").forEach(syncButtons);
}
function syncButtons(card) {
  const st = card.dataset.state;
  const pp = card.querySelector(".act-play");
  if (pp) { pp.replaceChildren(st === "playing" ? ICONS.pause() : ICONS.play(), h("span", {}, st === "playing" ? L("إيقاف", "Pause") : L("تشغيل", "Play"))); pp.setAttribute("aria-label", st === "playing" ? L("إيقاف مؤقت", "Pause") : L("تشغيل", "Play")); }
  const snd = card.querySelector(".act-sound");
  if (snd) { snd.replaceChildren(h("b", { "aria-hidden": "true" }, soundOn ? "🔊" : "🔇"), h("span", {}, soundOn ? L("كتم", "Mute") : L("الصوت", "Sound"))); snd.setAttribute("aria-pressed", String(soundOn)); }
  const cc = card.querySelector(".act-cc");
  if (cc) cc.setAttribute("aria-pressed", String(captionsOn));
}

async function share(v) {
  const url = new URL("reels.html", location.href); url.searchParams.set("v", v.video_id);
  const data = { title: v.title, text: v.title + " — " + chName(v), url: url.toString() };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(data.url); flash(L("تم نسخ الرابط", "Link copied")); }
  } catch { /* cancelled */ }
}
function flash(msg) { const t = h("div", { class: "toast", role: "status" }, msg); document.body.append(t); setTimeout(() => t.remove(), 2200); }

// ---------- cards ----------
const chName = (v) => { const c = channels.get(v.channel_id); return c ? (EN ? c.name_en : c.name_ar) : ""; };
const when = (d) => (isToday(d) ? ago(d) : shortDate(d) + " · " + time(d));
const vdir = (v) => (v.language === "ar" ? "rtl" : "ltr");

function reel(v) {
  const watch = `https://www.youtube.com/shorts/${v.video_id}`;
  const cap = v.caption && v.caption !== v.title ? h("p", { class: "rcap", dir: vdir(v) }, v.caption) : null;
  const card = h("article", { class: "reel", dataset: { id: v.video_id, state: "idle" }, "aria-label": v.title },
    h("div", { class: "rstage" },
      v.thumbnail ? h("img", { class: "rposter", src: v.thumbnail, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" }) : null,
      h("button", { class: "rtap", type: "button", "aria-label": L("تشغيل الفيديو", "Play video"), onclick: () => togglePause(card) }, h("span", { class: "rplay" }, ICONS.play()))),
    h("div", { class: "rinfo" },
      h("div", { class: "rmeta" },
        h("span", { class: "rchan" }, chName(v)),
        h("span", { class: "rkind" }, v.kind === "sports" ? L("رياضة", "Sports") : L("أخبار", "News")),
        h("span", { class: "rtime num" }, when(v.published_at))),
      h("h2", { dir: vdir(v) }, v.title),
      cap,
      h("div", { class: "rlinks" },
        v.related_article_id ? h("a", { href: `article.html?id=${v.related_article_id}` }, L("الخبر ذو الصلة في لحظة ←", "Related story on Lahza →")) : null,
        h("a", { href: watch, target: "_blank", rel: "noopener" }, L("شاهد على يوتيوب ↗", "Watch on YouTube ↗"))),
      h("p", { class: "rnote" }, L("فيديو منشور على يوتيوب بواسطة ", "Video published on YouTube by "), chName(v), L("، ويُعرض بمشغّل يوتيوب الرسمي. الحقوق لأصحابها.", "; shown with YouTube's official player. All rights belong to the publisher."))),
    h("div", { class: "racts" },
      h("button", { class: "ract act-play", type: "button", onclick: () => togglePause(card) }),
      h("button", { class: "ract act-sound", type: "button", onclick: () => toggleSound(card) }),
      h("button", { class: "ract act-cc", type: "button", "aria-label": L("الترجمة المصاحبة", "Captions"), onclick: () => toggleCaptions(card) }, h("b", {}, "CC"), h("span", {}, L("ترجمة", "Captions"))),
      h("button", { class: "ract", type: "button", "aria-label": L("مشاركة", "Share"), onclick: () => share(v) }, ICONS.share(), h("span", {}, L("مشاركة", "Share")))));
  card._v = v;
  syncButtons(card);
  return card;
}

// ---------- data ----------
async function loadChannels() {
  const { data, error } = await sb.from("news_video_channels").select("channel_id,name_ar,name_en,kind,language");
  if (error) throw error;
  channels = new Map(data.map((c) => [c.channel_id, c]));
}
const COLS = "video_id,channel_id,title,caption,published_at,thumbnail,kind,language,related_article_id";
async function fetchPage() {
  let q = sb.from("news_videos").select(COLS).order("published_at", { ascending: false }).limit(PAGE);
  if (kind !== "all") q = q.eq("kind", kind);
  if (lang !== "all") q = q.eq("language", lang);
  const last = items[items.length - 1];
  if (last) q = q.lt("published_at", last.published_at);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

async function more() {
  if (loading || done) return;
  loading = true;
  feed.querySelector(".reels-more")?.remove();
  try {
    const rows = (await fetchPage()).filter((v) => !items.some((x) => x.video_id === v.video_id));
    if (rows.length < PAGE) done = true;
    items.push(...rows);
    rows.forEach((v) => { const c = reel(v); feed.append(c); io.observe(c); });
    if (!items.length) feed.append(h("div", { class: "reels-state" }, h("h3", {}, L("لا فيديوهات في هذا التصنيف الآن", "No videos in this filter right now")),
      h("p", {}, L("تُحدَّث القائمة تلقائياً كل 10 دقائق من قنوات الناشرين الرسمية.", "The list refreshes every 10 minutes from the publishers' official channels."))));
    else if (done) feed.append(h("div", { class: "reels-state end" }, L("وصلت إلى آخر الفيديوهات (آخر 14 يوماً).", "You've reached the end (last 14 days).")));
    else feed.append(h("div", { class: "reels-more", "aria-hidden": "true" }));
  } catch (e) {
    console.error(e);
    feed.append(h("div", { class: "reels-state" }, h("h3", {}, L("تعذّر تحميل الفيديوهات", "Could not load videos")),
      h("button", { class: "btn", type: "button", onclick: (ev) => { ev.target.closest(".reels-state").remove(); more(); } }, L("إعادة المحاولة", "Try again"))));
  } finally { loading = false; }
}

// play the card that is mostly on screen; load more near the end
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const card = e.target;
    if (e.isIntersecting && e.intersectionRatio >= 0.6) {
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches || active) play(card);
      if (items.length && card._v === items[items.length - 3] || card._v === items[items.length - 1]) more();
    } else if (card === active && e.intersectionRatio < 0.3) stop(card);
  }
}, { threshold: [0, 0.3, 0.6, 0.9] });

function reset() {
  drawFilters();
  if (active) stop(active);
  items = []; done = false;
  feed.replaceChildren();
  const u = new URL(location.href); u.searchParams.delete("v");
  kind === "all" ? u.searchParams.delete("kind") : u.searchParams.set("kind", kind);
  lang === "all" ? u.searchParams.delete("l") : u.searchParams.set("l", lang);
  history.replaceState(null, "", u);
  feed.scrollTo({ top: 0 });
  more();
}

// keyboard: ↑/↓ or j/k move between videos, space/k pauses, m toggles sound
addEventListener("keydown", (e) => {
  if (e.target.closest("input,textarea,select")) return;
  const cards = [...feed.querySelectorAll(".reel")];
  const i = active ? cards.indexOf(active) : -1;
  if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); cards[Math.min(i + 1, cards.length - 1)]?.scrollIntoView({ behavior: "smooth" }); }
  else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); cards[Math.max(i - 1, 0)]?.scrollIntoView({ behavior: "smooth" }); }
  else if (e.key === " " && active) { e.preventDefault(); togglePause(active); }
  else if (e.key === "m" && active) toggleSound(active);
});

async function boot() {
  if (!configured) { feed.append(h("div", { class: "reels-state" }, L("الموقع غير مهيأ.", "Site not configured."))); return; }
  try { await loadChannels(); } catch { feed.append(h("div", { class: "reels-state" }, h("h3", {}, L("تعذّر الاتصال بالخادم", "Could not reach the server")))); return; }
  // shared link: show that video first
  const first = P.get("v");
  if (first && ID_RE.test(first)) {
    const { data } = await sb.from("news_videos").select(COLS).eq("video_id", first).maybeSingle();
    if (data) { const c = reel(data); feed.append(c); io.observe(c); }
    else feed.append(h("div", { class: "reels-state" }, L("هذا الفيديو لم يعد متاحاً هنا (نحتفظ بآخر 14 يوماً).", "This video is no longer listed here (we keep the last 14 days).")));
  }
  await more();
  if (first) { items = items.filter((v) => v.video_id !== first); feed.querySelectorAll(`.reel[data-id="${first}"]`).forEach((c, i) => i && c.remove()); }
}
boot();
