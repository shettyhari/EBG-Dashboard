// Every 30 minutes (GitHub Actions calls this; see .github/workflows/meta-sync.yml):
// pulls yesterday + today from the Meta Marketing API for the ad accounts ticked in Settings,
// and replaces the stored Meta rows for those campaigns and days.
// Needs in Vercel: META_ACCESS_TOKEN, SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET (the same value as the GitHub secret).
// Turn it on/off in the dashboard: Settings › Meta API (direct) › Auto-sync every 30 minutes.
const crypto = require("crypto");
const { accountRows } = require("./_metalib");
const SB_URL = process.env.SUPABASE_URL || "https://oggmosadlkarwlurxdjk.supabase.co";
const AUTO_FILE = "Meta API · auto-sync";

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
function same(a, b) {
  const x = crypto.createHash("sha256").update(String(a || "")).digest(), y = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(x, y);
}
function sbFetch(path, opt) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  opt = opt || {};
  opt.headers = Object.assign({ apikey: key, authorization: "Bearer " + key, "content-type": "application/json" }, opt.headers || {});
  return fetch(SB_URL + "/rest/v1/" + path, opt).then(async (r) => {
    const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch (e) {}
    if (!r.ok) throw new Error("Database answered " + r.status + ": " + (b && (b.message || b.error) || t).toString().slice(0, 300));
    return b;
  });
}
const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const istDay = (offsetDays) => new Date(Date.now() + 330 * 60000 + (offsetDays || 0) * 864e5).toISOString().slice(0, 10);
const q = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

module.exports = async function handler(req, res) {
  try {
    const secret = process.env.CRON_SECRET || "";
    const given = String(req.headers["x-cron-secret"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    if (!secret || !same(given, secret)) return send(res, 401, { error: "Not allowed" });
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return send(res, 400, { error: "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel." });
    if (!process.env.META_ACCESS_TOKEN) return send(res, 400, { error: "META_ACCESS_TOKEN is not set in Vercel." });
    const st = await sbFetch("team_settings?id=eq.1&select=settings");
    const S = (st && st[0] && st[0].settings) || {};
    if (!S.metaAutoSync) return send(res, 200, { skipped: "Auto-sync is off (dashboard › Settings › Meta API)." });
    const accounts = (Array.isArray(S.metaAccounts) ? S.metaAccounts : []).filter((a) => a && a.id && a.on !== false);
    if (!accounts.length) return send(res, 200, { skipped: "No ad accounts ticked." });
    const from = istDay(-1), to = istDay(0);
    const kws = (S.keywords || []).filter((k) => k && k[0] && k[1]).map((k) => [String(k[0]).toLowerCase(), k[1]]);
    const kw = (t) => { const s = String(t || "").toLowerCase(); for (const k of kws) if (s.indexOf(k[0]) >= 0) return k[1]; return "Unmapped"; };
    const mm = {}, errors = [];
    for (const a of accounts) {
      try {
        const rows = await accountRows(a.id, from, to);
        rows.forEach((r) => {
          const camp = clean(r[4]), adset = clean(r[5]), ad = clean(r[6]), day = r[0]; if (!camp) return;
          const k = [camp, adset, ad, day].join("|~|"), x = mm[k];
          const row = { source_file: "Meta API · " + (r[2] || r[1]), campaign: camp, adset, ad, day, day_end: day, spend: r[7], results: r[8], result_indicator: r[9],
            currency: r[3] || "INR", brand: a.brand || kw(camp), impressions: r[10], clicks: r[11], reach: r[12] };
          if (x) { x.spend = Math.round((x.spend + row.spend) * 100) / 100; x.results += row.results; x.impressions += row.impressions; x.clicks += row.clicks; x.reach = null; if (!x.result_indicator) x.result_indicator = row.result_indicator; }
          else mm[k] = row;
        });
      } catch (e) { errors.push((a.name || a.id) + ": " + e.message); }
    }
    const rows = Object.values(mm);
    // one upload record for auto-sync, refreshed every run
    let up = await sbFetch("uploads?select=id,date_from,date_to&meta_files=cs." + encodeURIComponent('{"' + AUTO_FILE + '"}') + "&order=id.desc&limit=1");
    const files = [AUTO_FILE].concat(Array.from(new Set(rows.map((r) => r.source_file))));
    let uid;
    if (up && up[0]) uid = up[0].id;
    else { const ins = await sbFetch("uploads", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify([{ uploaded_by: "meta-auto-sync", meta_files: files, meta_rows: 0, crm_rows: 0, date_from: from, date_to: to }]) }); uid = ins[0].id; }
    if (rows.length) {
      const camps = Array.from(new Set(rows.map((r) => r.campaign)));
      for (let i = 0; i < camps.length; i += 40) {
        await sbFetch("meta_ad_rows?campaign=in.(" + encodeURIComponent(camps.slice(i, i + 40).map(q).join(",")) + ")&day=gte." + from + "&day_end=lte." + to, { method: "DELETE" });
      }
      const now = new Date().toISOString();
      for (let i = 0; i < rows.length; i += 500) {
        await sbFetch("meta_ad_rows?on_conflict=campaign,adset,ad,day,day_end", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows.slice(i, i + 500).map((r) => Object.assign({}, r, { upload_id: uid, updated_at: now }))) });
      }
    }
    const cnt = await fetch(SB_URL + "/rest/v1/meta_ad_rows?select=id&upload_id=eq." + uid, { method: "HEAD", headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY, prefer: "count=exact" } });
    const total = Number(String(cnt.headers.get("content-range") || "").split("/")[1]) || rows.length;
    const prev = up && up[0] ? up[0] : {};
    await sbFetch("uploads?id=eq." + uid, { method: "PATCH", body: JSON.stringify({ uploaded_at: new Date().toISOString(), meta_files: files, meta_rows: total,
      date_from: prev.date_from && prev.date_from < from ? prev.date_from : from, date_to: prev.date_to && prev.date_to > to ? prev.date_to : to,
      crm_file: errors.length ? ("Last run errors: " + errors.join(" | ")).slice(0, 900) : null }) });
    return send(res, errors.length && !rows.length ? 502 : 200, { from, to, accounts: accounts.length, rows: rows.length, errors });
  } catch (e) {
    return send(res, 502, { error: String((e && e.message) || e) });
  }
};
