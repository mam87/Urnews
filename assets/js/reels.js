// «لحظة ريلز» (reels.html): full-screen vertical feed of YouTube Shorts from verified news and sports publishers.
// Videos play in YouTube's official embedded player (youtube-nocookie.com), one at a time, only when on screen.
// Metadata comes from news_videos (filled every 10 min by the database scheduler from the publishers' public feeds).
// Every card names the publisher, shows when it was published and links to the video on YouTube.
//
// Interaction (2026-11-13) follows the short-video apps people already know: swipe / wheel / arrows move one video
// at a time, tap pauses and resumes, double-tap likes, press-and-hold pauses while held, a thin bar shows progress,
// actions sit in one rail, the caption expands in place. Likes are kept only in this browser.
import { sb, h, configured, ago, time, shortDate, isToday, initTheme } from "./common.js";
import { EN, L, setLang } from "./i18n.js";
import { ICONS } from "./layout.js";

initTheme();
document.title = L("لحظة ريلز — فيديوهات إخبارية ورياضية قصيرة", "Lahza Reels — short news & sports videos");
const root = document.getElementById("app");
const P = new URLSearchParams(location.search);
const PAGE = 15;
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_ORIGIN = "https://www.youtube-nocookie.com";

const local = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
const session = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } } };

let kind = ["news", "sports", "liked"].includes(P.get("kind")) ? P.get("kind") : "all";
// Language: the reader's explicit choice (URL or saved) wins. Otherwise the Arabic edition shows Arabic videos,
// except in Sports, where most official club and league channels publish in English.
let langChoice = ["ar", "en", "all"].includes(P.get("l")) ? P.get("l") : ["ar", "en", "all"].includes(local.get("lahza-reels-lang")) ? local.get("lahza-reels-lang") : null;
const lang = () => langChoice || (EN || kind === "sports" || kind === "liked" ? "all" : "ar");
let channels = new Map();
let items = [];
let done = false, loading = false;
let soundOn = session.get("reels-sound") === "1"; // becomes true after the reader unmutes once (a user gesture)
let captionsOn = false;
let active = null;        // the card currently playing
let liked = new Set();
try { liked = new Set(JSON.parse(local.get("lahza-reels-liked") || "[]").filter((x) => ID_RE.test(x)).slice(-300)); } catch { /* ignore */ }
const saveLiked = () => local.set("lahza-reels-liked", JSON.stringify([...liked].slice(-300)));

const svgIcon = (path, fill = false) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", fill ? "currentColor" : "none"); s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = path; // static, trusted icon markup only
  return s;
};
const IC = {
  heart: (on) => svgIcon('<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/>', on),
  soundOn: () => svgIcon('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  soundOff: () => svgIcon('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9.5 5 5M22 9.5l-5 5"/>'),
  more: () => svgIcon('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>', true),
  back: () => svgIcon(EN ? '<path d="m14 6-6 6 6 6"/>' : '<path d="m10 6 6 6-6 6"/>'),
  up: () => svgIcon('<path d="m6 14 6-6 6 6"/>'),
  down: () => svgIcon('<path d="m6 10 6 6 6-6"/>'),
  filter: () => svgIcon('<path d="M4 6h16M7 12h10M10 18h4"/>'),
};

// ---------- shell ----------
const feed = h("div", { class: "reels-feed", id: "reels-feed", tabindex: "-1", "aria-label": L("الفيديوهات", "Videos") });
const tabs = h("nav", { class: "reels-tabs", "aria-label": L("نوع الفيديوهات", "Video type") });
function drawTabs() {
  tabs.replaceChildren(...[["all", L("لك", "For you")], ["news", L("أخبار", "News")], ["sports", L("رياضة", "Sports")], ["liked", L("أعجبتني", "Liked")]].map(([k, t]) =>
    h("button", { type: "button", class: "rtab", "aria-pressed": String(kind === k), onclick: () => { if (kind !== k) { kind = k; reset(); } } }, t)));
}
function filterSheet() {
  const d = h("dialog", { class: "reels-sheet", "aria-label": L("خيارات العرض", "View options") },
    h("h3", {}, L("لغة الفيديوهات", "Video language")),
    h("div", { class: "rs-opts" }, [["auto", L("تلقائي (حسب لغة الموقع)", "Automatic (site language)")], ["ar", "العربية"], ["en", "English"], ["all", L("كل اللغات", "All languages")]].map(([k, t]) =>
      h("button", { type: "button", "aria-pressed": String((langChoice || "auto") === k), onclick: () => { langChoice = k === "auto" ? null : k; local.set("lahza-reels-lang", k === "auto" ? "" : k); d.close(); reset(); } }, t))),
    h("h3", {}, L("لغة الواجهة", "Interface language")),
    h("div", { class: "rs-opts" }, h("button", { type: "button", lang: EN ? "ar" : "en", onclick: () => setLang(EN ? "ar" : "en") }, EN ? "العربية" : "English")),
    h("p", { class: "rs-note" }, L("اضغط مرة للإيقاف والتشغيل، مرتين للإعجاب، واسحب للأعلى للفيديو التالي. على الحاسوب: الأسهم ↑ ↓، المسافة، M للصوت، L للإعجاب.", "Tap to pause or play, double-tap to like, swipe up for the next video. On a keyboard: ↑ ↓, space, M for sound, L to like.")),
    h("button", { class: "rs-close", type: "button", onclick: () => d.close() }, L("تم", "Done")));
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  document.body.append(d); d.showModal();
}
const top = h("header", { class: "reels-top" },
  h("a", { class: "rbtn", href: "index.html", "aria-label": L("العودة إلى لحظة", "Back to Lahza") }, IC.back()),
  tabs,
  h("button", { class: "rbtn", type: "button", "aria-label": L("خيارات العرض واللغة", "View and language options"), onclick: filterSheet }, IC.filter()));
const step = (dir) => { const cards = [...feed.querySelectorAll(".reel")]; const i = active ? cards.indexOf(active) : 0; cards[Math.min(Math.max(i + dir, 0), cards.length - 1)]?.scrollIntoView({ behavior: "smooth" }); };
const arrows = h("div", { class: "reels-arrows" },
  h("button", { class: "rbtn", type: "button", "aria-label": L("الفيديو السابق", "Previous video"), onclick: () => step(-1) }, IC.up()),
  h("button", { class: "rbtn", type: "button", "aria-label": L("الفيديو التالي", "Next video"), onclick: () => step(1) }, IC.down()));
root.replaceChildren(top, feed, arrows);
drawTabs();

// ---------- player (official embed, controlled with the documented postMessage commands) ----------
function embedSrc(id) {
  const q = new URLSearchParams({ autoplay: "1", mute: soundOn ? "0" : "1", playsinline: "1", loop: "1", playlist: id, rel: "0", controls: "0",
    modestbranding: "1", enablejsapi: "1", origin: location.origin, hl: EN ? "en" : "ar" });
  if (captionsOn) { q.set("cc_load_policy", "1"); q.set("cc_lang_pref", EN ? "en" : "ar"); }
  return `${YT_ORIGIN}/embed/${id}?${q}`;
}
const frameOf = (card) => card?.querySelector("iframe");
const post = (card, msg) => frameOf(card)?.contentWindow?.postMessage(JSON.stringify(msg), "*");
const cmd = (card, func) => post(card, { event: "command", func, args: [] });

function play(card) {
  if (active && active !== card) stop(active);
  active = card;
  const v = card._v;
  const stage = card.querySelector(".rstage");
  if (!frameOf(card)) {
    const f = h("iframe", { src: embedSrc(v.video_id), title: v.title, allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true,
      referrerpolicy: "strict-origin-when-cross-origin", loading: "eager", tabindex: "-1" });
    // ask the player to report its state and time (documented "listening" handshake of the IFrame API)
    let tries = 0;
    const hello = () => { if (!f.isConnected || card._heard || tries++ > 10) return; f.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: v.video_id, channel: "widget" }), "*"); setTimeout(hello, 400); };
    f.addEventListener("load", hello);
    stage.append(f);
    card._heard = false;
    // If the player never reports that it is playing (autoplay refused by the browser), let taps reach YouTube's own
    // play button instead of our gesture layer.
    clearTimeout(card._guard);
    card._guard = setTimeout(() => { if (card === active && card._heard && !card._played) { card.classList.add("needs-tap"); } }, 4000);
  }
  card.classList.remove("needs-tap");
  card.dataset.state = "playing";
  setBar(card, 0);
  syncButtons(card);
}
function stop(card) {
  clearTimeout(card._guard);
  frameOf(card)?.remove(); // frees the player: only one stream at a time (saves data)
  card.dataset.state = "idle"; card._played = false; card._heard = false;
  card.classList.remove("needs-tap");
  syncButtons(card);
  if (active === card) active = null;
}
function setPaused(card, paused) {
  if (card.dataset.state === "idle") { if (!paused) play(card); return; }
  cmd(card, paused ? "pauseVideo" : "playVideo");
  card.dataset.state = paused ? "paused" : "playing";
  syncButtons(card);
}
function togglePause(card) {
  if (card.dataset.state === "idle") return play(card);
  setPaused(card, card.dataset.state === "playing");
  flashIcon(card, card.dataset.state === "playing" ? ICONS.play() : ICONS.pause());
}
function toggleSound(card) {
  soundOn = !soundOn; session.set("reels-sound", soundOn ? "1" : "0");
  if (card.dataset.state === "idle") play(card); else cmd(card, soundOn ? "unMute" : "mute");
  document.querySelectorAll(".reel").forEach(syncButtons);
  flashIcon(card, soundOn ? IC.soundOn() : IC.soundOff());
}
function toggleCaptions(card) {
  captionsOn = !captionsOn;
  frameOf(card)?.remove(); // captions are a player parameter: reload this video with them on/off
  play(card);
  document.querySelectorAll(".reel").forEach(syncButtons);
  flash(captionsOn ? L("الترجمة المصاحبة: تعمل إن وفّرها الناشر", "Captions on (when the publisher provides them)") : L("الترجمة المصاحبة: متوقفة", "Captions off"));
}
function toggleLike(card, force) {
  const id = card._v.video_id, on = force ?? !liked.has(id);
  on ? liked.add(id) : liked.delete(id);
  saveLiked(); syncButtons(card);
}
function burst(card, x, y) {
  const el = h("span", { class: "rburst", "aria-hidden": "true", style: `left:${x}px;top:${y}px` }, IC.heart(true));
  card.append(el); setTimeout(() => el.remove(), 900);
}
function flashIcon(card, icon) {
  card.querySelector(".rflash")?.remove();
  const el = h("span", { class: "rflash", "aria-hidden": "true" }, icon);
  card.append(el); setTimeout(() => el.remove(), 650);
}
const setBar = (card, frac) => card.querySelector(".rbar i")?.style.setProperty("--p", String(Math.min(1, Math.max(0, frac))));

function syncButtons(card) {
  const st = card.dataset.state;
  const pp = card.querySelector(".act-play");
  if (pp) { pp.replaceChildren(st === "playing" ? ICONS.pause() : ICONS.play()); pp.setAttribute("aria-label", st === "playing" ? L("إيقاف مؤقت", "Pause") : L("تشغيل", "Play")); }
  const snd = card.querySelector(".act-sound");
  if (snd) { snd.replaceChildren(soundOn ? IC.soundOn() : IC.soundOff(), h("span", {}, soundOn ? L("كتم", "Mute") : L("الصوت", "Sound"))); snd.setAttribute("aria-pressed", String(soundOn)); snd.setAttribute("aria-label", soundOn ? L("كتم الصوت", "Mute") : L("تشغيل الصوت", "Turn sound on")); }
  const cc = card.querySelector(".act-cc");
  if (cc) cc.setAttribute("aria-pressed", String(captionsOn));
  const lk = card.querySelector(".act-like");
  if (lk) { const on = liked.has(card._v.video_id); lk.replaceChildren(IC.heart(on), h("span", {}, on ? L("أعجبني", "Liked") : L("إعجاب", "Like"))); lk.setAttribute("aria-pressed", String(on)); }
}

// state and time reported by the player
addEventListener("message", (e) => {
  if (e.origin !== YT_ORIGIN || !active || e.source !== frameOf(active)?.contentWindow) return;
  let d; try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
  const info = d?.info; if (!info || typeof info !== "object") return;
  active._heard = true;
  if (typeof info.duration === "number" && info.duration > 0) active._dur = info.duration;
  if (typeof info.currentTime === "number" && active._dur) setBar(active, info.currentTime / active._dur);
  if (info.playerState === 1) { active._played = true; active.classList.remove("needs-tap"); if (active.dataset.state !== "playing") { active.dataset.state = "playing"; syncButtons(active); } }
  else if (info.playerState === 2 && active.dataset.state === "playing" && active._played) { active.dataset.state = "paused"; syncButtons(active); }
});

async function share(v) {
  const url = new URL("reels.html", location.href); url.searchParams.set("v", v.video_id);
  const data = { title: v.title, text: v.title + " — " + chName(v), url: url.toString() };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(data.url); flash(L("تم نسخ الرابط", "Link copied")); }
  } catch { /* cancelled */ }
}
function flash(msg) { document.querySelector(".toast")?.remove(); const t = h("div", { class: "toast", role: "status" }, msg); document.body.append(t); setTimeout(() => t.remove(), 2200); }

// ---------- cards ----------
const chName = (v) => { const c = channels.get(v.channel_id); return c ? (EN ? c.name_en : c.name_ar) : ""; };
const when = (d) => (isToday(d) ? ago(d) : shortDate(d) + " · " + time(d));
const vdir = (v) => (v.language === "ar" ? "rtl" : "ltr");

/** Tap = pause/play, double-tap = like, press-and-hold = pause while held. Vertical drags are left to the scroller. */
function gestures(layer, card) {
  let downAt = 0, sx = 0, sy = 0, moved = false, held = false, holdTimer = 0, tapTimer = 0, lastTap = 0;
  layer.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    downAt = Date.now(); sx = e.clientX; sy = e.clientY; moved = false; held = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { if (!moved && card.dataset.state === "playing") { held = true; setPaused(card, true); card.classList.add("holding"); } }, 380);
  });
  layer.addEventListener("pointermove", (e) => { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) { moved = true; clearTimeout(holdTimer); } });
  const end = (e) => {
    clearTimeout(holdTimer);
    if (held) { held = false; card.classList.remove("holding"); setPaused(card, false); return; }
    if (moved || e.type === "pointercancel" || Date.now() - downAt > 600) return;
    const now = Date.now(), r = card.getBoundingClientRect();
    if (now - lastTap < 300) { // double tap
      clearTimeout(tapTimer); lastTap = 0;
      toggleLike(card, true); burst(card, e.clientX - r.left, e.clientY - r.top);
    } else { lastTap = now; tapTimer = setTimeout(() => togglePause(card), 260); }
  };
  layer.addEventListener("pointerup", end);
  layer.addEventListener("pointercancel", end);
  layer.addEventListener("contextmenu", (e) => e.preventDefault());
}

function reel(v) {
  const watch = `https://www.youtube.com/shorts/${v.video_id}`;
  const name = chName(v);
  const cap = v.caption && v.caption !== v.title ? v.caption : "";
  const text = h("div", { class: "rtext", dir: vdir(v) }, h("h2", { dir: vdir(v) }, v.title), cap ? h("p", { class: "rcap", dir: vdir(v) }, cap) : null);
  const moreBtn = h("button", { class: "rmore", type: "button", "aria-expanded": "false", onclick: () => { const open = card.classList.toggle("expanded"); moreBtn.setAttribute("aria-expanded", String(open)); moreBtn.textContent = open ? L("أقل", "less") : L("المزيد", "more"); } }, L("المزيد", "more"));
  const layer = h("div", { class: "rgest", role: "button", tabindex: "0", "aria-label": L("إيقاف أو تشغيل الفيديو (اضغط مرتين للإعجاب)", "Pause or play the video (double-tap to like)"),
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); togglePause(card); } } });
  const card = h("article", { class: "reel", dataset: { id: v.video_id, state: "idle", kind: v.kind }, "aria-label": v.title },
    h("div", { class: "rstage" },
      v.thumbnail ? h("img", { class: "rposter", src: v.thumbnail, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" }) : null),
    layer,
    h("span", { class: "rplay", "aria-hidden": "true" }, ICONS.play()),
    h("div", { class: "rinfo" },
      h("div", { class: "rmeta" },
        h("span", { class: "ravatar", "aria-hidden": "true" }, (name || "•").trim().charAt(0)),
        h("span", { class: "rwho" }, h("span", { class: "rchan" }, name), h("span", { class: "rtime num" }, when(v.published_at))),
        h("span", { class: "rkind" }, v.kind === "sports" ? L("رياضة", "Sports") : L("أخبار", "News"))),
      text,
      v.title.length + cap.length > 90 ? moreBtn : null,
      h("div", { class: "rlinks" },
        v.related_article_id ? h("a", { class: "rpill", href: `article.html?id=${v.related_article_id}` }, L("الخبر في لحظة ←", "Story on Lahza →")) : null,
        h("a", { class: "rpill ghost", href: watch, target: "_blank", rel: "noopener" }, L("يوتيوب ↗", "YouTube ↗"))),
      h("p", { class: "rnote" }, L("فيديو منشور على يوتيوب بواسطة ", "Video published on YouTube by "), name, L("، ويُعرض بمشغّل يوتيوب الرسمي. الحقوق لأصحابها.", "; shown with YouTube's official player. All rights belong to the publisher."))),
    h("div", { class: "racts" },
      h("button", { class: "ract act-like", type: "button", onclick: () => { const was = liked.has(v.video_id); toggleLike(card); if (!was) { const r = card.getBoundingClientRect(); burst(card, r.width / 2, r.height / 2); } } }),
      h("button", { class: "ract", type: "button", "aria-label": L("مشاركة", "Share"), onclick: () => share(v) }, ICONS.share(), h("span", {}, L("مشاركة", "Share"))),
      h("button", { class: "ract act-sound", type: "button", onclick: () => toggleSound(card) }),
      h("button", { class: "ract act-cc", type: "button", "aria-label": L("الترجمة المصاحبة", "Captions"), onclick: () => toggleCaptions(card) }, h("b", {}, "CC"), h("span", {}, L("ترجمة", "Captions")))),
    h("button", { class: "act-play sr-only", type: "button", onclick: () => togglePause(card) }),
    h("div", { class: "rbar", "aria-hidden": "true" }, h("i")));
  card._v = v;
  gestures(layer, card);
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
  if (kind === "liked") { if (!liked.size) return []; q = q.in("video_id", [...liked]); }
  else if (kind !== "all") q = q.eq("kind", kind);
  if (lang() !== "all") q = q.eq("language", lang());
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
    if (!items.length) feed.append(h("div", { class: "reels-state" },
      h("h3", {}, kind === "liked" ? L("لم تُعجب بأي فيديو بعد", "No liked videos yet") : L("لا فيديوهات في هذا التصنيف الآن", "No videos in this filter right now")),
      h("p", {}, kind === "liked" ? L("اضغط مرتين على أي فيديو أو على زر القلب ليُحفظ هنا على هذا الجهاز.", "Double-tap a video or press the heart to keep it here on this device.")
        : L("تُحدَّث القائمة تلقائياً كل 10 دقائق من قنوات الناشرين الرسمية.", "The list refreshes every 10 minutes from the publishers' official channels.")),
      langChoice && langChoice !== "all" && kind !== "liked" ? h("button", { class: "btn", type: "button", onclick: () => { langChoice = "all"; local.set("lahza-reels-lang", "all"); reset(); } }, L("عرض كل اللغات", "Show all languages")) : null));
    else if (done) feed.append(h("div", { class: "reels-state end" }, L("وصلت إلى آخر الفيديوهات (آخر 14 يوماً).", "You've reached the end (last 14 days).")));
    else feed.append(h("div", { class: "reels-more", "aria-hidden": "true" }));
    hint();
  } catch (e) {
    console.error(e);
    feed.append(h("div", { class: "reels-state" }, h("h3", {}, L("تعذّر تحميل الفيديوهات", "Could not load videos")),
      h("button", { class: "btn", type: "button", onclick: (ev) => { ev.target.closest(".reels-state").remove(); more(); } }, L("إعادة المحاولة", "Try again"))));
  } finally { loading = false; }
}

// first visit: show how to move to the next video
function hint() {
  if (local.get("lahza-reels-hint") === "1" || items.length < 2 || document.querySelector(".reels-hint")) return;
  const el = h("div", { class: "reels-hint", "aria-hidden": "true" }, IC.up(), L("اسحب للأعلى للفيديو التالي", "Swipe up for the next video"));
  root.append(el);
  const bye = () => { el.remove(); local.set("lahza-reels-hint", "1"); feed.removeEventListener("scroll", bye); };
  feed.addEventListener("scroll", bye, { passive: true }); setTimeout(bye, 6000);
}

// play the card that is mostly on screen; load more near the end
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const card = e.target;
    if (e.isIntersecting && e.intersectionRatio >= 0.6) {
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches || active) play(card);
      if (items.length && card._v === items[items.length - 3] || card._v === items[items.length - 1]) more();
      const next = card.nextElementSibling?.querySelector?.(".rposter"); if (next) next.loading = "eager";
    } else if (card === active && e.intersectionRatio < 0.3) stop(card);
  }
}, { threshold: [0, 0.3, 0.6, 0.9] });

function reset() {
  drawTabs();
  if (active) stop(active);
  items = []; done = false;
  feed.replaceChildren();
  const u = new URL(location.href); u.searchParams.delete("v");
  kind === "all" ? u.searchParams.delete("kind") : u.searchParams.set("kind", kind);
  langChoice ? u.searchParams.set("l", langChoice) : u.searchParams.delete("l");
  history.replaceState(null, "", u);
  feed.scrollTo({ top: 0 });
  more();
}

// keyboard: ↑/↓ or j/k move between videos, space pauses, m toggles sound, l likes
addEventListener("keydown", (e) => {
  if (e.target.closest("input,textarea,select,dialog")) return;
  if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); step(1); }
  else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); step(-1); }
  else if (e.key === " " && active) { e.preventDefault(); togglePause(active); }
  else if (e.key === "m" && active) toggleSound(active);
  else if (e.key === "l" && active) toggleLike(active);
});
// pause when the tab is hidden, resume when it is back
document.addEventListener("visibilitychange", () => {
  if (!active) return;
  if (document.hidden && active.dataset.state === "playing") { setPaused(active, true); active._auto = true; }
  else if (!document.hidden && active._auto) { active._auto = false; setPaused(active, false); }
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
