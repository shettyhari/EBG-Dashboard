-- Creative analysis report: keeps each ad's Meta Ad ID so you can find the creative in Ads Manager.
-- Run once in Supabase › SQL Editor. Safe to run again. Until it's run, everything keeps working, just without Ad IDs.
alter table public.meta_ad_rows add column if not exists ad_id text not null default '';
select 'ad_id column ready' as status;
