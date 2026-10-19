-- EBG Lead Performance database
-- Run once in Supabase › SQL Editor › New query › paste › Run.
-- Safe to re-run: it creates what's missing and replaces functions, views and policies.

-- ---------------------------------------------------------------
-- Team members and roles: admin (everything), editor (upload, change shared settings), viewer (read)
-- ---------------------------------------------------------------
create table if not exists public.team_members (
  email      text primary key check (email = lower(email)),
  role       text not null check (role in ('admin', 'editor', 'viewer')),
  added_by   text,
  added_at   timestamptz not null default now()
);

-- the signed-in user's role, or null when they are not on the team
-- kept in a private schema so it is not callable through the API
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.team_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.team_members where email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;
revoke all on function private.team_role() from public;
grant execute on function private.team_role() to authenticated;

-- ---------------------------------------------------------------
-- Uploads: one row per "Add to database"
-- ---------------------------------------------------------------
create table if not exists public.uploads (
  id          bigint generated always as identity primary key,
  uploaded_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  uploaded_at timestamptz not null default now(),
  meta_files  text[] not null default '{}',
  crm_file    text,
  meta_rows   integer not null default 0,
  crm_rows    integer not null default 0,
  date_from   date,
  date_to     date
);

-- ---------------------------------------------------------------
-- Meta Ads rows: one per ad per reporting period (daily exports give one per day)
-- ---------------------------------------------------------------
create table if not exists public.meta_ad_rows (
  id               bigint generated always as identity primary key,
  campaign         text not null,
  adset            text not null default '',
  ad               text not null default '',
  day              date not null,
  day_end          date not null,
  spend            numeric(14, 2) not null default 0,
  results          numeric(14, 2) not null default 0,
  result_indicator text not null default '',
  currency         text not null default 'INR',
  brand            text not null default '',
  impressions      bigint not null default 0,
  clicks           bigint not null default 0,
  reach            bigint,
  upload_id        bigint references public.uploads(id) on delete set null,
  updated_at       timestamptz not null default now(),
  constraint meta_ad_rows_key unique (campaign, adset, ad, day, day_end),
  constraint meta_ad_rows_dates check (day_end >= day)
);
create index if not exists meta_ad_rows_day_idx on public.meta_ad_rows (day, day_end);
create index if not exists meta_ad_rows_upload_idx on public.meta_ad_rows (upload_id);

-- ---------------------------------------------------------------
-- TeleCRM leads: one row per Lead id; a newer upload updates status, owner and first call
-- ---------------------------------------------------------------
create table if not exists public.crm_leads (
  lead_id     text primary key,
  created_on  timestamp,          -- wall-clock time as exported (IST)
  lead_source text not null default '',
  campaign    text not null default '',
  adset       text not null default '',
  ad          text not null default '',
  status      text not null default '',
  crm_brand   text not null default '',
  first_call  timestamp,
  owner       text not null default '',
  manager     text not null default '',
  brand       text not null default '',   -- report brand from the dashboard's brand keywords
  is_ql       boolean not null default false,
  tat_min     numeric(10, 1),
  upload_id   bigint references public.uploads(id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index if not exists crm_leads_created_idx on public.crm_leads (created_on);
create index if not exists crm_leads_upload_idx on public.crm_leads (upload_id);

-- which uploaded file wrote each row, so an admin can remove one file of an upload
alter table public.meta_ad_rows add column if not exists source_file text not null default '';
alter table public.crm_leads add column if not exists source_file text not null default '';
create index if not exists meta_ad_rows_upload_file_idx on public.meta_ad_rows (upload_id, source_file);
create index if not exists crm_leads_upload_file_idx on public.crm_leads (upload_id, source_file);

-- ---------------------------------------------------------------
-- Duplicate leads: same person (phone, email or Facebook lead id) for the same brand.
-- Phone numbers and emails are never stored: lead_keys() returns HMAC keys made with a secret kept in Vault.
-- ---------------------------------------------------------------
alter table public.crm_leads add column if not exists phone_key text not null default '';
alter table public.crm_leads add column if not exists email_key text not null default '';
alter table public.crm_leads add column if not exists fb_lead_id text not null default '';
alter table public.crm_leads add column if not exists prev_lead text;
alter table public.crm_leads add column if not exists prev_created timestamp;
alter table public.crm_leads add column if not exists dup_match text;
create index if not exists crm_leads_phone_key_idx on public.crm_leads (brand, phone_key) where phone_key <> '';
create index if not exists crm_leads_email_key_idx on public.crm_leads (brand, email_key) where email_key <> '';
create index if not exists crm_leads_fb_lead_idx on public.crm_leads (brand, fb_lead_id) where fb_lead_id <> '';
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'lead_key_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'lead_key_pepper', 'HMAC key for lead duplicate detection');
  end if;
end $$;
create or replace function public.lead_keys(vals text[]) returns text[]
language plpgsql stable security definer set search_path = '' as $f$
declare pep text; out text[];
begin
  if (select private.team_role()) not in ('admin', 'editor') then raise exception 'not allowed'; end if;
  select decrypted_secret into pep from vault.decrypted_secrets where name = 'lead_key_pepper';
  select array_agg(case when coalesce(v, '') = '' then '' else encode(extensions.hmac(v, pep, 'sha256'), 'hex') end order by i)
    into out from unnest(vals) with ordinality as t(v, i);
  return coalesce(out, '{}');
end $f$;
revoke all on function public.lead_keys(text[]) from public, anon;
grant execute on function public.lead_keys(text[]) to authenticated;
create or replace function public.refresh_lead_dupes() returns integer
language plpgsql security invoker set search_path = '' as $f$
declare n integer;
begin
  if (select private.team_role()) not in ('admin', 'editor') then raise exception 'not allowed'; end if;
  with m as (
    select c.lead_id, p.lead_id as prev_lead, p.created_on as prev_created, p.how
    from public.crm_leads c
    left join lateral (
      select l.lead_id, l.created_on,
             case when c.phone_key <> '' and l.phone_key = c.phone_key then 'phone'
                  when c.email_key <> '' and l.email_key = c.email_key then 'email' else 'facebook lead id' end as how
      from public.crm_leads l
      where l.brand = c.brand and l.lead_id <> c.lead_id and c.created_on is not null and l.created_on is not null
        and (l.created_on < c.created_on or (l.created_on = c.created_on and l.lead_id < c.lead_id))
        and ((c.phone_key <> '' and l.phone_key = c.phone_key) or (c.email_key <> '' and l.email_key = c.email_key)
             or (c.fb_lead_id <> '' and l.fb_lead_id = c.fb_lead_id))
      order by l.created_on desc, l.lead_id desc limit 1) p on true)
  update public.crm_leads c set prev_lead = m.prev_lead, prev_created = m.prev_created, dup_match = m.how
  from m where m.lead_id = c.lead_id
    and (c.prev_lead is distinct from m.prev_lead or c.prev_created is distinct from m.prev_created or c.dup_match is distinct from m.how);
  get diagnostics n = row_count;
  return n;
end $f$;
revoke all on function public.refresh_lead_dupes() from public, anon;
grant execute on function public.refresh_lead_dupes() to authenticated;

-- ---------------------------------------------------------------
-- Shared settings (brands, keywords, QL rules, excluded campaigns): one row
-- ---------------------------------------------------------------
create table if not exists public.team_settings (
  id         integer primary key default 1 check (id = 1),
  settings   jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Days that have data (for the date picker)
-- ---------------------------------------------------------------
create or replace view public.data_days with (security_invoker = true) as
  select distinct d from (
    select generate_series(day, least(day_end, day + 400), interval '1 day')::date as d from public.meta_ad_rows
    union
    select created_on::date from public.crm_leads where created_on is not null
  ) x;

-- ---------------------------------------------------------------
-- Row level security: nothing is readable unless you are on the team
-- ---------------------------------------------------------------
alter table public.team_members  enable row level security;
alter table public.uploads       enable row level security;
alter table public.meta_ad_rows  enable row level security;
alter table public.crm_leads     enable row level security;
alter table public.team_settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['uploads', 'meta_ad_rows', 'crm_leads', 'team_settings'] loop
    execute format('drop policy if exists team_read on public.%I', t);
    execute format('drop policy if exists team_insert on public.%I', t);
    execute format('drop policy if exists team_update on public.%I', t);
    execute format('drop policy if exists team_delete on public.%I', t);
    execute format('create policy team_read on public.%I for select to authenticated using ((select private.team_role()) is not null)', t);
    execute format('create policy team_insert on public.%I for insert to authenticated with check ((select private.team_role()) in (''admin'', ''editor''))', t);
    execute format('create policy team_update on public.%I for update to authenticated using ((select private.team_role()) in (''admin'', ''editor'')) with check ((select private.team_role()) in (''admin'', ''editor''))', t);
    execute format('create policy team_delete on public.%I for delete to authenticated using ((select private.team_role()) = ''admin'')', t);
  end loop;
end $$;

drop policy if exists members_read on public.team_members;
drop policy if exists members_admin on public.team_members;
create policy members_read on public.team_members for select to authenticated
  using ((select private.team_role()) is not null or email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy members_admin on public.team_members for all to authenticated
  using ((select private.team_role()) = 'admin') with check ((select private.team_role()) = 'admin');

grant select, insert, update, delete on public.team_members, public.uploads, public.meta_ad_rows, public.crm_leads, public.team_settings to authenticated;
grant select on public.data_days to authenticated;
grant usage on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------
-- Reporting views (Looker Studio, SQL)
-- ---------------------------------------------------------------
create or replace view public.v_meta_daily with (security_invoker = true) as
  select day, day_end, brand, campaign, adset, ad, spend, results, result_indicator, currency, impressions, clicks,
         case when impressions > 0 then round(clicks::numeric / impressions, 4) end as ctr
  from public.meta_ad_rows;

create or replace view public.v_crm_leads with (security_invoker = true) as
  select lead_id, created_on, created_on::date as created_date, brand, crm_brand, lead_source,
         campaign, adset, ad, status, is_ql, owner, first_call, tat_min,
         case when created_on is null or first_call is null or first_call < created_on then null
              else (tat_min <= 30) end as within_30_min
  from public.crm_leads;

-- spend counts every campaign; Leads in UI counts lead forms and messaging conversations (WhatsApp / Messenger),
-- not landing page views or link clicks
create or replace view public.v_brand_daily with (security_invoker = true) as
  with m as (
    select day as d, brand, sum(spend) as spend,
           coalesce(sum(results) filter (where result_indicator = '' or result_indicator ilike '%lead%'
                                         or result_indicator ilike '%messaging%conversation%'), 0) as leads_in_ui,
           sum(impressions) as impressions, sum(clicks) as clicks
    from public.meta_ad_rows where day = day_end group by 1, 2),
  c as (
    select created_on::date as d, brand, count(*) as leads_in_crm, count(*) filter (where is_ql) as qualified_leads,
           avg(tat_min) as avg_tat_min
    from public.crm_leads where created_on is not null group by 1, 2)
  select coalesce(m.d, c.d) as day, coalesce(m.brand, c.brand) as brand,
         coalesce(m.spend, 0) as spend, coalesce(m.leads_in_ui, 0) as leads_in_ui,
         coalesce(c.leads_in_crm, 0) as leads_in_crm, coalesce(c.qualified_leads, 0) as qualified_leads,
         round(c.avg_tat_min, 1) as avg_tat_min,
         coalesce(m.impressions, 0) as impressions, coalesce(m.clicks, 0) as clicks,
         case when coalesce(m.impressions, 0) > 0 then round(m.clicks::numeric / m.impressions, 4) end as ctr
  from m full join c on m.d = c.d and m.brand = c.brand;
grant select on public.v_meta_daily, public.v_crm_leads, public.v_brand_daily to authenticated;

-- ---------------------------------------------------------------
-- FIRST ADMIN: put your own email here (lowercase) and run this line once.
-- ---------------------------------------------------------------
-- insert into public.team_members (email, role, added_by) values ('you@company.com', 'admin', 'setup') on conflict (email) do update set role = 'admin';

-- ---------------------------------------------------------------
-- OPTIONAL: read-only login for Looker Studio (PostgreSQL connector). Change the password, then run.
-- ---------------------------------------------------------------
-- create role looker_reader with login password 'CHANGE-THIS-PASSWORD';
-- grant usage on schema public to looker_reader;
-- grant select on public.meta_ad_rows, public.crm_leads to looker_reader;
-- grant select on public.v_meta_daily, public.v_crm_leads, public.v_brand_daily to looker_reader;
-- create policy looker_read on public.meta_ad_rows for select to looker_reader using (true);
-- create policy looker_read on public.crm_leads   for select to looker_reader using (true);
