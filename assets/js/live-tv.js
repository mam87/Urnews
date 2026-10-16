// Live TV page: official YouTube live streams of news channels (click-to-play, nothing loads until asked).
import { sb, h, configured, friendlyError, notConfiguredState } from "./common.js";
import { renderChrome, fetchStatus, ICONS } from "./layout.js";

const chrome = renderChrome({ active: "live" });
const root = document.getElementById("app");
document.title = "البث المباشر — نبض الأخبار";

const embedUrl = (id) => `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(id)}&autoplay=1&mute=1&rel=0&modestbranding=1&playsinline=1`;
const youtubeLive = (c) => c.youtube_handle ? `https://www.youtube.com/${c.youtube_handle}/live`
  : c.youtube_channel_id ? `https://www.youtube.com/channel/${c.youtube_channel_id}/live` : null;

function channelCard(c) {
  const screen = h("div", { class: "screen" });
  const ext = youtubeLive(c) || c.official_live_url;
  const play = () => {
    // only one stream plays at a time to save data on mobile
    document.querySelectorAll(".live-card iframe").forEach((f) => f.closest(".screen")?.replaceChildren(idle(f.closest(".live-card")._channel)));
    screen.replaceChildren(h("iframe", {
      src: embedUrl(c.youtube_channel_id), title: `بث ${c.name_ar} المباشر`,
      allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true,
      referrerpolicy: "strict-origin-when-cross-origin", loading: "lazy",
    }));
  };
  const idle = (ch) => ch.youtube_channel_id
    ? h("button", { class: "play", type: "button", "aria-label": `تشغيل بث ${ch.name_ar}`, onclick: play },
        h("span", { class: "circle" }, ICONS.play()), h("span", {}, "اضغط للمشاهدة"))
    : h("a", { class: "play", href: ext, target: "_blank", rel: "noopener noreferrer" },
        h("span", { class: "circle" }, ICONS.play()), h("span", {}, "شاهد البث على يوتيوب ↗"));
  screen.append(idle(c));
  const card = h("article", { class: "live-card" },
    screen,
    h("div", { class: "meta" },
      h("b", {}, c.name_ar), h("span", { class: "live-badge" }, "مباشر"),
      h("div", { class: "tools" }, ext ? h("a", { class: "btn", href: ext, target: "_blank", rel: "noopener noreferrer" }, "يوتيوب", ICONS.ext()) : null)));
  card._channel = c;
  return card;
}

async function boot() {
  const grid = h("div", { class: "live-grid" });
  root.replaceChildren(
    h("div", { class: "section-head" }, h("h2", {}, "البث المباشر"), h("span", { class: "meta" }, "البث الرسمي للقنوات عبر يوتيوب")),
    grid,
    h("p", { class: "note", style: "margin-top:16px" },
      "يُعرض البث من القنوات الرسمية على يوتيوب كما تتيحه القناة. إذا كانت القناة لا تبث الآن أو تمنع التضمين، سيظهر ذلك داخل المشغّل؛ استخدم زر «يوتيوب» للمشاهدة هناك."));
  if (!configured) return notConfiguredState(grid);
  try {
    const { data, error } = await sb.from("news_live_channels").select("id,name_ar,youtube_channel_id,youtube_handle,official_live_url").eq("enabled", true).order("sort_order");
    if (error) throw error;
    grid.replaceChildren(...(data.length ? data.map(channelCard) : [h("div", { class: "state" }, "لا توجد قنوات مفعّلة حالياً.")]));
    const st = await fetchStatus().catch(() => null);
    chrome.setLiveState("polling", st?.last_run_at);
    chrome.refreshTicker();
  } catch (e) {
    grid.replaceChildren(h("div", { class: "error-box" }, friendlyError(e)));
  }
}
boot();
