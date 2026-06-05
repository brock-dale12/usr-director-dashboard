// Phase 0 smoke test — proves the Netlify Functions pipeline deploys and runs.
// Reachable at: /.netlify/functions/ping
// No secrets, no external calls. Safe to keep as a health check.

export const handler = async () => ({
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    ok: true,
    service: 'usr-director-dashboard functions',
    time: new Date().toISOString(),
  }),
});
