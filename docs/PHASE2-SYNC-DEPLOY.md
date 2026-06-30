# Phase 2 — Sync layer: deploy & verify checklist

> Builds on `SUPABASE-SYNC-CRON-SPEC.md`. Code is written but **not yet run against prod**.
> The spec mandates a **parity check before trusting** any ported job. Deployment +
> secrets + `pg_cron` are human steps (spec §7).

## Decisions baked into this build (2026-06-30)
- **TTV is kickoff-anchored, not calendar-week.** 7-day window starts at the manually-set
  `onboarding_cs.kickoff_date`; count `assessment_reports` by `created_at` in `[kickoff, kickoff+7)`,
  `deleted_at IS NULL`, all sources, no verification filter. → `sync-ttv`.
- **Weekly health weeks = Sat–Fri** (Doc's convention), *not* the Monday-based weeks in the vault Python.
  ⚠️ This means the ported `sync-weekly-activity` will **not** match the existing Monday-based
  `weekly_health_snapshots` rows — a one-time recompute/reconciliation is needed (see Verify).
- **Org→HubSpot linkage = `organizations.hubspot_company_id` DB column** + `lab_accounts` (deal_id ↔ company_id).
  No CSV dependency.

## What's built
| Piece | File | Status |
|---|---|---|
| Athena client | `supabase/functions/_shared/athena.ts` | ✅ written |
| Supabase writer + `recordRun` | `supabase/functions/_shared/db.ts` | ✅ written |
| Slack failure alert | `supabase/functions/_shared/slack.ts` | ✅ written |
| `hs_engagements` + `sync_runs` cols | `supabase/migrations/20260630_hs_engagements.sql` | ✅ written |
| **TTV sync (kickoff-anchored)** | `supabase/functions/sync-ttv/index.ts` | ✅ written, unrun |
| `sync-weekly-activity` (Sat–Fri) | `supabase/functions/sync-weekly-activity/index.ts` | ✅ written, unrun |
| `sync-monthly-health` | `supabase/functions/sync-monthly-health/index.ts` | ✅ written, unrun |
| `sync-hubspot-deals` (port hubspot-sync.js) | `supabase/functions/sync-hubspot-deals/index.ts` | ✅ written, unrun |
| `sync-hubspot-engagements` | — | ▢ deferred (net-new; hs_engagements table ready) |
| `pg_cron` schedule | `supabase/cron-schedule.sql` | ✅ written (4 jobs) |

**`sync-weekly-activity` write columns** (must match the table): `director_id, lab_name, week_start,
health_color, days_since_activity, last_activity_date, org_id, logins_week, data_pts_week, prs_week,
athletes_added_week, recaps_week, trigger_type`; on_conflict `(lab_name, week_start)`. Roster from
`lab_assignments` (lab_name, director_id, hubspot_company_id). Note: writes `trigger_type='cron'`.

**Only `sync-hubspot-engagements` remains unbuilt** — the one net-new pull (HubSpot notes + meetings
→ `hs_engagements`, 12-mo backfill then incremental by `hs_lastmodifieddate`). Deferred as the most
API-specific piece; its table + indexes are already migrated. `sync-hubspot-deals` runs cron-style
(no per-user admin gate) — if you wire "Refresh now" to it, gate the invocation (verify_jwt + is_admin)
at the edge. Wire `pg_cron` via `supabase/cron-schedule.sql` only after each function is parity-verified.

## Prereqs (human)
1. Supabase: enable `pg_cron`, `pg_net`. Add Vault secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `HUBSPOT_ACCESS_TOKEN`, `SLACK_ALERT_WEBHOOK`.
2. HubSpot private app scopes: deals/companies/contacts/notes/meetings `.read`.
3. Apply the migration: run `supabase/migrations/20260630_hs_engagements.sql` in the SQL editor.

## Deploy & test one function (start with sync-ttv)
```
supabase functions deploy sync-ttv
# dry-run invoke:
curl -X POST "$SUPABASE_URL/functions/v1/sync-ttv" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```
Then in the SQL editor: `select deal_id, status, recaps_in_window, days_to_five from onboarding_ttv order by recaps_in_window desc nulls last;`

## Verify (the parity check — do NOT skip)
- **sync-ttv:** pick 2–3 labs with a known kickoff. Manually run the recaps SQL for `[kickoff, kickoff+7)`
  and confirm `recaps_in_window` matches. Confirm a lab with ≥5 shows `passed` + a sane `days_to_five`,
  and an open-window lab shows `in_progress`.
- **sync-weekly-activity (when built):** because we moved to Sat–Fri weeks, do a *recompute* reconciliation,
  not a row-for-row diff against the Monday-based Python. Spot-check several labs' colors against the
  last-verified-assessment date with a Sat–Fri reference.
- Confirm a `sync_runs` row is written on both success and a forced failure (and that the failure posts to Slack).

## Then
- Wire `pg_cron` per spec §5 (UTC times; decide fixed-UTC vs seasonal DST).
- Add the "last synced" badge (amber/red when newest success > ~26h).
- Repoint the dashboard "Refresh now" button at `sync-hubspot-deals` (don't keep a 2nd pull copy in Netlify).
