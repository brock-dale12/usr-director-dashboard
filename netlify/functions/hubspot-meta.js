// hubspot-meta — live dropdown data for the Deal Properties panel.
// GET /.netlify/functions/hubspot-meta
//   headers: { Authorization: 'Bearer <supabase user access token>' }
// Returns enum options for the editable deal properties, the owners list, and the
// deal pipeline stages — fetched live from HubSpot so dropdowns mirror HubSpot.
//
// Requires private-app scopes: crm.schemas.deals.read, crm.objects.owners.read.

const SUPA = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const HS = 'https://api.hubapi.com'

// Enum deal properties whose options we surface as dropdowns.
const ENUM_PROPS = [
  'product', 'customer_segement', 'speed_lab_level', 'speed_lab_status',
  'payment_update', 'payment_status', 'payment_processor', 'renewal_status',
  'hardware', 'removed_access_from_usr', 'churn_risk', 'years_as_a_speed_lab',
]

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

async function hsFetch(path) {
  const r = await fetch(`${HS}${path}`, { headers: { authorization: `Bearer ${HS_TOKEN}`, 'content-type': 'application/json' } })
  if (!r.ok) throw new Error(`HubSpot GET ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

export const handler = async (event) => {
  if (!HS_TOKEN) return json(503, { error: 'HUBSPOT_ACCESS_TOKEN not configured' })
  const userToken = (event.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!userToken) return json(401, { error: 'Missing Authorization header' })
  let admin = false
  try { admin = await callerIsAdmin(userToken) } catch { /* not admin */ }
  if (!admin) return json(403, { error: 'Not an admin' })

  const out = { ok: true, properties: {}, owners: [], stages: [], errors: [] }

  // Property enum options
  try {
    const data = await hsFetch('/crm/v3/properties/deals?archived=false')
    const byName = {}
    ;(data.results || []).forEach(p => { byName[p.name] = p })
    ENUM_PROPS.forEach(name => {
      const p = byName[name]
      if (p && Array.isArray(p.options)) {
        out.properties[name] = p.options
          .filter(o => !o.hidden)
          .map(o => ({ value: o.value, label: o.label }))
      }
    })
  } catch (e) { out.errors.push(`properties: ${String(e.message || e)}`) }

  // Owners
  try {
    const data = await hsFetch('/crm/v3/owners/?limit=500')
    out.owners = (data.results || []).map(o => ({
      id: String(o.id),
      name: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || `Owner ${o.id}`,
      email: o.email || null,
    })).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  } catch (e) { out.errors.push(`owners: ${String(e.message || e)}`) }

  // Deal pipeline stages (flattened across deal pipelines)
  try {
    const data = await hsFetch('/crm/v3/pipelines/deals')
    const seen = new Set()
    ;(data.results || []).forEach(pl => {
      ;(pl.stages || []).forEach(s => {
        if (!seen.has(s.id)) { seen.add(s.id); out.stages.push({ id: String(s.id), label: s.label }) }
      })
    })
  } catch (e) { out.errors.push(`stages: ${String(e.message || e)}`) }

  return json(200, out)
}
