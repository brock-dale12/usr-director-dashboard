// syncFreshness — turn sync_runs rows into a per-job freshness verdict for the
// "last synced" badge. This is the dashboard's CONSISTENCY guarantee: if a job
// stops running (cron broken, function erroring), the badge goes amber/red so a
// human notices instead of silently trusting stale data.
//
// A run row: { job, status: 'success'|'error', started_at, finished_at, rows_upserted, error }
// States: 'ok' (fresh success), 'stale' (newest success older than STALE_HOURS),
//         'error' (most recent run errored after the last success), 'down' (never succeeded).

export const STALE_HOURS = 26; // daily job + a few hours grace

const ts = (r) => Date.parse(r?.finished_at || r?.started_at || 0) || 0;

/** Freshness verdict for one job. `now` is epoch ms (injectable for tests). */
export function jobFreshness(runs, job, now = Date.now()) {
  const jobRuns = runs.filter((r) => r.job === job).sort((a, b) => ts(b) - ts(a));
  if (!jobRuns.length) return { job, state: "down", ageHours: null, lastSuccess: null, lastError: null };

  const lastRun = jobRuns[0];
  const lastSuccess = jobRuns.find((r) => r.status === "success") || null;
  const lastError = jobRuns.find((r) => r.status === "error") || null;

  if (!lastSuccess) return { job, state: "down", ageHours: null, lastSuccess: null, lastError };

  const ageHours = (now - ts(lastSuccess)) / 3_600_000;
  // A failure newer than the last success is the most actionable signal.
  const erroredSinceSuccess = lastRun.status === "error" && ts(lastRun) > ts(lastSuccess);

  let state;
  if (erroredSinceSuccess) state = "error";
  else if (ageHours > STALE_HOURS) state = "stale";
  else state = "ok";

  return { job, state, ageHours, lastSuccess, lastError: erroredSinceSuccess ? lastRun : null };
}

/** Verdicts for every expected job. Jobs with no rows at all surface as 'down'. */
export function allJobsFreshness(runs, jobs, now = Date.now()) {
  return jobs.map((job) => jobFreshness(runs, job, now));
}

/** Worst state across jobs, for a single rollup indicator. */
export function overallState(verdicts) {
  const rank = { down: 3, error: 2, stale: 1, ok: 0 };
  return verdicts.reduce((worst, v) => (rank[v.state] > rank[worst] ? v.state : worst), "ok");
}

export const STATE_META = {
  ok: { label: "Up to date", color: "#1DB271" },
  stale: { label: "Stale", color: "#F2810E" },
  error: { label: "Last run failed", color: "#EC3642" },
  down: { label: "Never synced", color: "#EC3642" },
};

/** The canonical sync jobs this dashboard depends on. */
export const SYNC_JOBS = [
  "sync-hubspot-deals",
  "sync-hubspot-engagements",
  "sync-weekly-activity",
  "sync-ttv",
  "sync-monthly-health",
];
