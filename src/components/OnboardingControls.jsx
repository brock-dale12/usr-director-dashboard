import { useState, useEffect } from 'react'
import {
  TTV_TARGET, TTV_WINDOW_DAYS, OB_STAGES, kickoffComplete,
} from '../lib/onboardingCatalog'
import {
  Zap, Check, X, Pencil, Loader2, CalendarDays, Minus, Plus, AlertTriangle, CheckCircle, XCircle, Briefcase, MessageSquare,
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

// ─── HubSpot Deal Properties (live dropdowns, two-way) ────────────────────────
// Current values come from the cohort row; dropdown options are fetched live from
// HubSpot via loadMeta() so they mirror HubSpot exactly. Editing pushes changed
// fields straight to the HubSpot deal (hubspot-writeback), which mirrors back into
// lab_accounts. Verified internal names: hubspot-deal-property-map-2026-06-17.md.
export function DealProperties({ c, onSaveDeal, saving, loadMeta }) {
  const [edit, setEdit] = useState(false)
  const [meta, setMeta] = useState(null)
  const [metaState, setMetaState] = useState('idle') // idle|loading|ready|error
  const [metaErr, setMetaErr] = useState('')
  const [vals, setVals] = useState({})

  // field key (HubSpot internal name) → kind + meta option-set + current value
  const FIELDS = [
    { key: 'amount',                  label: 'ARR (Amount)',         kind: 'number', base: c.amount },
    { key: 'overdue_amount',          label: 'Overdue Amount',       kind: 'number', base: c.overdueAmount },
    { key: 'contract_start_date',     label: 'Contract Start Date',  kind: 'date',   base: c.contractStart },
    { key: 'contract_end_date',       label: 'Contract End Date',    kind: 'date',   base: c.contractEnd },
    { key: 'dealstage',               label: 'Deal Stage',           kind: 'stage',  base: c.dealStageId, display: c.hubspotStage },
    { key: 'hubspot_owner_id',        label: 'Deal Owner',           kind: 'owner',  display: c.owner },
    { key: 'product',                 label: 'Product',              kind: 'enum', meta: 'product',          base: c.product },
    { key: 'customer_segment',        label: 'Customer Segment',     kind: 'enum', meta: 'customer_segement', base: c.segment },
    { key: 'speed_lab_level',         label: 'Speed Lab Level',      kind: 'enum', meta: 'speed_lab_level',  base: c.speedLabLevel },
    { key: 'speed_lab_status',        label: 'Speed Lab Status',     kind: 'enum', meta: 'speed_lab_status', base: c.speedLabStatus },
    { key: 'speed_lab_director',      label: 'Speed Lab Director',   kind: 'text', base: c.director },
    { key: 'hardware',                label: 'Hardware',             kind: 'enum', meta: 'hardware',         base: c.hardware },
    { key: 'years_as_a_speed_lab',    label: 'Years as a Speed Lab', kind: 'enum', meta: 'years_as_a_speed_lab', base: c.yearsAsSpeedLab },
    { key: 'onboarding_cohort',       label: 'Onboarding Cohort',    kind: 'text', base: c.onboardingCohort },
    { key: 'renewal_status',          label: 'Renewal Status',       kind: 'enum', meta: 'renewal_status',   base: c.renewalStatus },
    { key: 'churn_risk',              label: 'Churn Risk',           kind: 'enum', meta: 'churn_risk',       base: c.churnRisk },
    { key: 'payment_update',          label: 'Payment Status',       kind: 'enum', meta: 'payment_update',   base: c.paymentStatus },
    { key: 'payment_status',          label: 'Payment Date',         kind: 'enum', meta: 'payment_status',   base: c.paymentDate },
    { key: 'payment_processor',       label: 'Payment Processor',    kind: 'enum', meta: 'payment_processor', base: c.paymentProcessor },
    { key: 'removed_access_from_usr', label: 'Removed Access',       kind: 'enum', meta: 'removed_access_from_usr', base: c.removedAccess },
  ]
  const ownerBaseId = meta ? (meta.owners.find(o => (o.email || '').toLowerCase() === (c.ownerEmail || '').toLowerCase())?.id || '') : ''
  const baseOf = (f) => f.key === 'hubspot_owner_id' ? ownerBaseId : (f.base ?? '')

  const ensureMeta = async () => {
    if (meta || metaState === 'loading') return
    setMetaState('loading')
    try { const m = await loadMeta(); setMeta(m); setMetaState('ready') }
    catch (e) { setMetaErr(String(e.message || e)); setMetaState('error') }
  }
  const startEdit = () => { setVals({}); setEdit(true); ensureMeta() }
  const save = () => {
    const changes = {}
    FIELDS.forEach(f => {
      if (vals[f.key] === undefined) return
      const a = String(baseOf(f) ?? ''), b = String(vals[f.key] ?? '')
      if (a !== b) changes[f.key] = f.kind === 'number' ? (b === '' ? null : Number(b)) : (b === '' ? null : b)
    })
    if (Object.keys(changes).length) onSaveDeal(changes)
    setEdit(false)
  }

  const money = (v) => v == null || v === '' ? '—' : `$${Number(v).toLocaleString()}`
  const displayVal = (f) => {
    if (f.key === 'amount' || f.key === 'overdue_amount') return money(f.base)
    if (f.display !== undefined) return f.display || '—'
    return f.base == null || f.base === '' ? '—' : String(f.base)
  }
  const renderEdit = (f) => {
    const v = vals[f.key] !== undefined ? vals[f.key] : baseOf(f)
    const set = (val) => setVals(p => ({ ...p, [f.key]: val }))
    if (f.kind === 'number') return <input className="ob-deal-input" type="number" value={v ?? ''} onChange={e => set(e.target.value)} />
    if (f.kind === 'date')   return <input className="ob-deal-input" type="date" value={v || ''} onChange={e => set(e.target.value)} />
    if (f.kind === 'text')   return <input className="ob-deal-input" type="text" value={v || ''} onChange={e => set(e.target.value)} />
    if (f.kind === 'stage')  return <select className="ob-deal-input" value={v || ''} onChange={e => set(e.target.value)}><option value="">—</option>{(meta?.stages || []).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
    if (f.kind === 'owner')  return <select className="ob-deal-input" value={v || ''} onChange={e => set(e.target.value)}><option value="">—</option>{(meta?.owners || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
    const opts = meta?.properties?.[f.meta]
    if (opts) return <select className="ob-deal-input" value={v || ''} onChange={e => set(e.target.value)}><option value="">—</option>{opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    return <input className="ob-deal-input" type="text" value={v || ''} onChange={e => set(e.target.value)} placeholder="options unavailable" />
  }

  return (
    <div className="ob-deal">
      <div className="ob-deal-head">
        <Briefcase size={14} />HubSpot Deal Properties
        <span style={{ flex: 1 }} />
        {edit ? (
          <>
            <button className="btn btn-ghost" onClick={() => setEdit(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}Save → HubSpot</button>
          </>
        ) : (
          <button className="ob-icon-btn" onClick={startEdit}><Pencil size={13} />Edit</button>
        )}
      </div>
      {edit && metaState === 'loading' && <div className="ob-deal-note"><Loader2 size={12} className="animate-spin" /> Loading HubSpot options…</div>}
      {edit && metaState === 'error' && <div className="ob-deal-note err">Couldn’t load live HubSpot options ({metaErr}). You can still type values; dropdowns return once the connector scopes are enabled.</div>}
      <div className="ob-deal-grid">
        {FIELDS.map(f => (
          <div className="ob-deal-field" key={f.key}>
            <span className="ob-deal-lab">{f.label}</span>
            {edit ? renderEdit(f) : <span className="ob-deal-val">{displayVal(f)}</span>}
          </div>
        ))}
      </div>
      <div className="ob-deal-note">Every field edits straight to the HubSpot deal and syncs back. Dropdown options mirror HubSpot live.</div>
    </div>
  )
}

// ─── HubSpot timeline notes (read + post to the deal) ─────────────────────────
export function NotesPanel({ dealId, loadNotes, addNote }) {
  const [notes, setNotes] = useState([])
  const [state, setState] = useState('loading') // loading|ready|error
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)

  const refresh = async () => {
    setState('loading')
    try { const n = await loadNotes(dealId); setNotes(n); setState('ready') }
    catch (e) { setErr(String(e.message || e)); setState('error') }
  }
  useEffect(() => { refresh() }, [dealId]) // eslint-disable-line react-hooks/exhaustive-deps

  const post = async () => {
    if (!draft.trim()) return
    setPosting(true)
    try { await addNote(dealId, draft.trim()); setDraft(''); await refresh() }
    catch (e) { alert(`Couldn't add note: ${String(e.message || e)}`) }
    setPosting(false)
  }
  const strip = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  const fmtT = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }

  return (
    <div className="ob-notes">
      <div className="ob-deal-head"><MessageSquare size={14} />HubSpot Notes</div>
      <div className="ob-notes-add">
        <textarea className="ob-notes-input" rows={2} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a note — posts to the HubSpot deal timeline…" />
        <button className="btn btn-primary" onClick={post} disabled={posting || !draft.trim()}>{posting ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}Add note</button>
      </div>
      {state === 'loading' && <div className="ob-notes-empty"><Loader2 size={12} className="animate-spin" /> Loading notes…</div>}
      {state === 'error' && <div className="ob-notes-empty err">Couldn’t load HubSpot notes: {err}</div>}
      {state === 'ready' && (notes.length === 0
        ? <div className="ob-notes-empty">No notes on this deal yet.</div>
        : <div className="ob-notes-list">
            {notes.map(n => (
              <div className="ob-note" key={n.id}>
                <div className="ob-note-body">{strip(n.body)}</div>
                <div className="ob-note-when">{fmtT(n.timestamp)}</div>
              </div>
            ))}
          </div>)}
    </div>
  )
}
