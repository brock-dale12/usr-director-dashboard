import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Mail, Lock, AlertCircle } from 'lucide-react'
import SpeedLabLogo from '../components/SpeedLabLogo'

export default function Login() {
  const { signIn, signInWithGoogle } = useAuth()
  const navigate   = useNavigate()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error } = await signIn(email.trim(), password)
      if (error) {
        setError(
          error.message === 'Invalid login credentials'
            ? 'Incorrect email or password. Try again.'
            : error.message
        )
      } else {
        navigate('/')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setError('')
    setGoogleLoading(true)
    try {
      const { error } = await signInWithGoogle()
      if (error) {
        setError(error.message)
        setGoogleLoading(false)
      }
      // On success the browser redirects to Google; AuthContext picks up the
      // session on return and the router sends the user to "/".
    } catch {
      setError('Could not start Google sign-in. Please try again.')
      setGoogleLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      {/* Subtle background glow */}
      <div style={{
        position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none'
      }}>
        <div style={{
          position: 'absolute', top: -240, right: -240,
          width: 480, height: 480,
          background: 'radial-gradient(circle, rgba(236,54,66,0.12) 0%, transparent 70%)',
          borderRadius: '50%'
        }} />
        <div style={{
          position: 'absolute', bottom: -240, left: -240,
          width: 480, height: 480,
          background: 'radial-gradient(circle, rgba(236,54,66,0.08) 0%, transparent 70%)',
          borderRadius: '50%'
        }} />
      </div>

      <div style={{ position: 'relative', width: '100%', maxWidth: 400, padding: '0 16px' }}>
        {/* Logo + title */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-block', marginBottom: 20 }}>
            <SpeedLabLogo height={38} />
          </div>
          <div style={{
            height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)',
            marginBottom: 20
          }} />
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: 11, letterSpacing: '0.16em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)'
          }}>Director Portal</div>
        </div>

        {/* Card */}
        <div className="login-card">
          <div className="login-title">Sign In</div>
          <div className="login-sub">Access your Speed Lab Director Console</div>

          {error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 14px',
              background: 'rgba(236,54,66,0.12)',
              border: '1px solid rgba(236,54,66,0.25)',
              borderRadius: 4,
              marginBottom: 16,
              color: '#f87171',
              fontSize: 13,
            }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              {error}
            </div>
          )}

          {/* Primary: Google SSO */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading}
            className="btn"
            style={{
              width: '100%', justifyContent: 'center', gap: 10,
              padding: '13px 20px', fontSize: 13, letterSpacing: '0.04em',
              background: '#fff', color: '#1f2937', fontWeight: 700,
              border: '1px solid rgba(255,255,255,0.85)',
              opacity: googleLoading ? 0.65 : 1,
              cursor: googleLoading ? 'not-allowed' : 'pointer',
              marginBottom: 18,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.62z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
            </svg>
            {googleLoading ? 'Redirecting…' : 'Continue with Google'}
          </button>

          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 18px',
            color: 'rgba(255,255,255,0.3)', fontSize: 11,
            fontFamily: 'var(--font-display)', fontWeight: 700,
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />
            or
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />
          </div>

          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div style={{ marginBottom: 12 }}>
              <label style={{
                display: 'block', fontFamily: 'var(--font-display)',
                fontWeight: 700, fontSize: 11, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)',
                marginBottom: 6
              }}>Email</label>
              <div style={{ position: 'relative' }}>
                <Mail size={14} style={{
                  position: 'absolute', left: 12, top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'rgba(255,255,255,0.3)', pointerEvents: 'none'
                }} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  className="login-input"
                  style={{ paddingLeft: 36 }}
                />
              </div>
            </div>

            {/* Password */}
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block', fontFamily: 'var(--font-display)',
                fontWeight: 700, fontSize: 11, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)',
                marginBottom: 6
              }}>Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{
                  position: 'absolute', left: 12, top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'rgba(255,255,255,0.3)', pointerEvents: 'none'
                }} />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="login-input"
                  style={{ paddingLeft: 36 }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{
                width: '100%',
                justifyContent: 'center',
                padding: '13px 20px',
                fontSize: 13,
                letterSpacing: '0.1em',
                opacity: loading ? 0.65 : 1,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? (
                <>
                  <span style={{
                    width: 14, height: 14,
                    border: '2px solid rgba(255,255,255,0.35)',
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                    display: 'inline-block'
                  }} />
                  Signing in...
                </>
              ) : 'Sign In'}
            </button>
          </form>
        </div>

        <p style={{
          textAlign: 'center', fontSize: 11,
          color: 'rgba(255,255,255,0.2)',
          marginTop: 24,
          fontFamily: 'var(--font-display)',
          fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.1em'
        }}>
          Train Smarter. Play Faster.
        </p>
      </div>
    </div>
  )
}
