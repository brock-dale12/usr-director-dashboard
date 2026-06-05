import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { CATALOG, OB_STAGES, OB_LABEL, TOKENS } from '../lib/onboardingCatalog'
import { Settings, Check, RotateCcw, ChevronDown, Loader2, AlertCircle } from 'lucide-react'

/**
 * TemplateEditor — admin-only. Edit and FINALIZE onboarding copy live.
 *
 * Edits are saved as OVERRIDES to Supabase (onboarding_templates), merged on top
 * of the code defaults (onboardingCatalog.js) by the Onboarding page. "Reset to
 * default" deletes the override row so the code default takes over again. No
 * deploy required — saves go live for the whole CS team.
 *
 * Requires the onboarding_templates table (migration
 * supabase_migration_2026-06-04_onboarding_templates.sql). If the table is
 * missing, saves fail gracefully with a visible message.
 */

function findOverride(overrides, taskKey, variantKey = '') {
  return overrides.find(o => o.task_key === taskKey && (o.variant_key || '') === variantKey) || null
}

// ─── One task's editor (handles plain email/action + auto_email variants) ─────
function TaskEditor({ task, overrides, editorName, onSaved }) {
  const isAuto = task.kind === 'auto_email'
  const isAction = task.kind === 'action'
  const variantKeys = isAuto ? Object.keys(task.variants || {}) : []
  const [vKey, setVKey] = useState(isAuto ? variantKeys[0] : '')
  const [status, setStatus] = useState(null) // 'saving' | 'saved' | 'error'

  // The override scope being edited: '' (task-level) for plain tasks; the
  // variant key for auto_email variant copy. Task-level label/reason for
  // auto_email is edited via the '' scope using the first toggle.
  const scope = isAuto ? vKey : ''
  const base = isAuto ? task.variants[vKey] : task
  const ovTask = findOverride(overrides, task.key, '')
  const ovScope = findOverride(overrides, task.key, scope)

  const [label, setLabel] = useState((isAuto ? (ovScope?.label ?? base.label) : (ovTask?.label ?? task.label)) || '')
  const [reason, setReason] = useState((ovTask?.reason ?? task.reason) || '')
  const [subject, setSubject] = useState((ovScope?.subject ?? base.subject) || '')
  const [body, setBody] = useState((ovScope?.body ?? base.body) || '')

  // Re-seed fields when switching variant.
  function selectVariant(k) {
    setVKey(k)
    const b = task.variants[k]
    const ov = findOverride(overrides, task.key, k)
    setLabel((ov?.label ?? b.label) || '')
    setSubject((ov?.subject ?? b.subject) || '')
    setBody((ov?.body ?? b.body) || '')
    setStatus(null)
  }

  const edited =
    (!isAction && (subject !== (base.subject || '') || body !== (base.body || ''))) ||
    (isAuto ? label !== (base.label || '') : (label !== (task.label || '') || reason !== (task.reason || '')))

  const hasOverride = isAuto ? (!!ovScope || !!ovTask) : !!ovTask

  async function save() {
    setStatus('saving')
    try {
      // Variant/plain copy row (subject/body/label at this scope).
      const row = {
        task_key: task.key,
        variant_key: scope,
        label: label || null,
        subject: isAction ? null : (subject || null),
        body: isAction ? null : (body || null),
        reason: isAuto ? null : (reason || null), // reason is task-level; for auto_email saved separately below
        updated_by: editorName,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('onboarding_templates').upsert(row, { onConflict: 'task_key,variant_key' })
      if (error) throw error

      // For auto_email, persist task-level label/reason on the '' scope too.
      if (isAuto) {
        const { error: e2 } = await supabase.from('onboarding_templates').upsert(
          { task_key: task.key, variant_key: '', reason: reason || null, updated_by: editorName, updated_at: new Date().toISOString() },
          { onConflict: 'task_key,variant_key' },
        )
        if (e2) throw e2
      }
      setStatus('saved')
      onSaved && onSaved()
      setTimeout(() => setStatus(null), 1800)
    } catch (e) {
      console.error('[TemplateEditor] save failed', e)
      setStatus('error')
    }
  }

  async function resetDefault() {
    setStatus('saving')
    try {
      await supabase.from('onboarding_templates').delete().match({ task_key: task.key, variant_key: scope })
      if (isAuto) await supabase.from('onboarding_templates').delete().match({ task_key: task.key, variant_key: '' })
      // Re-seed from code defaults.
      setLabel((base.label ?? task.label) || '')
      setReason(task.reason || '')
      setSubject(base.subject || '')
      setBody(base.body || '')
      setStatus('saved')
      onSaved && onSaved()
      setTimeout(() => setStatus(null), 1800)
    } catch (e) {
      console.error('[TemplateEditor] reset failed', e)
      setStatus('error')
    }
  }

  return (
    <div className="te-task">
      <div className="te-task-head">
        <div>
          <div className="te-task-label">{task.label}
            <span className={`te-kind te-kind-${task.kind}`}>{task.kind === 'auto_email' ? 'auto email' : task.kind}</span>
            {hasOverride && <span className="te-edited">edited</span>}
          </div>
          <div className="te-task-chan">{task.channel}{task.note ? ' · ' + task.note : ''}</div>
        </div>
      </div>

      {isAuto && (
        <div className="te-variants">
          {variantKeys.map(k => {
            const ov = findOverride(overrides, task.key, k)
            return (
              <button key={k} className={`te-variant ${vKey === k ? 'active' : ''}`} onClick={() => selectVariant(k)}>
                {task.variants[k].label}{ov && <span className="te-vdot">●</span>}
              </button>
            )
          })}
        </div>
      )}

      <div className="te-fields">
        <label className="te-flabel">Label</label>
        <input className="te-input" value={label} onChange={e => setLabel(e.target.value)} />

        {!isAuto && (
          <>
            <label className="te-flabel">Why now (reason)</label>
            <textarea className="te-area te-area-sm" value={reason} onChange={e => setReason(e.target.value)} />
          </>
        )}
        {isAuto && (
          <>
            <label className="te-flabel">Why now (reason) · applies to all variants</label>
            <textarea className="te-area te-area-sm" value={reason} onChange={e => setReason(e.target.value)} />
          </>
        )}

        {!isAction && (
          <>
            <label className="te-flabel">Subject</label>
            <input className="te-input" value={subject} onChange={e => setSubject(e.target.value)} />
            <label className="te-flabel">Body</label>
            <textarea className="te-area" value={body} onChange={e => setBody(e.target.value)} />
          </>
        )}
      </div>

      <div className="te-actions">
        <button className="btn btn-primary" onClick={save} disabled={status === 'saving'}>
          {status === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Save{isAuto ? ' variant' : ''}
        </button>
        {hasOverride && (
          <button className="btn btn-outline" onClick={resetDefault} disabled={status === 'saving'}><RotateCcw size={14} />Reset to default</button>
        )}
        {status === 'saved' && <span className="te-status ok"><Check size={14} />Saved · live for the team</span>}
        {status === 'error' && <span className="te-status err"><AlertCircle size={14} />Save failed — is the onboarding_templates table created?</span>}
      </div>
    </div>
  )
}

export default function TemplateEditor({ overrides = [], editorName, onSaved, onClose }) {
  const [stage, setStage] = useState(OB_STAGES[0].key)
  const [openKey, setOpenKey] = useState(null)
  const tasks = CATALOG[stage] || []
  const overrideCount = useMemo(() => new Set(overrides.map(o => o.task_key)).size, [overrides])

  return (
    <div className="ob-modal-overlay" onClick={onClose}>
      <div className="te-card" onClick={e => e.stopPropagation()}>
        <div className="te-head">
          <Settings size={18} style={{ color: 'var(--usr-pink)' }} />
          <div>
            <div className="te-title">Onboarding Template Editor</div>
            <div className="te-sub">Edit copy and it goes live for the whole CS team — no deploy. {overrideCount} task{overrideCount !== 1 ? 's' : ''} customized.</div>
          </div>
          <button className="ob-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="te-stagebar">
          {OB_STAGES.map(s => (
            <button key={s.key} className={`te-stagebtn ${stage === s.key ? 'active' : ''}`} onClick={() => { setStage(s.key); setOpenKey(null) }}>
              {s.short}
            </button>
          ))}
        </div>

        <div className="te-body">
          <div className="te-stagehead">{OB_LABEL[stage]} · {tasks.length} step{tasks.length !== 1 ? 's' : ''}</div>
          <div className="te-tokens">
            <span className="te-tok-label">Tokens:</span>
            {TOKENS.map(t => <span key={t.t} className="te-tok" title={t.d}>{t.t}</span>)}
          </div>

          {tasks.map(t => (
            <div className="te-acc" key={t.key}>
              <button className={`te-acc-head ${openKey === t.key ? 'open' : ''}`} onClick={() => setOpenKey(openKey === t.key ? null : t.key)}>
                <span className={`te-acc-pri pri-${t.priority || 'low'}`} />
                <span className="te-acc-name">{t.label}</span>
                <span className="te-acc-kind">{t.kind === 'auto_email' ? 'auto email' : t.kind}</span>
                {overrides.some(o => o.task_key === t.key) && <span className="te-edited">edited</span>}
                <span style={{ flex: 1 }} />
                <ChevronDown size={18} className={`te-acc-chev ${openKey === t.key ? 'open' : ''}`} />
              </button>
              {openKey === t.key && (
                <TaskEditor task={t} overrides={overrides} editorName={editorName} onSaved={onSaved} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
