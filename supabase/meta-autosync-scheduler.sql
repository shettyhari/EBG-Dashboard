-- Meta API auto-sync every 30 minutes, run by the Supabase database itself (pg_cron + pg_net).
-- Run once in Supabase › SQL Editor › New query › paste › Run. Safe to run again.
-- It creates a random key in Supabase Vault and sends it to /api/meta-cron; nobody needs to copy it anywhere.
-- If your dashboard is not at https://ebg-dashboard.vercel.app, change the url below before running.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'meta_cron_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'meta_cron_key', 'Key the pg_cron job sends to /api/meta-cron');
  end if;
end $$;

create or replace function public.meta_cron_key_ok(k text) returns boolean
language sql security definer set search_path = '' as $$
  select coalesce(length(k), 0) >= 32 and exists (select 1 from vault.decrypted_secrets where name = 'meta_cron_key' and decrypted_secret = k)
$$;
revoke all on function public.meta_cron_key_ok(text) from public, anon, authenticated;
grant execute on function public.meta_cron_key_ok(text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'meta-auto-sync';
select cron.schedule('meta-auto-sync', '*/30 * * * *', $job$
  select net.http_post(
    url := 'https://ebg-dashboard.vercel.app/api/meta-cron',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_cron_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 65000);
$job$);

-- Check it: select * from cron.job_run_details order by start_time desc limit 5;
-- Answers from the dashboard: select status_code, content from net._http_response order by created desc limit 5;
-- Stop it: select cron.unschedule('meta-auto-sync');
