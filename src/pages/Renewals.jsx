import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/fetchAll'
import { isActiveAccount } from '../lib/customerActions'
import { openGmailDraft, logComm } from '../lib/gmailDraft'
import HealthBadge from '../components/HealthBadge'
import { buildRenewals, TIER_META } from '../lib/renewals'
import { RefreshCw, Mail, Loader2, CalendarClock } from 'lucide-react'

/**
 * Renewals — Admin (Customer Success Hub).
 * The 90/180-day renewal horizon, tiered by urgency + risk (mirrors Ruby):
 * Critical (≤30d & at-risk → personal call) · At risk · This quarter · Upcoming.
 * Risk = activity health (orange/red) + any churn_risk flag.
 */

const money = (v) => (v == null || v === '' ? null : `$${Number(v).toLocaleString()}`)
const whenLabel = (days) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`)

function RenewalCard({ c }) {
  const arr = money(c.amount ?? c.arr_amount)
  const email = c.contact_email
  const draft = () => {
    if (!email) return
    const subject = `${c.lab_name} — checking in ahead of renewal`
    openGmailDraft({ to: email, subject, body: '' })
    logComm({ dealId: c.deal_id, labName: c.lab_name, channel: 'Email', subject, toEmail: email })
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <HealthBadge color={c.healthColor} size="dot" />
        <span className="font-semibold text-gray-900 text-sm truncate" title={c.lab_name}>{c.lab_name}</span>
        {email && (
          <button onClick={draft} title="Draft renewal email" className="ml-auto text-gray-400 hover:text-usr-pink">
            <Mail size={14} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-600">
        <CalendarClock size={12} className="text-gray-400" />
        <span className="font-medium">{whenLabel(c.days)}</span>
        <span className="text-gray-400">· {String(c.renewal_date).slice(0, 10)}</span>
      </div>
      <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px]">
        {arr && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium">{arr}/yr</span>}
        {c.renewal_status && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{c.renewal_status}</span>}
        {c.churn_risk && c.churn_risk !== 'No' && (
          <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">⚠ {c.churn_risk}</span>
        )}
        {c.speed_lab_director && <span className="text-gray-400">· {c.speed_lab_director}</span>}
      </div>
    </div>
  )
}

export default function Renewals() {
  const [accounts, setAccounts] = useState(null)
  const [snaps, setSnaps] = useState([])
  const [err, setErr] = useState(null)

  useEffect(() => {
    let on = true
    ;(async () => {
      try {
        const [acct, weekly, cs] = await Promise.all([
          supabase.from('lab_accounts').select('*'),
          fetchAllRows('weekly_health_snapshots', 'lab_name, week_start, health_color'),
          supabase.from('onboarding_cs').select('deal_id, contact_email, kickoff_date').then(r => r, () => ({ data: [] })),
        ])
        if (acct.error) throw acct.error
        const csMap = {}
        ;((cs && cs.data) || []).forEach(r => { csMap[r.deal_id] = r })
        const merged = (acct.data || []).filter(isActiveAccount).map(a => ({
          ...a,
          contact_email: csMap[a.deal_id]?.contact_email ?? a.contact_email,
        }))
        if (on) { setAccounts(merged); setSnaps(weekly || []) }
      } catch (e) {
        if (on) setErr(String(e.message || e))
      }
    })()
    return () => { on = false }
  }, [])

  const latestHealthByLab = useMemo(() => {
    const m = {}
    for (const s of snaps) {
      if (!s.lab_name) continue
      if (!m[s.lab_name] || String(s.week_start) > String(m[s.lab_name].week_start)) m[s.lab_name] = s
    }
    return m
  }, [snaps])

  const { groups, total } = useMemo(() => {
    if (!accounts) return { groups: [], total: 0 }
    const customers = accounts.map(a => ({
      ...a,
      healthColor: latestHealthByLab[a.lab_name]?.health_color || 'unknown',
    }))
    return buildRenewals(customers)
  }, [accounts, latestHealthByLab])

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="topbar-eyebrow">USR Customer Success</div>
          <h1 className="topbar-title">Renewals</h1>
        </div>
        {accounts && <div className="text-sm text-gray-500">{total} in the next 180 days</div>}
      </div>

      {err && <div className="px-6 text-red-600 text-sm">Couldn’t load renewals: {err}</div>}
      {accounts === null && !err && (
        <div className="flex items-center gap-2 text-gray-500 text-sm px-6 py-8"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      )}

      {accounts && total === 0 && !err && (
        <div className="stub">
          <div className="stub-mark"><RefreshCw size={28} /></div>
          <h2 style={{ fontSize: 22 }}>No renewals in the next 180 days</h2>
          <p style={{ maxWidth: 460 }}>As contract end dates approach, customers will appear here tiered by urgency and risk.</p>
        </div>
      )}

      {accounts && total > 0 && (
        <div className="px-6 pb-10 space-y-6">
          {groups.filter(g => g.customers.length).map(g => (
            <section key={g.tier}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{ width: 10, height: 10, borderRadius: 3, background: g.accent, display: 'inline-block' }} />
                <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">{g.label}</h2>
                <span className="text-xs text-gray-400">{g.note} · {g.customers.length}</span>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {g.customers.map(c => <RenewalCard key={c.deal_id} c={c} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
