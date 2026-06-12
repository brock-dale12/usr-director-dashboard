import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { TRIGGER_ORDER } from '../lib/colors'
import { openGmailDraft, logComm } from '../lib/gmailDraft'
import HealthBadge from '../components/HealthBadge'
import { Copy, Check, CheckCircle, Inbox, Mail, Send } from 'lucide-react'

// ── Trigger metadata ──────────────────────────────────────────
const TRIGGER_META = {
  red: {
    label:    'Red Alert',
    priority: 'critical',
    tgBg:     'rgba(236,54,66,0.12)',
    tgColor:  'var(--usr-pink)',
    reason:   'This lab has had no activity in 30+ days. Immediate outreach needed to prevent churn.',
  },
  orange: {
    label:    'At Risk',
    priority: 'high',
    tgBg:     'rgba(242,129,14,0.12)',
    tgColor:  '#b45c06',
    reason:   'Activity has dropped significantly. Check in now before this becomes a red.',
  },
  two_week_yellow: {
    label:    '2-Week Yellow',
    priority: 'medium',
    tgBg:     'rgba(255,217,0,0.15)',
    tgColor:  '#8a7200',
    reason:   'Yellow for two consecutive weeks. A quick nudge can turn this around.',
  },
  onboarding: {
    label:    'Onboarding',
    priority: 'normal',
    tgBg:     'rgba(29,178,113,0.12)',
    tgColor:  '#14794d',
    reason:   'New Speed Lab in their first 90 days. Proactive support sets them up for success.',
  },
  renewal_90: {
    label:    '90-Day Renewal',
    priority: 'normal',
    tgBg:     'rgba(59,130,246,0.12)',
    tgColor:  '#1d4ed8',
    reason:   'Renewal window is within 90 days. Start the conversation now while things are healthy.',
  },
}

const DEFAULT_META = {
  label:    'Outreach',
  priority: 'low',
  tgBg:     '#f3f4f6',
  tgColor:  '#6b7280',
  reason:   'Triggered by a lab status change in your region.',
}

const DOT_COLORS = {
  green:   'var(--st-green)',
  yellow:  'var(--st-yellow)',
  orange:  'var(--st-orange)',
  red:     'var(--st-red)',
  unknown: 'var(--fg-subtle)',
}

export default function OutreachHub() {
  const { director } = useAuth()
  const [emails,     setEmails]     = useState([])
  const [loading,    setLoading]    = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [drafts,     setDrafts]     = useState({})   // id → { subject, body }
  const [flash,      setFlash]      = useState(false)
  const [actioning,  setActioning]  = useState(null)

  useEffect(() => {
    if (!director) { setLoading(false); return }
    loadEmails()
  }, [director])

  async function loadEmails() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('suggested_emails')
        .select('*')
        .eq('director_id', director.id)
        .order('week_start', { ascending: false })
        .order('lab_name')
      if (error) throw error
      const rows = data || []
      setEmails(rows)

      // Auto-select first pending item
      const first = rows
        .filter(e => e.status === 'pending')
        .sort((a, b) => {
          const ai = TRIGGER_ORDER.indexOf(a.trigger_type)
          const bi = TRIGGER_ORDER.indexOf(b.trigger_type)
          return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
        })[0]
      if (first) setSelectedId(first.id)
    } catch (err) {
      console.error('Error loading emails:', err)
    } finally {
      setLoading(false)
    }
  }

  // Draft helpers — draft overrides the DB values until user edits
  const getDraft = useCallback((email) => {
    if (!email) return { subject: '', body: '' }
    if (drafts[email.id]) return drafts[email.id]
    return { subject: email.subject_line, body: email.body_copy }
  }, [drafts])

  const updateDraft = (id, patch) => {
    setDrafts(prev => ({
      ...prev,
      [id]: { ...getDraft(emails.find(e => e.id === id)), ...patch }
    }))
  }

  async function markSent(emailId) {
    setActioning(emailId)
    try {
      const patch = { status: 'sent', sent_at: new Date().toISOString() }
      const { error } = await supabase
        .from('suggested_emails').update(patch).eq('id', emailId)
      if (error) throw error

      const email = emails.find(e => e.id === emailId)
      await supabase.from('action_log').insert({
        director_id: director.id,
        lab_name:    email?.lab_name,
        action_type: 'email_sent',
        email_id:    emailId,
      })

      setEmails(prev => prev.map(e => e.id === emailId ? { ...e, ...patch } : e))

      // Advance to next pending item
      const remaining = emails
        .filter(e => e.id !== emailId && e.status === 'pending')
        .sort((a, b) => {
          const ai = TRIGGER_ORDER.indexOf(a.trigger_type)
          const bi = TRIGGER_ORDER.indexOf(b.trigger_type)
          return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
        })
      if (remaining.length) setSelectedId(remaining[0].id)
    } catch (err) {
      console.error('Error marking sent:', err)
    } finally {
      setActioning(null)
    }
  }

  async function markSkipped(emailId) {
    setActioning(emailId)
    try {
      const { error } = await supabase
        .from('suggested_emails').update({ status: 'skipped' }).eq('id', emailId)
      if (error) throw error
      setEmails(prev => prev.map(e => e.id === emailId ? { ...e, status: 'skipped' } : e))

      const remaining = emails
        .filter(e => e.id !== emailId && e.status === 'pending')
        .sort((a, b) => {
          const ai = TRIGGER_ORDER.indexOf(a.trigger_type)
          const bi = TRIGGER_ORDER.indexOf(b.trigger_type)
          return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
        })
      if (remaining.length) setSelectedId(remaining[0].id)
    } catch (err) {
      console.error('Error skipping:', err)
    } finally {
      setActioning(null)
    }
  }

  function copyToClipboard(email) {
    const draft  = getDraft(email)
    const text   = `Subject: ${draft.subject}\n\n${draft.body}`
    navigator.clipboard?.writeText(text)
    setFlash(true)
    setTimeout(() => setFlash(false), 2000)
  }

  // Open the draft in Gmail (BCC'd to HubSpot for auto-logging) + record it.
  function openInGmail(email) {
    const draft = getDraft(email)
    openGmailDraft({ to: email.to_email || '', subject: draft.subject, body: draft.body })
    logComm({
      labName: email.lab_name, channel: 'Email', subject: draft.subject,
      toEmail: email.to_email || null, templateKey: email.trigger_type,
      loggedBy: director?.email || director?.name || null,
    })
  }

  const pending  = emails.filter(e => e.status === 'pending')
  const actioned = emails.filter(e => e.status !== 'pending')

  // Ordered queue: pending first (by trigger priority), then actioned
  const queueOrdered = [
    ...pending.slice().sort((a, b) => {
      const ai = TRIGGER_ORDER.indexOf(a.trigger_type)
      const bi = TRIGGER_ORDER.indexOf(b.trigger_type)
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.lab_name.localeCompare(b.lab_name)
    }),
    ...actioned,
  ]

  const selected = emails.find(e => e.id === selectedId) || queueOrdered[0] || null
  const meta     = selected ? (TRIGGER_META[selected.trigger_type] || DEFAULT_META) : null
  const draft    = selected ? getDraft(selected) : null
  const isSent   = selected?.status === 'sent'
  const isSkipped = selected?.status === 'skipped'
  const isActioned = isSent || isSkipped

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 32, height: 32, margin: '0 auto 12px',
            border: '2px solid rgba(236,54,66,0.25)', borderTopColor: 'var(--usr-pink)',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite'
          }} />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12,
            letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--fg-subtle)' }}>
            Loading outreach...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      {/* Top bar */}
      <div className="topbar">
        <div>
          <div className="topbar-eyebrow">Outreach</div>
          <div className="topbar-title">Communication Hub</div>
          <div className="topbar-meta">
            {pending.length === 0
              ? 'All caught up — no pending outreach this week.'
              : `${pending.length} pending · open in Gmail, send.`}
          </div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8,
          fontFamily: 'var(--font-display)', fontWeight: 800,
          fontSize: 40, color: 'var(--usr-black)', lineHeight: 1
        }}>
          <span>{pending.length}</span>
          <span style={{ fontSize: 13, color: 'var(--fg-subtle)', fontWeight: 700 }}>pending</span>
        </div>
      </div>

      {/* Empty state */}
      {emails.length === 0 ? (
        <div className="stub">
          <div className="stub-mark"><Inbox size={28} /></div>
          <h2>Queue Empty</h2>
          <p>No outreach emails this week. New emails land here after the Sunday report when labs need attention.</p>
        </div>
      ) : (
        <div className="hub-grid">
          {/* ── LEFT: Send Queue ── */}
          <div className="queue">
            <div className="queue-head">
              <span className="qt">Send Queue</span>
              {pending.length > 0 && <span className="qc">{pending.length}</span>}
            </div>
            <div className="queue-list scrollbar-thin">
              {queueOrdered.map(email => {
                const m       = TRIGGER_META[email.trigger_type] || DEFAULT_META
                const sent    = email.status !== 'pending'
                const isActive = email.id === selected?.id

                return (
                  <div
                    key={email.id}
                    className={`queue-item ${isActive ? 'active' : ''} ${sent ? 'sent' : ''}`}
                    onClick={() => setSelectedId(email.id)}
                  >
                    {/* Priority bar */}
                    <span className={`qi-pri pri-${m.priority}`} />

                    {/* Lab name + trigger */}
                    <div className="qi-meta">
                      <div className="qi-lab">{email.lab_name}</div>
                      <div className="qi-trig">{m.label}</div>
                    </div>

                    {/* Status dot (health color) + sent check */}
                    <div className="qi-right">
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: DOT_COLORS[email.health_color] || 'var(--fg-subtle)',
                        marginLeft: 'auto', marginBottom: 4
                      }} />
                      <div className="qi-check">
                        <Check size={11} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── RIGHT: Composer ── */}
          {selected ? (
            <div className="composer">
              {/* Composer header */}
              <div className="composer-head">
                <div className="ch-dot">
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: DOT_COLORS[selected.health_color] || 'var(--fg-subtle)',
                  }} />
                </div>
                <div className="ch-main">
                  <div className="composer-lab">{selected.lab_name}</div>
                  <div className="composer-trig">
                    <span className="tg" style={{
                      background: meta.tgBg, color: meta.tgColor
                    }}>
                      {meta.label}
                    </span>
                    {selected.cc_address && (
                      <span>· CC: {selected.cc_address}</span>
                    )}
                  </div>
                  <div className="composer-reason">
                    <strong>Why now:</strong> {meta.reason}
                  </div>
                </div>
              </div>

              {/* Editable fields */}
              <div className="composer-body">
                {/* Subject */}
                <div className="field">
                  <div className="field-label">
                    Subject
                    <span className="edit-tag">editable before you copy</span>
                  </div>
                  <input
                    className="subj"
                    value={draft.subject}
                    onChange={e => updateDraft(selected.id, { subject: e.target.value })}
                    disabled={isActioned}
                  />
                </div>

                {/* Body */}
                <div className="field">
                  <div className="field-label">
                    Message
                    <span className="edit-tag">prefilled · editable before you copy</span>
                  </div>
                  <textarea
                    className="bodytext scrollbar-thin"
                    value={draft.body}
                    onChange={e => updateDraft(selected.id, { body: e.target.value })}
                    disabled={isActioned}
                  />
                </div>
              </div>

              {/* Action footer */}
              <div className="composer-actions">
                {/* Open in Gmail (BCC'd to HubSpot) */}
                <button
                  className="btn btn-primary"
                  onClick={() => openInGmail(selected)}
                  disabled={isActioned}
                  style={{ opacity: isActioned ? 0.4 : 1 }}
                >
                  <Send size={13} />
                  Open in Gmail
                </button>

                {/* Copy */}
                <button
                  className="btn btn-outline"
                  onClick={() => copyToClipboard(selected)}
                  disabled={isActioned}
                  style={{ opacity: isActioned ? 0.4 : 1 }}
                >
                  <Copy size={13} />
                  Copy email
                </button>

                {/* Flash */}
                <span className={`copy-flash ${flash ? 'show' : ''}`}>
                  <Check size={14} />
                  Copied to clipboard
                </span>

                <span className="spacer" />

                {/* Mark as sent / already actioned */}
                {isActioned ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontFamily: 'var(--font-display)', fontWeight: 700,
                    fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: isSent ? 'var(--st-green)' : 'var(--fg-subtle)',
                  }}>
                    <CheckCircle size={14} />
                    {isSent ? 'Marked Sent' : 'Skipped'}
                  </span>
                ) : (
                  <>
                    <button
                      className="btn btn-outline"
                      onClick={() => markSkipped(selected.id)}
                      disabled={!!actioning}
                      style={{ fontSize: 12 }}
                    >
                      Skip
                    </button>
                    <button
                      className="btn btn-outline"
                      onClick={() => markSent(selected.id)}
                      disabled={!!actioning}
                      style={{ fontSize: 12 }}
                    >
                      {actioning === selected.id
                        ? <span style={{
                            width: 11, height: 11,
                            border: '2px solid rgba(18,18,20,0.3)', borderTopColor: 'var(--usr-black)',
                            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                            display: 'inline-block'
                          }} />
                        : <Mail size={12} />
                      }
                      Mark Sent
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Empty composer when queue is fully actioned */
            <div className="composer">
              <div className="hub-empty">
                <CheckCircle size={52} style={{ color: 'var(--st-green)' }} />
                <h3>Queue Cleared</h3>
                <p>You've actioned every email in your region. New triggers land here automatically as lab statuses change.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
