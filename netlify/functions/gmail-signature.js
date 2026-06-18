// gmail-signature — return the logged-in CSM's Gmail signature (HTML) so the
// compose UI can preview exactly what gets appended on send.
//   GET /.netlify/functions/gmail-signature
//   headers: { Authorization: 'Bearer <supabase user access token>' }
//   → { signature: '<html>' }   ('' if none set)

import {
  json, bearer, getUserFromToken, supaSelectOne, decrypt, refreshAccessToken, fetchGmailSignature,
} from './_shared/google.js'

export const handler = async (event) => {
  const user = await getUserFromToken(bearer(event))
  if (!user) return json(401, { error: 'Not authenticated' })
  try {
    const row = await supaSelectOne('gmail_tokens', `auth_user_id=eq.${user.id}&select=email,refresh_token_enc`)
    if (!row) return json(409, { error: 'gmail_not_connected' })
    let access
    try {
      const t = await refreshAccessToken(decrypt(row.refresh_token_enc))
      access = t.access_token
    } catch (e) {
      return json(401, { error: 'gmail_reauth_required', detail: String(e.message || e) })
    }
    const signature = await fetchGmailSignature(access, row.email)
    return json(200, { signature: signature || '' })
  } catch (e) {
    return json(502, { error: 'signature_fetch_failed', detail: String(e.message || e) })
  }
}
