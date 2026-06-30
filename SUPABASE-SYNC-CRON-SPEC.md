# Supabase Sync Cron — Build Spec

**Goal:** keep the USR Director Dashboard's Supabase data as fresh as possible, automatically, every day — no manual steps.
**Date:** 2026-06-19 · **Owner:** Brock · **Status:** approved design, ready to build.

This spec is the source of truth for the daily data-sync system. It was scoped decision-by-decision (Q1–Q6 below). Build against this; don't re-derive the calc logic from scratch — port the existing scripts named here.

---

## 0. TL;DR architecture

```
                         Supabase (one home for schedule + compute + data)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  pg_cron  ──pg_net POST──▶  4 Edge Functions (Deno/TS)  ──▶  Postgres tables│
 │   ~5 AM ET daily, staggered                                                │
 └──────────────────────────────────────────────────────────────────────────┘
        │                         │                         │
   HubSpot API              Athena Operational API     Slack (failure only)
 (deals, engagements)   api.universalspeedrating.com/analytics
```

- **Serving layer:** Supabase Postgres (unchanged — the React/Vite SPA already reads it).
- **Scheduler:** `pg_cron`. **Trigger:** `pg_net` HTTP POST to each Edge Function. **Compute:** Edge Functions (Deno/TypeScript).
- **Direction:** the cron is **pull-only**. Writes to HubSpot stay real-time in `netlify/functions/hubspot-writeback.js` (admin-triggered on save) — NOT in the cron.
- **Cadence:** daily, refreshing the **current** week + **current** month (idempotent re-upsert). Past periods finalize and stop changing.

---

## 1. The four sync jobs

| # | Edge Function | Pulls from | Writes to | Scope per run |
|---|---|---|---|---|
| 1 | `sync-hubspot-deals` | HubSpot deals (CS Onboarding pipeline) | `lab_accounts` | full active roster (company-grain) |
| 2 | `sync-hubspot-engagements` | HubSpot notes + meetings | `hs_engagements` (new) | incremental (modified since last run) |
| 3 | `sync-weekly-activity` | Athena | `weekly_health_snapshots` | **current week only** |
| 4 | `sync-monthly-health` | Athena | `monthly_health_snapshots` | **current month only** |

**Dependency:** Job 4 reads `weekly_health_snapshots` to enrich color stats → **job 3 must finish before job 4.** Jobs 1 & 2 (HubSpot) are independent of jobs 3 & 4 (Athena) and can run in parallel.

---

## 2. Decisions (Q1–Q6)

**Q1 — Platform:** Supabase (per product owner). `pg_cron` + `pg_net` + Edge Functions. Existing `hubspot-sync.js` / health Python become the *spec*, ported to Deno/TS.

**Q2 — USR data source:**
- Source = **Athena Operational API**, tokenless: `POST https://api.universalspeedrating.com/analytics` with `{ "database": <db>, "query": <sql> }`.
- Port logic from `backfill_weekly_metrics.py`, `backfill_monthly_health.py`, and `director_report.py` (in the vault: `USR-Vault/05-Playbooks/Director/`). **SQL strings carry over verbatim** — that's the verified part. Only orchestration is rewritten in TS.
- **Daily refresh of current period** (not a weekly dump). The 1st-of-month run finalizes the prior month.
- **Verification gate:** before cutover, run the Python and the ported Edge Function over the same period and diff the resulting snapshot rows — scores must match exactly.

**Q3 — HubSpot:**
- **Pull-only cron.** Real-time writes remain in `hubspot-writeback.js`. HubSpot is system of record; dashboard write-throughs hit HubSpot first, the cron reads it back → no two-writer race.
- **ARR = the standard `amount` field.** Drop `arr_amount` and `hs_arr`. Cleanup task: remove `arr_amount`/`hs_arr` from the writeback `DEAL_FIELDS` map and from dashboard reads so nobody edits the wrong field.
- A full daily pull inherently covers **new customers** (new CS-Onboarding deals → new rows), **company name/ID changes** (grouped by `hubspot_company_id` each run), and **churn** (rows that drop out of the active roster get `churn_flagged = true`, never deleted).
- **Notes + meetings:** in scope now (Job 2 / Q6).

**Q4 — Scheduling:**
- **Four separate Edge Functions**, each scoped to current period (keeps each invocation under the Edge Function time limit).
- **Staggered ~5 AM ET** so data is fresh before the team logs in and Athena/HubSpot are quiet:
  - 05:00 ET — `sync-hubspot-deals` + `sync-hubspot-engagements`
  - 05:15 ET — `sync-weekly-activity`
  - 05:30 ET — `sync-monthly-health` (after weekly lands)
- **DST note:** `pg_cron` runs in UTC. 5 AM ET = **09:00 UTC during EDT**, 10:00 UTC during EST. Either keep a fixed UTC time (drifts 1h with DST — acceptable for a pre-dawn job) or maintain two seasonal schedules.
- **Time-limit fallback:** if the monthly/weekly Athena job exceeds the Edge Function limit even at current-period scope, chunk it (process N labs per invocation, re-trigger). Try the simple single-shot version first.

**Q5 — Observability + retries:**
- Every run writes a **`sync_runs`** row: `job`, `started_at`, `finished_at`, `status`, row counts, `error`. (`hubspot-sync.js` already records to `sync_runs` — extend it.)
- Dashboard shows a **"last synced" badge** per job; amber/red when the newest *successful* run is older than ~26h.
- **Slack alert on failure only**, via incoming webhook stored in **Supabase Vault** as `SLACK_ALERT_WEBHOOK`. (Webhook posts to the configured channel; failure-only to avoid noise.)
- **Retries:** each function retries its external calls 2× with short backoff. Real safety net = **daily idempotent re-pull** — a fully failed day self-heals on the next run; no catch-up queue needed.

**Q6 — `hs_engagements` (notes + meetings):**
- **Association grain: deal only** (keep it simple).
- **Backfill: last 12 months**, then **daily incremental** by `hs_lastmodifieddate`.
- **Include upcoming/scheduled meetings** (future-dated) for call prep.
- **Full note body** — store HTML, render sanitized in the UI.
- **Render:** read-only activity timeline on the customer detail drawer, visually **distinct from internal team notes** (team notes stay Supabase-native + editable; engagements are a read-only HubSpot mirror).

---

## 3. Schema changes

### New table: `hs_engagements`
```sql
create table if not exists hs_engagements (
  engagement_id   bigint primary key,          -- HubSpot engagement/object id
  type            text not null,               -- 'note' | 'meeting'
  deal_id         text not null,               -- associated deal (canonical spine)
  owner_name      text,                         -- resolved from hubspot_owner_id
  occurred_at     timestamptz not null,         -- note created_at / meeting start
  meeting_end     timestamptz,                  -- meetings only
  meeting_outcome text,                          -- scheduled|completed|no_show|canceled|rescheduled
  title           text,
  body_html       text,                          -- full note/meeting body (sanitize on render)
  is_upcoming     boolean generated always as (occurred_at > now()) stored,
  hs_last_modified timestamptz,                  -- drives incremental sync
  synced_at       timestamptz default now()
);
create index on hs_engagements (deal_id, occurred_at desc);
create index on hs_engagements (type, is_upcoming);
```

### `sync_runs` (confirm exists; add columns if missing)
```sql
-- expected shape
job text, started_at timestamptz, finished_at timestamptz,
status text,            -- 'success' | 'error'
rows_upserted int, error text
-- index for "latest per job" badge lookup
create index if not exists sync_runs_job_started_idx on sync_runs (job, started_at desc);
```

### `lab_accounts`
- Treat `amount` as the ARR source of truth. No new column; deprecate `arr_amount` reads/writes (cleanup task in §6).

---

## 4. Edge Functions — shared design

A shared helper module (`_shared/`) used by all four:
- `queryAthena(database, sql, {timeout, retries})` — POSTs to the Athena API, returns `{rows, columns}`, retries 2× on timeout/5xx.
- `supaService(path, method, body)` — service-role writes to Supabase REST.
- `recordRun(job, status, count, error)` — upsert into `sync_runs`.
- `alertSlack(job, error)` — POST to `SLACK_ALERT_WEBHOOK` (failure path only).

Each function wraps its body in try/finally so a `sync_runs` row is always written and a Slack alert always fires on throw.

**Port notes:**
- `sync-weekly-activity` ← `backfill_weekly_metrics.py` + the `director_report.py` query functions (logins from `authentication_prod.sessions`, datapoints/PRs/athletes, recaps from `assessments_prod.assessment_reports`, health color from last verified assessment vs week-end). Run for the **current** week window only.
- `sync-monthly-health` ← `backfill_monthly_health.py`. The 3 sub-scores (login / athletes / assessments, each 0/1/3, max 9), staff exclusion (`@universalspeedrating.com`, `@lesspellman.com`, `@bxcpartners.com`), ID resolution, then enrich color stats from `weekly_health_snapshots`. Run **current** month only.
- `sync-hubspot-deals` ← `netlify/functions/hubspot-sync.js` logic (company-grain, one row per customer, churn-flag). **Make this Edge Function the single source** and repoint the dashboard "Refresh now" button to invoke it — do NOT keep a second copy of the pull logic in Netlify (avoids re-introducing a duplicate).
- `sync-hubspot-engagements` ← new. Pull notes (`crm.objects.notes`) + meetings (`crm.objects.meetings`) associated to each active deal, last 12 months on first run, then incremental by `hs_lastmodifieddate`; resolve owner names; upsert `hs_engagements`.

---

## 5. pg_cron schedule (UTC; EDT shown)

```sql
-- prerequisites: enable extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 05:00 ET → 09:00 UTC (EDT): HubSpot deals + engagements
select cron.schedule('sync-hubspot-deals',       '0 9 * * *',  $$ select net.http_post(...) $$);
select cron.schedule('sync-hubspot-engagements', '0 9 * * *',  $$ select net.http_post(...) $$);
-- 05:15 ET → 09:15 UTC: weekly activity
select cron.schedule('sync-weekly-activity',     '15 9 * * *', $$ select net.http_post(...) $$);
-- 05:30 ET → 09:30 UTC: monthly health (after weekly)
select cron.schedule('sync-monthly-health',      '30 9 * * *', $$ select net.http_post(...) $$);
```
Each `net.http_post` calls the function URL with the service-role bearer token (from Vault).

---

## 6. Build order

1. **Prereqs:** enable `pg_cron` + `pg_net`; add Vault secrets `HUBSPOT_ACCESS_TOKEN`, `SLACK_ALERT_WEBHOOK`; confirm HubSpot private-app scopes: `crm.objects.deals.read`, `crm.objects.companies.read`, `crm.objects.contacts.read`, `crm.objects.notes.read`, `crm.objects.meetings.read`.
2. **Migrations:** create `hs_engagements`; extend `sync_runs`.
3. **Shared helpers** (`queryAthena`, `supaService`, `recordRun`, `alertSlack`).
4. **Port Athena jobs** (`sync-weekly-activity`, `sync-monthly-health`) → run the **parity check vs Python** before trusting them.
5. **HubSpot jobs** (`sync-hubspot-deals` port + repoint "Refresh now"; `sync-hubspot-engagements` new) + engagements timeline UI on the customer drawer.
6. **Wire pg_cron** schedules + Slack alerting + the "last synced" badge.
7. **Cleanup:** remove `arr_amount`/`hs_arr` from `hubspot-writeback.js` and dashboard reads; retire the manual vault Python sync path once the cron is trusted in production.

---

## 7. Open setup items (need a human)
- Supabase: enable extensions + add Vault secrets (service-role function auth).
- HubSpot: confirm the private app has the 5 read scopes above.
- Slack: `SLACK_ALERT_WEBHOOK` provided (store in Vault; rotate if it leaked into a shared transcript).
- Decide fixed-UTC vs seasonal DST schedule.
```
