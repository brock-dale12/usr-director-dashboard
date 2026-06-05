import { RefreshCw } from 'lucide-react'

/**
 * Renewals — Admin (Customer Success Hub).
 *
 * SCAFFOLD / EMPTY STATE. Intended to surface active customers by renewal_date /
 * renewal_status (upcoming, at-risk, this quarter). Exact definition pending
 * Brock's tweaks. Built after Onboarding.
 */
export default function Renewals() {
  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="topbar-eyebrow">USR Customer Success</div>
          <h1 className="topbar-title">Renewals</h1>
        </div>
      </div>

      <div className="stub">
        <div className="stub-mark"><RefreshCw size={28} /></div>
        <h2 style={{ fontSize: 28 }}>Renewals</h2>
        <p style={{ maxWidth: 460 }}>
          Stay ahead of every renewal — what's coming up, what's at risk, and what's
          due this quarter. Coming soon.
        </p>
      </div>
    </div>
  )
}
