// Alerts (Settings › Alerts): connect the one person who gets Telegram alerts, send a test, send an update now, list recent alerts.
//   GET /api/alerts?op=status | link-start | link-check | unlink | test | run&what=summary|activity|daily|daily-yesterday|weekly | log | activity&days=7 | activity-sync | cpl | insights
//   Alerts & Monitoring: mon | mon-history | mon-preview | mon-trends | mon-ack&key=…&note=…&resolve=1|reopen=1
// Vercel env: TELEGRAM_BOT_TOKEN, SUPABASE_SERVICE_ROLE_KEY (and META_ACCESS_TOKEN for the Meta parts).
const crypto = require("crypto");
const SB_URL = process.env.SUPABASE_URL || "https://oggmosadlkarwlurxdjk.supabase.co";
const SB_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nZ21vc2FkbGthcndsdXJ4ZGprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODEyNjQsImV4cCI6MjEwNzY1NzI2NH0.WfxddEbJwtIXlc5ENVM6fLmB46zmgi7eeVk02FWJfQ0";
const T = require("./_tg");
const A = require("./_alertlib");
function send(res, code, body) { res.statusCode = code; res.setHeader("content-type", "application/json; charset=utf-8"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(body)); }
async function whoIs(req) {
  const auth = String(req.headers.authorization || "");
  if (!/^Bearer\s+\S+/.test(auth)) return { reason: "no-session" };
  const u = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: SB_ANON, authorization: auth } });
  if (!u.ok) return { reason: "session", status: u.status };   // expired / invalid sign-in token, or the API key Vercel uses is rejected
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
const activityUsersOf = (S) => {
  const raw = (S && S.alerts ? S.alerts.activityUsers : null);
  const arr = Array.isArray(raw) ? raw : (raw ? String(raw).split(/[\s,;]+/) : []);
  return Array.from(new Set(arr.map((x) => String(x || "").toLowerCase().trim()).filter(Boolean)));
};
const isActivityAllowed = (S, email) => {
  const e = String(email || "").toLowerCase().trim();
  return !!(e && (isRecipient(S, e) || activityUsersOf(S).includes(e)));
};
module.exports = async function handler(req, res) {
  try {
    const op = String((req.query && req.query.op) || "status");
    const me = await whoIs(req);
    if (!me || me.reason) return send(res, 401, { code: "session", error: "Your sign-in wasn't accepted by the server (" + ((me && me.status) || "no session") + "). Sign out and sign in again; if it keeps happening, check SUPABASE_ANON_KEY in Vercel." });
    if (!me.role) return send(res, 403, { code: "not-team", error: me.email + " isn't on the team list yet (Settings › Team)." });
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return send(res, 400, { error: "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel." });
    const st = await sbFetch("team_settings?id=eq.1&select=settings"), S = (st && st[0] && st[0].settings) || {};
    const rec = isRecipient(S, me.email);
    const actAllowed = isActivityAllowed(S, me.email);
    // Ad account activity can be shared with authorized teammates; everything else about alerts is visible to the recipient's own login only
    if (!rec) {
      if (op === "status") return send(res, 200, { isRecipient: false, isActivityAllowed: actAllowed });
      if (op !== "activity" && op !== "activity-sync") return send(res, 403, { error: "Alerts are private to the alert recipient." });
      if (!actAllowed) return send(res, 403, { error: "Ad account activity is private to the alert recipient and authorized users." });
    }
    if (op === "status") {
      let link = null, bot = null; try { link = await A.chatOf(sbFetch); } catch (e) { return send(res, 200, { configured: T.configured(), setup: /alert_state|schema cache|does not exist/i.test(e.message), error: e.message, me: me.email, isRecipient: rec, isActivityAllowed: true }); }
      if (T.configured()) { try { bot = (await T.tg("getMe")).username; } catch (e) { bot = null; } }
      return send(res, 200, { configured: T.configured(), bot, linked: link ? { name: link.name, email: link.email, at: link.at } : null, me: me.email, isRecipient: rec, isActivityAllowed: true, role: me.role });
    }
    if (op === "log") { const r = await sbFetch("alert_log?select=at,kind,text&order=id.desc&limit=" + Math.min(50, +req.query.n || 20)); return send(res, 200, { log: r || [] }); }
    if (op === "insights") return send(res, 200, await require("./_insights").insights(S, sbFetch));   // Trends › Updates & issues
    if (op === "cpl") {   // Trends › Live CPL updates: CPL right now + the CPL alerts that were sent / recorded
      const [now, ev] = await Promise.all([A.cplNow(S, sbFetch), sbFetch("alert_log?select=at,text&kind=eq.cpl-event&order=id.desc&limit=" + Math.min(200, +req.query.n || 60))]);
      return send(res, 200, { now, events: (ev || []).map((r) => { try { return JSON.parse(r.text); } catch (e) { return null; } }).filter(Boolean) });
    }
    if (op === "activity") {   // Ad account activity page: stored changes, explained
      const days = Math.max(1, Math.min(90, +req.query.days || 7)), since = new Date(Date.now() - days * 864e5).toISOString();
      const rows = await sbFetch("meta_activity?select=*&event_time=gte." + encodeURIComponent(since) + "&order=event_time.desc&limit=2000") || [];
      const ACT = require("./_activity");
      return send(res, 200, { days, rows: rows.map((r) => Object.assign({ at: r.event_time, who: r.actor_name || r.application_name || "Meta (automatic)", account: r.account_name, brand: r.brand,
        campaign: r.campaign || "", adset: r.adset || "", ad: r.ad || "", object: r.object_name, meta: r.translated || r.event_type }, ACT.describe(r))) });
    }
    if (op === "activity-sync") { if (!process.env.META_ACCESS_TOKEN) return send(res, 400, { error: "META_ACCESS_TOKEN is not set in Vercel." });
      return send(res, 200, await A.runActivity(S, sbFetch, { force: true, storeOnly: true })); }
    /* ---- Alerts & Monitoring page ---- */
    if (op === "mon") {   // open issues + recently resolved, feed status, settings defaults
      const M = require("./_monitor"), days = Math.max(1, Math.min(90, +req.query.days || 14)), since = new Date(Date.now() - days * 864e5).toISOString();
      let issues = [], setup = false;
      try { issues = await sbFetch("alert_issues?select=*&or=(status.eq.open,last_seen.gte." + encodeURIComponent(since) + ")&order=last_seen.desc&limit=2000") || []; }
      catch (e) { if (/alert_issues|schema cache|does not exist/i.test(e.message)) setup = true; else throw e; }
      const ups = await sbFetch("uploads?select=meta_files,crm_file,uploaded_at&order=uploaded_at.desc&limit=60") || [];
      const feeds = M.feeds({ uploads: ups }), chat = await A.chatOf(sbFetch).catch(() => null), outbox = (await A.getState(sbFetch, "outbox").catch(() => null)) || [], reports = (await A.getState(sbFetch, "reports").catch(() => null)) || {};
      return send(res, 200, { setup, issues, feeds, telegram: { configured: T.configured(), linked: !!chat }, outbox: outbox.length, reports, defaults: { th: M.TH, labels: M.TH_LABEL, sched: M.SCHED } });
    }
    if (op === "mon-history") {   // everything sent / recorded, newest first, with filters
      const days = Math.max(1, Math.min(180, +req.query.days || 30)), since = new Date(Date.now() - days * 864e5).toISOString(), q = String(req.query.q || "").trim(), kind = String(req.query.kind || "").replace(/[^a-z\-]/g, "");
      let path = "alert_log?select=id,at,kind,text&at=gte." + encodeURIComponent(since) + "&kind=neq.cpl-event&order=id.desc&limit=" + Math.min(1000, +req.query.n || 300);
      if (kind) path += "&kind=eq." + kind;
      if (q) path += "&text=ilike." + encodeURIComponent("*" + q.replace(/[*,()]/g, " ") + "*");
      return send(res, 200, { rows: await sbFetch(path) || [] });
    }
    if (op === "mon-ack") {   // acknowledge (stops reminders), add a note, or close an issue by hand
      const b = Object.assign({}, req.query || {}, (req.body && typeof req.body === "object") ? req.body : {}), key = String(b.key || "");
      if (!key) return send(res, 400, { error: "Missing issue." });
      const patch = { ack_by: me.email, ack_at: new Date().toISOString() };
      if (b.note !== undefined) patch.note = String(b.note).slice(0, 2000);
      if (b.resolve && b.resolve !== "0") { patch.status = "resolved"; patch.resolved_at = new Date().toISOString(); }
      if (b.reopen && b.reopen !== "0") { patch.status = "open"; patch.resolved_at = null; patch.ack_by = null; patch.ack_at = null; }
      await sbFetch("alert_issues?key=eq." + encodeURIComponent(key), { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(patch) });
      return send(res, 200, { ok: true });
    }
    if (op === "mon-preview" || op === "mon-trends") {   // the report as it would be sent now (nothing is sent or tracked) / weekly + month view
      const M = require("./_monitor"), D = await M.loadData(S, sbFetch, { noMeta: op === "mon-trends" }), Mx = M.metrics(D), found = M.detect(D, Mx);
      if (op === "mon-trends") return send(res, 200, { weekly: M.weekly(D), errors: D.errors, today: D.today });
      const [dToday, dYday, wk] = await Promise.all([M.fullDaily(D, found, D.today), M.fullDaily(D, found, D.yday), M.fullWeekly(D, found)]);
      return send(res, 200, { text: M.reportText(D, Mx, found), dailyToday: dToday.parts, dailyYday: dYday.parts, weeklyParts: wk.parts, ids: { today: dToday.id, yday: dYday.id, weekly: wk.id },
        issues: found, recon: Mx.recon, outside: Mx.outsideNames, errors: D.errors.concat(D.live.errors || [], D.health.errors || []) });
    }
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
      await T.send(hit.chat.id, "✅ <b>EBG alerts connected</b> for " + T.esc(me.email) + ".\nYou'll get: critical account alerts straight away, performance alerts (tracked until resolved), Meta ad account changes, the performance report every 30 minutes, a morning recap and a weekly report.");
      return send(res, 200, { linked: true, name: who });
    }
    if (op === "unlink") { if (!rec) return send(res, 403, { error: "Only the recipient or an admin can disconnect." }); await A.setState(sbFetch, "telegram", null); return send(res, 200, { ok: true }); }
    if (op === "test") { if (!rec) return send(res, 403, { error: "Only the recipient or an admin can send a test." });
      const ok = await A.deliver(sbFetch, "test", "👋 Test from the EBG dashboard (" + T.esc(me.email) + "). Alerts are working."); return send(res, ok ? 200 : 400, ok ? { ok } : { error: "Telegram isn't connected yet." }); }
    if (op === "run") { if (!rec) return send(res, 403, { error: "Not allowed." });
      const what = String(req.query.what || "summary");
      if (what === "activity") return send(res, 200, await A.runActivity(S, sbFetch, { force: true }));
      if (what === "weekly" || what === "daily" || what === "daily-yesterday") {   // full brand-wise report now, in numbered parts
        const M = require("./_monitor"), chat = await A.chatOf(sbFetch); if (!chat) return send(res, 400, { error: "Telegram isn't connected yet." });
        const D = await M.loadData(S, sbFetch), found = M.detect(D, M.metrics(D));
        const rep = what === "weekly" ? await M.fullWeekly(D, found) : await M.fullDaily(D, found, what === "daily" ? D.today : D.yday);
        const ok = await M.sendParts(sbFetch, chat.chat_id, what === "weekly" ? "weekly" : "daily", rep);
        return send(res, 200, { sent: [what + ":" + rep.parts.length + " parts"], id: rep.id, delivered: ok }); }
      try { return send(res, 200, await require("./_monitor").run(S, sbFetch, { force: true })); }
      catch (e) { return send(res, 200, Object.assign({ monitorError: e.message }, await A.runSummary(S, sbFetch, { force: true }))); } }
    return send(res, 400, { error: "Unknown op" });
  } catch (e) { return send(res, 502, { error: String((e && e.message) || e) }); }
};
