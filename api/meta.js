// Meta Marketing API (direct) → Meta Ads daily rows for the dashboard.
// The token is never sent to the browser: set META_ACCESS_TOKEN (a System User token with ads_read)
// in Vercel › Settings › Environment Variables. Optional: META_API_VERSION (default v23.0).
// Every call must carry the signed-in user's Supabase token; only team admins / editors can list accounts or pull data.
//   GET /api/meta?op=status
//   GET /api/meta?op=accounts
//   GET /api/meta?op=funds[&accounts=act_1,act_2]   (any team member; live, not stored)
//   GET /api/meta?op=reconcile&from=YYYY-MM-DD&to=YYYY-MM-DD&accounts=act_1,act_2   (any team member: Meta account totals vs stored rows, per day)
//   GET /api/meta?op=budgets&accounts=act_1,act_2   (any team member; daily budgets of active campaigns, live)
//   GET /api/meta?op=data&from=YYYY-MM-DD&to=YYYY-MM-DD&accounts=act_1
const SB_URL = process.env.SUPABASE_URL || "https://oggmosadlkarwlurxdjk.supabase.co";
const SB_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nZ21vc2FkbGthcndsdXJ4ZGprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODEyNjQsImV4cCI6MjEwNzY1NzI2NH0.WfxddEbJwtIXlc5ENVM6fLmB46zmgi7eeVk02FWJfQ0";
const { VER, COLS, accountRows, adAccounts, accountFunds, accountBudgets, accountDaily } = require("./_metalib");
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
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

module.exports = async function handler(req, res) {
  try {
    const op = String((req.query && req.query.op) || "status");
    const tok = process.env.META_ACCESS_TOKEN || "";
    const me = await whoIs(req);
    if (!me || !me.role) return send(res, 401, { error: "Sign in with a team account first." });
    if (op === "status") return send(res, 200, { configured: !!tok, last4: tok ? tok.slice(-4) : null, role: me.role, version: VER, cronReady: !!process.env.SUPABASE_SERVICE_ROLE_KEY });
    if (!tok) return send(res, 400, { error: "META_ACCESS_TOKEN is not set in Vercel yet." });
    if (op === "reconcile") {
      const from = String(req.query.from || ""), to = String(req.query.to || "");
      if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) return send(res, 400, { error: "Pick a valid date range." });
      if ((Date.parse(to) - Date.parse(from)) / 864e5 > 30) return send(res, 400, { error: "Check up to 31 days at a time." });
      const acc = String(req.query.accounts || "").split(",").map((s) => s.trim()).filter((s) => /^(act_)?\d+$/.test(s)).slice(0, 40);
      const errors = [], metaAcc = [];
      await Promise.all(acc.map(async (a) => { try { metaAcc.push(await accountDaily(a, from, to)); } catch (e) { errors.push(a + ": " + e.message); } }));
      /* what the dashboard has stored, read with the signed-in user's own access */
      const stored = {}, auth = String(req.headers.authorization || "");
      for (let off = 0; off < 50000; off += 1000) {
        const r = await fetch(SB_URL + "/rest/v1/meta_ad_rows?select=source_file,day,spend,impressions&day=gte." + from + "&day_end=lte." + to + "&order=id", {
          headers: { apikey: SB_ANON, authorization: auth, range: off + "-" + (off + 999), "range-unit": "items" } });
        if (!r.ok) throw new Error("Couldn't read stored rows (" + r.status + ")");
        const rows = await r.json();
        rows.forEach((x) => { const k = x.source_file + "|" + x.day, o = stored[k] || (stored[k] = { spend: 0, impressions: 0 }); o.spend += Number(x.spend) || 0; o.impressions += Number(x.impressions) || 0; });
        if (rows.length < 1000) break;
      }
      const out = metaAcc.map((a) => {
        const label = "Meta API · " + a.name + " · " + a.id, suffix = " · " + a.id, byDay = {};
        a.days.forEach((d) => { byDay[d.date] = { date: d.date, meta: d }; });
        Object.keys(stored).forEach((k) => { const i = k.lastIndexOf("|"), f = k.slice(0, i); if (f.slice(-suffix.length) !== suffix) return; const day = k.slice(i + 1); (byDay[day] = byDay[day] || { date: day, meta: { spend: 0, impressions: 0 } }).stored = stored[k]; });
        const days = Object.values(byDay).map((d) => ({ date: d.date, metaSpend: d.meta.spend, metaImp: d.meta.impressions,
          spend: d.stored ? Math.round(d.stored.spend * 100) / 100 : 0, imp: d.stored ? Math.round(d.stored.impressions) : 0 })).sort((x, y) => (x.date < y.date ? -1 : 1));
        return { id: a.id, name: a.name, label, days };
      });
      return send(res, 200, { at: new Date().toISOString(), from, to, accounts: out, errors });
    }
    if (op === "budgets") {
      const acc = String(req.query.accounts || "").split(",").map((s) => s.trim()).filter((s) => /^(act_)?\d+$/.test(s)).slice(0, 40);
      const out = [], errors = [];
      await Promise.all(acc.map(async (a) => { try { (await accountBudgets(a)).forEach((x) => out.push(x)); } catch (e) { errors.push(a + ": " + e.message); } }));
      return send(res, 200, { at: new Date().toISOString(), campaigns: out, errors });
    }
    if (op === "funds") {
      const acc = String(req.query.accounts || "").split(",").map((s) => s.trim()).filter((s) => /^(act_)?\d+$/.test(s));
      return send(res, 200, { at: new Date().toISOString(), accounts: await accountFunds(acc) });
    }
    if (me.role !== "admin" && me.role !== "editor") return send(res, 403, { error: "Only admins and editors can pull Meta data." });
    if (op === "accounts") return send(res, 200, { accounts: await adAccounts() });
    if (op === "data") {
      const from = String(req.query.from || ""), to = String(req.query.to || "");
      if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) return send(res, 400, { error: "Pick a valid date range." });
      if ((Date.parse(to) - Date.parse(from)) / 864e5 > 31) return send(res, 400, { error: "Pull up to 31 days per call." });
      const acc = String(req.query.accounts || "").split(",").map((s) => s.trim()).filter((s) => /^(act_)?\d+$/.test(s));
      if (acc.length !== 1) return send(res, 400, { error: "Pull one ad account per call." });
      return send(res, 200, { cols: COLS, rows: await accountRows(acc[0], from, to) });
    }
    return send(res, 400, { error: "Unknown op" });
  } catch (e) {
    return send(res, 502, { error: String((e && e.message) || e) });
  }
};
