// hubspot-writeback — pushes dashboard property edits to HubSpot in real time.
// POST /.netlify/functions/hubspot-writeback
//   headers: { Authorization: 'Bearer <supabase user access token>' }
//   body:    { dealId: '123', changes: { kickoff_date?, contact_name?,
//              contact_email?, contact_phone?, speed_lab_director? } }
//
// The trust boundary: the HubSpot token + Supabase service key live ONLY here
// (Netlify env), never in the browser bundle. The browser proves who it is with
// its Supabase session token; we verify it AND check is_admin before touching
// HubSpot.
//
// What it does, in order:
//   1. Verify the caller's Supabase JWT → must be an admin (directors.is_admin).
//   2. Push deal-level fields (kickoff_date custom prop, speed_lab_director)
//      to the HubSpot deal; contact fields to the deal's PRIMARY (first
//      associated) contact — same convention sync_hubspot.py reads by.
//   3. Mirror pushed contact/director values into Supabase lab_accounts so
//      every dashboard page agrees immediately.
//   4. Mark the matching onboarding_events rows pushed_to_hubspot = true and
//      stamp onboarding_cs.hs_pushed_at (drives the "synced" tag in the UI).
//
// Team notes are NEVER pushed — internal by design.
//
// Required Netlify env: HUBSPOT_ACCESS_TOKEN (private app, needs
// crm.objects.deals.write + crm.objects.contacts.write), SUPABASE_SERVICE_KEY,
// VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.

const SUPA = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_KEY
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const HS = 'https://api.hubapi.com'

// field → where it lives in HubSpot
const DEAL_FIELDS = { kickoff_date: 'kickoff_date', speed_lab_director: 'speed_lab_director' }
const CONTACT_FIELDS = new Set(['contact_name', 'contact_email', 'contact_phone'])
// fields mirrored back into lab_accounts after a successful push
const MIRROR_TO_LAB_ACCOUNTS = new Set(['contact_name', 'contact_email', 'contact_phone', 'speed_lab_director'])

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
})

async function callerIsAdmin(userToken) {
  // Run is_admin() AS the caller (their JWT = their auth context).
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
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`HubSpot ${opts.method || 'GET'} ${path} → ${r.status}: ${text.slice(0, 300)}`)
  }
  return r.status === 204 ? null : r.json()
}

async function primaryContactId(dealId) {
  const data = await hsFetch(`/crm/v4/objects/deals/${dealId}/associations/contacts?limit=1`)
  return data?.results?.[0]?.toObjectId ?? null
}

function contactProps(changes) {
  const props = {}
  if ('contact_name' in changes) {
    const parts = String(changes.contact_name || '').trim().split(/\s+/)
    props.firstname = parts.shift() || ''
    props.lastname = parts.join(' ')
  }
  if ('contact_email' in changes) props.email = changes.contact_email || ''
  if ('contact_phone' in changes) props.phone = changes.contact_phone || ''
  return props
}

async function supaService(path, method, body) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`Supabase ${method} ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })
  if (!HS_TOKEN) return json(503, { error: 'HUBSPOT_ACCESS_TOKEN not configured in Netlify env' })
  if (!SERVICE) return json(503, { error: 'SUPABASE_SERVICE_KEY not configured in Netlify env' })

  const userToken = (event.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!userToken) return json(401, { error: 'Missing Authorization header' })
  if (!(await callerIsAdmin(userToken))) return json(403, { error: 'Not an admin' })

  let dealId, changes
  try {
    ;({ dealId, changes } = JSON.parse(event.body || '{}'))
    if (!dealId || !changes || typeof changes !== 'object') throw new Error()
  } catch {
    return json(400, { error: 'Body must be { dealId, changes: {...} }' })
  }

  const pushed = [], skipped = [], errors = []

  // ── 1. Deal-level properties ─────────────────────────────────────────────
  const dealProps = {}
  for (const [field, hsProp] of Object.entries(DEAL_FIELDS)) {
    if (field in changes) dealProps[hsProp] = changes[field] ?? ''
  }
  if (Object.keys(dealProps).length) {
    try {
      await hsFetch(`/crm/v3/objects/deals/${dealId}`, { method: 'PATCH', body: JSON.stringify({ properties: dealProps }) })
      pushed.push(...Object.keys(dealProps).map(p => `deal.${p}`))
    } catch (e) {
      errors.push(String(e.message || e))
    }
  }

  // ── 2. Contact-level properties (primary = first associated contact) ────
  const cProps = contactProps(changes)
  if (Object.keys(cProps).length) {
    try {
      const contactId = await primaryContactId(dealId)
      if (!contactId) {
        skipped.push('contact fields — deal has no associated contact in HubSpot')
      } else {
        await hsFetch(`/crm/v3/objects/contacts/${contactId}`, { method: 'PATCH', body: JSON.stringify({ properties: cProps }) })
        pushed.push(...Object.keys(cProps).map(p => `contact.${p}`))
      }
    } catch (e) {
      errors.push(String(e.message || e))
    }
  }

  // Unknown / internal-only fields (e.g. notes, stage_override) are ignored.
  for (const k of Object.keys(changes)) {
    if (!(k in DEAL_FIELDS) && !CONTACT_FIELDS.has(k)) skipped.push(`${k} — internal-only, not pushed`)
  }

  // ── 3 & 4. Mirror + bookkeeping (only what actually pushed) ─────────────
  if (pushed.length) {
    try {
      const mirror = {}
      for (const k of Object.keys(changes)) if (MIRROR_TO_LAB_ACCOUNTS.has(k)) mirror[k] = changes[k]
      if (Object.keys(mirror).length && !errors.length) {
        await supaService(`lab_accounts?deal_id=eq.${encodeURIComponent(dealId)}`, 'PATCH', mirror)
      }
      const fields = Object.keys(changes).filter(k => k in DEAL_FIELDS || CONTACT_FIELDS.has(k))
      if (fields.length) {
        await supaService(
          `onboarding_events?deal_id=eq.${encodeURIComponent(dealId)}&field=in.(${fields.map(f => `"${f}"`).join(',')})&pushed_to_hubspot=eq.false`,
          'PATCH', { pushed_to_hubspot: true },
        )
      }
      await supaService(`onboarding_cs?deal_id=eq.${encodeURIComponent(dealId)}`, 'PATCH', { hs_pushed_at: new Date().toISOString() })
    } catch (e) {
      errors.push(`pushed to HubSpot but bookkeeping failed: ${String(e.message || e)}`)
    }
  }

  return json(errors.length && !pushed.length ? 502 : 200, { ok: errors.length === 0, pushed, skipped, errors })
}
