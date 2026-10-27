-- EBG Ads monitoring (Telegram report, alerts with open / resolved tracking, Alerts & Monitoring page).
-- Run once in Supabase › SQL Editor after alerts.sql. Safe to run again. Adds new objects only; nothing existing is changed or deleted.

-- 1. brand × day and campaign × day numbers, with the dashboard's definitions
--    Meta leads = Results of lead / chat / website-lead rows (not link clicks or landing page views); excluded campaigns' results left out (their spend counts);
--    CRM leads = TeleCRM leads by created day, repeat leads left out; ql = qualified leads; impressions / clicks for CTR, CPC, CPM.
create or replace function public.mon_brand_daily(p_from date, p_excluded text[] default '{}')
returns table (brand text, day date, spend numeric, leads numeric, impressions bigint, clicks bigint, crm bigint, ql bigint, rows_n bigint)
language sql stable security definer set search_path = public as $$
  with m as (
    select coalesce(nullif(r.brand, ''), 'Unmapped') as brand, r.day, sum(r.spend) as spend,
           sum(case when (r.result_indicator = '' or r.result_indicator ~* 'lead|form|messag|conversation|whatsapp')
                     and not (r.campaign = any (coalesce(p_excluded, '{}'))) then r.results else 0 end) as leads,
           sum(r.impressions)::bigint as impressions, sum(r.clicks)::bigint as clicks, count(*) as rows_n
    from public.meta_ad_rows r where r.day >= p_from and r.day_end = r.day group by 1, 2),
  c as (
    select coalesce(nullif(l.brand, ''), 'Unmapped') as brand, l.created_on::date as day, count(*) as crm, count(*) filter (where l.is_ql) as ql
    from public.crm_leads l where l.created_on >= p_from and l.prev_lead is null group by 1, 2)
  select coalesce(m.brand, c.brand), coalesce(m.day, c.day), coalesce(m.spend, 0), coalesce(m.leads, 0), coalesce(m.impressions, 0), coalesce(m.clicks, 0),
         coalesce(c.crm, 0), coalesce(c.ql, 0), coalesce(m.rows_n, 0)
  from m full join c on m.brand = c.brand and m.day = c.day
$$;
create or replace function public.mon_campaign_daily(p_from date, p_excluded text[] default '{}')
returns table (brand text, campaign text, day date, spend numeric, leads numeric, impressions bigint, clicks bigint, lead_type boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(r.brand, ''), 'Unmapped'), r.campaign, r.day, sum(r.spend),
         sum(case when (r.result_indicator = '' or r.result_indicator ~* 'lead|form|messag|conversation|whatsapp') and not (r.campaign = any (coalesce(p_excluded, '{}'))) then r.results else 0 end),
         sum(r.impressions)::bigint, sum(r.clicks)::bigint,
         bool_or(r.result_indicator ~* 'lead|form|messag|conversation|whatsapp')
  from public.meta_ad_rows r where r.day >= p_from and r.day_end = r.day
  group by 1, 2, 3
$$;
revoke all on function public.mon_brand_daily(date, text[]) from public, anon, authenticated;
revoke all on function public.mon_campaign_daily(date, text[]) from public, anon, authenticated;
grant execute on function public.mon_brand_daily(date, text[]) to service_role;
grant execute on function public.mon_campaign_daily(date, text[]) to service_role;

-- 2. issues: one row per problem (key), open until it's no longer detected (then resolved), with acknowledgement and notes
create table if not exists public.alert_issues (
  key            text primary key,               -- e.g. cpl_up|Natuf, zero_leads|Acer|ACER | MD
  kind           text not null,                  -- cpl_up, zero_leads, stopped_spend, sync, account, …
  severity       text not null,                  -- critical | high | medium | low
  confirmed      boolean not null default true,  -- false = suspected
  status         text not null default 'open',   -- open | resolved
  brand          text not null default '',
  account        text not null default '',
  campaign       text not null default '',
  title          text not null default '',
  detail         jsonb not null default '{}'::jsonb,   -- current, baseline, change, impact, action …
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  last_notified  timestamptz,
  notified_value numeric,                        -- value at the last notification (re-notify when it changes materially)
  notify_count   integer not null default 0,
  missed         integer not null default 0,     -- consecutive checks it wasn't detected (resolved after 2)
  resolved_at    timestamptz,
  ack_by         text,
  ack_at         timestamptz,
  note           text
);
create index if not exists alert_issues_status on public.alert_issues (status, last_seen desc);
alter table public.alert_issues enable row level security;
revoke all on public.alert_issues from anon, authenticated;     -- read / acknowledged through /api/alerts (alert recipient only)

select 'monitoring ready' as status;
