// Google Ads auto-sync (every 30 minutes): called by the Supabase scheduler (pg_cron, sends x-cron-key checked against Supabase Vault)
// or by any scheduler that sends x-cron-secret = CRON_SECRET. Turned on/off in the dashboard (Settings › Data connections › Google Ads).
// Needs in Vercel: the GOOGLE_ADS_* variables (api/_gadslib.js) and SUPABASE_SERVICE_ROLE_KEY.
const crypto = require("crypto");
const G = require("./_gadslib");
const { syncGoogle } = require("./_gadsync");
const SB_URL = process.env.SUPABASE_URL || "https://oggmosadlkarwlurxdjk.supabase.co";
function send(res, code, body) { res.statusCode = code; res.setHeader("content-type", "application/json; charset=utf-8"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(body)); }
function same(a, b) { const x = crypto.createHash("sha256").update(String(a || "")).digest(), y = crypto.createHash("sha256").update(String(b || "")).digest(); return crypto.timingSafeEqual(x, y); }
function sbFetch(path, opt) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; opt = opt || {};
  opt.headers = Object.assign({ apikey: key, authorization: "Bearer " + key, "content-type": "application/json" }, opt.headers || {});
  return fetch(SB_URL + "/rest/v1/" + path, opt).then(async (r) => { const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch (e) {}
    if (!r.ok) throw new Error("Database answered " + r.status + ": " + String((b && (b.message || b.error)) || t).slice(0, 300)); return b; });
}
async function keyOk(k) {
  if (!k || String(k).length < 32) return false;
  try { return (await sbFetch("rpc/meta_cron_key_ok", { method: "POST", body: JSON.stringify({ k: String(k) }) })) === true; } catch (e) { return false; }
}
module.exports = async function handler(req, res) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return send(res, 400, { error: "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel." });
    const secret = process.env.CRON_SECRET || "";
    const given = String(req.headers["x-cron-secret"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    const allowed = (secret && given && same(given, secret)) || await keyOk(req.headers["x-cron-key"]);
    if (!allowed) return send(res, 401, { error: "Not allowed" });
    if (!G.configured()) return send(res, 200, { skipped: "Google Ads isn't connected in Vercel yet." });
    const st = await sbFetch("team_settings?id=eq.1&select=settings");
    const S = (st && st[0] && st[0].settings) || {};
    if (!S.googleAutoSync) return send(res, 200, { skipped: "Google auto-sync is off (dashboard › Settings › Data connections)." });
    const out = await syncGoogle(S, sbFetch, { budgetMs: 50000 });
    return send(res, out.errors && out.errors.length && !out.done ? 502 : 200, out);
  } catch (e) { return send(res, 502, { error: String((e && e.message) || e) }); }
};
