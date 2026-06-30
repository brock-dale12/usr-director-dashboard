import { describe, it, expect } from 'vitest'
import { paymentTier, buildPayments, PAY_TIER_ORDER } from '../payments.js'

describe('paymentTier', () => {
  it('passes through known statuses', () => {
    expect(paymentTier('Late')).toBe('Late')
    expect(paymentTier('Collections')).toBe('Collections')
    expect(paymentTier('Paid')).toBe('Paid')
  })
  it('returns null for unset/unknown', () => {
    expect(paymentTier(null)).toBe(null)
    expect(paymentTier('')).toBe(null)
    expect(paymentTier('Weird')).toBe(null)
  })
})

describe('buildPayments', () => {
  const accounts = [
    { lab_name: 'A', payment_update: 'Late', overdue_amount: 500 },
    { lab_name: 'B', payment_update: 'Late', overdue_amount: 1500 },
    { lab_name: 'C', payment_update: 'Collections', overdue_amount: 2000 },
    { lab_name: 'D', payment_update: 'Open', overdue_amount: 0 },
    { lab_name: 'E', payment_update: 'Paid', overdue_amount: 0 },
    { lab_name: 'F', payment_update: null, overdue_amount: 0 },
  ]

  it('groups by tier worst-first and excludes unset', () => {
    const { groups, total } = buildPayments(accounts)
    expect(groups.map(g => g.tier)).toEqual(PAY_TIER_ORDER)
    expect(total).toBe(5) // F excluded
  })

  it('sorts within a tier by overdue amount desc', () => {
    const { groups } = buildPayments(accounts)
    const late = groups.find(g => g.tier === 'Late')
    expect(late.customers.map(c => c.lab_name)).toEqual(['B', 'A'])
    expect(late.overdueSum).toBe(2000)
  })

  it('sums overdue needing attention (excludes Paid)', () => {
    const { needsAttention } = buildPayments(accounts)
    expect(needsAttention).toBe(500 + 1500 + 2000) // A + B + C; Open D is 0
  })

  it('reports per-tier counts', () => {
    const { groups } = buildPayments(accounts)
    expect(groups.find(g => g.tier === 'Paid').count).toBe(1)
    expect(groups.find(g => g.tier === 'Collections').count).toBe(1)
  })
})
