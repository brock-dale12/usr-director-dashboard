import { useState, useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/fetchAll'
import { openGmailDraft, logComm } from '../lib/gmailDraft'
import { Users, Loader2, Search, Check, X, Star } from 'lucide-react'
import { LabCard, HeroScore, HeroGreenRate } from './MyRegion'
import FilterDropdown, { splitHw } from '../components/FilterDropdown'

/**
 * My Customers — Admin (Customer Success Hub) landing.
 *
 * Admin toolbar: name search, multi-select HubSpot filters (Product, Deal Stage,
 * Customer Segment, Speed Lab Director, Deal Owner, Hardware), sortable list, and
 * a per-user saved "default view" (search + filters + sort) stored in
 * dashboard_prefs and reloaded on login. Filters AND across categories, OR within.
 *
 * Speed Labs show full health; non-Speed-Lab customers show commercial detail with
 * a graceful "no activity data yet" state.
 */

const COLOR_ORDER = { red: 0, orange: 1, yellow: 2, green: 3, unknown: 4 }

const EMPTY_FILTERS = { product: [], dealStage: [], customerSegment: [], speedLabDirector: [], dealOwner: [], hardware: [], orgMatch: [] }

// USR-DB org link quality (from backfill_health_all.py org resolution).
// Surfaced so a wrong/missing link — the main source of bad activity/health
// numbers — is visible and correctable.
//   exact  : matched on hubspot_company_id (verified)        [needs migration]
//   fuzzy  : matched by normalized name (verify it's right)  [needs migration]
//   linked : org_id present but quality not yet classified   [pre-migration interim]
//   none   : no USR org → activity/health can't be computed
const ORG_MATCH_LABEL = { exact: 'Linked · verified', fuzzy: 'Fuzzy match · verify', linked: 'Linked', none: 'Not linked' }
const ORG_MATCH_SORT  = { none: 0, fuzzy: 1, linked: 2, exact: 3 }
// Prefer the persisted match_kind (post-migration); fall back to "linked vs not"
// from the org_id stamped on the snapshot today.
const orgLinkBucket = (account, snap) =>
  account?.org_match_kind || ((account?.org_id ?? snap?.org_id) ? 'linked' : 'none')

const SORT_FIELDS = [
  { value: 'health',  label: 'Health (worst→best)' },
  { value: 'name',    label: 'Customer name' },
  { value: 'score',   label: 'Monthly score' },
  { value: 'renewal', label: 'Renewal date' },
  { value: 'arr',     label: 'ARR' },
  { value: 'days',    label: 'Days since activity' },
]

export default function MyCustomers() {
  const { director } = useAuth()

  const [loading, setLoading]   = useState(true)
  const [accounts, setAccounts] = useState([])
  const [snaps, setSnaps]       = useState([])
  const [scoreMap, setScoreMap] = useState({})
  const [scoreMapDeal, setScoreMapDeal] = useState({})
  const [comms, setComms]       = useState([])

  // toolbar state
  const [search, setSearch]   = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sort, setSort]       = useState({ field: 'health', dir: 'asc' })
  const prefsApplied = useRef(false)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [acctRes, allSnaps, monthRows, prefsRes, commsRes, csRes] = await Promise.all([
        supabase.from('lab_accounts').select('*'),
        fetchAllRows('weekly_health_snapshots'),
        fetchAllRows('monthly_health_snapshots', 'lab_name, deal_id, month, health_score'),
        director?.id
          ? supabase.from('dashboard_prefs').select('default_view').eq('director_id', director.id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('customer_comms').select('*').order('logged_at', { ascending: false }).then(r => r, () => ({ data: [] })),
        supabase.from('onboarding_cs').select('*').then(r => r, () => ({ data: [] })),
      ])
      if (cancelled) return

      const sMap = {}, sMapDeal = {}, seenLab = {}, seenDeal = {}
      ;(monthRows || []).forEach(m => {
        if (m.lab_name && (!seenLab[m.lab_name] || m.month > seenLab[m.lab_name])) { seenLab[m.lab_name] = m.month; sMap[m.lab_name] = m.health_score }
        if (m.deal_id && (!seenDeal[m.deal_id] || m.month > seenDeal[m.deal_id])) { seenDeal[m.deal_id] = m.month; sMapDeal[m.deal_id] = m.health_score }
      })

      // CANON (lib/metrics.js): merge CS dashboard edits (onboarding_cs) over
      // HubSpot-synced values so lists, filters, and cards all agree.
      const csMap = {}
      ;((csRes && csRes.data) || []).forEach(r => { csMap[r.deal_id] = r })
      const merged = (acctRes.data || []).map(a => {
        const cs = csMap[a.deal_id]
        return cs ? {
          ...a,
          contact_name:       cs.contact_name ?? a.contact_name,
          contact_email:      cs.contact_email ?? a.contact_email,
          contact_phone:      cs.contact_phone ?? a.contact_phone,
          speed_lab_director: cs.speed_lab_director ?? a.speed_lab_director,
          kickoff_date:       cs.kickoff_date ?? null,
        } : a
      })
      setAccounts(merged)
      setSnaps(allSnaps)
      setScoreMap(sMap)
      setScoreMapDeal(sMapDeal)
      setComms((commsRes && commsRes.data) || [])

      // Apply saved default view, or fall back to "my deals" (owner = me).
      if (!prefsApplied.current) {
        const view = prefsRes && prefsRes.data && prefsRes.data.default_view
        if (view) {
          setSearch(view.search || '')
          setFilters({ ...EMPTY_FILTERS, ...(view.filters || {}) })
          if (view.sort) setSort(view.sort)
        } else if (director?.email) {
          setFilters({ ...EMPTY_FILTERS, dealOwner: [director.email.toLowerCase()] })
        }
        prefsApplied.current = true
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [director])

  const latestSnapByLab = useMemo(() => {
    const m = {}
    snaps.forEach(s => { if (s.lab_name && (!m[s.lab_name] || (s.week_start || '') > (m[s.lab_name].week_start || ''))) m[s.lab_name] = s })
    return m
  }, [snaps])
  const latestSnapByDeal = useMemo(() => {
    const m = {}
    snaps.forEach(s => { if (s.deal_id && (!m[s.deal_id] || (s.week_start || '') > (m[s.deal_id].week_start || ''))) m[s.deal_id] = s })
    return m
  }, [snaps])

  // Communications grouped by deal, newest first.
  const commsByDeal = useMemo(() => {
    const m = {}
    comms.forEach(c => { if (c.deal_id) (m[c.deal_id] = m[c.deal_id] || []).push(c) })
    return m
  }, [comms])

  // Open a pre-filled Gmail draft to the customer's primary contact (BCC'd to
  // HubSpot for auto-logging), record it in the dashboard, and show it locally.
  const draftEmail = (account) => {
    const to = account?.contact_email
    if (!to) return
    openGmailDraft({ to, subject: '', body: '' })
    const loggedBy = director?.email || director?.name || null
    logComm({ dealId: account.deal_id, labName: account.lab_name, channel: 'Email', subject: '', toEmail: to, loggedBy })
    setComms(prev => [{
      id: `local-${Date.now()}`, deal_id: account.deal_id, lab_name: account.lab_name,
      subject: '', to_email: to, logged_by: loggedBy, logged_at: new Date().toISOString(),
    }, ...prev])
  }

  // Build the customer rows (account + health snap + score) once.
  // CANON: deal_id is the single key. Every weekly/monthly snapshot row carries
  // deal_id (backfill_health_all.py), so the deal join is authoritative; the
  // lab_name join is a legacy fallback only (and lab_name is no longer unique).
  const allRows = useMemo(() => accounts.map(a => {
    const snap = (a.deal_id != null && latestSnapByDeal[a.deal_id]) || (a.lab_name && latestSnapByLab[a.lab_name]) || {
      id: `deal-${a.deal_id || a.lab_name || Math.random()}`,
      lab_name: a.lab_name || a.company_name || '(unnamed customer)',
      health_color: 'unknown', days_since_activity: null,
    }
    const score = (a.deal_id != null ? scoreMapDeal[a.deal_id] : undefined) ?? (a.lab_name ? scoreMap[a.lab_name] : undefined) ?? null
    return { account: a, snap, score }
  }), [accounts, latestSnapByLab, latestSnapByDeal, scoreMap, scoreMapDeal])

  // Filter option lists (with counts) derived from the data.
  const opts = useMemo(() => {
    const tally = (getter) => {
      const m = {}
      accounts.forEach(a => { const v = getter(a); if (v) m[v] = (m[v] || 0) + 1 })
      return Object.entries(m).sort((x, y) => x[0].localeCompare(y[0])).map(([value, count]) => ({ value, label: value, count }))
    }
    const hw = {}
    accounts.forEach(a => splitHw(a.hardware).forEach(t => { hw[t] = (hw[t] || 0) + 1 }))
    const owners = {}
    accounts.forEach(a => {
      const email = (a.deal_owner_email || '').toLowerCase()
      const name = a.deal_owner_name || a.deal_owner_email || 'Unassigned'
      const key = email || '__none__'
      if (!owners[key]) owners[key] = { value: key, label: name, count: 0 }
      owners[key].count++
    })
    return {
      product:          tally(a => a.product),
      dealStage:        tally(a => a.deal_stage_label),
      customerSegment:  tally(a => a.customer_segment),
      speedLabDirector: tally(a => a.speed_lab_director),
      hardware:         Object.entries(hw).sort((x, y) => x[0].localeCompare(y[0])).map(([value, count]) => ({ value, label: value, count })),
      dealOwner:        Object.values(owners).sort((a, b) => (a.label || '').localeCompare(b.label || '')),
    }
  }, [accounts])

  // Org-link options need the snapshot too (org_id lives on the snapshot today),
  // so they're tallied over the built rows rather than raw accounts.
  const orgMatchOpts = useMemo(() => {
    const m = {}
    allRows.forEach(({ account, snap }) => { const k = orgLinkBucket(account, snap); m[k] = (m[k] || 0) + 1 })
    return Object.entries(m)
      .sort((x, y) => (ORG_MATCH_SORT[x[0]] ?? 9) - (ORG_MATCH_SORT[y[0]] ?? 9))
      .map(([value, count]) => ({ value, label: ORG_MATCH_LABEL[value] || value, count }))
  }, [allRows])

  // Apply search + filters + sort.
  const customers = useMemo(() => {
    const q = search.trim().toLowerCase()
    const f = filters
    const passes = (r) => {
      const a = r.account
      if (q) {
        const name = `${a.company_name || ''} ${a.lab_name || ''}`.toLowerCase()
        if (!name.includes(q)) return false
      }
      if (f.product.length && !f.product.includes(a.product)) return false
      if (f.dealStage.length && !f.dealStage.includes(a.deal_stage_label)) return false
      if (f.customerSegment.length && !f.customerSegment.includes(a.customer_segment)) return false
      if (f.speedLabDirector.length && !f.speedLabDirector.includes(a.speed_lab_director)) return false
      if (f.dealOwner.length) {
        const ownerKey = (a.deal_owner_email || '').toLowerCase() || '__none__'
        if (!f.dealOwner.includes(ownerKey)) return false
      }
      if (f.hardware.length) {
        const toks = splitHw(a.hardware)
        if (!toks.some(t => f.hardware.includes(t))) return false
      }
      if (f.orgMatch.length && !f.orgMatch.includes(orgLinkBucket(a, r.snap))) return false
      return true
    }

    const dir = sort.dir === 'desc' ? -1 : 1
    const keyFns = {
      health: (r) => COLOR_ORDER[r.snap.health_color] ?? 5,
      name:   (r) => (r.account.company_name || r.snap.lab_name || '').toLowerCase(),
      score:  (r) => r.score,
      renewal:(r) => r.account.renewal_date || null,
      arr:    (r) => r.account.arr_amount,
      days:   (r) => r.snap.days_since_activity,
    }
    const keyFn = keyFns[sort.field] || keyFns.health
    const cmp = (x, y) => {
      const a = keyFn(x), b = keyFn(y)
      const an = a == null || a === '', bn = b == null || b === ''
      if (an && bn) return 0
      if (an) return 1            // nulls always last
      if (bn) return -1
      if (a < b) return -1 * dir
      if (a > b) return 1 * dir
      // tiebreak by name
      return (x.account.company_name || '').localeCompare(y.account.company_name || '')
    }
    return allRows.filter(passes).sort(cmp)
  }, [allRows, search, filters, sort])

  const activeFilterCount = Object.values(filters).reduce((n, arr) => n + arr.length, 0)

  // Hero metrics over filtered customers with health data
  const withHealth = customers.filter(c => c.snap.health_color && c.snap.health_color !== 'unknown')
  const counts = { green: 0, yellow: 0, orange: 0, red: 0 }
  withHealth.forEach(c => { counts[c.snap.health_color] = (counts[c.snap.health_color] || 0) + 1 })
  const totalWithHealth = withHealth.length
  const pctGreen = totalWithHealth > 0 ? Math.round((counts.green / totalWithHealth) * 100) : 0
  const scored = customers.map(c => c.score).filter(v => v != null)
  const avgScore = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null
  const noActivity = customers.length - totalWithHealth

  const setFilter = (key, vals) => setFilters(prev => ({ ...prev, [key]: vals }))
  const clearAll = () => { setSearch(''); setFilters(director?.email ? { ...EMPTY_FILTERS, dealOwner: [director.email.toLowerCase()] } : EMPTY_FILTERS) }

  const saveDefault = async () => {
    if (!director?.id) return
    setSaveState('saving')
    try {
      await supabase.from('dashboard_prefs').upsert(
        { director_id: director.id, default_view: { search, filters, sort }, updated_at: new Date().toISOString() },
        { onConflict: 'director_id' },
      )
      setSaveState('saved'); setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      setSaveState('idle')
    }
  }

  if (loading) return (
    <div className="screen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ textAlign: 'center' }}>
        <Loader2 size={26} style={{ animation: 'spin 0.9s linear infinite', color: 'var(--usr-pink)' }} />
        <div style={{ marginTop: 12, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-subtle)' }}>Loading customers...</div>
      </div>
    </div>
  )

  return (
    <div className="screen">
      {/* ── Topbar ──────────────────────────────────────────────────────── */}
      <div className="topbar">
        <div>
          <div className="topbar-eyebrow">
            USR Customer Success · {customers.length} customer{customers.length !== 1 ? 's' : ''}
            {noActivity > 0 && <span style={{ color: 'var(--fg-subtle)' }}> · {noActivity} no activity data yet</span>}
          </div>
          <h1 className="topbar-title">My Customers</h1>
        </div>
      </div>

      {/* ── Hero metrics ────────────────────────────────────────────────── */}
      {totalWithHealth > 0 && (
        <div className="hero-grid">
          <HeroScore avgScore={avgScore} delta={null} totalLabs={totalWithHealth} scopeLabel="customers with activity data" />
          <HeroGreenRate counts={counts} totalLabs={totalWithHealth} pctGreen={pctGreen} delta={null} title="Weekly Active · Customer Green Rate" unitLabel="customers" />
        </div>
      )}

      {/* ── Row 1: search · sort · save (inline) ────────────────────────── */}
      <div className="mc-toolbar-top">
        <div className="mc-search">
          <Search size={15} style={{ color: 'var(--fg-subtle)', flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer name…" />
          {search && <button className="mc-search-x" onClick={() => setSearch('')}><X size={14} /></button>}
        </div>
        <div className="mc-sort">
          <span className="mc-sort-label">Sort</span>
          <select value={sort.field} onChange={e => setSort(s => ({ ...s, field: e.target.value }))}>
            {SORT_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <button className="mc-sort-dir" onClick={() => setSort(s => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))} title="Toggle direction">
            {sort.dir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
        <button className={`mc-save-btn ${saveState === 'saved' ? 'saved' : ''}`} onClick={saveDefault} disabled={saveState === 'saving'}>
          {saveState === 'saved' ? <><Check size={14} />Saved</> : <><Star size={14} />Save as my default</>}
        </button>
      </div>

      {/* ── Row 2: filters ──────────────────────────────────────────────── */}
      <div className="mc-toolbar-filters">
        <FilterDropdown label="Deal Owner"         options={opts.dealOwner}        selected={filters.dealOwner}        onChange={v => setFilter('dealOwner', v)} />
        <FilterDropdown label="Deal Stage"         options={opts.dealStage}        selected={filters.dealStage}        onChange={v => setFilter('dealStage', v)} />
        <FilterDropdown label="Customer Segment"   options={opts.customerSegment}  selected={filters.customerSegment}  onChange={v => setFilter('customerSegment', v)} />
        <FilterDropdown label="Speed Lab Director" options={opts.speedLabDirector} selected={filters.speedLabDirector} onChange={v => setFilter('speedLabDirector', v)} />
        <FilterDropdown label="Product"            options={opts.product}          selected={filters.product}          onChange={v => setFilter('product', v)} />
        <FilterDropdown label="Hardware"           options={opts.hardware}         selected={filters.hardware}         onChange={v => setFilter('hardware', v)} />
        <FilterDropdown label="USR Org Link"       options={orgMatchOpts}          selected={filters.orgMatch}         onChange={v => setFilter('orgMatch', v)} />
        {(activeFilterCount > 0 || search) && <button className="mc-clear-all" onClick={clearAll}>Clear all</button>}
      </div>

      {/* ── Customer list ───────────────────────────────────────────────── */}
      {customers.length === 0 ? (
        <div className="stub" style={{ minHeight: 300 }}>
          <div className="stub-mark"><Users size={28} /></div>
          <h2 style={{ fontSize: 26 }}>No customers match</h2>
          <p style={{ maxWidth: 440 }}>{activeFilterCount || search ? 'No customers match the current search/filters. Try clearing some.' : 'No active customers are synced yet. Run the HubSpot sync to populate the roster.'}</p>
        </div>
      ) : (
        <div className="section">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {customers.map(({ account, snap, score }) => (
              <LabCard
                key={snap.id}
                snap={snap}
                allHistory={snaps}
                viewingId={null}
                account={account}
                hideNotes
                stage={account.deal_stage_label || null}
                score={score}
                onDraftEmail={draftEmail}
                comms={commsByDeal[account.deal_id] || []}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
