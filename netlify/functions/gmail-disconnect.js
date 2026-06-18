// gmail-disconnect — revoke and forget the logged-in CSM's Gmail connection.
//   POST /.netlify/functions/gmail-disconnect
//   headers: { Authorization: 'Bearer <supabase user access token>' }
//   → { ok: true }

import {
  json, bearer, getUserFromToken, supaSelectOne, supaDelete, decrypt, refreshAccessToken,
} from './_shared/google.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })
  const user = await getUserFromToken(bearer(event))
  if (!user) return json(401, { error: 'Not authenticated' })

  try {
    const row = await supaSelectOne('gmail_tokens', `auth_user_id=eq.${user.id}&select=refresh_token_enc`)
    // Best-effort revoke at Google so the grant is fully torn down.
    if (row?.refresh_token_enc) {
      try {
        const t = await refreshAccessToken(decrypt(row.refresh_token_enc))
        if (t.access_token) {
          await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t.access_token), { method: 'POST' })
        }
      } catch { /* token may already be dead — proceed to delete */ }
    }
    await supaDelete('gmail_tokens', `auth_user_id=eq.${user.id}`)
    return json(200, { ok: true })
  } catch (e) {
    return json(502, { error: 'disconnect failed', detail: String(e.message || e) })
  }
}
