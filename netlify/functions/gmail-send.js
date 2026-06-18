// gmail-send — send an email AS the logged-in CSM via the Gmail API.
//   POST /.netlify/functions/gmail-send
//   headers: { Authorization: 'Bearer <supabase user access token>' }
//   body: { to, subject, text, html?, dealId?, labName?, templateKey?, extraBcc? }
//   → { ok, id, threadId }
//
// Looks up the caller's stored refresh token, mints a fresh access token, builds
// an HTML+text MIME message, BCCs HubSpot for CRM logging, and sends. The send
// is recorded in customer_comms for the dashboard's comm history.

import {
  json, bearer, getUserFromToken, supaSelectOne, decrypt, refreshAccessToken,
  buildRawMessage, logComm, HUBSPOT_LOG_BCC, fetchGmailSignature, signatureToText,
} from './_shared/google.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const user = await getUserFromToken(bearer(event))
  if (!user) return json(401, { error: 'Not authenticated' })

  let p
  try { p = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'bad body' }) }
  const { to, subject, text, html, dealId, labName, templateKey, extraBcc } = p
  if (!to || !String(to).trim()) return json(400, { error: 'recipient (to) required' })
  if (!text && !html) return json(400, { error: 'text or html body required' })

  // Connected?
  let row
  try {
    row = await supaSelectOne('gmail_tokens', `auth_user_id=eq.${user.id}&select=email,refresh_token_enc`)
  } catch (e) {
    return json(502, { error: 'token lookup failed', detail: String(e.message || e) })
  }
  if (!row) return json(409, { error: 'gmail_not_connected' })

  // Mint a fresh access token.
  let access
  try {
    const refreshed = await refreshAccessToken(decrypt(row.refresh_token_enc))
    access = refreshed.access_token
  } catch (e) {
    // Refresh token revoked/expired → tell the client to reconnect.
    return json(401, { error: 'gmail_reauth_required', detail: String(e.message || e) })
  }

  // Append the CSM's real Gmail signature so API sends match composing in Gmail.
  let finalHtml = html || undefined
  let finalText = text || ''
  try {
    const sig = await fetchGmailSignature(access, row.email)
    if (sig) {
      finalHtml = `${finalHtml || ''}<br><br>${sig}`
      const sigText = signatureToText(sig)
      if (sigText) finalText = `${finalText}\n\n${sigText}`
    }
  } catch { /* signature is best-effort — never block the send */ }

  const bcc = [HUBSPOT_LOG_BCC, extraBcc].filter(Boolean).join(', ')
  const raw = buildRawMessage({
    from: row.email, to: String(to).trim(), bcc,
    subject: subject || '', text: finalText, html: finalHtml,
  })

  try {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw }),
    })
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300)
      return json(502, { error: 'gmail_send_failed', status: r.status, detail })
    }
    const sent = await r.json()
    await logComm({
      deal_id: dealId || null,
      lab_name: labName || null,
      kind: 'email_sent',
      channel: 'Email',
      subject: subject || null,
      to_email: String(to).trim(),
      template_key: templateKey || null,
      logged_by: row.email,
    })
    return json(200, { ok: true, id: sent.id || null, threadId: sent.threadId || null })
  } catch (e) {
    return json(502, { error: 'gmail_send_failed', detail: String(e.message || e) })
  }
}
