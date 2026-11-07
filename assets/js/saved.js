// Saved stories and followed interests — kept only in this browser (localStorage); no account needed.
import { h } from "./common.js";
import { L } from "./i18n.js";

const KEY = "lahza-saved", FKEY = "lahza-follow", MAX = 200;
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

/** [{ kind: "article"|"story", id, title, at }] newest first */
export const savedList = () => read(KEY, []).filter((x) => x && (x.kind === "article" || x.kind === "story") && Number.isInteger(x.id));
export const isSaved = (kind, id) => savedList().some((x) => x.kind === kind && x.id === id);
export function toggleSaved(kind, id, title) {
  const list = savedList();
  const i = list.findIndex((x) => x.kind === kind && x.id === id);
  if (i >= 0) list.splice(i, 1); else list.unshift({ kind, id, title: String(title || "").slice(0, 300), at: new Date().toISOString() });
  write(KEY, list.slice(0, MAX));
  return i < 0;
}
export const removeSaved = (kind, id) => write(KEY, savedList().filter((x) => !(x.kind === kind && x.id === id)));
export const clearSaved = () => write(KEY, []);

/** { countries: ["JO", …], cats: ["sports", …] } */
export function follows() {
  const f = read(FKEY, {});
  return { countries: Array.isArray(f.countries) ? f.countries.filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 30) : [],
    cats: Array.isArray(f.cats) ? f.cats.filter((c) => /^[a-z_]{2,20}$/.test(c)).slice(0, 20) : [] };
}
export const isFollowed = (type, v) => follows()[type].includes(v);
export function toggleFollow(type, v) {
  const f = follows();
  const on = !f[type].includes(v);
  f[type] = on ? [...f[type], v] : f[type].filter((x) => x !== v);
  write(FKEY, f);
  return on;
}

const bookmark = () => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = '<path d="M6 3h12v18l-6-4-6 4z"/>'; return s; };

/** A "Save" toggle button for an article or full report. */
export function saveButton(kind, id, title, toast) {
  const b = h("button", { class: "btn save-btn", type: "button" });
  const draw = () => { const on = isSaved(kind, id); b.setAttribute("aria-pressed", String(on)); b.replaceChildren(bookmark(), on ? L("محفوظ", "Saved") : L("حفظ", "Save")); };
  b.addEventListener("click", () => { const on = toggleSaved(kind, id, title); draw(); toast?.(on ? L("حُفظ في «محفوظاتي» على هذا الجهاز", "Saved to “My Lahza” on this device") : L("أُزيل من المحفوظات", "Removed from saved")); });
  draw();
  return b;
}

/** A "Follow" toggle for a country or section. */
export function followButton(type, v, label, toast) {
  const b = h("button", { class: "btn follow-btn", type: "button" });
  const draw = () => { const on = isFollowed(type, v); b.setAttribute("aria-pressed", String(on)); b.replaceChildren(on ? "✓ " : "+ ", on ? L("تتابع ", "Following ") : L("تابِع ", "Follow "), label); };
  b.addEventListener("click", () => { const on = toggleFollow(type, v); draw(); toast?.(on ? L("أُضيف إلى متابعاتك", "Added to what you follow") : L("أُلغيت المتابعة", "Unfollowed")); });
  draw();
  return b;
}
