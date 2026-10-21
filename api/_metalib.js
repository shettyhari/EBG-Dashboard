// Shared Meta Marketing API helpers for api/meta.js (manual sync) and api/meta-cron.js (every 30 minutes).
const VER = process.env.META_API_VERSION || "v23.0";
const GRAPH = "https://graph.facebook.com/" + VER;
const n = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
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
const COLS = ["date", "account_id", "account_name", "currency", "campaign", "adset", "ad", "spend", "results", "result_indicator", "impressions", "clicks", "reach"];
/* daily ad-level rows for one ad account, as arrays in COLS order */
async function accountRows(accountId, from, to) {
  const id = String(accountId).indexOf("act_") === 0 ? accountId : "act_" + accountId;
  const info = await graph(GRAPH + "/" + id + "?fields=name,currency");
  const q = new URLSearchParams({
    level: "ad", time_increment: "1", limit: "500", action_breakdowns: "action_type",
    time_range: JSON.stringify({ since: from, until: to }),
    fields: "date_start,campaign_name,adset_name,ad_name,objective,spend,impressions,inline_link_clicks,reach,actions",
  });
  const rows = await all(GRAPH + "/" + id + "/insights?" + q.toString(), 60);
  return rows.filter((r) => r.campaign_name).map((r) => {
    const rs = result(r);
    return [String(r.date_start).slice(0, 10), id, info.name || id, info.currency || "", String(r.campaign_name || ""), String(r.adset_name || ""), String(r.ad_name || ""),
      Math.round(n(r.spend) * 100) / 100, rs[0], rs[1], Math.round(n(r.impressions)), Math.round(n(r.inline_link_clicks)), r.reach === undefined ? null : Math.round(n(r.reach))];
  });
}
async function adAccounts() {
  const list = await all(GRAPH + "/me/adaccounts?fields=id,account_id,name,currency,account_status,amount_spent&limit=200", 10);
  return list.map((a) => ({ id: a.id, name: a.name || a.id, currency: a.currency || "", active: a.account_status === 1, spend: n(a.amount_spent) }))
    .sort((a, b) => (b.active - a.active) || (b.spend - a.spend));
}
module.exports = { VER, COLS, graph, all, result, accountRows, adAccounts, n };
