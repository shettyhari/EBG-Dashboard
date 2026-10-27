-- Personal view settings (per login): table columns and campaigns left out / kept in.
-- Each person can only read and change their own row; nobody else's view is affected.
-- Run once in Supabase › SQL Editor. Safe to run again. (Without it, personal settings are kept per login in each browser only.)
create table if not exists public.user_prefs (
  email      text primary key default lower(coalesce(auth.jwt() ->> 'email', '')),
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_prefs enable row level security;
drop policy if exists own_row on public.user_prefs;
create policy own_row on public.user_prefs for all to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')) and (select private.team_role()) is not null)
  with check (email = lower(coalesce(auth.jwt() ->> 'email', '')) and (select private.team_role()) is not null);
grant select, insert, update, delete on public.user_prefs to authenticated;

select 'user_prefs ready' as status;
