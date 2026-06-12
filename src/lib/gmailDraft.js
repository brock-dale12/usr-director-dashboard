import { supabase } from './supabase'

/**
 * Gmail "draft into Gmail" integration (Option A — no backend).
 *
 * Opens a pre-filled Gmail compose window and auto-adds the HubSpot log-to-CRM
 * BCC so the SENT email is logged to the contact/deal in HubSpot automatically.
 * We also record the draft in Supabase (customer_comms) so the dashboard shows
 * a communication history.
 *
 * NOTE: HubSpot auto-logging requires "Log email to CRM" (BCC/forwarding) to be
 * ON in the HubSpot account, and the recipient to be a known contact. If your
 * account shows a different BCC address, update HUBSPOT_LOG_BCC below.
 */
export const HUBSPOT_LOG_BCC = '39719331@bcc.hubspot.com' // hub id 39719331

export function gmailComposeUrl({ to = '', subject = '', body = '', bcc = HUBSPOT_LOG_BCC }) {
  const p = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body })
  if (bcc) p.set('bcc', bcc)
  return 'https://mail.google.com/mail/?' + p.toString()
}

/** Open Gmail compose in a new tab, pre-filled + BCC'd to HubSpot. */
export function openGmailDraft({ to, subject, body, bcc = HUBSPOT_LOG_BCC }) {
  window.open(gmailComposeUrl({ to, subject, body, bcc }), '_blank', 'noopener')
}

/** Record a drafted comm in the dashboard (best-effort; never blocks the draft). */
export async function logComm({ dealId, labName, channel = 'Email', subject, toEmail, templateKey, loggedBy }) {
  try {
    await supabase.from('customer_comms').insert({
      deal_id: dealId || null,
      lab_name: labName || null,
      kind: 'email_draft',
      channel,
      subject: subject || null,
      to_email: toEmail || null,
      template_key: templateKey || null,
      logged_by: loggedBy || null,
    })
  } catch { /* table may not exist yet / RLS — non-blocking */ }
}
