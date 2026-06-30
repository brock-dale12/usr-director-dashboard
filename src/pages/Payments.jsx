import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isActiveAccount } from '../lib/customerActions'
import { openGmailDraft, logComm } from '../lib/gmailDraft'
import { buildPayments, ACTION_TIERS } from '../lib/payments'
import { CreditCard, Mail, Loader2 } from 'lucide-react'

/**
 * Payments — Admin (Customer Success Hub). Lightweight CS view of the HubSpot
 * payment fields synced into lab_accounts (received status, overdue amount,
 * processor, billing day). Grouped worst-first; Paid shown as a count. The deeper
 * Measure/QuickBooks billing dashboard is a separate effort.
 */

const money = (v) => (v == null || v === '' ? null : `$${Number(v).toLocaleString()}`)

function PayCard({ c }) {
  const email = c.contact_email
  const draft = () => {
    if (!email) return
    const subject = `${c.lab_name} — quick note on your USR payment`
    openGmailDraft({ to: email, subject, body: '' })
    logComm({ dealId: c.deal_id, labName: c.lab_name, channel: 'Email', subject, toEmail: email })
  }
  const overdue = money(c.overdue_amount)
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-900 text-sm truncate" title={c.lab_name}>{c.lab_name}</span>
        {email && (
          <button onClick={draft} title="Draft payment email" className="ml-auto text-gray-400 hover:text-usr-pink">
            <Mail size={14} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px]">
        {c.overdue > 0 && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-semibold">{overdue} overdue</span>}
        {c.payment_processor && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{c.payment_processor}</span>}
        {c.payment_status && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">bills {c.payment_status}</span>}
        {c.speed_lab_director && <span className="text-gray-400">· {c.speed_lab_director}</span>}
      </div>
    </div>
  )
}

export default function Payments() {
  const [accounts, setAccounts] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let on = true
    ;(async () => {
      try {
        const [acct, cs] = await Promise.all([
          supabase.from('lab_accounts').select('*'),
          supabase.from('onboarding_cs').select('deal_id, contact_email').then(r => r, () => ({ data: [] })),
        ])
        if (acct.error) throw acct.error
        const csMap = {}
        ;((cs && cs.data) || []).forEach(r => { csMap[r.deal_id] = r })
        const merged = (acct.data || []).filter(isActiveAccount).map(a => ({
          ...a,
          contact_email: csMap[a.deal_id]?.contact_email ?? a.contact_email,
        }))
        if (on) setAccounts(merged)
      } catch (e) {
        if (on) setErr(String(e.message || e))
      }
    })()
    return () => { on = false }
  }, [])

  const { groups, total, needsAttention } = useMemo(
    () => (accounts ? buildPayments(accounts) : { groups: [], total: 0, needsAttention: 0 }),
    [accounts],
  )
  const paid = groups.find(g => g.tier === 'Paid')
  const actionGroups = groups.filter(g => ACTION_TIERS.includes(g.tier) && g.count)

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="topbar-eyebrow">USR Customer Success</div>
          <h1 className="topbar-title">Payments</h1>
        </div>
        {accounts && (
          <div className="text-sm text-gray-500">
            {needsAttention > 0 && <span className="text-red-600 font-semibold">{money(needsAttention)} overdue</span>}
            {needsAttention > 0 && ' · '}{total} with a payment status
          </div>
        )}
      </div>

      {err && <div className="px-6 text-red-600 text-sm">Couldn’t load payments: {err}</div>}
      {accounts === null && !err && (
        <div className="flex items-center gap-2 text-gray-500 text-sm px-6 py-8"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      )}

      {accounts && total === 0 && !err && (
        <div className="stub">
          <div className="stub-mark"><CreditCard size={28} /></div>
          <h2 style={{ fontSize: 22 }}>No payment statuses yet</h2>
          <p style={{ maxWidth: 460 }}>Once HubSpot payment fields sync, overdue and open accounts appear here, worst first.</p>
        </div>
      )}

      {accounts && total > 0 && (
        <div className="px-6 pb-10 space-y-6">
          {!actionGroups.length && <div className="text-sm text-green-700">All accounts are up to date. 🎉</div>}
          {actionGroups.map(g => (
            <section key={g.tier}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{ width: 10, height: 10, borderRadius: 3, background: g.accent, display: 'inline-block' }} />
                <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">{g.tier}</h2>
                <span className="text-xs text-gray-400">
                  {g.note} · {g.count}{g.overdueSum > 0 ? ` · ${money(g.overdueSum)} overdue` : ''}
                </span>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {g.customers.map(c => <PayCard key={c.deal_id} c={c} />)}
              </div>
            </section>
          ))}
          {paid?.count > 0 && (
            <div className="text-sm text-gray-500 pt-2 border-t border-gray-100">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-2 align-middle" />
              {paid.count} account{paid.count === 1 ? '' : 's'} up to date
            </div>
          )}
        </div>
      )}
    </div>
  )
}
