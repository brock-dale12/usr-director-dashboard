import { useState } from 'react'
import {
  TTV_TARGET, TTV_WINDOW_DAYS, OB_STAGES, kickoffComplete,
} from '../lib/onboardingCatalog'
import {
  Zap, Check, X, Pencil, Loader2, CalendarDays, Minus, Plus, AlertTriangle, CheckCircle, XCircle, Briefcase,
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
  const [editSess, setEditSess] = useState(false)   // type the recap count directly
  const [sessVal, setSessVal] = useState('')

  const saveDate = () => {
    if (!dateVal) return
    onSave(
      { kickoff_date: dateVal },
      [{ kind: 'kickoff_date', field: 'kickoff_date', old_value: t.kickoffDate, new_value: dateVal }],
    )
    setEditDate(false)
  }

  // Set the manual recap count to an explicit value (typed or stepped).
  const setSessions = (raw) => {
    const next = Math.max(0, Math.floor(Number(raw) || 0))
    onSave(
      { sessions_manual: next },
      [{ kind: 'ttv_mark', field: 'sessions_manual', old_value: String(cs?.sessions_manual ?? ''), new_value: String(next) }],
    )
  }
  const bumpSessions = (delta) => {
    const base = t.sessionsSource === 'manual' ? (cs?.sessions_manual ?? 0) : (t.sessions ?? 0)
    setSessions(base + delta)
  }
  const commitSess = () => { if (sessVal !== '') setSessions(sessVal); setEditSess(false) }

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
              {editSess ? (
                <input
                  className="ttv-sess-input" type="number" min="0" inputMode="numeric" autoFocus
                  value={sessVal}
                  onChange={e => setSessVal(e.target.value)}
                  onBlur={commitSess}
                  onKeyDown={e => { if (e.key === 'Enter') commitSess(); if (e.key === 'Escape') setEditSess(false) }}
                />
              ) : (
                <b className="ttv-sess-val" title="Click to type the recap count"
                   onClick={() => { setSessVal(String(t.sessions ?? 0)); setEditSess(true) }}>{t.sessions ?? 0}</b>
              )}
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
  // Synced = the last successful HubSpot push is at/after the last edit.
  const hsSynced = cs?.hs_pushed_at && cs?.updated_at && new Date(cs.hs_pushed_at) >= new Date(cs.updated_at)

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
            <span>{f.label}{cs?.[f.key] != null && (hsSynced
              ? <i className="ob-pending-hs synced" title="Pushed to HubSpot">synced to HubSpot</i>
              : <i className="ob-pending-hs" title="Edited in dashboard — HubSpot push pending">not in HubSpot yet</i>)}</span>
            <input type={f.type || 'text'} value={vals[f.key]} onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))} />
          </label>
        ))}
      </div>
      <label className="ob-edit-field">
        <span>Team notes (visible to all CS)</span>
        <textarea rows={3} value={vals.notes} onChange={e => setVals(p => ({ ...p, notes: e.target.value }))} placeholder="Context the next teammate needs — goals, quirks, promises made…" />
      </label>
      <div className="ob-edit-actions">
        <span className="ob-edit-hint">Saves internally + pushes contact/director/kick-off to HubSpot in real time · notes stay internal</span>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}Save</button>
      </div>
    </div>
  )
}

// ─── HubSpot Deal details (read all; editable subset pushes to HubSpot) ────────
// Editable fields have confirmed HubSpot deal-property names (see sync script);
// editing pushes through the hubspot-writeback function, which mirrors the value
// back into lab_accounts. Read-only fields are pulled from HubSpot for reference;
// the ones with no value yet ("—") aren't synced into the dashboard's data model.
export function DealDetails({ c, onSaveDeal, saving }) {
  const EDITABLE = [
    { key: 'arr_amount',         label: 'ARR Amount',          type: 'number', val: c.arr },
    { key: 'contract_end_date',  label: 'Contract End Date',   type: 'date',   val: c.contractEnd },
    { key: 'renewal_status',     label: 'Renewal Status',                      val: c.renewalStatus },
    { key: 'customer_segment',   label: 'Customer Segment',                    val: c.segment },
    { key: 'product',            label: 'Product',                             val: c.product },
    { key: 'speed_lab_director', label: 'Speed Lab Director',                  val: c.director },
    { key: 'payment_status',     label: 'Payment Status',                      val: c.paymentStatus },
  ]
  const READONLY = [
    ['Deal Owner',           c.owner],
    ['Deal Stage',           c.hubspotStage],
    ['Speed Lab Level',      c.speedLabLevel],
    ['Hardware',             c.hardware],
    ['Years as a Speed Lab', c.contractYear],
    ['Kick-Off Date',        c.cs?.kickoff_date],
    ['TTV · 5 Recaps',       c.recapCount != null ? `${c.recapCount} / 5` : null],
    ['Churn Risk',           c.churnRisk],
    ['Onboarding Cohort',    null],
  ]
  const NOT_SYNCED = ['Payment Processor', 'Payment Date', 'Overdue Amount', 'Removed Access']

  const [edit, setEdit] = useState(false)
  const seed = () => Object.fromEntries(EDITABLE.map(f => [f.key, f.val ?? '']))
  const [vals, setVals] = useState(seed)

  const open = () => { setVals(seed()); setEdit(true) }
  const save = () => {
    const changes = {}
    EDITABLE.forEach(f => {
      const next = (vals[f.key] ?? '').toString().trim()
      const cur = (f.val ?? '').toString()
      if (next !== cur) changes[f.key] = f.type === 'number' ? (next === '' ? null : Number(next)) : (next || null)
    })
    if (Object.keys(changes).length) onSaveDeal(changes)
    setEdit(false)
  }
  const fmt = (key, v) => (v == null || v === '') ? '—' : (key === 'arr_amount' ? `$${Number(v).toLocaleString()}` : String(v))

  return (
    <div className="ob-deal">
      <div className="ob-deal-head">
        <Briefcase size={14} />HubSpot Deal
        <span style={{ flex: 1 }} />
        {edit ? (
          <>
            <button className="btn btn-ghost" onClick={() => setEdit(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}Save → HubSpot</button>
          </>
        ) : (
          <button className="ob-icon-btn" onClick={open}><Pencil size={13} />Edit</button>
        )}
      </div>
      <div className="ob-deal-grid">
        {EDITABLE.map(f => (
          <div className="ob-deal-field" key={f.key}>
            <span className="ob-deal-lab">{f.label}<i className="ob-deal-sync">syncs to HubSpot</i></span>
            {edit
              ? <input className="ob-deal-input" type={f.type || 'text'} value={vals[f.key]} onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))} />
              : <span className="ob-deal-val">{fmt(f.key, f.val)}</span>}
          </div>
        ))}
        {READONLY.map(([label, val]) => (
          <div className="ob-deal-field ro" key={label}>
            <span className="ob-deal-lab">{label}</span>
            <span className="ob-deal-val">{val == null || val === '' ? '—' : String(val)}</span>
          </div>
        ))}
        {NOT_SYNCED.map(label => (
          <div className="ob-deal-field ro" key={label}>
            <span className="ob-deal-lab">{label}</span>
            <span className="ob-deal-val muted">— not synced yet</span>
          </div>
        ))}
      </div>
      <div className="ob-deal-note">Top fields edit straight to the HubSpot deal. Greyed fields are pulled from HubSpot (display-only). “Not synced yet” fields need their HubSpot field added to the daily sync before they appear here.</div>
    </div>
  )
}
