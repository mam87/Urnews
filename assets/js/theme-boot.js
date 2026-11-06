// Applies saved reader preferences before first paint (theme, font size, images, motion).
try {
  var p = JSON.parse(localStorage.getItem("nabd-prefs") || "{}") || {}, r = document.documentElement;
  var t = p.theme || localStorage.getItem("nabd-theme");
  if (t === "dark" || t === "light") r.dataset.theme = t;
  if (p.fs) r.style.setProperty("--fs", String(p.fs));
  if (p.noimg) r.dataset.noimg = "1";
  if (p.motion === "reduce") r.dataset.motion = "reduce";
  if (p.density === "compact") r.dataset.density = "compact";
} catch (e) {}
// Site language: Arabic (RTL) by default, English (LTR) when chosen. Set before first paint.
try {
  var q = /[?&]lang=(en|ar)\b/.exec(location.search), l = q ? q[1] : localStorage.getItem("nabd-lang");
  if (q) localStorage.setItem("nabd-lang", q[1]);
  if (l === "en") { document.documentElement.lang = "en"; document.documentElement.dir = "ltr"; }
} catch (e) {}
