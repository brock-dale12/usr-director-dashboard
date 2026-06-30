-- ─────────────────────────────────────────────────────────────────────────────
-- pg_cron schedule for the sync Edge Functions (SUPABASE-SYNC-CRON-SPEC §5).
-- Run ONCE in the Supabase SQL editor AFTER each function is deployed and parity-
-- verified. Staggered ~5 AM ET so data is fresh before the team logs in.
--
-- DST note: pg_cron runs in UTC. Times below are for EDT (5 AM ET = 09:00 UTC).
-- During EST, 5 AM ET = 10:00 UTC — either accept the 1h pre-dawn drift or keep
-- two seasonal schedules. (Spec Q4.)
--
-- Prereqs:
--   • extensions pg_cron + pg_net enabled
--   • service-role key in Vault as 'service_role_key'
--   • replace <PROJECT_REF> with your project ref
-- Dependency order: weekly (09:15) must finish before monthly (09:30); ttv + deals
-- are independent. Engagements job is NOT yet built — add it here once it ships.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper: POST a function with the service-role bearer from Vault.
-- (Inline per job below; factored here for readability.)
--   net.http_post(
--     url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/<fn>',
--     headers:= jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key'),'Content-Type','application/json'),
--     body   := '{}'::jsonb)

-- 05:00 ET — HubSpot deals (roster backbone; everything keys off lab_accounts)
select cron.schedule('sync-hubspot-deals', '0 9 * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-hubspot-deals',
    headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key'),'Content-Type','application/json'),
    body    := '{}'::jsonb);
$$);

-- 05:15 ET — weekly activity/health (Sat–Fri)
select cron.schedule('sync-weekly-activity', '15 9 * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-weekly-activity',
    headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key'),'Content-Type','application/json'),
    body    := '{}'::jsonb);
$$);

-- 05:20 ET — TTV (needs lab_accounts + onboarding_cs.kickoff_date)
select cron.schedule('sync-ttv', '20 9 * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-ttv',
    headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key'),'Content-Type','application/json'),
    body    := '{}'::jsonb);
$$);

-- 05:30 ET — monthly health (after weekly lands; reads weekly_health_snapshots)
select cron.schedule('sync-monthly-health', '30 9 * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-monthly-health',
    headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key'),'Content-Type','application/json'),
    body    := '{}'::jsonb);
$$);

-- To inspect / remove:
--   select * from cron.job;
--   select cron.unschedule('sync-ttv');
