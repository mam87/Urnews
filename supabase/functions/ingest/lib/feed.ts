// Feed parsing: RSS 2.0, RSS 1.0 (RDF), Atom 1.0 and JSON Feed 1.x.
import { XMLParser } from "fast-xml-parser";
import { safeUrl } from "./url.ts";
import { stripHtml } from "./text.ts";

export interface FeedItem {
  guid: string;
  url: string;
  title: string;
  description: string;
  publishedAt: Date | null;
  image: string | null;
  categories: string[];
}

export class FeedParseError extends Error {
  constructor(msg: string) { super(msg); this.name = "FeedParseError"; }
}

const MAX_BYTES = 5_000_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
  htmlEntities: false,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  allowBooleanAttributes: true,
  isArray: (name: string) => ["item", "entry", "link", "category", "media:content", "media:thumbnail", "enclosure"].includes(name),
});

function arr<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("#text" in o) return String(o["#text"]);
    if ("@_href" in o) return String(o["@_href"]);
  }
  return "";
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * Parse a feed date. Dates without an explicit zone are interpreted using
 * `assumeOffsetMinutes` (e.g. +180 for Jordan), because many Arabic CMSs omit it.
 */
export function parseDate(raw: unknown, assumeOffsetMinutes = 0): Date | null {
  const s = text(raw).trim();
  if (!s) return null;
  // ISO 8601
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", se = "0", tz] = m;
    let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
    ms -= tzOffsetMinutes(tz, assumeOffsetMinutes) * 60_000;
    return valid(ms);
  }
  // RFC 822 / 1123: "Sat, 17 Oct 2026 10:00:00 +0300" (weekday optional, seconds optional)
  m = s.match(/^(?:[a-z]{3},?\s*)?(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([a-z]{1,5}|[+-]\d{4}|[+-]\d{2}:\d{2})?$/i);
  if (m) {
    const [, d, monName, yRaw, h, mi, se = "0", tz] = m;
    const mon = MONTHS[monName.toLowerCase()];
    if (mon === undefined) return null;
    let y = +yRaw; if (y < 100) y += 2000;
    let ms = Date.UTC(y, mon, +d, +h, +mi, +se);
    ms -= tzOffsetMinutes(tz, assumeOffsetMinutes) * 60_000;
    return valid(ms);
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? valid(t) : null;
}

const NAMED_TZ: Record<string, number> = { Z: 0, UT: 0, UTC: 0, GMT: 0, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420, BST: 60, CET: 60, CEST: 120, EET: 120, EEST: 180, AST: 180 };

function tzOffsetMinutes(tz: string | undefined, fallback: number): number {
  if (!tz) return fallback;
  const up = tz.toUpperCase();
  if (up in NAMED_TZ) return NAMED_TZ[up];
  const m = tz.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return fallback;
  const v = +m[2] * 60 + +m[3];
  return m[1] === "-" ? -v : v;
}

function valid(ms: number): Date | null {
  if (!Number.isFinite(ms)) return null;
  const y = new Date(ms).getUTCFullYear();
  return y >= 2000 && y <= 2100 ? new Date(ms) : null;
}

function firstImgFromHtml(html: string, base: string): string | null {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? safeUrl(m[1], base) : null;
}

function pickImage(node: Record<string, unknown>, html: string, base: string): string | null {
  for (const key of ["media:content", "media:thumbnail"]) {
    for (const mc of arr(node[key] as Record<string, unknown>[])) {
      const u = safeUrl(mc?.["@_url"], base);
      const type = String(mc?.["@_type"] || mc?.["@_medium"] || "image");
      if (u && /image/i.test(type)) return u;
    }
  }
  const group = node["media:group"] as Record<string, unknown> | undefined;
  if (group) {
    const g = pickImage(group, "", base);
    if (g) return g;
  }
  for (const enc of arr(node["enclosure"] as Record<string, unknown>[])) {
    const u = safeUrl(enc?.["@_url"], base);
    if (u && /^image\//i.test(String(enc?.["@_type"] || ""))) return u;
  }
  return html ? firstImgFromHtml(html, base) : null;
}

export function parseFeed(body: string, feedUrl: string, assumeOffsetMinutes = 0): FeedItem[] {
  if (body.length > MAX_BYTES) throw new FeedParseError("feed too large");
  const trimmed = body.replace(/^﻿/, "").trimStart();
  if (trimmed.startsWith("{")) return parseJsonFeed(trimmed, feedUrl, assumeOffsetMinutes);
  if (!trimmed.startsWith("<")) throw new FeedParseError("not XML or JSON");
  if (/<!ENTITY/i.test(trimmed.slice(0, 4000))) throw new FeedParseError("DTD entities not allowed");
  let doc: Record<string, unknown>;
  try { doc = parser.parse(trimmed); } catch (e) { throw new FeedParseError("invalid XML: " + (e as Error).message); }

  const rss = doc["rss"] as Record<string, unknown> | undefined;
  const rdf = doc["rdf:RDF"] as Record<string, unknown> | undefined;
  const atom = doc["feed"] as Record<string, unknown> | undefined;
  let items: FeedItem[];
  if (rss || rdf) {
    const channel = (rss ? rss["channel"] : rdf!["channel"]) as Record<string, unknown> | undefined;
    const nodes = arr((rss ? (channel?.["item"] ?? rss["item"]) : rdf!["item"]) as Record<string, unknown>[]);
    items = nodes.map((n) => {
      const html = text(n["content:encoded"]) || text(n["description"]);
      const link = safeUrl(text(n["link"]), feedUrl) || safeUrl(text(n["guid"]), feedUrl) || safeUrl(n["@_rdf:about"], feedUrl);
      return {
        guid: text(n["guid"]) || link || "",
        url: link || "",
        title: stripHtml(text(n["title"])),
        description: stripHtml(text(n["description"]) || html),
        publishedAt: parseDate(n["pubDate"] ?? n["dc:date"] ?? n["published"] ?? n["updated"], assumeOffsetMinutes),
        image: pickImage(n, html, feedUrl),
        categories: arr(n["category"]).map((c) => stripHtml(text(c))).filter(Boolean),
      };
    });
  } else if (atom) {
    items = arr(atom["entry"] as Record<string, unknown>[]).map((n) => {
      const links = arr(n["link"] as Record<string, unknown>[]);
      const alt = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
      const link = safeUrl(alt?.["@_href"] ?? text(alt), feedUrl);
      const html = text(n["content"]) || text(n["summary"]);
      return {
        guid: text(n["id"]) || link || "",
        url: link || "",
        title: stripHtml(text(n["title"])),
        description: stripHtml(text(n["summary"]) || html),
        publishedAt: parseDate(n["published"] ?? n["updated"], assumeOffsetMinutes),
        image: pickImage(n, html, feedUrl),
        categories: arr(n["category"] as Record<string, unknown>[]).map((c) => stripHtml(String(c?.["@_term"] ?? text(c)))).filter(Boolean),
      };
    });
  } else {
    throw new FeedParseError("unrecognized feed format");
  }
  return items.filter((i) => i.url && i.title);
}

function parseJsonFeed(body: string, feedUrl: string, off: number): FeedItem[] {
  let doc: Record<string, unknown>;
  try { doc = JSON.parse(body); } catch { throw new FeedParseError("invalid JSON"); }
  if (!Array.isArray(doc.items)) throw new FeedParseError("JSON feed has no items");
  return (doc.items as Record<string, unknown>[]).map((n) => {
    const url = safeUrl(n.url ?? n.external_url, feedUrl) || "";
    return {
      guid: String(n.id ?? url),
      url,
      title: stripHtml(n.title),
      description: stripHtml(n.summary ?? n.content_text ?? n.content_html ?? ""),
      publishedAt: parseDate(n.date_published ?? n.date_modified, off),
      image: safeUrl(n.image ?? n.banner_image, feedUrl),
      categories: Array.isArray(n.tags) ? (n.tags as unknown[]).map((t) => stripHtml(t)) : [],
    };
  }).filter((i) => i.url && i.title);
}
