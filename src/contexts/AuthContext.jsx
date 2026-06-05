import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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
        fetchDirector(session.user.id)
      } else {
        setLoading(false)
      }
    })

    // Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        fetchDirector(session.user.id)
      } else {
        setDirector(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchDirector(authUserId) {
    try {
      const { data, error } = await supabase
        .from('directors')
        .select('*')
        .eq('auth_user_id', authUserId)
        .single()
      if (!error) setDirector(data)
    } catch (e) {
      console.error('fetchDirector error:', e)
    } finally {
      setLoading(false)
    }
  }

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signOut = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ session, director, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
