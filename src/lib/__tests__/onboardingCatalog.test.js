import { describe, it, expect } from 'vitest'
import {
  OB_STAGES,
  OB_INDEX,
  TTV_TARGET,
  TTV_WINDOW_DAYS,
  gatingKeys,
  kickoffComplete,
  KICKOFF_GATING,
  transitionVariant,
  fillTokens,
  EDU_WEEK1,
} from '../onboardingCatalog.js'

// ─────────────────────────────────────────────────────────────────────────────
// Canonical onboarding model — locked in code.
// These assertions ARE the contract from docs/ONBOARDING-DASHBOARD-PLAN.md §2.
// If a refactor changes the journey, this test must change deliberately.
// ─────────────────────────────────────────────────────────────────────────────
describe('canonical 8-stage journey (OB_STAGES)', () => {
  const EXPECTED_KEYS = ['handoff', 'kickoff', 'ttv', 'impl', 'checkin30', 'day3060', 'day6090', 'qbr']

  it('has exactly 8 stages in the documented order', () => {
    expect(OB_STAGES.map(s => s.key)).toEqual(EXPECTED_KEYS)
  })

  it('opens each stage on the documented day-of-90', () => {
    const days = Object.fromEntries(OB_STAGES.map(s => [s.key, s.d0]))
    expect(days).toMatchObject({
      handoff: 0, kickoff: 1, ttv: 3, impl: 10, checkin30: 14, day3060: 30, day6090: 60, qbr: 90,
    })
  })

  it('OB_INDEX maps every stage key to its position', () => {
    EXPECTED_KEYS.forEach((k, i) => expect(OB_INDEX[k]).toBe(i))
  })
})

describe('TTV constants (the spine: 5 recaps in a 7-day window)', () => {
  it('targets 5 session recaps', () => expect(TTV_TARGET).toBe(5))
  it('uses a 7-day window', () => expect(TTV_WINDOW_DAYS).toBe(7))
})

describe('gatingKeys', () => {
  it('returns only non-recurring task keys for a stage', () => {
    const keys = gatingKeys('kickoff')
    expect(Array.isArray(keys)).toBe(true)
    // gating keys feed KICKOFF_GATING, which deriveStage uses to advance.
    expect(keys).toEqual(KICKOFF_GATING)
  })

  it('returns an empty array for an unknown stage', () => {
    expect(gatingKeys('not-a-stage')).toEqual([])
  })
})

describe('kickoffComplete', () => {
  it('is false when no kickoff gating tasks are done', () => {
    expect(kickoffComplete(new Set())).toBe(false)
  })

  it('is true once every kickoff gating task is done', () => {
    expect(kickoffComplete(new Set(KICKOFF_GATING))).toBe(true)
  })
})

describe('transitionVariant (week-over-week activity color → email variant)', () => {
  it('celebrates a sustained green', () => {
    expect(transitionVariant('green', 'green')).toBe('green_streak')
  })
  it('celebrates a recovery into green', () => {
    expect(transitionVariant('red', 'green')).toBe('yellow_green')
  })
  it('nudges on a green→yellow dip', () => {
    expect(transitionVariant('green', 'yellow')).toBe('green_yellow')
  })
  it('escalates a slide into red', () => {
    expect(transitionVariant('orange', 'red')).toBe('orange_red')
  })
  it('falls back sensibly for an unseen pair', () => {
    expect(transitionVariant(null, null)).toBe('yellow_yellow')
  })
})

describe('fillTokens', () => {
  it('replaces known tokens from context', () => {
    const out = fillTokens('Hi {owner}, {lab} is at day {day}.', { owner: 'Sam', lab: 'Apex', day: 12 })
    expect(out).toBe('Hi Sam, Apex is at day 12.')
  })
  it('uses friendly fallbacks for missing tokens', () => {
    expect(fillTokens('Hi {owner} at {lab}')).toBe('Hi there at your team')
  })
  it('defaults {edu_link} to the week-1 education URL', () => {
    expect(fillTokens('{edu_link}')).toBe(EDU_WEEK1)
  })
  it('returns empty string for empty input', () => {
    expect(fillTokens('')).toBe('')
    expect(fillTokens(undefined)).toBe('')
  })
})
