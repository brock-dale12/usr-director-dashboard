// hubspot-sync — on-demand HubSpot → Supabase refresh for the customer roster.
// POST /.netlify/functions/hubspot-sync
//   headers: { Authorization: 'Bearer <supabase user access token>' }
//
// Triggered by the "Refresh now" button. Builds lab_accounts as a CLEAN customer
// roster: it pulls only the ACTIVE Speed Lab Onboarding deals (the canonical
// "active customer" definition), groups them by their associated HubSpot Company,
// and writes ONE row per customer (the company's most-recent deal is canonical).
//
// Identity model:
//   - One row per CUSTOMER. Dedup authority = HubSpot Company (hubspot_company_id).
//   - Row key for upsert = deal_id (the canonical deal). This keeps the deal_id
//     "spine" that the satellite tables (onboarding_cs/progress/ttv) join on, and
//     it's what lab_accounts has a unique constraint on.
//   - Churn = FLAGGED, never deleted: any previously-active row no longer in the
//     active roster gets churn_flagged=true for Brock to confirm/remove.
//
// Trust boundary: HUBSPOT_ACCESS_TOKEN + SUPABASE_SERVICE_KEY live ONLY here
// (Netlify env). The browser proves identity with its Supabase session token; we
// verify it AND require is_admin before touching HubSpot.
//
// Required Netlify env: HUBSPOT_ACCESS_TOKEN (private app: crm.objects.deals.read
// and — for company grouping — crm.objects.companies.read), SUPABASE_SERVICE_KEY,
// VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.

const SUPA = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_KEY
const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const HS = 'https://api.hubapi.com'

// Active Speed Lab Onboarding pipeline + terminal stages to exclude.
const PIPELINE_ID = '64911390'
const CLOSED_WON = '132311327'
const CLOSED_LOST = '132311328'

// HubSpot deal stage id → human label.
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
  'amount', 'payment_update', 'payment_processor', 'overdue_amount',
  'onboarding_cohort', 'removed_access_from_usr', 'speed_lab_level', 'years_as_a_speed_lab',
  'createdate',
]

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

// Pull ONLY the active customer deals via the Search API.
// Active = pipeline 64911390, stage not Closed Won/Lost, renewal_status != Churned
// (the renewal filter is split into two OR groups to also include deals where
// renewal_status is unset). Mirrors the active-customers skill.
async function fetchActiveDeals() {
  const common = [
    { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_ID },
    { propertyName: 'dealstage', operator: 'NOT_IN', values: [CLOSED_WON, CLOSED_LOST] },
  ]
  const base = {
    filterGroups: [
      { filters: [...common, { propertyName: 'renewal_status', operator: 'NEQ', value: 'Churned' }] },
      { filters: [...common, { propertyName: 'renewal_status', operator: 'NOT_HAS_PROPERTY' }] },
    ],
    properties: DEAL_PROPS,
    sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
    limit: 100,
  }
  const deals = []
  let after
  for (let page = 0; page < 20; page++) {
    const body = after ? { ...base, after } : base
    const data = await hsFetch('/crm/v3/objects/deals/search', { method: 'POST', body: JSON.stringify(body) })
    deals.push(...(data.results || []))
    after = data.paging?.next?.after
    if (!after) break
  }
  return deals
}

// Map each deal id → its primary associated company id (v4 batch associations).
// Degrades gracefully: if the token lacks companies-read scope (or any error), we
// return an empty map and the caller falls back to one-row-per-deal.
async function fetchDealCompanies(dealIds) {
  const map = {}
  try {
    for (let i = 0; i < dealIds.length; i += 100) {
      const chunk = dealIds.slice(i, i + 100)
      const data = await hsFetch('/crm/v4/associations/deals/companies/batch/read', {
        method: 'POST',
        body: JSON.stringify({ inputs: chunk.map((id) => ({ id: String(id) })) }),
      })
      for (const r of (data.results || [])) {
        const from = String(r.from?.id ?? '')
        const to = r.to?.[0]?.toObjectId ?? r.to?.[0]?.id
        if (from && to != null) map[from] = String(to)
      }
    }
  } catch (e) {
    return { __error: String(e.message || e) }
  }
  return map
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

function mapDealToRow(d, companyId) {
  const p = d.properties || {}
  const stage = p.dealstage
  return {
    lab_name: (p.dealname || '').trim() || '(unnamed customer)',
    deal_id: String(d.id),
    hubspot_company_id: companyId || null,
    is_active: true,
    churn_flagged: false,
    churn_flagged_at: null,
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
    payment_status: p.payment_status ?? null,
    speed_lab_director: p.speed_lab_director ?? null,
    arr_amount: toNumber(p.arr_amount),
    amount: toNumber(p.amount),
    payment_update: p.payment_update ?? null,
    payment_processor: p.payment_processor ?? null,
    overdue_amount: toNumber(p.overdue_amount),
    onboarding_cohort: p.onboarding_cohort ?? null,
    removed_access_from_usr: p.removed_access_from_usr ?? null,
    speed_lab_level: p.speed_lab_level ?? null,
    years_as_a_speed_lab: p.years_as_a_speed_lab ?? null,
  }
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
  let ok = false, summary = '', customers = 0, flagged = 0
  try {
    // 1. Active deals only.
    const deals = await fetchActiveDeals()

    // 2. Group by associated company (canonical = most-recent createdate).
    const companyOf = await fetchDealCompanies(deals.map((d) => d.id))
    const assocDegraded = !!companyOf.__error
    const groups = {}
    for (const d of deals) {
      const cid = assocDegraded ? null : (companyOf[String(d.id)] || null)
      const key = cid ? `c:${cid}` : `d:${d.id}` // no company → that deal is its own customer
      ;(groups[key] = groups[key] || []).push({ d, cid })
    }

    // 3. One row per group: pick the most-recently-created deal as canonical.
    const rows = []
    for (const key of Object.keys(groups)) {
      const arr = groups[key].sort((a, b) =>
        String(b.d.properties?.createdate || '').localeCompare(String(a.d.properties?.createdate || '')))
      rows.push(mapDealToRow(arr[0].d, arr[0].cid))
    }
    customers = rows.length

    // 4. Upsert the roster (merge on deal_id — preserves existing enrichment).
    for (let i = 0; i < rows.length; i += 100) {
      await supaService(
        'lab_accounts?on_conflict=deal_id', 'POST', rows.slice(i, i + 100),
        { Prefer: 'resolution=merge-duplicates,return=minimal' },
      )
    }

    // 5. Churn sweep: flag previously-active rows that are no longer in the active
    //    roster. Never deletes — Brock confirms removal in the UI.
    const rosterIds = rows.map((r) => r.deal_id)
    if (rosterIds.length) {
      const patched = await supaService(
        `lab_accounts?is_active=eq.true&churn_flagged=eq.false&deal_id=not.in.(${rosterIds.join(',')})`,
        'PATCH',
        { churn_flagged: true, churn_flagged_at: ranAt },
        { Prefer: 'return=representation' },
      )
      flagged = Array.isArray(patched) ? patched.length : 0
    }

    ok = true
    summary = `${customers} customers from ${deals.length} active deals`
      + `; ${flagged} flagged for churn review`
      + (assocDegraded ? ` (company grouping unavailable: ${companyOf.__error} — fell back to one row per deal)` : '')
  } catch (e) {
    summary = String(e.message || e)
  }

  // Best-effort sync_runs log (don't fail the response if logging fails).
  try {
    await supaService('sync_runs', 'POST',
      { source: 'hubspot-sync', ran_at: ranAt, ok, summary }, { Prefer: 'return=minimal' })
  } catch { /* ignore */ }

  if (!ok) return json(502, { ok: false, error: summary, ran_at: ranAt })
  return json(200, { ok: true, ran_at: ranAt, customers, flagged, summary })
}
