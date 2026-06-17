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
import { TTVPanel, StageControl, DetailsEditor, effectiveTtv, TTV_STATUS_META } from '../components/OnboardingControls'
import WeeklyMatrix from '../components/WeeklyMatrix'
import {
  Activity, Bell, ChevronDown, Mail, Phone, Zap, Check, Settings,
  CheckCircle, Send, Copy, ArrowRight, User, Loader2, CheckSquare, Square, Pencil, StickyNote,
  GripVertical, LayoutGrid, Layers, ListChecks, AlertTriangle,
} from 'lucide-react'

// ─── Stage presentation: accent color + one-line description per journey stage ─
// Keyed to OB_STAGES. Accents follow the USR status ramp (pink → green → black).
const STAGE_META = {
  handoff:   { accent: 'var(--usr-pink)',  desc: 'Make first contact and book the kick-off call fast' },
  kickoff:   { accent: 'var(--st-orange)', desc: 'Run the kick-off call and start the TTV clock' },
  ttv:       { accent: 'var(--st-yellow)', desc: 'Drive 5 session recaps inside the 7-day window' },
  impl:      { accent: 'var(--st-green)',  desc: 'Confirm rollout, roster and adoption plan' },
  checkin30: { accent: 'var(--st-green)',  desc: 'Review early wins and weekly usage' },
  day3060:   { accent: 'var(--st-green)',  desc: 'Deepen adoption and expand athletes' },
  day6090:   { accent: 'var(--st-green)',  desc: 'Prep the quarterly business review' },
  qbr:       { accent: 'var(--usr-black)', desc: 'Run the review and lock the renewal path' },
}

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

// ─── Weekly activity matrix ───────────────────────────────────────────────────
function tier(metric, v) {
  if (v == null || v === 0) return 0
  if (metric === 'logins')     return v >= 6 ? 3 : v >= 3 ? 2 : 1
  if (metric === 'datapoints') return v >= 25 ? 3 : v >= 10 ? 2 : 1
  return v >= 4 ? 3 : v >= 2 ? 2 : 1 // prs
}
// Weekly activity now renders via the shared components/WeeklyMatrix.jsx —
// the canonical display used by every page. Do not re-implement locally.

// ─── Date formatting for completion stamps ────────────────────────────────────
function fmtStamp(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
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

// ─── Per-customer pipeline-card decoration (TTV chip, overdue, attention score) ─
// Stage normally derives from completed gating tasks; a manual ADVANCE/drag sets
// a stage_override that pins the card ahead. Unfinished required steps from
// EARLIER stages then travel with the deal as "overdue" — surfaced here, never
// silently marked done.
function decorateCard(c, catalog) {
  const ttv = effectiveTtv({ cs: c.cs, synced: c.ttvSynced, doneSet: c.doneSet })
  const ttvMeta = TTV_STATUS_META[ttv.status] || TTV_STATUS_META.not_started
  const curIdx = OB_INDEX[c.stageKey] ?? 0
  let overdue = 0
  for (const s of OB_STAGES) {
    if ((OB_INDEX[s.key] ?? 0) >= curIdx) break
    gatingKeys(s.key).forEach(k => { if (!c.doneSet.has(k)) overdue++ })
  }
  const pending = c.graduated ? 0 : (catalog[c.stageKey] || []).filter(t => !t.recurring && !c.doneSet.has(t.key)).length
  let task = null
  if (c.healthColor === 'red') task = { text: 'AT RISK · NO ACTIVITY', kind: 'red' }
  else if (ttv.status === 'review') task = { text: 'TTV WINDOW ELAPSED', kind: 'orange' }
  else if (overdue > 0) task = { text: `${overdue} OVERDUE STEP${overdue > 1 ? 'S' : ''}`, kind: 'red' }
  else if (c.healthColor === 'orange') task = { text: 'OFF-TRACK · STALE', kind: 'orange' }
  const needsAction = !!task
  const sev = ({ red: 300, orange: 150, yellow: 40, green: 0, unknown: 20 })[c.healthColor] || 0
  const score = (ttv.status === 'review' ? 200 : 0) + sev + overdue * 60 + (9 - (c.healthScore ?? 5)) * 5 + (c.day || 0) * 0.1
  const next = c.graduated ? null : (OB_STAGES[curIdx + 1]?.key || null)
  const meta = [
    [c.city, c.state].filter(Boolean).join(', '),
    c.athletes != null ? `${c.athletes} athletes` : null,
    c.healthScore != null ? `${c.healthScore}/9 health` : null,
  ].filter(Boolean).join(' · ')
  const chipText = `TTV: ${ttvMeta.label}` + (ttv.status === 'in_progress' && ttv.sessions != null ? ` · ${ttv.sessions}/${TTV_TARGET}` : '')
  return { ttv, ttvMeta, overdue, pending, task, needsAction, score, next, meta, chipText, chipColor: ttvMeta.color }
}

// ─── The expandable drawer (contact, activity/health, journey + task checklist) ─
// Extracted so every pipeline view (Smart Stack, Kanban, Focus Queue) opens the
// SAME rich detail — the place the actual CS work happens.
function ObCardDetail({ c, catalog, doneSet, doneMeta, onOpenTemplate, onSetDone, onSaveCs, savingCs, hsPushState }) {
  const nextLabel = c.graduated ? null : (OB_STAGES[OB_INDEX[c.stageKey] + 1]?.label || null)
  const [editOpen, setEditOpen] = useState(false)
  const [viewStage, setViewStage] = useState(null) // null = follow the customer's current stage
  const viewKey = viewStage || (c.graduated ? 'qbr' : c.stageKey)

  return (
        <div className="ob-detail">
          {/* 1. Contact strip — who to reach, one line, at the top */}
          <div className="detail-block ob-contact-strip" style={{ gridColumn: '1 / -1' }}>
            <span className="ob-cs-name"><User size={14} />{c.contactName || 'No contact on file'}</span>
            {c.email && <a className="ob-cs-item link" href={`mailto:${c.email}`} onClick={e => e.stopPropagation()}><Mail size={13} />{c.email}</a>}
            {c.phone && <span className="ob-cs-item"><Phone size={13} />{c.phone}</span>}
            <span className="ob-cs-item">Director: <b>{c.director || '—'}</b></span>
            <span className="ob-cs-item">Owner: <b>{c.owner || '—'}</b></span>
            <span style={{ flex: 1 }} />
            <button className={`ob-icon-btn ob-notes-btn ${c.cs?.notes ? 'has-notes' : ''}`} onClick={() => setEditOpen(o => !o)} title={c.cs?.notes ? `Team notes: ${c.cs.notes.slice(0, 120)}` : 'No team notes yet — click to add'}>
              <StickyNote size={14} />{c.cs?.notes && <i className="ob-notes-dot" />}
            </button>
            <button className="ob-icon-btn" onClick={() => setEditOpen(o => !o)} title="Edit contact, director, notes"><Pencil size={13} /></button>
            {hsPushState === 'pushing' && <span className="ob-hs-status"><Loader2 size={12} className="animate-spin" />Pushing to HubSpot…</span>}
            {hsPushState === 'ok' && <span className="ob-hs-status ok"><CheckCircle size={12} />Pushed to HubSpot</span>}
            {hsPushState && hsPushState !== 'pushing' && hsPushState !== 'ok' && <span className="ob-hs-status err" title={hsPushState}>HubSpot push failed — saved internally</span>}
          </div>
          {editOpen && (
            <div className="detail-block" style={{ gridColumn: '1 / -1' }}>
              <DetailsEditor c={c} cs={c.cs} onSave={onSaveCs} saving={savingCs} onClose={() => setEditOpen(false)} />
            </div>
          )}

          {/* 2. Activity band — TTV / weekly activity / health, one compact row */}
          <div className="detail-block" style={{ gridColumn: '1 / -1' }}>
            <h4><Zap size={14} />Activity &amp; Health</h4>
            <div className="ob-actband">
              <div className="ob-actcard">
                <div className="ob-actcard-title">Time-to-Value</div>
                <TTVPanel c={c} cs={c.cs} synced={c.ttvSynced} onSave={onSaveCs} saving={savingCs} />
              </div>
              <div className="ob-actcard">
                <div className="ob-actcard-title">Weekly Activity · 8w</div>
                {c.weeks.length > 0
                  ? <WeeklyMatrix weeks={c.weeks} />
                  : <p style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>No weekly activity yet — appears once platform usage flows.</p>}
              </div>
              <div className="ob-actcard">
                <div className="ob-actcard-title">Health Trend</div>
                <div className="trend-now">
                  <span className="v" style={{ color: 'var(--usr-pink)' }}>{c.healthScore != null ? c.healthScore : '—'}<span style={{ fontSize: 16, color: 'var(--fg-subtle)' }}>/9</span></span>
                </div>
                <HealthTrend values={c.healthTrend} color="#EC3642" />
                <div className="ob-actcard-foot">{c.athletes ?? '—'} athletes (30d) · {c.prs ?? '—'} PRs (8w)</div>
              </div>
            </div>
          </div>

          {/* 3. Journey + tasks — red-dot timeline drives the task list below */}
          <div className="detail-block" style={{ gridColumn: '1 / -1' }}>
            <h4>
              <Activity size={14} />90-Day Journey · {c.graduated ? 'Graduated' : OB_LABEL[c.stageKey]}
              {!c.graduated && nextLabel && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--fg-subtle)', textTransform: 'none', letterSpacing: 0 }}>complete required steps → {nextLabel}</span>}
              <span style={{ flex: 1 }} />
              <StageControl c={c} cs={c.cs} onSave={onSaveCs} saving={savingCs} />
            </h4>
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
        </div>
  )
}

// ─── Full-width pipeline card — Smart Stack rows + Focus Queue ─────────────────
// Drag to move stage; click anywhere (except the grip/advance) to open the drawer.
function PipelineCard({ c, d, open, onToggle, onAdvance, onDragStart, children }) {
  const edge = d.task ? (d.task.kind === 'red' ? 'var(--st-red)' : 'var(--st-orange)') : 'transparent'
  return (
    <div className={`ob-pcard ${d.needsAction ? 'need' : ''} ${open ? 'open' : ''}`}>
      <div className="ob-pcard-row" draggable onDragStart={onDragStart} onClick={onToggle} style={{ borderLeftColor: edge }}>
        <span className="ob-pcard-grip" title="Drag to move stage"><GripVertical size={16} /></span>
        <span className="status-dot" style={{ background: STATUS_COLORS[c.healthColor || 'unknown'] }} />
        <div className="ob-pcard-main">
          <div className="ob-pcard-namerow">
            <span className="ob-pcard-name">{c.name}</span>
            {c.isNew && <span className="ob-tag-new">NEW</span>}
            {d.pending > 0 && <span className="ob-tag-step">{d.pending} TO DO</span>}
            {d.task && <span className={`ob-tag-task ${d.task.kind}`}>{d.task.text}</span>}
          </div>
          <div className="ob-pcard-meta">{d.meta || '—'}</div>
        </div>
        <div className="ob-pcard-day">{c.day != null ? c.day : '—'}<span> /90</span></div>
        <div className="ob-pcard-chip" style={{ color: d.chipColor, borderColor: d.chipColor }}>{d.chipText}</div>
        <button className="ob-adv-btn" onClick={e => { e.stopPropagation(); onAdvance() }}>{d.next ? 'ADVANCE →' : '✓ DONE'}</button>
        <span className={`ob-pcard-chev ${open ? 'open' : ''}`}><ChevronDown size={18} /></span>
      </div>
      {open && children}
    </div>
  )
}

// ─── Compact Kanban card — drag between columns; click opens the drawer modal ──
function KanbanCard({ c, d, onOpen, onAdvance, onDragStart }) {
  const edge = d.task ? (d.task.kind === 'red' ? 'var(--st-red)' : 'var(--st-orange)') : 'var(--border)'
  return (
    <div className="ob-kcard" draggable onDragStart={onDragStart} onClick={onOpen} style={{ borderLeftColor: edge }}>
      <div className="ob-kcard-top">
        <span className="status-dot" style={{ background: STATUS_COLORS[c.healthColor || 'unknown'] }} />
        <span className="ob-kcard-name">{c.name}</span>
        {c.isNew && <span className="ob-tag-new">NEW</span>}
      </div>
      {d.task && <div><span className={`ob-tag-task ${d.task.kind}`} style={{ marginTop: 8 }}>{d.task.text}</span></div>}
      <div className="ob-kcard-meta">{d.meta || '—'}</div>
      <div className="ob-kcard-foot">
        <span className="ob-kcard-chip" style={{ color: d.chipColor }}>{d.chipText}</span>
        <button className="ob-adv-btn sm" onClick={e => { e.stopPropagation(); onAdvance() }}>{d.next ? 'ADVANCE →' : '✓'}</button>
      </div>
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
  const [doneMetaMap, setDoneMetaMap] = useState({})   // dealId -> { action_key: { by, at } }
  const [overrides, setOverrides] = useState([])
  const localMode = useRef(false)
  const [ttvByDeal, setTtvByDeal] = useState({})
  const [csByDeal, setCsByDeal] = useState({})         // dealId -> onboarding_cs row
  const [savingCs, setSavingCs] = useState(false)
  const [hsPush, setHsPush] = useState({})             // dealId -> 'pushing' | 'ok' | error string
  const [ownerEmail, setOwnerEmail] = useState(null)
  const [filter, setFilter] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [modal, setModal] = useState(null)        // { customer, task, recVar }
  const [editorOpen, setEditorOpen] = useState(false)
  const [pipelineView, setPipelineView] = useState('stack') // stack | board | focus
  const [sortMode, setSortMode] = useState('priority')       // priority | health | days
  const [expandedBuckets, setExpandedBuckets] = useState({ handoff: true })
  const [focusStage, setFocusStage] = useState('handoff')
  const dragId = useRef(null)

  const catalog = useMemo(() => mergeOverrides(overrides), [overrides])

  async function loadOverrides() {
    const { data, error } = await supabase.from('onboarding_templates').select('*')
    if (!error) setOverrides(data || [])
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [acctRes, allSnaps, monthRows, progRes, ttvRes, tplRes, csRes] = await Promise.all([
        supabase.from('lab_accounts').select('*'),
        fetchAllRows('weekly_health_snapshots'),
        fetchAllRows('monthly_health_snapshots', 'lab_name, deal_id, month, health_score'),
        supabase.from('onboarding_progress').select('deal_id, action_key, completed_by, completed_at'),
        supabase.from('onboarding_ttv').select('deal_id, status, days_to_five, recaps_in_window'),
        supabase.from('onboarding_templates').select('*'),
        supabase.from('onboarding_cs').select('*'),
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
        const map = {}, metaMap = {}
        ;(progRes.data || []).forEach(r => {
          ;(map[r.deal_id] = map[r.deal_id] || new Set()).add(r.action_key)
          ;(metaMap[r.deal_id] = metaMap[r.deal_id] || {})[r.action_key] = { by: r.completed_by, at: r.completed_at }
        })
        setDoneMap(map); setDoneMetaMap(metaMap)
      }

      if (!tplRes.error) setOverrides(tplRes.data || [])

      if (ttvRes.error || !(ttvRes.data && ttvRes.data.length)) {
        setTtvByDeal({})
      } else {
        const m = {}
        ttvRes.data.forEach(r => { m[r.deal_id] = { status: r.status, daysToFive: r.days_to_five, recapsInWindow: r.recaps_in_window } })
        setTtvByDeal(m)
      }

      if (!csRes.error) {
        const m = {}
        ;(csRes.data || []).forEach(r => { m[r.deal_id] = r })
        setCsByDeal(m)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Save to the per-deal CS record + append timestamped events, then push any
  // HubSpot-owned fields to HubSpot in real time via the Netlify Function
  // (the browser never holds the HubSpot token).
  const HS_PUSHABLE = ['kickoff_date', 'contact_name', 'contact_email', 'contact_phone', 'speed_lab_director']
  const saveCs = async (dealId, patch, events = []) => {
    const prevRow = csByDeal[dealId] || { deal_id: dealId }
    const actor = director?.name || director?.email || null
    setCsByDeal(prev => ({ ...prev, [dealId]: { ...prevRow, ...patch, updated_by: actor, updated_at: new Date().toISOString() } }))
    setSavingCs(true)
    try {
      const { error } = await supabase.from('onboarding_cs').upsert(
        { deal_id: dealId, ...patch, updated_by: actor },
        { onConflict: 'deal_id' },
      )
      if (error) throw error
      if (events.length) {
        await supabase.from('onboarding_events').insert(
          events.map(e => ({ deal_id: dealId, actor, ...e })),
        )
      }
    } catch (e) {
      setCsByDeal(prev => ({ ...prev, [dealId]: prevRow })) // roll back optimistic update
      console.error('onboarding_cs save failed (did the 2026-06-12 migration run?)', e)
      alert('Save failed — run the 2026-06-12 onboarding execution migration in Supabase, then retry.')
      setSavingCs(false)
      return
    }
    setSavingCs(false)

    // Real-time HubSpot push (fire-and-report; internal save already succeeded)
    const changes = {}
    HS_PUSHABLE.forEach(k => { if (k in patch) changes[k] = patch[k] })
    if (!Object.keys(changes).length) return
    setHsPush(prev => ({ ...prev, [dealId]: 'pushing' }))
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/.netlify/functions/hubspot-writeback', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ dealId, changes }),
      })
      const res = await r.json().catch(() => ({}))
      if (r.ok && res.ok) {
        setHsPush(prev => ({ ...prev, [dealId]: 'ok' }))
        setCsByDeal(prev => ({ ...prev, [dealId]: { ...(prev[dealId] || {}), hs_pushed_at: new Date().toISOString() } }))
      } else {
        setHsPush(prev => ({ ...prev, [dealId]: res.error || (res.errors || []).join('; ') || `HTTP ${r.status}` }))
      }
    } catch (e) {
      setHsPush(prev => ({ ...prev, [dealId]: String(e.message || e) }))
    }
  }

  const setDone = async (dealId, actionKey, value) => {
    setDoneMetaMap(prev => {
      const next = { ...prev, [dealId]: { ...(prev[dealId] || {}) } }
      if (value) next[dealId][actionKey] = { by: director?.name || director?.email || null, at: new Date().toISOString() }
      else delete next[dealId][actionKey]
      return next
    })
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
        const last8 = weekly.slice(-8).map(w => ({ color: w.health_color, recaps: w.recaps_week, logins: w.logins_week, datapoints: w.data_pts_week, athletes: w.athletes_added_week, prs: w.prs_week, preCustomer: false }))
        const latest = weekly[weekly.length - 1]
        const doneSet = doneMap[a.deal_id] || EMPTY_SET
        const derived = deriveStage(catalog, doneSet)
        const cs = csByDeal[a.deal_id] || null
        // Day-of-90 anchors on the explicit kick-off date when set (the journey
        // starts at kick-off); falls back to HubSpot's contract_start_date.
        const realDay = daysSince(cs?.kickoff_date || a.contract_start_date)
        // Manual stage override (set by a CSM in the dashboard) wins over the
        // checklist-derived stage. 'Auto' = no override row / null.
        const stageKey = cs?.stage_override || derived.stageKey
        const graduated = cs?.stage_override ? false : derived.graduated
        return {
          cs,
          derivedStageKey: derived.stageKey,
          ttvSynced: ttvByDeal[a.deal_id] || null,
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
          // Dashboard edits (onboarding_cs) win over HubSpot-synced values.
          contactName: cs?.contact_name ?? a.contact_name,
          email: cs?.contact_email ?? a.contact_email,
          phone: cs?.contact_phone ?? a.contact_phone,
          director: cs?.speed_lab_director ?? (a.speed_lab_director || a.director_name || null),
          // Base (HubSpot-synced) values, for the editor's diff + event log.
          baseContactName: a.contact_name, baseEmail: a.contact_email,
          basePhone: a.contact_phone, baseDirector: a.speed_lab_director || a.director_name || null,
          owner: a.deal_owner_name, ownerEmail: a.deal_owner_email,
          recapCount: ttvByDeal[a.deal_id]?.recapsInWindow ?? cs?.sessions_manual ?? null, // drives the TTV email auto-pick
          doneSet,
        }
      })
  }, [accounts, weeklyByLab, weeklyByDeal, scoreMap, scoreMapDeal, trendMap, trendMapDeal, doneMap, catalog, csByDeal, ttvByDeal])

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

  // Effective TTV per customer: CS pass/fail mark > platform-synced > derived
  // from kick-off date + session count. Clock = explicit kick-off date or
  // kick-off checklist complete.
  const ttvStates = ownerScoped.map(c => ({ c, t: effectiveTtv({ cs: c.cs, synced: c.ttvSynced, doneSet: c.doneSet }) }))
  const eligible   = ttvStates.filter(x => x.t.clockStarted)
  const notStarted = ownerScoped.length - eligible.length
  const ttvPassed  = eligible.filter(x => x.t.status === 'passed').length
  const ttvFailed  = eligible.filter(x => x.t.status === 'failed').length
  const ttvInProg  = eligible.length - ttvPassed - ttvFailed // in window + needs-review
  const ttvDays    = eligible.map(x => x.c.ttvSynced).filter(t => t?.status === 'passed' && t.daysToFive != null).map(t => t.daysToFive)
  const ttvAvgDays = ttvDays.length ? (ttvDays.reduce((a, b) => a + b, 0) / ttvDays.length) : null
  const ttvPassRate = eligible.length ? Math.round((ttvPassed / eligible.length) * 100) : 0
  const ttvTracked = eligible.length > 0
  const ttvCirc = 2 * Math.PI * 52

  // ── Pipeline views: decorate, group by stage, sort, drag-to-advance ──────────
  const decoMap = useMemo(() => {
    const m = {}
    ownerScoped.forEach(c => { m[c.dealId] = decorateCard(c, catalog) })
    return m
  }, [ownerScoped, catalog])

  const byStage = useMemo(() => {
    const m = {}
    OB_STAGES.forEach(s => { m[s.key] = [] })
    ownerScoped.forEach(c => { if (m[c.stageKey]) m[c.stageKey].push(c) })
    const sc = id => decoMap[id]?.score ?? 0
    const cmp = sortMode === 'health'
      ? (a, b) => ((a.healthScore ?? 9) - (b.healthScore ?? 9)) || (sc(b.dealId) - sc(a.dealId))
      : sortMode === 'days'
        ? (a, b) => ((b.day || 0) - (a.day || 0)) || (sc(b.dealId) - sc(a.dealId))
        : (a, b) => sc(b.dealId) - sc(a.dealId)
    Object.values(m).forEach(arr => arr.sort(cmp))
    return m
  }, [ownerScoped, decoMap, sortMode])

  // Weekly-activity rollup for the TTV hero card
  const actCounts = { green: 0, yellow: 0, orange: 0, red: 0, unknown: 0 }
  ownerScoped.forEach(c => { actCounts[c.healthColor] = (actCounts[c.healthColor] || 0) + 1 })
  const actTotal = ownerScoped.length || 1
  const greenPct = Math.round((actCounts.green / actTotal) * 100)
  const pct = n => (n / actTotal) * 100 + '%'

  const moveStage = (c, key) => {
    if (!key || key === c.stageKey) return
    saveCs(c.dealId, { stage_override: key }, [{ kind: 'stage_move', field: 'stage', old_value: c.stageKey, new_value: key }])
  }
  const onCardDragStart = (c) => (e) => {
    dragId.current = c.dealId
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(c.dealId)) } catch (_) { /* ignore */ }
  }
  const dropToStage = (key) => {
    const id = dragId.current
    dragId.current = null
    if (id == null) return
    const c = ownerScoped.find(x => x.dealId === id)
    if (c) moveStage(c, key)
  }
  const allowDrop = (e) => e.preventDefault()
  const toggleBucket = (k) => setExpandedBuckets(p => ({ ...p, [k]: !p[k] }))
  const drawerProps = (c) => ({
    c, catalog, doneSet: c.doneSet, doneMeta: doneMetaMap[c.dealId],
    onOpenTemplate: openTemplate, onSetDone: (k, v) => setDone(c.dealId, k, v),
    onSaveCs: (patch, events) => saveCs(c.dealId, patch, events), savingCs, hsPushState: hsPush[c.dealId],
  })

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
                {ttvTracked && (
                  <circle cx="66" cy="66" r="52" fill="none" stroke="var(--st-green)" strokeWidth="11"
                    strokeDasharray={`${(ttvCirc * (ttvPassRate || 0) / 100).toFixed(1)} ${ttvCirc.toFixed(1)}`} />
                )}
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                {ttvTracked ? (
                  <>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 34, lineHeight: 1, color: 'var(--usr-black)' }}>{ttvPassRate}%</span>
                    <span style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>pass rate</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, lineHeight: 1, color: 'var(--fg-subtle)' }}>—</span>
                    <span style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 6, fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>No clocks started</span>
                  </>
                )}
              </div>
            </div>
            <div className="hero-side">
              <div className="ttv-funnel">
                <div className="ttv-fchip"><span className="n" style={{ color: 'var(--st-green)' }}>{ttvTracked ? ttvPassed : '—'}</span><span className="l">Passed</span></div>
                <div className="ttv-fchip"><span className="n" style={{ color: 'var(--st-yellow)' }}>{ttvTracked ? ttvInProg : '—'}</span><span className="l">In progress</span></div>
                <div className="ttv-fchip"><span className="n" style={{ color: 'var(--st-red)' }}>{ttvFailed || ttvTracked ? ttvFailed : '—'}</span><span className="l">Failed</span></div>
              </div>
              <div className="ttv-avg"><span className="n">{ttvAvgDays != null ? ttvAvgDays.toFixed(1) : '—'}</span><span className="l">avg days to 5 recaps (on-time)</span></div>
              <div className="ttv-hnote">{eligible.length} clock started · {notStarted} not started (set a kick-off date to start) · {TTV_WINDOW_DAYS}-day window from kick-off</div>
            </div>
          </div>
          <div className="ob-wact">
            <div className="ob-wact-head">Weekly Activity</div>
            <div className="ob-wact-body">
              <div className="ob-wact-figure">
                <span className="ob-wact-pct">{greenPct}%</span>
                <span className="ob-wact-lab">Green · active this week</span>
                <span className="ob-wact-sub">{actCounts.green} of {ownerScoped.length} customers</span>
              </div>
              <div className="ob-wact-right">
                <div className="ob-wact-bar">
                  <span style={{ width: pct(actCounts.green), background: 'var(--st-green)' }} />
                  <span style={{ width: pct(actCounts.yellow), background: 'var(--st-yellow)' }} />
                  <span style={{ width: pct(actCounts.orange), background: 'var(--st-orange)' }} />
                  <span style={{ width: pct(actCounts.red), background: 'var(--st-red)' }} />
                </div>
                <div className="ob-wact-chips">
                  <div className="ob-wact-chip"><span className="d" style={{ background: 'var(--st-yellow)' }} /><b>{actCounts.yellow}</b><span>Light</span></div>
                  <div className="ob-wact-chip"><span className="d" style={{ background: 'var(--st-orange)' }} /><b>{actCounts.orange}</b><span>Stale</span></div>
                  <div className="ob-wact-chip"><span className="d" style={{ background: 'var(--st-red)' }} /><b>{actCounts.red}</b><span>At risk</span></div>
                </div>
              </div>
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

      {/* 90-Day pipeline — Smart Stack / Kanban Board / Focus Queue */}
      <div className="ob-pl">
        <div className="ob-pl-head">
          <h2 className="ob-pl-title">90-Day Pipeline</h2>
          <div className="ob-seg">
            <button className={pipelineView === 'stack' ? 'active' : ''} onClick={() => setPipelineView('stack')}><Layers size={14} />Smart Stack</button>
            <button className={pipelineView === 'board' ? 'active' : ''} onClick={() => setPipelineView('board')}><LayoutGrid size={14} />Kanban Board</button>
            <button className={pipelineView === 'focus' ? 'active' : ''} onClick={() => setPipelineView('focus')}><ListChecks size={14} />Focus Queue</button>
          </div>
          <div className="ob-pl-sort">
            <label>Sort</label>
            <select value={sortMode} onChange={e => setSortMode(e.target.value)}>
              <option value="priority">Priority (open tasks first)</option>
              <option value="health">Worst health first</option>
              <option value="days">Most days in stage</option>
            </select>
          </div>
        </div>

        {ownerScoped.length === 0 ? (
          <div className="stub" style={{ minHeight: 220 }}>
            <div className="stub-mark"><Activity size={26} /></div>
            <h2 style={{ fontSize: 24 }}>No customers in onboarding here</h2>
            <p style={{ maxWidth: 420 }}>{selected === 'all' ? 'No active customers are in early stages (On Deck → First 90 Days) right now.' : 'No early-stage customers owned by this person. Try “All deals.”'}</p>
          </div>
        ) : pipelineView === 'stack' ? (
          /* ── SMART STACK — collapsible stage buckets, needs-action first ── */
          <div className="ob-stack">
            {OB_STAGES.map(s => {
              const arr = byStage[s.key]
              const sm = STAGE_META[s.key] || {}
              const needs = arr.filter(c => decoMap[c.dealId]?.needsAction)
              const onTrack = arr.filter(c => !decoMap[c.dealId]?.needsAction)
              const expanded = !!expandedBuckets[s.key]
              return (
                <div key={s.key} className="ob-bucket" onDragOver={allowDrop} onDrop={() => dropToStage(s.key)}>
                  <div className="ob-bucket-head" onClick={() => toggleBucket(s.key)}>
                    <span className="ob-bucket-badge" style={{ background: sm.accent }}>{arr.length}</span>
                    <div className="ob-bucket-id">
                      <div className="ob-bucket-title">{s.label}</div>
                      <div className="ob-bucket-desc">{sm.desc}</div>
                    </div>
                    {needs.length > 0 && <span className="ob-bucket-need">{needs.length} NEED ACTION</span>}
                    <span className={`ob-bucket-chev ${expanded ? 'open' : ''}`}><ChevronDown size={18} /></span>
                  </div>
                  {expanded && (
                    <div className="ob-bucket-body">
                      {needs.length > 0 && <div className="ob-grouplabel need">▲ Needs action · {needs.length}</div>}
                      {needs.map(c => (
                        <PipelineCard key={c.dealId} c={c} d={decoMap[c.dealId]} open={openId === c.dealId}
                          onToggle={() => setOpenId(openId === c.dealId ? null : c.dealId)}
                          onAdvance={() => moveStage(c, decoMap[c.dealId].next)} onDragStart={onCardDragStart(c)}>
                          <ObCardDetail {...drawerProps(c)} />
                        </PipelineCard>
                      ))}
                      {onTrack.length > 0 && <div className="ob-grouplabel">On track · {onTrack.length}</div>}
                      {onTrack.map(c => (
                        <PipelineCard key={c.dealId} c={c} d={decoMap[c.dealId]} open={openId === c.dealId}
                          onToggle={() => setOpenId(openId === c.dealId ? null : c.dealId)}
                          onAdvance={() => moveStage(c, decoMap[c.dealId].next)} onDragStart={onCardDragStart(c)}>
                          <ObCardDetail {...drawerProps(c)} />
                        </PipelineCard>
                      ))}
                      {arr.length === 0 && <div className="ob-bucket-empty">No customers in this stage · drag a card here to move it in.</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : pipelineView === 'board' ? (
          /* ── KANBAN BOARD — a column per stage, drag between ── */
          <div className="ob-kanban">
            {OB_STAGES.map(s => {
              const arr = byStage[s.key]
              const sm = STAGE_META[s.key] || {}
              return (
                <div key={s.key} className="ob-kcol" onDragOver={allowDrop} onDrop={() => dropToStage(s.key)}>
                  <div className="ob-kcol-head">
                    <span className="ob-kcol-accent" style={{ background: sm.accent }} />
                    <span className="ob-kcol-label">{s.short}</span>
                    <span className="ob-kcol-count">{arr.length}</span>
                  </div>
                  <div className="ob-kcol-body">
                    {arr.map(c => (
                      <KanbanCard key={c.dealId} c={c} d={decoMap[c.dealId]}
                        onOpen={() => setOpenId(c.dealId)}
                        onAdvance={() => moveStage(c, decoMap[c.dealId].next)} onDragStart={onCardDragStart(c)} />
                    ))}
                    {arr.length === 0 && <div className="ob-kdrop">DROP HERE</div>}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* ── FOCUS QUEUE — one stage at a time, "next up" featured ── */
          <div className="ob-focus">
            <div className="ob-focus-tabs">
              {OB_STAGES.map(s => (
                <button key={s.key} className={`ob-focus-tab ${focusStage === s.key ? 'active' : ''}`} onClick={() => setFocusStage(s.key)}>
                  <span className="n">{byStage[s.key].length}</span><span className="l">{s.short}</span>
                </button>
              ))}
            </div>
            {(() => {
              const arr = byStage[focusStage] || []
              const sm = STAGE_META[focusStage] || {}
              const needsCount = arr.filter(c => decoMap[c.dealId]?.needsAction).length
              const featured = arr[0]
              const rest = arr.slice(1)
              return (
                <div className="ob-focus-panel" onDragOver={allowDrop} onDrop={() => dropToStage(focusStage)}>
                  <div className="ob-focus-phead">
                    <div>
                      <div className="ob-focus-ptitle">{OB_LABEL[focusStage]}</div>
                      <div className="ob-focus-pdesc">{sm.desc}</div>
                    </div>
                    <div className="ob-focus-pcount"><span className="n">{arr.length}</span><span className="l">{needsCount} need action</span></div>
                  </div>
                  {featured ? (
                    <>
                      <div className="ob-next-lab">Next up · work this first</div>
                      <PipelineCard c={featured} d={decoMap[featured.dealId]} open={openId === featured.dealId}
                        onToggle={() => setOpenId(openId === featured.dealId ? null : featured.dealId)}
                        onAdvance={() => moveStage(featured, decoMap[featured.dealId].next)} onDragStart={onCardDragStart(featured)}>
                        <ObCardDetail {...drawerProps(featured)} />
                      </PipelineCard>
                      {rest.length > 0 && <div className="ob-grouplabel">Queue · {rest.length} remaining</div>}
                      {rest.map(c => (
                        <PipelineCard key={c.dealId} c={c} d={decoMap[c.dealId]} open={openId === c.dealId}
                          onToggle={() => setOpenId(openId === c.dealId ? null : c.dealId)}
                          onAdvance={() => moveStage(c, decoMap[c.dealId].next)} onDragStart={onCardDragStart(c)}>
                          <ObCardDetail {...drawerProps(c)} />
                        </PipelineCard>
                      ))}
                    </>
                  ) : (
                    <div className="ob-bucket-empty">No customers in this stage · drag a card here to move one in.</div>
                  )}
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* Kanban opens the full drawer in a modal (columns are too narrow to expand inline) */}
      {pipelineView === 'board' && openId != null && (() => {
        const c = ownerScoped.find(x => x.dealId === openId)
        if (!c) return null
        return (
          <div className="ob-drawer-overlay" onClick={() => setOpenId(null)}>
            <div className="ob-drawer-modal" onClick={e => e.stopPropagation()}>
              <div className="ob-drawer-modal-head">
                <span className="status-dot" style={{ background: STATUS_COLORS[c.healthColor || 'unknown'] }} />
                <span className="ob-drawer-modal-name">{c.name}</span>
                <button className="ob-modal-x" onClick={() => setOpenId(null)} aria-label="Close">✕</button>
              </div>
              <div className="ob-card open" style={{ border: 'none', boxShadow: 'none' }}>
                <ObCardDetail {...drawerProps(c)} />
              </div>
            </div>
          </div>
        )
      })()}

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
