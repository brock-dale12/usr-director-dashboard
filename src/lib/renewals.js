// renewals — pure helpers for the Renewals hub. Mirrors Ruby's logic: watch the
// renewal horizon, score risk from date proximity + health (+ churn_risk flag),
// and surface a personal-call tier for the most urgent. Logic is unit-tested; the
// page just loads data and renders.

// Days until renewal (negative = already past).
export function daysToRenewal(dateStr, now = Date.now()) {
  if (!dateStr) return null
  const t = Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(t)) return null
  return Math.ceil((t - now) / 86_400_000)
}

// A renewal is "at risk" when activity is dropping (orange/red) or a churn_risk
// flag is set on the deal. We don't over-interpret the churn_risk enum — any
// non-empty value is treated as a signal and shown on the card for the human.
export function isAtRisk(healthColor, churnRisk) {
  const unhealthy = healthColor === 'orange' || healthColor === 'red'
  const flagged = !!churnRisk && String(churnRisk).trim() !== '' && churnRisk !== 'No'
  return unhealthy || flagged
}

// Tier within the renewal horizon. null = not in the horizon (or no date).
//   critical    : <=30d AND at-risk  → Brock's personal call (no auto-draft)
//   at_risk     : <=90d AND at-risk
//   this_quarter: <=90d healthy      → proactive, confident
//   upcoming    : <=180d             → on the radar
export function renewalTier({ days, healthColor, churnRisk }) {
  if (days == null || days < 0) return null
  const atRisk = isAtRisk(healthColor, churnRisk)
  if (days <= 30 && atRisk) return 'critical'
  if (days <= 90 && atRisk) return 'at_risk'
  if (days <= 90) return 'this_quarter'
  if (days <= 180) return 'upcoming'
  return null
}

export const TIER_ORDER = ['critical', 'at_risk', 'this_quarter', 'upcoming']
export const TIER_META = {
  critical:     { label: 'Critical — personal call', accent: '#EC3642', note: '≤30 days & at risk' },
  at_risk:      { label: 'At risk',                   accent: '#F2810E', note: '≤90 days & at risk' },
  this_quarter: { label: 'This quarter',              accent: '#FFD900', note: '≤90 days' },
  upcoming:     { label: 'Upcoming',                  accent: '#1DB271', note: '≤180 days' },
}

// Enrich + group customers into ordered tiers, each sorted by soonest renewal.
// Each input customer needs { renewal_date, healthColor, churn_risk }.
export function buildRenewals(customers, now = Date.now()) {
  const enriched = (customers || [])
    .map((c) => {
      const days = daysToRenewal(c.renewal_date, now)
      const tier = renewalTier({ days, healthColor: c.healthColor, churnRisk: c.churn_risk })
      return { ...c, days, tier }
    })
    .filter((c) => c.tier)

  const groups = TIER_ORDER.map((tier) => ({
    tier,
    ...TIER_META[tier],
    customers: enriched.filter((c) => c.tier === tier).sort((a, b) => a.days - b.days),
  }))
  return { groups, total: enriched.length }
}
