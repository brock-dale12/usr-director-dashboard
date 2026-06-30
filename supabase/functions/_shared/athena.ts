// _shared/athena.ts — client for USR's tokenless Athena Operational API.
// Ports the request/response contract from the vault Python (director_report.py
// `query_athena`) so ported SQL behaves identically. SUPABASE-SYNC-CRON-SPEC §4.
//
// Contract (verified against the Python):
//   POST https://api.universalspeedrating.com/analytics
//   body: { "database": "<db>", "query": "<sql>" }
//   resp: { "success": true, "data": [ { col: val, ... }, ... ] }
// On success:false the Python returns None (caller skips); we throw so the run is
// recorded as an error and Slack-alerted. The Python had NO retries; the spec adds
// 2 retries on timeout/5xx — the daily idempotent re-pull is the real safety net.

const ATHENA_URL = "https://api.universalspeedrating.com/analytics";

export interface QueryOpts {
  timeoutMs?: number; // per-call timeout (Python defaults ranged 45–120s)
  retries?: number; // extra attempts on timeout/5xx (spec: 2)
  label?: string; // log tag
}

/**
 * Run one SQL statement against a database and return rows as objects.
 * Returns [] for an empty result set. Throws on success:false, HTTP error, or
 * exhausted retries — callers wrap the job so the failure is recorded + alerted.
 */
export async function queryAthena(
  database: string,
  sql: string,
  opts: QueryOpts = {},
): Promise<Record<string, unknown>[]> {
  const { timeoutMs = 120_000, retries = 2, label } = opts;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(ATHENA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ database, query: sql }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (res.status >= 500) throw new Error(`Athena ${res.status} (${label ?? database})`);
      if (!res.ok) {
        throw new Error(`Athena HTTP ${res.status} (${label ?? database}): ${await res.text()}`);
      }

      const resp = await res.json() as { success?: boolean; data?: Record<string, unknown>[] };
      if (!resp.success) throw new Error(`Athena success:false (${label ?? database}): ${JSON.stringify(resp).slice(0, 500)}`);
      return resp.data ?? [];
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      const retryable = e instanceof Error && (e.name === "AbortError" || /Athena 5\d\d/.test(e.message));
      if (attempt < retries && retryable) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); // linear backoff
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr; // unreachable
}

/** Build a comma-joined SQL IN-list from ids. Returns 'NULL' when empty so the
 *  query stays valid and matches nothing. Caller is responsible for id sanitation
 *  (these are numeric/UUID ids resolved from our own roster, not user input). */
export function inList(ids: Array<string | number>): string {
  return ids.length ? ids.map((v) => (typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`)).join(",") : "NULL";
}
