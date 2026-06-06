import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { callFn } from '../lib/api'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [director, setDirector] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        fetchDirector()
      } else {
        setLoading(false)
      }
    })

    // Listen for auth changes (login, logout, token refresh, OAuth redirect)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        fetchDirector()
      } else {
        setDirector(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Resolve "who am I" through the me() Function. The Function verifies the JWT
  // server-side and links the director to this Google account by email on first
  // login — so identity never depends on a browser-side directors query.
  async function fetchDirector() {
    try {
      const me = await callFn('me')
      setDirector(me)
    } catch (e) {
      console.error('fetchDirector (me) error:', e)
      setDirector(null)
    } finally {
      setLoading(false)
    }
  }

  // Primary login: Google OAuth. One consent yields identity; Gmail/Calendar
  // scopes are requested separately later (Phase 4/5), not here.
  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: 'select_account' },
      },
    })

  // Break-glass fallback for a seeded admin (email/password).
  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signOut = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ session, director, loading, signInWithGoogle, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
