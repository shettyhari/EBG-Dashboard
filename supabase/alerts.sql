-- Telegram alerts (dashboard › Settings › Alerts). Run once in Supabase › SQL Editor. Safe to run again.
-- Needs meta-autosync-scheduler.sql first (reuses its Vault key). Change the url below if the dashboard isn't at https://ebg-dashboard.vercel.app.

-- 1. state (last activity seen per ad account, CPL bands, linked Telegram chat) and a log of what was sent
create table if not exists public.alert_state (
  k          text primary key,
  v          jsonb,
  updated_at timestamptz not null default now()
);
alter table public.alert_state enable row level security;          -- no policies: only the server (service role) reads / writes
revoke all on public.alert_state from anon, authenticated;

create table if not exists public.alert_log (
  id   bigint generated always as identity primary key,
  at   timestamptz not null default now(),
  kind text not null,             -- activity | cpl | summary | test
  text text not null
);
create index if not exists alert_log_at on public.alert_log (at desc);
alter table public.alert_log enable row level security;
revoke all on public.alert_log from anon, authenticated;            -- read through /api/alerts (team members)

-- 1b. Meta ad account activity (who changed what), kept for the dashboard's "Ad account activity" page (private: read through /api/alerts)
create table if not exists public.meta_activity (
  ev_key           text primary key,
  account_id       text not null,
  account_name     text not null default '',
  brand            text not null default '',
  event_time       timestamptz not null,
  event_type       text not null default '',
  translated       text not null default '',
  actor_name       text not null default '',
  actor_id         text not null default '',
  application_name text not null default '',
  object_type      text not null default '',
  object_id        text not null default '',
  object_name      text not null default '',
  level            text not null default '',
  campaign         text not null default '',
  adset            text not null default '',
  ad               text not null default '',
  extra            text,
  stored_at        timestamptz not null default now()
);
create index if not exists meta_activity_time on public.meta_activity (event_time desc);
alter table public.meta_activity enable row level security;
revoke all on public.meta_activity from anon, authenticated;

-- 2. brand × day numbers for the alerts, with the dashboard's definitions:
--    Meta leads = Results of lead / chat rows (not link clicks, landing page views…), excluded campaigns left out;
--    CRM leads = TeleCRM leads by created day, repeat leads (same person again) left out; ql = qualified leads.
create or replace function public.alerts_brand_daily(p_from date, p_excluded text[] default '{}')
returns table (brand text, day date, spend numeric, leads numeric, crm bigint, ql bigint)
language sql stable security definer set search_path = public as $$
  with m as (
    select coalesce(nullif(r.brand, ''), 'Unmapped') as brand, r.day, sum(r.spend) as spend,
           sum(case when (r.result_indicator = '' or r.result_indicator ~* 'lead|form|messag|conversation|whatsapp')
                     and not (r.campaign = any (coalesce(p_excluded, '{}'))) then r.results else 0 end) as leads
    from public.meta_ad_rows r
    where r.day >= p_from and r.day_end = r.day
    group by 1, 2),
  c as (
    select coalesce(nullif(l.brand, ''), 'Unmapped') as brand, l.created_on::date as day, count(*) as crm, count(*) filter (where l.is_ql) as ql
    from public.crm_leads l
    where l.created_on >= p_from and l.prev_lead is null
    group by 1, 2)
  select coalesce(m.brand, c.brand), coalesce(m.day, c.day), coalesce(m.spend, 0), coalesce(m.leads, 0), coalesce(c.crm, 0), coalesce(c.ql, 0)
  from m full join c on m.brand = c.brand and m.day = c.day
$$;
revoke all on function public.alerts_brand_daily(date, text[]) from public, anon, authenticated;
grant execute on function public.alerts_brand_daily(date, text[]) to service_role;

-- 3. schedules: ad account changes every 5 minutes; update + CPL alerts every 30 minutes (5 min after the Meta sync)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname in ('ebg-alerts-activity', 'ebg-alerts-summary');
select cron.schedule('ebg-alerts-activity', '*/5 * * * *', $job$
  select net.http_post(url := 'https://ebg-dashboard.vercel.app/api/alerts-cron?mode=activity',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_cron_key')),
    body := '{}'::jsonb, timeout_milliseconds := 65000);
$job$);
select cron.schedule('ebg-alerts-summary', '5,35 * * * *', $job$
  select net.http_post(url := 'https://ebg-dashboard.vercel.app/api/alerts-cron?mode=summary',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_cron_key')),
    body := '{}'::jsonb, timeout_milliseconds := 65000);
$job$);

-- check: two jobs
select jobname, schedule from cron.job where jobname like 'ebg-alerts-%' order by 1;
