// Thin client for calling Netlify Functions with the user's Supabase session.
// Every privileged read/write goes through a Function (the trust boundary),
// never straight to an external API from the browser.
import { supabase } from './supabase'

export async function callFn(name, { method = 'GET', body, query } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const qs = query ? '?' + new URLSearchParams(query).toString() : ''
  const res = await fetch(`/.netlify/functions/${name}${qs}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) throw new Error(data?.error || `Function "${name}" failed (${res.status})`)
  return data
}
