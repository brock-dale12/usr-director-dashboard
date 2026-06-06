// HubSpot API wrapper. Token stays server-side (Netlify env).
// Read-only today; Phase 2 adds an allowlisted write path.
const BASE = 'https://api.hubapi.com';
const token = process.env.HUBSPOT_ACCESS_TOKEN;

export async function hs(path, { method = 'GET', body, query } = {}) {
  if (!token) throw Object.assign(new Error('HUBSPOT_ACCESS_TOKEN not set'), { status: 500 });
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);

  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await r.text();
  let payload; try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!r.ok) {
    throw Object.assign(new Error(`HubSpot ${r.status}: ${payload?.message || text}`), {
      status: r.status, data: payload,
    });
  }
  return payload;
}

export function getDeal(dealId, properties = []) {
  return hs(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, {
    query: properties.length ? { properties: properties.join(',') } : undefined,
  });
}
