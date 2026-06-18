// gmail-oauth-callback — Google redirects here after the CSM grants access.
//   GET /.netlify/functions/gmail-oauth-callback?code=...&state=...
//
// Verifies the signed state, exchanges the code for tokens, encrypts the refresh
// token, upserts it into gmail_tokens, then 302s back to the dashboard Settings.

import {
  verifyState, exchangeCode, emailFromIdToken, encrypt, supaUpsert,
  APP_URL, GOOGLE_REDIRECT_URI,
} from './_shared/google.js'

const back = (qs) => {
  const base = APP_URL || ''
  return { statusCode: 302, headers: { Location: `${base}/settings?${qs}` }, body: '' }
}

export const handler = async (event) => {
  const { code, state, error } = event.queryStringParameters || {}
  if (error) return back(`gmail=error&reason=${encodeURIComponent(error)}`)
  if (!code || !state) return back('gmail=error&reason=missing_code')
  if (!GOOGLE_REDIRECT_URI) return back('gmail=error&reason=not_configured')

  let uid
  try { ({ uid } = verifyState(state)) } catch (e) { return back(`gmail=error&reason=${encodeURIComponent('bad_state')}`) }
  if (!uid) return back('gmail=error&reason=bad_state')

  try {
    const tok = await exchangeCode(code)
    if (!tok.refresh_token) {
      // Google withholds a refresh token if one was already granted and prompt
      // wasn't honored. prompt=consent should prevent this; surface it if not.
      return back('gmail=error&reason=no_refresh_token')
    }
    const email = emailFromIdToken(tok.id_token) || 'unknown'
    await supaUpsert('gmail_tokens', {
      auth_user_id: uid,
      email,
      refresh_token_enc: encrypt(tok.refresh_token),
      scope: tok.scope || null,
    }, 'auth_user_id')
    return back(`gmail=connected&email=${encodeURIComponent(email)}`)
  } catch (e) {
    return back(`gmail=error&reason=${encodeURIComponent(String(e.message || e).slice(0, 120))}`)
  }
}
