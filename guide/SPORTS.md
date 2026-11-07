# Sports centre («المركز الرياضي») — `sports.html`

Live scores, fixtures and results by day, league tables, top scorers and assists, knockout brackets, a match
centre (goals, cards, substitutions, half-time score) and team / player pages, each with related Lahza news.
Arabic RTL and English LTR, mobile first. Added 2026-11-07.

## Data provider (evaluated 2026-11-07)
| Candidate | Result |
|---|---|
| **SportScore** (`sportscore.com`) | **Integrated.** Free, no key, CORS `*`, ~10,000 requests / 24 h **per IP** (each reader's browser has its own allowance), edge cache 60 s. Football, basketball, tennis, cricket. Terms: a visible "Powered by SportScore" link on every page that shows its data (shown in the footer of every sports view). Allowed: caching, combining with other data, monetised sites with the attribution. Not allowed: re-publishing the raw feed or bulk datasets. |
| "SportAPI" (`api.sports-api.net`) | **Not integrated.** Free plan 100 requests/day, needs a key (would need a backend proxy), live push only on paid plans ($59+/month, crypto checkout), sportsbook-oriented data, redistribution restricted. |

Verified with real requests on 2026-11-07: fixtures by day/competition/team/status, match detail with
`incidents` (goal/card/substitution, minute, side, running score), `live_minute`, half-time score; standings;
top scorers & assists; player stats; brackets; search. Under heavy load the provider returns an HTML 503 page —
handled as "temporarily unavailable".

### Competitions shown as supported (slugs checked against the provider)
Champions League `uefa-champions-league` · Premier League `english-premier-league` · La Liga `spanish-la-liga` ·
Serie A `italian-serie-a` · Bundesliga `bundesliga` · Ligue 1 `french-ligue-1` · Europa League `uefa-europa-league` ·
Saudi Pro League `saudi-professional-league` · Jordanian Pro League `jordan-premier-league` · FIFA World Cup `fifa-world-cup` (bracket).
Any other competition the provider returns still appears under "All matches" and via search. Basketball (incl. NBA),
tennis and cricket show daily scores/fixtures only — no tables are claimed for them.

Not available from this provider (so not shown): player injuries/suspensions, transfers, coach profiles, line-ups
and detailed match statistics for most matches (shown only when the provider sends them).

## Code
* `assets/js/sports-data.js` — provider **adapter** (`PROVIDERS` list; add another adapter with the same operations
  to extend), memory + `sessionStorage` cache with per-type TTL (live 30 s, fixtures 2 min, tables 10 min, scorers
  30 min, players 1 h), in-flight de-duplication, 12 s timeout, 2 retries with exponential backoff + jitter,
  20 s cool-down after overload, soft per-browser daily budget (3,000 calls), stale-copy fallback.
* `assets/js/sports-names.js` — featured competitions and Arabic names for well-known teams (others are shown as the
  provider spells them; nothing is guessed).
* `assets/js/sports.js` — views: day (`?date=YYYY-MM-DD`, `&all=1`), competition (`?comp=slug&tab=matches|table|scorers|assists|bracket`),
  match (`?match=slug`), team (`?team=slug`), player (`?player=slug`), search (`?q=`); `&sport=basketball|tennis|cricket`.
* Days are Amman calendar days: the provider's UTC days are merged and filtered, so late kick-offs land on the right day.

## Live updates
Polling only while the tab is visible: 30 s when a live match is on screen, 60 s for a match about to start,
5 min for today's list, none for other days. "Last successful update" is always shown; if a refresh fails the
previous data stays on screen marked **Delayed**; with no previous data an error state is shown. No WebSocket is
offered by the free provider. Scores are never simulated.

## Tests
`CHROME=/path/to/chrome node tests/ui/sports-smoke.mjs . /tmp/shots` — mocked provider: grouping, live minute and
polling, overload → delayed, outage → error, empty day, tables, scorers/assists, match events, team form, player,
search, attribution, RTL/LTR, no overflow at 390 px, no console errors.
