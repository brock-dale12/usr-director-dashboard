import { useState, useEffect, useRef } from 'react'
import {
  OB_STAGES, OB_INDEX, OB_LABEL, STATUS_COLORS, TTV_TARGET, gatingKeys,
  transitionVariant, recapVariant,
} from '../lib/onboardingCatalog'
import { TTVPanel, StageControl, DetailsEditor, DealProperties, NotesPanel } from '../components/OnboardingControls'
import WeeklyMatrix from '../components/WeeklyMatrix'
import {
  Activity, Mail, Phone, Zap, Check, CheckCircle, Send, User, Users, Loader2,
  CheckSquare, Square, Pencil, StickyNote, Trophy, Briefcase, MessageSquare, Link2,
  ChevronDown, Calendar, RefreshCw, ListChecks, Plus, Flag, GripVertical, Clock,
} from 'lucide-react'

/**
 * CustomerDetail — the ONE shared customer card, used everywhere a customer is
 * shown (My Customers, My Region, Onboarding, and the future Renewals/Payments).
 *
 * REDESIGN — "Customer View" mockup, take 2:
 *   The card IS the header. Clicking the header row toggles the detail open.
 *   When open, a toolbar (Expand/Collapse all) + collapsible sections appear
 *   BELOW the same header — no second card. This component renders the whole
 *   thing, so pages render <CustomerDetail expanded onToggle .../> directly
 *   instead of wrapping it in their own card (which caused the duplicate).
 *
 *   Header (pure mockup): drag handle · status dot · name · location ·
 *   last touch · last meeting · onboarding day · health/9 · Start tasks · chevron.
 *   Sections: Deal Information · Contacts · Activity & Health · Onboarding ·
 *   Renewal · Tasks · Notes · Meetings · Communications · Data Connections.
 *
 *   Design is faithful to the mockup; the only deviation is COLOR, mapped to the
 *   platform tokens: mockup red → --usr-pink, greens → --st-green, amber →
 *   --st-orange. Type: Oswald (display) + Hanken Grotesk (body).
 *
 * Wiring status (per "design first, then wire"):
 *   WIRED  → header, Activity & Health (TTVPanel/WeeklyMatrix/HealthArea),
 *            Onboarding journey + tasks, Deal Information (DealProperties),
 *            Notes (NotesPanel), Contacts editor (DetailsEditor), Data Connections.
 *   FAITHFUL-BUT-PENDING-DATA → Renewal pipeline, master Tasks create/list,
 *            Meetings (prep + Fireflies), Communications. Rendered in the new
 *            design with real data where available + empty states; // TODO(wire).
 *
 * Props:
 *   c, catalog, doneSet, doneMeta, onOpenTemplate, onSetDone, onSaveCs, savingCs,
 *   hsPushState, scrollToTasks, onComplete, onSaveDeal, savingDeal, loadMeta,
 *   loadNotes, addNote, isOnboarding=true,
 *   expanded, onToggle      → controlled open/close of the whole card
 *   draggable, onDragStart  → pipeline drag-to-move-stage (Onboarding)
 *   onStartTasks            → Start-tasks button (opens onboarding + scrolls)
 */

// brand-token color shorthands (mockup red/green/amber → platform tokens)
const PINK = 'var(--usr-pink)'
const PINK_BG = 'rgba(236,54,66,0.10)'
const PINK_SOFT = '#f3a9ad'
const PINK_BORDER = 'rgba(236,54,66,0.32)'
const GREEN = 'var(--st-green)'
const GREEN_BG = 'rgba(29,178,113,0.12)'
const ORANGE = 'var(--st-orange)'

// ─── Date formatting for completion stamps ────────────────────────────────────
function fmtStamp(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// status-string → token color (mirrors the mockup's statusColor())
function statusColor(v) {
  if (['Current', 'On track', 'Renewed', 'Passed', 'Live · Active', 'Active'].includes(v)) return GREEN
  if (['Past Due', 'Failed', 'At risk', 'Churn risk', 'Churned'].includes(v)) return PINK
  if (['Trial', 'In progress', 'Not started', 'Refunded'].includes(v)) return ORANGE
  return '#2a2a2a'
}

function initialsOf(name) {
  if (!name) return '—'
  const p = String(name).trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '—'
}

// recommended auto_email variant (transition = health trend, recap = TTV count)
function recommendedVariant(task, c) {
  if (task.selector === 'transition') {
    const ws = (c.weeks || []).filter(w => !w.preCustomer && w.color)
    const curr = ws.length ? ws[ws.length - 1].color : c.healthColor
    const prev = ws.length >= 2 ? ws[ws.length - 2].color : curr
    return transitionVariant(prev, curr)
  }
  if (task.selector === 'recap') return recapVariant(c.recapCount ?? null)
  return null
}

// ─── Health trend area chart (real data; same logic as My Customers) ──────────
function HealthArea({ history }) {
  const COLOR_RANK = { green: 4, yellow: 3, orange: 2, red: 1, unknown: 1 }
  const rows = history || []
  const now = new Date()
  const slots = Array.from({ length: 6 }, (_, i) => {
    const mo = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const moStr = mo.toISOString().slice(0, 7)
    const wk = rows.filter(s => s.week_start && s.week_start.startsWith(moStr))
    if (!wk.length) return null
    return wk.reduce((a, s) => a + (COLOR_RANK[s.health_color] ?? 1), 0) / wk.length
  })
  const hasData = slots.some(v => v !== null)
  if (!hasData) {
    return <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#a8a8a8', fontFamily: "'Oswald',sans-serif", textTransform: 'uppercase', letterSpacing: '.08em' }}>Builds after 2+ months</div>
  }
  const filled = slots.map((v, i) => v ?? (i > 0 ? slots.slice(0, i).reverse().find(x => x !== null) ?? 1 : 1))
  const w = 340, h = 130
  const pts = filled.map((v, i) => [(i / (filled.length - 1)) * (w - 20) + 10, h - 12 - ((v - 1) / 3) * (h - 30)])
  const line = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(0) + ' ' + p[1].toFixed(0)).join(' ')
  const area = line + ` L ${pts[pts.length - 1][0].toFixed(0)} ${h - 2} L ${pts[0][0].toFixed(0)} ${h - 2} Z`
  const latest = rows.reduce((m, s) => (!m || (s.week_start || '') > (m.week_start || '') ? s : m), null)
  const col = STATUS_COLORS[latest?.health_color || 'unknown']
  const MONTHS = ['6mo', '5mo', '4mo', '3mo', '2mo', 'Now']
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', marginTop: 8, display: 'block' }}>
        <path d={area} fill={col} fillOpacity="0.12" />
        <path d={line} fill="none" stroke={col} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 4.5 : 3.5} fill={i === pts.length - 1 ? col : '#fff'} stroke={col} strokeWidth="2" />)}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        {MONTHS.map((m, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 10, letterSpacing: '.04em', color: i === 5 ? PINK : '#a8a8a8', marginTop: 1 }}>{m.toUpperCase()}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Onboarding journey — horizontal node timeline (mockup) ───────────────────
function JourneyNodes({ c, catalog, doneSet }) {
  const idx = c.graduated ? OB_STAGES.length - 1 : (OB_INDEX[c.stageKey] ?? 0)
  const n = OB_STAGES.length
  const progressPct = c.graduated ? 100 : (idx / (n - 1)) * 100
  return (
    <div style={{ position: 'relative', paddingTop: 24, marginTop: 8 }}>
      {c.day != null && (
        <div style={{ position: 'absolute', top: 0, left: `${6.25 + progressPct * 0.875}%`, transform: 'translateX(-50%)', fontFamily: "'Oswald',sans-serif", fontWeight: 600, fontSize: 12, color: PINK, whiteSpace: 'nowrap' }}>Day {c.day}</div>
      )}
      <div style={{ position: 'absolute', top: 40, left: '6.25%', width: '87.5%', height: 3, background: '#ededed', borderRadius: 2 }} />
      <div style={{ position: 'absolute', top: 40, left: '6.25%', width: `${progressPct * 0.875}%`, height: 3, background: PINK, borderRadius: 2 }} />
      <div style={{ position: 'relative', display: 'flex' }}>
        {OB_STAGES.map((s, i) => {
          const tracked = (catalog[s.key] || []).filter(t => !t.recurring)
          const doneN = tracked.filter(t => doneSet.has(t.key)).length
          const done = c.graduated || i < idx
          const current = !c.graduated && i === idx
          const countColor = done ? GREEN : current ? PINK : '#b5b5b5'
          return (
            <div key={s.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '8px 0 6px' }}>
              {done
                ? <div style={{ width: 26, height: 26, borderRadius: '50%', background: PINK, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={13} color="#fff" strokeWidth={3} /></div>
                : current
                  ? <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#fff', border: `3px solid ${PINK}`, boxShadow: `0 0 0 5px ${PINK_BG}` }} />
                  : <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#fff', border: '2px solid #d8d8d8' }} />}
              <div style={{ fontFamily: "'Oswald',sans-serif", fontWeight: 600, fontSize: 10.5, letterSpacing: '.02em', color: '#3a3a3a', textAlign: 'center' }}>{s.short}</div>
              <div style={{ fontFamily: "'Oswald',sans-serif", fontWeight: 600, fontSize: 13, color: countColor }}>{doneN}/{tracked.length}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── A single task card (mockup style), wired to catalog handlers ─────────────
function TaskCard({ task, c, isDone, meta, onOpen, onToggle }) {
  const isAction = task.kind === 'action'
  const recurring = !!task.recurring
  const accent = recurring ? ORANGE : (task.priority === 'high' || (gatingKeys(c.stageKey) || []).includes?.(task.key)) ? PINK : PINK
  const recVar = task.kind === 'auto_email' ? recommendedVariant(task, c) : null
  const recLabel = recVar && task.variants?.[recVar] ? task.variants[recVar].label : null
  const stamp = isDone && meta ? [meta.by, fmtStamp(meta.at)].filter(Boolean).join(' · ') : null
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, background: '#fff', border: '1px solid #efefee', borderRadius: 11, overflow: 'hidden', opacity: isDone ? 0.6 : 1 }}>
      <span style={{ width: 4, flex: 'none', background: accent }} />
      <div style={{ flex: 1, minWidth: 0, padding: '13px 15px' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#1c1c1c' }}>
          {task.label}<span style={{ color: '#9a9a9a', fontWeight: 400, fontSize: 12.5 }}> · {task.channel}</span>
        </div>
        {task.reason && <div style={{ marginTop: 3, fontSize: 12.5, color: '#777', lineHeight: 1.5 }}>{task.reason}</div>}
        {recLabel && <div style={{ marginTop: 6, fontSize: 11.5, color: ORANGE, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}><Zap size={11} />This week: {recLabel}</div>}
        {stamp && <div style={{ marginTop: 6, fontSize: 11.5, color: GREEN, display: 'flex', alignItems: 'center', gap: 5 }}><CheckCircle size={11} />Done by {stamp}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 14px', flex: 'none' }}>
        {isAction ? (
          <button onClick={e => { e.stopPropagation(); onToggle(!isDone) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: isDone ? GREEN_BG : '#fff', border: `1px solid ${isDone ? GREEN : '#e3e3e3'}`, color: isDone ? GREEN : '#555', borderRadius: 9, padding: '8px 12px', fontFamily: "'Oswald',sans-serif", fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {isDone ? <CheckSquare size={15} /> : <Square size={15} />}{isDone ? 'Done' : 'Mark done'}
          </button>
        ) : (
          <button onClick={e => { e.stopPropagation(); onOpen() }} style={{ background: '#161616', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 14px', fontFamily: "'Oswald',sans-serif", fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>Open template →</button>
        )}
      </div>
    </div>
  )
}

// ─── Data Connections strip ───────────────────────────────────────────────────
function ConnectionsStrip({ c }) {
  const org = c.orgMatchKind || (c.orgId ? 'linked' : 'none')
  const meta = { exact: { label: 'Verified', tone: GREEN }, linked: { label: 'Linked', tone: GREEN }, fuzzy: { label: 'Fuzzy — verify', tone: ORANGE }, none: { label: 'Not linked', tone: PINK } }[org]
  const Pill = ({ tone, children, title }) => <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 700, background: '#f1f1f1', color: tone }}>{children}</span>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12.5, color: '#3a3a3a' }}>
      <span>HubSpot deal: <code>{c.dealId || '—'}</code></span>
      <span>HubSpot company: {c.companyId ? <Pill tone={GREEN} title={`HubSpot company ${c.companyId}`}>#{c.companyId}</Pill> : <Pill tone={PINK} title="No HubSpot company linked">not linked</Pill>}</span>
      <span>USR DB org: <Pill tone={meta.tone} title={c.orgName || 'No USR org linked'}>{meta.label}</Pill>{c.orgName && <span style={{ marginLeft: 6, color: '#9a9a9a' }}>{c.orgName}</span>}</span>
    </div>
  )
}

// ─── Collapsible section shell (mockup) ───────────────────────────────────────
function Section({ icon: Icon, title, summary, open, onToggle, bodyPad = '2px 22px 22px', children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #ededed', borderRadius: 14, overflow: 'hidden' }}>
      <div onClick={onToggle} className="cv-sec-head" style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '18px 22px', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ display: 'inline-flex', color: '#1c1c1c' }}><Icon size={19} strokeWidth={1.8} /></span>
        <div style={{ fontFamily: "'Oswald',sans-serif", fontWeight: 600, fontSize: 16, letterSpacing: '.05em', textTransform: 'uppercase', color: '#1c1c1c' }}>{title}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {summary != null && summary !== '' && <span style={{ fontSize: 12.5, color: '#9a9a9a' }}>{summary}</span>}
          <ChevronDown size={15} style={{ color: '#a0a0a0', transition: 'transform .2s ease', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        </div>
      </div>
      {open && <div style={{ padding: bodyPad }}>{children}</div>}
    </div>
  )
}

const CARD = { background: '#f7f7f6', border: '1px solid #efefee', borderRadius: 12, padding: 18 }
const CARD_TITLE = { fontFamily: "'Oswald',sans-serif", fontSize: 11, letterSpacing: '.08em', color: '#9a9a9a', textTransform: 'uppercase', fontWeight: 500 }

function Stub({ children }) {
  return <div style={{ border: '1px dashed #dcdcdc', borderRadius: 10, padding: 22, textAlign: 'center', color: '#9a9a9a', fontSize: 13, lineHeight: 1.6 }}><span style={{ display: 'inline-block', marginBottom: 8, fontFamily: "'Oswald',sans-serif", fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: PINK, background: PINK_BG, borderRadius: 5, padding: '3px 9px', fontWeight: 600 }}>Wiring in progress</span><div>{children}</div></div>
}

// ════════════════════════════════════════════════════════════════════════════
function CustomerDetail({
  c, catalog, doneSet, doneMeta, onOpenTemplate, onSetDone, onSaveCs, savingCs,
  hsPushState, scrollToTasks, onComplete, onSaveDeal, savingDeal, loadMeta, loadNotes, addNote,
  isOnboarding = true, expanded = true, onToggle, draggable = false, onDragStart, onStartTasks,
  showHeader = true,
}) {
  const [open, setOpen] = useState({
    dealInfo: false, contacts: false, activityHealth: true, onboarding: isOnboarding,
    renewal: false, tasks: false, notes: false, meetings: false, comms: false, connections: false,
  })
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }))
  const setAll = (v) => setOpen(o => Object.fromEntries(Object.keys(o).map(k => [k, v])))
  const [editContact, setEditContact] = useState(false)
  const tasksRef = useRef(null)

  useEffect(() => {
    if (scrollToTasks && expanded) {
      setOpen(o => ({ ...o, onboarding: true }))
      const t = setTimeout(() => tasksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 90)
      return () => clearTimeout(t)
    }
  }, [scrollToTasks, expanded])

  // header values
  const HC = c.healthColor || 'unknown'
  const healthColor = { green: 'var(--st-green)', yellow: 'var(--st-yellow)', orange: 'var(--st-orange)', red: 'var(--st-red)', unknown: '#9a9a9a' }[HC]
  const healthBg = { green: 'var(--st-green-bg)', yellow: 'var(--st-yellow-bg)', orange: 'var(--st-orange-bg)', red: 'var(--st-red-bg)', unknown: '#f0f0ef' }[HC]
  const locationLabel = [c.city, c.state].filter(Boolean).join(', ')
  const stageTasks = isOnboarding ? (catalog?.[c.stageKey] || []) : []
  const openTaskCount = stageTasks.filter(t => !doneSet?.has(t.key)).length

  // onboarding section task split (current stage + overdue gating from earlier stages)
  const idx = OB_INDEX[c.stageKey] ?? 0
  const currentTasks = (catalog?.[c.stageKey] || [])
  const overdueTasks = !c.graduated ? OB_STAGES.slice(0, idx).flatMap(s => (catalog?.[s.key] || []).filter(t => gatingKeys(s.key).includes(t.key) && !doneSet?.has(t.key))) : []
  const gateDone = gatingKeys(c.stageKey).filter(k => doneSet?.has(k)).length
  const gateTot = gatingKeys(c.stageKey).length

  const stop = (e) => e.stopPropagation()

  return (
    <div className="cv-root">
      {/* ════ HEADER — this row IS the card; click toggles detail ════ */}
      {showHeader && (
      <div
        className="cv-head"
        draggable={draggable}
        onDragStart={onDragStart}
        onClick={onToggle}
        style={{ position: 'relative', background: '#fff', border: '1px solid #ededed', borderLeft: `5px solid ${healthColor}`, borderRadius: 14, padding: '20px 24px', cursor: onToggle ? 'pointer' : 'default' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          {draggable && <div style={{ color: '#cfcfcf', cursor: 'grab', alignSelf: 'center' }} onClick={stop}><GripVertical size={17} /></div>}
          <div style={{ width: 23, height: 23, borderRadius: '50%', background: healthColor, flex: 'none', boxShadow: `0 0 0 4px ${healthBg}`, alignSelf: 'center' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Oswald',sans-serif", fontWeight: 600, fontSize: 26, color: '#1c1c1c', lineHeight: 1.1 }}>
              {c.name || c.contactName || 'Customer'}
              <div style={{ marginTop: 5, fontSize: 14, color: '#8a8a8a', fontFamily: "'Hanken Grotesk',sans-serif" }}>{locationLabel || '—'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: "'Oswald',sans-serif", fontWeight: 600, fontSize: 18, color: '#1c1c1c' }}>—</div>
              <div className="cv-stat-l">Last touch</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: "'Oswald',sans-serif", fontWeight: 600, fontSize: 18, color: '#1c1c1c' }}>—</div>
              <div className="cv-stat-l">Last meeting</div>
            </div>
            {isOnboarding && c.day != null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: "'Oswald',sans-serif", fontWeight: 600, fontSize: 18, color: '#1c1c1c' }}>{c.day}<span style={{ fontSize: 13, color: '#b5b5b5' }}>/90</span></div>
                <div className="cv-stat-l">Onboarding day</div>
              </div>
            )}
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, padding: '3px 11px', borderRadius: 8, background: healthBg }}>
                <span style={{ fontFamily: "'Oswald',sans-serif", fontWeight: 600, fontSize: 18, color: healthColor }}>{c.healthScore != null ? c.healthScore : '—'}</span>
                <span style={{ fontFamily: "'Oswald',sans-serif", fontSize: 12, fontWeight: 500, color: healthColor, opacity: 0.65 }}>/9</span>
              </div>
              <div className="cv-stat-l">Health score</div>
            </div>
            {isOnboarding && onStartTasks && (
              <div style={{ position: 'relative', display: 'inline-flex' }}>
                <button onClick={e => { stop(e); onStartTasks() }} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#161616', color: '#fff', border: 'none', borderRadius: 11, padding: '11px 16px', fontFamily: "'Oswald',sans-serif", fontWeight: 500, fontSize: 14, letterSpacing: '.03em', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <Send size={15} />Start tasks
                </button>
                {openTaskCount > 0 && <span style={{ position: 'absolute', top: -8, right: -8, minWidth: 24, height: 24, padding: '0 6px', borderRadius: 12, background: PINK, color: '#fff', border: '2px solid #fff', fontFamily: "'Oswald',sans-serif", fontWeight: 600, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.18)' }}>{openTaskCount}</span>}
              </div>
            )}
            {onToggle && <><div style={{ width: 1, height: 34, background: '#ececec' }} /><ChevronDown size={18} style={{ color: '#a0a0a0', transition: 'transform .2s ease', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', flex: 'none' }} /></>}
          </div>
        </div>
        {hsPushState === 'pushing' && <div className="ob-hs-status" style={{ marginTop: 10 }} onClick={stop}><Loader2 size={12} className="animate-spin" />Pushing to HubSpot…</div>}
        {hsPushState === 'ok' && <div className="ob-hs-status ok" style={{ marginTop: 10 }} onClick={stop}><CheckCircle size={12} />Pushed to HubSpot</div>}
        {hsPushState && hsPushState !== 'pushing' && hsPushState !== 'ok' && <div className="ob-hs-status err" style={{ marginTop: 10 }} onClick={stop}>HubSpot push failed — saved internally</div>}
      </div>
      )}

      {!expanded ? null : (
      <>
        {/* ════ TOOLBAR ════ */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 6px' }}>
          <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: '#b0b0b0' }}>Customer Detail</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="cv-tbtn" onClick={() => setAll(true)}>Expand all</button>
            <button className="cv-tbtn" onClick={() => setAll(false)}>Collapse all</button>
          </div>
        </div>

        {/* 1. DEAL INFORMATION (wired → DealProperties) */}
        <Section icon={Briefcase} title="Deal Information" summary={[c.product, c.segment].filter(Boolean).join(' · ') || 'HubSpot deal'} open={open.dealInfo} onToggle={() => toggle('dealInfo')}>
          <DealProperties c={c} onSaveDeal={onSaveDeal} saving={savingDeal} loadMeta={loadMeta} />
          <div style={{ marginTop: 12, fontSize: 12, color: '#a0a0a0', display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={13} />Synced from HubSpot — the deal is the source of truth for stage, ARR, and renewal date.</div>
        </Section>

        {/* 2. CONTACTS (primary wired; multi-contact pending) */}
        <Section icon={Users} title="Contacts" summary={c.contactName ? '1 contact' : 'No contact on file'} open={open.contacts} onToggle={() => toggle('contacts')}>
          {c.contactName ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
              <div style={{ ...CARD, padding: 16, display: 'flex', gap: 13 }}>
                <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#1c1c1c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Oswald',sans-serif", fontWeight: 600, fontSize: 15, flex: 'none' }}>{initialsOf(c.contactName)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{c.contactName}</span>
                    <span style={{ fontFamily: "'Oswald',sans-serif", fontSize: 9.5, letterSpacing: '.05em', textTransform: 'uppercase', color: GREEN, background: GREEN_BG, borderRadius: 5, padding: '2px 6px', fontWeight: 500 }}>Primary</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#8a8a8a', marginTop: 2 }}>Primary Contact</div>
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
                    {c.email && <a href={`mailto:${c.email}`} style={{ color: PINK, textDecoration: 'none', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 7 }}><Mail size={14} />{c.email}</a>}
                    {c.phone && <span style={{ color: '#444', display: 'flex', alignItems: 'center', gap: 7 }}><Phone size={14} />{c.phone}</span>}
                  </div>
                </div>
              </div>
            </div>
          ) : <Stub>No contact on file yet — add one below, or it syncs from HubSpot.</Stub>}
          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="cv-tbtn" onClick={() => setEditContact(v => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Pencil size={13} />{editContact ? 'Close editor' : 'Edit details'}</button>
            <span style={{ fontSize: 12, color: '#a0a0a0' }}>Full multi-contact roster from HubSpot — coming next.</span>
          </div>
          {editContact && <div style={{ marginTop: 12 }}><DetailsEditor c={c} cs={c.cs} onSave={onSaveCs} saving={savingCs} onClose={() => setEditContact(false)} /></div>}
        </Section>

        {/* 3. ACTIVITY & HEALTH (wired) */}
        <Section icon={Activity} title="Activity & Health" summary={`${c.healthScore != null ? c.healthScore : '—'}/9 health`} open={open.activityHealth} onToggle={() => toggle('activityHealth')}>
          <div className="cv-actband">
            {isOnboarding && (
              <div style={CARD}>
                <div style={CARD_TITLE}>Time-to-Value</div>
                <div style={{ marginTop: 10 }}><TTVPanel c={c} cs={c.cs} synced={c.ttvSynced} onSave={onSaveCs} saving={savingCs} /></div>
              </div>
            )}
            <div style={CARD}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={CARD_TITLE}>Weekly Activity · 8w</div>
              </div>
              <div style={{ marginTop: 12 }}>{c.weeks && c.weeks.length > 0 ? <WeeklyMatrix weeks={c.weeks} /> : <p style={{ fontSize: 12, color: '#9a9a9a' }}>No weekly activity yet — appears once platform usage flows.</p>}</div>
            </div>
            <div style={CARD}>
              <div style={CARD_TITLE}>Monthly Health Trend</div>
              <div style={{ fontFamily: "'Oswald',sans-serif", fontWeight: 600, fontSize: 34, lineHeight: 1, color: PINK, marginTop: 8 }}>{c.healthScore != null ? c.healthScore : '—'}<span style={{ fontSize: 20, color: PINK_SOFT }}>/9</span></div>
              <HealthArea history={c.healthHistory} />
              <div style={{ marginTop: 8, fontSize: 12, color: '#9a9a9a' }}>{c.athletes ?? '—'} athletes (30d) · {c.prs ?? '—'} PRs (8w)</div>
            </div>
          </div>
        </Section>

        {/* 4. ONBOARDING (wired journey + tasks) */}
        {isOnboarding && (
          <Section icon={Flag} title="Onboarding" summary={c.graduated ? 'Graduated' : (c.day != null ? `${OB_LABEL[c.stageKey]} · Day ${c.day} of 90` : OB_LABEL[c.stageKey])} open={open.onboarding} onToggle={() => toggle('onboarding')} bodyPad="6px 24px 24px">
            <div ref={tasksRef}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
                <div style={{ fontSize: 13, color: '#888' }}>90-Day Journey{!c.graduated && OB_STAGES[idx + 1] ? ` · complete required steps → ${OB_STAGES[idx + 1].label}` : ''}</div>
                <span style={{ flex: 1 }} />
                <StageControl c={c} cs={c.cs} onSave={onSaveCs} saving={savingCs} />
                {onComplete && <button className="ob-complete-btn" onClick={onComplete}><Trophy size={13} />Complete</button>}
              </div>
              <JourneyNodes c={c} catalog={catalog} doneSet={doneSet} />
              <div style={{ marginTop: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                  <CheckSquare size={15} color="#3a3a3a" />
                  <span style={{ fontFamily: "'Oswald',sans-serif", fontSize: 12, letterSpacing: '.05em', textTransform: 'uppercase', color: '#3a3a3a', fontWeight: 600 }}>Onboarding Tasks</span>
                  <span style={{ fontFamily: "'Oswald',sans-serif", fontSize: 10.5, letterSpacing: '.05em', textTransform: 'uppercase', color: PINK, background: PINK_BG, borderRadius: 5, padding: '2px 8px' }}>{OB_LABEL[c.stageKey]} · Current</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {currentTasks.length === 0 && <div style={{ fontSize: 13, color: '#9a9a9a' }}>No steps queued for this stage — keep engaging weekly.</div>}
                  {currentTasks.map(t => <TaskCard key={t.key} task={t} c={c} isDone={doneSet.has(t.key)} meta={doneMeta?.[t.key]} onOpen={() => onOpenTemplate(c, t)} onToggle={(v) => onSetDone(t.key, v)} />)}
                </div>
                {overdueTasks.length > 0 && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '16px 0 10px' }}>
                      <Clock size={15} color={PINK} />
                      <span style={{ fontFamily: "'Oswald',sans-serif", fontSize: 12, letterSpacing: '.05em', textTransform: 'uppercase', color: '#3a3a3a', fontWeight: 600 }}>Overdue · Earlier Stages</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {overdueTasks.map(t => <TaskCard key={t.key} task={t} c={c} isDone={doneSet.has(t.key)} meta={doneMeta?.[t.key]} onOpen={() => onOpenTemplate(c, t)} onToggle={(v) => onSetDone(t.key, v)} />)}
                    </div>
                  </>
                )}
              </div>
              {gateTot > 0 && <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #f0f0ef', fontFamily: "'Oswald',sans-serif", fontSize: 11, letterSpacing: '.06em', color: '#9a9a9a', textTransform: 'uppercase' }}>{gateDone}/{gateTot} required steps done to advance</div>}
            </div>
          </Section>
        )}

        {/* 5. RENEWAL (faithful; pipeline wiring pending) */}
        <Section icon={RefreshCw} title="Renewal" summary={c.renewalStatus || 'Not yet in window'} open={open.renewal} onToggle={() => toggle('renewal')} bodyPad="6px 24px 24px">
          <Stub>The renewal sequence (6-month → 90 / 60 / 30-day → close) mirrors the onboarding journey and lights up as the account nears its renewal window.{/* TODO(wire): renewal stage + renewal_date + renewal tasks */}</Stub>
        </Section>

        {/* 6. TASKS — master list (onboarding wired; renewal/custom pending) */}
        <Section icon={ListChecks} title="Tasks" summary={isOnboarding ? `${openTaskCount} to do` : ''} open={open.tasks} onToggle={() => toggle('tasks')}>
          <div style={{ ...CARD, padding: '14px 16px', marginBottom: 18 }}>
            <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 10.5, letterSpacing: '.07em', textTransform: 'uppercase', color: '#9a9a9a', fontWeight: 500 }}>Create a task for this customer</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 11, flexWrap: 'wrap' }}>
              <input placeholder="Task title…" disabled style={{ flex: 1, minWidth: 220, border: '1px solid #e3e3e3', borderRadius: 9, padding: '11px 13px', fontSize: 14, background: '#fff' }} />
              <input type="date" disabled style={{ border: '1px solid #e3e3e3', borderRadius: 9, padding: '10px 13px', fontSize: 14, background: '#fff', color: '#444' }} />
              <button disabled style={{ background: '#bdbdbd', color: '#fff', border: 'none', borderRadius: 9, padding: '0 18px', fontFamily: "'Oswald',sans-serif", fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap' }}>Add task</button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#a0a0a0' }}>Custom tasks + HubSpot sync — coming next.</div>
          </div>
          {isOnboarding && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: PINK }} />
                <span style={{ fontFamily: "'Oswald',sans-serif", fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: '#3a3a3a', fontWeight: 600 }}>Onboarding</span>
                <span style={{ flex: 1, height: 1, background: '#efefee' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {currentTasks.map(t => <TaskCard key={t.key} task={t} c={c} isDone={doneSet.has(t.key)} meta={doneMeta?.[t.key]} onOpen={() => onOpenTemplate(c, t)} onToggle={(v) => onSetDone(t.key, v)} />)}
              </div>
            </>
          )}
        </Section>

        {/* 7. NOTES (wired → NotesPanel) */}
        <Section icon={StickyNote} title="Notes" summary="Synced from HubSpot" open={open.notes} onToggle={() => toggle('notes')}>
          <NotesPanel dealId={c.dealId} loadNotes={loadNotes} addNote={addNote} />
        </Section>

        {/* 8. MEETINGS (faithful; data pending) */}
        <Section icon={Calendar} title="Meetings" summary="" open={open.meetings} onToggle={() => toggle('meetings')}>
          <div style={{ ...CARD, padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 10.5, letterSpacing: '.07em', textTransform: 'uppercase', color: '#9a9a9a', fontWeight: 500 }}>Schedule from template</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 11 }}>
              {['Kick-Off', 'Implementation', '30-Day', '60-Day', '90-Day QBR', 'Upgrade', 'Renewal', 'Support'].map(m => (
                <button key={m} disabled style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #e3e3e3', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, color: '#999', whiteSpace: 'nowrap' }}><Plus size={13} />{m}</button>
              ))}
            </div>
          </div>
          <Stub>Scheduled + past meetings with prep checklists and Fireflies notes.{/* TODO(wire): meetings + Fireflies transcripts */}</Stub>
        </Section>

        {/* 9. COMMUNICATIONS (faithful; data pending) */}
        <Section icon={Mail} title="Communications" summary="" open={open.comms} onToggle={() => toggle('comms')}>
          <Stub>Email / text / call history for this account, inbound and outbound, synced from HubSpot.{/* TODO(wire): HubSpot engagements timeline */}</Stub>
        </Section>

        {/* DATA CONNECTIONS (wired) */}
        <Section icon={Link2} title="Data Connections" summary="HubSpot ↔ USR DB" open={open.connections} onToggle={() => toggle('connections')}>
          <ConnectionsStrip c={c} />
        </Section>
      </>
      )}
    </div>
  )
}

export default CustomerDetail
