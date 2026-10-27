// Alerts to Telegram for one person (Settings › Alerts).
//   runActivity: who changed what in the synced Meta ad accounts (Meta's account activity log), checked every 5 minutes
//   runSummary:  every 30 minutes — live campaigns / ad sets / ads, today's spend, leads and CPL by brand, best and worst brand
//                (today by CPL, month-to-date by CPQL), plus CPL alerts: vs 7-day average, vs yesterday, vs target CPL
// Numbers use the same definitions as the dashboard: Meta leads = Meta "Results" of lead / chat campaigns; CPL = spend ÷ Meta leads;
// CRM leads and qualified leads come from TeleCRM (crm_leads).
const { graph, all, VER } = require("./_metalib");
const T = require("./_tg");
const GRAPH = "https://graph.facebook.com/" + VER;

const DEF = { activity: true, summary: true, cpl7: true, cplYday: true, cplTarget: true, pct: 20, minLeads: 3, quietFrom: 23, quietTo: 8, activityInQuiet: true };
const cfgOf = (S) => Object.assign({}, DEF, (S && S.alerts) || {});
const istMs = (t) => (t === undefined ? Date.now() : t) + 330 * 60000;
const istDay = (o) => new Date(istMs() + (o || 0) * 864e5).toISOString().slice(0, 10);
const istHour = () => new Date(istMs()).getUTCHours();
const addDays = (iso, d) => new Date(Date.parse(iso + "T00:00:00Z") + d * 864e5).toISOString().slice(0, 10);
const inr = (v) => "₹" + Math.round(Number(v) || 0).toLocaleString("en-IN");
const int = (v) => Math.round(Number(v) || 0).toLocaleString("en-IN");
const pct = (v) => (v > 0 ? "+" : "") + Math.round(v * 100) + "%";
const timeIst = (iso) => { const t = Date.parse(String(iso).replace(/([+-]\d{2})(\d{2})$/, "$1:$2")); if (!isFinite(t)) return ""; const d = new Date(istMs(t)); let h = d.getUTCHours(), m = d.getUTCMinutes(); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + ":" + String(m).padStart(2, "0") + " " + ap; };
function inQuiet(c) { const h = istHour(), a = +c.quietFrom, b = +c.quietTo; if (a === b) return false; return a < b ? h >= a && h < b : h >= a || h < b; }

/* small key/value state (service role only) */
async function getState(sbFetch, k) { const r = await sbFetch("alert_state?k=eq." + encodeURIComponent(k) + "&select=v"); return r && r[0] ? r[0].v : null; }
async function setState(sbFetch, k, v) { await sbFetch("alert_state?on_conflict=k", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ k, v, updated_at: new Date().toISOString() }]) }); }
async function logSent(sbFetch, kind, text) { try { await sbFetch("alert_log", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify([{ kind, text: String(text).slice(0, 8000) }]) }); } catch (e) { /* log only */ } }
async function chatOf(sbFetch) { const t = await getState(sbFetch, "telegram"); return t && t.chat_id ? t : null; }
async function deliver(sbFetch, kind, html) { const t = await chatOf(sbFetch); if (!t) return false; await T.send(t.chat_id, html); await logSent(sbFetch, kind, html); return true; }

const accountsOf = (S) => (Array.isArray(S.metaAccounts) ? S.metaAccounts : []).filter((a) => a && a.id && a.on !== false);
const actId = (id) => (String(id).indexOf("act_") === 0 ? String(id) : "act_" + id);
function brander(S) {
  const kws = (S.keywords || []).filter((k) => k && k[0] && k[1]).map((k) => [String(k[0]).toLowerCase(), k[1]]);
  return (acc, name) => (acc && acc.brand) || (function(){ const s = String(name || "").toLowerCase(); for (const k of kws) if (s.indexOf(k[0]) >= 0) return k[1]; return "Unmapped"; })();
}

/* ---------- 1. who changed what (Meta account activity log), in plain language ---------- */
const ACT = require("./_activity");
const IMPACT = { high: "🔴", medium: "🟠", low: "⚪" };
async function runActivity(S, sbFetch, opt) {
  opt = opt || {}; const c = cfgOf(S);
  if (!c.activity && !opt.force) return { skipped: "Change tracking is off." };
  if (!accountsOf(S).length) return { skipped: "No Meta ad accounts ticked." };
  // always stored for the dashboard's Ad account activity page; Telegram only when connected
  const r = await ACT.fetchAndStore(S, sbFetch, { getState, setState, backfillDays: 7 });
  const events = r.fresh, errors = r.errors;
  if (!events.length || opt.storeOnly) return { events: events.length, errors };
  if (inQuiet(c) && !c.activityInQuiet && !opt.force) return { events: events.length, errors, telegram: "quiet hours" };
  if (!T.configured() || !(await chatOf(sbFetch))) return { events: events.length, errors, telegram: "not connected" };
  const lines = ["🔔 <b>Ad account changes</b> (" + events.length + ")"];
  events.slice(0, 25).forEach((e) => { const d = ACT.describe(e), where = [e.campaign, e.adset && d.level !== "adset" ? e.adset : (d.level === "adset" ? e.adset || e.object_name : ""), e.ad].filter(Boolean);
    lines.push("", IMPACT[d.impact] + " <b>" + T.esc(d.what) + "</b>" + (d.status ? " · " + T.esc(d.status) : ""),
      "👤 " + T.esc(e.actor_name || e.application_name || "Meta (automatic)") + " · " + timeIst(e.event_time) + (e.brand ? " · " + T.esc(e.brand) : ""),
      "📍 " + T.esc(where.length ? where.join(" › ") : (e.object_name || e.account_name)),
      "💡 " + T.esc(d.remark)); });
  if (events.length > 25) lines.push("", "… and " + (events.length - 25) + " more on the dashboard › Ad account activity");
  if (errors.length) lines.push("", "⚠️ Couldn't read: " + T.esc(errors.join("; ")));
  await deliver(sbFetch, "activity", lines.join("\n"));
  return { events: events.length, errors };
}

/* ---------- 2. 30-minute summary + CPL alerts ---------- */
async function liveCounts(S) {
  const accs = accountsOf(S), brandOf = brander(S), out = {}, errors = [];
  await Promise.all(accs.map(async (a) => {
    try {
      const ads = await all(GRAPH + "/" + actId(a.id) + "/ads?fields=id,adset_id,campaign_id,campaign%7Bname%7D&effective_status=" + encodeURIComponent('["ACTIVE"]') + "&limit=500", 20);
      ads.forEach((x) => { const b = brandOf(a, x.campaign && x.campaign.name), o = out[b] || (out[b] = { camps: {}, sets: {}, ads: 0 });
        o.camps[x.campaign_id] = 1; o.sets[x.adset_id] = 1; o.ads++; });
    } catch (e) { errors.push((a.name || a.id) + ": " + e.message); }
  }));
  const res = {}; let tc = 0, ts = 0, ta = 0;
  Object.keys(out).forEach((b) => { const o = out[b], c = Object.keys(o.camps).length, s = Object.keys(o.sets).length; res[b] = { camps: c, sets: s, ads: o.ads }; tc += c; ts += s; ta += o.ads; });
  return { by: res, total: { camps: tc, sets: ts, ads: ta }, errors };
}
function agg(rows, from, to) { const o = {}; rows.forEach((r) => { if (r.day < from || r.day > to) return; const x = o[r.brand] || (o[r.brand] = { spend: 0, leads: 0, crm: 0, ql: 0 });
  x.spend += Number(r.spend) || 0; x.leads += Number(r.leads) || 0; x.crm += Number(r.crm) || 0; x.ql += Number(r.ql) || 0; }); return o; }
const cplOf = (x) => (x && x.leads > 0 ? x.spend / x.leads : null);
async function brandNumbers(S, sbFetch) {
  const today = istDay(0), mStart = today.slice(0, 8) + "01", from = addDays(today, -8) < mStart ? addDays(today, -8) : mStart;
  const rows = await sbFetch("rpc/alerts_brand_daily", { method: "POST", body: JSON.stringify({ p_from: from, p_excluded: S.excludedCampaigns || [] }) }) || [];
  return { today, rows, td: agg(rows, today, today), yd: agg(rows, addDays(today, -1), addDays(today, -1)), p7: agg(rows, addDays(today, -7), addDays(today, -1)), mtd: agg(rows, mStart, today) };
}
function cplChecks(S, N, c) {
  const out = [], mk = N.today.slice(0, 7), M = (((S.report || {}).months || {})[mk] || {}).brands || {}, lim = (+c.pct || 20) / 100;
  Object.keys(N.td).forEach((b) => { const t = N.td[b]; if (!t || t.leads < (+c.minLeads || 3)) return; const cpl = cplOf(t);
    const band = (ref) => (ref ? (cpl >= ref * (1 + lim) ? "high" : cpl <= ref * (1 - lim) ? "low" : "ok") : null);
    if (c.cpl7){ const r = cplOf(N.p7[b]); if (r) out.push({ b, rule: "7d", band: band(r), cpl, ref: r, label: "7-day average" }); }
    if (c.cplYday){ const r = cplOf(N.yd[b]); if (r) out.push({ b, rule: "yd", band: band(r), cpl, ref: r, label: "yesterday" }); }
    if (c.cplTarget){ const r = M[b] && Number(M[b].cpl); if (r > 0) out.push({ b, rule: "tg", band: cpl > r ? "high" : "low", cpl, ref: r, label: "target CPL", target: true }); }
  });
  return out;
}
async function runSummary(S, sbFetch, opt) {
  opt = opt || {}; const c = cfgOf(S);
  if (!(await chatOf(sbFetch))) return { skipped: "Telegram isn't connected (Settings › Alerts)." };
  if (inQuiet(c) && !opt.force) return { skipped: "Quiet hours." };
  const N = await brandNumbers(S, sbFetch), sent = [];
  /* CPL alerts: only when a brand moves into a new band (high / low / back to normal), once per band per day */
  if (c.cpl7 || c.cplYday || c.cplTarget) {
    const key = "cpl:" + N.today, st = (await getState(sbFetch, key)) || {}, msgs = [];
    cplChecks(S, N, c).forEach((x) => { const k = x.b + "|" + x.rule, prev = st[k];
      if (prev === x.band || (!prev && x.band === "ok") || (x.target && !prev && x.band === "low")) { st[k] = x.band; return; }
      st[k] = x.band; const ch = x.cpl / x.ref - 1;
      msgs.push((x.band === "high" ? "📈 <b>CPL up</b> · " : x.band === "low" ? "📉 <b>CPL down</b> · " : "↔️ <b>CPL back to normal</b> · ") + "<b>" + T.esc(x.b) + "</b>: today " + inr(x.cpl) +
        (x.target ? (x.band === "high" ? " is above" : " is back under") + " target " + inr(x.ref) : " vs " + x.label + " " + inr(x.ref) + " (" + pct(ch) + ")") + " · " + int(N.td[x.b].leads) + " leads, " + inr(N.td[x.b].spend)); });
    await setState(sbFetch, key, st);
    if (msgs.length) { await deliver(sbFetch, "cpl", msgs.join("\n")); sent.push("cpl:" + msgs.length); }
  }
  if (c.summary || opt.force) {
    const L = await liveCounts(S), brands = (S.brands || []).concat(Object.keys(N.mtd).filter((b) => (S.brands || []).indexOf(b) < 0 && b !== "Unmapped"));
    const t = Object.values(N.td).reduce((o, x) => ({ spend: o.spend + x.spend, leads: o.leads + x.leads, crm: o.crm + x.crm }), { spend: 0, leads: 0, crm: 0 });
    const now = new Date(istMs()), hh = now.getUTCHours() % 12 || 12, mm = String(now.getUTCMinutes()).padStart(2, "0"), ap = now.getUTCHours() >= 12 ? "pm" : "am";
    const lines = ["📊 <b>EBG Meta update · " + hh + ":" + mm + " " + ap + "</b>",
      "🟢 Live: <b>" + L.total.camps + "</b> campaigns · <b>" + L.total.sets + "</b> ad sets · <b>" + L.total.ads + "</b> ads",
      "💰 Today: " + inr(t.spend) + " spent · " + int(t.leads) + " Meta leads · " + int(t.crm) + " in TeleCRM · CPL " + (t.leads ? inr(t.spend / t.leads) : "—"), ""];
    brands.forEach((b) => { const d = N.td[b], l = L.by[b], m = N.mtd[b]; if (!d && !l && !m) return; if ((!d || !d.spend) && !l) return;
      const cpl = cplOf(d), r7 = cplOf(N.p7[b]), ch = cpl && r7 ? cpl / r7 - 1 : null;
      lines.push("<b>" + T.esc(b) + "</b>" + (l ? " · " + l.camps + "c/" + l.sets + "s/" + l.ads + "a" : " · nothing live") + "\n   " + (d ? inr(d.spend) + " · " + int(d.leads) + " leads · CPL " + (cpl ? inr(cpl) : "—") + (ch !== null ? " (" + pct(ch) + " vs 7d)" : "") : "no spend today")); });
    const minL = +c.minLeads || 3, ranked = Object.keys(N.td).filter((b) => b !== "Unmapped" && N.td[b].leads >= minL).sort((x, y) => cplOf(N.td[x]) - cplOf(N.td[y]));
    const zero = Object.keys(N.td).filter((b) => b !== "Unmapped" && N.td[b].spend >= 500 && !N.td[b].leads);
    lines.push("");
    if (ranked.length) { lines.push("🏆 Best today: <b>" + T.esc(ranked[0]) + "</b> · CPL " + inr(cplOf(N.td[ranked[0]])));
      if (ranked.length > 1 && cplOf(N.td[ranked[ranked.length - 1]]) > cplOf(N.td[ranked[0]]) * 1.001) lines.push("⚠️ Weakest today: <b>" + T.esc(ranked[ranked.length - 1]) + "</b> · CPL " + inr(cplOf(N.td[ranked[ranked.length - 1]]))); }
    else lines.push("Too few leads yet today to rank brands (need " + minL + "+ per brand).");
    if (zero.length) lines.push("🚫 Spending with 0 leads today: " + zero.map((b) => T.esc(b) + " " + inr(N.td[b].spend)).join(", "));
    const mq = Object.keys(N.mtd).filter((b) => b !== "Unmapped" && N.mtd[b].ql >= 1 && N.mtd[b].spend > 0).sort((x, y) => N.mtd[x].spend / N.mtd[x].ql - N.mtd[y].spend / N.mtd[y].ql);
    if (mq.length) { lines.push("📅 Month best (CPQL): <b>" + T.esc(mq[0]) + "</b> " + inr(N.mtd[mq[0]].spend / N.mtd[mq[0]].ql));
      if (mq.length > 1 && N.mtd[mq[mq.length - 1]].spend / N.mtd[mq[mq.length - 1]].ql > N.mtd[mq[0]].spend / N.mtd[mq[0]].ql * 1.001) lines.push("📅 Month weakest (CPQL): <b>" + T.esc(mq[mq.length - 1]) + "</b> " + inr(N.mtd[mq[mq.length - 1]].spend / N.mtd[mq[mq.length - 1]].ql)); }
    if (L.errors.length) lines.push("", "⚠️ Couldn't read live ads for: " + T.esc(L.errors.join("; ")));
    lines.push("", "<i>c/s/a = live campaigns / ad sets / ads. Numbers as in the dashboard (Meta sync every 30 min).</i>");
    await deliver(sbFetch, "summary", lines.join("\n")); sent.push("summary");
  }
  return { sent };
}
module.exports = { cfgOf, runActivity, runSummary, getState, setState, deliver, chatOf, brandNumbers, cplChecks, liveCounts, DEF };
