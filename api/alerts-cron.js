// Alerts schedule, called by Supabase pg_cron (x-cron-key, checked against Vault) or any scheduler with x-cron-secret = CRON_SECRET.
//   POST /api/alerts-cron?mode=activity   every 5 minutes: Meta ad account changes (who changed what)
//   POST /api/alerts-cron?mode=summary    every 30 minutes: update + CPL alerts
const crypto = require("crypto");
const A = require("./_alertlib");
const T = require("./_tg");
const SB_URL = process.env.SUPABASE_URL || "https://oggmosadlkarwlurxdjk.supabase.co";
function send(res, code, body) { res.statusCode = code; res.setHeader("content-type", "application/json; charset=utf-8"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(body)); }
function same(a, b) { const x = crypto.createHash("sha256").update(String(a || "")).digest(), y = crypto.createHash("sha256").update(String(b || "")).digest(); return crypto.timingSafeEqual(x, y); }
function sbFetch(path, opt) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; opt = opt || {};
  opt.headers = Object.assign({ apikey: key, authorization: "Bearer " + key, "content-type": "application/json" }, opt.headers || {});
  return fetch(SB_URL + "/rest/v1/" + path, opt).then(async (r) => { const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch (e) {}
    if (!r.ok) throw new Error("Database answered " + r.status + ": " + String((b && (b.message || b.error)) || t).slice(0, 300)); return b; });
}
async function keyOk(k) { if (!k || String(k).length < 32) return false; try { return (await sbFetch("rpc/meta_cron_key_ok", { method: "POST", body: JSON.stringify({ k: String(k) }) })) === true; } catch (e) { return false; } }
module.exports = async function handler(req, res) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return send(res, 400, { error: "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel." });
    const secret = process.env.CRON_SECRET || "", given = String(req.headers["x-cron-secret"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    if (!((secret && given && same(given, secret)) || await keyOk(req.headers["x-cron-key"]))) return send(res, 401, { error: "Not allowed" });
    if (!process.env.META_ACCESS_TOKEN) return send(res, 200, { skipped: "META_ACCESS_TOKEN is not set." });
    const st = await sbFetch("team_settings?id=eq.1&select=settings"), S = (st && st[0] && st[0].settings) || {};
    const mode = String((req.query && req.query.mode) || "summary");
    // without Telegram, changes and CPL moves are still recorded for the dashboard
    return send(res, 200, mode === "activity" ? await A.runActivity(S, sbFetch) : await A.runSummary(S, sbFetch));
  } catch (e) { return send(res, 502, { error: String((e && e.message) || e) }); }
};
