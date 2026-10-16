// URL validation and canonicalization for duplicate prevention.

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|mc_cid|mc_eid|ocid|cmpid|at_medium|at_campaign|at_custom\d*|xtor|ns_[a-z]+|ref|ref_src|src|share|amp|_ga|igshid|s_cid)$/i;

/** Returns an absolute https/http URL or null. Rejects javascript:, data:, credentials, etc. */
export function safeUrl(raw: unknown, base?: string): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  let u: URL;
  try { u = base ? new URL(s, base) : new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  return u.toString();
}

/** Canonical form used for the unique url_hash. */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^(www|m|amp)\./, "");
  u.protocol = "https:";
  const keep: [string, string][] = [];
  for (const [k, v] of u.searchParams) if (!TRACKING_PARAMS.test(k)) keep.push([k, v]);
  keep.sort((a, b) => a[0].localeCompare(b[0]));
  u.search = keep.length ? "?" + new URLSearchParams(keep).toString() : "";
  let path = u.pathname.replace(/\/amp\/?$/, "/").replace(/\/+$/, "");
  if (!path) path = "/";
  u.pathname = path;
  u.port = "";
  return u.toString();
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
