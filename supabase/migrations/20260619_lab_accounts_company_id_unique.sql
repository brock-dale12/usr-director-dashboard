-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 02 — UNIQUE safeguard on lab_accounts.hubspot_company_id
--                                                  (dashboard-rebuild spec §8.3)
--
-- Now that the roster is deduped to one row per company, add a UNIQUE guard so a
-- second row can never be created for the same HubSpot company. NULLs are allowed
-- (a deal with no associated company keys on deal_id only) — a PARTIAL unique
-- index "where hubspot_company_id is not null" permits unlimited NULLs while
-- enforcing uniqueness for real company IDs.
--
-- Not strictly required (hubspot-sync upserts on deal_id), hence "Optional" in the
-- spec — but cheap insurance against the 923-row over-creation ever recurring.
--
-- PRE-FLIGHT: this CREATE INDEX fails if a duplicate already exists. Run the dup
-- check first; it should return zero rows on the clean ~255-row roster:
--   select hubspot_company_id, count(*)
--   from public.lab_accounts
--   where hubspot_company_id is not null
--   group by hubspot_company_id
--   having count(*) > 1;
-- ─────────────────────────────────────────────────────────────────────────────

create unique index if not exists lab_accounts_hubspot_company_id_key
  on public.lab_accounts (hubspot_company_id)
  where hubspot_company_id is not null;
