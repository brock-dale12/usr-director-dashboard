// gmail-oauth-start — begin the per-CSM Gmail OAuth flow.
//   POST /.netlify/functions/gmail-oauth-start
//   headers: { Authorization: 'Bearer <supabase user access token>' }
//   → { url }   (frontend then does window.location = url)
//
// We return the consent URL (rather than 302) so the caller is identified by
// their Supabase token in the Authorization header — the token never lands in a
// browsable URL. The user id is carried forward in a signed `state`.

import {
  json, bearer, getUserFromToken, signState,
  GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, GMAIL_SCOPES,
} from './_shared/google.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })
  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) return json(503, { error: 'Google OAuth not configured' })

  const user = await getUserFromToken(bearer(event))
  if (!user) return json(401, { error: 'Not authenticated' })

  const state = signState({ uid: user.id })
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: GMAIL_SCOPES,
    access_type: 'offline',     // ask for a refresh token
    prompt: 'consent',          // force refresh-token issuance even on re-auth
    include_granted_scopes: 'true',
    login_hint: user.email || '',
    state,
  }).toString()

  return json(200, { url })
}
