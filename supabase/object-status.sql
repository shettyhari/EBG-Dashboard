-- Deleted / archived campaigns, ad sets and ads, so the dashboard can mark them "Deleted" / "Archived".
-- Run once in Supabase › SQL Editor (project "EBG IN-House Report"). Safe to run again. Adds one table; changes nothing existing.
-- Filled by the Meta auto-sync (/api/meta-cron) about once an hour from Meta's effective_status (DELETED, ARCHIVED).
create table if not exists public.meta_object_status (
  object_id   text primary key,                  -- Meta id of the campaign / ad set / ad
  level       text not null,                     -- campaign | adset | ad
  account_id  text not null default '',
  status      text not null,                     -- DELETED | ARCHIVED
  campaign    text not null default '',
  adset       text not null default '',
  ad          text not null default '',
  updated_at  timestamptz not null default now()
);
create index if not exists meta_object_status_account on public.meta_object_status (account_id, updated_at);
alter table public.meta_object_status enable row level security;
drop policy if exists team_read on public.meta_object_status;
create policy team_read on public.meta_object_status for select to authenticated using ((select private.team_role()) is not null);
revoke insert, update, delete on public.meta_object_status from anon, authenticated;   -- written by the server only

select 'object status ready' as status;
