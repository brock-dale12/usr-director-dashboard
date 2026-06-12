import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Trophy, Activity, Dumbbell, Users, MousePointerClick, Zap, Mail } from 'lucide-react'

// ── Category definitions ──────────────────────────────────────────────────
const CATEGORIES = [
  {
    id:       'health_score',
    label:    'Health Score',
    icon:     Activity,
    field:    'avg_health_score',
    format:   v => v != null ? v.toFixed(1) : '—',
    unit:     'avg',
    max:      9,
    barField: v => (v / 9) * 100,
    desc:     'Average monthly health score across all labs (0–9)',
    color:    'var(--st-green)',
  },
  {
    id:       'green_rate',
    label:    'Green Rate',
    icon:     Activity,
    field:    'green_pct',
    format:   v => v != null ? `${Math.round(v)}%` : '—',
    unit:     '% green',
    max:      100,
    barField: v => v,
    desc:     'Percentage of labs with green activity status',
    color:    'var(--st-green)',
  },
  {
    id:       'data_points',
    label:    'Data Points',
    icon:     Zap,
    field:    'data_points_added',
    format:   v => v != null ? v.toLocaleString() : '—',
    unit:     'assessments',
    max:      null,
    barField: null,
    desc:     'Verified assessments added across all labs this month',
    color:    'var(--usr-pink)',
  },
  {
    id:       'athletes',
    label:    'Athletes Added',
    icon:     Users,
    field:    'athletes_added',
    format:   v => v != null ? v.toLocaleString() : '—',
    unit:     'athletes',
    max:      null,
    barField: null,
    desc:     'New athletes who joined a community in the region this month',
    color:    '#7c3aed',
  },
  {
    id:       'logins',
    label:    'Logins',
    icon:     MousePointerClick,
    field:    'logins_count',
    format:   v => v != null ? v.toLocaleString() : '—',
    unit:     'sessions',
    max:      null,
    barField: null,
    desc:     'Distinct coach / athlete logins across the region this month',
    color:    '#0ea5e9',
  },
  {
    id:       'prs',
    label:    'PRs Set',
    icon:     Dumbbell,
    field:    'prs_count',
    format:   v => v != null ? v.toLocaleString() : '—',
    unit:     'PRs',
    max:      null,
    barField: null,
    desc:     'Personal records set by athletes in the region this month',
    color:    '#f59e0b',
  },
  {
    id:       'messages',
    label:    'Messages Sent',
    icon:     Mail,
    field:    'emails_sent',
    format:   v => v != null ? v.toLocaleString() : '—',
    unit:     'emails',
    max:      null,
    barField: null,
    desc:     'Outreach emails marked sent from the Communication Hub',
    color:    'var(--st-orange)',
  },
]

// Medal labels for top 3
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' }

export default function Leaderboard() {
  const { director } = useAuth()
  const [rows,       setRows]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [month,      setMonth]      = useState(null)
  const [activeTab,  setActiveTab]  = useState('health_score')

  useEffect(() => { loadLeaderboard() }, [])

  async function loadLeaderboard() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('leaderboard_cache')
        .select('*')
        .order('month', { ascending: false })
        .limit(200)
      if (error) throw error
      const latestMonth = data?.[0]?.month
      setMonth(latestMonth)
      setRows(latestMonth ? data.filter(r => r.month === latestMonth) : [])
    } catch (err) {
      console.error('Error loading leaderboard:', err)
    } finally {
      setLoading(false)
    }
  }

  const monthLabel = month
    ? new Date(month + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null

  // Sort rows by the active category field, descending
  const cat = CATEGORIES.find(c => c.id === activeTab) || CATEGORIES[0]
  const sorted = [...rows].sort((a, b) => {
    const av = a[cat.field] ?? -1
    const bv = b[cat.field] ?? -1
    return bv - av
  })
  const maxVal = sorted[0]?.[cat.field] ?? 1

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
            Loading leaderboard...
          </div>
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="screen">
        <div className="topbar">
          <div>
            <div className="topbar-eyebrow">Rankings</div>
            <div className="topbar-title">Leaderboard</div>
            <div className="topbar-meta">See how your region stacks up across the network.</div>
          </div>
        </div>
        <div className="stub">
          <div className="stub-mark"><Trophy size={28} /></div>
          <h2>No Rankings Yet</h2>
          <p>Scores are compiled monthly. Check back after the first report cycle.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      {/* Top bar */}
      <div className="topbar">
        <div>
          <div className="topbar-eyebrow">Rankings</div>
          <div className="topbar-title">Leaderboard</div>
          <div className="topbar-meta">
            {monthLabel ? `${monthLabel} · Resets monthly` : 'Monthly rankings'}
          </div>
        </div>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13,
          letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--fg-subtle)'
        }}>
          {rows.length} Directors
        </div>
      </div>

      <div style={{ padding: '0 28px 32px' }}>
        {/* ── Category tabs ── */}
        <div style={{
          display: 'flex', gap: 6, flexWrap: 'wrap',
          borderBottom: '2px solid var(--border)',
          marginBottom: 28, paddingBottom: 0,
        }}>
          {CATEGORIES.map(c => {
            const Icon    = c.icon
            const isActive = c.id === activeTab
            return (
              <button
                key={c.id}
                onClick={() => setActiveTab(c.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 16px',
                  fontFamily: 'var(--font-display)', fontWeight: 700,
                  fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase',
                  border: 'none', borderBottom: isActive ? `2px solid ${cat.color}` : '2px solid transparent',
                  marginBottom: -2,
                  background: 'none', cursor: 'pointer',
                  color: isActive ? cat.color : 'var(--fg-subtle)',
                  transition: 'color 0.15s ease, border-color 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--fg-muted)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--fg-subtle)' }}
              >
                <Icon size={13} />
                {c.label}
              </button>
            )
          })}
        </div>

        {/* ── Category description ── */}
        <p style={{
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12,
          letterSpacing: '0.04em', color: 'var(--fg-subtle)',
          marginBottom: 20, marginTop: -16,
        }}>
          {cat.desc}
        </p>

        {/* ── Podium: top 3 ── */}
        {sorted.length >= 3 && (
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
            gap: 12, marginBottom: 32, alignItems: 'end',
          }}>
            {[sorted[1], sorted[0], sorted[2]].map((row, podiumIdx) => {
              if (!row) return <div key={podiumIdx} />
              const isMe    = row.director_id === director?.id
              const catVal  = row[cat.field]
              const heights = [48, 0, 64]     // silver, gold, bronze offset
              const podiumRank = [2, 1, 3][podiumIdx]

              return (
                <div key={row.id} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  marginTop: heights[podiumIdx],
                }}>
                  <div style={{ fontSize: 26, marginBottom: 8 }}>{MEDALS[podiumRank] || podiumRank}</div>
                  <div style={{
                    width: '100%', padding: '18px 14px',
                    background: podiumIdx === 1 ? 'var(--usr-black)' : '#fff',
                    border: `1px solid ${isMe ? cat.color : podiumIdx === 1 ? 'transparent' : 'var(--border)'}`,
                    borderRadius: 6, textAlign: 'center',
                    boxShadow: isMe
                      ? `0 0 0 2px ${cat.color}44`
                      : podiumIdx === 1 ? 'var(--shadow-3)' : 'var(--shadow-1)',
                  }}>
                    {/* Avatar */}
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%', margin: '0 auto 10px',
                      background: podiumIdx === 1 ? 'rgba(236,54,66,0.25)' : 'rgba(236,54,66,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{
                        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16,
                        color: 'var(--usr-pink)',
                      }}>
                        {row.director_name?.[0]}
                      </span>
                    </div>

                    <div style={{
                      fontFamily: 'var(--font-display)', fontWeight: 800,
                      fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em',
                      color: podiumIdx === 1 ? '#fff' : 'var(--usr-black)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      marginBottom: 6,
                    }}>
                      {row.director_name?.split(' ')[0]}
                    </div>

                    {/* Stat value */}
                    <div style={{
                      fontFamily: 'var(--font-display)', fontWeight: 800,
                      fontSize: 24, lineHeight: 1,
                      color: cat.color,
                    }}>
                      {cat.format(catVal)}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-display)', fontWeight: 700,
                      fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                      color: podiumIdx === 1 ? 'rgba(255,255,255,0.45)' : 'var(--fg-subtle)',
                      marginTop: 3,
                    }}>
                      {cat.unit}
                    </div>

                    {isMe && (
                      <div style={{
                        display: 'inline-block', marginTop: 10, padding: '3px 10px',
                        fontFamily: 'var(--font-display)', fontWeight: 800,
                        fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                        background: 'rgba(236,54,66,0.15)', color: 'var(--usr-pink)',
                        borderRadius: 999,
                      }}>
                        You
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Full ranked table ── */}
        <div style={{
          background: '#fff', border: '1px solid var(--border)',
          borderRadius: 6, overflow: 'hidden', boxShadow: 'var(--shadow-1)',
        }}>
          {/* Table header */}
          <div style={{
            padding: '10px 16px', borderBottom: '1px solid var(--border)',
            background: 'var(--usr-ghost)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontWeight: 700,
              fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'var(--fg-subtle)', flex: 1,
            }}>All Directors</span>
            <span style={{
              fontFamily: 'var(--font-display)', fontWeight: 700,
              fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: cat.color,
            }}>
              {cat.label}
            </span>
          </div>

          {/* Rows */}
          <div>
            {sorted.map((row, index) => {
              const isMe    = row.director_id === director?.id
              const catVal  = row[cat.field]
              const rank    = index + 1
              // Bar width: relative to top performer
              const barPct  = cat.barField
                ? cat.barField(catVal ?? 0)
                : maxVal > 0 ? Math.round(((catVal ?? 0) / maxVal) * 100) : 0

              return (
                <div
                  key={row.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                    background: isMe ? 'rgba(236,54,66,0.03)' : '#fff',
                  }}
                >
                  {/* Rank */}
                  <div style={{
                    width: 28, flexShrink: 0, textAlign: 'center',
                    fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15,
                  }}>
                    {MEDALS[rank] || (
                      <span style={{
                        fontSize: 13,
                        color: rank <= 3 ? 'var(--usr-pink)' : 'var(--fg-subtle)',
                      }}>
                        {rank}
                      </span>
                    )}
                  </div>

                  {/* Avatar */}
                  <div style={{
                    width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isMe ? 'rgba(236,54,66,0.15)' : 'var(--usr-ghost)',
                  }}>
                    <span style={{
                      fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13,
                      color: isMe ? 'var(--usr-pink)' : 'var(--fg-muted)',
                    }}>
                      {row.director_name?.[0]}
                    </span>
                  </div>

                  {/* Name + bar */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{
                        fontFamily: 'var(--font-display)', fontWeight: isMe ? 800 : 700,
                        fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.03em',
                        color: 'var(--usr-black)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {row.director_name}
                      </span>
                      {isMe && (
                        <span style={{
                          fontFamily: 'var(--font-display)', fontWeight: 700,
                          fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                          padding: '2px 8px', borderRadius: 999,
                          background: 'rgba(236,54,66,0.12)', color: 'var(--usr-pink)', flexShrink: 0,
                        }}>
                          You
                        </span>
                      )}
                    </div>
                    {/* Progress bar */}
                    <div style={{
                      height: 4, borderRadius: 999, overflow: 'hidden',
                      background: 'var(--usr-ghost)', maxWidth: 200,
                    }}>
                      <div style={{
                        height: '100%', borderRadius: 999,
                        width: `${Math.min(barPct, 100)}%`,
                        background: cat.color,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                  </div>

                  {/* Stat value */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-display)', fontWeight: 800,
                      fontSize: 20, lineHeight: 1,
                      color: rank === 1 ? cat.color : 'var(--usr-black)',
                    }}>
                      {cat.format(catVal)}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-display)', fontWeight: 700,
                      fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: 'var(--fg-subtle)', marginTop: 2,
                    }}>
                      {cat.unit}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <p style={{
          textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 700,
          fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--fg-subtle)', marginTop: 16,
        }}>
          Rankings reset monthly · metrics tracked from 1st of each month
        </p>
      </div>
    </div>
  )
}
