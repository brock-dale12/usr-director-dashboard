// hubspot-notes — read & post HubSpot timeline notes for a deal.
//   GET  /.netlify/functions/hubspot-notes?dealId=123   → { ok, notes:[{id,body,timestamp}] }
//   POST /.netlify/functions/hubspot-notes  { dealId, body }  → creates a note on the deal
//   headers: { Authorization: 'Bearer <supabase user access token>' }
//
// Requires private-app scopes: crm.objects.notes.read, crm.objects.notes.write.
// Note→Deal association typeId = 214 (HUBSPOT_DEFINED).

const SUPA = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const HS = 'https://api.hubapi.com'
const NOTE_TO_DEAL = 214

const json = (statusCode, obj) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) })

async function callerIsAdmin(userToken) {
  const r = await fetch(`${SUPA}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
    body: '{}',
  })
  if (!r.ok) return false
  return (await r.json()) === true
}

async function hsFetch(path, opts = {}) {
  const r = await fetch(`${HS}${path}`, {
    ...opts,
    headers: { authorization: `Bearer ${HS_TOKEN}`, 'content-type': 'application/json', ...(opts.headers || {}) },
  })
  if (!r.ok) throw new Error(`HubSpot ${opts.method || 'GET'} ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.status === 204 ? null : r.json()
}

export const handler = async (event) => {
  if (!HS_TOKEN) return json(503, { error: 'HUBSPOT_ACCESS_TOKEN not configured' })
  const userToken = (event.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!userToken) return json(401, { error: 'Missing Authorization header' })
  let admin = false
  try { admin = await callerIsAdmin(userToken) } catch { /* not admin */ }
  if (!admin) return json(403, { error: 'Not an admin' })

  // ── POST: create a note on the deal ──────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let dealId, body
    try { ({ dealId, body } = JSON.parse(event.body || '{}')) } catch { return json(400, { error: 'bad body' }) }
    if (!dealId || !body || !String(body).trim()) return json(400, { error: 'dealId and body required' })
    try {
      const created = await hsFetch('/crm/v3/objects/notes', {
        method: 'POST',
        body: JSON.stringify({
          properties: { hs_note_body: String(body), hs_timestamp: new Date().toISOString() },
          associations: [{ to: { id: String(dealId) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_DEAL }] }],
        }),
      })
      return json(200, { ok: true, id: created?.id || null })
    } catch (e) {
      return json(502, { ok: false, error: String(e.message || e) })
    }
  }

  // ── GET: list notes on the deal ──────────────────────────────────────────
  const dealId = (event.queryStringParameters || {}).dealId
  if (!dealId) return json(400, { error: 'dealId query param required' })
  try {
    const assoc = await hsFetch(`/crm/v4/objects/deals/${dealId}/associations/notes?limit=100`)
    const ids = (assoc?.results || []).map(r => r.toObjectId).filter(Boolean)
    if (!ids.length) return json(200, { ok: true, notes: [] })
    const batch = await hsFetch('/crm/v3/objects/notes/batch/read', {
      method: 'POST',
      body: JSON.stringify({ properties: ['hs_note_body', 'hs_timestamp', 'hs_createdate'], inputs: ids.map(id => ({ id: String(id) })) }),
    })
    const notes = (batch?.results || [])
      .map(n => ({ id: n.id, body: n.properties?.hs_note_body || '', timestamp: n.properties?.hs_timestamp || n.properties?.hs_createdate || null }))
      .filter(n => n.body)
      .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    return json(200, { ok: true, notes })
  } catch (e) {
    return json(502, { ok: false, error: String(e.message || e) })
  }
}
