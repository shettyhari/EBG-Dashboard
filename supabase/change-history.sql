-- Change history (like Meta / Google Ads "Change history"): who changed what, and when.
-- Run once in Supabase › SQL Editor. Safe to run again.
--
-- Recorded automatically by the database (nobody can skip or edit it):
--   * every saved settings change (brands, rules, targets, remarks, ad accounts, mappings…) with the old and new value
--   * data uploads added or deleted
--   * team members added, removed or given another role
-- Only changes made by signed-in people are recorded: the automatic Meta sync and the n8n TeleCRM push are not,
-- so the history isn't flooded every 30 minutes.

create table if not exists public.change_log (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  actor  text not null,                 -- email of the person who made the change
  area   text not null,                 -- settings | upload | team
  action text not null,                 -- changed | added | deleted
  detail jsonb not null default '{}'::jsonb
);
create index if not exists change_log_at on public.change_log (at desc);

alter table public.change_log enable row level security;
drop policy if exists team_read on public.change_log;
create policy team_read on public.change_log for select to authenticated using ((select private.team_role()) is not null);
-- no insert / update / delete policies: only the triggers below write here, and nobody can edit or delete history
revoke insert, update, delete on public.change_log from authenticated, anon;
grant select on public.change_log to authenticated;

create or replace function private.who() returns text language sql stable as $$
  select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
$$;

-- settings: one entry per save, holding only the top-level keys that changed ([old, new] for each)
create or replace function private.log_settings() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  who text := private.who();
  o jsonb := case when tg_op = 'UPDATE' then coalesce(old.settings, '{}'::jsonb) else '{}'::jsonb end;
  n jsonb := coalesce(new.settings, '{}'::jsonb);
  diff jsonb;
begin
  if who is null then return new; end if;              -- automatic jobs (service role) aren't people
  select jsonb_object_agg(k, jsonb_build_array(o -> k, n -> k)) into diff
  from (select jsonb_object_keys(o) k union select jsonb_object_keys(n)) keys
  where (o -> k) is distinct from (n -> k)
    and k not in ('metaAutoCursor');                   -- bookkeeping written by the sync, not a user change
  if diff is null then return new; end if;
  insert into public.change_log (actor, area, action, detail) values (who, 'settings', 'changed', jsonb_build_object('keys', diff));
  return new;
end $$;
drop trigger if exists log_settings on public.team_settings;
create trigger log_settings after insert or update on public.team_settings for each row execute function private.log_settings();

-- uploads added / deleted by people
create or replace function private.log_uploads() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare who text := private.who(); r public.uploads;
begin
  if who is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  insert into public.change_log (actor, area, action, detail) values (who, 'upload', case when tg_op = 'DELETE' then 'deleted' else 'added' end,
    jsonb_build_object('id', r.id, 'meta_files', to_jsonb(r.meta_files), 'crm_file', r.crm_file, 'meta_rows', r.meta_rows, 'crm_rows', r.crm_rows,
      'from', r.date_from, 'to', r.date_to, 'by', r.uploaded_by, 'uploaded_at', r.uploaded_at));
  return coalesce(new, old);
end $$;
drop trigger if exists log_uploads on public.uploads;
create trigger log_uploads after insert or delete on public.uploads for each row execute function private.log_uploads();

-- team members
create or replace function private.log_team() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare who text := private.who();
begin
  if who is null then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and old.role is not distinct from new.role then return new; end if;
  insert into public.change_log (actor, area, action, detail) values (who, 'team',
    case tg_op when 'INSERT' then 'added' when 'DELETE' then 'deleted' else 'changed' end,
    jsonb_build_object('email', coalesce(new.email, old.email), 'old_role', case when tg_op <> 'INSERT' then old.role end, 'new_role', case when tg_op <> 'DELETE' then new.role end));
  return coalesce(new, old);
end $$;
drop trigger if exists log_team on public.team_members;
create trigger log_team after insert or update or delete on public.team_members for each row execute function private.log_team();

-- check: should list the 3 triggers
select event_object_table as "table", trigger_name from information_schema.triggers where trigger_name in ('log_settings', 'log_uploads', 'log_team') group by 1, 2 order by 1;
