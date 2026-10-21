// Windsor.ai → Meta Ads daily rows for the dashboard.
// The API key is never sent to the browser: set WINDSOR_API_KEY in Vercel › Settings › Environment Variables.
// Every call must carry the signed-in user's Supabase token; only team members can use it,
// and only admins / editors can list accounts or pull data.
//   GET /api/windsor?op=status
//   GET /api/windsor?op=accounts
//   GET /api/windsor?op=data&from=YYYY-MM-DD&to=YYYY-MM-DD[&accounts=id1,id2]
const SB_URL = process.env.SUPABASE_URL || "https://oggmosadlkarwlurxdjk.supabase.co";
const SB_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nZ21vc2FkbGthcndsdXJ4ZGprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODEyNjQsImV4cCI6MjEwNzY1NzI2NH0.WfxddEbJwtIXlc5ENVM6fLmB46zmgi7eeVk02FWJfQ0";
const WINDSOR = "https://connectors.windsor.ai/facebook";
const FIELDS = ["date", "account_id", "account_name", "account_currency", "campaign", "adset_name", "ad_name", "objective", "spend", "impressions",
  "link_clicks", "reach", "actions_onsite_conversion_lead_grouped", "actions_lead", "actions_onsite_conversion_messaging_conversation_started_7d",
  "actions_landing_page_view", "actions_link_click"];
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
const n = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
/* what Meta's "Results" column would show for the row, from the campaign objective */
function result(r) {
  const obj = String(r.objective || "").toUpperCase();
  const leads = n(r.actions_onsite_conversion_lead_grouped) || n(r.actions_lead), msgs = n(r.actions_onsite_conversion_messaging_conversation_started_7d);
  const lpv = n(r.actions_landing_page_view), lc = n(r.actions_link_click) || n(r.link_clicks);
  const L = [leads, "Leads (form)"], M = [msgs, "Messaging conversations started"];
  if (/LEAD/.test(obj)) return leads > 0 ? L : msgs > 0 ? M : [0, ""];
  if (/ENGAGEMENT|MESSAG/.test(obj)) return msgs > 0 ? M : leads > 0 ? L : [0, ""];
  if (/TRAFFIC|LINK_CLICK/.test(obj)) return lpv > 0 ? [lpv, "Landing page views"] : lc > 0 ? [lc, "Link clicks"] : [0, ""];
  return leads > 0 ? L : msgs > 0 ? M : [0, ""];
}
async function windsor(params) {
  const q = new URLSearchParams(Object.assign({ api_key: process.env.WINDSOR_API_KEY }, params));
  const r = await fetch(WINDSOR + "?" + q.toString());
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch (e) { body = null; }
  if (!r.ok || !body) throw new Error("Windsor.ai answered " + r.status + (body && body.error ? ": " + (body.error.message || body.error) : text ? ": " + text.slice(0, 200) : ""));
  if (body.error) throw new Error("Windsor.ai: " + (body.error.message || body.error));
  return Array.isArray(body.data) ? body.data : [];
}

module.exports = async function handler(req, res) {
  try {
    const op = String((req.query && req.query.op) || "status");
    const key = process.env.WINDSOR_API_KEY || "";
    const me = await whoIs(req);
    if (!me || !me.role) return send(res, 401, { error: "Sign in with a team account first." });
    if (op === "status") return send(res, 200, { configured: !!key, last4: key ? key.slice(-4) : null, role: me.role });
    if (!key) return send(res, 400, { error: "WINDSOR_API_KEY is not set in Vercel yet." });
    if (me.role !== "admin" && me.role !== "editor") return send(res, 403, { error: "Only admins and editors can pull Windsor.ai data." });
    if (op === "accounts") {
      const rows = await windsor({ fields: "account_id,account_name,account_currency,spend", date_preset: "last_90d" });
      const by = {};
      rows.forEach((r) => { const id = String(r.account_id || ""); if (!id) return; const a = by[id] || (by[id] = { id, name: r.account_name || id, currency: r.account_currency || "", spend: 0 }); a.spend += n(r.spend); });
      return send(res, 200, { accounts: Object.values(by).sort((a, b) => b.spend - a.spend) });
    }
    if (op === "data") {
      const from = String(req.query.from || ""), to = String(req.query.to || "");
      if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) return send(res, 400, { error: "Pick a valid date range." });
      if ((Date.parse(to) - Date.parse(from)) / 864e5 > 92) return send(res, 400, { error: "Sync up to 93 days at a time." });
      const params = { fields: FIELDS.join(","), date_from: from, date_to: to };
      const acc = String(req.query.accounts || "").split(",").map((s) => s.trim()).filter((s) => /^(act_)?\d+$/.test(s));
      if (acc.length) params.select_accounts = acc.join(",");
      const rows = await windsor(params);
      const out = rows.filter((r) => r.campaign && DAY_RE.test(String(r.date || "").slice(0, 10))).map((r) => {
        const rs = result(r);
        return [String(r.date).slice(0, 10), String(r.account_id || ""), String(r.account_name || ""), String(r.account_currency || ""),
          String(r.campaign || ""), String(r.adset_name || ""), String(r.ad_name || ""),
          Math.round(n(r.spend) * 100) / 100, rs[0], rs[1], Math.round(n(r.impressions)), Math.round(n(r.link_clicks) || n(r.actions_link_click)),
          r.reach === null || r.reach === undefined || r.reach === "" ? null : Math.round(n(r.reach))];
      });
      return send(res, 200, { cols: ["date", "account_id", "account_name", "currency", "campaign", "adset", "ad", "spend", "results", "result_indicator", "impressions", "clicks", "reach"], rows: out });
    }
    return send(res, 400, { error: "Unknown op" });
  } catch (e) {
    return send(res, 502, { error: String((e && e.message) || e) });
  }
};

