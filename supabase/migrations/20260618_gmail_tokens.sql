-- ─────────────────────────────────────────────────────────────────────────────
-- Gmail "send from dashboard" — per-CSM OAuth token storage  (Option B)
--
-- Each CSM authorizes their own Google account once. We keep ONLY an encrypted
-- refresh token (AES-256-GCM, encrypted inside the Netlify function with
-- TOKEN_ENC_KEY before it ever touches the DB). Access tokens are short-lived and
-- are NOT stored — the send function mints a fresh one per send.
--
-- SECURITY MODEL: RLS is ON with NO client policies. That means anon/authenticated
-- clients can neither read nor write this table. Only the service_role key (used
-- exclusively inside Netlify functions, never in the browser bundle) bypasses RLS.
-- The browser learns "am I connected?" through the gmail-status function, never by
-- selecting this table directly.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.gmail_tokens (
  auth_user_id      uuid primary key references auth.users(id) on delete cascade,
  email             text not null,                 -- the connected Google account
  refresh_token_enc text not null,                 -- AES-256-GCM, base64(iv|tag|ct)
  scope             text,                          -- granted scopes (space-delimited)
  connected_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.gmail_tokens is
  'Per-CSM Gmail OAuth refresh tokens (encrypted). Written only by Netlify functions via service_role. RLS denies all client access.';

alter table public.gmail_tokens enable row level security;

-- Intentionally NO policies: authenticated/anon get nothing; service_role bypasses RLS.
-- (If you later want the client to read its own connection status directly, add a
--  SELECT policy scoped to auth.uid() = auth_user_id on a NON-token column view.)

-- keep updated_at fresh on upsert
create or replace function public.touch_gmail_tokens_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_gmail_tokens_touch on public.gmail_tokens;
create trigger trg_gmail_tokens_touch
  before update on public.gmail_tokens
  for each row execute function public.touch_gmail_tokens_updated_at();
