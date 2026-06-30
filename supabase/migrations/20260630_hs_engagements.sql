-- ─────────────────────────────────────────────────────────────────────────────
-- New table: hs_engagements — read-only mirror of HubSpot notes + meetings
--                                          (SUPABASE-SYNC-CRON-SPEC §3 / Job 2 / Q6)
--
-- Powers the activity timeline on the customer detail drawer: a read-only HubSpot
-- mirror, visually distinct from internal team notes (which stay Supabase-native +
-- editable). Populated by the `sync-hubspot-engagements` Edge Function:
--   • association grain = deal only
--   • backfill last 12 months on first run, then daily incremental by hs_last_modified
--   • includes upcoming/scheduled (future-dated) meetings for call prep
--   • stores full note/meeting body as HTML — sanitize on render
--
-- RLS: enabled. Authenticated CSMs read; only the service_role (Edge Function /
-- Netlify functions) writes. Matches the read-model convention (client reads,
-- server writes). If the existing read tables grant SELECT to `anon` instead of
-- `authenticated`, align this policy to match.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.hs_engagements (
  engagement_id    bigint primary key,             -- HubSpot engagement/object id
  type             text not null,                  -- 'note' | 'meeting'
  deal_id          text not null,                  -- associated deal (canonical spine)
  owner_name       text,                           -- resolved from hubspot_owner_id
  occurred_at      timestamptz not null,           -- note created_at / meeting start
  meeting_end      timestamptz,                    -- meetings only
  meeting_outcome  text,                           -- scheduled|completed|no_show|canceled|rescheduled
  title            text,
  body_html        text,                           -- full note/meeting body (sanitize on render)
  is_upcoming      boolean generated always as (occurred_at > now()) stored,
  hs_last_modified timestamptz,                    -- drives incremental sync
  synced_at        timestamptz not null default now()
);

comment on table public.hs_engagements is
  'Read-only mirror of HubSpot notes + meetings, associated by deal. Written only by the sync-hubspot-engagements Edge Function (service_role). Rendered as the customer activity timeline.';

create index if not exists hs_engagements_deal_occurred_idx
  on public.hs_engagements (deal_id, occurred_at desc);
create index if not exists hs_engagements_type_upcoming_idx
  on public.hs_engagements (type, is_upcoming);

alter table public.hs_engagements enable row level security;

drop policy if exists hs_engagements_read on public.hs_engagements;
create policy hs_engagements_read
  on public.hs_engagements
  for select
  to authenticated
  using (true);
-- No insert/update/delete policies: writes go through the service_role key only.

-- ─────────────────────────────────────────────────────────────────────────────
-- sync_runs — confirm observability columns + the "latest per job" index
-- (SUPABASE-SYNC-CRON-SPEC §3). Table already exists (hubspot-sync.js records to
-- it); these are additive/idempotent so a re-run is safe.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sync_runs
  add column if not exists job          text,
  add column if not exists started_at   timestamptz,
  add column if not exists finished_at  timestamptz,
  add column if not exists status       text,        -- 'success' | 'error'
  add column if not exists rows_upserted integer,
  add column if not exists error        text;

create index if not exists sync_runs_job_started_idx
  on public.sync_runs (job, started_at desc);
