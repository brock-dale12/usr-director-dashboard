import { useState, useEffect, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { daysSince, last8Weeks } from '../lib/metrics'
import WeeklyMatrix from '../components/WeeklyMatrix'
import CustomerDetail from '../components/CustomerDetail'
import { HS_PUSHABLE, pushToHubspot, upsertCs, loadHubspotMeta, loadHubspotNotes, addHubspotNote } from '../lib/customerActions'
import {
  ArrowLeft, ChevronDown, Plus, Send, Loader2,
  TrendingUp, TrendingDown, Minus, Bell, CheckCircle,
  Mail, Phone, Calendar, Cpu, Users, Building2,
  Zap, Activity, MessageSquare, MapPin,
} from 'lucide-react'

const EMPTY_SET = new Set()

// ─── Status color maps ────────────────────────────────────────────────────────
const STATUS_COLORS = { green: '#1DB271', yellow: '#FFD900', orange: '#F2810E', red: '#EC3642', unknown: '#ccc' }
const STATUS_LABELS  = { green: 'Active',  yellow: 'Fading',  orange: 'At Risk', red: 'Inactive', unknown: 'Unknown' }

// ─── Sparkline SVG (collapsed row — score trend line) ─────────────────────────
function Spark({ values, color = '#EC3642' }) {
  if (!values || values.length < 2) return null
  const w = 100, h = 34, max = 4, min = 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 4) + 2
    const y = h - 3 - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (h - 6)
    return [x, y]
  })
  const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg className="lab-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%' }}>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    </svg>
  )
}

// ─── Health trend area chart (expanded panel) ─────────────────────────────────
// Uses numeric values 1-4 (color rank) as Y axis
function HealthTrendChart({ history }) {
  // Build color-rank values for last 6 months from weekly snapshots
  const COLOR_RANK = { green: 4, yellow: 3, orange: 2, red: 1, unknown: 1 }
  const MONTH_LABELS = ['6mo', '5mo', '4mo', '3mo', '2mo', 'Now']

  // Bucket history into 6 monthly slots (oldest→newest)
  const now = new Date()
  const slots = Array.from({ length: 6 }, (_, i) => {
    const mo = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const moStr = mo.toISOString().slice(0, 7)
    const weeksInMonth = history.filter(s => s.week_start && s.week_start.startsWith(moStr))
    if (!weeksInMonth.length) return null
    const avg = weeksInMonth.reduce((a, s) => a + (COLOR_RANK[s.health_color] ?? 1), 0) / weeksInMonth.length
    return avg
  })

  const hasData = slots.some(v => v !== null)
  if (!hasData) {
    return (
      <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--fg-subtle)', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Builds after 2+ months
        </span>
      </div>
    )
  }

  const filled = slots.map((v, i) => v ?? (i > 0 ? slots.slice(0, i).reverse().find(x => x !== null) ?? 1 : 1))
  const w = 300, h = 96
  const pts = filled.map((v, i) => {
    const x = (i / (filled.length - 1)) * (w - 8) + 4
    const y = h - 8 - ((v - 1) / 3) * (h - 20)
    return [x, y]
  })
  const line = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = line + ` L ${pts[pts.length-1][0].toFixed(1)} ${h} L ${pts[0][0].toFixed(1)} ${h} Z`
  const lastColor = STATUS_COLORS[history.length > 0 ? (history[0]?.health_color ?? 'unknown') : 'unknown']

  return (
    <div className="trend-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 96, display: 'block' }}>
        <defs>
          <linearGradient id="trend-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lastColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={lastColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#trend-grad)" />
        <path d={line} fill="none" stroke={lastColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3.5 : 2}
            fill={i === pts.length - 1 ? lastColor : '#fff'} stroke={lastColor} strokeWidth="1.5" />
        ))}
      </svg>
      <div className="trend-foot">
        {MONTH_LABELS.map((m, i) => <span key={i}>{m}</span>)}
      </div>
    </div>
  )
}

// ─── Note logger ──────────────────────────────────────────────────────────────
function NoteLogger({ viewingId, labName, onSaved }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!text.trim()) return
    setSaving(true)
    await supabase.from('action_log').insert({
      director_id: viewingId,
      lab_name:    labName,
      action_type: 'note',
      notes:       text.trim(),
    })
    setSaving(false)
    setText('')
    setOpen(false)
    onSaved?.()
  }

  if (!open) return (
    <button className="note-logger-btn" onClick={() => setOpen(true)}>
      <Plus size={11} />
      Log a note
    </button>
  )

  return (
    <div style={{ marginTop: 12 }}>
      <textarea
        autoFocus
        rows={3}
        placeholder="e.g. Called Alex — they're running assessments next week."
        value={text}
        onChange={e => setText(e.target.value)}
        style={{
          width: '100%',
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          color: 'var(--usr-black)',
          background: 'var(--usr-white)',
          border: '1px solid var(--border-strong)',
          borderRadius: 4,
          padding: '10px 12px',
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button className="btn btn-ghost" style={{ padding: '6px 12px' }} onClick={() => { setOpen(false); setText('') }}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          style={{ padding: '7px 14px', fontSize: 12 }}
          onClick={save}
          disabled={!text.trim() || saving}
        >
          {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={12} />}
          Save
        </button>
      </div>
    </div>
  )
}

// ─── Comms log ────────────────────────────────────────────────────────────────
function CommsLog({ logs, loading }) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', color: 'var(--fg-subtle)', fontSize: 13 }}>
      <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading...
    </div>
  )
  if (!logs.length) return (
    <p style={{ fontSize: 13, color: 'var(--fg-subtle)', paddingTop: 4 }}>No communications logged yet.</p>
  )
  return (
    <div>
      {logs.map(log => (
        <div key={log.id} className="comms-log-entry">
          <div className="comms-log-dot" />
          <div>
            <div className="comms-log-text">
              {log.action_type === 'email_sent' ? `Email sent: "${log.notes}"` : log.notes}
            </div>
            <div className="comms-log-meta">
              {new Date(log.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              <span className={`comms-tag ${log.action_type === 'email_sent' ? 'sent' : 'note'}`}>
                {log.action_type === 'email_sent' ? 'sent' : 'note'}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Stage badge (for new labs) ───────────────────────────────────────────────
function StageBadge({ stage }) {
  const cls = stage === 'On Deck' ? 'on-deck' : stage === 'First 30 Days' ? 'first-30' : ''
  return <span className={`stage-badge ${cls}`}>{stage}</span>
}

// ─── Weekly Activity Grid ─────────────────────────────────────────────────────
// 8-week × 4-row color grid: Activity | Logins | Data Pts | New PRs
const ST = {
  green:   'var(--st-green)',
  yellow:  'var(--st-yellow)',
  orange:  'var(--st-orange)',
  red:     'var(--st-red)',
  none:    'var(--usr-ghost)',
}

function streakColor(arr, idx) {
  // Count consecutive zeros/nulls ending at idx (going left, inclusive)
  let streak = 0
  for (let i = idx; i >= 0; i--) {
    const v = arr[i]
    if (v === 0 || v == null) streak++
    else break
  }
  if (streak >= 8) return 'red'
  if (streak >= 5) return 'orange'
  return 'yellow'
}

function cellColor(arr, idx) {
  const v = arr[idx]
  if (v == null)  return 'none'
  if (v > 0)      return 'green'
  return streakColor(arr, idx)
}

function txtColor(c) {
  if (c === 'yellow') return '#1a1a1a'   // black on yellow — readable
  if (c === 'none')   return 'transparent'
  return '#ffffff'                        // white on green / orange / red
}

function ActivityGrid({ last8 }) {
  // last8 oldest→newest (up to 8 weekly_health_snapshot rows)
  const slots   = Array.from({ length: 8 }, (_, i) => last8[i] || null)
  const logins  = slots.map(w => w?.logins_week        ?? null)
  const dpts    = slots.map(w => w?.data_pts_week      ?? null)
  const athletes= slots.map(w => w?.athletes_added_week ?? null)
  const prs     = slots.map(w => w?.prs_week           ?? null)

  // Footer stats
  const filledSlots   = slots.filter(Boolean).length
  const activeWeeks   = slots.filter(w => w?.health_color === 'green').length

  let wksSinceActive = 0
  for (let i = 7; i >= 0; i--) {
    if (slots[i] && slots[i].health_color !== 'green') wksSinceActive++
    else break
  }

  const ROWS = [
    { label: 'ACTIVITY', cells: slots.map(w =>
        w ? { val: null, color: w.health_color || 'none' } : { val: null, color: 'none' }
    )},
    { label: 'LOGINS',   cells: logins.map((v, i)   => ({ val: v, color: cellColor(logins,   i) })) },
    { label: 'DATA PTS', cells: dpts.map((v, i)     => ({ val: v, color: cellColor(dpts,     i) })) },
    { label: 'ATHLETES', cells: athletes.map((v, i) => ({ val: v, color: cellColor(athletes, i) })) },
    { label: 'NEW PRS',  cells: prs.map((v, i)      => ({ val: v, color: cellColor(prs,      i) })) },
  ]

  return (
    <div className="ag-wrap">
      {/* Column headers */}
      <div className="ag-header">
        <div className="ag-row-lbl" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="ag-col-h">
            {i === 0 ? '8W' : i === 7 ? 'NOW' : ''}
          </div>
        ))}
      </div>

      {/* Data rows */}
      {ROWS.map(row => (
        <div key={row.label} className="ag-row">
          <div className="ag-row-lbl">{row.label}</div>
          {row.cells.map((cell, i) => (
            <div
              key={i}
              className={`ag-cell ${row.label === 'ACTIVITY' ? 'ag-act' : ''}`}
              style={{
                background: ST[cell.color] || ST.none,
                color:      txtColor(cell.color),
              }}
            >
              {cell.val !== null && cell.val !== undefined ? cell.val : ''}
            </div>
          ))}
        </div>
      ))}

      {/* Footer */}
      <div className="ag-foot">
        <div className="ag-stat">
          <span className="ag-stat-v" style={{ color: 'var(--st-green)' }}>
            {activeWeeks}/{filledSlots || 8}
          </span>
          <span className="ag-stat-l">ACTIVE WEEKS</span>
        </div>
        <div className="ag-stat">
          <span className="ag-stat-v">{wksSinceActive}</span>
          <span className="ag-stat-l">WKS SINCE ACTIVE</span>
        </div>
      </div>
    </div>
  )
}

// ─── Individual lab card ──────────────────────────────────────────────────────
// `account` (optional): pass a pre-loaded lab_accounts row to skip the per-card
// fetch (used by My Customers, which bulk-loads accounts and includes non-Speed-
// Lab customers that have no lab_name). `hideNotes`: hide the director-scoped
// note logger / comms log (owner-filtered views aren't director-scoped).
export function LabCard({ snap, allHistory, viewingId, stage, score = null, account: accountProp = undefined, hideNotes = false, onDraftEmail = null, comms = [] }) {
  const { director } = useAuth()
  const [expanded, setExpanded]         = useState(false)
  const [logs, setLogs]                 = useState([])
  const [loadingLogs, setLoadingLogs]   = useState(false)
  const [monthlySnaps, setMonthlySnaps] = useState([])
  const [account, setAccount]           = useState(accountProp ?? null)
  const [cs, setCs]                     = useState(null)        // onboarding_cs row for this deal
  const [savingCs, setSavingCs]         = useState(false)
  const [savingDeal, setSavingDeal]     = useState(false)
  const [hsPush, setHsPush]             = useState(null)        // 'pushing' | 'ok' | error string

  const actorName = director?.name || director?.email || null

  const color  = snap.health_color ?? 'unknown'
  const sColor = STATUS_COLORS[color] ?? '#ccc'

  // Lab's full history oldest→newest
  const labHistory = allHistory
    .filter(s => s.lab_name === snap.lab_name)
    .sort((a, b) => a.week_start.localeCompare(b.week_start))

  // Last 8 weeks for the bar chart
  const last8 = labHistory.slice(-8)
  const maxActivity = Math.max(...last8.map(w => 1), 1)  // placeholder; will use real counts later

  // Sparkline values (color rank 1-4) for collapsed row
  const sparkValues = labHistory.slice(-12).map(s => ({
    green: 4, yellow: 3, orange: 2, red: 1, unknown: 1
  }[s.health_color] ?? 1))

  // Monthly score (0-9). Prefer the score loaded with the region (shows on the
  // collapsed card immediately); fall back to the expanded monthly fetch.
  const latestMonthlyScore = score != null
    ? score
    : (monthlySnaps.length > 0
        ? (monthlySnaps[monthlySnaps.length - 1].health_score ?? null)
        : null)

  // Score label: most recent month
  const scoreMonthLabel = (() => {
    if (monthlySnaps.length > 0) {
      const last = monthlySnaps[monthlySnaps.length - 1]
      return new Date(last.month + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    }
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() - 1, 1)
      .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  })()

  const activityLabel = snap.days_since_activity != null
    ? snap.days_since_activity === 0 ? 'Active today'
    : `${snap.days_since_activity}d inactive`
    : 'No record'

  // Hero = the customer's deal/company name; the USR-DB organization it resolves
  // to sits beneath it (smaller), with a link-quality flag so a wrong or missing
  // match — the main source of bad activity/health numbers — is visible at a glance.
  // org_id is stamped on the snapshot today; org_name + org_match_kind arrive with
  // the Phase-1 migration and light up the verified/fuzzy badges.
  const heroName = account?.company_name || snap.lab_name || account?.lab_name || '(unnamed customer)'
  const orgName  = account?.org_name || null
  const orgId    = account?.org_id ?? snap.org_id ?? null
  const orgMatch = account?.org_match_kind || (orgId ? 'linked' : 'none')

  const loadLogs = useCallback(async () => {
    if (hideNotes || !viewingId || !snap.lab_name) { setLogs([]); return }
    setLoadingLogs(true)
    const { data } = await supabase
      .from('action_log').select('*')
      .eq('director_id', viewingId).eq('lab_name', snap.lab_name)
      .order('logged_at', { ascending: false }).limit(20)
    setLogs(data || [])
    setLoadingLogs(false)
  }, [viewingId, snap.lab_name, hideNotes])

  const loadMonthlySnaps = useCallback(async () => {
    if (!snap.lab_name) { setMonthlySnaps([]); return }
    const { data } = await supabase
      .from('monthly_health_snapshots')
      .select('month, dominant_color, green_weeks, yellow_weeks, orange_weeks, red_weeks, health_score, login_sub_score, athletes_sub_score, assessments_sub_score')
      .eq('lab_name', snap.lab_name)
      .order('month', { ascending: true }).limit(12)
    setMonthlySnaps(data || [])
  }, [snap.lab_name])

  const loadAccount = useCallback(async () => {
    let base = accountProp
    if (base === undefined) {
      if (!snap.lab_name) { setAccount(null); return }
      const { data } = await supabase
        .from('lab_accounts')
        .select('*')
        .eq('lab_name', snap.lab_name)
        .maybeSingle()
      base = data || null
    }
    if (!base) { setAccount(null); return }
    // CANON (lib/metrics.js): CS dashboard edits (onboarding_cs) override the
    // HubSpot-synced values everywhere, not just on the Onboarding page.
    try {
      const { data: csRow } = base.deal_id
        ? await supabase.from('onboarding_cs').select('*').eq('deal_id', base.deal_id).maybeSingle()
        : { data: null }
      setCs(csRow || null)
      setAccount({
        ...base,
        contact_name:       csRow?.contact_name ?? base.contact_name,
        contact_email:      csRow?.contact_email ?? base.contact_email,
        contact_phone:      csRow?.contact_phone ?? base.contact_phone,
        speed_lab_director: csRow?.speed_lab_director ?? base.speed_lab_director,
        kickoff_date:       csRow?.kickoff_date ?? null,
      })
      return
    } catch { /* fall through to unmerged */ }
    setCs(null)
    setAccount(base)
  }, [snap.lab_name, accountProp])

  useEffect(() => {
    if (expanded) { loadLogs(); loadMonthlySnaps(); loadAccount() }
  }, [expanded, loadLogs, loadMonthlySnaps, loadAccount])

  // ── Shared CustomerDetail wiring (post-onboarding view) ─────────────────────
  // Re-query just this card's account (after a HubSpot writeback), preserving the
  // onboarding_cs merge. Mirrors loadAccount but always hits lab_accounts by deal.
  const refetchAccount = useCallback(async () => {
    const dealId = account?.deal_id
    if (!dealId) return
    const { data: base } = await supabase.from('lab_accounts').select('*').eq('deal_id', dealId).maybeSingle()
    if (!base) return
    try {
      const { data: csRow } = await supabase.from('onboarding_cs').select('*').eq('deal_id', dealId).maybeSingle()
      setCs(csRow || null)
      setAccount({
        ...base,
        contact_name:       csRow?.contact_name ?? base.contact_name,
        contact_email:      csRow?.contact_email ?? base.contact_email,
        contact_phone:      csRow?.contact_phone ?? base.contact_phone,
        speed_lab_director: csRow?.speed_lab_director ?? base.speed_lab_director,
        kickoff_date:       csRow?.kickoff_date ?? null,
      })
    } catch { setAccount(base) }
  }, [account?.deal_id])

  // Save CS edits (contact/director/notes) — internal upsert + real-time HubSpot
  // push for HS-owned fields. Faithful to Onboarding's saveCs, scoped to this card.
  const onSaveCs = async (patch, events = []) => {
    const dealId = account?.deal_id
    if (!dealId) return
    setSavingCs(true)
    try {
      await upsertCs(dealId, patch, events, actorName)
      setCs(prev => ({ ...(prev || { deal_id: dealId }), ...patch, updated_by: actorName, updated_at: new Date().toISOString() }))
    } catch (e) {
      console.error('onboarding_cs save failed', e)
      alert('Save failed — run the 2026-06-12 onboarding execution migration in Supabase, then retry.')
      setSavingCs(false)
      return
    }
    setSavingCs(false)
    const changes = {}
    HS_PUSHABLE.forEach(k => { if (k in patch) changes[k] = patch[k] })
    if (!Object.keys(changes).length) return
    setHsPush('pushing')
    try {
      const res = await pushToHubspot(dealId, changes)
      if (res.ok) { setHsPush('ok'); await refetchAccount() }
      else setHsPush(res.error || `HTTP ${res.status}`)
    } catch (e) { setHsPush(String(e.message || e)) }
  }

  // Deal-property edits push straight to the HubSpot deal, then refetch this card.
  const onSaveDeal = async (changes) => {
    const dealId = account?.deal_id
    if (!dealId || !changes || !Object.keys(changes).length) return
    setSavingDeal(true)
    try {
      const res = await pushToHubspot(dealId, changes)
      if (res.ok) await refetchAccount()
      else alert(`HubSpot update failed: ${res.error || `HTTP ${res.status}`}`)
    } catch (e) { alert(`HubSpot update failed: ${String(e.message || e)}`) }
    setSavingDeal(false)
  }

  // This customer's weekly snapshots (oldest→newest) → Monthly Health Trend area.
  const cWeeks = last8Weeks(last8)
  // Build the universal customer object the shared drawer expects. Onboarding-only
  // fields are inert here (isOnboarding=false hides the journey + TTV sections).
  const customerDetail = account && {
    name: heroName,
    city: account.company_city, state: account.company_state,
    dealId: account.deal_id,
    contactName: account.contact_name,
    email: account.contact_email,
    phone: account.contact_phone,
    director: account.speed_lab_director || account.director_name || null,
    owner: account.deal_owner_name, ownerEmail: account.deal_owner_email,
    hubspotStage: account.deal_stage_label,
    healthColor: snap.health_color || 'unknown',
    healthScore: latestMonthlyScore,
    healthHistory: labHistory,
    weeks: cWeeks,
    athletes: last8.length ? (last8[last8.length - 1].athletes_added_week ?? null) : null,
    logins: last8.length ? (last8[last8.length - 1].logins_week ?? null) : null,
    datapoints: last8.length ? (last8[last8.length - 1].data_pts_week ?? null) : null,
    prs: cWeeks.reduce((sum, w) => sum + (w.prs || 0), 0) || null,
    // Deal properties (read by DealProperties) — same internal-name mapping as Onboarding.
    amount: account.amount ?? null,
    arr: account.amount ?? account.arr_amount ?? null,
    contractEnd: account.renewal_date || null,
    contractStart: account.contract_start_date || null,
    contractYear: account.contract_year || null,
    yearsAsSpeedLab: account.years_as_a_speed_lab || null,
    renewalStatus: account.renewal_status || null,
    churnRisk: account.churn_risk || null,
    speedLabLevel: account.speed_lab_level || null,
    speedLabStatus: account.speed_lab_status || null,
    paymentStatus: account.payment_update || null,
    paymentDate: account.payment_status || null,
    paymentProcessor: account.payment_processor || null,
    overdueAmount: account.overdue_amount ?? null,
    onboardingCohort: account.onboarding_cohort || null,
    removedAccess: account.removed_access_from_usr || null,
    dealStageId: account.deal_stage || null,
    product: account.product || null,
    segment: account.customer_segment || null,
    hardware: account.hardware || null,
    // Base (HubSpot-synced) values, for the editor's diff + event log.
    baseContactName: account.contact_name, baseEmail: account.contact_email,
    basePhone: account.contact_phone, baseDirector: account.speed_lab_director || account.director_name || null,
    cs,
    // Onboarding-only fields — inert when isOnboarding=false.
    graduated: true, stageKey: 'qbr', doneSet: EMPTY_SET, ttvSynced: null,
  }

  return (
    <div className={`lab-card ${expanded ? 'open' : ''}`}>

      {/* ── Collapsed row ──────────────────────────────────────────────────── */}
      <div className="lab-row" onClick={() => setExpanded(v => !v)}>

        {/* Status dot */}
        <span
          className={`status-dot ${color} ${color !== 'green' ? 'ring' : ''}`}
          style={{ color: sColor }}
        />

        {/* Customer (deal) name = hero · USR org + link quality beneath · activity */}
        <div className="lab-id">
          <div className="lab-name-row">
            <span className="lab-name">{heroName}</span>
            {stage && <StageBadge stage={stage} />}
          </div>
          <div className="lab-org">
            {orgId || orgName ? (
              <>
                <span className="lab-org-name">USR org: {orgName || `#${orgId}`}</span>
                {orgMatch === 'fuzzy' && <span className="lab-org-flag warn" title="Matched to a USR organization by name — verify it's the right org">⚠ fuzzy</span>}
                {orgMatch === 'exact' && <span className="lab-org-flag ok" title="Verified link via HubSpot company ID">✓ verified</span>}
              </>
            ) : (
              <span className="lab-org-flag bad" title="No USR organization linked — weekly activity & health can't be computed for this customer">✗ not linked to USR org</span>
            )}
          </div>
          <div className="lab-loc">{activityLabel}</div>
        </div>

        {/* Status pill */}
        <div>
          <span className={`lab-status-pill ${color}`}>
            <span className="status-dot" style={{ width: 8, height: 8, background: sColor }} />
            {STATUS_LABELS[color]}
          </span>
        </div>

        {/* Score */}
        <div className="lab-score">
          <span className="v" style={{ color: latestMonthlyScore != null ? sColor : 'var(--fg-subtle)' }}>
            {latestMonthlyScore !== null ? latestMonthlyScore : '—'}
          </span>
          <span className="m">/9</span>
        </div>

        {/* Sparkline */}
        <div style={{ width: 110 }}>
          {sparkValues.length >= 2
            ? <Spark values={sparkValues} color={sColor} />
            : <span className="lab-activity-text">no data yet</span>
          }
        </div>

        {/* Chevron */}
        <div className={`lab-chev ${expanded ? 'open' : ''}`}>
          <ChevronDown size={22} />
        </div>
      </div>

      {/* ── Expanded panel — the ONE shared customer drawer ────────────────── */}
      {expanded && (
        account == null ? (
          <div className="lab-detail">
            <div className="detail-block" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg-subtle)', fontSize: 13 }}>
              <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
            </div>
          </div>
        ) : (
          <>
            <CustomerDetail
              isOnboarding={false}
              c={customerDetail}
              onSaveCs={onSaveCs}
              savingCs={savingCs}
              hsPushState={hsPush}
              onSaveDeal={onSaveDeal}
              savingDeal={savingDeal}
              loadMeta={loadHubspotMeta}
              loadNotes={loadHubspotNotes}
              addNote={addHubspotNote}
            />

            {/* Director-scoped activity log — note logger + comms (drawer doesn't carry this) */}
            <div className="lab-detail">
              <div className="detail-block" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <h4 style={{ margin: 0 }}><MessageSquare size={14} />Outstanding Actions &amp; Communications</h4>
                  {!hideNotes && <NoteLogger viewingId={viewingId} labName={snap.lab_name} onSaved={loadLogs} />}
                </div>

                {onDraftEmail && (
                  <div style={{ marginBottom: 14 }}>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '8px 14px', fontSize: 12 }}
                      disabled={!account?.contact_email}
                      onClick={e => { e.stopPropagation(); onDraftEmail(account) }}
                    >
                      <Mail size={13} /> Draft email
                    </button>
                    {!account?.contact_email && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--fg-subtle)' }}>
                        no contact email on file
                      </span>
                    )}
                  </div>
                )}

                {onDraftEmail && comms.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div className="contact-label">Recent comms · {comms.length}</div>
                    {comms.slice(0, 6).map(cm => (
                      <div className="contact-row" key={cm.id} style={{ borderBottom: 0 }}>
                        <Mail size={14} style={{ color: 'var(--fg-subtle)', flexShrink: 0 }} />
                        <span className="ct">
                          {cm.subject || '(no subject)'}
                          <span style={{ color: 'var(--fg-subtle)' }}>
                            {' · '}{new Date(cm.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            {cm.logged_by ? ` · ${String(cm.logged_by).split('@')[0]}` : ''}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="no-actions">
                  <CheckCircle size={16} />
                  No pending messages — all up to date.
                </div>

                {logs.length > 0 && (
                  <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-muted)', marginBottom: 10 }}>
                      Log
                    </div>
                    <CommsLog logs={logs} loading={loadingLogs} />
                  </div>
                )}
                {logs.length === 0 && !loadingLogs && (
                  <div style={{ marginTop: 12 }}>
                    <CommsLog logs={[]} loading={false} />
                  </div>
                )}
              </div>
            </div>
          </>
        )
      )}
    </div>
  )
}

// ─── New Labs collapsible section ─────────────────────────────────────────────
const NEW_STAGES = new Set(['On Deck', 'First 30 Days'])

function NewLabsSection({ sortedSnaps, stageMap, allHistory, viewingId, scoreMap = {} }) {
  const [open, setOpen] = useState(true)

  const newSnaps = sortedSnaps.filter(s => NEW_STAGES.has(stageMap[s.lab_name]))
  if (newSnaps.length === 0) return null

  return (
    <div className="section">
      <div className="collapsible spotlight">
        <div className="collapse-head" onClick={() => setOpen(v => !v)}>
          <div className="collapse-badge">{newSnaps.length}</div>
          <div>
            <div className="collapse-title">New Speed Labs This Month</div>
            <div className="collapse-sub">
              {newSnaps.length} lab{newSnaps.length !== 1 ? 's' : ''} joining your region — get them onboarded fast
            </div>
          </div>
          <div className={`collapse-chev ${open ? 'open' : ''}`}>
            <ChevronDown size={22} />
          </div>
        </div>

        {open && (
          <div className="collapse-body">
            {newSnaps.map(snap => (
              <LabCard
                key={snap.id}
                snap={snap}
                allHistory={allHistory}
                viewingId={viewingId}
                stage={stageMap[snap.lab_name]}
                score={scoreMap[snap.lab_name] ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Hero metric card 1: Avg health score (ring gauge) ────────────────────────
export function HeroScore({ avgScore, delta, totalLabs, scopeLabel = 'labs in your region' }) {
  const circ = 2 * Math.PI * 52
  const ringPct = avgScore != null ? Math.max(0, Math.min(1, avgScore / 9)) : 0

  return (
    <div className="hero-card">
      <div className="hero-head">
        <span className="hero-label">Avg. Monthly Health Score</span>
        {delta !== null ? (
          <span className={`hero-delta ${delta >= 0 ? 'up' : 'down'}`}>
            {delta >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {delta >= 0 ? '+' : ''}{delta.toFixed(1)} vs last mo.
          </span>
        ) : (
          <span className="hero-delta neutral"><Minus size={13} />no prior data</span>
        )}
      </div>
      <div className="hero-body">
        <div className="mini-ring">
          <svg viewBox="0 0 132 132">
            <circle cx="66" cy="66" r="52" fill="none" stroke="var(--bg-alt)" strokeWidth="11" />
            <circle cx="66" cy="66" r="52" fill="none" stroke="var(--usr-pink)" strokeWidth="11"
              strokeLinecap="butt"
              strokeDasharray={`${(circ * ringPct).toFixed(1)} ${circ.toFixed(1)}`}
            />
          </svg>
          <div className="rc">
            <span style={{ fontSize: avgScore != null ? 38 : 28, lineHeight: 1, color: 'var(--usr-black)' }}>
              {avgScore != null ? avgScore.toFixed(1) : '—'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--fg-subtle)', letterSpacing: '0.08em' }}>/ 9.0</span>
          </div>
        </div>
        <div className="hero-side">
          <div className="hero-foot" style={{ marginTop: 0 }}>
            Composite of <strong>logins</strong>, <strong>athletes added</strong> and <strong>data points</strong> averaged across all {totalLabs} {scopeLabel}.
            {avgScore === null && (
              <span style={{ display: 'block', marginTop: 6, color: 'var(--fg-subtle)' }}>
                Populates after monthly Athena run.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Hero metric card 2: Weekly green rate ────────────────────────────────────
export function HeroGreenRate({ counts, totalLabs, pctGreen, delta, title = 'Weekly Active · Region Green Rate', unitLabel = 'labs' }) {
  const statusRows = [
    { key: 'green',  label: 'Green',  color: 'var(--st-green)'  },
    { key: 'yellow', label: 'Yellow', color: 'var(--st-yellow)' },
    { key: 'orange', label: 'Orange', color: 'var(--st-orange)' },
    { key: 'red',    label: 'Red',    color: 'var(--st-red)'    },
  ]

  return (
    <div className="hero-card dark">
      <div className="hero-head">
        <span className="hero-label">{title}</span>
        {delta !== null ? (
          <span className={`hero-delta ${delta >= 0 ? 'up' : 'down'}`}>
            {delta >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {delta >= 0 ? '+' : ''}{delta}pp vs last wk
          </span>
        ) : (
          <span className="hero-delta neutral"><Minus size={13} />first week</span>
        )}
      </div>
      <div className="hero-body">
        <div className="hero-figure">
          <span className="hero-num big" style={{ color: 'var(--st-green)', fontSize: 88 }}>
            {pctGreen}
            <span className="suf" style={{ color: 'rgba(248,249,250,0.4)' }}>%</span>
          </span>
        </div>
        <div className="hero-side">
          <div className="status-stack">
            {statusRows.map(s => (
              <div className="status-bar-row" key={s.key}>
                <span className="sl" style={{ color: s.color }}>{s.label}</span>
                <div className="status-track">
                  <div className="status-fill"
                    style={{ width: `${totalLabs > 0 ? (counts[s.key] / totalLabs) * 100 : 0}%`, background: s.color }} />
                </div>
                <span className="sn">{counts[s.key]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="hero-foot">
        {counts.green} of {totalLabs} {unitLabel} logged activity this week. Inactive labs decay green → yellow → orange → red.
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MyRegion() {
  const { director }   = useAuth()
  const { directorId } = useParams()
  const navigate       = useNavigate()

  const [targetDirector, setTargetDirector] = useState(null)
  const [currentSnaps,   setCurrentSnaps]   = useState([])
  const [allHistory,     setAllHistory]     = useState([])
  const [stageMap,       setStageMap]       = useState({})
  const [scoreMap,       setScoreMap]       = useState({})
  const [prevScoreMap,   setPrevScoreMap]   = useState({})
  const [pendingCount,   setPendingCount]   = useState(0)
  const [loading,        setLoading]        = useState(true)
  const [latestWeek,     setLatestWeek]     = useState(null)

  const viewingId = directorId || director?.id

  useEffect(() => {
    if (!viewingId) { setLoading(false); return }
    if (directorId) {
      supabase.from('directors').select('*').eq('id', directorId).single()
        .then(({ data }) => setTargetDirector(data))
    } else {
      setTargetDirector(director)
    }
    loadData()
  }, [viewingId])

  async function loadData() {
    setLoading(true)
    try {
      const { data: snaps, error } = await supabase
        .from('weekly_health_snapshots').select('*')
        .eq('director_id', viewingId)
        .order('week_start', { ascending: false }).limit(1000)
      if (error) throw error

      const latestW = snaps?.[0]?.week_start
      setLatestWeek(latestW)
      setAllHistory(snaps || [])
      setCurrentSnaps(latestW ? snaps.filter(s => s.week_start === latestW) : [])

      const { data: assignments } = await supabase
        .from('lab_assignments').select('lab_name, pipeline_stage')
        .eq('director_id', viewingId).eq('active', true)
      const sm = {}
      ;(assignments || []).forEach(a => { if (a.pipeline_stage) sm[a.lab_name] = a.pipeline_stage })
      setStageMap(sm)

      // Monthly health scores (0-9) per lab — powers the region average + card scores.
      // Column is health_score (DB + all Python scripts); latest month wins.
      const { data: monthly } = await supabase
        .from('monthly_health_snapshots')
        .select('lab_name, month, health_score')
        .eq('director_id', viewingId)
        .order('month', { ascending: false })
      const months = [...new Set((monthly || []).map(m => m.month))].sort().reverse()
      const latestMonth = months[0]
      const prevMonth   = months[1]
      const sMap = {}, pMap = {}
      ;(monthly || []).forEach(m => {
        if (m.health_score == null) return
        if (m.month === latestMonth) sMap[m.lab_name] = m.health_score
        else if (m.month === prevMonth) pMap[m.lab_name] = m.health_score
      })
      setScoreMap(sMap)
      setPrevScoreMap(pMap)

      if (director?.id) {
        const { count } = await supabase
          .from('suggested_emails').select('*', { count: 'exact', head: true })
          .eq('director_id', viewingId).eq('status', 'pending')
        setPendingCount(count || 0)
      }
    } catch (err) {
      console.error('Error loading region data:', err)
    } finally {
      setLoading(false)
    }
  }

  // NOTE: Admins land on My Customers ("/" -> MyCustomers) and reach this page
  // only by drilling into a specific director via /region/:directorId. No
  // admin redirect needed here anymore.

  if (loading) return (
    <div className="screen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          border: '3px solid var(--border)', borderTopColor: 'var(--usr-pink)',
          animation: 'spin 0.8s linear infinite', margin: '0 auto 16px',
        }} />
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-subtle)' }}>
          Loading region...
        </div>
      </div>
    </div>
  )

  const viewDirector = targetDirector || director
  const fullName     = viewDirector?.name || 'Director'
  const orgName      = viewDirector?.org_name || ''

  // Week label
  const weekLabel = latestWeek
    ? (() => {
        const d = new Date(latestWeek + 'T00:00:00')
        const iso = `Wk ${getISOWeek(d)} · ${d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}`
        return iso
      })()
    : null

  const counts = {
    green:  currentSnaps.filter(s => s.health_color === 'green').length,
    yellow: currentSnaps.filter(s => s.health_color === 'yellow').length,
    orange: currentSnaps.filter(s => s.health_color === 'orange').length,
    red:    currentSnaps.filter(s => s.health_color === 'red').length,
  }
  const totalLabs = currentSnaps.length

  // WoW delta
  const allWeeks      = [...new Set(allHistory.map(s => s.week_start))].sort()
  const prevWeekStart = allWeeks.length >= 2 ? allWeeks[allWeeks.length - 2] : null
  const prevSnaps     = prevWeekStart ? allHistory.filter(s => s.week_start === prevWeekStart) : []
  const pctGreen      = totalLabs > 0 ? Math.round((counts.green / totalLabs) * 100) : 0
  const prevGreen     = prevSnaps.length > 0
    ? Math.round((prevSnaps.filter(s => s.health_color === 'green').length / prevSnaps.length) * 100)
    : null
  const greenDelta    = prevGreen !== null ? pctGreen - prevGreen : null

  // Region avg = mean of latest-month health_score across labs that have one
  const scoredVals = currentSnaps.map(s => scoreMap[s.lab_name]).filter(v => v != null)
  const avgScore   = scoredVals.length
    ? scoredVals.reduce((a, b) => a + b, 0) / scoredVals.length
    : null
  const prevVals   = currentSnaps.map(s => prevScoreMap[s.lab_name]).filter(v => v != null)
  const prevAvg    = prevVals.length
    ? prevVals.reduce((a, b) => a + b, 0) / prevVals.length
    : null
  const avgScoreDelta = (avgScore != null && prevAvg != null) ? avgScore - prevAvg : null

  const sortedSnaps = [...currentSnaps].sort((a, b) => {
    const ord = { red: 0, orange: 1, yellow: 2, green: 3, unknown: 4 }
    return (ord[a.health_color] ?? 5) - (ord[b.health_color] ?? 5)
  })

  return (
    <div className="screen">

      {/* Back button (admin drill-in) */}
      {directorId && (
        <button
          onClick={() => navigate('/admin')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-subtle)' }}
        >
          <ArrowLeft size={14} /> Back to Admin
        </button>
      )}

      {/* ── Topbar ──────────────────────────────────────────────────────── */}
      <div className="topbar">
        <div>
          <div className="topbar-eyebrow">
            {orgName || fullName} · {totalLabs} Speed Lab{totalLabs !== 1 ? 's' : ''}
          </div>
          <h1 className="topbar-title">
            {directorId ? `${fullName.split(' ')[0]}'s Region` : 'My Region'}
          </h1>
        </div>
        <div className="topbar-meta">
          {weekLabel && (
            <div className="tm">
              <div className="tm-label">Current week</div>
              <div className="tm-val">{weekLabel}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Outreach banner ─────────────────────────────────────────────── */}
      {pendingCount > 0 ? (
        <div className="notif" onClick={() => navigate('/outreach')}>
          <div className="notif-bell">
            <Bell size={22} />
            <span className="ping" />
          </div>
          <div className="notif-copy">
            <div className="notif-title">
              You have <b>{pendingCount}</b> message{pendingCount !== 1 ? 's' : ''} to send
            </div>
            <div className="notif-sub">Ready-to-send templates are waiting in the Outreach Hub</div>
          </div>
          <div className="notif-cta">
            Open hub <ArrowLeft size={16} style={{ transform: 'rotate(180deg)' }} />
          </div>
        </div>
      ) : totalLabs > 0 ? (
        <div className="notif" style={{ borderLeftColor: 'var(--st-green)', cursor: 'default' }}>
          <div className="notif-bell" style={{ background: 'rgba(29,178,113,0.18)', color: 'var(--st-green)' }}>
            <CheckCircle size={22} />
          </div>
          <div className="notif-copy">
            <div className="notif-title">Inbox clear</div>
            <div className="notif-sub">Every lab in your region has been contacted. Nice work.</div>
          </div>
        </div>
      ) : null}

      {/* ── Hero metrics ────────────────────────────────────────────────── */}
      {totalLabs > 0 && (
        <div className="hero-grid">
          <HeroScore avgScore={avgScore} delta={avgScoreDelta} totalLabs={totalLabs} />
          <HeroGreenRate counts={counts} totalLabs={totalLabs} pctGreen={pctGreen} delta={greenDelta} />
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {totalLabs === 0 && (
        <div className="stub">
          <div className="stub-mark">
            <Activity size={40} />
          </div>
          <h2>No data yet</h2>
          <p>Your region populates after the first weekly report runs. Check back after the next Friday run.</p>
          <span className="pill">Reporting runs every Friday 6am ET</span>
        </div>
      )}

      {/* ── Lab sections ────────────────────────────────────────────────── */}
      {totalLabs > 0 && (
        <>
          {/* New labs collapsible */}
          <NewLabsSection
            sortedSnaps={sortedSnaps}
            stageMap={stageMap}
            allHistory={allHistory}
            viewingId={viewingId}
            scoreMap={scoreMap}
          />

          {/* All Labs */}
          <div className="section">
            <div className="section-head">
              <h3>All Speed Labs</h3>
              <span className="count-pill">{totalLabs}</span>
              <span className="spacer" />
              <span className="section-sort-label">Sorted by attention needed</span>
            </div>
            <div className="lab-list">
              {sortedSnaps.map(snap => (
                <LabCard
                  key={snap.id}
                  snap={snap}
                  allHistory={allHistory}
                  viewingId={viewingId}
                  stage={stageMap[snap.lab_name] ?? null}
                  score={scoreMap[snap.lab_name] ?? null}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── ISO week helper ──────────────────────────────────────────────────────────
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}
