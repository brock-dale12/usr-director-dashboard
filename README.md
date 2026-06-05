# USR Director Dashboard (CSM Cockpit)

The Customer Success cockpit for USR Speed Lab accounts — health, onboarding,
renewals, payments, and per-CSM books of business. Multiple CSMs log in and
manage their own customers.

## Stack

- **Frontend:** React 18 + Vite + React Router, Tailwind. Reads from Supabase.
- **Data / auth:** Supabase (Postgres + RLS). The UI reads from Supabase only.
- **Backend:** Netlify Functions (`netlify/functions/`) — the trust boundary.
  Every secret (HubSpot token, service key, future OAuth tokens) lives in
  Netlify env and is read only inside Functions, never in the browser bundle.
- **Hosting:** Netlify, continuous deploy from this Git repo.

## Architecture in one rule

The UI never calls an external API live. Functions write *through* to the
systems of record (HubSpot, later Gmail/Calendar/Fireflies) and mirror the
result back into Supabase, which stays the single unified read-model.

Full context lives in the vault:
- `ARCHITECTURE-unified-CSM-cockpit.md` — the why
- `GAMEPLAN-2026-06-05-csm-cockpit-roadmap.md` — the 90-day roadmap
- `PLAN-2026-06-05-writeback-onboarding-tasks.md` — HubSpot write-back detail

## Develop

```bash
npm install
cp .env.example .env      # fill in values (see below)
npm run dev               # Vite only (no Functions)
# or, to run Functions locally too:
npx netlify dev           # Vite + Functions together
```

Smoke-test Functions: `curl http://localhost:8888/.netlify/functions/ping`

## Build & deploy

Push to the default branch → Netlify builds (`npm run build`, publishes `dist`)
and deploys Functions automatically. No manual `dist` drag-drop.

## Environment variables

| Var | Where | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | frontend | Public. |
| `VITE_SUPABASE_ANON_KEY` | frontend | Public; RLS protects data. |
| `SUPABASE_SERVICE_KEY` | **server / Netlify env** | Secret. Functions only. |
| `HUBSPOT_ACCESS_TOKEN` | **server / Netlify env** | Secret. Functions only. |

Local: one `.env` at the repo root (see `.env.example`). Production: the two
SERVER vars are set in Netlify (Site settings → Environment), never committed.

## Layout

```
src/
  pages/        MyCustomers, MyRegion, Onboarding, Renewals, Payments,
                OutreachHub, Leaderboard, AdminOverview, Login, TemplateEditor
  components/   shared UI (HealthBadge, Layout, logos)
  contexts/     AuthContext (Supabase auth)
  lib/          supabase, fetchAll, colors, gmailDraft, onboardingCatalog
netlify/
  functions/    serverless endpoints (ping = health check)
```

Database migrations and ops scripts live in the vault under
`05-Playbooks/Director/` (kept out of this repo on purpose).
