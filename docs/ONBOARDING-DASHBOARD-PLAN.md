# USR Onboarding Dashboard — Plan & Canonical Model

> **Status:** DRAFT for Brock's sign-off · **Author:** Claude (CS planning session) · **Date:** 2026-06-30
> **Decision context:** Iterate & harden the existing app (not rebuild) · Reconcile to one canonical stage model · AI suggestions are a surface over the existing Donna + CS sub-agent team.
> **Lives in:** `usr-director-dashboard/docs/` (this repo is the dashboard's only home — per root `CLAUDE.md`). Agent-side changes live in `USR-Vault/`.

---

## 0. The one-paragraph version

We are **not rebuilding**. The app already has the hard parts right: Supabase read-model, Netlify-functions trust boundary, HubSpot sync + writeback, per-CSM Gmail OAuth, and an 8-stage onboarding checklist with gating tasks. The work is (1) **harden** the codebase (kill duplicates, decompose monolith pages, add types + tests, finish stubbed Renewals/Payments), (2) **reconcile** the onboarding model so the dashboard, HubSpot, and Owen all agree on one stage↔task↔milestone spine, and (3) **wire the dashboard into the existing vault agent team** so per-customer next-best-actions, a weekly triage digest, stall/risk flags, and ready-to-send draft emails appear in the UI — produced by Donna/Owen/Ruby/Casey/Doc, not a new bespoke engine. Supabase is the shared bus between the agents and the cockpit.

---

## 1. Current state (verified 2026-06-30)

### 1a. The app — what already works
- **Stack:** React 18 + Vite + Tailwind + React Router; Supabase (Postgres + RLS); Netlify Functions; auto-deploy on `main`. JavaScript (no TS).
- **Data flow (sound):** UI reads Supabase via anon key + RLS → Netlify functions (service-role) sync **from** HubSpot and write **back** to HubSpot. UI never touches external APIs directly. Secrets stay server-side. **Keep this architecture.**
- **Tables:** `lab_accounts` (deduped roster, one row per HubSpot company), `lab_assignments` (CSM↔director registry), `onboarding_progress` (CSM-driven 90-day journey, stage + completed tasks — internal only), `onboarding_templates` (admin copy overrides), `gmail_tokens` (AES-256-GCM encrypted refresh tokens, RLS-locked).
- **Functions (13):** `hubspot-sync`, `hubspot-writeback`, `hubspot-notes`, `hubspot-meta`, `customer-active`, `gmail-*` (oauth-start/callback/send/status/disconnect/signature), `ping`.
- **Views (live):** Login, MyCustomers (CSM hub), MyRegion (director book), Onboarding (8-stage gating checklist), OutreachHub, Leaderboard, AdminOverview, DataConnections, Settings, TemplateEditor (live edit of onboarding email/task copy).
- **Views (stubbed):** Renewals, Payments. Renewal-date wiring in `CustomerDetail.jsx` is an unfinished TODO.

### 1b. Why it feels hard to maintain (concrete)
1. **6 stale duplicate files** (` 2.jsx` / ` 2.js` / ` 2.sql`) committed — `ChurnReview 2.jsx`, `DataConnections 2.jsx`, `customer-active 2.js`, two ` 2.sql` migrations, `dist/index 2.html`. Delete on day 1.
2. **Monolith pages** — `MyRegion.jsx` (~50 KB), `Onboarding.jsx`, `MyCustomers.jsx` mix data-fetch + state + UI + email composition in one file. Hard to change safely.
3. **No types, no tests** — refactoring has no safety net.
4. **Hardcoded catalog** — `onboardingCatalog.js` (~35 KB) holds all task/email copy; template overrides merge at runtime with no schema validation.
5. **Repo hygiene** — `vite.config.js.timestamp-*` and `dist/` artifacts tracked in git.

### 1c. The agent layer (already live in the vault)
Six agents run today, mostly on schedule. **The dashboard does not currently read or display any of their output** — that's the missing link.

| Agent | Folder | Trigger | Reads | Writes |
|---|---|---|---|---|
| **Donna** (chief of staff) | root | scheduled briefs + chat | HubSpot, vault notes, Doc output, Fireflies | daily/weekly/monthly notes, call-prep |
| **Doc** (health) | `09-Doc/` | Fri 6am, 1st 6am ET | HubSpot, Athena, Redshift, Active-Customers sheet | weekly colors, monthly 0–9, linkage map CSV |
| **Owen** (onboarding) | `13-Owen/` | `onboarding-pass` skill, on-demand | HubSpot, customer notes, Doc activity, Fireflies, ledger | **drafts**, ledger, customer-note onboarding frontmatter (to be re-aligned to the 8-stage journey + TTV — see §2) |
| **Ruby** (renewals) | `14-Ruby/` | `renewal-pass` skill (schedule pending) | HubSpot, Doc output, notes, playbooks | **drafts**, renewal logs |
| **Casey** (outreach) | `13-CSM/` | `cs-outreach-pass` skill | HubSpot, Doc, notes, config | per-CSM digests / drafts |
| **Autopilot** | `_AUTOPILOT.md` | weekday 7:30am ET | Fireflies, HubSpot, notes | customer notes, daily notes |

**Hard rule all drafting agents share:** they **draft only** — never auto-send, never write to HubSpot. The human (Brock) sends. The dashboard must respect this: it surfaces drafts for one-click human send via the existing Gmail flow.

---

## 2. THE CANONICAL ONBOARDING MODEL (Brock-confirmed)

**The canonical model IS the app's existing 8-stage journey** (`OB_STAGES` in `src/lib/onboardingCatalog.js`). Brock confirmed the app already follows the real plan well; we standardize on it and align everything else (HubSpot, Owen) to it — not the reverse. It is **CSM-driven**: a customer sits at the first stage whose *gating tasks* aren't all done; completing them advances the stage.

| # | `key` | Stage | Opens (day) | Centerpiece motion / gate | Maps up to HubSpot cohort |
|---|---|---|---|---|---|
| 1 | `handoff` | **Sales Hand-off** | 0 | Baton received; first contact; book the kick-off call fast | On Deck |
| 2 | `kickoff` | **Kick-off Call** | 1 | Run kick-off; **start the TTV clock** (set `kickoff_date`); send logins | Level Set |
| 3 | `ttv` | **TTV Sprint** | 3 | **5 session recaps inside a 7-day window from kickoff** (`TTV_TARGET=5`, `TTV_WINDOW_DAYS=7`) | First 30 Days |
| 4 | `impl` | **Implementation** | 10 | Implementation call; deepen setup; set goals | First 30 Days |
| 5 | `checkin30` | **30-Day Check-in** | 14 | Review 30-day progress → set 60/90-day goals | First 30 Days |
| 6 | `day3060` | **Days 30–60** | 30 | Weekly activity emails (health-color variant); habit-building | First 90 Days |
| 7 | `day6090` | **Days 60–90** | 60 | Weekly activity emails (nods to QBR); pre-QBR prep | First 90 Days |
| 8 | `qbr` | **90-Day QBR** | 90 | Quarterly business review → **graduation** | First 90 Days → Months 4-7 |

**Three layers of "progress," kept distinct (this is what resolves the old mismatch):**
1. **Journey stage** (the 8 above) = the canonical, fine-grained position. Lives in the app, derived from gating-task completion. **This is what the pipeline board shows.**
2. **HubSpot cohort stage** (`On Deck / Level Set / First 30 Days / First 90 Days`) = the coarse rollup the app already references as `EARLY_STAGES`. Synced via `hubspot-sync`/`writeback` so HubSpot stays a faithful coarse mirror, but the journey stage is the source of truth for onboarding.
3. **Tasks** = granular checklist per stage in `onboarding_progress` (Supabase, CSM-driven, as today). Gating tasks advance the stage; non-gating sends (the 30–60 / 60–90 activity emails) do not.

**TTV is the spine, not a side-metric.** `TTVPanel` already tracks: explicit `kickoff_date`, days-since, session-recap count vs. target (5), and a pass/fail state (manual mark > platform-synced > derived). The dashboard's onboarding health centers on TTV. **Known dependency (already noted in code):** session-recap counts need an **Athena → Supabase sync** (`assessments_prod`); until that exists, TTV widgets show a "syncing" state and the TTV email is picked manually — **no fabricated recap numbers.** Building that sync is a real task in the roadmap.

**Owen must be re-aligned to this journey.** Owen currently emits a parallel `M1 (day 3) / M2 (day 7) / M3 (day 14)` milestone scheme. That's a *different* spine than the app's 8-stage + TTV model. We make the **app journey canonical** and re-map Owen so his signals land on these stages (esp. TTV Sprint) and write to the journey's fields — rather than the dashboard carrying two competing milestone models. (Vault-side change in `13-Owen/`.)

**Decisions (all resolved 2026-06-30 — see §7):**
- **D1** — Stage model = the 8-stage app journey above; HubSpot 4-stage = coarse cohort rollup.
- **D2** — 90-day success bar = **TTV passed + healthy weekly color**. No new numeric targets; the dashboard graduates a lab on these two signals it already computes.
- **D3** — **`onboardingCatalog.js` is the canonical task/copy source.** TemplateEditor edits it; Owen's vault knowledge is re-aligned to match it.
- **D4** — New Hand-off deals are **manually assigned by Brock**; the board carries an **"Unassigned" lane** as the queue.
- **D8** — A TTV "session recap" = an **`assessment_report`** record (target 5 within the 7-day window). *Verify the exact table/field name and grain against the `assessments_prod` schema before writing the sync.*

---

## 3. Target architecture — the cockpit over the agent team

```
                 ┌─────────────────────────── VAULT (the brains) ───────────────────────────┐
                 │  Donna (conductor)                                                          │
                 │   ├─ Owen  → onboarding next-actions, M1/M2/M3, stall flags, draft emails   │
                 │   ├─ Ruby  → renewal risk, save-play drafts                                 │
                 │   ├─ Casey → per-CSM weekly triage digest                                   │
                 │   ├─ Doc   → weekly colors, monthly 0–9 health                              │
                 │   └─ Autopilot → meeting notes / action items                               │
                 └───────────────┬───────────────────────────────────────────────────────────┘
                                 │  drafting agents (Owen/Ruby/Casey) → suggestions/drafts
                                 ▼
   ┌──────── DATA SYNC (already approved: SUPABASE-SYNC-CRON-SPEC.md) ─────────┐
   │  pg_cron → pg_net → 4 Edge Functions (Deno/TS), ~5 AM ET daily, pull-only │
   │  HubSpot deals/engagements + Athena (logins, recaps, health) → Postgres   │
   └───────────────┬──────────────────────────────────────────────────────────┘
                   ▼
   ┌──────────────────────── SUPABASE (the shared bus) ───────────────────────┐
   │ EXISTING (16): lab_accounts, lab_assignments, onboarding_progress/cs/ttv/  │
   │   events/templates, weekly_/monthly_health_snapshots, suggested_emails,    │
   │   customer_comms, sync_runs, directors, dashboard_prefs, leaderboard_cache │
   │ TO BUILD: hs_engagements (spec'd); maybe +agent/kind col on suggested_emails│
   └───────────────┬──────────────────────────────────────────────────────────┘
                   ▼  (anon key + RLS reads)
   ┌──────────────────────── DASHBOARD UI (the cockpit) ──────────────────────┐
   │ Pipeline board · Customer detail · Weekly activity · Triage inbox         │
   │ "Send" → existing gmail-send function (human-in-the-loop)                  │
   └───────────────────────────────────────────────────────────────────────────┘
```
**Where the drafting agents fit:** health/activity/TTV come from the Athena cron (above), not from Doc's vault files — Doc's *computation* is being ported into `sync-weekly-activity`/`sync-monthly-health` per the spec. The vault agents that still feed the dashboard are the **drafting** ones (Owen/Ruby/Casey), whose suggestions/drafts land in `suggested_emails`. That is the only place a "vault → Supabase" path is still needed (D7), and it's narrow.

**Why Supabase as the bus:** the dashboard already reads Supabase, and the data-sync layer is **already designed and approved** in `SUPABASE-SYNC-CRON-SPEC.md` (2026-06-19): `pg_cron` → `pg_net` → 4 Deno/TS Edge Functions pulling HubSpot + Athena into Supabase daily (~5 AM ET), pull-only, idempotent. **We build on that spec — we do not add a parallel bridge.**

**SCHEMA REALITY (audited 2026-06-30 — most "new" tables already exist):** The first repo scan under-reported the schema. The app already uses **16 tables**. The reconciled mapping:

| Need | Existing table (use this) | Gap to close |
|---|---|---|
| Journey stage | `onboarding_progress` (per-task) → derived stage; `onboarding_cs` (kickoff_date, sessions_manual, ttv_status_override) | none — stage already derives from gating tasks |
| TTV | `onboarding_ttv` (status, days_to_five, **recaps_in_window**) | wire `sync-weekly-activity` to populate `recaps_in_window` from `assessment_reports` (already named in the spec) |
| Weekly/monthly health | `weekly_health_snapshots`, `monthly_health_snapshots` | none — fed by Edge Functions |
| Suggestions / drafts | `suggested_emails` (director_id, week_start, status), `customer_comms` (send log) | possibly extend `suggested_emails` with an `agent`/`kind` column if we want Owen/Ruby suggestions alongside Casey's outreach |
| HubSpot notes/meetings feed | `hs_engagements` (**spec'd, not yet built**) | build it per spec §3 (the Autopilot-equivalent activity timeline) |
| Sync observability | `sync_runs` | confirm/extend columns per spec |
| CSM assignment (D4) | `lab_accounts.hubspot_owner_id` (synced) | add an "Unassigned" derivation in the board (owner null/unmapped); likely **no schema change** |

**Net new tables actually needed: at most one** (`hs_engagements`, already in the approved spec) — *not five.* Everything else is "use what exists" + small column adds. This is the kind of duplication the root `CLAUDE.md` explicitly warns against, so we stop and reuse.

---

## 4. Views — per-view scope (this is what we build, screen by screen)

### V1 — Onboarding Pipeline Board *(the centerpiece; new/rebuilt from `Onboarding.jsx`)*
- **Purpose:** Kanban of the **8 canonical journey stages** (Hand-off → … → 90-Day QBR, + Graduated). Each card = a deal in onboarding. (Optional toggle to collapse into the 4 HubSpot cohorts for an exec view.)
- **Card shows:** lab name, CSM avatar, days-in-stage / day-of-90, health color (Doc), **TTV chip** (recaps n/5 + pass/fail), # open gating tasks, a 🔴 badge if a stall is flagged, link to HubSpot deal, link to vault customer note.
- **Interactions:** advance happens by completing gating tasks (CSM-driven), with manual stage override; advancing syncs the HubSpot cohort via `hubspot-writeback`; filter by CSM / health / stalled / TTV-status; "unassigned" lane for new Hand-off deals (D4).
- **Data:** `lab_accounts` + `onboarding_progress` + `onboarding_journey` + `activity_signals` + `agent_suggestions`.

### V2 — Customer Detail *(harden existing `CustomerDetail.jsx`)*
- **Purpose:** Single-customer cockpit. Sections: Profile (HubSpot), Onboarding (journey stage + per-stage gating checklist + **TTV panel** (kickoff date, recaps n/5, pass/fail) + journey timeline + goal progress per D2), Health (Doc weekly trend + monthly score), **Suggestions** (Owen/Ruby/Casey next-actions for this account), **Drafts** (ready-to-send, one click → Gmail), Activity feed (Autopilot meeting notes + action items), Links (HubSpot, vault note).
- **Finish:** the renewal_date / renewal-stage TODO.

### V3 — Weekly Activity *(new; surfaces Doc + the "Dock" report logic in-app)*
- **Purpose:** Replace the Slack-only weekly view. Per-CSM rollup of % of book Green/Yellow/Orange/Red this week; week-over-week trend; click a color to see the accounts.
- **Data:** `activity_signals`. Definition mirrors Doc exactly (Sat–Fri week; 🟢≤7d 🟡8–30 🟠31–90 🔴90+; staff-excluded).

### V4 — Triage Inbox *(new; the "weekly triage digest")*
- **Purpose:** A CSM's Monday morning. Ranked list across their book: stalled onboardings, at-risk renewals (Ruby), coverage gaps (Casey), customers due for a check-in. Each item has the suggested action + a draft if one exists.
- **Data:** `agent_suggestions` + `draft_outbox`, filtered by `hubspot_owner_id`. Mirrors Casey's per-CSM digest + Owen's stall flags.

### V5 — Renewals & V6 — Payments *(finish the stubs)*
- Renewals: Ruby's ≤90-day horizon, risk = date proximity + Doc health; critical (≤30d + at-risk) flagged for Brock's personal call (no auto-draft, per Ruby's rule). Payments: `payment_update` / `payment_status` from HubSpot + (later) Measure/QuickBooks. *(Payments overlaps the separate payments-dashboard spec in memory — reconcile scope before building.)*

### Cross-cutting
- **MyCustomers / MyRegion:** keep, but extract shared logic into hooks so they stop being monoliths.
- **TemplateEditor:** repoint at the canonical onboarding source (D3) so editing copy in one place flows everywhere.

---

## 5. Hardening backlog (parallel to feature work)
1. Delete all ` 2.*` duplicates; gitignore `dist/` and `*.timestamp-*`.
2. Decompose `MyRegion`, `Onboarding`, `MyCustomers` into `pages/` + `components/` + `hooks/` (data-fetch hooks, presentational components).
3. Introduce TypeScript incrementally (start with `lib/` + new code + Supabase table types).
4. Add tests: Vitest for utils/hooks; one Playwright happy-path per critical CSM workflow (advance stage, send draft, mark task).
5. Schema-validate `onboarding_templates` / catalog merge.

---

## 6. Phased roadmap (proposed)

- **Phase 0 — Lock the model (no code).** Sign off §2 (D1–D4) + §3 tables. ~1 working session with Brock. **Blocks everything else.**
- **Phase 1 — Hygiene + foundations.** ✅ Dupes deleted + gitignore confirmed. Remaining: add Supabase TS types (for the *existing* 16 tables) + test harness; decompose the 3 monoliths. **No big migration batch** — the schema already exists.
- **Phase 2 — Build the approved sync spec + wire TTV.** Execute `SUPABASE-SYNC-CRON-SPEC.md`: the 4 Edge Functions + `pg_cron`, including `sync-weekly-activity` populating `onboarding_ttv.recaps_in_window` from `assessment_reports` (D8 query verified). Build `hs_engagements` (the one genuinely-new table) for the activity timeline. Optionally extend `suggested_emails` with `agent`/`kind` so Owen/Ruby suggestions sit beside Casey's outreach.
- **Phase 3 — Pipeline board + customer detail.** V1 + V2 on the canonical model. This is the "mirror our onboarding process" deliverable.
- **Phase 4 — Weekly activity + triage inbox.** V3 + V4 (the AI-suggestions surfaces). Wire `draft_outbox` → existing Gmail send.
- **Phase 5 — Finish Renewals + Payments.** V5 + V6 (Ruby; reconcile Payments with existing memory spec).

---

## 7. Open decisions & dependencies
| ID | Decision | Status |
|---|---|---|
| D1 | Canonical = the 8-stage app journey; HubSpot 4-stage = coarse cohort | ✅ RESOLVED |
| D2 | 90-day success bar = **TTV passed + healthy weekly color** (no new numeric targets) | ✅ RESOLVED |
| D3 | Canonical task source = **`onboardingCatalog.js`**; TemplateEditor edits it; re-align Owen to it | ✅ RESOLVED |
| D4 | New Hand-off deals = **manual assignment by Brock**; board has an "Unassigned" lane | ✅ RESOLVED |
| D7 | Agent bridge — **REVISED:** health/activity/TTV via the approved `pg_cron`+Edge-Function Athena sync (not vault files). Only Owen/Ruby/Casey *drafts* use a narrow vault→`suggested_emails` path. | ⚠️ NEEDS BROCK — confirm aligning to the existing cron spec |
| D8 | TTV recap = **`assessments_prod.assessment_reports`** (PLURAL; singular doesn't exist). 1 row = 1 testing **session/batch** (not 1 athlete). Window on `session_date` (cap future dates), `deleted_at IS NULL`, org via `community_id → organization_community_map → organizations.hubspot_company_id`. | ✅ VERIFIED LIVE — *confirm "5 sessions" = 5 reports (vs. 5 athletes = `assessments` rows)* |
| D5 | Ruby pricing-authority numbers (already PENDING from Drew+Dillan) | Drew/Dillan | Renewals drafts |
| D6 | Payments scope vs. existing payments-dashboard memory spec | Brock | V6 |
| D7 | Agent bridge mechanism: do agents write Supabase directly, or write vault files that a function ingests? | Brock + build | Phase 2 |

---

## 8. What I need from you to proceed
1. **Sign off (or correct) the canonical model in §2** — especially D1–D4.
2. **Confirm the roadmap order** in §6 (or reprioritize).
3. **Pick the agent-bridge approach** (D7) — my recommendation: agents keep writing vault files (their current habit), and a scheduled `agent-bridge` function ingests those into Supabase, so we don't change how the agents work.

Once §2 is locked, Phase 1 (hygiene) and the new migrations can start immediately — they're low-risk and unblock everything.
