import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/fetchAll'
import { deriveJourneyStage, latestByKey, groupByStage, daysSince, ttvPill } from '../lib/onboardingBoard'
import { ExternalLink } from 'lucide-react'

// The onboarding HubSpot cohort the board shows (first-90-days lifecycle).
const COHORT_STAGES = ['On Deck', 'Level Set', 'First 30 Days', 'First 90 Days']
const HEALTH_COLORS = { green: '#1DB271', yellow: '#FFD900', orange: '#F2810E', red: '#EC3642' }
// Set your HubSpot portal id (or VITE_HUBSPOT_PORTAL_ID) to enable deep links to deals.
const PORTAL = import.meta.env.VITE_HUBSPOT_PORTAL_ID || ''
const dealUrl = (id) => (PORTAL ? `https://app.hubspot.com/contacts/${PORTAL}/record/0-3/${id}` : null)

function HealthDot({ color }) {
  const c = HEALTH_COLORS[color] || '#C9CBCE'
  return <span title={color || 'no data'} style={{ width: 9, height: 9, borderRadius: '50%', background: c, display: 'inline-block', flex: '0 0 auto' }} />
}

function Card({ c }) {
  const pill = ttvPill(c.ttv)
  const url = dealUrl(c.deal_id)
  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3 mb-2">
      <div className="flex items-center gap-2">
        <HealthDot color={c.healthColor} />
        <span className="font-medium text-slate-100 text-sm truncate" title={c.lab_name}>{c.lab_name}</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="ml-auto text-slate-400 hover:text-usr-pink" title="Open deal in HubSpot">
            <ExternalLink size={13} />
          </a>
        )}
      </div>
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ color: pill.color, border: `1px solid ${pill.color}55` }}>
          {pill.label}{pill.recaps != null ? ` ${pill.recaps}/5` : ''}
        </span>
        {c.daysIn != null && <span className="text-[11px] text-slate-400">day {c.daysIn}</span>}
        {c.speed_lab_director && <span className="text-[11px] text-slate-500 truncate">· {c.speed_lab_director}</span>}
      </div>
    </div>
  )
}

export default function OnboardingBoard() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [health, setHealth] = useState('all')
  const [q, setQ] = useState('')

  useEffect(() => {
    let on = true
    ;(async () => {
      try {
        const [labs, prog, ttv, weekly, cs] = await Promise.all([
          supabase.from('lab_accounts').select('deal_id,lab_name,deal_stage_label,speed_lab_director,contract_start_date,is_active'),
          supabase.from('onboarding_progress').select('deal_id,action_key'),
          supabase.from('onboarding_ttv').select('deal_id,status,recaps_in_window,days_to_five'),
          fetchAllRows('weekly_health_snapshots', 'lab_name,week_start,health_color,days_since_activity'),
          supabase.from('onboarding_cs').select('deal_id,kickoff_date'),
        ])
        if (labs.error) throw labs.error
        // doneSet per deal
        const done = new Map()
        for (const r of prog.data || []) {
          const s = done.get(r.deal_id) || new Set(); s.add(r.action_key); done.set(r.deal_id, s)
        }
        const ttvByDeal = new Map((ttv.data || []).map(r => [r.deal_id, r]))
        const kickoffByDeal = new Map((cs.data || []).map(r => [r.deal_id, r.kickoff_date]))
        const healthByLab = latestByKey(weekly || [], 'lab_name', 'week_start')

        const cards = (labs.data || [])
          .filter(l => (l.is_active ?? true) && COHORT_STAGES.includes(l.deal_stage_label))
          .map(l => {
            const doneSet = done.get(l.deal_id) || new Set()
            const { stageKey, graduated } = deriveJourneyStage(doneSet)
            const anchor = kickoffByDeal.get(l.deal_id) || l.contract_start_date
            return {
              ...l,
              stageKey, graduated,
              ttv: ttvByDeal.get(l.deal_id) || null,
              healthColor: healthByLab.get(l.lab_name)?.health_color || null,
              daysIn: daysSince(anchor),
            }
          })
        if (on) setRows(cards)
      } catch (e) {
        if (on) setErr(String(e.message || e))
      }
    })()
    return () => { on = false }
  }, [])

  const columns = useMemo(() => {
    if (!rows) return []
    const filtered = rows.filter(c =>
      (health === 'all' || c.healthColor === health) &&
      (!q || c.lab_name?.toLowerCase().includes(q.toLowerCase())))
    return groupByStage(filtered)
  }, [rows, health, q])

  const total = rows?.length ?? 0

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h1 className="text-xl font-bold text-slate-100">Onboarding Pipeline</h1>
        <span className="text-sm text-slate-400">{total} in first-90-days</span>
        <input
          value={q} onChange={e => setQ(e.target.value)} placeholder="Search lab…"
          className="ml-auto bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
        />
        <select value={health} onChange={e => setHealth(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200">
          <option value="all">All health</option>
          <option value="green">🟢 Green</option>
          <option value="yellow">🟡 Yellow</option>
          <option value="orange">🟠 Orange</option>
          <option value="red">🔴 Red</option>
        </select>
      </div>

      {err && <div className="text-red-400 text-sm mb-3">Couldn’t load board: {err}</div>}
      {rows === null && !err && <div className="text-slate-400 text-sm">Loading…</div>}

      {rows && (
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ scrollbarWidth: 'thin' }}>
          {columns.map(col => (
            <div key={col.key} className="flex-shrink-0 w-64">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">{col.label}</span>
                <span className="text-xs text-slate-500">{col.cards.length}</span>
              </div>
              <div className="rounded-lg bg-slate-900/40 p-2 min-h-[60px]">
                {col.cards.map(c => <Card key={c.deal_id} c={c} />)}
                {!col.cards.length && <div className="text-[11px] text-slate-600 px-1 py-2">—</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
