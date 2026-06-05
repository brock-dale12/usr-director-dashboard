import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getHealth } from '../lib/colors'
import HealthBadge from '../components/HealthBadge'
import { Shield, Activity, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function AdminOverview() {
  const { director }   = useAuth()
  const [allDirectors, setAllDirectors] = useState([])
  const [snapshots,    setSnapshots]    = useState([])
  const [pendingMap,   setPendingMap]   = useState({})
  const [loading,      setLoading]      = useState(true)
  const [expanded,     setExpanded]     = useState(null)
  const [latestWeek,   setLatestWeek]   = useState(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const { data: dirs, error: dirErr } = await supabase
        .from('directors').select('*').order('name')
      if (dirErr) throw dirErr

      const { data: snaps, error: snapErr } = await supabase
        .from('weekly_health_snapshots').select('*')
        .order('week_start', { ascending: false }).limit(600)
      if (snapErr) throw snapErr

      const { data: pend, error: pendErr } = await supabase
        .from('suggested_emails').select('director_id').eq('status', 'pending')
      if (pendErr) throw pendErr

      const latestW = snaps?.[0]?.week_start
      setLatestWeek(latestW)
      setAllDirectors(dirs || [])
      setSnapshots(latestW ? snaps.filter(s => s.week_start === latestW) : [])

      const pm = (pend || []).reduce((acc, row) => {
        acc[row.director_id] = (acc[row.director_id] || 0) + 1
        return acc
      }, {})
      setPendingMap(pm)
    } catch (err) {
      console.error('Error loading admin overview:', err)
    } finally {
      setLoading(false)
    }
  }

  const dirRows = allDirectors
    .filter(d => !d.is_admin)
    .map(d => {
      const labs = snapshots.filter(s => s.director_id === d.id)
      const counts = {
        green:   labs.filter(s => s.health_color === 'green').length,
        yellow:  labs.filter(s => s.health_color === 'yellow').length,
        orange:  labs.filter(s => s.health_color === 'orange').length,
        red:     labs.filter(s => s.health_color === 'red').length,
        unknown: labs.filter(s => s.health_color === 'unknown').length,
      }
      return { ...d, labs, counts, pendCount: pendingMap[d.id] || 0 }
    })

  const net = dirRows.reduce((acc, d) => {
    acc.total   += d.labs.length
    acc.green   += d.counts.green
    acc.yellow  += d.counts.yellow
    acc.orange  += d.counts.orange
    acc.red     += d.counts.red
    acc.pending += d.pendCount
    return acc
  }, { total: 0, green: 0, yellow: 0, orange: 0, red: 0, pending: 0 })

  const weekLabel = latestWeek
    ? new Date(latestWeek + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

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
            Loading network...
          </div>
        </div>
      </div>
    )
  }

  // Network stat tiles
  const statTiles = [
    { label: 'Total Labs', value: net.total,   color: 'var(--usr-black)' },
    { label: 'Green',      value: net.green,   color: 'var(--st-green)'  },
    { label: 'Yellow',     value: net.yellow,  color: 'var(--st-yellow)' },
    { label: 'Orange',     value: net.orange,  color: 'var(--st-orange)' },
    { label: 'Red',        value: net.red,     color: 'var(--st-red)'    },
    { label: 'Pending',    value: net.pending, color: 'var(--usr-pink)'  },
  ]

  return (
    <div className="screen">
      {/* Top bar */}
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 4, flexShrink: 0,
            background: 'rgba(236,54,66,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Shield size={20} style={{ color: 'var(--usr-pink)' }} />
          </div>
          <div>
            <div className="topbar-eyebrow">Admin</div>
            <div className="topbar-title">Director View</div>
            <div className="topbar-meta">
              Full network · {weekLabel ? `week of ${weekLabel}` : 'no snapshot data yet'}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 28px' }}>
        {/* Network stat strip */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)',
          gap: 10, marginBottom: 28
        }}>
          {statTiles.map(({ label, value, color }) => (
            <div key={label} style={{
              background: '#fff', border: '1px solid var(--border)',
              borderRadius: 6, padding: '14px 12px', textAlign: 'center',
              boxShadow: 'var(--shadow-1)',
            }}>
              <div style={{
                fontFamily: 'var(--font-display)', fontWeight: 800,
                fontSize: 32, lineHeight: 1, color,
              }}>
                {value}
              </div>
              <div style={{
                fontFamily: 'var(--font-display)', fontWeight: 700,
                fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--fg-subtle)', marginTop: 6
              }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* Per-director list */}
        {snapshots.length === 0 ? (
          <div className="stub" style={{ minHeight: 240 }}>
            <div className="stub-mark"><Activity size={28} /></div>
            <h2 style={{ fontSize: 28 }}>No Data Yet</h2>
            <p>Runs after the first Sunday report. Assigned labs still appear once data flows.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dirRows.map(d => {
              const isExpanded = expanded === d.id
              const total      = d.labs.length || 1
              const pct        = (n) => Math.round((n / total) * 100)

              const sortedLabs = [...d.labs].sort((a, b) => {
                const ord = { red: 0, orange: 1, yellow: 2, green: 3, unknown: 4 }
                return (ord[a.health_color] ?? 5) - (ord[b.health_color] ?? 5)
              })

              return (
                <div key={d.id} style={{
                  background: '#fff',
                  border: '1px solid var(--border)',
                  borderRadius: 6, overflow: 'hidden',
                  boxShadow: 'var(--shadow-1)',
                }}>
                  {/* Director summary row */}
                  <button
                    onClick={() => setExpanded(isExpanded ? null : d.id)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                      padding: '13px 16px', textAlign: 'left', cursor: 'pointer',
                      background: 'none', border: 'none',
                      transition: 'background var(--dur-fast) var(--ease)',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--usr-ghost)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                      background: 'rgba(236,54,66,0.12)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{
                        fontFamily: 'var(--font-display)', fontWeight: 800,
                        fontSize: 14, color: 'var(--usr-pink)'
                      }}>{d.name?.[0]}</span>
                    </div>

                    {/* Name + org */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{
                          fontFamily: 'var(--font-display)', fontWeight: 800,
                          fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.03em',
                          color: 'var(--usr-black)'
                        }}>{d.name}</span>
                        {d.pendCount > 0 && (
                          <span style={{
                            fontFamily: 'var(--font-display)', fontWeight: 800,
                            fontSize: 10, letterSpacing: '0.1em',
                            background: 'var(--usr-pink)', color: '#fff',
                            padding: '2px 7px', borderRadius: 999,
                          }}>
                            {d.pendCount} pending
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
                        {d.org_name || d.email}
                      </span>
                    </div>

                    {/* Health bar */}
                    <div style={{
                      display: 'flex', height: 6,
                      width: 100, borderRadius: 999, overflow: 'hidden',
                      flexShrink: 0, background: 'var(--usr-ghost)',
                      gap: 1,
                    }}>
                      <div style={{ background: 'var(--st-green)',  width: `${pct(d.counts.green)}%`  }} />
                      <div style={{ background: 'var(--st-yellow)', width: `${pct(d.counts.yellow)}%` }} />
                      <div style={{ background: 'var(--st-orange)', width: `${pct(d.counts.orange)}%` }} />
                      <div style={{ background: 'var(--st-red)',    width: `${pct(d.counts.red)}%`    }} />
                    </div>

                    {/* Quick counts */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                      fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12,
                    }}>
                      {d.counts.red    > 0 && (
                        <span style={{ color: 'var(--st-red)' }}>{d.counts.red}R</span>
                      )}
                      {d.counts.orange > 0 && (
                        <span style={{ color: 'var(--st-orange)' }}>{d.counts.orange}O</span>
                      )}
                      <span style={{ color: 'var(--fg-subtle)' }}>{d.labs.length} labs</span>
                    </div>

                    {/* View Region link */}
                    <Link
                      to={`/region/${d.id}`}
                      onClick={e => e.stopPropagation()}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                        fontFamily: 'var(--font-display)', fontWeight: 700,
                        fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
                        color: 'var(--usr-pink)', textDecoration: 'none',
                      }}
                    >
                      <ExternalLink size={11} />
                      View
                    </Link>

                    {/* Chevron */}
                    {isExpanded
                      ? <ChevronDown  size={16} style={{ color: 'var(--usr-black)', flexShrink: 0 }} />
                      : <ChevronRight size={16} style={{ color: 'var(--fg-subtle)', flexShrink: 0 }} />
                    }
                  </button>

                  {/* Expanded lab grid */}
                  {isExpanded && (
                    <div style={{
                      borderTop: '1px solid var(--border)',
                      padding: '16px',
                      background: 'var(--usr-ghost)',
                    }}>
                      {sortedLabs.length === 0 ? (
                        <p style={{
                          fontSize: 12, color: 'var(--fg-subtle)',
                          fontFamily: 'var(--font-display)', fontWeight: 700,
                          textTransform: 'uppercase', letterSpacing: '0.08em'
                        }}>
                          No snapshot data yet for this director.
                        </p>
                      ) : (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                          gap: 8
                        }}>
                          {sortedLabs.map(lab => {
                            const h = getHealth(lab.health_color)
                            const dotColors = {
                              green: 'var(--st-green)', yellow: 'var(--st-yellow)',
                              orange: 'var(--st-orange)', red: 'var(--st-red)',
                              unknown: 'var(--fg-subtle)'
                            }
                            return (
                              <div key={lab.id} style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '9px 12px',
                                background: '#fff',
                                border: '1px solid var(--border)',
                                borderLeft: `3px solid ${dotColors[lab.health_color] || 'var(--fg-subtle)'}`,
                                borderRadius: 4,
                              }}>
                                <HealthBadge color={lab.health_color} size="dot" />
                                <span style={{
                                  flex: 1, minWidth: 0,
                                  fontFamily: 'var(--font-display)', fontWeight: 700,
                                  fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em',
                                  color: 'var(--fg-muted)',
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                }}>
                                  {lab.lab_name}
                                </span>
                                <span style={{
                                  fontFamily: 'var(--font-display)', fontWeight: 700,
                                  fontSize: 11, color: 'var(--fg-subtle)', flexShrink: 0
                                }}>
                                  {lab.days_since_activity !== null && lab.days_since_activity !== undefined
                                    ? `${lab.days_since_activity}d`
                                    : '—'
                                  }
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
