import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Mail, CheckCircle, AlertTriangle, Loader2, Link2, Unlink } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { gmailStatus, startGmailConnect, disconnectGmail } from '../lib/gmailSend'

/**
 * Settings — per-CSM account connections. Currently: Gmail send.
 * Each CSM connects their own Google account so the dashboard can send mail AS
 * them (HTML, one click) and BCC HubSpot for logging.
 */
export default function Settings() {
  const { director } = useAuth()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState('loading') // loading | ready | error
  const [conn, setConn] = useState({ connected: false, email: null })
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null) // { kind, msg }

  const refresh = async () => {
    setState('loading')
    try { setConn(await gmailStatus()); setState('ready') }
    catch { setState('error') }
  }
  useEffect(() => { refresh() }, [])

  // Surface the result of the OAuth round-trip (?gmail=connected|error).
  useEffect(() => {
    const g = params.get('gmail')
    if (!g) return
    if (g === 'connected') setFlash({ kind: 'ok', msg: `Gmail connected${params.get('email') ? ` (${params.get('email')})` : ''}.` })
    else setFlash({ kind: 'err', msg: `Couldn't connect Gmail: ${params.get('reason') || 'unknown error'}` })
    params.delete('gmail'); params.delete('email'); params.delete('reason')
    setParams(params, { replace: true })
    refresh()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setBusy(true)
    try { await startGmailConnect() } // redirects away
    catch (e) { setFlash({ kind: 'err', msg: String(e.message || e) }); setBusy(false) }
  }
  const disconnect = async () => {
    setBusy(true)
    try { await disconnectGmail(); setFlash({ kind: 'ok', msg: 'Gmail disconnected.' }); await refresh() }
    catch (e) { setFlash({ kind: 'err', msg: String(e.message || e) }) }
    setBusy(false)
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Settings</h1>
      <p style={{ color: 'var(--fg-subtle)', marginBottom: 24 }}>
        Signed in as {director?.name || '—'}{director?.email ? ` · ${director.email}` : ''}
      </p>

      {flash && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, marginBottom: 18,
          background: flash.kind === 'ok' ? 'rgba(29,178,113,.12)' : 'rgba(236,54,66,.12)',
          color: flash.kind === 'ok' ? 'var(--st-green)' : 'var(--st-red)', fontSize: 14,
        }}>
          {flash.kind === 'ok' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}{flash.msg}
        </div>
      )}

      <div style={{ border: '1px solid var(--border, #e3e5e8)', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Mail size={18} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>Gmail — send from the dashboard</span>
        </div>
        <p style={{ color: 'var(--fg-subtle)', fontSize: 13.5, marginBottom: 16, lineHeight: 1.5 }}>
          Connect your Google account so onboarding and outreach emails send directly as you,
          with formatting and links, and log to HubSpot automatically. We store only an encrypted
          refresh token, never your password.
        </p>

        {state === 'loading' && <div style={{ color: 'var(--fg-subtle)', display: 'flex', gap: 8, alignItems: 'center' }}><Loader2 size={15} className="animate-spin" /> Checking connection…</div>}
        {state === 'error' && <div style={{ color: 'var(--st-red)' }}>Couldn't check connection status. Is the Gmail feature configured?</div>}

        {state === 'ready' && (conn.connected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--st-green)', fontWeight: 600 }}>
              <CheckCircle size={16} /> Connected{conn.email ? ` as ${conn.email}` : ''}
            </span>
            <button className="btn btn-outline" onClick={disconnect} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />} Disconnect
            </button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={connect} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Connect Gmail
          </button>
        ))}
      </div>
    </div>
  )
}
