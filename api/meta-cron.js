// Auto-sync (every 30 minutes): pulls the chosen date range from the Meta Marketing API for the ad accounts ticked in Settings,
// and replaces the stored Meta rows for those ad accounts and days (nothing is counted twice, even after a campaign is renamed).
// Called by the Supabase database scheduler (pg_cron, sends x-cron-key, checked against Supabase Vault),
// or by any scheduler / GitHub Actions that sends x-cron-secret = CRON_SECRET (Vercel env).
// Needs in Vercel: META_ACCESS_TOKEN and SUPABASE_SERVICE_ROLE_KEY.
// Range (dashboard › Settings › Meta API › Auto-sync): yesterday + today, last 3 / 7 / 14 / 30 days, this month, or the dashboard's dates.
// Every run refreshes yesterday + today first; older days in the range are refreshed in 7-day pieces, as many as fit in ~50 seconds,
// continuing where the last run stopped, so a long range is fully refreshed within a few runs.
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
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (iso, d) => new Date(Date.parse(iso + "T00:00:00Z") + d * 864e5).toISOString().slice(0, 10);
/* the auto-sync range from team settings, as ISO days (IST) */
function autoRange(S) {
  const t = istDay(0), k = String(S.metaAutoRange || "2");
  let from = addDays(t, -1), to = t;
  if (k === "today") from = t;
  else if (/^\d+$/.test(k) && +k > 2) from = addDays(t, -(+k - 1));
  else if (k === "mtd") from = t.slice(0, 8) + "01";
  else if (k === "shown" && DAY_RE.test(S.metaAutoFrom || "")) { from = S.metaAutoFrom; to = DAY_RE.test(S.metaAutoTo || "") && S.metaAutoTo < t ? S.metaAutoTo : t; }
  if (from > to) from = to;
  if (addDays(from, 92) < to) from = addDays(to, -92);
  return { from, to, key: k };
}
async function keyOk(k) {
  if (!k || String(k).length < 32) return false;
  try { return (await sbFetch("rpc/meta_cron_key_ok", { method: "POST", body: JSON.stringify({ k: String(k) }) })) === true; } catch (e) { return false; }
}
const BUDGET_MS = +process.env.META_CRON_BUDGET_MS || 50000;   // stop starting new pieces in time to finish within Vercel's 60 s
const q = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return send(res, 400, { error: "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel." });
    const secret = process.env.CRON_SECRET || "";
    const given = String(req.headers["x-cron-secret"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    const allowed = (secret && given && same(given, secret)) || await keyOk(req.headers["x-cron-key"]);
    if (!allowed) return send(res, 401, { error: "Not allowed" });
    if (!process.env.META_ACCESS_TOKEN) return send(res, 400, { error: "META_ACCESS_TOKEN is not set in Vercel." });
    const st = await sbFetch("team_settings?id=eq.1&select=settings,updated_at");
    const S = (st && st[0] && st[0].settings) || {}, stAt = st && st[0] ? st[0].updated_at : null;
    if (!S.metaAutoSync) return send(res, 200, { skipped: "Auto-sync is off (dashboard › Settings › Meta API)." });
    const accounts = (Array.isArray(S.metaAccounts) ? S.metaAccounts : []).filter((a) => a && a.id && a.on !== false);
    if (!accounts.length) return send(res, 200, { skipped: "No ad accounts ticked." });
    const R = autoRange(S);
    const kws = (S.keywords || []).filter((k) => k && k[0] && k[1]).map((k) => [String(k[0]).toLowerCase(), k[1]]);
    const kw = (t) => { const s = String(t || "").toLowerCase(); for (const k of kws) if (s.indexOf(k[0]) >= 0) return k[1]; return "Unmapped"; };

    // pieces: yesterday + today first (every run), then older days in 7-day pieces, newest first, continuing from the last run
    const recentFrom = R.from > addDays(R.to, -1) ? R.from : addDays(R.to, -1);
    const first = accounts.map((a) => ({ a, from: recentFrom, to: R.to }));
    const older = [];
    for (let end = addDays(recentFrom, -1); end >= R.from; end = addDays(end, -7)) {
      const f = addDays(end, -6) < R.from ? R.from : addDays(end, -6);
      accounts.forEach((a) => older.push({ a, from: f, to: end }));
    }
    const planKey = R.from + "|" + R.to.slice(0, 7) + "|" + accounts.map((a) => a.id).join(",");
    let cur = S.metaAutoCursor && S.metaAutoCursor.plan === planKey ? (S.metaAutoCursor.i || 0) % Math.max(1, older.length) : 0;
    const queue = first.concat(older.slice(cur), older.slice(0, cur));

    // one upload record for auto-sync, refreshed every run
    const up = await sbFetch("uploads?select=id,date_from,date_to&meta_files=cs." + encodeURIComponent('{"' + AUTO_FILE + '"}') + "&order=id.desc&limit=1");
    let uid;
    if (up && up[0]) uid = up[0].id;
    else { const ins = await sbFetch("uploads", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify([{ uploaded_by: "meta-auto-sync", meta_files: [AUTO_FILE], meta_rows: 0, crm_rows: 0, date_from: R.from, date_to: R.to }]) }); uid = ins[0].id; }

    const errors = [], done = [], files = new Set([AUTO_FILE]);
    let rowsSaved = 0, olderDone = 0, idx = 0;
    const took = { ms: 0, n: 0 };
    const save = async (job, raw) => {
      const mm = {};
      raw.forEach((r) => {
        const camp = clean(r[4]), adset = clean(r[5]), ad = clean(r[6]), day = r[0]; if (!camp) return;
        const k = [camp, adset, ad, day].join("|~|"), x = mm[k];
        const row = { source_file: "Meta API · " + (r[2] || r[1]), campaign: camp, adset, ad, day, day_end: day, spend: r[7], results: r[8], result_indicator: r[9],
          currency: r[3] || "INR", brand: job.a.brand || kw(camp), impressions: r[10], clicks: r[11], reach: r[12] };
        if (x) { x.spend = Math.round((x.spend + row.spend) * 100) / 100; x.results += row.results; x.impressions += row.impressions; x.clicks += row.clicks; x.reach = null; if (!x.result_indicator) x.result_indicator = row.result_indicator; }
        else mm[k] = row;
      });
      const rows = Object.values(mm); if (!rows.length) return;
      rows.forEach((r) => files.add(r.source_file));
      // replace this ad account's days first (by account + day, so renamed campaigns / ads don't stay twice)
      for (const f of Array.from(new Set(rows.map((r) => r.source_file))))
        await sbFetch("meta_ad_rows?source_file=eq." + encodeURIComponent(f) + "&day=gte." + job.from + "&day_end=lte." + job.to, { method: "DELETE" });
      const camps = Array.from(new Set(rows.map((r) => r.campaign)));
      for (let i = 0; i < camps.length; i += 40)
        await sbFetch("meta_ad_rows?campaign=in.(" + encodeURIComponent(camps.slice(i, i + 40).map(q).join(",")) + ")&day=gte." + job.from + "&day_end=lte." + job.to, { method: "DELETE" });
      const now = new Date().toISOString();
      for (let i = 0; i < rows.length; i += 500)
        await sbFetch("meta_ad_rows?on_conflict=campaign,adset,ad,day,day_end", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows.slice(i, i + 500).map((r) => Object.assign({}, r, { upload_id: uid, updated_at: now }))) });
      rowsSaved += rows.length;
    };
    const worker = async () => {
      while (idx < queue.length && Date.now() - t0 + (took.n ? took.ms / took.n : 8000) * 1.3 < BUDGET_MS) {
        const job = queue[idx++], isOld = idx > first.length, ts = Date.now();
        try {
          let raw, tries = 0;
          for (;;) {
            try { raw = await accountRows(job.a.id, job.from, job.to); break; }
            catch (e) { if (tries++ < 1 && /retry|incomplete|rate|limit|429|50\d|timeout|temporar|code (1|2|4|17|32|613)\b/i.test(e.message) && Date.now() - t0 < BUDGET_MS - 8000) { await new Promise((r) => setTimeout(r, 3000)); continue; } throw e; }
          }
          await save(job, raw);
          done.push((job.a.name || job.a.id) + " " + job.from + "→" + job.to);
        } catch (e) { errors.push((job.a.name || job.a.id) + " " + job.from + "→" + job.to + ": " + e.message); }
        took.ms += Date.now() - ts; took.n++;
        if (isOld) olderDone++;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const left = queue.length - idx;

    // remember where the older pieces stopped (only if nobody changed the settings meanwhile)
    if (older.length && stAt) {
      const next = { plan: planKey, i: (cur + olderDone) % older.length, at: new Date().toISOString() };
      try {
        const fresh = await sbFetch("team_settings?id=eq.1&select=settings,updated_at");
        if (fresh && fresh[0] && fresh[0].updated_at === stAt)
          await sbFetch("team_settings?id=eq.1&updated_at=eq." + encodeURIComponent(stAt), { method: "PATCH", body: JSON.stringify({ settings: Object.assign({}, fresh[0].settings, { metaAutoCursor: next }) }) });
      } catch (e) { /* not critical */ }
    }
    const cnt = await fetch(SB_URL + "/rest/v1/meta_ad_rows?select=id&upload_id=eq." + uid, { method: "HEAD", headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY, prefer: "count=exact" } });
    const total = Number(String(cnt.headers.get("content-range") || "").split("/")[1]) || rowsSaved;
    const note = "Range " + R.from + " → " + R.to + " · " + done.length + " of " + queue.length + " pieces this run" + (left ? " (rest continues next run)" : "");
    await sbFetch("uploads?id=eq." + uid, { method: "PATCH", body: JSON.stringify({ uploaded_at: new Date().toISOString(), meta_files: Array.from(files), meta_rows: total,
      date_from: R.from, date_to: R.to,
      crm_file: (errors.length ? "Last run errors: " + errors.join(" | ") : "Auto-sync: " + note).slice(0, 900) }) });
    return send(res, errors.length && !done.length ? 502 : 200, { from: R.from, to: R.to, accounts: accounts.length, pieces: queue.length, done: done.length, left, rows: rowsSaved, errors, ms: Date.now() - t0 });
  } catch (e) {
    return send(res, 502, { error: String((e && e.message) || e) });
  }
};
