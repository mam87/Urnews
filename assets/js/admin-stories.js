// Admin → «التقارير الكاملة»: review, edit, approve/reject, publish now or schedule, corrections, updates.
// Every action is a database function that re-checks the editor's rights; this UI holds no authority of its own.
import { sb, h, CATEGORIES, CAT_NAME, full, ago, toast, friendlyError } from "./common.js";
import { STORY_STATUS, kindLabels, sectionLabels, CORRECTION, storyHref } from "./stories.js";

const KINDS = ["fact", "statement", "allegation", "developing", "analysis"];
const KEYS = ["event", "background", "statements", "reactions", "impact", "next", "disagreements", "analysis"];
const must = ({ data, error }) => { if (error) throw error; return data; };
const errText = (e) => {
  const m = String(e?.message || "");
  if (/warnings_unacknowledged/.test(m)) return "يجب مراجعة تحذيرات المدقق ووضع علامة «تحققت» أولاً";
  if (/change_kind_required/.test(m)) return "التقرير منشور: اختر نوع التعديل (طفيف / تصحيح / تحديث / توضيح)";
  if (/public note is required/.test(m)) return "اكتب ملاحظة للقراء تشرح التصحيح أو التحديث";
  if (/not in this story's source list|not in the source list/.test(m)) return "الفقرة تشير إلى مصدر غير موجود في قائمة المصادر";
  if (/invalid article body: (.*)/.test(m)) return "نص التقرير غير صالح: " + m.match(/invalid article body: (.*)/)[1];
  if (/HTML/.test(m)) return "لا يُسمح بوسوم HTML";
  if (/forbidden|permission/.test(m)) return "لا تملك صلاحية هذا الإجراء";
  if (/reason/.test(m)) return "اكتب السبب";
  if (/publication time/.test(m)) return "وقت النشر يجب أن يكون بعد دقيقة على الأقل وخلال 30 يوماً";
  return m.length < 200 && m ? m : friendlyError(e);
};

/* ---------- body ⇄ editable text ----------
## event                       (section; optional " | custom heading")
[fact] paragraph text {1,2}    (kind, text, source numbers)
## timeline
2026-11-06T09:05:00Z | text {1}
*/
export function bodyToText(b) {
  const out = [];
  for (const s of b?.sections || []) {
    out.push(`## ${s.key}${s.heading ? " | " + s.heading : ""}`);
    for (const p of s.paras || []) out.push(`[${p.k}] ${p.t}${p.r?.length ? ` {${p.r.join(",")}}` : ""}`);
    out.push("");
  }
  if (b?.timeline?.length) {
    out.push("## timeline");
    for (const e of b.timeline) out.push(`${e.at} | ${e.t}${e.r?.length ? ` {${e.r.join(",")}}` : ""}`);
  }
  return out.join("\n").trim();
}

export function textToBody(text) {
  const sections = []; const timeline = []; const errors = [];
  let cur = null; let inTimeline = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim(); const at = `سطر ${i + 1}`;
    if (!line) return;
    const head = line.match(/^##\s*([a-z]+)\s*(?:\|\s*(.+))?$/);
    if (head) {
      inTimeline = head[1] === "timeline";
      if (inTimeline) { cur = null; return; }
      if (!KEYS.includes(head[1])) { errors.push(`${at}: قسم غير معروف «${head[1]}» (المسموح: ${KEYS.join("، ")}، timeline)`); cur = null; return; }
      cur = sections.find((s) => s.key === head[1]);
      if (!cur) { cur = head[2] ? { key: head[1], heading: head[2].trim(), paras: [] } : { key: head[1], paras: [] }; sections.push(cur); }
      else if (head[2]) cur.heading = head[2].trim();
      return;
    }
    const refsM = line.match(/\{\s*([\d\s,،]+)\s*\}\s*$/);
    const r = refsM ? [...new Set(refsM[1].split(/[,،\s]+/).filter(Boolean).map(Number))].filter((n) => n >= 1 && n <= 99) : [];
    const body = refsM ? line.slice(0, refsM.index).trim() : line;
    if (inTimeline) {
      const m = body.match(/^(\S+)\s*\|\s*(.+)$/);
      if (!m || isNaN(Date.parse(m[1]))) { errors.push(`${at}: سطر التسلسل يجب أن يكون «الوقت | النص {أرقام المصادر}»`); return; }
      if (!r.length) { errors.push(`${at}: كل حدث في التسلسل يحتاج رقم مصدر`); return; }
      timeline.push({ at: new Date(m[1]).toISOString(), t: m[2].trim(), r });
      return;
    }
    const pm = body.match(/^\[([a-z]+)\]\s*(.+)$/);
    if (!cur) { errors.push(`${at}: اكتب «## event» (أو قسماً آخر) قبل الفقرات`); return; }
    if (!pm || !KINDS.includes(pm[1])) { errors.push(`${at}: الفقرة تبدأ بنوعها: [fact] أو [statement] أو [allegation] أو [developing] أو [analysis]`); return; }
    if (pm[1] !== "analysis" && !r.length) { errors.push(`${at}: الفقرة تحتاج أرقام مصادرها في آخرها مثل {1,3}`); return; }
    cur.paras.push({ t: pm[2].trim(), k: pm[1], r });
  });
  const kept = sections.filter((s) => s.paras.length);
  if (!kept.length) errors.push("التقرير يحتاج قسماً واحداً على الأقل فيه فقرات");
  return { body: { sections: kept, timeline }, errors };
}

/* ---------- list ---------- */
export async function storiesTab(body, dialog) {
  let filter = "";
  const render = async () => {
    const d = must(await sb.rpc("news_admin_stories", { p_status: filter || null, p_language: null, p_limit: 150 }));
    const b = d.budget || {};
    const enabled = b.enabled === true;
    const counts = d.counts || {};
    const tabs = [["", "الكل"], ["draft", "مسودات"], ["approved", "معتمدة"], ["scheduled", "مجدولة"], ["published", "منشورة"], ["rejected", "مرفوضة"], ["unpublished", "مسحوبة"]];
    body.replaceChildren(
      h("p", { class: "note" }, "الكاتب الآلي يكتب مسودات أصلية فقط من العناوين والمقتطفات المخزّنة لكل حدث مهم. لا يُنشر أي تقرير قبل أن يعتمده محرر. ",
        "تُحذف تلقائياً كل جملة تحتوي رقماً أو اقتباساً أو اسماً غير موجود في المصادر، أو تنسخ 8 كلمات متتالية منها."),
      h("div", { class: "toolbar" },
        h("label", { class: "chip" }, h("input", { type: "checkbox", checked: enabled, onchange: async (e) => {
          try { must(await sb.from("news_settings").update({ value: e.target.checked }).eq("key", "story_enabled")); toast(e.target.checked ? "شُغّل الكاتب الآلي (مسودات فقط)" : "أُوقف الكاتب الآلي"); render(); }
          catch (er) { toast(errText(er)); e.target.checked = !e.target.checked; }
        } }), " تشغيل الكاتب الآلي"),
        h("button", { class: "btn", type: "button", onclick: async (e) => {
          e.target.disabled = true; toast("يجري البحث عن أحداث مؤهلة… قد يستغرق دقيقة");
          try { const r = must(await sb.functions.invoke("news-stories", { body: {} })); toast(`مسودات جديدة: ${r.drafted ?? 0} · تحديثات مقترحة: ${r.proposed ?? 0} · معلومات غير كافية: ${r.insufficient ?? 0}`, 6000); render(); }
          catch (er) { toast(errText(er)); } finally { e.target.disabled = false; }
        } }, "اكتب الآن")),
      h("p", { class: "budget-line num" }, `استخدام الذكاء الاصطناعي للتقارير: اليوم ${b.today ?? 0}/${b.daily_limit ?? "—"} · هذا الشهر ${b.month ?? 0}/${b.monthly_limit ?? "—"} — كل الاستخدام هذا الشهر ${b.ai_month ?? 0}/${b.ai_monthly_limit ?? "بلا حد"}. الحدود قابلة للتعديل في «الإعدادات».`),
      h("div", { class: "toolbar" }, tabs.map(([k, v]) => h("button", { class: "btn", type: "button", "aria-pressed": String(filter === k), onclick: () => { filter = k; render(); } },
        v, k && counts[k] ? ` (${counts[k]})` : !k ? ` (${Object.values(counts).reduce((a, x) => a + x, 0)})` : ""))),
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["التقرير", "الحالة", "تحقق", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, d.rows.length ? d.rows.map((s) => h("tr", {},
          h("td", {}, h("b", { dir: "auto" }, s.title),
            h("span", { class: "sub" }, `${s.language === "en" ? "English" : "عربي"} · ${CAT_NAME[s.category] || ""} · ${s.source_count} مصادر / ${s.publisher_count} جهات · ${s.word_count} كلمة · ${s.origin === "ai" ? "مسودة آلية" : "تحرير"} · حُدّث ${ago(s.updated_at)}`)),
          h("td", {}, h("span", { class: s.status === "published" ? "status-ok" : s.status === "rejected" || s.status === "unpublished" ? "status-bad" : "status-warn" }, STORY_STATUS[s.status]),
            s.status === "scheduled" && s.publish_at ? h("span", { class: "sub" }, "يُنشر " + full(s.publish_at)) : null,
            s.has_pending ? h("span", { class: "sub", style: "color:var(--accent-ink)" }, "تحديث مقترح بانتظار المراجعة") : null),
          h("td", {}, s.warnings ? h("span", { class: "status-warn" }, `${s.warnings} تحذير`) : h("span", { class: "sub" }, "—")),
          h("td", {}, h("div", { class: "row-actions" },
            h("button", { class: "btn btn-primary", type: "button", onclick: () => editor(s.id, dialog, render) }, "مراجعة وتحرير"),
            h("a", { class: "btn", href: storyHref(s.id), target: "_blank" }, "معاينة"))))) : h("tr", {}, h("td", { colspan: "4", class: "state" }, "لا تقارير بعد."))))),
      h("details", { style: "margin-top:16px" }, h("summary", {}, "آخر محاولات الكاتب الآلي"),
        h("div", { class: "table-wrap" }, h("table", {}, h("tbody", {}, (d.attempts || []).map((a) => h("tr", {},
          h("td", { class: "num" }, full(a.created_at)), h("td", {}, `${a.event_key || "—"} / ${a.language || ""}`),
          h("td", { class: a.outcome === "drafted" || a.outcome === "redrafted" || a.outcome === "update_proposed" ? "status-ok" : a.outcome === "error" ? "status-bad" : "status-warn" }, a.outcome),
          h("td", {}, h("span", { class: "sub" }, a.reason || "")))))))));
  };
  await render();
}

/* ---------- editor ---------- */
async function editor(id, dialog, after) {
  const s = must(await sb.rpc("news_admin_story", { p_id: id }));
  if (!s) return toast("التقرير غير موجود");
  const L_ = (ar, en) => (s.language === "en" ? en : ar);
  const isPublic = s.status === "published" || (s.status === "scheduled" && new Date(s.publish_at) <= new Date());
  const gen = s.generation || {};
  const warnings = gen.warnings || [];
  const field = (label, el) => h("label", { class: "field" }, label, el);
  const title = h("input", { value: s.title, maxlength: "200", dir: "auto" });
  const dek = h("textarea", { maxlength: "600", dir: "auto", style: "min-height:70px" }, s.dek);
  const bodySrc = h("textarea", { class: "body-src", dir: "auto", spellcheck: "true" }, bodyToText(s.body));
  const cat = h("select", {}, CATEGORIES.map(([k, v]) => h("option", { value: k, selected: s.category === k }, v)));
  const countries = h("input", { value: (s.countries || []).join(", "), dir: "ltr", placeholder: "JP, US" });
  const hero = h("input", { value: s.hero_image_url || "", dir: "ltr", placeholder: "https://…" });
  const credit = h("input", { value: s.hero_image_credit || "", placeholder: "مصدر الصورة / صاحب الحقوق" });
  const byline = h("input", { value: s.byline === "editorial" ? "" : s.byline, placeholder: "فريق تحرير لحظة (افتراضي)" });
  const changeKind = h("select", {}, [["", "— نوع التعديل —"], ["minor", "تعديل طفيف (إملاء/صياغة، دون ملاحظة للقراء)"], ["correction", CORRECTION.correction], ["update", CORRECTION.update], ["clarification", CORRECTION.clarification]]
    .map(([v, t]) => h("option", { value: v }, t)));
  const changeNote = h("input", { maxlength: "1000", placeholder: "ملاحظة للقراء: ماذا صُحّح أو حُدّث ولماذا" });
  const ack = h("input", { type: "checkbox" });
  const when = h("input", { type: "datetime-local" });
  const reason = h("input", { maxlength: "500", placeholder: "السبب (للرفض أو السحب)" });
  const srcPub = h("input", { placeholder: "اسم الجهة" }), srcUrl = h("input", { dir: "ltr", placeholder: "https://…" }), srcTitle = h("input", { placeholder: "العنوان (اختياري)" });
  const out = h("p", { class: "note", role: "alert" });
  const KIND = kindLabels(s.language), SECTION = sectionLabels(s.language);

  const act = async (fn, ok) => { out.textContent = ""; try { await fn(); toast(ok); d.close(); after(); } catch (e) { out.textContent = errText(e); } };
  const transition = (action, extra = {}) => act(async () => must(await sb.rpc("news_story_transition", { p_id: id, p_action: action, p_ack_warnings: ack.checked, ...extra })),
    { approve: "اعتُمد", publish: "نُشر", schedule: "جُدول", reject: "رُفض", unpublish: "سُحب من النشر", to_draft: "أُعيد إلى المسودات", apply_update: "طُبّق التحديث", discard_update: "تُجوهل التحديث" }[action] || "تم");
  const save = () => act(async () => {
    const { body: b, errors } = textToBody(bodySrc.value);
    if (errors.length) throw new Error(errors.slice(0, 4).join(" · "));
    const patch = { title: title.value.trim(), dek: dek.value.trim(), body: b, category: cat.value,
      countries: countries.value.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
      hero_image_url: hero.value.trim(), hero_image_credit: credit.value.trim(), byline: byline.value.trim() };
    if (patch.hero_image_url && !/^https:\/\//.test(patch.hero_image_url)) throw new Error("رابط الصورة يجب أن يبدأ بـ https://");
    if (patch.hero_image_url && patch.hero_image_credit.length < 2) throw new Error("اذكر مصدر الصورة وصاحب حقوقها");
    must(await sb.rpc("news_story_save", { p_id: id, p_patch: patch, p_change: changeKind.value || null, p_note: changeNote.value.trim() || null }));
  }, "حُفظ");

  const statusInfo = h("p", { class: "note" },
    `الحالة: ${STORY_STATUS[s.status]} · ${s.language === "en" ? "English" : "عربي"} · أُنشئ ${full(s.created_at)}`,
    s.approved_by_email ? ` · اعتمده ${s.approved_by_email} ${s.approved_at ? full(s.approved_at) : ""}` : "",
    s.status_note ? ` · ملاحظة: ${s.status_note}` : "",
    s.sibling ? [" · ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); d.close(); editor(s.sibling.id, dialog, after); } }, `النسخة ${s.sibling.language === "en" ? "الإنجليزية" : "العربية"} (${STORY_STATUS[s.sibling.status]})`)] : "");

  const warnBox = warnings.length ? h("div", { class: "warnings" },
    h("b", {}, `تحذيرات المدقق الآلي (${warnings.length}) — تحقق منها مقابل المصادر قبل الاعتماد:`),
    h("ul", {}, warnings.map((w) => h("li", {}, h("code", {}, w.where), " ", w.detail || w.code))),
    h("label", {}, ack, " تحققت من هذه النقاط مقابل المصادر")) : null;
  const rejected = gen.rejected || [];
  const rejectedBox = rejected.length ? h("details", {}, h("summary", {}, `فقرات حذفها المدقق (${rejected.length}) — لم تُنشر`),
    h("ul", { class: "note" }, rejected.map((r) => h("li", {}, h("code", {}, `${r.where} · ${r.code}`), " ", r.detail)))) : null;

  const pending = s.pending_body ? h("details", { open: true, class: "warnings" },
    h("summary", {}, h("b", {}, "تحديث مقترح من مصادر جديدة — لا يظهر للقراء حتى تطبّقه")),
    s.pending_title ? h("p", {}, h("b", {}, "العنوان المقترح: "), s.pending_title) : null,
    s.pending_dek ? h("p", {}, h("b", {}, "المقدمة المقترحة: "), s.pending_dek) : null,
    h("textarea", { class: "body-src", readonly: true, dir: "auto" }, bodyToText(s.pending_body)),
    (gen.pending_warnings || []).length ? h("ul", {}, gen.pending_warnings.map((w) => h("li", {}, h("code", {}, w.where), " ", w.detail || w.code))) : null,
    h("div", { class: "toolbar" },
      h("button", { class: "btn btn-primary", type: "button", onclick: () => transition("apply_update", { p_note: changeNote.value.trim() || null }) }, "تطبيق التحديث"),
      h("button", { class: "btn", type: "button", onclick: () => transition("discard_update") }, "تجاهل"))) : null;

  const refs = h("div", { class: "refs" }, h("b", {}, "المصادر (استخدم أرقامها في {…}):"),
    h("ol", {}, (s.sources || []).map((x) => h("li", { value: x.n, style: x.pending ? "opacity:.6" : "" },
      h("b", {}, x.publisher_name), " — ", h("span", { dir: "auto" }, x.title || ""), " ",
      h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer" }, "↗"), x.pending ? " (للتحديث المقترح)" : "",
      x.verification && x.verification !== "reported" ? ` · ${x.verification}` : ""))),
    h("div", { class: "toolbar" }, srcPub, srcUrl, srcTitle, h("button", { class: "btn", type: "button", onclick: async () => {
      try { const n = must(await sb.rpc("news_story_add_source", { p_id: id, p_publisher: srcPub.value.trim(), p_url: srcUrl.value.trim(), p_title: srcTitle.value.trim() || null }));
        toast(`أُضيف المصدر رقم ${n}`); d.close(); editor(id, dialog, after); } catch (e) { out.textContent = errText(e); }
    } }, "إضافة مصدر")));

  const help = h("details", {}, h("summary", {}, "طريقة كتابة النص"),
    h("pre", { class: "note", dir: "ltr", style: "white-space:pre-wrap" },
      "## event\n[fact] نص الفقرة {1,2}\n[statement] ... {3}\n\n## analysis\n[analysis] شرح دون وقائع جديدة\n\n## timeline\n2026-11-06T09:05:00Z | تطور {1}\n\n" +
      "الأقسام: " + KEYS.map((k) => `${k} (${SECTION[k]})`).join("، ") + "\nالأنواع: " + KINDS.map((k) => `${k} (${KIND[k].label})`).join("، ")));

  const editBox = h("div", { class: "story-editor" },
    statusInfo, warnBox, rejectedBox, pending,
    field("العنوان", title), field("المقدمة", dek),
    field("نص التقرير", bodySrc), help, refs,
    h("div", { class: "form-grid" }, field("القسم", cat), field("الدول (رموز ISO)", countries), field("صورة رئيسية (https، من مصدر يسمح بذلك)", hero), field("حقوق الصورة", credit), field("التوقيع", byline)),
    isPublic ? h("div", { class: "form-grid" }, field("نوع التعديل (مطلوب لأن التقرير منشور)", changeKind), field("ملاحظة للقراء", changeNote)) : null,
    h("div", { class: "toolbar" },
      h("button", { class: "btn btn-primary", type: "button", onclick: save }, "حفظ التعديلات"),
      h("a", { class: "btn", href: storyHref(id), target: "_blank" }, "معاينة"),
      h("button", { class: "btn", type: "button", onclick: async (e) => {
        e.target.disabled = true; out.textContent = "يجري إعادة الكتابة من أحدث التغطيات…";
        try { const r = must(await sb.functions.invoke("news-stories", { body: { story_id: id } }));
          out.textContent = r.drafted || r.proposed ? "جاهز — أعد فتح التقرير." : "لم تُكتب نسخة جديدة: " + (r.details || []).join(" · ") + (r.insufficient ? " (معلومات غير كافية)" : r.rejected ? " (رفض المدقق المسودة)" : "");
          if (r.drafted || r.proposed) { d.close(); after(); }
        } catch (er) { out.textContent = errText(er); } finally { e.target.disabled = false; }
      } }, s.status === "draft" ? "إعادة الكتابة بالمصادر الحالية" : "اقتراح تحديث من مصادر جديدة"),
      h("button", { class: "btn", type: "button", onclick: () => historyView(id, dialog) }, "سجل التعديلات")),
    h("hr"),
    h("div", { class: "toolbar" },
      ["draft", "rejected", "unpublished"].includes(s.status) ? h("button", { class: "btn", type: "button", onclick: () => transition("approve") }, "اعتماد (دون نشر)") : null,
      s.status !== "published" && s.status !== "rejected" ? h("button", { class: "btn btn-primary", type: "button", onclick: () => transition("publish") }, "اعتماد ونشر الآن") : null,
      s.status !== "published" && s.status !== "rejected" ? [when, h("button", { class: "btn", type: "button", onclick: () => {
        if (!when.value) { out.textContent = "اختر وقت النشر"; return; }
        transition("schedule", { p_publish_at: new Date(when.value).toISOString() });
      } }, "جدولة النشر")] : null),
    h("div", { class: "toolbar" }, reason,
      ["draft", "approved", "scheduled"].includes(s.status) ? h("button", { class: "btn btn-danger", type: "button", onclick: () => transition("reject", { p_note: reason.value.trim() }) }, "رفض") : null,
      ["published", "scheduled"].includes(s.status) ? h("button", { class: "btn btn-danger", type: "button", onclick: () => transition("unpublish", { p_note: reason.value.trim() }) }, "سحب من النشر") : null,
      ["approved", "rejected", "unpublished"].includes(s.status) ? h("button", { class: "btn", type: "button", onclick: () => transition("to_draft") }, "إعادة إلى المسودات") : null),
    (s.corrections || []).length ? h("details", {}, h("summary", {}, `التصحيحات والملاحظات (${s.corrections.length})`),
      h("ul", { class: "note" }, s.corrections.map((c) => h("li", {}, `${full(c.created_at)} · ${CORRECTION[c.kind] || "ملاحظة داخلية"}: ${c.note}`)))) : null,
    out);
  const d = dialog(L_("مراجعة التقرير", "مراجعة التقرير (إنجليزي)"), editBox, null);
  d.classList.add("wide");
}

async function historyView(id, dialog) {
  const rows = must(await sb.from("news_story_revisions").select("id,changed_by,action,snapshot,created_at").eq("story_id", id).order("created_at", { ascending: false }).limit(60));
  dialog("سجل التعديلات", h("ul", { class: "mini-list" }, rows.map((r) => h("li", {},
    h("span", { class: "t num" }, full(r.created_at)), ` · ${r.action} · ${STORY_STATUS[r.snapshot?.status] || ""}`,
    h("div", { class: "note", dir: "auto" }, r.snapshot?.title || ""),
    h("details", {}, h("summary", {}, "النص في هذه النسخة"), h("pre", { class: "note", style: "white-space:pre-wrap", dir: "auto" }, bodyToText(r.snapshot?.body)))))), null);
}
