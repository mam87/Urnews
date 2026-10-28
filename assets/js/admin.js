// Admin dashboard. Every action here is authorised again in the database (RLS + is_admin()).
// Hiding this UI from non-admins is a convenience, not the security boundary.
import { sb, h, configured, notConfiguredState, CATEGORIES, CAT_NAME, VERIFICATION, ago, full, time, toast, friendlyError, initTheme } from "./common.js";

const root = document.getElementById("app");
document.title = "لوحة التحرير — لحظة";
initTheme();
let me = null; let role = null; let current = "overview";
const STATUS_AR = { published: "منشور", pending: "قيد المراجعة", hidden: "مخفي", rejected: "مرفوض" };

function shell(content) {
  const tabs = [["overview", "نظرة عامة"], ["articles", "الأخبار"], ["sources", "المصادر"], ["logs", "السجلات والأخطاء"], ["live", "البث المباشر"], ["settings", "الإعدادات"], ["editors", "المحررون"]];
  root.replaceChildren(
    h("div", { class: "section-head" }, h("h2", {}, "لوحة التحرير"), h("span", { class: "meta" }, me?.email || ""),
      h("div", { class: "tools" }, h("a", { class: "btn", href: "index.html" }, "الموقع"), h("button", { class: "btn", type: "button", onclick: async () => { await sb.auth.signOut(); location.reload(); } }, "خروج"))),
    h("div", { class: "admin-shell" },
      h("nav", { class: "admin-nav", "aria-label": "أقسام اللوحة" }, tabs.map(([k, v]) => h("button", { type: "button", "aria-current": String(k === current), onclick: () => go(k) }, v))),
      h("div", { id: "admin-body" }, content)));
}
const body = () => document.getElementById("admin-body");
async function go(tab) {
  current = tab;
  shell(h("ul", { class: "skeleton" }, h("li"), h("li"), h("li")));
  try { await ({ overview, articles, sources, logs, live, settings, editors })[tab](); }
  catch (e) { console.error(e); body().replaceChildren(h("div", { class: "error-box" }, friendlyError(e), h("div", { class: "note" }, String(e?.message || "")))); }
}
const must = ({ data, error }) => { if (error) throw error; return data; };

/* ---------------- overview ---------------- */
async function overview() {
  const s = must(await sb.rpc("news_admin_stats"));
  const lastOk = s.last_ok_run_at;
  const healthy = lastOk && Date.now() - new Date(lastOk).getTime() < 15 * 60_000;
  const stat = (k, v, cls = "") => h("div", { class: "stat" }, h("div", { class: "v num " + cls }, v ?? "—"), h("div", { class: "k" }, k));
  const max = Math.max(1, ...s.hourly_24h.map((x) => x.n));
  body().replaceChildren(
    h("div", { class: "stats" },
      stat("حالة الجلب", healthy ? "يعمل" : "متوقف", healthy ? "status-ok" : "status-bad"),
      stat("آخر تشغيل ناجح", lastOk ? ago(lastOk) : "أبداً"),
      stat("تشغيلات 24 ساعة", s.runs_24h), stat("تشغيلات فاشلة", s.runs_failed_24h, s.runs_failed_24h ? "status-warn" : ""),
      stat("أخبار جديدة 24 ساعة", s.articles_24h), stat("مكررات مُنعت", s.duplicates_24h),
      stat("عاجل الآن", s.breaking_now), stat("قيد المراجعة", s.pending), stat("استدعاءات AI اليوم", s.ai_today ?? 0),
      stat("إجمالي الأخبار", s.articles_total), stat("حجم القاعدة", s.db_size)),
    h("section", { class: "panel", style: "background:var(--bg-2);border:1px solid var(--rule);border-radius:10px;padding:16px;margin-bottom:20px" },
      h("h3", { style: "margin:0;font-size:15px" }, "الأخبار المضافة لكل ساعة (24 ساعة)"),
      h("div", { class: "bars" }, s.hourly_24h.map((x) => h("span", { style: `height:${(x.n / max) * 100}%`, title: `${time(x.h)}: ${x.n}` })))),
    h("h3", {}, "التنبيهات المفتوحة"),
    s.open_alerts.length ? h("div", { class: "table-wrap" }, h("table", {}, h("tbody", {}, s.open_alerts.map((a) => h("tr", {},
      h("td", {}, a.message, h("span", { class: "sub" }, a.kind)), h("td", { class: "num" }, ago(a.created_at)),
      h("td", {}, a.notified_at ? "أُرسل التنبيه" : "لم يُرسل (لا قناة مهيأة)"),
      h("td", {}, h("button", { class: "btn", type: "button", onclick: async () => { must(await sb.from("news_alerts").update({ resolved_at: new Date().toISOString() }).eq("id", a.id)); go("overview"); } }, "إغلاق")))))))
      : h("p", { class: "note" }, "لا تنبيهات مفتوحة."),
    s.last_run ? h("p", { class: "note" }, `آخر تشغيل: ${full(s.last_run.started_at)} — الحالة ${s.last_run.status}، مصادر ${s.last_run.sources_attempted} (نجح ${s.last_run.sources_ok}، فشل ${s.last_run.sources_failed})، جديد ${s.last_run.items_new}، المدة ${s.last_run.duration_ms ?? "?"}ms`) : null);
}

/* ---------------- articles ---------------- */
async function articles(filters = { status: "", q: "", cat: "" }) {
  const srcs = new Map(must(await sb.from("news_sources").select("id,name_ar")).map((s) => [s.id, s.name_ar]));
  let qb = sb.from("news_articles").select("id,title,summary,source_id,url,published_at,status,verification,is_breaking,breaking_until,pinned,category,categories,edited,editor_note,duplicate_of,cluster_id").order("created_at", { ascending: false }).limit(100);
  if (filters.status) qb = qb.eq("status", filters.status);
  if (filters.cat) qb = qb.contains("categories", [filters.cat]);
  if (filters.q) qb = qb.ilike("title", `%${filters.q.replace(/[%_\\]/g, "\\$&")}%`);
  const rows = must(await qb);
  const statusSel = h("select", { "aria-label": "الحالة" }, h("option", { value: "" }, "كل الحالات"), Object.entries(STATUS_AR).map(([k, v]) => h("option", { value: k, selected: filters.status === k }, v)));
  const catSel = h("select", { "aria-label": "القسم" }, h("option", { value: "" }, "كل الأقسام"), CATEGORIES.map(([k, v]) => h("option", { value: k, selected: filters.cat === k }, v)));
  const qIn = h("input", { type: "search", placeholder: "بحث في العناوين", value: filters.q, maxlength: "100" });
  const apply = () => articles({ status: statusSel.value, cat: catSel.value, q: qIn.value.trim() }).catch((e) => toast(friendlyError(e)));
  const upd = async (id, patch, msg) => { must(await sb.from("news_articles").update(patch).eq("id", id)); toast(msg); apply(); };
  const breakingActive = (a) => a.is_breaking && new Date(a.breaking_until) > new Date();
  body().replaceChildren(
    h("div", { class: "toolbar" }, qIn, statusSel, catSel, h("button", { class: "btn btn-primary", type: "button", onclick: apply }, "تصفية")),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "الخبر"), h("th", {}, "الحالة"), h("th", {}, "إجراءات"))),
      h("tbody", {}, rows.length ? rows.map((a) => h("tr", {},
        h("td", {}, h("a", { href: `article.html?id=${a.id}`, target: "_blank" }, a.title),
          h("span", { class: "sub" }, `${srcs.get(a.source_id) || ""} · ${full(a.published_at)} · ${CAT_NAME[a.category] || ""} · ${VERIFICATION[a.verification]?.label}${a.duplicate_of ? " · مكرر" : ""}${a.edited ? " · معدل" : ""}`)),
        h("td", {}, h("span", { class: a.status === "published" ? "status-ok" : a.status === "pending" ? "status-warn" : "status-bad" }, STATUS_AR[a.status]),
          a.pinned ? h("span", { class: "sub" }, "مثبت") : null, breakingActive(a) ? h("span", { class: "sub", style: "color:var(--breaking)" }, "عاجل") : null),
        h("td", {}, h("div", { class: "row-actions" },
          a.status !== "published" ? h("button", { class: "btn", type: "button", onclick: () => upd(a.id, { status: "published" }, "نُشر") }, "نشر") : null,
          a.status !== "hidden" ? h("button", { class: "btn", type: "button", onclick: () => upd(a.id, { status: "hidden" }, "أُخفي") }, "إخفاء") : null,
          a.status !== "rejected" ? h("button", { class: "btn btn-danger", type: "button", onclick: () => upd(a.id, { status: "rejected" }, "رُفض") }, "رفض") : null,
          h("button", { class: "btn", type: "button", onclick: () => upd(a.id, { pinned: !a.pinned }, a.pinned ? "أُلغي التثبيت" : "ثُبّت") }, a.pinned ? "إلغاء التثبيت" : "تثبيت"),
          h("button", { class: "btn", type: "button", onclick: () => upd(a.id, breakingActive(a) ? { is_breaking: false, breaking_until: null } : { is_breaking: true, breaking_until: new Date(Date.now() + 6 * 3600_000).toISOString() }, "تم") }, breakingActive(a) ? "إلغاء العاجل" : "عاجل"),
          h("button", { class: "btn", type: "button", onclick: () => editDialog(a, apply) }, "تحرير"),
          h("button", { class: "btn", type: "button", onclick: () => historyDialog(a) }, "السجل"))))) : h("tr", {}, h("td", { colspan: "3", class: "state" }, "لا نتائج"))))));
}

function dialog(title, content, actions) {
  const d = h("dialog", {}, h("h3", { style: "margin-top:0" }, title), content, h("div", { class: "toolbar", style: "margin:16px 0 0;justify-content:flex-end" }, actions, h("button", { class: "btn", type: "button", onclick: () => d.close() }, "إغلاق")));
  d.addEventListener("close", () => d.remove());
  document.body.append(d); d.showModal();
  return d;
}

function editDialog(a, after) {
  const t = h("input", { value: a.title, maxlength: "400", required: true });
  const s = h("textarea", { maxlength: "1000" }, a.summary || "");
  const v = h("select", {}, Object.entries(VERIFICATION).map(([k, x]) => h("option", { value: k, selected: a.verification === k }, x.label)));
  const c = h("select", {}, CATEGORIES.map(([k, x]) => h("option", { value: k, selected: a.category === k }, x)));
  const cats = h("div", { class: "toolbar" }, CATEGORIES.map(([k, x]) => h("label", { class: "chip" }, h("input", { type: "checkbox", value: k, checked: a.categories.includes(k) }), x)));
  const note = h("input", { value: a.editor_note || "", maxlength: "500", placeholder: "ملاحظة داخلية (اختياري)" });
  const field = (label, el) => h("label", { class: "field" }, label, el);
  const d = dialog("تحرير الخبر", h("div", {},
    field("العنوان", t), field("الملخص (لا تضف معلومات غير موجودة في المصدر)", s),
    h("div", { class: "form-grid" }, field("حالة التحقق", v), field("القسم الرئيسي", c)),
    field("الأقسام", cats), field("ملاحظة تحريرية", note),
    h("p", { class: "note" }, "علامة «مؤكَّد تحريرياً» تعني أنك تحققت من الخبر من مصادر مستقلة — لا تستخدمها لمجرد تكرار الخبر.")),
    h("button", { class: "btn btn-primary", type: "button", onclick: async () => {
      const categories = [...cats.querySelectorAll("input:checked")].map((x) => x.value);
      if (!categories.includes(c.value)) categories.unshift(c.value);
      const title = t.value.trim();
      if (title.length < 3) return toast("العنوان قصير جداً");
      try {
        must(await sb.from("news_articles").update({ title, summary: s.value.trim() || null, verification: v.value, category: c.value, categories, editor_note: note.value.trim() || null }).eq("id", a.id));
        d.close(); toast("حُفظ التعديل"); after();
      } catch (e) { toast(e.message.includes("HTML") ? "لا يُسمح بوسوم HTML" : friendlyError(e)); }
    } }, "حفظ"));
}

async function historyDialog(a) {
  const rows = must(await sb.from("news_article_history").select("*").eq("article_id", a.id).order("created_at", { ascending: false }).limit(50));
  dialog("سجل التعديلات", rows.length ? h("ul", { class: "mini-list" }, rows.map((r) => h("li", {},
    h("span", { class: "t num" }, full(r.created_at)),
    Object.keys(r.new_values || {}).map((k) => h("div", { class: "note" }, `${k}: ${JSON.stringify(r.old_values?.[k])} ← ${JSON.stringify(r.new_values[k])}`)))))
    : h("p", { class: "note" }, "لا تعديلات بشرية على هذا الخبر."), null);
}

/* ---------------- sources ---------------- */
async function sources() {
  const rows = must(await sb.rpc("news_admin_sources"));
  const save = async (id, patch) => { try { must(await sb.from("news_sources").update(patch).eq("id", id)); toast("حُفظ"); } catch (e) { toast(/check/.test(e.message) ? "قيمة غير مسموحة (الفترة أقل من الحد الأدنى؟)" : friendlyError(e)); } };
  body().replaceChildren(
    h("div", { class: "toolbar" }, h("button", { class: "btn btn-primary", type: "button", onclick: addSourceDialog }, "إضافة مصدر"),
      h("span", { class: "note" }, "الفترة بالدقائق؛ لا يمكن أن تقل عن الحد الأدنى المسجل لشروط المصدر.")),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["المصدر", "الحالة", "آخر نجاح", "24 ساعة", "تشغيل", "صور", "الفترة", "الموثوقية", ""].map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.map((s) => {
        const enabled = h("input", { type: "checkbox", checked: s.enabled, "aria-label": "مفعل" });
        const imgs = h("input", { type: "checkbox", checked: s.allow_images, "aria-label": "عرض الصور", title: "عرض الصور المصغّرة التي يوفرها المصدر في خلاصته" });
        const interval = h("input", { type: "number", min: s.min_interval_minutes, max: "1440", value: s.poll_interval_minutes, style: "width:70px" });
        const rel = h("select", {}, [1, 2, 3, 4, 5].map((n) => h("option", { value: n, selected: s.reliability === n }, "★".repeat(n))));
        const ok = s.consecutive_failures === 0 && s.last_status !== "blocked";
        return h("tr", {},
          h("td", {}, h("b", {}, s.name_ar), h("span", { class: "sub", dir: "ltr" }, s.feed_url), h("span", { class: "sub" }, `${s.kind} · ${s.language} · ${CAT_NAME[s.default_category] || "—"}`)),
          h("td", {}, h("span", { class: !s.enabled ? "" : ok ? "status-ok" : s.consecutive_failures >= 5 ? "status-bad" : "status-warn" }, !s.enabled ? "معطل" : ok ? (s.last_status || "لم يُجلب") : `فشل ×${s.consecutive_failures}`),
            s.last_error ? h("span", { class: "sub", style: "color:var(--bad)" }, s.last_error) : null,
            s.next_fetch_at ? h("span", { class: "sub" }, "التالي: " + time(s.next_fetch_at)) : null),
          h("td", { class: "num" }, s.last_success_at ? ago(s.last_success_at) : "—"),
          h("td", { class: "num" }, `${s.fetches_24h} جلب · ${s.errors_24h} خطأ · ${s.new_24h} جديد`, h("span", { class: "sub" }, `7 أيام: ${s.published_7d} خبراً، ${s.rejected_7d} مرفوض/مخفي`)),
          h("td", {}, enabled), h("td", {}, imgs), h("td", {}, interval), h("td", {}, rel),
          h("td", {}, h("div", { class: "row-actions" },
            h("button", { class: "btn btn-primary", type: "button", onclick: () => save(s.id, { enabled: enabled.checked, allow_images: imgs.checked, poll_interval_minutes: Number(interval.value), reliability: Number(rel.value) }) }, "حفظ"),
            h("button", { class: "btn", type: "button", onclick: () => save(s.id, { next_fetch_at: new Date().toISOString() }) }, "جلب الآن"))));
      })))));
}

function addSourceDialog() {
  const f = (name, label, attrs = {}) => h("label", { class: "field" }, label, h("input", { name, ...attrs }));
  const sel = (name, label, opts) => h("label", { class: "field" }, label, h("select", { name }, opts.map(([v, t]) => h("option", { value: v }, t))));
  const form = h("form", { class: "form-grid" },
    f("name_ar", "الاسم بالعربية", { required: true, maxlength: "80" }), f("slug", "معرّف لاتيني (a-z, 0-9, -)", { required: true, pattern: "[a-z0-9-]{2,40}", dir: "ltr" }),
    f("feed_url", "رابط خلاصة RSS/Atom الرسمية", { required: true, type: "url", dir: "ltr" }), f("homepage", "الموقع (https)", { required: true, type: "url", dir: "ltr" }),
    sel("language", "اللغة", [["ar", "العربية"], ["en", "الإنجليزية"], ["fr", "الفرنسية"], ["he", "العبرية"]]),
    sel("kind", "النوع", [["media", "وسيلة إعلام"], ["agency", "وكالة أنباء"], ["official", "جهة رسمية"]]),
    sel("default_category", "القسم الافتراضي", [["", "تلقائي"], ...CATEGORIES]),
    sel("reliability", "الموثوقية", [["3", "3"], ["4", "4"], ["5", "5"], ["2", "2"], ["1", "1"]]),
    f("poll_interval_minutes", "فترة الجلب (دقائق)", { type: "number", min: "3", max: "1440", value: "5" }),
    f("tz_offset_minutes", "إزاحة التوقيت إن لم يحدده المصدر (دقائق، عمّان=180)", { type: "number", value: "0" }),
    f("terms_note", "ملاحظة عن شروط الاستخدام", { maxlength: "300" }));
  const d = dialog("إضافة مصدر", h("div", {}, form, h("p", { class: "note" }, "أضف فقط خلاصات ينشرها المصدر رسمياً وتسمح شروطه بإعادة عرض العناوين. سيُفحص robots.txt تلقائياً قبل أول جلب.")),
    h("button", { class: "btn btn-primary", type: "button", onclick: async () => {
      if (!form.reportValidity()) return;
      const v = Object.fromEntries(new FormData(form));
      const row = { ...v, default_category: v.default_category || null, reliability: Number(v.reliability), poll_interval_minutes: Number(v.poll_interval_minutes), tz_offset_minutes: Number(v.tz_offset_minutes || 0), min_interval_minutes: 3, enabled: true };
      if (!/^https:\/\//.test(row.homepage)) return toast("يجب أن يبدأ الموقع بـ https://");
      try { must(await sb.from("news_sources").insert(row)); d.close(); toast("أُضيف المصدر — سيُجلب في التشغيل القادم"); go("sources"); }
      catch (e) { toast(/duplicate|unique/.test(e.message) ? "المصدر موجود مسبقاً" : /check/.test(e.message) ? "قيمة غير صالحة" : friendlyError(e)); }
    } }, "إضافة"));
}

/* ---------------- logs ---------------- */
async function logs() {
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const [errs, runs, srcs] = await Promise.all([
    sb.from("news_fetch_logs").select("*").in("status", ["error", "blocked"]).gt("started_at", since).order("started_at", { ascending: false }).limit(100).then(must),
    sb.from("news_ingest_runs").select("*").order("started_at", { ascending: false }).limit(40).then(must),
    sb.from("news_sources").select("id,name_ar").then(must),
  ]);
  const name = new Map(srcs.map((s) => [s.id, s.name_ar]));
  body().replaceChildren(
    h("h3", {}, "أخطاء الجلب (48 ساعة)"),
    errs.length ? h("div", { class: "table-wrap" }, h("table", {}, h("tbody", {}, errs.map((e) => h("tr", {},
      h("td", { class: "num" }, full(e.started_at)), h("td", {}, name.get(e.source_id)), h("td", { class: "status-bad" }, e.status + (e.http_status ? ` ${e.http_status}` : "")), h("td", {}, e.error, h("span", { class: "sub" }, `محاولات ${e.attempts} · ${e.duration_ms}ms`)))))))
      : h("p", { class: "note" }, "لا أخطاء خلال 48 ساعة."),
    h("h3", {}, "آخر التشغيلات"),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["البدء", "الحالة", "مصادر", "جديد/مقروء", "AI", "المدة", "خطأ"].map((x) => h("th", {}, x)))),
      h("tbody", {}, runs.map((r) => h("tr", {},
        h("td", { class: "num" }, full(r.started_at)),
        h("td", { class: r.status === "ok" ? "status-ok" : r.status === "partial" ? "status-warn" : r.status === "running" ? "" : "status-bad" }, r.status),
        h("td", { class: "num" }, `${r.sources_ok}/${r.sources_attempted}`), h("td", { class: "num" }, `${r.items_new}/${r.items_seen}`),
        h("td", { class: "num" }, r.ai_calls), h("td", { class: "num" }, r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"),
        h("td", {}, r.error ? h("span", { class: "sub" }, r.error.slice(0, 200)) : "")))))));
}

/* ---------------- live channels ---------------- */
async function live() {
  const rows = must(await sb.from("news_live_channels").select("*").order("sort_order"));
  const idOk = (v) => !v || /^UC[A-Za-z0-9_-]{22}$/.test(v);
  const handleOk = (v) => !v || /^@[A-Za-z0-9._-]{3,40}$/.test(v);
  const save = async (id, patch) => {
    if (!idOk(patch.youtube_channel_id)) return toast("معرّف القناة يبدأ بـ UC ويتكون من 24 حرفاً");
    if (!handleOk(patch.youtube_handle)) return toast("اسم القناة على يوتيوب يبدأ بـ @");
    try {
      if (id) must(await sb.from("news_live_channels").update(patch).eq("id", id));
      else must(await sb.from("news_live_channels").insert(patch));
      toast("حُفظ"); go("live");
    } catch (e) { toast(/check/.test(e.message) ? "أدخل معرّف القناة أو اسمها على يوتيوب" : friendlyError(e)); }
  };
  const row = (c) => {
    const name = h("input", { value: c.name_ar || "", maxlength: "60", style: "width:140px" });
    const cid = h("input", { value: c.youtube_channel_id || "", dir: "ltr", placeholder: "UC…", style: "width:220px" });
    const handle = h("input", { value: c.youtube_handle || "", dir: "ltr", placeholder: "@handle", style: "width:130px" });
    const order = h("input", { type: "number", value: c.sort_order ?? 100, style: "width:64px" });
    const en = h("input", { type: "checkbox", checked: c.enabled ?? true });
    const patch = () => ({ name_ar: name.value.trim(), youtube_channel_id: cid.value.trim() || null, youtube_handle: handle.value.trim() || null, sort_order: Number(order.value), enabled: en.checked });
    return h("tr", {}, h("td", {}, name), h("td", {}, cid), h("td", {}, handle), h("td", {}, order), h("td", {}, en),
      h("td", {}, h("button", { class: "btn btn-primary", type: "button", onclick: () => save(c.id, patch()) }, c.id ? "حفظ" : "إضافة")));
  };
  body().replaceChildren(
    h("p", { class: "note" }, "مع «معرّف القناة» (UC…) يُعرض البث داخل الموقع. بدونه يُفتح البث على يوتيوب عبر اسم القناة (@…). تجد المعرّف في يوتيوب: صفحة القناة ← حول ← مشاركة القناة ← نسخ معرّف القناة."),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["القناة", "معرّف القناة (UC…)", "اسمها على يوتيوب", "الترتيب", "مفعّل", ""].map((x) => h("th", {}, x)))),
      h("tbody", {}, rows.map(row), row({})))));
}

/* ---------------- settings ---------------- */
async function settings() {
  const rows = must(await sb.from("news_settings").select("key,value,description,updated_at").order("key"));
  body().replaceChildren(h("div", { class: "table-wrap" }, h("table", {}, h("tbody", {}, rows.filter((r) => r.key !== "owner_email").map((r) => {
    const input = h("input", { value: JSON.stringify(r.value), dir: "ltr", style: "width:160px" });
    return h("tr", {},
      h("td", {}, h("b", { dir: "ltr" }, r.key), h("span", { class: "sub" }, r.description || "")),
      h("td", {}, input),
      h("td", {}, h("button", { class: "btn btn-primary", type: "button", onclick: async () => {
        let value; try { value = JSON.parse(input.value); } catch { return toast("قيمة JSON غير صالحة (أرقام، true/false، أو نص بين علامتي تنصيص)"); }
        try { must(await sb.from("news_settings").update({ value }).eq("key", r.key)); toast("حُفظ"); } catch (e) { toast(friendlyError(e)); }
      } }, "حفظ")));
  })))), h("p", { class: "note" }, "ingest_enabled=false يوقف الجلب بالكامل. فترة المجدول الفعلية تُضبط في pg_cron (انظر دليل الإعداد)."));
}

/* ---------------- editors ---------------- */
async function editors() {
  const rows = must(await sb.from("news_admins").select("user_id,role,created_at"));
  const email = h("input", { type: "email", placeholder: "بريد المحرر (بعد أن ينشئ حساباً)", dir: "ltr" });
  body().replaceChildren(
    h("p", {}, `دورك: ${role === "owner" ? "مالك" : "محرر"}. المالك وحده يضيف المحررين.`),
    h("div", { class: "table-wrap" }, h("table", {}, h("tbody", {}, rows.map((r) => h("tr", {}, h("td", { dir: "ltr" }, r.user_id), h("td", {}, r.role === "owner" ? "مالك" : "محرر"), h("td", { class: "num" }, full(r.created_at))))))),
    role === "owner" ? h("div", { class: "toolbar", style: "margin-top:16px" }, email, h("button", { class: "btn btn-primary", type: "button", onclick: async () => {
      try {
        const r = must(await sb.rpc("news_add_admin_by_email", { p_email: email.value, p_role: "editor" }));
        toast(r === "ok" ? "أُضيف المحرر" : "لا يوجد حساب بهذا البريد — اطلب منه التسجيل أولاً"); go("editors");
      } catch (e) { toast(friendlyError(e)); }
    } }, "إضافة محرر")) : null);
}

/* ---------------- auth ---------------- */
function loginView(msg = "") {
  const email = h("input", { type: "email", required: true, autocomplete: "username", dir: "ltr" });
  const pw = h("input", { type: "password", required: true, autocomplete: "current-password", dir: "ltr" });
  const out = h("p", { class: "note", role: "alert" }, msg);
  const form = h("form", {}, h("label", { class: "field" }, "البريد الإلكتروني", email), h("label", { class: "field" }, "كلمة المرور", pw),
    h("div", { class: "toolbar" },
      h("button", { class: "btn btn-primary", type: "submit" }, "دخول"),
      h("button", { class: "btn", type: "button", onclick: async () => {
        if (!form.reportValidity()) return;
        const { error } = await sb.auth.signUp({ email: email.value, password: pw.value, options: { emailRedirectTo: location.href } });
        out.textContent = error ? (/disabled|not allowed/i.test(error.message) ? "التسجيل مغلق. اطلب من المالك إنشاء حساب لك." : error.message) : "تم إنشاء الحساب. إن طُلب تأكيد البريد فافتح الرابط المرسل ثم سجّل الدخول.";
      } }, "إنشاء حساب"),
      h("button", { class: "btn", type: "button", onclick: async () => {
        if (!email.reportValidity()) return;
        const { error } = await sb.auth.resetPasswordForEmail(email.value, { redirectTo: location.origin + location.pathname });
        out.textContent = error ? (/rate|many|seconds/i.test(error.message) ? "انتظر دقيقة ثم حاول مرة أخرى." : error.message)
          : "إذا كان البريد مسجلاً فستصلك رسالة فيها رابط لتعيين كلمة مرور جديدة. افتح الرابط من نفس الجهاز.";
      } }, "نسيت كلمة المرور")), out);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: email.value, password: pw.value });
    if (error) { out.textContent = /Invalid login/i.test(error.message) ? "بيانات الدخول غير صحيحة." : /rate|many/i.test(error.message) ? "محاولات كثيرة. انتظر قليلاً." : error.message; return; }
    start();
  });
  root.replaceChildren(h("div", { class: "login-box" }, h("h1", {}, "دخول المحررين"), h("p", { class: "note" }, "الوصول مقصور على المحررين المعتمدين. الصلاحيات تُفحص في الخادم."), form));
}

function newPasswordView() {
  const pw = h("input", { type: "password", required: true, minlength: "10", autocomplete: "new-password", dir: "ltr" });
  const pw2 = h("input", { type: "password", required: true, minlength: "10", autocomplete: "new-password", dir: "ltr" });
  const out = h("p", { class: "note", role: "alert" });
  const form = h("form", {}, h("label", { class: "field" }, "كلمة المرور الجديدة (10 أحرف على الأقل)", pw), h("label", { class: "field" }, "تأكيد كلمة المرور", pw2),
    h("button", { class: "btn btn-primary", type: "submit" }, "حفظ كلمة المرور"), out);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (pw.value !== pw2.value) { out.textContent = "كلمتا المرور غير متطابقتين."; return; }
    const { error } = await sb.auth.updateUser({ password: pw.value });
    if (error) { out.textContent = /weak|short|length/i.test(error.message) ? "كلمة المرور ضعيفة أو قصيرة." : error.message; return; }
    history.replaceState(null, "", location.pathname);
    toast("تم تغيير كلمة المرور");
    start();
  });
  root.replaceChildren(h("div", { class: "login-box" }, h("h1", {}, "تعيين كلمة مرور جديدة"), form));
}

let recovering = /type=recovery/.test(location.hash);
if (configured) sb.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") { recovering = true; newPasswordView(); } });

async function start() {
  if (!configured) return notConfiguredState(root);
  if (recovering) { const { data } = await sb.auth.getSession(); return data.session ? newPasswordView() : loginView("انتهت صلاحية رابط الاستعادة. اطلب رابطاً جديداً."); }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return loginView();
  me = session.user;
  const mine = must(await sb.from("news_admins").select("role").eq("user_id", me.id).maybeSingle());
  if (!mine) {
    const claimed = await sb.rpc("news_claim_first_owner");
    if (claimed.error) console.error(claimed.error);
    if (claimed.data === true) { toast("أصبحت مالك الموقع"); return start(); }
    return root.replaceChildren(h("div", { class: "login-box" }, h("h1", {}, "لا صلاحية"),
      h("p", {}, `الحساب ${me.email} ليس محرراً معتمداً. اطلب من مالك الموقع إضافتك.`),
      h("button", { class: "btn", type: "button", onclick: async () => { await sb.auth.signOut(); loginView(); } }, "خروج")));
  }
  role = mine.role;
  go("overview");
}
start();
