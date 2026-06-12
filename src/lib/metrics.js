// metrics.js — THE single source of truth for customer-metric conventions.
// Every page that shows customer data imports from here. Do not re-implement
// these locally in a page. Canon (2026-06-12):
//   • Weekly metrics: weekly_health_snapshots (recaps_week, logins_week,
//     data_pts_week, athletes_added_week, prs_week), Mon–Sun weeks, last 8.
//   • Cell color = that week's health_color (green ≤7d, yellow 8–30d,
//     orange 31–90d, red 90+d since last activity).
//   • CS dashboard edits (onboarding_cs) OVERRIDE lab_accounts display values.
//   • Day-of-90 anchors on onboarding_cs.kickoff_date, falls back to
//     lab_accounts.contract_start_date.

import { supabase } from './supabase'

// Sort/priority order for health colors, worst first.
export const COLOR_ORDER = { red: 0, orange: 1, yellow: 2, green: 3, unknown: 4 }

export function daysSince(d) {
  if (!d) return null
  const days = Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000)
  return days >= 0 ? days : null
}

// Load all onboarding_cs rows as { deal_id: row }. Pages call this once.
export async function fetchCsByDeal() {
  const { data, error } = await supabase.from('onboarding_cs').select('*')
  if (error) return {}
  const m = {}
  ;(data || []).forEach(r => { m[r.deal_id] = r })
  return m
}

// Merge CS dashboard edits over HubSpot-synced lab_accounts values.
// Returns display-ready fields; base values preserved for diff/audit needs.
export function applyCsOverrides(account, cs) {
  return {
    contactName: cs?.contact_name ?? account.contact_name,
    email:       cs?.contact_email ?? account.contact_email,
    phone:       cs?.contact_phone ?? account.contact_phone,
    director:    cs?.speed_lab_director ?? (account.speed_lab_director || account.director_name || null),
    notes:       cs?.notes ?? null,
    kickoffDate: cs?.kickoff_date ?? null,
  }
}

// Day-of-90: kick-off date wins; contract start is the fallback.
export function dayOf90(account, cs) {
  return daysSince(cs?.kickoff_date || account.contract_start_date)
}

// Canonical last-8-weeks shape for the WeeklyMatrix component.
export function last8Weeks(weeklyRowsSorted) {
  return (weeklyRowsSorted || []).slice(-8).map(w => ({
    color: w.health_color,
    recaps: w.recaps_week,
    logins: w.logins_week,
    datapoints: w.data_pts_week,
    athletes: w.athletes_added_week,
    prs: w.prs_week,
    preCustomer: false,
  }))
}
