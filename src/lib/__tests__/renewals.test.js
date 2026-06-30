import { describe, it, expect } from 'vitest'
import { daysToRenewal, isAtRisk, renewalTier, buildRenewals, TIER_ORDER } from '../renewals.js'

const NOW = Date.parse('2026-06-30T12:00:00Z')
const inDays = (n) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10)

describe('daysToRenewal', () => {
  it('counts days until a future renewal', () => {
    expect(daysToRenewal(inDays(45), NOW)).toBe(45)
  })
  it('is negative for a past renewal', () => {
    expect(daysToRenewal(inDays(-5), NOW)).toBeLessThan(0)
  })
  it('returns null for missing/invalid dates', () => {
    expect(daysToRenewal(null, NOW)).toBe(null)
    expect(daysToRenewal('nope', NOW)).toBe(null)
  })
})

describe('isAtRisk', () => {
  it('is true when health is orange/red', () => {
    expect(isAtRisk('orange', null)).toBe(true)
    expect(isAtRisk('red', null)).toBe(true)
  })
  it('is true when a churn_risk flag is set (other than No)', () => {
    expect(isAtRisk('green', 'Inquiry')).toBe(true)
    expect(isAtRisk('green', 'Pause')).toBe(true)
  })
  it('is false for healthy + no flag', () => {
    expect(isAtRisk('green', null)).toBe(false)
    expect(isAtRisk('yellow', '')).toBe(false)
    expect(isAtRisk('green', 'No')).toBe(false)
  })
})

describe('renewalTier', () => {
  it('critical = within 30 days and at risk', () => {
    expect(renewalTier({ days: 20, healthColor: 'red', churnRisk: null })).toBe('critical')
  })
  it('at_risk = within 90 days and at risk (but >30)', () => {
    expect(renewalTier({ days: 60, healthColor: 'orange', churnRisk: null })).toBe('at_risk')
  })
  it('this_quarter = within 90 days and healthy', () => {
    expect(renewalTier({ days: 45, healthColor: 'green', churnRisk: null })).toBe('this_quarter')
  })
  it('upcoming = within 180 days', () => {
    expect(renewalTier({ days: 150, healthColor: 'green', churnRisk: null })).toBe('upcoming')
  })
  it('null when beyond horizon, past, or no date', () => {
    expect(renewalTier({ days: 200, healthColor: 'red', churnRisk: 'Inquiry' })).toBe(null)
    expect(renewalTier({ days: -3, healthColor: 'red', churnRisk: null })).toBe(null)
    expect(renewalTier({ days: null })).toBe(null)
  })
  it('a 25-day healthy renewal is this_quarter, not critical', () => {
    expect(renewalTier({ days: 25, healthColor: 'green', churnRisk: null })).toBe('this_quarter')
  })
})

describe('buildRenewals', () => {
  const customers = [
    { lab_name: 'Crit', renewal_date: inDays(15), healthColor: 'red', churn_risk: null },
    { lab_name: 'Risk', renewal_date: inDays(70), healthColor: 'orange', churn_risk: null },
    { lab_name: 'Soon', renewal_date: inDays(40), healthColor: 'green', churn_risk: null },
    { lab_name: 'Later', renewal_date: inDays(150), healthColor: 'green', churn_risk: null },
    { lab_name: 'Far', renewal_date: inDays(300), healthColor: 'red', churn_risk: null },
    { lab_name: 'NoDate', renewal_date: null, healthColor: 'red', churn_risk: null },
  ]
  it('groups into the four tiers in order and drops out-of-horizon', () => {
    const { groups, total } = buildRenewals(customers, NOW)
    expect(groups.map(g => g.tier)).toEqual(TIER_ORDER)
    expect(total).toBe(4) // Far + NoDate excluded
    const byTier = Object.fromEntries(groups.map(g => [g.tier, g.customers.map(c => c.lab_name)]))
    expect(byTier.critical).toEqual(['Crit'])
    expect(byTier.at_risk).toEqual(['Risk'])
    expect(byTier.this_quarter).toEqual(['Soon'])
    expect(byTier.upcoming).toEqual(['Later'])
  })
  it('sorts within a tier by soonest renewal', () => {
    const two = [
      { lab_name: 'B', renewal_date: inDays(80), healthColor: 'green', churn_risk: null },
      { lab_name: 'A', renewal_date: inDays(20), healthColor: 'green', churn_risk: null },
    ]
    const { groups } = buildRenewals(two, NOW)
    expect(groups.find(g => g.tier === 'this_quarter').customers.map(c => c.lab_name)).toEqual(['A', 'B'])
  })
})
