// Meta Marketing API (direct) → Meta Ads daily rows for the dashboard.
// The token is never sent to the browser: set META_ACCESS_TOKEN (a System User token with ads_read)
// in Vercel › Settings › Environment Variables. Optional: META_API_VERSION (default v23.0).
// Every call must carry the signed-in user's Supabase token; only team admins / editors can list accounts or pull data.
//   GET /api/meta?op=status
//   GET /api/meta?op=accounts
//   GET /api/meta?op=data&from=YYYY-MM-DD&to=YYYY-MM-DD&accounts=act_1
const SB_URL = process.env.SUPABASE_URL || "https://oggmosadlkarwlurxdjk.supabase.co";
const SB_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nZ21vc2FkbGthcndsdXJ4ZGprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODEyNjQsImV4cCI6MjEwNzY1NzI2NH0.WfxddEbJwtIXlc5ENVM6fLmB46zmgi7eeVk02FWJfQ0";
const VER = process.env.META_API_VERSION || "v23.0";
const GRAPH = "https://graph.facebook.com/" + VER;
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
async function graph(url) {
  const r = await fetch(url, { headers: { authorization: "Bearer " + process.env.META_ACCESS_TOKEN } });
  const body = await r.json().catch(() => null);
  if (!r.ok || !body || body.error) {
    const e = body && body.error ? body.error : {};
    throw new Error("Meta answered " + r.status + ": " + (e.message || "unknown error") + (e.code ? " (code " + e.code + (e.error_subcode ? "/" + e.error_subcode : "") + ")" : ""));
  }
  return body;
}
async function all(url, max) {
  let out = [], next = url, pages = 0;
  while (next && pages < (max || 50)) { const b = await graph(next); out = out.concat(b.data || []); next = b.paging && b.paging.next; pages++; }
  return out;
}
const n = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
const act = (list, types) => { let s = 0; (list || []).forEach((a) => { if (types.indexOf(a.action_type) >= 0) s += n(a.value); }); return s; };
/* what Meta's "Results" column would show for the row, from the campaign objective */
function result(r) {
  const obj = String(r.objective || "").toUpperCase(), A = r.actions || [];
  const leads = act(A, ["onsite_conversion.lead_grouped"]) || act(A, ["lead"]) || act(A, ["leadgen.other"]);
  const msgs = act(A, ["onsite_conversion.messaging_conversation_started_7d"]);
  const lpv = act(A, ["landing_page_view"]), lc = act(A, ["link_click"]) || n(r.inline_link_clicks);
  const L = [leads, "Leads (form)"], M = [msgs, "Messaging conversations started"];
  if (/LEAD/.test(obj)) return leads > 0 ? L : msgs > 0 ? M : [0, ""];
  if (/ENGAGEMENT|MESSAG/.test(obj)) return msgs > 0 ? M : leads > 0 ? L : [0, ""];
  if (/TRAFFIC|LINK_CLICK/.test(obj)) return lpv > 0 ? [lpv, "Landing page views"] : lc > 0 ? [lc, "Link clicks"] : [0, ""];
  return leads > 0 ? L : msgs > 0 ? M : [0, ""];
}

module.exports = async function handler(req, res) {
  try {
    const op = String((req.query && req.query.op) || "status");
    const tok = process.env.META_ACCESS_TOKEN || "";
    const me = await whoIs(req);
    if (!me || !me.role) return send(res, 401, { error: "Sign in with a team account first." });
    if (op === "status") return send(res, 200, { configured: !!tok, last4: tok ? tok.slice(-4) : null, role: me.role, version: VER });
    if (!tok) return send(res, 400, { error: "META_ACCESS_TOKEN is not set in Vercel yet." });
    if (me.role !== "admin" && me.role !== "editor") return send(res, 403, { error: "Only admins and editors can pull Meta data." });
    if (op === "accounts") {
      const list = await all(GRAPH + "/me/adaccounts?fields=id,account_id,name,currency,account_status,amount_spent&limit=200", 10);
      return send(res, 200, { accounts: list.map((a) => ({ id: a.id, name: a.name || a.id, currency: a.currency || "", active: a.account_status === 1, spend: n(a.amount_spent) }))
        .sort((a, b) => (b.active - a.active) || (b.spend - a.spend)) });
    }
    if (op === "data") {
      const from = String(req.query.from || ""), to = String(req.query.to || "");
      if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) return send(res, 400, { error: "Pick a valid date range." });
      if ((Date.parse(to) - Date.parse(from)) / 864e5 > 31) return send(res, 400, { error: "Pull up to 31 days per call." });
      const acc = String(req.query.accounts || "").split(",").map((s) => s.trim()).filter((s) => /^(act_)?\d+$/.test(s)).map((s) => (s.indexOf("act_") === 0 ? s : "act_" + s));
      if (acc.length !== 1) return send(res, 400, { error: "Pull one ad account per call." });
      const info = await graph(GRAPH + "/" + acc[0] + "?fields=name,currency");
      const q = new URLSearchParams({
        level: "ad", time_increment: "1", limit: "500", action_breakdowns: "action_type",
        time_range: JSON.stringify({ since: from, until: to }),
        fields: "date_start,campaign_name,adset_name,ad_name,objective,spend,impressions,inline_link_clicks,reach,actions",
      });
      const rows = await all(GRAPH + "/" + acc[0] + "/insights?" + q.toString(), 60);
      const out = rows.filter((r) => r.campaign_name).map((r) => {
        const rs = result(r);
        return [String(r.date_start).slice(0, 10), acc[0], info.name || acc[0], info.currency || "", String(r.campaign_name || ""), String(r.adset_name || ""), String(r.ad_name || ""),
          Math.round(n(r.spend) * 100) / 100, rs[0], rs[1], Math.round(n(r.impressions)), Math.round(n(r.inline_link_clicks)), r.reach === undefined ? null : Math.round(n(r.reach))];
      });
      return send(res, 200, { cols: ["date", "account_id", "account_name", "currency", "campaign", "adset", "ad", "spend", "results", "result_indicator", "impressions", "clicks", "reach"], rows: out });
    }
    return send(res, 400, { error: "Unknown op" });
  } catch (e) {
    return send(res, 502, { error: String((e && e.message) || e) });
  }
};
