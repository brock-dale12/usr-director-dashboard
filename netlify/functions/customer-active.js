// customer-active — confirm/dismiss a churn flag on a customer (soft-delete flow).
// POST /.netlify/functions/customer-active
//   headers: { Authorization: 'Bearer <supabase user access token>' }
//   body:    { dealId: '123', action: 'confirm_churn' | 'keep_active' }
//
// Phase-2 of the churn UX (see dashboard-rebuild-spec). The HubSpot sync flags a
// customer (churn_flagged = true) when all of its deals leave the active roster;
// it NEVER deletes. A human confirms here:
//   • confirm_churn → is_active = false  (drops out of every customer view),
//                     churn_flagged = false, churn_confirmed_at = now.
//   • keep_active   → churn_flagged = false, churn_flagged_at = null
//                     (dismiss the flag; the row stays active).
//
// Trust boundary: the Supabase SERVICE key lives ONLY here (Netlify env), never
// in the browser bundle. The browser proves who it is with its Supabase session
// token; we verify it AND require is_admin before writing. Same pattern as
// hubspot-writeback.js. Keyed by deal_id (= the roster's current_deal_id, unique
// per row), matching how hubspot-sync upserts and flags.
//
// Required Netlify env: SUPABASE_SERVICE_KEY, VITE_SUPABASE_URL,
// VITE_SUPABASE_ANON_KEY.

const SUPA = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_KEY

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
  if (!SERVICE) return json(503, { error: 'SUPABASE_SERVICE_KEY not configured in Netlify env' })

  const userToken = (event.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!userToken) return json(401, { error: 'Missing Authorization header' })
  let isAdmin = false
  try { isAdmin = await callerIsAdmin(userToken) } catch { /* treated as not admin */ }
  if (!isAdmin) return json(403, { error: 'Not an admin' })

  let dealId, action
  try {
    ;({ dealId, action } = JSON.parse(event.body || '{}'))
    if (!dealId || (action !== 'confirm_churn' && action !== 'keep_active')) throw new Error()
  } catch {
    return json(400, { error: "Body must be { dealId, action: 'confirm_churn' | 'keep_active' }" })
  }

  const patch = action === 'confirm_churn'
    ? { is_active: false, churn_flagged: false, churn_confirmed_at: new Date().toISOString() }
    : { churn_flagged: false, churn_flagged_at: null }

  try {
    await supaService(`lab_accounts?deal_id=eq.${encodeURIComponent(dealId)}`, 'PATCH', patch)
  } catch (e) {
    return json(502, { ok: false, error: String(e.message || e) })
  }

  return json(200, { ok: true, dealId, action })
}
