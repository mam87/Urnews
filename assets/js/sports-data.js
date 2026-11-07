// Sports data layer: provider adapters + cache + retry/backoff + rate awareness.
// The UI only calls the functions exported here, so another provider can be added by writing one
// more adapter with the same methods and listing it in PROVIDERS (first healthy one wins per call).
//
// Provider: SportScore public API (https://sportscore.com/developers/) — free, key-less, CORS-open,
// ~10,000 requests / 24 h per IP (each reader's browser has its own quota), responses edge-cached 60 s.
// Terms: a visible "Powered by SportScore" link must be shown wherever its data is displayed (ATTRIBUTION).
// Nothing here is ever fabricated: on failure the last good copy is shown and marked as delayed, or an error.

export const ATTRIBUTION = { href: "https://sportscore.com/", label: "Powered by SportScore", title: "Sports data by SportScore" };

const sportscore = {
  id: "sportscore",
  base: "https://sportscore.com",
  // path + query for each operation; null params are dropped
  ops: {
    fixtures: ({ sport, date, competition, team, status, limit }) => ["/api/v1/fixtures/", { sport, date, competition, team, status, limit: limit ?? 200 }],
    match: ({ sport, slug }) => ["/api/widget/match/", { sport, slug }],
    team: ({ sport, slug, limit }) => ["/api/widget/team/", { sport, slug, limit: limit ?? 30 }],
    standings: ({ sport, slug }) => ["/api/widget/standings/", { sport, slug }],
    scorers: ({ sport, slug, stat, limit }) => ["/api/widget/topscorers/", { sport, slug, stat: stat || "goals", limit: limit ?? 15 }],
    player: ({ sport, slug }) => ["/api/widget/player/", { sport, slug }],
    bracket: ({ sport, slug }) => ["/api/widget/bracket/", { sport, slug }],
    search: ({ sport, q, limit }) => ["/api/v1/search/", { sport, q, limit: limit ?? 8 }],
  },
  normalize: {
    // scores arrive as strings ("2") or null; keep null as "not available", never 0
    match: (m) => m && ({
      home: m.home, away: m.away, homeLogo: m.home_logo || "", awayLogo: m.away_logo || "",
      homeScore: num(m.home_score), awayScore: num(m.away_score),
      status: ["live", "finished", "upcoming"].includes(m.status) ? m.status : (m.status || "unknown"),
      statusText: m.status_text || "", time: m.time || null, competition: m.competition || "", competitionLogo: m.competition_logo || "",
      slug: matchSlug(m.url), url: m.url ? "https://sportscore.com" + m.url : null,
      minute: m.live_minute ?? null, htHome: num(m.home_ht_score), htAway: num(m.away_ht_score),
      incidents: Array.isArray(m.incidents) ? m.incidents : [], stats: Array.isArray(m.stats) ? m.stats : [], lineups: m.lineups || null,
    }),
  },
};

const PROVIDERS = [sportscore];

function num(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
/** "/football/match/real-betis-vs-elche/dn1m1ghlz1o5moe/" → "real-betis-vs-elche" (the slug the match endpoint accepts). */
export function matchSlug(url) {
  const m = /\/match\/([^/]+)\//.exec(url || "");
  return m ? m[1] : null;
}

// ---------- cache (memory + sessionStorage) ----------
const TTL = { live: 30e3, fixtures: 120e3, match: 60e3, team: 300e3, standings: 600e3, scorers: 1800e3, player: 3600e3, bracket: 1800e3, search: 600e3 };
const mem = new Map();
const inflight = new Map();
const SKEY = "lahza-sports:";
const readCache = (k) => {
  if (mem.has(k)) return mem.get(k);
  try { const v = JSON.parse(sessionStorage.getItem(SKEY + k) || "null"); if (v) mem.set(k, v); return v; } catch { return null; }
};
const writeCache = (k, v) => {
  mem.set(k, v);
  try { sessionStorage.setItem(SKEY + k, JSON.stringify(v)); } catch { /* quota or disabled: memory only */ }
};

// ---------- rate awareness ----------
// A soft daily budget per browser, far below the provider's per-IP allowance; past it, only cached data is shown.
const DAILY_BUDGET = 3000;
const budgetKey = () => "lahza-sports-budget:" + new Date().toISOString().slice(0, 10);
function spend() {
  try {
    const k = budgetKey(); const n = Number(localStorage.getItem(k) || 0) + 1;
    localStorage.setItem(k, String(n)); return n <= DAILY_BUDGET;
  } catch { return true; }
}
let coolUntil = 0; // set after repeated provider overload (503/429); calls in the window use cache only

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, { timeout = 12000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" }, credentials: "omit", referrerPolicy: "strict-origin-when-cross-origin" });
    const type = r.headers.get("content-type") || "";
    if (r.status === 404) { const e = new Error("not_found"); e.code = "not_found"; throw e; }
    // the provider answers overload with an HTML "high traffic" page (503) — transient
    if (r.status === 429 || r.status >= 500 || !type.includes("json")) { const e = new Error("unavailable"); e.code = "unavailable"; e.status = r.status; throw e; }
    if (!r.ok) { const e = new Error("http_" + r.status); e.code = "bad_request"; throw e; }
    return await r.json();
  } catch (e) {
    if (e.name === "AbortError") { const x = new Error("timeout"); x.code = "unavailable"; throw x; }
    if (!e.code) e.code = "network";
    throw e;
  } finally { clearTimeout(t); }
}

const qs = (o) => Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

/**
 * Run an operation. Returns { data, fetchedAt, stale, error, provider }.
 * - fresh cache → returned without a request
 * - request fails → up to 2 retries with exponential backoff + jitter (transient errors only)
 * - still failing → last cached copy with stale:true, or data:null with error code
 */
async function run(op, params, { ttlKind = op, force = false } = {}) {
  const key = op + "?" + qs(params);
  const cached = readCache(key);
  const ttl = TTL[ttlKind] ?? 120e3;
  if (!force && cached && Date.now() - cached.at < ttl) return { data: cached.data, fetchedAt: cached.at, stale: false, error: null, provider: cached.p };
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    let lastErr = null;
    for (const prov of PROVIDERS) {
      const build = prov.ops[op];
      if (!build) continue;
      if (Date.now() < coolUntil || !spend()) { lastErr = Object.assign(new Error("rate_limited"), { code: "rate_limited" }); break; }
      const [path, q] = build(params);
      const url = prov.base + path + "?" + qs(q);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const data = await fetchJson(url);
          writeCache(key, { at: Date.now(), data, p: prov.id });
          return { data, fetchedAt: Date.now(), stale: false, error: null, provider: prov.id };
        } catch (e) {
          lastErr = e;
          if (e.code === "not_found" || e.code === "bad_request") break;
          if (attempt < 2) await sleep(800 * 2 ** attempt + Math.random() * 400);
        }
      }
      if (lastErr?.code === "unavailable") coolUntil = Date.now() + 20e3;
    }
    if (cached) return { data: cached.data, fetchedAt: cached.at, stale: true, error: lastErr?.code || "unavailable", provider: cached.p };
    return { data: null, fetchedAt: null, stale: false, error: lastErr?.code || "unavailable", provider: null };
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const norm = (fn) => async (...a) => { const r = await fn(...a); return r; };
const N = sportscore.normalize.match;

export const sports = {
  /** Matches for one UTC day (YYYY-MM-DD), optionally one competition / team / status. */
  fixtures: norm(async ({ sport = "football", date, competition, team, status, live = false, force = false } = {}) => {
    const r = await run("fixtures", { sport, date, competition, team, status, limit: 200 }, { ttlKind: live ? "live" : "fixtures", force });
    return { ...r, data: r.data ? (r.data.matches || []).map(N) : null };
  }),
  match: async ({ sport = "football", slug, live = false, force = false }) => {
    const r = await run("match", { sport, slug }, { ttlKind: live ? "live" : "match", force });
    return { ...r, data: r.data?.match ? { ...N(r.data.match), updated: r.data.updated || null } : null };
  },
  team: async ({ sport = "football", slug }) => {
    const r = await run("team", { sport, slug, limit: 30 });
    return { ...r, data: r.data ? { team: r.data.team, matches: (r.data.matches || []).map(N) } : null };
  },
  standings: async ({ sport = "football", slug }) => {
    const r = await run("standings", { sport, slug });
    return r;
  },
  scorers: async ({ sport = "football", slug, stat = "goals" }) => run("scorers", { sport, slug, stat, limit: 15 }),
  player: async ({ sport = "football", slug }) => run("player", { sport, slug }),
  bracket: async ({ sport = "football", slug }) => run("bracket", { sport, slug }),
  search: async ({ sport = "football", q }) => run("search", { sport, q, limit: 8 }),
};

/** Test hook: clear caches (used by the UI smoke test). */
export function _resetSportsCache() { mem.clear(); inflight.clear(); coolUntil = 0; }
