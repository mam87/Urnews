# Lahza (Urnews) upgrade — implementation report, 2026-11-07

Scope: the "URNEWS master prompt" (phases 1–12). Live site: https://mam87.github.io/Urnews/ — Supabase project
`ghxnmnydeuvnrsulywbj`. Everything below is deployed (GitHub Pages from `main`, migrations 25–27 applied).

## 1. Audit result (phase 1)
Already present and kept unchanged: automated global news engine (51 enabled RSS sources, ~2,000 reports/day,
de-duplication, cross-language event grouping, 0–100 importance ranking with no country bias, verification labels,
breaking ticker), Arabic/English editions, dark mode, reader settings, search, country/region filters, live TV,
weather, article pages with source attribution, admin dashboard, and AI full reports with a fact/copy validator
(drafts only). Phases 2, 8 (search) and 9 were therefore largely complete; work went into the gaps.

## 2. Features completed
| Phase | What | Where |
|---|---|---|
| 3 | AI full-report writer switched **on** (drafts only, editor approval) | admin → التقارير الكاملة |
| 4–5 | **Sports centre**: live scores (football, basketball, tennis, cricket), fixtures by day, live minute, goals/cards/subs, half-time, tables, top scorers, assists, World Cup bracket, team pages (form, fixtures), player stats, search, related Lahza news | `sports.html` |
| 6 | **Lahza Reels**: full-screen YouTube Shorts from 21 verified publishers, official privacy-enhanced embed, one player at a time, sound/captions/pause, filters, share, related story | `reels.html` |
| 7 | **World news map**: countries shaded by coverage (6 h/24 h/7 d), themes, breaking outline, country panel, ranked list | `map.html` |
| 8 | **My Lahza**: saved stories/reports, follow countries & sections, "For you" feed — on the device, no account | `mine.html`, Save/Follow buttons |
| 11 | Monetization readiness: labelled house-ad slots, sponsor label, newsletter sign-up with consent + CSV export — all **off** | admin → الإعدادات, `guide/MONETIZATION.md` |
| 9 | Navigation: Sports, Reels, Map, My Lahza in the section bar, top strip, footer; mobile bottom bar now Home · Breaking · Live · Reels · Sports | `layout.js` |

## 3. Files
New: `sports.html`, `reels.html`, `map.html`, `mine.html`; `assets/js/{sports,sports-data,sports-names,reels,map,mine,saved,monetize}.js`;
`assets/world-map.json`; `scripts/gen-world-map.mjs`; migrations `…25_reels.sql`, `…26_map_counts.sql`, `…27_monetization_ready.sql`;
tests `tests/ui/{sports,reels,map-mine,monetize}-smoke.mjs`; guides `SPORTS.md`, `REELS.md`, `MONETIZATION.md`, this report.
Changed: `assets/app.css`, `assets/js/{layout,home,article,story-view,admin}.js`, `README.md`.

## 4. External data and APIs
| Service | Used for | Key? | Cost / limits |
|---|---|---|---|
| SportScore public API | all sports data | none | free, ~10,000 req/24 h **per reader IP**; must show "Powered by SportScore" (shown); may return 503 under load (handled) |
| YouTube public Shorts feeds | Reels list | none | free; polled every 10 min by the database (21 requests) |
| YouTube embedded player (`youtube-nocookie.com`) | Reels playback | none | free; a publisher may disable embedding → "Watch on YouTube" link |
| Natural Earth via world-atlas | map shapes (built once, stored in repo) | none | public domain |
| Existing: Supabase, RSS feeds, Gemini (AI), Open-Meteo | unchanged | AI key stays in Supabase secrets | AI ≈ 18k req/month of the free quota |

Evaluated and **not** used: "SportAPI" (`api.sports-api.net`) — 100 req/day free, key needed, live data paid ($59+/mo);
Instagram Reels / TikTok feeds — no free public publisher feed, scraping against their terms.

## 5. Not completed / limits (honest list)
* **AI article for every news item** (phase 3 as written): not feasible on the free AI quota and would mean rewriting
  ~2,000 reports/day from short excerpts. The writer covers important events with 2+ independent publishers; on the
  first run it produced 1 draft, rejected 9 outputs that failed the fact/copy checks and skipped 2 for thin material.
  The draft waits for your review.
* Sports: injuries, suspensions, transfers, coaches and line-ups are not offered by the free provider, so not shown.
  No WebSocket — polling (30 s for live matches, only while the page is visible).
* Saved items and follows live in one browser; they don't sync across devices (would need accounts).
* Newsletter sending, third-party ads and premium tiers need providers/approval — documented, not connected.
* Reels sports channels are English; Arabic sports broadcasters can be added once their channel IDs are verified.

## 6. Known issues
* Team names: Arabic names exist for 72 well-known team spellings; others show the provider's English spelling.
* The map counts a story for its **first** tagged country; the automatic tagger can be wrong.
* Very small states (e.g. Bahrain, Singapore) are not drawn at 1:110m; they still appear in the ranked list.
* GitHub repo moved to `mam87/Urnews` (old lowercase URL redirects); the local remote was updated.

## 7. Testing
Mocked-backend browser tests (headless Chrome, Arabic RTL + English LTR, 390 px and desktop):
existing suite 198/198 · sports 41/41 · reels 21/21 · map + My Lahza 20/20 · monetization 8/8 — all passing.
Covered: provider overload (keeps last data, labelled delayed), provider outage with no cache (error, no scores), empty
days, live refresh, one-player rule, paging, deep links, consent handling, no horizontal overflow, no console errors.
Live checks: SportScore endpoints verified with real requests; 313 Reels collected from 21 channels with 0 errors;
`news_map_counts` returns data as the public (anon) role. Secret scan of the repository: only the public anon key.
Not run here: Deno unit tests of the Edge Functions (unchanged in this upgrade).

## 8. Deployment & operations
* Frontend: push to `main` → GitHub Pages. Database: migrations in `supabase/migrations/` (25–27 already applied).
* Scheduler jobs added: `news-videos` (every 10 min). Existing jobs unchanged.
* Turn off quickly: AI writer → `story_enabled=false`; a Reels channel → `update news_video_channels set enabled=false …`;
  ads/newsletter → settings back to `false`.
* Run tests: see README → Tests (`CHROME=/path/to/chrome` or `PW_CHROMIUM=…`).
