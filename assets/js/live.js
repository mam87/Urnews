// Live updates: Supabase Realtime broadcast (one small event per ingest run) with polling fallback.
// The browser never receives full articles over the socket — it asks the REST API for rows newer
// than the newest one it already has, so reconnects can't create duplicates or gaps.
import { sb } from "./common.js";

const POLL_LIVE_MS = 180_000;   // safety net while the socket is healthy
const POLL_FALLBACK_MS = 45_000; // when realtime is unavailable

export class Live {
  constructor({ onTick, onChanged, onState }) {
    this.onTick = onTick;         // async () => void   — fetch newer rows
    this.onChanged = onChanged;   // async (id) => void — an article was edited
    this.onState = onState;       // (state) => void
    this.paused = false;
    this.rt = "connecting";
    this.timer = null;
    this.pending = null;
    this.channel = null;
  }

  start() {
    this.channel = sb.channel("news-feed", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "new_articles" }, () => this.kick())
      .on("broadcast", { event: "article_changed" }, ({ payload }) => payload?.id && this.onChanged?.(payload.id))
      .subscribe((status) => {
        this.rt = status === "SUBSCRIBED" ? "live" : (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") ? "down" : this.rt;
        if (status === "SUBSCRIBED") this.kick(); // catch up anything missed while disconnected
        this.schedule();
        this.emit();
      });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { clearTimeout(this.timer); this.timer = null; }
      else { this.kick(); this.schedule(); }
    });
    addEventListener("online", () => { this.kick(); this.emit(); });
    addEventListener("offline", () => this.emit());
    this.schedule();
    this.emit();
  }

  schedule() {
    clearTimeout(this.timer);
    if (document.hidden) return;
    const ms = this.rt === "live" ? POLL_LIVE_MS : POLL_FALLBACK_MS;
    this.timer = setTimeout(async () => { await this.kick(); this.schedule(); }, ms);
  }

  /** Coalesce bursts into one request. */
  kick() {
    if (this.pending) return this.pending;
    this.pending = new Promise((r) => setTimeout(r, 400))
      .then(() => this.onTick())
      .catch(() => {})
      .finally(() => { this.pending = null; });
    return this.pending;
  }

  setPaused(p) { this.paused = p; this.emit(); }

  state() {
    if (!navigator.onLine) return "offline";
    if (this.paused) return "paused";
    return this.rt === "live" ? "live" : "polling";
  }
  emit() { this.onState?.(this.state()); }
}
