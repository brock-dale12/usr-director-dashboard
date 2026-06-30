import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { allJobsFreshness, overallState, STATE_META, SYNC_JOBS } from '../lib/syncFreshness'

// "Last synced" badge — the human-visible consistency signal. Reads sync_runs and
// derives per-job freshness (logic + tests live in lib/syncFreshness.js). Click to
// expand a per-job breakdown. Admin-only (only staff care whether the cron ran).
export default function SyncStatusBadge() {
  const [runs, setRuns] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let on = true
    supabase
      .from('sync_runs')
      .select('job,status,started_at,finished_at,rows_upserted,error')
      .order('started_at', { ascending: false })
      .limit(100)
      .then(({ data }) => { if (on) setRuns(data || []) }, () => { if (on) setRuns([]) })
    return () => { on = false }
  }, [])

  if (runs === null) return null // still loading — render nothing

  const verdicts = allJobsFreshness(runs, SYNC_JOBS, Date.now())
  const overall = overallState(verdicts)
  const meta = STATE_META[overall]

  const fmtAge = (h) =>
    h == null ? '—' : h < 1 ? `${Math.round(h * 60)}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`

  const dot = (color) => ({
    width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', fl: '0 0 auto',
  })

  return (
    <div style={{ position: 'relative', padding: '0 4px 8px' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Data sync status"
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: 'transparent', border: '1px solid var(--border, #2a2a2a)', borderRadius: 8,
          padding: '6px 10px', cursor: 'pointer', color: 'inherit', font: 'inherit', fontSize: 12,
        }}
      >
        <span style={dot(meta.color)} />
        <span style={{ opacity: 0.85 }}>Data sync</span>
        <span style={{ marginLeft: 'auto', color: meta.color, fontWeight: 600 }}>{meta.label}</span>
      </button>

      {open && (
        <div
          style={{
            marginTop: 6, border: '1px solid var(--border, #2a2a2a)', borderRadius: 8,
            padding: 8, background: 'var(--card, #141414)', fontSize: 11.5,
          }}
        >
          {verdicts.map(v => {
            const m = STATE_META[v.state]
            const right = v.state === 'ok' || v.state === 'stale' ? fmtAge(v.ageHours) : m.label
            return (
              <div key={v.job} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                <span style={dot(m.color)} />
                <span style={{ opacity: 0.85 }}>{v.job.replace('sync-', '')}</span>
                <span style={{ marginLeft: 'auto', color: m.color }}>{right}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
