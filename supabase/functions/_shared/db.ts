// _shared/db.ts — service-role writes to Supabase + sync_runs observability.
// Used by all four sync Edge Functions (SUPABASE-SYNC-CRON-SPEC §4).
//
// The service-role key bypasses RLS and is read ONLY inside Edge Functions
// (never shipped to the browser). Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// in the function env / Supabase Vault.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * Call the Supabase REST API with the service-role key.
 * `path` is everything after `/rest/v1/` (e.g. "hs_engagements?on_conflict=engagement_id").
 * For upserts, pass `Prefer: resolution=merge-duplicates` via `prefer`.
 */
export async function supaService(
  path: string,
  method: Method = "GET",
  body?: unknown,
  prefer?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers["Prefer"] = prefer;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text}`);
  }
  // PATCH/DELETE with no return representation can yield an empty body.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Upsert helper: bulk insert with conflict resolution on `onConflict` column(s).
 */
export function upsert(table: string, rows: unknown[], onConflict: string) {
  if (!rows.length) return Promise.resolve(null);
  return supaService(
    `${table}?on_conflict=${onConflict}`,
    "POST",
    rows,
    "resolution=merge-duplicates,return=minimal",
  );
}

/**
 * Write a sync_runs row. Call once per job (in a finally block) so every run —
 * success or failure — leaves an observability trail for the "last synced" badge.
 */
export async function recordRun(
  job: string,
  status: "success" | "error",
  rowsUpserted: number,
  startedAt: string,
  error?: string,
): Promise<void> {
  try {
    await supaService("sync_runs", "POST", [{
      job,
      status,
      rows_upserted: rowsUpserted,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      error: error ?? null,
    }], "return=minimal");
  } catch (e) {
    // Never let observability writes mask the real job outcome.
    console.error(`recordRun(${job}) failed:`, e);
  }
}
