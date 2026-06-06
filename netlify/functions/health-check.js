// Verifies SUPABASE_SERVICE_KEY and HUBSPOT_ACCESS_TOKEN are set and accepted
// by upstream APIs. Returns pass/fail + HTTP status only — no upstream data,
// no secrets. Safe to delete once Phase 1 wiring lands.
// Reachable at: /.netlify/functions/health-check

export const handler = async () => {
  const results = {};

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    results.supabase = { ok: false, reason: 'env_missing' };
  } else {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });
      results.supabase = { ok: res.ok, status: res.status };
    } catch (e) {
      results.supabase = { ok: false, reason: 'fetch_failed', error: String(e) };
    }
  }

  const hubspotToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!hubspotToken) {
    results.hubspot = { ok: false, reason: 'env_missing' };
  } else {
    try {
      const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
        headers: { Authorization: `Bearer ${hubspotToken}` },
      });
      results.hubspot = { ok: res.ok, status: res.status };
    } catch (e) {
      results.hubspot = { ok: false, reason: 'fetch_failed', error: String(e) };
    }
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  };
};
