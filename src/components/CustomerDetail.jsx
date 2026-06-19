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
  ChevronDown, Calendar, RefreshCw, ListChecks, Plus,
} from 'lucide-react'

/**
 * CustomerDetail — the ONE shared "individual customer view" (expanded detail
 * drawer) used by every page (Onboarding, My Customers, My Region, and the
 * forthcoming Renewals / Payments pages). Edit here once → every page that
 * expands a customer card gets the same view automatically.
 *
 * REDESIGN (Customer View mockup):
 *   Sticky header (name · location · last touch · last meeting · onboarding day ·
 *   health /9 · Start tasks) over collapsible sections — Deal Information,
 *   Contacts, Activity & Health, Onboarding, Renewal, Tasks, Notes, Meetings,
 *   Communications, Data Connections. Oswald display + Hanken Grotesk body;
 *   mockup reds/greens mapped to the app's --usr-pink / --st-* tokens.
 *
 * Data wiring — "wire what exists, stub the rest":
 *   WIRED  → header, Deal Information (DealProperties), Activity & Health
 *            (TTVPanel + WeeklyMatrix + HealthArea), Onboarding (journey +
 *            tasks), Notes (NotesPanel), Contacts (primary contact + editor),
 *            Data Connections (ConnectionsStrip).
 *   STUB   → Renewal pipeline, master cross-pipeline Tasks list, Meetings
 *            (prep + Fireflies), Communications log. These render in the new
 *            design with empty states + // TODO(data) markers; they light up
 *            once the parent pages pass the backing data.
 *
 * `isOnboarding` (default true) gates the onboarding-only pieces (TTV card,
 * 90-Day Journey + task checklist, Start-tasks button, Onboarding section).
 */

// ─── Date formatting for completion stamps ────────────────────────────────────
function fmtStamp(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// The data-matched variant for an auto_email task (transition = health trend,
// recap = TTV recap count). Returns null when it can't be determined (manual pick).
function recommendedVariant(task, c) {
  if (task.selector === 'transition') {
    const ws = (c.weeks || []).filter(w => !w.preCustomer && w.color)
    const curr = ws.length ? ws[ws.length - 1].color : c.healthColor
    const prev = ws.length >= 2 ? ws[ws.length - 2].color : curr
    return transitionVariant(prev, curr)
  }
  if (task.selector === 'recap') {
    return recapVariant(c.recapCount ?? null) // recapCount not synced yet -> null
  }
  return null
}

// ─── Health trend area chart — SAME UI as the My Customers view ──────────────
// Buckets weekly snapshots into 6 monthly color-rank slots (1–4) and draws the
// gradient area chart. Mirrors HealthTrendChart in MyRegion.jsx; uses
// STATUS_COLORS (shared) for the line/fill. `history` = weekly snapshot rows
// (any order) carrying week_start + health_color.
function HealthArea({ history }) {
  const COLOR_RANK = { green: 4, yellow: 3, orange: 2, red: 1, unknown: 1 }
  const MONTH_LABELS = ['6mo', '5mo', '4mo', '3mo', '2mo', 'Now']
  const rows = history || []
  const now = new Date()
  const slots = Array.from({ length: 6 }, (_, i) => {
    const mo = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const moStr = mo.toISOString().slice(0, 7)
    const weeksInMonth = rows.filter(s => s.week_start && s.week_start.startsWith(moStr))
    if (!weeksInMonth.length) return null
    return weeksInMonth.reduce((a, s) => a + (COLOR_RANK[s.health_color] ?? 1), 0) / weeksInMonth.length
  })
  const hasData = slots.some(v => v !== null)
  if (!hasData) {
    return (
      <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--fg-subtle)', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Builds after 2+ months</span>
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
  const area = line + ` L ${pts[pts.length - 1][0].toFixed(1)} ${h} L ${pts[0][0].toFixed(1)} ${h} Z`
  const latest = rows.reduce((m, s) => (!m || (s.week_start || '') > (m.week_start || '') ? s : m), null)
  const lastColor = STATUS_COLORS[latest?.health_color || 'unknown']
  return (
    <div className="trend-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 96, display: 'block' }}>
        <defs>
          <linearGradient id="ob-trend-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lastColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={lastColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#ob-trend-grad)" />
        <path d={line} fill="none" stroke={lastColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3.5 : 2}
            fill={i === pts.length - 1 ? lastColor : '#fff'} stroke={lastColor} strokeWidth="1.5" />
        ))}
      </svg>
      <div className="trend-foot">{MONTH_LABELS.map((m, i) => <span key={i}>{m}</span>)}</div>
    </div>
  )
}

// ─── Journey timeline (progress-driven, clickable, task counts per stage) ─────
function JourneyTimeline({ stageKey, graduated, day, catalog, doneSet, viewKey, onView }) {
  const idx = OB_INDEX[stageKey] ?? 0
  const pct = graduated ? 100 : (idx / (OB_STAGES.length - 1)) * 100
  return (
    <div className="journey">
      <div className="journey-track">
        <div className="journey-fill" style={{ width: pct + '%' }} />
        <div className="journey-now" style={{ left: pct + '%' }}>
          {day != null && <span className="jn-day">Day {day}</span>}
        </div>
      </div>
      <div className="journey-stages">
        {OB_STAGES.map((s, i) => {
          const tracked = (catalog[s.key] || []).filter(t => !t.recurring)
          const doneN = tracked.filter(t => doneSet.has(t.key)).length
          const behind = (graduated || i < idx) && doneN < tracked.length // past stage with stragglers
          return (
            <button
              key={s.key} type="button"
              onClick={() => onView(s.key)}
              title={`View ${s.label} tasks`}
              className={`jstage ${graduated || i < idx ? 'done' : ''} ${!graduated && i === idx ? 'active' : ''} ${viewKey === s.key ? 'viewing' : ''}`}
            >
              <span className="jdot">{(graduated || i < idx) ? <Check size={11} /> : null}</span>
              <span className="jlabel">{s.short}</span>
              <span className={`jcount ${behind ? 'behind' : ''}`}>{doneN}/{tracked.length}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── One task row inside a stage checklist ────────────────────────────────────
function TaskRow({ task, c, isDone, meta, onOpen, onToggle }) {
  const recVar = task.kind === 'auto_email' ? recommendedVariant(task, c) : null
  const recLabel = recVar && task.variants[recVar] ? task.variants[recVar].label : null
  const isAction = task.kind === 'action'
  const recurring = !!task.recurring
  const stamp = isDone && meta ? [meta.by, fmtStamp(meta.at)].filter(Boolean).join(' · ') : null

  return (
    <div className={`ob-action ${isDone ? 'done' : ''} ${isAction ? 'is-action' : ''}`}>
      <span className={`ob-action-pri pri-${task.priority || 'low'}`} />
      <div className="ob-action-meta">
        <div className="ob-action-name">
          {task.label} <span className="ob-chan">· {task.channel}</span>
          {task.note && <span className="ob-task-note">{task.note}</span>}
        </div>
        <div className="ob-action-reason">{task.reason}</div>
        {recLabel && <div className="ob-rec-pick"><Zap size={11} />This week: <b>{recLabel}</b></div>}
        {stamp && <div className="ob-done-stamp"><CheckCircle size={11} />Done by {stamp}</div>}
      </div>

      {isAction ? (
        <button className={`ob-check ${isDone ? 'on' : ''}`} onClick={e => { e.stopPropagation(); onToggle(!isDone) }}>
          {isDone ? <CheckSquare size={16} /> : <Square size={16} />}{isDone ? 'Done' : 'Mark done'}
        </button>
      ) : recurring ? (
        <button className="ob-action-send" onClick={e => { e.stopPropagation(); onOpen() }}>Open template →</button>
      ) : isDone ? (
        <span className="ob-sent-chip"><Check size={13} />Done
          <button onClick={e => { e.stopPropagation(); onToggle(false) }} className="ob-undo">undo</button>
        </span>
      ) : (
        <button className="ob-action-send" onClick={e => { e.stopPropagation(); onOpen() }}>Open template →</button>
      )}
    </div>
  )
}

// ─── Data Connections — how THIS customer is wired across systems ─────────────
function ConnectionsStrip({ c }) {
  const org = c.orgMatchKind || (c.orgId ? 'linked' : 'none')
  const orgMeta = {
    exact:  { label: 'Verified',       tone: '#1DB271' },
    linked: { label: 'Linked',         tone: '#1DB271' },
    fuzzy:  { label: 'Fuzzy — verify', tone: '#F2810E' },
    none:   { label: 'Not linked',     tone: '#EC3642' },
  }[org]
  const Pill = ({ tone, children, title }) => (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 700, background: '#f1f1f1', color: tone || 'var(--fg-muted)' }}>{children}</span>
  )
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12.5, color: 'var(--fg-muted)' }}>
      <span>HubSpot deal: <code>{c.dealId || '—'}</code></span>
      <span>HubSpot company:{' '}
        {c.companyId
          ? <Pill tone="#1DB271" title={`HubSpot company ${c.companyId}`}>#{c.companyId}</Pill>
          : <Pill tone="#EC3642" title="No HubSpot company linked — keyed by deal only">not linked</Pill>}
      </span>
      <span>USR DB org:{' '}
        <Pill tone={orgMeta.tone} title={c.orgName ? `USR org: ${c.orgName}${c.orgId ? ` (#${c.orgId})` : ''}` : 'No USR organization linked'}>
          {orgMeta.label}
        </Pill>
        {c.orgName && <span style={{ marginLeft: 6, color: 'var(--fg-subtle)' }}>{c.orgName}</span>}
      </span>
    </div>
  )
}

// ─── Collapsible section card (the mockup's repeating shell) ──────────────────
function Section({ icon: Icon, title, summary, open, onToggle, children }) {
  return (
    <div className="cv-sec">
      <div className="cv-sec-head" onClick={onToggle}>
        <span style={{ display: 'inline-flex', color: '#1c1c1c' }}><Icon size={19} strokeWidth={1.8} /></span>
        <div className="cv-sec-title">{title}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {summary != null && summary !== '' && <span className="cv-sec-sum">{summary}</span>}
          <ChevronDown size={16} style={{ color: '#a0a0a0', transition: 'transform .2s ease', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        </div>
      </div>
      {open && <div className="cv-sec-body">{children}</div>}
    </div>
  )
}

// ─── A "coming soon / wiring in progress" empty state for stub sections ───────
function Stub({ children }) {
  return (
    <div className="cv-stub">
      <span className="cv-stub-pill">Wiring in progress</span>
      <div>{children}</div>
    </div>
  )
}

// initials from a name ("Landon Jones" -> "LJ")
function initialsOf(name) {
  if (!name) return '—'
  const parts = String(name).trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '—'
}

// ─── The expandable drawer ────────────────────────────────────────────────────
function CustomerDetail({ c, catalog, doneSet, doneMeta, onOpenTemplate, onSetDone, onSaveCs, savingCs, hsPushState, scrollToTasks, onComplete, onSaveDeal, savingDeal, loadMeta, loadNotes, addNote, isOnboarding = true }) {
  const nextLabel = c.graduated ? null : (OB_STAGES[OB_INDEX[c.stageKey] + 1]?.label || null)

  // Section open/closed state. Activity & Health (and Onboarding when relevant)
  // start open; everything else collapsed — mirrors the mockup default.
  const [open, setOpen] = useState({
    dealInfo: false, contacts: false, activityHealth: true,
    onboarding: isOnboarding, renewal: false, tasks: false,
    notes: false, meetings: false, comms: false, connections: false,
  })
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }))
  const setAll = (v) => setOpen(o => Object.fromEntries(Object.keys(o).map(k => [k, v])))

  const [editOpen, setEditOpen] = useState(false)
  const [viewStage, setViewStage] = useState(null) // null = follow the customer's current stage
  const viewKey = viewStage || (c.graduated ? 'qbr' : c.stageKey)
  const tasksRef = useRef(null)

  // "Start tasks" (Focus Queue) opens the Onboarding section scrolled to the list.
  useEffect(() => {
    if (scrollToTasks) {
      setOpen(o => ({ ...o, onboarding: true }))
      const t = setTimeout(() => tasksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
      return () => clearTimeout(t)
    }
  }, [scrollToTasks])

  // ── header-derived values ──
  const HC = c.healthColor || 'unknown'
  const healthColor = { green: '#1DB271', yellow: '#B39600', orange: '#F2810E', red: '#EC3642', unknown: '#9a9a9a' }[HC]
  const healthBg = { green: 'rgba(29,178,113,0.10)', yellow: 'rgba(214,176,0,0.16)', orange: 'rgba(242,129,14,0.12)', red: 'rgba(236,54,66,0.10)', unknown: '#f0f0ef' }[HC]
  const locationLabel = [c.city, c.state].filter(Boolean).join(', ')

  const stageTasks = isOnboarding ? (catalog?.[c.stageKey] || []) : []
  const openTaskCount = stageTasks.filter(t => !doneSet?.has(t.key)).length

  const contactCount = c.contactName ? 1 : 0
  const healthSummary = `${c.healthScore != null ? c.healthScore : '—'}/9 health`

  return (
    <div className="cv-root">

      {/* ════ STICKY HEADER ════ */}
      <div className="cv-head" style={{ borderLeftColor: healthColor }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ width: 23, height: 23, borderRadius: '50%', background: healthColor, flex: 'none', boxShadow: `0 0 0 4px ${healthBg}`, alignSelf: 'center' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 26, color: '#1c1c1c', lineHeight: 1.1 }}>
              {c.name || c.contactName || 'Customer'}
              <div style={{ marginTop: 5, fontSize: 14, color: '#8a8a8a' }}>{locationLabel || '—'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {/* Last touch / Last meeting — TODO(data): not yet on `c`; stubbed */}
            <div style={{ textAlign: 'center' }}>
              <div className="cv-head-stat-v">—</div>
              <div className="cv-head-stat-l">Last touch</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="cv-head-stat-v">—</div>
              <div className="cv-head-stat-l">Last meeting</div>
            </div>
            {isOnboarding && c.day != null && (
              <div style={{ textAlign: 'center' }}>
                <div className="cv-head-stat-v">{c.day}<span style={{ fontSize: 13, color: '#b5b5b5' }}>/90</span></div>
                <div className="cv-head-stat-l">Onboarding day</div>
              </div>
            )}
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, padding: '3px 11px', borderRadius: 8, background: healthBg }}>
                <span style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 18, color: healthColor }}>{c.healthScore != null ? c.healthScore : '—'}</span>
                <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 500, color: healthColor, opacity: 0.65 }}>/9</span>
              </div>
              <div className="cv-head-stat-l">Health score</div>
            </div>
            {isOnboarding && (
              <div style={{ position: 'relative', display: 'inline-flex' }}>
                <button className="cv-start" onClick={() => { setOpen(o => ({ ...o, onboarding: true })); setTimeout(() => tasksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80) }}>
                  <Send size={15} />Start tasks
                </button>
                {openTaskCount > 0 && <span className="cv-start-badge">{openTaskCount}</span>}
              </div>
            )}
          </div>
        </div>
        {/* HubSpot push status — surfaced from the contact/details save flow */}
        {hsPushState === 'pushing' && <div className="ob-hs-status" style={{ marginTop: 10 }}><Loader2 size={12} className="animate-spin" />Pushing to HubSpot…</div>}
        {hsPushState === 'ok' && <div className="ob-hs-status ok" style={{ marginTop: 10 }}><CheckCircle size={12} />Pushed to HubSpot</div>}
        {hsPushState && hsPushState !== 'pushing' && hsPushState !== 'ok' && <div className="ob-hs-status err" style={{ marginTop: 10 }} title={hsPushState}>HubSpot push failed — saved internally</div>}
      </div>

      {/* ════ TOOLBAR ════ */}
      <div className="cv-toolbar">
        <div className="cv-toolbar-label">Customer Detail</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="cv-tbtn" onClick={() => setAll(true)}>Expand all</button>
          <button className="cv-tbtn" onClick={() => setAll(false)}>Collapse all</button>
        </div>
      </div>

      {/* ════ 1. DEAL INFORMATION (wired → DealProperties) ════ */}
      <Section icon={Briefcase} title="Deal Information"
        summary={[c.product, c.segment].filter(Boolean).join(' · ') || 'HubSpot deal'}
        open={open.dealInfo} onToggle={() => toggle('dealInfo')}>
        <DealProperties c={c} onSaveDeal={onSaveDeal} saving={savingDeal} loadMeta={loadMeta} />
        <div className="cv-syncline"><Link2 size={13} />Synced from HubSpot — deal is the source of truth for stage, ARR, and renewal date.</div>
      </Section>

      {/* ════ 2. CONTACTS (wired → primary contact + editor; multi-contact TODO) ════ */}
      <Section icon={Users} title="Contacts"
        summary={contactCount ? `${contactCount} contact` : 'No contact on file'}
        open={open.contacts} onToggle={() => toggle('contacts')}>
        {c.contactName ? (
          <div className="cv-contacts">
            <div className="cv-contact">
              <div className="cv-avatar">{initialsOf(c.contactName)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{c.contactName}</span>
                  <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 9.5, letterSpacing: '.05em', textTransform: 'uppercase', color: '#15924a', background: '#e6f6ec', borderRadius: 5, padding: '2px 6px', fontWeight: 500 }}>Primary</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#8a8a8a', marginTop: 2 }}>Primary Contact</div>
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
                  {c.email && <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()} style={{ color: 'var(--usr-pink)', textDecoration: 'none', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 7 }}><Mail size={14} />{c.email}</a>}
                  {c.phone && <span style={{ color: '#444', display: 'flex', alignItems: 'center', gap: 7 }}><Phone size={14} />{c.phone}</span>}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <Stub>No contact on file yet. Add one via Edit details, or it appears once HubSpot contacts sync.</Stub>
        )}
        <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="cv-tbtn" onClick={() => setEditOpen(v => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Pencil size={13} />{editOpen ? 'Close editor' : 'Edit details'}</button>
          <span style={{ fontSize: 12, color: '#a0a0a0' }}>{/* TODO(data): full multi-contact roster from HubSpot company */}Multi-contact roster syncs from HubSpot — coming soon.</span>
        </div>
        {editOpen && (
          <div style={{ marginTop: 12 }}>
            <DetailsEditor c={c} cs={c.cs} onSave={onSaveCs} saving={savingCs} onClose={() => setEditOpen(false)} />
          </div>
        )}
      </Section>

      {/* ════ 3. ACTIVITY & HEALTH (wired) ════ */}
      <Section icon={Activity} title="Activity & Health"
        summary={healthSummary} open={open.activityHealth} onToggle={() => toggle('activityHealth')}>
        <div className="cv-actband">
          {isOnboarding && (
            <div className="cv-card">
              <div className="cv-card-title">Time-to-Value</div>
              <div style={{ marginTop: 10 }}>
                <TTVPanel c={c} cs={c.cs} synced={c.ttvSynced} onSave={onSaveCs} saving={savingCs} />
              </div>
            </div>
          )}
          <div className="cv-card">
            <div className="cv-card-title">Weekly Activity · 8w</div>
            <div style={{ marginTop: 12 }}>
              {c.weeks && c.weeks.length > 0
                ? <WeeklyMatrix weeks={c.weeks} />
                : <p style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>No weekly activity yet — appears once platform usage flows.</p>}
            </div>
          </div>
          <div className="cv-card">
            <div className="cv-card-title">Monthly Health Trend</div>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 34, lineHeight: 1, color: 'var(--usr-pink)', marginTop: 8 }}>
              {c.healthScore != null ? c.healthScore : '—'}<span style={{ fontSize: 20, color: '#e8a39d' }}>/9</span>
            </div>
            <HealthArea history={c.healthHistory} />
            <div className="ob-actcard-foot" style={{ marginTop: 8 }}>{c.athletes ?? '—'} athletes (30d) · {c.prs ?? '—'} PRs (8w)</div>
          </div>
        </div>
      </Section>

      {/* ════ 4. ONBOARDING (wired → journey + tasks) ════ */}
      {isOnboarding && (
        <Section icon={Trophy} title="Onboarding"
          summary={c.graduated ? 'Graduated' : (c.day != null ? `${OB_LABEL[c.stageKey]} · Day ${c.day} of 90` : OB_LABEL[c.stageKey])}
          open={open.onboarding} onToggle={() => toggle('onboarding')}>
          <div ref={tasksRef}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#888' }}>
                90-Day Journey{!c.graduated && nextLabel ? ` · complete required steps → ${nextLabel}` : ''}
              </div>
              <span style={{ flex: 1 }} />
              <StageControl c={c} cs={c.cs} onSave={onSaveCs} saving={savingCs} />
              {onComplete && <button className="ob-complete-btn" onClick={onComplete} title="Finish onboarding — moves to My Customers"><Trophy size={13} />Complete</button>}
            </div>
            <JourneyTimeline
              stageKey={c.stageKey} graduated={c.graduated} day={c.day}
              catalog={catalog} doneSet={doneSet}
              viewKey={viewKey} onView={(k) => setViewStage(k === viewKey ? null : k)}
            />
            <div className="ob-tasks-head">
              <Send size={13} />
              Tasks · {OB_LABEL[viewKey]}
              {viewKey === c.stageKey && !c.graduated && <span className="ob-sg-now">current stage</span>}
              {viewStage && viewStage !== c.stageKey && (
                <button className="ob-back-current" onClick={() => setViewStage(null)}>← back to current stage</button>
              )}
            </div>
            {c.graduated && viewKey === 'qbr' && <div className="ob-no-actions"><CheckCircle size={16} style={{ color: 'var(--st-green)' }} />All onboarding steps complete — ready to graduate to ongoing success.</div>}
            {(catalog[viewKey] || []).length === 0 && <div className="ob-no-actions"><CheckCircle size={16} />No steps queued for this stage — keep engaging weekly.</div>}
            {(catalog[viewKey] || []).map(t => (
              <TaskRow
                key={t.key} task={t} c={c} isDone={doneSet.has(t.key)}
                meta={doneMeta ? doneMeta[t.key] : null}
                onOpen={() => onOpenTemplate(c, t)}
                onToggle={(v) => onSetDone(t.key, v)}
              />
            ))}
            {gatingKeys(viewKey).length > 0 && (
              <div className="ob-gate-note">{gatingKeys(viewKey).filter(k => doneSet.has(k)).length}/{gatingKeys(viewKey).length} required steps done to advance</div>
            )}
          </div>
        </Section>
      )}

      {/* ════ 5. RENEWAL (stub — TODO(data): renewal pipeline) ════ */}
      <Section icon={RefreshCw} title="Renewal"
        summary="Not yet in window" open={open.renewal} onToggle={() => toggle('renewal')}>
        <Stub>
          The renewal pipeline (6-month → 90 / 60 / 30-day → close) lights up as the account approaches its renewal window.
          {/* TODO(data): mirror the onboarding journey using renewal stage + renewal_date from HubSpot. */}
        </Stub>
      </Section>

      {/* ════ 6. TASKS — master cross-pipeline list (stub) ════ */}
      <Section icon={ListChecks} title="Tasks"
        summary={isOnboarding ? `${openTaskCount} open in onboarding` : ''}
        open={open.tasks} onToggle={() => toggle('tasks')}>
        <Stub>
          A single list of every task across Onboarding, Renewal, and custom-created tasks — with a "create a task for this customer" box that syncs to HubSpot.
          {' '}Onboarding tasks are live in the Onboarding section above; the unified list is being wired.
          {/* TODO(data): aggregate catalog tasks (all stages) + renewal tasks + custom tasks; add create-task → HubSpot. */}
        </Stub>
      </Section>

      {/* ════ 7. NOTES (wired → NotesPanel) ════ */}
      <Section icon={StickyNote} title="Notes"
        summary="Synced from HubSpot" open={open.notes} onToggle={() => toggle('notes')}>
        <NotesPanel dealId={c.dealId} loadNotes={loadNotes} addNote={addNote} />
      </Section>

      {/* ════ 8. MEETINGS (stub — TODO(data): Fireflies + prep checklists) ════ */}
      <Section icon={Calendar} title="Meetings"
        summary="" open={open.meetings} onToggle={() => toggle('meetings')}>
        <Stub>
          Scheduled and past meetings with prep checklists and Fireflies notes, plus schedule-from-template (Kick-Off, Implementation, 30/60-Day, QBR, Renewal…).
          {/* TODO(data): pull meetings + Fireflies transcripts; reuse meeting templates from the vault SOP. */}
        </Stub>
      </Section>

      {/* ════ 9. COMMUNICATIONS (stub — TODO(data): HubSpot comms log) ════ */}
      <Section icon={Mail} title="Communications"
        summary="" open={open.comms} onToggle={() => toggle('comms')}>
        <Stub>
          The email / text / call log for this account, inbound and outbound, synced from HubSpot.
          {/* TODO(data): HubSpot engagements (emails, calls, notes) timeline. */}
        </Stub>
      </Section>

      {/* ════ DATA CONNECTIONS (wired) ════ */}
      <Section icon={Link2} title="Data Connections"
        summary="HubSpot ↔ USR DB" open={open.connections} onToggle={() => toggle('connections')}>
        <ConnectionsStrip c={c} />
      </Section>

    </div>
  )
}

export default CustomerDetail
