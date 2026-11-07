// Monetization hooks, all controlled from admin → الإعدادات (news_settings, public keys) and OFF by default:
//  * adSlot(name)     — a clearly labelled "Advertisement" box; renders only "house" ads (your own promotions or a
//                       direct sponsor: text + link + optional image). Never pop-ups, never in the middle of a headline.
//  * newsletterBox()  — e-mail sign-up with explicit consent, stored via news_newsletter_subscribe().
// When a feature is off these return null and nothing is drawn (no empty boxes, no layout shift).
import { sb, h, configured, toast } from "./common.js";
import { EN, L } from "./i18n.js";

let cfgPromise = null;
function config() {
  if (!configured) return Promise.resolve({ ads: null, newsletter: false });
  if (!cfgPromise) {
    cfgPromise = sb.from("news_settings").select("key,value").in("key", ["ads_config", "newsletter_enabled"])
      .then(({ data, error }) => {
        if (error) return { ads: null, newsletter: false };
        const m = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
        return { ads: m.ads_config && m.ads_config.enabled === true ? m.ads_config : null, newsletter: m.newsletter_enabled === true };
      }).catch(() => ({ ads: null, newsletter: false }));
  }
  return cfgPromise;
}

const https = (u) => typeof u === "string" && /^https:\/\//.test(u);

/** Resolves to an element (or null) for slot `name` ("home_side" | "article" | "sports"). */
export async function adSlot(name) {
  const { ads } = await config();
  if (!ads || !Array.isArray(ads.slots) || !ads.slots.includes(name)) return null;
  const pool = (Array.isArray(ads.house) ? ads.house : []).filter((a) => a && https(a.url) && (a.title_ar || a.title_en));
  if (!pool.length) return null;
  const a = pool[Math.floor(Math.random() * pool.length)];
  const title = (EN ? a.title_en || a.title_ar : a.title_ar || a.title_en) || "";
  const text = EN ? a.text_en || a.text_ar : a.text_ar || a.text_en;
  return h("aside", { class: "ad-slot", "aria-label": L("إعلان", "Advertisement"), dataset: { slot: name } },
    h("span", { class: "ad-label" }, L("إعلان", "Advertisement"), a.sponsor ? h("span", {}, " · ", L("برعاية ", "Sponsored by "), a.sponsor) : null),
    h("a", { href: a.url, target: "_blank", rel: "sponsored noopener" },
      https(a.image) ? h("img", { src: a.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer", onerror: (e) => e.target.remove() }) : null,
      h("b", {}, title), text ? h("span", {}, text) : null));
}

/** Resolves to the newsletter sign-up box, or null when sign-ups are switched off. */
export async function newsletterBox() {
  const { newsletter } = await config();
  if (!newsletter) return null;
  const email = h("input", { type: "email", required: true, maxlength: "254", autocomplete: "email", placeholder: L("بريدك الإلكتروني", "Your e-mail"), "aria-label": L("البريد الإلكتروني", "E-mail") });
  const consent = h("input", { type: "checkbox", required: true });
  const btn = h("button", { class: "btn btn-primary", type: "submit" }, L("اشترك", "Subscribe"));
  const msg = h("p", { class: "note", role: "status" });
  const form = h("form", { class: "newsletter" },
    h("h2", {}, L("نشرة لحظة البريدية", "Lahza newsletter")),
    h("p", { class: "note" }, L("أهم أخبار العالم مختصرة في بريدك. يمكنك إلغاء الاشتراك في أي وقت.", "The day's top world news, briefly, in your inbox. Unsubscribe any time.")),
    h("div", { class: "nl-row" }, email, btn),
    h("label", { class: "nl-consent" }, consent, L("أوافق على حفظ بريدي لإرسال النشرة فقط، ولن يُشارك مع أي جهة.", "I agree to my e-mail being stored only to send the newsletter; it is never shared.")),
    msg);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    const { data, error } = await sb.rpc("news_newsletter_subscribe", { p_email: email.value, p_language: EN ? "en" : "ar", p_consent: consent.checked });
    btn.disabled = false;
    const text = error ? L("تعذّر الاشتراك الآن، حاول لاحقاً.", "Could not subscribe right now; please try later.")
      : { ok: L("شكراً! سجّلنا اشتراكك، وستصلك النشرة عند انطلاقها.", "Thanks! You're on the list; the newsletter will reach you when it launches."),
          invalid: L("تحقق من عنوان البريد.", "Please check the e-mail address."), consent_required: L("يلزم الموافقة على حفظ البريد.", "Please tick the consent box."),
          busy: L("ضغط مؤقت، حاول بعد دقيقة.", "Busy, please try again in a minute."), closed: L("الاشتراك مغلق حالياً.", "Sign-ups are closed right now.") }[data] || "";
    msg.textContent = text;
    if (data === "ok") { form.reset(); toast(text); }
  });
  return form;
}

/** Append a slot to `parent` when it resolves (keeps pages fast: never blocks rendering). */
export function mount(parent, promise) { promise.then((el) => { if (el && parent.isConnected !== false) parent.append(el); }).catch(() => {}); }
