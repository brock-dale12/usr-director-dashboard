import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/fetchAll'
import { isActiveAccount } from '../lib/customerActions'
import { Link2, Loader2, Search, AlertTriangle, CheckCircle2, X } from 'lucide-react'

/**
 * Data Connections — admin audit of how each customer is wired across the three
 * systems, so you can SEE and trust the linkage (and spot anything that isn't
 * cleanly connected):
 *
 *   • HubSpot   — deal_id (roster key) + hubspot_company_id (dedup identity)
 *   • USR DB    — which org it resolved to + match quality (exact/fuzzy/linked/none)
 *   • Region    — whether an ACTIVE lab_assignment joins by ID (post-repair) or
 *                 still only by fuzzy name (the gap that hides mis-attribution)
 *
 * "Needs review" = missing company_id, OR org link fuzzy/none, OR the assignment
 * still joins by name. This is the view that would have surfaced the 9 name-only
 * assignments at a glance.
 */

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// USR-DB org link bucket — mirrors MyCustomers.orgLinkBucket so the badges agree.
const orgBucket = (a, orgIdFromSnap) =>
  a?.org_match_kind || ((a?.org_id ?? orgIdFromSnap) ? 'linked' : 'none')

const ORG_LABEL = { exact: 'Verified', fuzzy: 'Fuzzy — verify', linked: 'Linked', none: 'Not linked' }
const ORG_TONE  = { exact: 'ok', fuzzy: 'warn', linked: 'ok', none: 'bad' }
const ASSIGN_LABEL = { 'by-id': 'By ID', 'by-name': 'By name — fragile', none: 'No assignment' }
const ASSIGN_TONE  = { 'by-id': 'ok', 'by-name': 'warn', none: 'muted' }

function Chip({ tone, children, title }) {
  const palette = {
    ok:    { bg: 'rgba(29,178,113,0.12)',  fg: 'var(--st-green, #1DB271)' },
    warn:  { bg: 'rgba(242,129,14,0.14)',  fg: 'var(--st-orange, #F2810E)' },
    bad:   { bg: 'rgba(236,54,66,0.12)',   fg: 'var(--st-red, #EC3642)' },
    muted: { bg: 'var(--bg-alt, #f1f1f1)', fg: 'var(--fg-subtle, #888)' },
  }[tone] || {}
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
      borderRadius: 100, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
      background: palette.bg, color: palette.fg,
    }}>{children}</span>
  )
}

export default function DataConnections() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [onlyReview, setOnlyReview] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [acctRes, snaps, assignRes] = await Promise.all([
        supabase.from('lab_accounts').select('*'),
        fetchAllRows('weekly_health_snapshots', 'lab_name, deal_id, org_id, week_start').catch(() => []),
        supabase.from('lab_assignments').select('lab_name, hubspot_deal_id, active').then(r => r, () => ({ data: [] })),
      ])
      if (cancelled) return

      // Latest org_id per deal / lab from snapshots (org_id is stamped there today).
      const orgByDeal = {}, orgByLab = {}, seenD = {}, seenL = {}
      ;(snaps || []).forEach(s => {
        if (s.deal_id && s.org_id != null && (!seenD[s.deal_id] || (s.week_start || '') > seenD[s.deal_id])) { seenD[s.deal_id] = s.week_start || ''; orgByDeal[s.deal_id] = s.org_id }
        if (s.lab_name && s.org_id != null && (!seenL[s.lab_name] || (s.week_start || '') > seenL[s.lab_name])) { seenL[s.lab_name] = s.week_start || ''; orgByLab[s.lab_name] = s.org_id }
      })

      // Active assignments: which deal_ids join by ID, which names join by name.
      const idJoin = new Set(), nameJoin = new Set()
      ;((assignRes && assignRes.data) || []).forEach(a => {
        if (a.active === false) return
        if (a.hubspot_deal_id) idJoin.add(String(a.hubspot_deal_id))
        if (a.lab_name) nameJoin.add(norm(a.lab_name))
      })

      const built = (acctRes.data || []).filter(isActiveAccount).map(a => {
        const orgIdSnap = (a.deal_id != null ? orgByDeal[a.deal_id] : undefined) ?? (a.lab_name ? orgByLab[a.lab_name] : undefined)
        const org = orgBucket(a, orgIdSnap)
        const companyLinked = !!a.hubspot_company_id
        const dealId = a.deal_id != null ? String(a.deal_id) : null
        const assignment = dealId && idJoin.has(dealId)
          ? 'by-id'
          : (nameJoin.has(norm(a.company_name)) || nameJoin.has(norm(a.lab_name))) ? 'by-name' : 'none'
        const needsReview = !companyLinked || org === 'none' || org === 'fuzzy' || assignment === 'by-name'
        return {
          name: a.company_name || a.lab_name || '(unnamed customer)',
          dealId, companyId: a.hubspot_company_id || null,
          orgId: a.org_id ?? orgIdSnap ?? null, orgName: a.org_name || null,
          org, companyLinked, assignment, needsReview,
          churnFlagged: a.churn_flagged === true,
          stage: a.deal_stage_label || null,
        }
      })
      built.sort((x, y) => (Number(y.needsReview) - Number(x.needsReview)) || x.name.localeCompare(y.name))
      setRows(built)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  const reviewCount = useMemo(() => rows.filter(r => r.needsReview).length, [rows])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (onlyReview && !r.needsReview) return false
      if (q && !`${r.name} ${r.dealId || ''} ${r.companyId || ''} ${r.orgName || ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, search, onlyReview])

  if (loading) return (
    <div className="screen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ textAlign: 'center' }}>
        <Loader2 size={26} style={{ animation: 'spin 0.9s linear infinite', color: 'var(--usr-pink)' }} />
        <div style={{ marginTop: 12, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-subtle)' }}>Checking connections…</div>
      </div>
    </div>
  )

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="topbar-eyebrow">
            USR Customer Success · {rows.length} active customer{rows.length !== 1 ? 's' : ''}
            {reviewCount > 0 && <span style={{ color: 'var(--st-orange, #F2810E)' }}> · {reviewCount} need review</span>}
          </div>
          <h1 className="topbar-title">Data Connections</h1>
        </div>
      </div>

      <p style={{ color: 'var(--fg-muted, #666)', fontSize: 13.5, maxWidth: 760, margin: '0 0 18px' }}>
        How each customer is wired across HubSpot, the USR database, and region assignments. Anything not cleanly
        joined by ID is flagged so you can trust — or fix — the linkage.
      </p>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="mc-search" style={{ flex: 1, minWidth: 240 }}>
          <Search size={15} style={{ color: 'var(--fg-subtle)', flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, deal ID, company ID, org…" />
          {search && <button className="mc-search-x" onClick={() => setSearch('')}><X size={14} /></button>}
        </div>
        <button
          onClick={() => setOnlyReview(v => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 6,
            fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${onlyReview ? 'var(--st-orange, #F2810E)' : 'var(--border, #ddd)'}`,
            background: onlyReview ? 'rgba(242,129,14,0.10)' : 'var(--usr-white, #fff)',
            color: onlyReview ? 'var(--st-orange, #F2810E)' : 'var(--fg-muted, #555)',
          }}
        >
          <AlertTriangle size={14} /> Needs review{reviewCount > 0 ? ` (${reviewCount})` : ''}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="stub" style={{ minHeight: 240 }}>
          <div className="stub-mark"><CheckCircle2 size={28} /></div>
          <h2 style={{ fontSize: 24 }}>{onlyReview ? 'Everything is cleanly connected' : 'No customers match'}</h2>
          <p style={{ maxWidth: 420 }}>{onlyReview ? 'No customers need linkage review right now.' : 'Try clearing the search.'}</p>
        </div>
      ) : (
        <div className="section" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--fg-subtle)', fontFamily: 'var(--font-display)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <th style={{ padding: '8px 10px' }}>Customer</th>
                <th style={{ padding: '8px 10px' }}>HubSpot</th>
                <th style={{ padding: '8px 10px' }}>USR DB org</th>
                <th style={{ padding: '8px 10px' }}>Region assignment</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.dealId || r.name + i} style={{ borderTop: '1px solid var(--border, #eee)', background: r.needsReview ? 'rgba(242,129,14,0.035)' : 'transparent' }}>
                  <td style={{ padding: '10px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--usr-black)' }}>
                      {r.needsReview && <AlertTriangle size={13} style={{ color: 'var(--st-orange, #F2810E)', marginRight: 6, verticalAlign: '-1px' }} />}
                      {r.name}
                      {r.churnFlagged && <span style={{ marginLeft: 8, fontSize: 10.5, color: 'var(--st-orange)', fontWeight: 700 }}>· churn-flagged</span>}
                    </div>
                    {r.stage && <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{r.stage}</div>}
                  </td>
                  <td style={{ padding: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>deal <code>{r.dealId || '—'}</code></span>
                      {r.companyLinked
                        ? <Chip tone="ok" title={`HubSpot company ${r.companyId}`}>company {r.companyId}</Chip>
                        : <Chip tone="bad" title="No HubSpot company linked — keyed by deal only">no company id</Chip>}
                    </div>
                  </td>
                  <td style={{ padding: '10px' }}>
                    <Chip tone={ORG_TONE[r.org]} title={r.orgName ? `USR org: ${r.orgName}${r.orgId ? ` (#${r.orgId})` : ''}` : 'No USR organization linked'}>
                      {ORG_LABEL[r.org]}
                    </Chip>
                    {r.orgName && <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 3 }}>{r.orgName}</div>}
                  </td>
                  <td style={{ padding: '10px' }}>
                    <Chip tone={ASSIGN_TONE[r.assignment]}>{ASSIGN_LABEL[r.assignment]}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ color: 'var(--fg-subtle)', fontSize: 12, marginTop: 14, maxWidth: 760 }}>
        <b>By ID</b> = the assignment joins on HubSpot deal/company ID (reliable). <b>By name</b> = it only matches on
        customer name (fragile — fix by stamping the ID). <b>Fuzzy</b> USR-DB links should be eyeballed to confirm the
        right org. Customers removed via churn confirmation aren't shown.
      </p>
    </div>
  )
}
