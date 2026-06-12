import { CreditCard } from 'lucide-react'

/**
 * Payments — Admin (Customer Success Hub).
 *
 * SCAFFOLD / EMPTY STATE. Intended to surface payment_status / overdue accounts.
 * Exact definition pending Brock's tweaks. Built last of the three new pages.
 */
export default function Payments() {
  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="topbar-eyebrow">USR Customer Success</div>
          <h1 className="topbar-title">Payments</h1>
        </div>
      </div>

      <div className="stub">
        <div className="stub-mark"><CreditCard size={28} /></div>
        <h2 style={{ fontSize: 28 }}>Payments</h2>
        <p style={{ maxWidth: 460 }}>
          Know who's paid, who's overdue, and where money is stuck — before it
          becomes a churn risk. Coming soon.
        </p>
      </div>
    </div>
  )
}
