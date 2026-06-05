import { useState, useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/fetchAll'
import { openGmailDraft, logComm } from '../lib/gmailDraft'
import TemplateEditor from './TemplateEditor'
import {
  OB_STAGES, OB_INDEX, OB_LABEL, STATUS_COLORS, CATALOG, TTV_TARGET, TTV_WINDOW_DAYS,
  mergeOverrides, gatingKeys, kickoffComplete, transitionVariant, recapVariant, fillTokens,
} from '../lib/onboardingCatalog'
import {
  Activity, Bell, ChevronDown, Mail, Phone, Calendar, Zap, Check, Settings,
  CheckCircle, Send, Copy, ArrowRight, User, Loader2, TrendingUp, CheckSquare, Square,
} from 'lucide-react'

/**
 * Onboarding — Admin (Customer Success Hub). First-90-days workflow.
 *
 * Journey = the 8-step USR onboarding playbook (Hand-off -> Kick-off -> TTV
 * Sprint -> Impl -> 30-Day -> 30-60 -> 60-90 -> QBR). It is CSM-DRIVEN: a
 * customer sits at the first stage whose GATING tasks aren't all done; completing
 * a stage's gating tasks advances them. Each stage shows its full checklist —
 * operational 'action' steps AND 'email'/'auto_email' sends, interleaved.
 *
 * The catalog (steps + copy) lives in src/lib/onboardingCatalog.js as code
 * defaults; admins can edit/finalize copy live via the Template Editor, which
 * saves overrides to Supabase (onboarding_templates) merged on top here.
 *
 * Progress is stored in Supabase (onboarding_progress), shared across the CS
 * team — INTERNAL only, never written to HubSpot. Day-of-90 (contract_start_date)
 * is context. Weekly 'auto_email' activity sends are RECURRING: they surface the
 * data-matched variant each week but do not gate the stage.
 *
 * Phase 2 (next): TTV "session recap" counts (assessments_prod) need an
 * Athena->Supabase sync. Until then TTV widgets show a "syncing" state and the
 * TTV check-in email is picked manually. NO fabricated recap numbers.
 */

// Cohort = these HubSpot Onboarding stages. Fallback day used only for the
// day-of-90 health windows when contract_start_date isn't on file.
const EARLY_STAGES = ['On Deck', 'Level Set', 'First 30 Days', 'First 90 Days']
const HUBSPOT_FALLBACK_DAY = { 'On Deck': 1, 'Level Set': 3, 'First 30 Days': 20, 'First 90 Days': 60 }

const EMPTY_SET = new Set()

// Current journey stage = first stage whose GATING tasks aren't all done.
function deriveStage(catalog, doneSet) {
  for (const s of OB_STAGES) {
    const gates = gatingKeys(s.key)
    const complete = gates.length === 0 || gates.every(k => doneSet.has(k))
    if (!complete) return { stageKey: s.key, graduated: false }
  }
  return { stageKey: 'qbr', graduated: true }
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

// localStorage fallback (only used if the onboarding_progress table isn't reachable)
const PROGRESS_LS = 'usr_ob_progress'
function loadLocalProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_LS) || '{}')
    const map = {}; Object.entries(raw).forEach(([k, v]) => map[k] = new Set(v)); return map
  } catch { return {} }
}
function saveLocalProgress(map) {
  try { localStorage.setItem(PROGRESS_LS, JSON.stringify(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]])))) } catch { /* ignore */ }
}

// ─── Mini health sparkline ────────────────────────────────────────────────────
function HealthTrend({ values, color = '#EC3642' }) {
  if (!values || values.length < 2) return <span style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>not enough data yet</span>
  const w = 100, h = 34, max = 9, min = 0
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 4) + 2
    const y = h - 3 - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (h - 6)
    return [x, y]
  })
  const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 40 }}>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  )
}

// ─── Journey timeline (progress-driven) ───────────────────────────────────────
function JourneyTimeline({ stageKey, graduated, day }) {
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
        {OB_STAGES.map((s, i) => (
          <div key={s.key} className={`jstage ${graduated || i < idx ? 'done' : ''} ${!graduated && i === idx ? 'active' : ''}`}>
            <span className="jdot">{(graduated || i < idx) ? <Check size={11} /> : null}</span>
            <span className="jlabel">{s.short}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Weekly activity matrix ───────────────────────────────────────────────────
function tier(metric, v) {
  if (v == null || v === 0) return 0
  if (metric === 'logins')     return v >= 6 ? 3 : v >= 3 ? 2 : 1
  if (metric === 'datapoints') return v >= 25 ? 3 : v >= 10 ? 2 : 1
  return v >= 4 ? 3 : v >= 2 ? 2 : 1 // prs
}
function ActivityMatrix({ weeks }) {
  const slots = Array.from({ length: 8 }, (_, i) => weeks[i] || { preCustomer: true })
  const HEAD = ['8w', '', '', '', '', '', '', 'now']
  return (
    <>
      <div className="wk-matrix">
        <span className="wk-corner" />
        {HEAD.map((hd, i) => <span className="wk-head" key={'h' + i}>{hd}</span>)}
        <span className="wk-rowlabel">Activity</span>
        {slots.map((wk, i) => (
          <span key={'a' + i} className={`wk-act ${wk.preCustomer ? 'pre' : wk.color === 'green' ? 'on' : 'off'}`} />
        ))}
        <span className="wk-rowlabel">Logins</span>
        {slots.map((wk, i) => <span key={'l' + i} className={`wk-cell ${wk.preCustomer ? 'pre' : 'tier-' + tier('logins', wk.logins)}`}>{wk.preCustomer ? '·' : (wk.logins ?? 0)}</span>)}
        <span className="wk-rowlabel">Data pts</span>
        {slots.map((wk, i) => <span key={'d' + i} className={`wk-cell ${wk.preCustomer ? 'pre' : 'tier-' + tier('datapoints', wk.datapoints)}`}>{wk.preCustomer ? '·' : (wk.datapoints ?? 0)}</span>)}
        <span className="wk-rowlabel">New PRs</span>
        {slots.map((wk, i) => <span key={'p' + i} className={`wk-cell ${wk.preCustomer ? 'pre' : 'tier-' + tier('prs', wk.prs)}`}>{wk.preCustomer ? '·' : (wk.prs ?? 0)}</span>)}
      </div>
      <div className="weeks-legend">
        <span><i style={{ background: 'var(--st-green)' }} />Active</span>
        <span><i style={{ background: '#DADCDE' }} />No activity</span>
        <span><i style={{ background: 'repeating-linear-gradient(45deg,#E6E8EA,#E6E8EA 3px,#F4F5F6 3px,#F4F5F6 6px)' }} />Pre-join</span>
      </div>
    </>
  )
}

// ─── TTV tracker (per-customer; recap counts arrive with Phase 2 sync) ────────
function TTVTracker({ started }) {
  return (
    <div className="ttv-block st-syncing">
      <div className="ttv-top">
        <div className="ttv-figure"><span className="ttv-done" style={{ color: 'var(--fg-subtle)' }}>—</span><span className="ttv-target">/ {TTV_TARGET}</span></div>
        <div>
          <div className="ttv-name">Session recaps · {TTV_WINDOW_DAYS}-day window</div>
          <div className="ttv-status" style={{ color: 'var(--fg-subtle)' }}>{started ? 'Window open' : 'Clock not started'}</div>
        </div>
      </div>
      <div className="ttv-syncing-note">
        <Loader2 size={13} className="animate-spin" />
        {started ? 'Window open — recap counts sync from the platform next' : 'Clock starts when the kick-off stage is complete'}
      </div>
    </div>
  )
}

// ─── Template compose modal (handles email + auto_email variants) ─────────────
function TemplateModal({ task, ctx, recVar, done, recurring, onMarkDone, onClose }) {
  const isAuto = task.kind === 'auto_email'
  const variantKeys = isAuto ? Object.keys(task.variants || {}) : []
  const [vKey, setVKey] = useState(isAuto ? (recVar || variantKeys[0]) : null)
  const active = isAuto ? task.variants[vKey] : task
  const channel = task.channel === 'Text' ? 'Text' : 'Email'

  const [subject, setSubject] = useState(fillTokens(active.subject, ctx))
  const [body, setBody] = useState(fillTokens(active.body, ctx))
  const [flash, setFlash] = useState(false)

  // Re-seed copy when the variant changes.
  useEffect(() => {
    const a = isAuto ? task.variants[vKey] : task
    setSubject(fillTokens(a.subject, ctx)); setBody(fillTokens(a.body, ctx))
  }, [vKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const doCopy = () => {
    const text = (active.subject ? 'Subject: ' + subject + '\n\n' : '') + body
    if (navigator.clipboard) navigator.clipboard.writeText(text)
    setFlash(true); setTimeout(() => setFlash(false), 1800)
  }
  const openInGmail = () => {
    openGmailDraft({ to: ctx.email, subject, body }) // BCC to HubSpot added automatically
    logComm({ dealId: ctx.dealId, channel, subject, toEmail: ctx.email, templateKey: isAuto ? `${task.key}:${vKey}` : task.key, loggedBy: ctx.csm })
  }

  return (
    <div className="ob-modal-overlay" onClick={onClose}>
      <div className="ob-modal-card" onClick={e => e.stopPropagation()}>
        <div className="ob-modal-head">
          <span className="status-dot" style={{ background: 'var(--usr-pink)', width: 16, height: 16 }} />
          <div>
            <div className="ob-modal-lab">{ctx.lab}</div>
            <div className="ob-modal-trig"><span className="ob-tg">{task.label}</span>{channel} · to {ctx.owner}</div>
            <div className="ob-modal-reason"><b>Why now:</b> {task.reason}</div>
          </div>
          <button className="ob-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="ob-modal-body">
          {isAuto && (
            <>
              <div className="ob-field-label">
                Which message<span className="ob-edit-tag">{recVar ? 'auto-picked from ' + task.selectorLabel : 'recap count not synced — pick the match'}</span>
              </div>
              <div className="ob-variant-row">
                {variantKeys.map(k => (
                  <button key={k} className={`ob-variant ${vKey === k ? 'active' : ''} ${recVar === k ? 'rec' : ''}`} onClick={() => setVKey(k)}>
                    {task.variants[k].label}{recVar === k && <span className="ob-variant-rec">●</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          {active.subject && (
            <>
              <div className="ob-field-label">Subject<span className="ob-edit-tag">editable</span></div>
              <input className="ob-subj" value={subject} onChange={e => setSubject(e.target.value)} />
            </>
          )}
          <div className="ob-field-label">Message<span className="ob-edit-tag">prefilled · edit before you {channel === 'Text' ? 'copy' : 'send'}</span></div>
          <textarea className="ob-bodytext" value={body} onChange={e => setBody(e.target.value)} />
        </div>
        <div className="ob-modal-actions">
          {channel === 'Email' && ctx.email && (
            <button className="btn btn-primary" onClick={openInGmail}><Mail size={14} />Open in Gmail</button>
          )}
          <button className={`btn ${channel === 'Email' && ctx.email ? 'btn-outline' : 'btn-primary'}`} onClick={doCopy}><Copy size={14} />Copy {channel === 'Text' ? 'text' : 'message'}</button>
          <span className={`ob-copy-flash ${flash ? 'show' : ''}`}><Check size={14} />Copied</span>
          <span style={{ flex: 1 }} />
          {recurring
            ? <span className="ob-recurring-note">Weekly send — not tracked as a one-time step</span>
            : done
              ? <span className="ob-sent-chip"><CheckCircle size={15} />Completed</span>
              : <button className="btn btn-outline" onClick={onMarkDone}><Check size={14} />Mark done &amp; advance</button>}
        </div>
      </div>
    </div>
  )
}

// ─── One task row inside a stage checklist ────────────────────────────────────
function TaskRow({ task, c, isDone, onOpen, onToggle }) {
  const recVar = task.kind === 'auto_email' ? recommendedVariant(task, c) : null
  const recLabel = recVar && task.variants[recVar] ? task.variants[recVar].label : null
  const isAction = task.kind === 'action'
  const recurring = !!task.recurring

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

// ─── Onboarding customer card ─────────────────────────────────────────────────
function ObCard({ c, catalog, open, onToggle, doneSet, onOpenTemplate, onSetDone }) {
  const color  = c.healthColor || 'unknown'
  const sColor = STATUS_COLORS[color]
  const tasks = catalog[c.stageKey] || []
  const gates = gatingKeys(c.stageKey)
  const pending = tasks.filter(t => !t.recurring && !doneSet.has(t.key))
  const nextLabel = c.graduated ? null : (OB_STAGES[OB_INDEX[c.stageKey] + 1]?.label || null)
  const ttvStarted = kickoffComplete(doneSet)

  return (
    <div className={`ob-card ${open ? 'open' : ''}`}>
      <div className="ob-row" onClick={onToggle}>
        <span className="status-dot" style={{ background: sColor }} />
        <div className="lab-id">
          <div className="lab-name-row">
            <span className="lab-name">{c.name}</span>
            {c.isNew && <span className="lab-new-tag">NEW</span>}
            {pending.length > 0 && <span className="email-tag"><CheckSquare size={11} />{pending.length}</span>}
          </div>
          <div className="lab-loc">
            {[c.city, c.state].filter(Boolean).join(', ')}
            {c.athletes != null && <> · {c.athletes} athletes</>}
            {c.healthScore != null && <> · {c.healthScore}/9 health</>}
          </div>
        </div>
        <div className="ob-stage-col"><span className="stage-pill" style={c.graduated ? { background: 'var(--st-green-bg)', color: 'var(--st-green)', borderColor: 'rgba(29,178,113,0.3)' } : undefined}>{c.graduated ? 'Graduated' : OB_STAGES[OB_INDEX[c.stageKey]].short}</span></div>
        <div className="ob-day-col">
          <div className="day-badge"><span className="dn">{c.day != null ? c.day : '—'}</span><span className="dt">/ 90</span></div>
        </div>
        <div className="ob-ttv-col">
          <div className="ttv-mini syncing">{ttvStarted ? 'TTV: window open' : 'TTV: not started'}</div>
        </div>
        <div className={`lab-chev ${open ? 'open' : ''}`}><ChevronDown size={22} /></div>
      </div>

      {open && (
        <div className="ob-detail">
          <div className="detail-block" style={{ gridColumn: '1 / -1' }}>
            <h4><Activity size={14} />90-Day Journey · {c.graduated ? 'Graduated' : OB_LABEL[c.stageKey]}</h4>
            <JourneyTimeline stageKey={c.stageKey} graduated={c.graduated} day={c.day} />
          </div>

          <div className="detail-block">
            <h4><Zap size={14} />Time-to-Value</h4>
            <TTVTracker started={ttvStarted} />
          </div>

          <div className="detail-block">
            <h4><TrendingUp size={14} />Health Trend</h4>
            <div className="trend-now">
              <span className="v" style={{ color: 'var(--usr-pink)' }}>{c.healthScore != null ? c.healthScore : '—'}<span style={{ fontSize: 18, color: 'var(--fg-subtle)' }}>/9</span></span>
            </div>
            <HealthTrend values={c.healthTrend} color="#EC3642" />
            <div className="mini-metrics">
              <div className="mm"><div className="v">{c.athletes ?? '—'}</div><div className="l">Athletes (30d)</div></div>
              <div className="mm"><div className="v">{c.prs ?? '—'}</div><div className="l">New PRs (8w)</div></div>
              <div className="mm"><div className="v">{c.day != null ? c.day : '—'}</div><div className="l">Day of 90</div></div>
            </div>
          </div>

          <div className="detail-block">
            <h4><User size={14} />Contact</h4>
            {c.contactName && <div className="contact-owner">{c.contactName}</div>}
            {c.email ? <div className="contact-row"><Mail size={15} style={{ color: 'var(--fg-subtle)' }} /><span className="ct"><a href={`mailto:${c.email}`} style={{ color: 'var(--usr-pink)', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>{c.email}</a></span></div>
              : <div className="contact-row"><Mail size={15} style={{ color: 'var(--fg-subtle)' }} /><span className="ct" style={{ color: 'var(--fg-subtle)' }}>no email on file</span></div>}
            {c.phone && <div className="contact-row"><Phone size={15} style={{ color: 'var(--fg-subtle)' }} /><span className="ct">{c.phone}</span></div>}
            <div className="contact-row"><User size={15} style={{ color: 'var(--fg-subtle)' }} /><span className="ct">Director: {c.director || 'Unassigned'}</span></div>
            <div className="contact-row"><Calendar size={15} style={{ color: 'var(--fg-subtle)' }} /><span className="ct">Owner: {c.owner || 'Unassigned'}</span></div>
          </div>

          <div className="detail-block" style={{ gridColumn: '1 / -1' }}>
            <h4><Zap size={14} />Weekly Activity · last 8 weeks</h4>
            {c.weeks.length > 0
              ? <ActivityMatrix weeks={c.weeks} />
              : <p style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>No weekly activity data yet (Speed Lab platform usage appears here once it flows).</p>}
          </div>

          {/* Stage checklist — full width */}
          <div className="detail-block" style={{ gridColumn: '1 / -1' }}>
            <h4>
              <Send size={14} />Stage Checklist · {c.graduated ? 'Graduated' : OB_LABEL[c.stageKey]}
              {!c.graduated && nextLabel && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--fg-subtle)', textTransform: 'none', letterSpacing: 0 }}>complete the steps to advance → {nextLabel}</span>}
            </h4>
            {c.graduated && <div className="ob-no-actions"><CheckCircle size={16} style={{ color: 'var(--st-green)' }} />All onboarding steps complete — ready to graduate to ongoing success.</div>}
            {!c.graduated && tasks.length === 0 && <div className="ob-no-actions"><CheckCircle size={16} />No steps queued for this stage — keep engaging weekly.</div>}
            {!c.graduated && tasks.map(t => (
              <TaskRow
                key={t.key} task={t} c={c} isDone={doneSet.has(t.key)}
                onOpen={() => onOpenTemplate(c, t)}
                onToggle={(v) => onSetDone(t.key, v)}
              />
            ))}
            {!c.graduated && gates.length > 0 && (
              <div className="ob-gate-note">
                {gates.filter(k => doneSet.has(k)).length}/{gates.length} required steps done to advance
                {pending.filter(t => t.kind !== 'action').length === 0 ? '' : ''}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Onboarding() {
  const { director } = useAuth()
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState([])
  const [snaps, setSnaps] = useState([])
  const [scoreMap, setScoreMap] = useState({})
  const [trendMap, setTrendMap] = useState({})
  const [scoreMapDeal, setScoreMapDeal] = useState({})
  const [trendMapDeal, setTrendMapDeal] = useState({})
  const [doneMap, setDoneMap] = useState({})
  const [overrides, setOverrides] = useState([])
  const localMode = useRef(false)
  const [ttvByDeal, setTtvByDeal] = useState({})
  const [ttvAvailable, setTtvAvailable] = useState(false)
  const [ownerEmail, setOwnerEmail] = useState(null)
  const [filter, setFilter] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [modal, setModal] = useState(null)        // { customer, task, recVar }
  const [editorOpen, setEditorOpen] = useState(false)

  const catalog = useMemo(() => mergeOverrides(overrides), [overrides])

  async function loadOverrides() {
    const { data, error } = await supabase.from('onboarding_templates').select('*')
    if (!error) setOverrides(data || [])
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [acctRes, allSnaps, monthRows, progRes, ttvRes, tplRes] = await Promise.all([
        supabase.from('lab_accounts').select('*'),
        fetchAllRows('weekly_health_snapshots'),
        fetchAllRows('monthly_health_snapshots', 'lab_name, deal_id, month, health_score'),
        supabase.from('onboarding_progress').select('deal_id, action_key'),
        supabase.from('onboarding_ttv').select('deal_id, status, days_to_five'),
        supabase.from('onboarding_templates').select('*'),
      ])
      if (cancelled) return
      setAccounts(acctRes.data || [])
      setSnaps(allSnaps)
      const monthRes = { data: monthRows }

      const sMap = {}, tMap = {}, seen = {}
      const sMapD = {}, tMapD = {}, seenD = {}
      ;(monthRes.data || [])
        .filter(m => m.health_score != null)
        .sort((a, b) => (a.month || '').localeCompare(b.month || ''))
        .forEach(m => {
          if (m.lab_name) {
            ;(tMap[m.lab_name] = tMap[m.lab_name] || []).push(m.health_score)
            if (!seen[m.lab_name] || m.month >= seen[m.lab_name]) { seen[m.lab_name] = m.month; sMap[m.lab_name] = m.health_score }
          }
          if (m.deal_id) {
            ;(tMapD[m.deal_id] = tMapD[m.deal_id] || []).push(m.health_score)
            if (!seenD[m.deal_id] || m.month >= seenD[m.deal_id]) { seenD[m.deal_id] = m.month; sMapD[m.deal_id] = m.health_score }
          }
        })
      setScoreMap(sMap); setTrendMap(tMap)
      setScoreMapDeal(sMapD); setTrendMapDeal(tMapD)

      if (progRes.error) {
        localMode.current = true
        setDoneMap(loadLocalProgress())
      } else {
        const map = {}
        ;(progRes.data || []).forEach(r => { (map[r.deal_id] = map[r.deal_id] || new Set()).add(r.action_key) })
        setDoneMap(map)
      }

      if (!tplRes.error) setOverrides(tplRes.data || [])

      if (ttvRes.error || !(ttvRes.data && ttvRes.data.length)) {
        setTtvByDeal({}); setTtvAvailable(false)
      } else {
        const m = {}
        ttvRes.data.forEach(r => { m[r.deal_id] = { status: r.status, daysToFive: r.days_to_five } })
        setTtvByDeal(m); setTtvAvailable(true)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  const setDone = async (dealId, actionKey, value) => {
    setDoneMap(prev => {
      const next = { ...prev }
      const set = new Set(next[dealId] || [])
      if (value) set.add(actionKey); else set.delete(actionKey)
      next[dealId] = set
      if (localMode.current) saveLocalProgress(next)
      return next
    })
    if (localMode.current) return
    try {
      if (value) {
        await supabase.from('onboarding_progress').upsert(
          { deal_id: dealId, action_key: actionKey, completed_by: director?.name || director?.email || null },
          { onConflict: 'deal_id,action_key' },
        )
      } else {
        await supabase.from('onboarding_progress').delete().match({ deal_id: dealId, action_key: actionKey })
      }
    } catch {
      localMode.current = true
      setDoneMap(prev => { saveLocalProgress(prev); return prev })
    }
  }

  const weeklyByLab = useMemo(() => {
    const m = {}
    snaps.forEach(s => { if (s.lab_name) (m[s.lab_name] = m[s.lab_name] || []).push(s) })
    Object.values(m).forEach(arr => arr.sort((a, b) => (a.week_start || '').localeCompare(b.week_start || '')))
    return m
  }, [snaps])
  const weeklyByDeal = useMemo(() => {
    const m = {}
    snaps.forEach(s => { if (s.deal_id) (m[s.deal_id] = m[s.deal_id] || []).push(s) })
    Object.values(m).forEach(arr => arr.sort((a, b) => (a.week_start || '').localeCompare(b.week_start || '')))
    return m
  }, [snaps])

  const daysSince = (d) => {
    if (!d) return null
    const days = Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000)
    return days >= 0 ? days : null
  }

  const cohort = useMemo(() => {
    return accounts
      .filter(a => EARLY_STAGES.includes(a.deal_stage_label) && a.is_returning !== true)
      .map(a => {
        const lab = a.lab_name
        const weekly = (lab && weeklyByLab[lab]) || weeklyByDeal[a.deal_id] || []
        const last8 = weekly.slice(-8).map(w => ({ color: w.health_color, logins: w.logins_week, datapoints: w.data_pts_week, prs: w.prs_week, preCustomer: false }))
        const latest = weekly[weekly.length - 1]
        const realDay = daysSince(a.contract_start_date)
        const doneSet = doneMap[a.deal_id] || EMPTY_SET
        const { stageKey, graduated } = deriveStage(catalog, doneSet)
        return {
          dealId: a.deal_id,
          name: a.company_name || lab || '(unnamed customer)',
          city: a.company_city, state: a.company_state,
          hubspotStage: a.deal_stage_label,
          stageKey, graduated,
          effDay: realDay != null ? realDay : (HUBSPOT_FALLBACK_DAY[a.deal_stage_label] ?? 1),
          day: realDay,
          isNew: stageKey === 'handoff' || stageKey === 'kickoff' || (realDay != null && realDay <= 3),
          healthColor: latest?.health_color || 'unknown',
          healthScore: (lab ? scoreMap[lab] : undefined) ?? scoreMapDeal[a.deal_id] ?? null,
          healthTrend: (lab && trendMap[lab]) || trendMapDeal[a.deal_id] || [],
          athletes: latest?.athletes_added_week ?? null,
          logins: latest?.logins_week ?? null,
          datapoints: latest?.data_pts_week ?? null,
          prs: last8.reduce((sum, w) => sum + (w.prs || 0), 0) || null,
          weeks: last8,
          contactName: a.contact_name, email: a.contact_email, phone: a.contact_phone,
          director: a.speed_lab_director || a.director_name || null,
          owner: a.deal_owner_name, ownerEmail: a.deal_owner_email,
          recapCount: null, // Phase 2: from assessments_prod sync
          doneSet,
        }
      })
  }, [accounts, weeklyByLab, weeklyByDeal, scoreMap, scoreMapDeal, trendMap, trendMapDeal, doneMap, catalog])

  const owners = useMemo(() => {
    const byEmail = {}
    cohort.forEach(c => {
      if (!c.ownerEmail && !c.owner) return
      const key = c.ownerEmail || c.owner
      if (!byEmail[key]) byEmail[key] = { email: c.ownerEmail, name: c.owner || c.ownerEmail, count: 0 }
      byEmail[key].count++
    })
    return Object.values(byEmail).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [cohort])

  useEffect(() => {
    if (ownerEmail !== null || loading) return
    const mine = director?.email && owners.find(o => o.email && o.email.toLowerCase() === director.email.toLowerCase())
    setOwnerEmail(mine ? mine.email : 'all')
  }, [owners, loading, director, ownerEmail])

  const selected = ownerEmail ?? 'all'
  const ownerScoped = useMemo(() => (
    selected === 'all' ? cohort : cohort.filter(c => (c.ownerEmail || '__none__') === selected)
  ), [cohort, selected])

  const counts = {}
  OB_STAGES.forEach(s => counts[s.key] = 0)
  ownerScoped.forEach(c => { counts[c.stageKey]++ })

  const HEALTH_ORDER = { red: 0, orange: 1, yellow: 2, green: 3, unknown: 4 }
  let list = filter ? ownerScoped.filter(c => c.stageKey === filter) : ownerScoped.slice()
  list.sort((a, b) => (HEALTH_ORDER[a.healthColor] - HEALTH_ORDER[b.healthColor]) || (a.effDay - b.effDay))

  const pendingTaskCount = (c) => c.graduated ? 0 : (catalog[c.stageKey] || []).filter(t => !t.recurring && !c.doneSet.has(t.key)).length
  const newCust = ownerScoped.filter(c => c.isNew)
  const pendingSteps = ownerScoped.reduce((n, c) => n + pendingTaskCount(c), 0)
  const offTrack = ownerScoped.filter(c => c.healthColor === 'red' || c.healthColor === 'orange').length

  const avgScoreIn = (lo, hi) => {
    const inWin = ownerScoped.filter(c => c.effDay >= lo && c.effDay < hi)
    const v = inWin.map(c => c.healthScore).filter(x => x != null)
    return { avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, n: inWin.length }
  }
  const w3060 = avgScoreIn(30, 60)
  const w6090 = avgScoreIn(60, 90)

  const eligible   = ownerScoped.filter(c => kickoffComplete(c.doneSet))
  const notStarted = ownerScoped.length - eligible.length
  let ttvPassed = null, ttvInProg = null, ttvFailed = null, ttvAvgDays = null, ttvPassRate = null
  if (ttvAvailable) {
    ttvPassed = eligible.filter(c => ttvByDeal[c.dealId]?.status === 'passed').length
    ttvInProg = eligible.filter(c => ttvByDeal[c.dealId]?.status === 'in_progress').length
    ttvFailed = eligible.filter(c => ttvByDeal[c.dealId]?.status === 'failed').length
    const days = eligible.map(c => ttvByDeal[c.dealId]).filter(t => t?.status === 'passed' && t.daysToFive != null).map(t => t.daysToFive)
    ttvAvgDays = days.length ? (days.reduce((a, b) => a + b, 0) / days.length) : null
    ttvPassRate = eligible.length ? Math.round((ttvPassed / eligible.length) * 100) : 0
  }
  const ttvCirc = 2 * Math.PI * 52

  const csmName = director?.name || 'your USR lead'
  const tplCtx = (c) => ({
    owner: (c.contactName || '').split(' ')[0] || c.contactName || 'there',
    lab: c.name, csm: csmName, director: c.director,
    score: c.healthScore, athletes: c.athletes, day: c.day,
    logins: c.logins, datapoints: c.datapoints,
    email: c.email, dealId: c.dealId,
  })

  const openTemplate = (customer, task) => {
    const recVar = task.kind === 'auto_email' ? recommendedVariant(task, customer) : null
    setModal({ customer, task, recVar })
  }

  if (loading) return (
    <div className="screen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ textAlign: 'center' }}>
        <Loader2 size={26} className="animate-spin" style={{ color: 'var(--usr-pink)' }} />
        <div style={{ marginTop: 12, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-subtle)' }}>Loading onboarding...</div>
      </div>
    </div>
  )

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="topbar-eyebrow">USR Customer Success · {ownerScoped.length} in onboarding</div>
          <h1 className="topbar-title">Onboarding</h1>
        </div>
        <div className="topbar-meta">
          {director?.is_admin && (
            <button className="btn btn-outline" onClick={() => setEditorOpen(true)} style={{ marginRight: 12 }}>
              <Settings size={14} />Edit templates
            </button>
          )}
          <div className="tm" style={{ textAlign: 'right' }}>
            <div className="tm-label">Deal owner</div>
            <select
              value={selected}
              onChange={e => setOwnerEmail(e.target.value)}
              style={{ marginTop: 4, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--usr-black)', background: 'var(--usr-white)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '7px 10px', cursor: 'pointer', minWidth: 180 }}
            >
              <option value="all">All deals</option>
              {owners.map(o => <option key={o.email || o.name} value={o.email || '__none__'}>{o.name} ({o.count})</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Action banner */}
      <div className="notif">
        <div className="notif-bell"><Bell size={22} />{pendingSteps > 0 && <span className="ping" />}</div>
        <div className="notif-copy">
          <div className="notif-title">{pendingSteps} onboarding {pendingSteps === 1 ? 'step' : 'steps'} ready</div>
          <div className="notif-sub">{offTrack} customer{offTrack !== 1 ? 's' : ''} off-track · {newCust.length} brand new · complete a stage's steps to advance the customer</div>
        </div>
        <div className="notif-breakdown">
          <div className="notif-chip"><div className="n" style={{ color: 'var(--st-orange)' }}>{offTrack}</div><div className="l">Off-Track</div></div>
          <div className="notif-chip"><div className="n" style={{ color: 'var(--st-yellow)' }}>{pendingSteps}</div><div className="l">To do</div></div>
          <div className="notif-chip"><div className="n" style={{ color: 'var(--st-green)' }}>{newCust.length}</div><div className="l">Brand new</div></div>
        </div>
      </div>

      {/* Hero: TTV (left) + two stacked health windows (right) */}
      <div className="ob-hero">
        <div className="hero-card">
          <div className="hero-head"><span className="hero-label">TTV · 5 Session Recaps in 7 Days</span></div>
          <div className="hero-body">
            <div className="mini-ring">
              <svg viewBox="0 0 132 132">
                <circle cx="66" cy="66" r="52" fill="none" stroke="var(--bg-alt)" strokeWidth="11" />
                {ttvAvailable && (
                  <circle cx="66" cy="66" r="52" fill="none" stroke="var(--st-green)" strokeWidth="11"
                    strokeDasharray={`${(ttvCirc * (ttvPassRate || 0) / 100).toFixed(1)} ${ttvCirc.toFixed(1)}`} />
                )}
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                {ttvAvailable ? (
                  <>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 34, lineHeight: 1, color: 'var(--usr-black)' }}>{ttvPassRate}%</span>
                    <span style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>pass rate</span>
                  </>
                ) : (
                  <>
                    <Loader2 size={22} className="animate-spin" style={{ color: 'var(--fg-subtle)' }} />
                    <span style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 6, fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Syncing</span>
                  </>
                )}
              </div>
            </div>
            <div className="hero-side">
              <div className="ttv-funnel">
                <div className="ttv-fchip"><span className="n" style={{ color: 'var(--st-green)' }}>{ttvPassed != null ? ttvPassed : '—'}</span><span className="l">Passed</span></div>
                <div className="ttv-fchip"><span className="n" style={{ color: 'var(--st-yellow)' }}>{ttvInProg != null ? ttvInProg : '—'}</span><span className="l">In progress</span></div>
                <div className="ttv-fchip"><span className="n" style={{ color: 'var(--st-red)' }}>{ttvFailed != null ? ttvFailed : '—'}</span><span className="l">Failed</span></div>
              </div>
              <div className="ttv-avg"><span className="n">{ttvAvgDays != null ? ttvAvgDays.toFixed(1) : '—'}</span><span className="l">avg days to 5 recaps (on-time)</span></div>
              <div className="ttv-hnote">{eligible.length} clock started · {notStarted} not started (kick-off pending) · 7-day window from kick-off</div>
              {!ttvAvailable && <div className="ttv-hsync"><Loader2 size={12} className="animate-spin" />recap counts sync next</div>}
            </div>
          </div>
        </div>

        <div className="ob-hero-stack">
          <div className="hero-card dark ob-hero-mini">
            <div className="hero-head"><span className="hero-label">Avg Health · Days 30–60</span></div>
            <div className="hero-body">
              <span className="ob-mini-num" style={{ color: 'var(--usr-white)' }}>{w3060.avg != null ? w3060.avg.toFixed(1) : '—'}<span className="suf">/9</span></span>
              <span className="ob-mini-foot">{w3060.n} customer{w3060.n !== 1 ? 's' : ''} in the 30–60 day window · watch weekly activity closely</span>
            </div>
          </div>
          <div className="hero-card dark ob-hero-mini">
            <div className="hero-head"><span className="hero-label">Avg Health · Days 60–90</span></div>
            <div className="hero-body">
              <span className="ob-mini-num" style={{ color: 'var(--st-green)' }}>{w6090.avg != null ? w6090.avg.toFixed(1) : '—'}<span className="suf">/9</span></span>
              <span className="ob-mini-foot">{w6090.n} customer{w6090.n !== 1 ? 's' : ''} approaching the 90-day QBR &amp; game-planning session</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline */}
      <div className="section">
        <div className="section-head"><h3>90-Day Pipeline</h3><span style={{ flex: 1 }} />{filter && <button className="btn btn-ghost" onClick={() => setFilter(null)}>Clear filter ✕</button>}</div>
        <div className="pipeline">
          {OB_STAGES.map((s, i) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className={`pl-stage ${filter === s.key ? 'active' : ''} ${counts[s.key] === 0 ? 'empty' : ''}`} onClick={() => setFilter(filter === s.key ? null : s.key)}>
                <span className="pl-n">{counts[s.key]}</span>
                <span className="pl-l">{s.short}</span>
              </button>
              {i < OB_STAGES.length - 1 && <span className="pl-arrow"><ArrowRight size={14} /></span>}
            </div>
          ))}
        </div>
      </div>

      {/* New customers spotlight */}
      {!filter && newCust.length > 0 && (
        <div className="section">
          <div className="collapsible spotlight">
            <div className="collapse-head" style={{ cursor: 'default' }}>
              <div className="collapse-badge">{newCust.length}</div>
              <div>
                <div className="collapse-title">New · Just Handed Off</div>
                <div className="collapse-sub">Make first contact and book the kick-off call fast</div>
              </div>
            </div>
            <div className="collapse-body">
              {newCust.map(c => <ObCard key={c.dealId} c={c} catalog={catalog} open={openId === c.dealId} onToggle={() => setOpenId(openId === c.dealId ? null : c.dealId)} doneSet={c.doneSet} onOpenTemplate={openTemplate} onSetDone={(k, v) => setDone(c.dealId, k, v)} />)}
            </div>
          </div>
        </div>
      )}

      {/* All onboarding customers */}
      <div className="section">
        <div className="section-head">
          <h3>{filter ? OB_LABEL[filter] : 'All Onboarding Customers'}</h3>
          <span className="count-pill">{list.length}</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: 'var(--fg-muted)', fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sorted by attention needed</span>
        </div>
        {list.length === 0 ? (
          <div className="stub" style={{ minHeight: 220 }}>
            <div className="stub-mark"><Activity size={26} /></div>
            <h2 style={{ fontSize: 24 }}>No customers in onboarding here</h2>
            <p style={{ maxWidth: 420 }}>{selected === 'all' ? 'No active customers are in early stages (On Deck → First 90 Days) right now.' : 'No early-stage customers owned by this person. Try “All deals.”'}</p>
          </div>
        ) : (
          <div className="lab-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map(c => <ObCard key={c.dealId} c={c} catalog={catalog} open={openId === c.dealId} onToggle={() => setOpenId(openId === c.dealId ? null : c.dealId)} doneSet={c.doneSet} onOpenTemplate={openTemplate} onSetDone={(k, v) => setDone(c.dealId, k, v)} />)}
          </div>
        )}
      </div>

      {modal && (
        <TemplateModal
          task={modal.task}
          recVar={modal.recVar}
          recurring={!!modal.task.recurring}
          ctx={tplCtx(modal.customer)}
          done={(doneMap[modal.customer.dealId] || EMPTY_SET).has(modal.task.key)}
          onMarkDone={() => { setDone(modal.customer.dealId, modal.task.key, true); setModal(null) }}
          onClose={() => setModal(null)}
        />
      )}

      {editorOpen && (
        <TemplateEditor
          overrides={overrides}
          editorName={director?.name || director?.email || null}
          onSaved={loadOverrides}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  )
}
