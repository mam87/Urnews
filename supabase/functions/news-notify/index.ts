// Edge Function: notify — sends an admin alert by Telegram and/or e-mail (Resend).
// Called by public.raise_alert() via pg_net. Channels are optional; configure with secrets:
//   ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID   and/or   RESEND_API_KEY + ALERT_EMAIL_TO (+ ALERT_EMAIL_FROM)
import { createClient } from "@supabase/supabase-js";

const env = (k: string) => Deno.env.get(k) || "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: ok } = await sb.rpc("news_check_ingest_token", { p_token: req.headers.get("x-ingest-token") ?? "" });
  if (ok !== true) return new Response("unauthorized", { status: 401 });

  let alertId = 0;
  try { alertId = Number((await req.json()).alert_id); } catch { /* empty body */ }
  if (!Number.isInteger(alertId) || alertId <= 0) return new Response("bad request", { status: 400 });
  const { data: alert } = await sb.from("news_alerts").select("id,kind,message,created_at,notified_at").eq("id", alertId).maybeSingle();
  if (!alert) return new Response("not found", { status: 404 });
  if (alert.notified_at) return new Response(JSON.stringify({ skipped: "already notified" }));

  const text = `⚠️ نبض الأخبار — تنبيه\n${alert.message}\n(${alert.kind})`;
  const sent: string[] = [];
  const errors: string[] = [];

  if (env("ALERT_TELEGRAM_BOT_TOKEN") && env("ALERT_TELEGRAM_CHAT_ID")) {
    const r = await fetch(`https://api.telegram.org/bot${env("ALERT_TELEGRAM_BOT_TOKEN")}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env("ALERT_TELEGRAM_CHAT_ID"), text }),
    }).catch((e) => ({ ok: false, status: String(e) }) as unknown as Response);
    r.ok ? sent.push("telegram") : errors.push(`telegram ${r.status}`);
  }
  if (env("RESEND_API_KEY") && env("ALERT_EMAIL_TO")) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env("RESEND_API_KEY")}` },
      body: JSON.stringify({
        from: env("ALERT_EMAIL_FROM") || "Nabd Alerts <onboarding@resend.dev>",
        to: [env("ALERT_EMAIL_TO")],
        subject: "تنبيه: " + alert.message.slice(0, 80),
        text,
      }),
    }).catch((e) => ({ ok: false, status: String(e) }) as unknown as Response);
    r.ok ? sent.push("email") : errors.push(`email ${r.status}`);
  }
  if (sent.length) await sb.from("news_alerts").update({ notified_at: new Date().toISOString() }).eq("id", alertId);
  return new Response(JSON.stringify({ sent, errors, configured: sent.length + errors.length > 0 }), { headers: { "content-type": "application/json" } });
});
