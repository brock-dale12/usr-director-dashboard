// hubspot-sync — on-demand HubSpot → Supabase refresh for the Onboarding view.
// POST /.netlify/functions/hubspot-sync
//   headers: { Authorization: 'Bearer <supabase user access token>' }
//
// Triggered by the "Refresh now" button on the Onboarding page. Pulls every deal
// from HubSpot, matches each to an active lab (lab_assignments), maps the deal
// stage id → human label, and upserts the deal-level Customer-Success columns into
// lab_accounts — the exact same mapping as the manual ops script
// update_lab_accounts_from_deals.py, just run server-side on demand. Existing
// contact/company info on a row is preserved (deal-level fields only).
//
// Records a row in sync_runs so the UI can show a "last synced" badge.
//
// Trust boundary: HUBSPOT_ACCESS_TOKEN + SUPABASE_SERVICE_KEY live ONLY here
// (Netlify env). The browser proves who it is with its Supabase session token; we
// verify it AND require is_admin before touching HubSpot.
//
// Required Netlify env: HUBSPOT_ACCESS_TOKEN (private app, needs
// crm.objects.deals.read), SUPABASE_SERVICE_KEY, VITE_SUPABASE_URL,
// VITE_SUPABASE_ANON_KEY.
//
// NOTE (same limitation as the manual script): a deal only lands in lab_accounts
// if it matches an ACTIVE row in lab_assignments (by hubspot_deal_id, else fuzzy
// dealname). A brand-new customer must have a lab_assignment first.

const SUPA = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_KEY
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const HS = 'https://api.hubapi.com'

// HubSpot deal stage id → human label (mirror of update_lab_accounts_from_deals.py)
const STAGE_LABELS = {
  '126902544': 'On Deck',
  '126902545': 'Level Set',
  '126902546': 'First 30 Days',
  '128794704': 'First 90 Days',
  '126902547': 'Months 4-7',
  '126890754': 'Upcoming Renewals',
  '132288808': 'Renewals this Quarter',
  '132311327': 'Closed Won',
  '132311328': 'Closed Lost',
}

const DEAL_PROPS = [
  'dealname', 'dealstage', 'contract_end_date', 'product', 'contract_start_date',
  'contract_year', 'renewal_status', 'speed_lab_status', 'churn_risk',
  'customer_segement', 'payment_status', 'speed_lab_director', 'arr_amount',
  // Added 2026-06-17b for the Deal Properties panel (verified internal names)
  'amount', 'payment_update', 'payment_processor', 'overdue_amount',
  'onboarding_cohort', 'removed_access_from_usr', 'speed_lab_level', 'years_as_a_speed_lab',
]

const STOP_WORDS = new Set([
  'llc', 'inc', 'corp', 'co', 'the', 'and', 'of', 'a',
  'performance', 'training', 'athletics', 'sports', 'fitness',
  'speed', 'lab', 'strength', 'power', 'athletic', 'academy',
  'center', 'gym', 'studio', 'facility',
])

const normalize = (name) => {
  if (!name) return ''
  const s = name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  return s.split(/\s+/).filter(w => w && !STOP_WORDS.has(w) && w.length > 1).join(' ')
}
const dateOnly = (v) => (v ? String(v).slice(0, 10) : null)
const toNumber = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
})

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
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`HubSpot ${opts.method || 'GET'} ${path} → ${r.status}: ${text.slice(0, 300)}`)
  }
  return r.json()
}

// Pull every deal (paginated). Cap pages to stay well within function limits.
async function fetchAllDeals() {
  const deals = []
  let after = null
  for (let page = 0; page < 60; page++) {
    const qs = new URLSearchParams({ limit: '100', properties: DEAL_PROPS.join(',') })
    if (after) qs.set('after', after)
    const data = await hsFetch(`/crm/v3/objects/deals?${qs.toString()}`)
    deals.push(...(data.results || []))
    after = data.paging?.next?.after
    if (!after) break
  }
  return deals
}

async function supaService(path, method, body, extraHeaders) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json', ...(extraHeaders || {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`Supabase ${method} ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const txt = await r.text()
  return txt ? JSON.parse(txt) : null
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })
  if (!HS_TOKEN) return json(503, { error: 'HUBSPOT_ACCESS_TOKEN not configured in Netlify env' })
  if (!SERVICE) return json(503, { error: 'SUPABASE_SERVICE_KEY not configured in Netlify env' })

  const userToken = (event.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!userToken) return json(401, { error: 'Missing Authorization header' })
  let isAdmin = false
  try { isAdmin = await callerIsAdmin(userToken) } catch { /* treated as not admin */ }
  if (!isAdmin) return json(403, { error: 'Not an admin' })

  const ranAt = new Date().toISOString()
  let ok = false, summary = '', rowsUpserted = 0, unmatched = 0
  try {
    // Active lab assignments (matching keys)
    const assigns = await supaService(
      'lab_assignments?select=lab_name,hubspot_deal_id&active=eq.true', 'GET',
    ) || []
    const dealToLab = {}
    const labNames = []
    assigns.forEach(a => { labNames.push(a.lab_name); if (a.hubspot_deal_id) dealToLab[String(a.hubspot_deal_id)] = a.lab_name })

    const deals = await fetchAllDeals()

    const byLab = {}
    for (const d of deals) {
      const did = String(d.id)
      const p = d.properties || {}
      const dealname = (p.dealname || '').trim()
      let lab = dealToLab[did]
      if (!lab) {
        const nd = normalize(dealname)
        for (const ln of labNames) {
          const nl = normalize(ln)
          if (nl === nd || (nl.length >= 4 && (nd.includes(nl) || nl.includes(nd)))) { lab = ln; break }
        }
      }
      if (!lab) { unmatched++; continue }
      const stage = p.dealstage
      byLab[lab] = {
        lab_name: lab,
        deal_id: did,
        renewal_date: dateOnly(p.contract_end_date),
        deal_stage: stage,
        deal_stage_label: STAGE_LABELS[stage] || stage,
        product: p.product ?? null,
        contract_start_date: dateOnly(p.contract_start_date),
        contract_year: p.contract_year ?? null,
        renewal_status: p.renewal_status ?? null,
        speed_lab_status: p.speed_lab_status ?? null,
        churn_risk: p.churn_risk ?? null,
        customer_segment: p.customer_segement ?? null, // HubSpot misspelling
        payment_status: p.payment_status ?? null,       // "Payment Date" enum
        speed_lab_director: p.speed_lab_director ?? null,
        arr_amount: toNumber(p.arr_amount),
        // Added 2026-06-17b
        amount: toNumber(p.amount),                      // standard Amount → surfaced as ARR
        payment_update: p.payment_update ?? null,        // "Payment Status" enum
        payment_processor: p.payment_processor ?? null,
        overdue_amount: toNumber(p.overdue_amount),
        onboarding_cohort: p.onboarding_cohort ?? null,
        removed_access_from_usr: p.removed_access_from_usr ?? null,
        speed_lab_level: p.speed_lab_level ?? null,
        years_as_a_speed_lab: p.years_as_a_speed_lab ?? null,
      }
    }
    const rows = Object.values(byLab)
    for (let i = 0; i < rows.length; i += 100) {
      await supaService(
        'lab_accounts?on_conflict=lab_name', 'POST', rows.slice(i, i + 100),
        { Prefer: 'resolution=merge-duplicates,return=minimal' },
      )
    }
    rowsUpserted = rows.length
    ok = true
    summary = `${rowsUpserted} lab_accounts rows from ${deals.length} deals (${unmatched} unmatched)`
  } catch (e) {
    summary = String(e.message || e)
  }

  // Best-effort sync_runs log (don't fail the response if logging fails)
  try {
    await supaService('sync_runs', 'POST',
      { source: 'hubspot-sync', ran_at: ranAt, ok, summary }, { Prefer: 'return=minimal' })
  } catch { /* ignore */ }

  if (!ok) return json(502, { ok: false, error: summary, ran_at: ranAt })
  return json(200, { ok: true, ran_at: ranAt, rows: rowsUpserted, unmatched, summary })
}
