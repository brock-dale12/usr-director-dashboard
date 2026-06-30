import { describe, it, expect } from 'vitest'
import { jobFreshness, allJobsFreshness, overallState, STALE_HOURS, SYNC_JOBS } from '../syncFreshness.js'

const NOW = Date.parse('2026-06-30T12:00:00Z')
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString()
const run = (job, status, startedHoursAgo, extra = {}) => ({
  job, status, started_at: hoursAgo(startedHoursAgo), finished_at: hoursAgo(startedHoursAgo), ...extra,
})

describe('jobFreshness', () => {
  it('is ok when the last success is recent', () => {
    const v = jobFreshness([run('sync-ttv', 'success', 2)], 'sync-ttv', NOW)
    expect(v.state).toBe('ok')
    expect(v.ageHours).toBeCloseTo(2, 5)
  })

  it('is stale when the newest success is older than the threshold', () => {
    const v = jobFreshness([run('sync-ttv', 'success', STALE_HOURS + 1)], 'sync-ttv', NOW)
    expect(v.state).toBe('stale')
  })

  it('is down when the job never succeeded', () => {
    const v = jobFreshness([run('sync-ttv', 'error', 1, { error: 'boom' })], 'sync-ttv', NOW)
    expect(v.state).toBe('down')
  })

  it('is down when there are no runs at all', () => {
    expect(jobFreshness([], 'sync-ttv', NOW).state).toBe('down')
  })

  it('flags error when a failure is newer than the last success', () => {
    const runs = [run('sync-ttv', 'success', 5), run('sync-ttv', 'error', 1, { error: 'athena 500' })]
    const v = jobFreshness(runs, 'sync-ttv', NOW)
    expect(v.state).toBe('error')
    expect(v.lastError?.error).toBe('athena 500')
    expect(v.lastSuccess).toBeTruthy() // last good data still surfaced
  })

  it('stays ok when an old failure precedes a newer success', () => {
    const runs = [run('sync-ttv', 'error', 6), run('sync-ttv', 'success', 1)]
    expect(jobFreshness(runs, 'sync-ttv', NOW).state).toBe('ok')
  })

  it('ignores other jobs runs', () => {
    const runs = [run('sync-weekly-activity', 'success', 1), run('sync-ttv', 'success', 100)]
    expect(jobFreshness(runs, 'sync-ttv', NOW).state).toBe('stale')
  })
})

describe('allJobsFreshness + overallState', () => {
  it('reports every expected job, surfacing missing ones as down', () => {
    const runs = [run('sync-hubspot-deals', 'success', 1)]
    const verdicts = allJobsFreshness(runs, SYNC_JOBS, NOW)
    expect(verdicts).toHaveLength(SYNC_JOBS.length)
    expect(verdicts.find(v => v.job === 'sync-ttv').state).toBe('down')
  })

  it('rolls up to the worst state', () => {
    const verdicts = [{ state: 'ok' }, { state: 'stale' }, { state: 'ok' }]
    expect(overallState(verdicts)).toBe('stale')
    expect(overallState([{ state: 'ok' }, { state: 'error' }])).toBe('error')
    expect(overallState([{ state: 'ok' }, { state: 'ok' }])).toBe('ok')
  })
})
