import { useState, useEffect, useRef } from 'react'
import {
  OB_STAGES, OB_INDEX, OB_LABEL, STATUS_COLORS, TTV_TARGET, gatingKeys,
  transitionVariant, recapVariant,
} from '../lib/onboardingCatalog'
import { TTVPanel, StageControl, DetailsEditor, DealProperties, NotesPanel } from '../components/OnboardingControls'
import WeeklyMatrix from '../components/WeeklyMatrix'
import {
  Activity, Mail, Phone, Zap, Check, CheckCircle, Send, User, Loader2,
  CheckSquare, Square, Pencil, StickyNote, Trophy, Briefcase, MessageSquare,
} from 'lucide-react'

/**
 * CustomerDetail — the ONE shared "individual customer view" (expanded detail
 * drawer) used by every page (Onboarding, My Customers, My Region). Edits here
 * surface on all pages automatically.
 *
 * `isOnboarding` (default true) gates the onboarding-only sections:
 *   - the Time-to-Value card inside the Activity & Health band
 *   - the entire 90-Day Journey + task checklist block
 * Everything else (contact strip, details editor, Deal Properties + Notes,
 * Weekly Activity, Monthly Health Trend) always renders.
 *
 * Extracted verbatim from Onboarding.jsx's ObCardDetail so the canonical drawer
 * lives in one place.
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

// ─── The expandable drawer (contact, activity/health, journey + task checklist) ─
// The SAME rich detail every pipeline view opens — the place the actual CS work
// happens. `isOnboarding` gates the journey + TTV sections.
function CustomerDetail({ c, catalog, doneSet, doneMeta, onOpenTemplate, onSetDone, onSaveCs, savingCs, hsPushState, scrollToTasks, onComplete, onSaveDeal, savingDeal, loadMeta, loadNotes, addNote, isOnboarding = true }) {
  const nextLabel = c.graduated ? null : (OB_STAGES[OB_INDEX[c.stageKey] + 1]?.label || null)
  const [editOpen, setEditOpen] = useState(false)
  const [dealOpen, setDealOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [viewStage, setViewStage] = useState(null) // null = follow the customer's current stage
  const viewKey = viewStage || (c.graduated ? 'qbr' : c.stageKey)
  const tasksRef = useRef(null)
  // "Start tasks" (Focus Queue) opens the card scrolled to the task checklist.
  useEffect(() => {
    if (scrollToTasks && tasksRef.current) tasksRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [scrollToTasks])

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
          {/* Prominent HubSpot actions */}
          <div className="detail-block ob-hs-actions" style={{ gridColumn: '1 / -1' }}>
            <button className={`ob-bigbtn ${dealOpen ? 'on' : ''}`} onClick={() => { setDealOpen(o => !o); setNotesOpen(false) }}><Briefcase size={16} />Deal Properties</button>
            <button className={`ob-bigbtn ${notesOpen ? 'on' : ''}`} onClick={() => { setNotesOpen(o => !o); setDealOpen(false) }}><MessageSquare size={16} />Notes</button>
          </div>
          {dealOpen && (
            <div className="detail-block" style={{ gridColumn: '1 / -1' }}>
              <DealProperties c={c} onSaveDeal={onSaveDeal} saving={savingDeal} loadMeta={loadMeta} />
            </div>
          )}
          {notesOpen && (
            <div className="detail-block" style={{ gridColumn: '1 / -1' }}>
              <NotesPanel dealId={c.dealId} loadNotes={loadNotes} addNote={addNote} />
            </div>
          )}

          {/* 2. Activity band — TTV / weekly activity / health, one compact row */}
          <div className="detail-block" style={{ gridColumn: '1 / -1' }}>
            <h4><Zap size={14} />Activity &amp; Health</h4>
            <div className="ob-actband">
              {isOnboarding && (
                <div className="ob-actcard">
                  <div className="ob-actcard-title">Time-to-Value</div>
                  <TTVPanel c={c} cs={c.cs} synced={c.ttvSynced} onSave={onSaveCs} saving={savingCs} />
                </div>
              )}
              <div className="ob-actcard">
                <div className="ob-actcard-title">Weekly Activity · 8w</div>
                {c.weeks.length > 0
                  ? <WeeklyMatrix weeks={c.weeks} />
                  : <p style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>No weekly activity yet — appears once platform usage flows.</p>}
              </div>
              <div className="ob-actcard">
                <div className="ob-actcard-title">Monthly Health Trend</div>
                <div className="trend-now">
                  <span className="v" style={{ color: 'var(--usr-pink)' }}>{c.healthScore != null ? c.healthScore : '—'}<span style={{ fontSize: 16, color: 'var(--fg-subtle)' }}>/9</span></span>
                </div>
                <HealthArea history={c.healthHistory} />
                <div className="ob-actcard-foot">{c.athletes ?? '—'} athletes (30d) · {c.prs ?? '—'} PRs (8w)</div>
              </div>
            </div>
          </div>

          {/* 3. Journey + tasks — red-dot timeline drives the task list below */}
          {isOnboarding && (
          <div className="detail-block" ref={tasksRef} style={{ gridColumn: '1 / -1' }}>
            <h4>
              <Activity size={14} />90-Day Journey · {c.graduated ? 'Graduated' : OB_LABEL[c.stageKey]}
              {!c.graduated && nextLabel && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--fg-subtle)', textTransform: 'none', letterSpacing: 0 }}>complete required steps → {nextLabel}</span>}
              <span style={{ flex: 1 }} />
              <StageControl c={c} cs={c.cs} onSave={onSaveCs} saving={savingCs} />
              {onComplete && <button className="ob-complete-btn" onClick={onComplete} title="Finish onboarding — moves to My Customers"><Trophy size={13} />Complete</button>}
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
          )}
        </div>
  )
}

export default CustomerDetail
