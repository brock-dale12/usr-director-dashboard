import { useState } from 'react'
import {
  TTV_TARGET, TTV_WINDOW_DAYS, OB_STAGES, kickoffComplete,
} from '../lib/onboardingCatalog'
import {
  Zap, Check, X, Pencil, Loader2, CalendarDays, Minus, Plus, AlertTriangle, CheckCircle, XCircle,
} from 'lucide-react'

/**
 * OnboardingControls — the execution layer of the Onboarding page.
 *
 * TTVPanel       per-customer TTV tracker: explicit kick-off date, days-since
 *                counter, session count (synced from the platform when
 *                sync_ttv has the deal, manual entry otherwise), pass/fail mark.
 * StageControl   move a customer through the 8 journey stages manually
 *                (override) or leave on Auto (derived from the checklist).
 * DetailsEditor  edit contact info, Speed Lab Director, and team notes.
 *
 * All saves go through onSave(patch, events) up in Onboarding.jsx, which
 * upserts onboarding_cs and appends timestamped rows to onboarding_events
 * (the audit trail + future HubSpot write-back queue). INTERNAL ONLY —
 * nothing here writes to HubSpot yet.
 */

// ─── Effective TTV state (manual mark > synced status > derived) ──────────────
export function effectiveTtv({ cs, synced, doneSet }) {
  const kickoffDate = cs?.kickoff_date || null
  const clockStarted = !!kickoffDate || kickoffComplete(doneSet)
  let daysSince = null
  if (kickoffDate) {
    const d = Math.floor((Date.now() - new Date(kickoffDate + 'T00:00:00').getTime()) / 86400000)
    daysSince = d >= 0 ? d : null
  }
  const sessions = synced?.recapsInWindow ?? cs?.sessions_manual ?? null
  const sessionsSource = synced?.recapsInWindow != null ? 'synced' : (cs?.sessions_manual != null ? 'manual' : null)

  let status, statusSource
  if (cs?.ttv_status_override) { status = cs.ttv_status_override; statusSource = 'manual' }
  else if (synced?.status) { status = synced.status; statusSource = 'synced' }
  else if (!clockStarted) { status = 'not_started'; statusSource = 'derived' }
  else if (sessions != null && sessions >= TTV_TARGET) { status = 'passed'; statusSource = 'derived' }
  else if (daysSince != null && daysSince > TTV_WINDOW_DAYS) { status = 'review'; statusSource = 'derived' } // window elapsed, <target — needs a pass/fail call
  else { status = 'in_progress'; statusSource = 'derived' }

  return { kickoffDate, clockStarted, daysSince, sessions, sessionsSource, status, statusSource }
}

export const TTV_STATUS_META = {
  passed:      { label: 'Passed',         color: 'var(--st-green)' },
  failed:      { label: 'Failed',         color: 'var(--st-red)' },
  in_progress: { label: 'In window',      color: 'var(--st-yellow)' },
  review:      { label: 'Window elapsed', color: 'var(--st-orange)' },
  not_started: { label: 'Not started',    color: 'var(--fg-subtle)' },
}

// ─── TTV panel ────────────────────────────────────────────────────────────────
export function TTVPanel({ c, cs, synced, onSave, saving }) {
  const t = effectiveTtv({ cs, synced, doneSet: c.doneSet })
  const meta = TTV_STATUS_META[t.status] || TTV_STATUS_META.not_started
  const [editDate, setEditDate] = useState(false)
  const [dateVal, setDateVal] = useState(t.kickoffDate || '')

  const saveDate = () => {
    if (!dateVal) return
    onSave(
      { kickoff_date: dateVal },
      [{ kind: 'kickoff_date', field: 'kickoff_date', old_value: t.kickoffDate, new_value: dateVal }],
    )
    setEditDate(false)
  }

  const bumpSessions = (delta) => {
    const base = t.sessionsSource === 'manual' ? (cs?.sessions_manual ?? 0) : (t.sessions ?? 0)
    const next = Math.max(0, base + delta)
    onSave(
      { sessions_manual: next },
      [{ kind: 'ttv_mark', field: 'sessions_manual', old_value: String(cs?.sessions_manual ?? ''), new_value: String(next) }],
    )
  }

  const mark = (val) => {
    const next = cs?.ttv_status_override === val ? null : val // click again to un-mark
    onSave(
      { ttv_status_override: next },
      [{ kind: 'ttv_mark', field: 'ttv_status', old_value: cs?.ttv_status_override || t.status, new_value: next || 'auto' }],
    )
  }

  return (
    <div className="ttv-block">
      <div className="ttv-top">
        <div className="ttv-figure">
          <span className="ttv-done" style={{ color: t.sessions != null ? 'var(--usr-black)' : 'var(--fg-subtle)' }}>{t.sessions != null ? t.sessions : '—'}</span>
          <span className="ttv-target">/ {TTV_TARGET}</span>
        </div>
        <div>
          <div className="ttv-name">Session recaps · {TTV_WINDOW_DAYS}-day window</div>
          <div className="ttv-status" style={{ color: meta.color }}>
            {meta.label}
            {t.statusSource === 'manual' && <span className="ttv-src">marked by CS</span>}
            {t.statusSource === 'synced' && <span className="ttv-src">platform-synced</span>}
          </div>
        </div>
      </div>

      {/* Kick-off date + days-since counter */}
      <div className="ttv-kick">
        <CalendarDays size={13} />
        {editDate ? (
          <span className="ttv-kick-edit">
            <input type="date" value={dateVal} onChange={e => setDateVal(e.target.value)} />
            <button className="ob-icon-btn ok" onClick={saveDate} title="Save kick-off date"><Check size={13} /></button>
            <button className="ob-icon-btn" onClick={() => setEditDate(false)} title="Cancel"><X size={13} /></button>
          </span>
        ) : t.kickoffDate ? (
          <span>
            Kick-off <b>{t.kickoffDate}</b>
            {t.daysSince != null && <> · <b>{t.daysSince} day{t.daysSince !== 1 ? 's' : ''} since kick-off</b></>}
            <button className="ob-icon-btn" onClick={() => { setDateVal(t.kickoffDate); setEditDate(true) }} title="Edit kick-off date"><Pencil size={12} /></button>
          </span>
        ) : (
          <button className="ttv-setdate" onClick={() => setEditDate(true)}>Set kick-off date — starts the {TTV_WINDOW_DAYS}-day clock</button>
        )}
      </div>

      {/* Session count source / manual entry */}
      <div className="ttv-sessions">
        {t.sessionsSource === 'synced' ? (
          <span className="ttv-sess-note"><Zap size={12} />Recap count synced from the platform{synced?.daysToFive != null && <> · hit {TTV_TARGET} in {synced.daysToFive}d</>}</span>
        ) : (
          <span className="ttv-sess-manual">
            <span className="ttv-sess-note">Sessions completed (manual until platform sync)</span>
            <span className="ttv-stepper">
              <button className="ob-icon-btn" onClick={() => bumpSessions(-1)} disabled={saving || (t.sessions ?? 0) <= 0}><Minus size={13} /></button>
              <b>{t.sessions ?? 0}</b>
              <button className="ob-icon-btn" onClick={() => bumpSessions(1)} disabled={saving}><Plus size={13} /></button>
            </span>
          </span>
        )}
      </div>

      {/* Pass / fail mark */}
      <div className="ttv-markrow">
        {t.status === 'review' && <span className="ttv-review-flag"><AlertTriangle size={12} />Window elapsed — make the call:</span>}
        <button className={`ttv-mark pass ${cs?.ttv_status_override === 'passed' ? 'on' : ''}`} onClick={() => mark('passed')} disabled={saving}>
          <CheckCircle size={13} />Pass
        </button>
        <button className={`ttv-mark fail ${cs?.ttv_status_override === 'failed' ? 'on' : ''}`} onClick={() => mark('failed')} disabled={saving}>
          <XCircle size={13} />Fail
        </button>
        {cs?.ttv_status_override && <span className="ttv-src" style={{ marginLeft: 4 }}>click again to revert to auto</span>}
        {saving && <Loader2 size={13} className="animate-spin" style={{ color: 'var(--fg-subtle)' }} />}
      </div>
    </div>
  )
}

// ─── Stage control (Auto / manual move) ───────────────────────────────────────
export function StageControl({ c, cs, onSave, saving }) {
  const value = cs?.stage_override || 'auto'
  const change = (v) => {
    const next = v === 'auto' ? null : v
    onSave(
      { stage_override: next },
      [{ kind: 'stage_move', field: 'stage', old_value: c.stageKey, new_value: next || `auto (${c.derivedStageKey})` }],
    )
  }
  return (
    <span className="ob-stagectl">
      <label>Stage</label>
      <select value={value} onChange={e => change(e.target.value)} disabled={saving}>
        <option value="auto">Auto — from checklist</option>
        {OB_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      {cs?.stage_override && <span className="ob-manual-tag">manual</span>}
    </span>
  )
}

// ─── Details editor (contact, director, notes) ────────────────────────────────
const EDIT_FIELDS = [
  { key: 'contact_name',       label: 'Contact name',       base: c => c.baseContactName },
  { key: 'contact_email',      label: 'Contact email',      base: c => c.baseEmail, type: 'email' },
  { key: 'contact_phone',      label: 'Contact phone',      base: c => c.basePhone },
  { key: 'speed_lab_director', label: 'Speed Lab Director', base: c => c.baseDirector },
]

export function DetailsEditor({ c, cs, onSave, saving, onClose }) {
  const [vals, setVals] = useState(() => {
    const v = {}
    EDIT_FIELDS.forEach(f => { v[f.key] = cs?.[f.key] ?? f.base(c) ?? '' })
    v.notes = cs?.notes ?? ''
    return v
  })

  const save = () => {
    const patch = {}, events = []
    EDIT_FIELDS.forEach(f => {
      const current = cs?.[f.key] ?? f.base(c) ?? ''
      const next = (vals[f.key] || '').trim()
      if (next !== current) {
        patch[f.key] = next || null
        events.push({ kind: 'property_edit', field: f.key, old_value: current || null, new_value: next || null })
      }
    })
    const curNotes = cs?.notes ?? ''
    if ((vals.notes || '') !== curNotes) {
      patch.notes = vals.notes || null
      events.push({ kind: 'note', field: 'notes', old_value: null, new_value: (vals.notes || '').slice(0, 280) })
    }
    if (Object.keys(patch).length) onSave(patch, events)
    onClose()
  }

  return (
    <div className="ob-edit-panel">
      <div className="ob-edit-grid">
        {EDIT_FIELDS.map(f => (
          <label key={f.key} className="ob-edit-field">
            <span>{f.label}{cs?.[f.key] != null && <i className="ob-pending-hs" title="Edited in dashboard — not yet pushed to HubSpot">not in HubSpot yet</i>}</span>
            <input type={f.type || 'text'} value={vals[f.key]} onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))} />
          </label>
        ))}
      </div>
      <label className="ob-edit-field">
        <span>Team notes (visible to all CS)</span>
        <textarea rows={3} value={vals.notes} onChange={e => setVals(p => ({ ...p, notes: e.target.value }))} placeholder="Context the next teammate needs — goals, quirks, promises made…" />
      </label>
      <div className="ob-edit-actions">
        <span className="ob-edit-hint">Saves internally + queues for HubSpot push (coming with write-back phase)</span>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}Save</button>
      </div>
    </div>
  )
}
