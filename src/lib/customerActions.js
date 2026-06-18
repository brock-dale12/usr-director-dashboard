import { supabase } from './supabase'

/**
 * customerActions — shared, stateless helpers for customer-detail writes/reads.
 *
 * One implementation, used by both the Onboarding page and the My Customers /
 * My Region LabCard drawer, so the two views can never drift. Each page keeps
 * its own stateful wrappers (optimistic updates, spinners, refetch, alerts);
 * the network/Supabase work lives here.
 */

// HubSpot-owned fields that the CS edit panel may push to HubSpot in real time.
export const HS_PUSHABLE = ['kickoff_date', 'contact_name', 'contact_email', 'contact_phone', 'speed_lab_director']

// Push changed fields to the HubSpot deal via the Netlify Function (the browser
// never holds the HubSpot token). Returns the parsed response { ok, error, ... }.
export async function pushToHubspot(dealId, changes) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch('/.netlify/functions/hubspot-writeback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ dealId, changes }),
  })
  const res = await r.json().catch(() => ({}))
  return { ok: !!(r.ok && res.ok), status: r.status, error: res.error || (res.errors || []).join('; ') || null, raw: res }
}

// Upsert the per-deal CS record + append timestamped audit events. Throws on error.
export async function upsertCs(dealId, patch, events = [], actor = null) {
  const { error } = await supabase.from('onboarding_cs').upsert(
    { deal_id: dealId, ...patch, updated_by: actor },
    { onConflict: 'deal_id' },
  )
  if (error) throw error
  if (events.length) {
    const { error: evErr } = await supabase.from('onboarding_events').insert(
      events.map(e => ({ deal_id: dealId, actor, ...e })),
    )
    if (evErr) throw evErr
  }
}

// Live HubSpot dropdown data (enum options + owners + stages). Module-level
// cache so it only fetches once per session.
let _metaCache = null
export async function loadHubspotMeta() {
  if (_metaCache) return _metaCache
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch('/.netlify/functions/hubspot-meta', { headers: { authorization: `Bearer ${session?.access_token || ''}` } })
  const res = await r.json().catch(() => ({}))
  if (r.ok && res.ok) { _metaCache = res; return res }
  throw new Error(res.error || `HTTP ${r.status}`)
}

// HubSpot timeline notes for a deal (read).
export async function loadHubspotNotes(dealId) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(`/.netlify/functions/hubspot-notes?dealId=${encodeURIComponent(dealId)}`, { headers: { authorization: `Bearer ${session?.access_token || ''}` } })
  const res = await r.json().catch(() => ({}))
  if (r.ok && res.ok) return res.notes || []
  throw new Error(res.error || `HTTP ${r.status}`)
}

// Post a note to the HubSpot deal timeline.
export async function addHubspotNote(dealId, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch('/.netlify/functions/hubspot-notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ dealId, body }),
  })
  const res = await r.json().catch(() => ({}))
  if (!(r.ok && res.ok)) throw new Error(res.error || `HTTP ${r.status}`)
}
