-- ─────────────────────────────────────────────────────────────────────────────
-- Repair lab_assignments → join by ID, not fuzzy name   (dashboard-rebuild spec §5)
--
-- Context: after the company-grain rebuild, lab_accounts is a clean ~255-row
-- roster keyed by hubspot_company_id, with deal_id = the canonical active deal.
-- lab_assignments (the director ↔ lab registry that powers My Region / director
-- attribution) still joins to it by lab_name, which is fragile now that lab_name
-- is no longer unique. This backfills the HubSpot IDs onto lab_assignments so
-- attribution can join by ID and we can retire the fuzzy-name path.
--
-- Safe + idempotent + non-destructive:
--   • ADD COLUMN IF NOT EXISTS (re-runnable).
--   • Only fills IDs that are currently NULL (never overwrites a known value).
--   • Matches on normalized lab_name against the ACTIVE roster, deduped to one
--     row per name (prefers non-churn-flagged, lowest deal_id as tiebreak).
--
-- RUN ORDER: after the roster cleanup is done (255 rows, per the spec). Review
-- the verification SELECTs at the bottom before and after. Run in the Supabase
-- SQL editor (service role) — this writes data.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Columns (text — lab_accounts.deal_id / hubspot_company_id are stored as text).
alter table public.lab_assignments
  add column if not exists hubspot_deal_id    text,
  add column if not exists hubspot_company_id text;

-- Indexes for the by-ID joins this enables.
create index if not exists lab_assignments_hubspot_deal_id_idx
  on public.lab_assignments (hubspot_deal_id);
create index if not exists lab_assignments_hubspot_company_id_idx
  on public.lab_assignments (hubspot_company_id);

-- 2. Backfill IDs from the active roster, matched by normalized lab_name.
--    DISTINCT ON collapses any duplicate names to a single canonical roster row.
with roster as (
  select distinct on (lower(btrim(lab_name)))
         lower(btrim(lab_name)) as name_key,
         deal_id,
         hubspot_company_id
  from public.lab_accounts
  where coalesce(is_active, true) = true
  order by lower(btrim(lab_name)),
           coalesce(churn_flagged, false) asc,   -- prefer not-flagged
           deal_id asc
)
update public.lab_assignments la
set hubspot_deal_id    = coalesce(la.hubspot_deal_id, r.deal_id),
    hubspot_company_id = coalesce(la.hubspot_company_id, r.hubspot_company_id)
from roster r
where lower(btrim(la.lab_name)) = r.name_key
  and (la.hubspot_deal_id is null or la.hubspot_company_id is null);

-- 3. (OPTIONAL) Backfill director_id where it's missing, mapping the roster's
--    speed_lab_director (text name) → directors.id. Conservative: only fills
--    NULLs, only on an exact name match. Review the unmatched report first; if
--    your directors.name values don't line up, leave this commented out.
-- update public.lab_assignments la
-- set director_id = d.id
-- from public.lab_accounts a
--   join public.directors d
--     on lower(btrim(d.name)) = lower(btrim(a.speed_lab_director))
-- where la.hubspot_deal_id = a.deal_id
--   and la.director_id is null
--   and a.speed_lab_director is not null;

-- ─── Verification (run these to confirm the repair) ──────────────────────────
-- How many assignments now carry IDs vs. still name-only:
--   select
--     count(*)                                          as total,
--     count(*) filter (where hubspot_deal_id is not null)    as with_deal_id,
--     count(*) filter (where hubspot_company_id is not null) as with_company_id,
--     count(*) filter (where hubspot_deal_id is null)        as still_name_only
--   from public.lab_assignments;
--
-- Assignments that couldn't be matched to the active roster (name drift / churned):
--   select la.lab_name, la.director_id, la.active
--   from public.lab_assignments la
--   where la.hubspot_deal_id is null
--   order by la.lab_name;
