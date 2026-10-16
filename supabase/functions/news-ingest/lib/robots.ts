// Minimal robots.txt evaluation (RFC 9309 subset: user-agent groups, allow/disallow, * and $).

export function robotsAllows(robotsTxt: string, userAgent: string, path: string): boolean {
  const ua = userAgent.toLowerCase();
  type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[] };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && cur) {
      lastWasAgent = false;
      if (key === "disallow" && val === "") continue; // empty disallow = allow all
      cur.rules.push({ allow: key === "allow", pattern: val });
    } else {
      lastWasAgent = false;
    }
  }
  const token = ua.split("/")[0];
  let group = groups.find((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  if (!group) group = groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const r of group.rules) {
    if (matches(r.pattern, path)) {
      const len = r.pattern.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
    }
  }
  return best ? best.allow : true;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const p = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path);
}

/** Exponential backoff with cap, in minutes. failures=1 -> base*2 ... */
export function backoffMinutes(baseInterval: number, failures: number, capMinutes = 360): number {
  if (failures <= 0) return baseInterval;
  return Math.min(capMinutes, baseInterval * 2 ** Math.min(failures, 10));
}

export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function retryAfterSeconds(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  if (/^\d+$/.test(header.trim())) return Math.min(+header, 86400);
  const t = Date.parse(header);
  return Number.isFinite(t) ? Math.max(0, Math.min(86400, Math.round((t - now) / 1000))) : null;
}
