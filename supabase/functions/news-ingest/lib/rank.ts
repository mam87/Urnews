// Global importance ranking (0..100) for events (a cluster of reports, or a single report).
//
//   Global impact               30  what happened (event type, magnitude, casualties, international bodies,
//                                   number of countries involved) — never which country it happened in
//   News freshness              25  halves every 2 hours after the first report
//   Source credibility          20  most credible outlet reporting it (reliability 1-5 × 4)
//   Independent coverage        15  distinct publishers; wire copies (Reuters/AP/AFP…) and near-identical
//                                   syndicated text count once
//   Event development speed     10  independent reports in the last 30 minutes
//
// Breaking = score ≥ BREAKING_MIN, a non-routine event, < 6 h old, not only allegations, and either 2+
// independent publishers or ONE highly credible publisher reporting a major event (impact ≥ 24, score ≥ 70),
// then labelled "single-source report".
import { regionOf } from "./geo.ts";
import { crossLanguageSame, EventType, Signature } from "./events.ts";
import { jaccard } from "./text.ts";

export interface Report {
  id: number;
  clusterId: number | null;
  sourceId: number;
  publisher: string;         // owner group: bbc-arabic, bbc-world and bbc-health are all "bbc"
  reliability: number;       // 1..5
  official: boolean;
  publishedAt: number;       // ms
  language: string;          // "ar" (incl. translated) | "en"
  hasArabic: boolean;
  hasEnglish: boolean;
  countries: string[];
  eventType: EventType;
  impact: number;            // 0..30
  wire: string | null;
  verification: string;
  tokens: string[];
  magnitude?: number | null;  // earthquakes
}

export type Status = "developing" | "confirmed" | "updated";

export interface RankedEvent {
  key: string;
  clusterId: number | null;
  leadId: number;
  leadArId: number | null;
  leadEnId: number | null;
  firstId: number;           // earliest report (the original publisher)
  score: number;
  parts: { impact: number; freshness: number; credibility: number; independence: number; velocity: number };
  status: Status;
  confirmed: boolean;
  singleSource: boolean;
  allegation: boolean;
  independentCount: number;
  publisherCount: number;
  reportCount: number;
  countries: string[];
  region: string | null;
  eventType: EventType;
  firstSeen: number;
  lastSeen: number;
  breaking: boolean;
}

export const BREAKING_MIN = 60;
export const MAX_BREAKING = 8;
export const BREAKING_MAX_AGE_H = 6;
export const MIN_BREAKING_IMPACT = 14;      // routine/general stories (≤ 12) never become breaking
export const SINGLE_SOURCE_MIN_RELIABILITY = 4;
/** One outlet alone can raise an alert only for a major event and a high overall score. */
export const SINGLE_SOURCE_MIN_IMPACT = 24;
export const SINGLE_SOURCE_MIN_SCORE = 70;
const FRESH_HALF_LIFE_MIN = 120;
const INDEPENDENCE_PTS = [0, 4, 8, 11, 13, 15];
const VELOCITY_PTS = [0, 3, 6, 8, 10];

/** Distinct independent sources: one per wire service, one per publisher group, and copies with
 *  near-identical wording (syndication) merged. */
export function independentKeys(reports: Report[]): Map<string, Report[]> {
  const key = reports.map((r) => (r.wire ? `wire:${r.wire}` : `pub:${r.publisher}`));
  const parent = key.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < reports.length; i++) {
    for (let j = i + 1; j < reports.length; j++) {
      if (key[i] === key[j]) { parent[find(j)] = find(i); continue; }
      const a = reports[i], b = reports[j];
      if (a.language !== b.language) continue;
      const { score, shared } = jaccard(a.tokens, b.tokens);
      if (score >= 0.85 && shared >= 5) parent[find(j)] = find(i); // the same text republished
    }
  }
  const out = new Map<string, Report[]>();
  reports.forEach((r, i) => {
    const k = key[find(i)];
    out.set(k, [...(out.get(k) ?? []), r]);
  });
  return out;
}

export function scoreEvent(key: string, reports: Report[], now: number): RankedEvent {
  const rs = [...reports].sort((a, b) => a.publishedAt - b.publishedAt || a.id - b.id);
  const first = rs[0];
  const firstSeen = first.publishedAt;
  const lastSeen = rs[rs.length - 1].publishedAt;
  const groups = independentKeys(rs);
  const independentCount = groups.size;
  const publisherCount = new Set(rs.map((r) => r.publisher)).size;

  const credibleRel = (r: Report) => (r.official ? 5 : r.reliability);
  // Impact: what the credible reports say happened (a reliability-1/2 outlet alone cannot inflate it).
  const credibleImpacts = rs.filter((r) => credibleRel(r) >= 3).map((r) => r.impact);
  const impact = Math.min(30, Math.max(0, ...(credibleImpacts.length ? credibleImpacts : rs.map((r) => Math.min(r.impact, 12)))));
  const ageMin = Math.max(0, (now - firstSeen) / 60_000);
  const freshness = 25 * Math.pow(0.5, ageMin / FRESH_HALF_LIFE_MIN);
  const maxRel = Math.max(...rs.map(credibleRel));
  const credibility = Math.min(20, maxRel * 4);
  const independence = INDEPENDENCE_PTS[Math.min(independentCount, 5)];
  let recentKeys = 0;
  for (const members of groups.values()) if (members.some((r) => now - r.publishedAt <= 30 * 60_000)) recentKeys++;
  const velocity = VELOCITY_PTS[Math.min(recentKeys, 4)];
  const score = Math.round(Math.min(100, impact + freshness + credibility + independence + velocity));

  const allegation = rs.every((r) => r.verification === "allegation");
  const credibleKeys = [...groups.values()].filter((m) => m.some((r) => credibleRel(r) >= 4)).length;
  const editorConfirmed = rs.some((r) => r.verification === "confirmed");
  const confirmed = editorConfirmed || (independentCount >= 3 && credibleKeys >= 2 && !allegation);
  const updated = rs.length >= 2 && now - lastSeen <= 30 * 60_000 && lastSeen - firstSeen >= 45 * 60_000;
  const status: Status = updated ? "updated" : confirmed ? "confirmed" : "developing";

  // Countries: what the reports are about (headline country counts double).
  const tally = new Map<string, number>();
  for (const r of rs) r.countries.forEach((c, i) => tally.set(c, (tally.get(c) ?? 0) + (i === 0 ? 2 : 1)));
  const countries = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 3);

  const typeVotes = new Map<EventType, number>();
  for (const r of rs) typeVotes.set(r.eventType, (typeVotes.get(r.eventType) ?? 0) + 1);
  const eventType = [...typeVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const best = (pool: Report[]) => pool.length ? [...pool].sort((a, b) => credibleRel(b) - credibleRel(a) || a.publishedAt - b.publishedAt)[0] : null;
  const lead = best(rs)!;

  const singleSource = independentCount === 1;
  const breakingEligible = score >= BREAKING_MIN && impact >= MIN_BREAKING_IMPACT && !allegation &&
    ageMin <= BREAKING_MAX_AGE_H * 60 &&
    (!singleSource || (maxRel >= SINGLE_SOURCE_MIN_RELIABILITY && impact >= SINGLE_SOURCE_MIN_IMPACT && score >= SINGLE_SOURCE_MIN_SCORE));

  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    key, clusterId: first.clusterId, leadId: lead.id,
    leadArId: best(rs.filter((r) => r.hasArabic))?.id ?? null,
    leadEnId: best(rs.filter((r) => r.hasEnglish))?.id ?? null,
    firstId: first.id, score,
    parts: { impact: r1(impact), freshness: r1(freshness), credibility: r1(credibility), independence, velocity },
    status, confirmed, singleSource, allegation, independentCount, publisherCount, reportCount: rs.length,
    countries, region: regionOf(countries[0]), eventType, firstSeen, lastSeen, breaking: breakingEligible,
  };
}

/** Group reports into events, score them all, keep the top `limit`, and mark at most MAX_BREAKING as breaking. */
export function rankEvents(reports: Report[], now: number, limit = 60): RankedEvent[] {
  const byKey = new Map<string, Report[]>();
  for (const r of reports) {
    const k = r.clusterId ? `c${r.clusterId}` : `a${r.id}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  mergeSameEvents(byKey);
  const events = [...byKey.entries()].map(([k, rs]) => scoreEvent(k, rs, now))
    .sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen);
  let nBreaking = 0;
  for (const e of events) {
    if (e.breaking && nBreaking < MAX_BREAKING) nBreaking++;
    else e.breaking = false;
  }
  return events.slice(0, limit);
}

const sigOf = (r: Report): Signature => ({ language: r.language, countries: r.countries, eventType: r.eventType,
  digits: new Set(r.tokens.filter((t) => /^\d+$/.test(t))), publishedAt: r.publishedAt, magnitude: r.magnitude ?? null });

/** Join stored groups that are one event (e.g. a USGS record and a news report of the same quake, stored
 *  before they could be matched). Same conservative test as at insert time, on each group's first report. */
export function mergeSameEvents(byKey: Map<string, Report[]>) {
  const keys = [...byKey.keys()];
  const first = new Map(keys.map((k) => [k, [...byKey.get(k)!].sort((a, b) => a.publishedAt - b.publishedAt)[0]]));
  const buckets = new Map<string, string[]>();
  for (const k of keys) {
    const r = first.get(k)!;
    if (["general", "routine", "government"].includes(r.eventType) || !r.countries.length) continue;
    const b = `${r.eventType}|${r.countries[0]}`;
    buckets.set(b, [...(buckets.get(b) ?? []), k]);
  }
  for (const ks of buckets.values()) {
    for (let i = 0; i < ks.length; i++) {
      if (!byKey.has(ks[i])) continue;
      for (let j = i + 1; j < ks.length; j++) {
        if (!byKey.has(ks[j])) continue;
        const a = first.get(ks[i])!, b = first.get(ks[j])!;
        if (a.publisher === b.publisher || !crossLanguageSame(sigOf(a), sigOf(b))) continue;
        // keep the cluster key (c…) or the older group's key
        const [keep, drop] = ks[i].startsWith("c") || !ks[j].startsWith("c") ? [ks[i], ks[j]] : [ks[j], ks[i]];
        byKey.set(keep, [...byKey.get(keep)!, ...byKey.get(drop)!]);
        byKey.delete(drop);
        if (drop === ks[i]) break;
      }
    }
  }
}
