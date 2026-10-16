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
