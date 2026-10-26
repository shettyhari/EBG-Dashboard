// Google Ads API (direct) for the dashboard. Every call must carry the signed-in user's Supabase token.
//   GET /api/google?op=status                       (any team member)
//   GET /api/google?op=accounts                     (admin / editor: every account the Google login can reach, direct or through a manager / MCC)
//   GET /api/google?op=sync[&from=YYYY-MM-DD&to=…]  (admin / editor: "Sync now" — same as the 30-minute auto-sync)
// Vercel env: see api/_gadslib.js. Sync also needs SUPABASE_SERVICE_ROLE_KEY.
const SB_URL = process.env.SUPABASE_URL || "https://oggmosadlkarwlurxdjk.supabase.co";
const SB_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nZ21vc2FkbGthcndsdXJ4ZGprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODEyNjQsImV4cCI6MjEwNzY1NzI2NH0.WfxddEbJwtIXlc5ENVM6fLmB46zmgi7eeVk02FWJfQ0";
const G = require("./_gadslib");
const { syncGoogle } = require("./_gadsync");

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
module.exports = async function handler(req, res) {
  try {
    const op = String((req.query && req.query.op) || "status");
    const me = await whoIs(req);
    if (!me || !me.role) return send(res, 401, { error: "Sign in with a team account first." });
    if (op === "status") return send(res, 200, { configured: G.configured(), version: G.VER, mcc: G.digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) || null, role: me.role, syncReady: !!process.env.SUPABASE_SERVICE_ROLE_KEY });
    if (!G.configured()) return send(res, 400, { error: "Google Ads isn't connected yet: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET and GOOGLE_ADS_REFRESH_TOKEN must be set in Vercel." });
    if (me.role !== "admin" && me.role !== "editor") return send(res, 403, { error: "Only admins and editors can do this." });
    if (op === "accounts") return send(res, 200, await G.listAccounts());
    if (op === "sync") {
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return send(res, 400, { error: "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel." });
      const st = await sbFetch("team_settings?id=eq.1&select=settings");
      const S = (st && st[0] && st[0].settings) || {};
      return send(res, 200, await syncGoogle(S, sbFetch, { from: req.query.from, to: req.query.to, budgetMs: 50000 }));
    }
    return send(res, 400, { error: "Unknown op" });
  } catch (e) { return send(res, 502, { error: String((e && e.message) || e) }); }
};
