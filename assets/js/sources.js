// Sources & methodology page (transparency).
import { sb, h, configured, notConfiguredState, ago, VERIFICATION, friendlyError } from "./common.js";
import { renderChrome, fetchStatus } from "./layout.js";

const chrome = renderChrome({ active: "sources" });
const root = document.getElementById("app");
const KIND = { media: "وسيلة إعلام", agency: "وكالة أنباء", official: "جهة رسمية" };

async function boot() {
  const tableBody = h("tbody");
  root.replaceChildren(h("article", { class: "article", style: "max-width:900px" },
    h("h1", {}, "المصادر ومنهجية العمل"),
    h("p", {}, "يجمع موقع «لحظة» العناوين آلياً من خلاصات RSS العامة التي تنشرها المؤسسات الإخبارية بنفسها. لا نتجاوز أي جدار دفع أو حماية، ونحترم ملف robots.txt لكل موقع، ونعرض فقط العنوان ومقتطفاً قصيراً يوفره المصدر في خلاصته، مع رابط بارز للخبر الأصلي ووقت نشره الأصلي."),
    h("h2", {}, "علامات التحقق"),
    h("ul", {}, Object.entries(VERIFICATION).map(([, v]) => h("li", {}, h("b", {}, v.label + ": "), v.hint))),
    h("p", { class: "note" }, "هذه العلامات تُستنتج آلياً من صياغة الخبر ونوع المصدر، ولا يُعلَّم أي خبر «مؤكَّداً» إلا بقرار من محرر بشري. تكرار الخبر في عدة مواقع يجمعه الموقع كتغطيات للحدث نفسه لكنه لا يعني التأكيد."),
    h("h2", {}, "الذكاء الاصطناعي"),
    h("p", {}, "يُستخدم الذكاء الاصطناعي — إن فُعّل — للترجمة أو التلخيص المختصر فقط، ويُرفض أي ناتج يضيف أرقاماً أو اقتباسات غير موجودة في النص الأصلي. الملخصات الآلية موسومة بوضوح وليست اقتباساً."),
    h("h2", {}, "المصادر الحالية"),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "المصدر"), h("th", {}, "النوع"), h("th", {}, "الموثوقية"), h("th", {}, "آخر جلب ناجح"))),
      tableBody))));
  if (!configured) return notConfiguredState(tableBody);
  try {
    const { data, error } = await sb.from("news_sources").select("id,name_ar,homepage,kind,reliability,enabled,last_success_at").eq("enabled", true).order("name_ar");
    if (error) throw error;
    tableBody.replaceChildren(...data.map((s) => h("tr", {},
      h("td", {}, h("a", { href: s.homepage, target: "_blank", rel: "noopener noreferrer" }, s.name_ar)),
      h("td", {}, KIND[s.kind] || s.kind),
      h("td", { class: "num" }, "★".repeat(s.reliability) + "☆".repeat(5 - s.reliability)),
      h("td", { class: "num" }, s.last_success_at ? ago(s.last_success_at) : "—"))));
    const st = await fetchStatus().catch(() => null);
    chrome.setLiveState("polling", st?.last_run_at);
    chrome.refreshTicker();
  } catch (e) { tableBody.replaceChildren(h("tr", {}, h("td", { colspan: "4" }, friendlyError(e)))); }
}
boot();
