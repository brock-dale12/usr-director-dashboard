import { useState } from 'react'
import { AlertTriangle, Check, X, Loader2 } from 'lucide-react'
import { confirmChurn, keepActive } from '../lib/customerActions'

/**
 * ChurnReview — surfaces customers the HubSpot sync flagged for churn (all of
 * their deals left the active roster). The sync never deletes; a human confirms:
 *   • Remove  → confirmChurn → is_active=false (drops out of every view).
 *   • Keep    → keepActive   → clears the flag, row stays active.
 *
 * Renders nothing when there's nothing to review. Calls onResolved(dealId, action)
 * so the parent can update its local list without a full refetch.
 */
export default function ChurnReview({ accounts, onResolved }) {
  const flagged = (accounts || []).filter(a => a.churn_flagged === true && a.is_active !== false)
  const [busy, setBusy] = useState({})   // dealId → 'confirm_churn' | 'keep_active'

  if (!flagged.length) return null

  const act = async (a, action) => {
    const dealId = a.deal_id
    if (!dealId || busy[dealId]) return
    setBusy(b => ({ ...b, [dealId]: action }))
    try {
      if (action === 'confirm_churn') await confirmChurn(dealId)
      else await keepActive(dealId)
      onResolved?.(dealId, action)
    } catch (e) {
      alert(`Couldn't ${action === 'confirm_churn' ? 'remove' : 'keep'} this customer: ${e.message || e}`)
      setBusy(b => { const n = { ...b }; delete n[dealId]; return n })
    }
  }

  return (
    <div
      className="section"
      style={{
        border: '1px solid var(--st-orange, #F2810E)',
        borderLeftWidth: 4,
        borderRadius: 8,
        background: 'rgba(242,129,14,0.06)',
        padding: '16px 18px',
        marginBottom: 18,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <AlertTriangle size={18} style={{ color: 'var(--st-orange, #F2810E)', flexShrink: 0 }} />
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--usr-black)' }}>
            {flagged.length} customer{flagged.length !== 1 ? 's' : ''} flagged for churn review
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-muted, #666)', marginTop: 2 }}>
            The HubSpot sync found no active deals for these. Remove to archive them (kept in history), or keep them active.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {flagged.map(a => {
          const b = busy[a.deal_id]
          const name = a.company_name || a.lab_name || '(unnamed customer)'
          return (
            <div
              key={a.deal_id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 12px', background: 'var(--usr-white, #fff)',
                border: '1px solid var(--border, #e5e5e5)', borderRadius: 6,
              }}
            >
              <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: 'var(--usr-black)' }}>
                {name}
                {a.deal_stage_label && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--fg-subtle)', fontWeight: 500 }}>
                    · last stage: {a.deal_stage_label}
                  </span>
                )}
              </span>
              <button
                className="btn btn-ghost"
                style={{ padding: '6px 12px', fontSize: 12 }}
                onClick={() => act(a, 'keep_active')}
                disabled={!!b}
              >
                {b === 'keep_active' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={13} />}
                Keep active
              </button>
              <button
                className="btn"
                style={{ padding: '6px 12px', fontSize: 12, background: 'var(--st-red, #EC3642)', color: '#fff', border: 'none', borderRadius: 4 }}
                onClick={() => act(a, 'confirm_churn')}
                disabled={!!b}
              >
                {b === 'confirm_churn' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <X size={13} />}
                Remove
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
