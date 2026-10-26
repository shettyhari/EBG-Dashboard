-- Google Ads in the dashboard. Run once in Supabase › SQL Editor › New query › paste › Run. Safe to run again.
-- Needs the Meta auto-sync scheduler (meta-autosync-scheduler.sql) to have been run first: it reuses its Vault key.
-- If your dashboard is not at https://ebg-dashboard.vercel.app, change the url near the bottom before running.

-- 1. Google Ads rows: one per campaign per day, kept apart from Meta so the two can never mix
create table if not exists public.google_ad_rows (
  id            bigint generated always as identity primary key,
  account_id    text not null,
  account_name  text not null default '',
  campaign_id   text not null,
  campaign      text not null,
  campaign_type text not null default '',
  day           date not null,
  spend         numeric(14, 2) not null default 0,
  conversions   numeric(14, 2) not null default 0,
  impressions   bigint not null default 0,
  clicks        bigint not null default 0,
  currency      text not null default 'INR',
  brand         text not null default '',
  updated_at    timestamptz not null default now(),
  constraint google_ad_rows_key unique (account_id, campaign_id, day)
);
create index if not exists google_ad_rows_day_idx on public.google_ad_rows (day);

alter table public.google_ad_rows enable row level security;
drop policy if exists team_read on public.google_ad_rows;
create policy team_read on public.google_ad_rows for select to authenticated using ((select private.team_role()) is not null);
-- only the sync (service role) writes these rows
revoke insert, update, delete on public.google_ad_rows from authenticated, anon;
grant select on public.google_ad_rows to authenticated;

-- 2. TeleCRM leads that came from Google: the UTM Campaign (and source, medium, gclid) TeleCRM sends are kept in crm_leads.extra.
--    Column names are matched loosely ("UTM Campaign", "utm_campaign", "Utm campaign" …).
create or replace function private.extra_get(x jsonb, want text[]) returns text
language sql immutable as $$
  select nullif(trim(e.value), '') from jsonb_each_text(coalesce(x, '{}'::jsonb)) e
  where regexp_replace(lower(e.key), '[^a-z]', '', 'g') = any (want) and nullif(trim(e.value), '') is not null
  order by array_position(want, regexp_replace(lower(e.key), '[^a-z]', '', 'g')) limit 1
$$;

create or replace view public.v_crm_google with (security_invoker = true) as
select * from (
  select l.lead_id, l.created_on, l.lead_source, l.status, l.crm_brand, l.first_call, l.owner, l.manager, l.prev_lead, l.prev_created, l.dup_match,
         l.lead_name, l.phone, l.email,
         private.extra_get(l.extra, array['utmcampaign', 'googlecampaignname', 'googlecampaign', 'googleadscampaign']) as utm_campaign,
         private.extra_get(l.extra, array['utmsource']) as utm_source,
         private.extra_get(l.extra, array['utmmedium']) as utm_medium,
         private.extra_get(l.extra, array['utmcontent', 'utmadgroup']) as utm_content,
         private.extra_get(l.extra, array['gclid']) as gclid
  from public.crm_leads l
) g
where g.lead_source ~* 'google|adwords'
   or g.gclid is not null
   or coalesce(g.utm_source, '') ~* 'google|adwords'
   or (g.utm_campaign is not null and coalesce(g.utm_source, '') !~* '(facebook|^fb|instagram|^ig$|^meta)');
grant select on public.v_crm_google to authenticated;

-- 3. Auto-sync every 30 minutes (minute 15 and 45, so it doesn't run together with the Meta sync)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'google-auto-sync';
select cron.schedule('google-auto-sync', '15,45 * * * *', $job$
  select net.http_post(
    url := 'https://ebg-dashboard.vercel.app/api/google-cron',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_cron_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 65000);
$job$);

-- check: should show google_ad_rows, v_crm_google and the google-auto-sync job
select 'table' as what, count(*)::text as detail from public.google_ad_rows
union all select 'view', count(*)::text from public.v_crm_google
union all select 'scheduler', schedule from cron.job where jobname = 'google-auto-sync';
