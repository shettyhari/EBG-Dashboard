-- Ask AI Settings & Configuration for Dashboard Chatbot
-- Run once in Supabase › SQL Editor › New query › paste › Run.
-- Safe to re-run: it creates what's missing and updates policies without touching existing data.
-- Only admin users can read or update the ai_settings table directly.

create table if not exists public.ai_settings (
  id            integer primary key default 1 check (id = 1),
  provider      text not null default 'gemini',
  model         text not null default 'gemini-1.5-flash',
  api_key       text not null default '',
  custom_url    text not null default '',
  system_prompt text not null default '',
  temperature   numeric(3, 2) not null default 0.30,
  enabled       boolean not null default true,
  updated_by    text,
  updated_at    timestamptz not null default now()
);

-- Row level security: only team admins can view or change AI configuration
alter table public.ai_settings enable row level security;

drop policy if exists ai_settings_admin on public.ai_settings;
create policy ai_settings_admin on public.ai_settings for all to authenticated
  using ((select private.team_role()) = 'admin')
  with check ((select private.team_role()) = 'admin');

-- Non-admin view: team members can check if AI is enabled and which model is active,
-- but cannot see the actual api_key
create or replace view public.v_ai_config as
  select id,
         provider,
         model,
         custom_url,
         system_prompt,
         temperature,
         enabled,
         (coalesce(api_key, '') <> '') as is_configured,
         updated_by,
         updated_at
  from public.ai_settings;

grant select, insert, update, delete on public.ai_settings to authenticated;
grant select on public.v_ai_config to authenticated;

-- Seed default configuration if empty
insert into public.ai_settings (id, provider, model, api_key, updated_by)
values (1, 'gemini', 'gemini-1.5-flash', '', 'system')
on conflict (id) do nothing;

select 'ai_settings table and policies ready' as status;

