// Alerts (Settings › Alerts): connect the one person who gets Telegram alerts, send a test, send an update now, list recent alerts.
//   GET /api/alerts?op=status | link-start | link-check | unlink | test | run&what=summary|activity | log | activity&days=7 | activity-sync
// Vercel env: TELEGRAM_BOT_TOKEN, SUPABASE_SERVICE_ROLE_KEY (and META_ACCESS_TOKEN for the Meta parts).
const crypto = require("crypto");
const SB_URL = process.env.SUPABASE_URL || "https://oggmosadlkarwlurxdjk.supabase.co";
const SB_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nZ21vc2FkbGthcndsdXJ4ZGprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODEyNjQsImV4cCI6MjEwNzY1NzI2NH0.WfxddEbJwtIXlc5ENVM6fLmB46zmgi7eeVk02FWJfQ0";
const T = require("./_tg");
const A = require("./_alertlib");
function send(res, code, body) { res.statusCode = code; res.setHeader("content-type", "application/json; charset=utf-8"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(body)); }
async function whoIs(req) {
  const auth = String(req.headers.authorization || "");
  if (!/^Bearer\s+\S+/.test(auth)) return null;
  const u = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: SB_ANON, authorization: auth } });
  if (!u.ok) return null;
  const user = await u.json(), email = String(user.email || "").toLowerCase();
  if (!email) return null;
  const r = await fetch(SB_URL + "/rest/v1/team_members?select=role&email=eq." + encodeURIComponent(email), { headers: { apikey: SB_ANON, authorization: auth } });
  const rows = r.ok ? await r.json() : [];
  return { email, role: rows[0] ? rows[0].role : null };
}
function sbFetch(path, opt) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; opt = opt || {};
  opt.headers = Object.assign({ apikey: key, authorization: "Bearer " + key, "content-type": "application/json" }, opt.headers || {});
  return fetch(SB_URL + "/rest/v1/" + path, opt).then(async (r) => { const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch (e) {}
    if (!r.ok) throw new Error("Database answered " + r.status + ": " + String((b && (b.message || b.error)) || t).slice(0, 300)); return b; });
}
/* the one person who receives alerts: Settings › Alerts › recipient (default: the shettyharikrishna login) */
const isRecipient = (S, email) => { const r = String(((S.alerts || {}).recipient) || "").toLowerCase().trim(); return r ? email === r : /^shettyharikrishna/.test(email); };
module.exports = async function handler(req, res) {
  try {
    const op = String((req.query && req.query.op) || "status");
    const me = await whoIs(req);
    if (!me || !me.role) return send(res, 401, { error: "Sign in with a team account first." });
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return send(res, 400, { error: "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel." });
    const st = await sbFetch("team_settings?id=eq.1&select=settings"), S = (st && st[0] && st[0].settings) || {};
    const rec = isRecipient(S, me.email);
    // everything about alerts is visible to the recipient's own login only
    if (!rec) return send(res, op === "status" ? 200 : 403, op === "status" ? { isRecipient: false } : { error: "Alerts are private to the alert recipient." });
    if (op === "status") {
      let link = null, bot = null; try { link = await A.chatOf(sbFetch); } catch (e) { return send(res, 200, { configured: T.configured(), setup: /alert_state|schema cache|does not exist/i.test(e.message), error: e.message, me: me.email, isRecipient: rec }); }
      if (T.configured()) { try { bot = (await T.tg("getMe")).username; } catch (e) { bot = null; } }
      return send(res, 200, { configured: T.configured(), bot, linked: link ? { name: link.name, email: link.email, at: link.at } : null, me: me.email, isRecipient: rec, role: me.role });
    }
    if (op === "log") { const r = await sbFetch("alert_log?select=at,kind,text&order=id.desc&limit=" + Math.min(50, +req.query.n || 20)); return send(res, 200, { log: r || [] }); }
    if (op === "activity") {   // Ad account activity page: stored changes, explained
      const days = Math.max(1, Math.min(90, +req.query.days || 7)), since = new Date(Date.now() - days * 864e5).toISOString();
      const rows = await sbFetch("meta_activity?select=*&event_time=gte." + encodeURIComponent(since) + "&order=event_time.desc&limit=2000") || [];
      const ACT = require("./_activity");
      return send(res, 200, { days, rows: rows.map((r) => Object.assign({ at: r.event_time, who: r.actor_name || r.application_name || "Meta (automatic)", account: r.account_name, brand: r.brand,
        campaign: r.campaign || "", adset: r.adset || "", ad: r.ad || "", object: r.object_name, meta: r.translated || r.event_type }, ACT.describe(r))) });
    }
    if (op === "activity-sync") { if (!process.env.META_ACCESS_TOKEN) return send(res, 400, { error: "META_ACCESS_TOKEN is not set in Vercel." });
      return send(res, 200, await A.runActivity(S, sbFetch, { force: true, storeOnly: true })); }
    if (!T.configured()) return send(res, 400, { error: "TELEGRAM_BOT_TOKEN is not set in Vercel yet." });
    if (op === "link-start") {
      if (!rec) return send(res, 403, { error: "Only the alert recipient can connect their Telegram." });
      const code = crypto.randomBytes(9).toString("hex"), bot = (await T.tg("getMe")).username;
      await A.setState(sbFetch, "link", { code, email: me.email, exp: Date.now() + 15 * 60000 });
      return send(res, 200, { bot, code, url: "https://t.me/" + bot + "?start=" + code });
    }
    if (op === "link-check") {
      if (!rec) return send(res, 403, { error: "Only the alert recipient can connect their Telegram." });
      const L = await A.getState(sbFetch, "link");
      if (!L || L.email !== me.email || L.exp < Date.now()) return send(res, 400, { error: "The connect link expired. Click Connect Telegram again." });
      const ups = await T.tg("getUpdates", { limit: 100, allowed_updates: ["message"] });
      const hit = (ups || []).map((u) => u.message).filter((m) => m && m.chat && m.chat.type === "private" && String(m.text || "").trim() === "/start " + L.code).pop();
      if (!hit) return send(res, 200, { linked: false });
      const who = [hit.from && hit.from.first_name, hit.from && hit.from.last_name].filter(Boolean).join(" ") || (hit.from && hit.from.username) || "Telegram user";
      await A.setState(sbFetch, "telegram", { chat_id: hit.chat.id, name: who, email: me.email, at: new Date().toISOString() });
      await A.setState(sbFetch, "link", null);
      await T.send(hit.chat.id, "✅ <b>EBG alerts connected</b> for " + T.esc(me.email) + ".\nYou'll get: Meta ad account changes (who changed what), CPL up / down alerts, and an update every 30 minutes.");
      return send(res, 200, { linked: true, name: who });
    }
    if (op === "unlink") { if (!rec) return send(res, 403, { error: "Only the recipient or an admin can disconnect." }); await A.setState(sbFetch, "telegram", null); return send(res, 200, { ok: true }); }
    if (op === "test") { if (!rec) return send(res, 403, { error: "Only the recipient or an admin can send a test." });
      const ok = await A.deliver(sbFetch, "test", "👋 Test from the EBG dashboard (" + T.esc(me.email) + "). Alerts are working."); return send(res, ok ? 200 : 400, ok ? { ok } : { error: "Telegram isn't connected yet." }); }
    if (op === "run") { if (!rec) return send(res, 403, { error: "Not allowed." });
      const what = String(req.query.what || "summary");
      return send(res, 200, what === "activity" ? await A.runActivity(S, sbFetch, { force: true }) : await A.runSummary(S, sbFetch, { force: true })); }
    return send(res, 400, { error: "Unknown op" });
  } catch (e) { return send(res, 502, { error: String((e && e.message) || e) }); }
};
