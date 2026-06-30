# CLAUDE.md — usr-director-dashboard

> Place this at the ROOT of the repo (`~/Desktop/Claude/usr-director-dashboard/CLAUDE.md`).
> Read at the start of every session that touches the app, so no one re-explains the project.
> (Adapted from the 06-18 draft; updated for the new location beside the vault.)

## What this is

The USR Director Dashboard (CSM cockpit) — React 18 + Vite + Tailwind frontend, Supabase read-model,
Netlify Functions as the trust boundary. Full architecture in the README.

## Canonical repo + deploy — the one rule that matters

- **This folder IS the real working copy.** Remote: `https://github.com/brock-dale12/usr-director-dashboard`
- **Verify any time with:** `git remote -v`
- **Deploy branch:** `main`. **Netlify auto-deploys every push to `main`.** No manual `dist` upload.
  If a change isn't committed and pushed, it does not exist in production.
- **New location (2026-06-19):** moved from `~/code/usr-director-dashboard` to
  `~/Desktop/Claude/usr-director-dashboard/` so it sits beside the vault under the Cowork mount. The
  git remote and Netlify are unchanged — only the local path moved.
- **Do not** create a second copy of this app inside the Obsidian vault. The old vault copy at
  `~/Desktop/Claude/USR-Vault/05-Playbooks/Director/dashboard/` was an orphaned, un-deployed fork and
  has been removed. Never resurrect it.

## Workflow for any edit

1. `git checkout main && git pull`
2. `git checkout -b feat/<short-name>`
3. Make edits.
4. `npm run build` — confirm the build passes before committing.
5. `git add -A && git commit -m "<clear message>"` then `git push -u origin feat/<short-name>`
6. Open a PR, check the Netlify deploy preview, merge to `main`. (Tiny fixes may go straight to
   `main`.) Merging to `main` ships it.

## Secrets

- Frontend (public, RLS-protected): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — in local `.env`.
- Server-only (secret): `SUPABASE_SERVICE_KEY`, `HUBSPOT_ACCESS_TOKEN`, Google OAuth client
  id/secret — set in **Netlify env**, read only inside Functions, **never** committed, never in the
  Vite bundle.
- `.env` is gitignored. Never commit it.

## Where ops/migrations live

Supabase migrations live in this repo under `supabase/migrations/`. CS ops scripts and Doc's health
pipeline intentionally stay in the vault under `~/Desktop/Claude/USR-Vault/`, not in this repo.
