// gmail-status — is the logged-in CSM's Gmail connected?
//   GET /.netlify/functions/gmail-status
//   headers: { Authorization: 'Bearer <supabase user access token>' }
//   → { connected: bool, email: string|null }

import { json, bearer, getUserFromToken, supaSelectOne } from './_shared/google.js'

export const handler = async (event) => {
  const user = await getUserFromToken(bearer(event))
  if (!user) return json(401, { error: 'Not authenticated' })
  try {
    const row = await supaSelectOne('gmail_tokens', `auth_user_id=eq.${user.id}&select=email`)
    return json(200, { connected: !!row, email: row?.email || null })
  } catch (e) {
    return json(502, { error: 'status lookup failed', detail: String(e.message || e) })
  }
}
