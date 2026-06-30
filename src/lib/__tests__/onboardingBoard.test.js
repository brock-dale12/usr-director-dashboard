import { describe, it, expect } from 'vitest'
import { deriveJourneyStage, latestByKey, groupByStage, daysSince, ttvPill } from '../onboardingBoard.js'
import { gatingKeys, OB_STAGES } from '../onboardingCatalog.js'

describe('deriveJourneyStage', () => {
  it('sits at handoff when nothing is done', () => {
    expect(deriveJourneyStage(new Set()).stageKey).toBe(OB_STAGES[0].key)
    expect(deriveJourneyStage(new Set()).graduated).toBe(false)
  })

  it('advances past a stage once all its gating tasks are done', () => {
    const firstGates = gatingKeys(OB_STAGES[0].key)
    const stage = deriveJourneyStage(new Set(firstGates))
    // either advanced to a later stage, or graduated if the first stage had no gates
    expect(stage.stageKey).not.toBe(undefined)
    if (firstGates.length) expect(stage.stageKey === OB_STAGES[0].key).toBe(false)
  })

  it('graduates when every gating task across all stages is done', () => {
    const all = new Set(OB_STAGES.flatMap(s => gatingKeys(s.key)))
    const stage = deriveJourneyStage(all)
    expect(stage.graduated).toBe(true)
    expect(stage.stageKey).toBe('qbr')
  })
})

describe('latestByKey', () => {
  it('keeps the newest row per key', () => {
    const rows = [
      { lab_name: 'Apex', week_start: '2026-06-01', health_color: 'yellow' },
      { lab_name: 'Apex', week_start: '2026-06-22', health_color: 'green' },
      { lab_name: 'Bolt', week_start: '2026-06-15', health_color: 'red' },
    ]
    const m = latestByKey(rows, 'lab_name', 'week_start')
    expect(m.get('Apex').health_color).toBe('green')
    expect(m.get('Bolt').health_color).toBe('red')
  })
  it('skips rows with a null key', () => {
    expect(latestByKey([{ lab_name: null, week_start: '2026-06-01' }], 'lab_name', 'week_start').size).toBe(0)
  })
})

describe('groupByStage', () => {
  it('returns one column per stage plus Graduated', () => {
    const cols = groupByStage([])
    expect(cols).toHaveLength(OB_STAGES.length + 1)
    expect(cols[cols.length - 1].key).toBe('graduated')
  })
  it('routes cards to their stage column and graduates to the last', () => {
    const cards = [
      { deal_id: '1', stageKey: 'ttv', graduated: false },
      { deal_id: '2', stageKey: 'qbr', graduated: true },
      { deal_id: '3', stageKey: 'handoff', graduated: false },
    ]
    const cols = groupByStage(cards)
    const byKey = Object.fromEntries(cols.map(c => [c.key, c]))
    expect(byKey.ttv.cards.map(c => c.deal_id)).toEqual(['1'])
    expect(byKey.handoff.cards.map(c => c.deal_id)).toEqual(['3'])
    expect(byKey.graduated.cards.map(c => c.deal_id)).toEqual(['2'])
  })
})

describe('daysSince', () => {
  const now = Date.parse('2026-06-30T12:00:00Z')
  it('counts days from an anchor date', () => {
    expect(daysSince('2026-06-20', now)).toBe(10)
  })
  it('returns null for no/invalid anchor', () => {
    expect(daysSince(null, now)).toBe(null)
    expect(daysSince('not-a-date', now)).toBe(null)
  })
})

describe('ttvPill', () => {
  it('maps a passed row with its recap count', () => {
    const p = ttvPill({ status: 'passed', recaps_in_window: 6 })
    expect(p.label).toContain('✓')
    expect(p.recaps).toBe(6)
  })
  it('defaults to not_started when no row', () => {
    expect(ttvPill(null).recaps).toBe(null)
    expect(ttvPill(null).label).toBe('TTV —')
  })
})
