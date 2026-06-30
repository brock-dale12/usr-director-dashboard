// payments — pure helpers for the lightweight CS Payments view. Reads the HubSpot
// payment fields already synced into lab_accounts (payment_update = received status,
// overdue_amount, payment_processor, payment_status = the billing-day enum). The
// deeper Measure/QuickBooks billing work is a separate effort. Logic is unit-tested.

// Received-status severity, worst first. payment_update enum: Paid/Open/Declined/Late/Collections.
export const PAY_TIER_ORDER = ['Collections', 'Late', 'Declined', 'Open', 'Paid']
export const PAY_META = {
  Collections: { accent: '#7C1D1D', note: 'in collections' },
  Late:        { accent: '#EC3642', note: 'late' },
  Declined:    { accent: '#F2810E', note: 'payment declined' },
  Open:        { accent: '#FFD900', note: 'open / due' },
  Paid:        { accent: '#1DB271', note: 'up to date' },
}
// Tiers that need a human to act.
export const ACTION_TIERS = ['Collections', 'Late', 'Declined', 'Open']

const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

// Normalize payment_update to a known tier, or null when unset/unknown.
export function paymentTier(paymentUpdate) {
  if (!paymentUpdate) return null
  const v = String(paymentUpdate).trim()
  return PAY_TIER_ORDER.includes(v) ? v : null
}

// Group accounts by payment tier (worst first), sort within by overdue amount desc
// then name. Returns groups + per-tier totals + the overdue sum needing attention.
export function buildPayments(accounts) {
  const enriched = (accounts || [])
    .map((a) => ({ ...a, tier: paymentTier(a.payment_update), overdue: num(a.overdue_amount) }))
    .filter((a) => a.tier)

  const groups = PAY_TIER_ORDER.map((tier) => {
    const customers = enriched
      .filter((a) => a.tier === tier)
      .sort((x, y) => (y.overdue - x.overdue) || String(x.lab_name).localeCompare(String(y.lab_name)))
    return {
      tier,
      ...PAY_META[tier],
      customers,
      count: customers.length,
      overdueSum: customers.reduce((s, c) => s + c.overdue, 0),
    }
  })

  const needsAttention = groups
    .filter((g) => ACTION_TIERS.includes(g.tier))
    .reduce((s, g) => s + g.overdueSum, 0)

  return { groups, total: enriched.length, needsAttention }
}
