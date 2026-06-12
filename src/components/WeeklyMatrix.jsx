// WeeklyMatrix — THE canonical weekly activity display, used by every page.
// 5 rows (Session recaps, Logins, Data pts, Athletes, PRs), numbers in every
// cell, colored by that week's official health color (green ≤7d · yellow
// 8–30d · orange 31–90d · red 90+d). Styles: .wk2-* in index.css.
// Feed it the shape from lib/metrics.js → last8Weeks().

export default function WeeklyMatrix({ weeks }) {
  const slots = Array.from({ length: 8 }, (_, i) => weeks[i] || { preCustomer: true })
  const ago = (i) => i === 7 ? 'this week' : `${7 - i}w ago`
  const ROWS = [
    { label: 'Recaps',   get: w => w.recaps },
    { label: 'Logins',   get: w => w.logins },
    { label: 'Data pts', get: w => w.datapoints },
    { label: 'Athletes', get: w => w.athletes },
    { label: 'PRs',      get: w => w.prs },
  ]
  return (
    <>
      <div className="wk2-matrix">
        {ROWS.map(r => (
          <div className="wk2-row" key={r.label}>
            <span className="wk2-label">{r.label}</span>
            {slots.map((wk, i) => {
              const v = r.get(wk)
              const cls = wk.preCustomer ? 'pre' : `hc-${wk.color || 'unknown'}`
              return (
                <span
                  key={i}
                  className={`wk2-cell ${cls}`}
                  title={wk.preCustomer ? `${ago(i)} · before join` : `${ago(i)} · ${v != null ? v : 'no data'} ${r.label.toLowerCase()} · week color: ${wk.color || 'unknown'}`}
                >
                  {wk.preCustomer ? '·' : (v != null ? v : '—')}
                </span>
              )
            })}
          </div>
        ))}
      </div>
      <div className="wk2-foot">8 wks → now · cell color = that week's activity level (green ≤7d · yellow 8–30d · orange 31–90d · red 90+d)</div>
    </>
  )
}
