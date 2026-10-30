// Deleted / archived campaigns, ad sets and ads (Meta effective_status), stored in meta_object_status so the dashboard can tag them.
// Called by the Meta auto-sync at most once an hour, only when there's time left in the run. Needs supabase/object-status.sql.
const { all, VER } = require("./_metalib");
const GRAPH = "https://graph.facebook.com/" + VER;
const actId = (id) => (String(id).indexOf("act_") === 0 ? String(id) : "act_" + id);
const STATUSES = encodeURIComponent(JSON.stringify(["DELETED", "ARCHIVED"]));

async function refresh(accounts, sbFetch, opt) {
  opt = opt || {}; const runAt = new Date().toISOString(), out = { accounts: 0, objects: 0, errors: [] };
  try { const st = await sbFetch("alert_state?k=eq.objstatus&select=v"), last = st && st[0] && st[0].v && st[0].v.at;
    if (!opt.force && last && Date.now() - Date.parse(last) < 55 * 60000) return { skipped: "ran " + Math.round((Date.now() - Date.parse(last)) / 60000) + " min ago" }; }
  catch (e) { /* alert_state missing: run anyway */ }
  for (const a of accounts) {
    if (opt.deadline && Date.now() > opt.deadline) { out.errors.push("time up before " + (a.name || a.id)); break; }
    const id = actId(a.id), rows = [];
    try {
      const [c, s, d] = await Promise.all([
        all(GRAPH + "/" + id + "/campaigns?fields=id,name,effective_status&effective_status=" + STATUSES + "&limit=500", 4),
        all(GRAPH + "/" + id + "/adsets?fields=id,name,effective_status,campaign%7Bname%7D&effective_status=" + STATUSES + "&limit=500", 4),
        all(GRAPH + "/" + id + "/ads?fields=id,name,effective_status,campaign%7Bname%7D,adset%7Bname%7D&effective_status=" + STATUSES + "&limit=500", 6)]);
      c.forEach((x) => rows.push({ object_id: x.id, level: "campaign", account_id: id, status: x.effective_status, campaign: x.name || "", adset: "", ad: "", updated_at: runAt }));
      s.forEach((x) => rows.push({ object_id: x.id, level: "adset", account_id: id, status: x.effective_status, campaign: (x.campaign && x.campaign.name) || "", adset: x.name || "", ad: "", updated_at: runAt }));
      d.forEach((x) => rows.push({ object_id: x.id, level: "ad", account_id: id, status: x.effective_status, campaign: (x.campaign && x.campaign.name) || "", adset: (x.adset && x.adset.name) || "", ad: x.name || "", updated_at: runAt }));
      for (let i = 0; i < rows.length; i += 500) await sbFetch("meta_object_status?on_conflict=object_id", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 500)) });
      // read in full for this account: anything not returned now was restored (or is no longer kept by Meta)
      await sbFetch("meta_object_status?account_id=eq." + encodeURIComponent(id) + "&updated_at=lt." + encodeURIComponent(runAt), { method: "DELETE" });
      out.accounts++; out.objects += rows.length;
    } catch (e) {
      if (/meta_object_status|schema cache|does not exist/i.test(e.message)) return { skipped: "Run supabase/object-status.sql to mark deleted / archived items." };
      out.errors.push((a.name || id) + ": " + e.message.slice(0, 140));
    }
  }
  try { await sbFetch("alert_state?on_conflict=k", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ k: "objstatus", v: { at: runAt, accounts: out.accounts, objects: out.objects }, updated_at: runAt }]) }); } catch (e) {}
  return out;
}
module.exports = { refresh };
