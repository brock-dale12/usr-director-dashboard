// _shared/google.js — helpers for the Gmail "send from dashboard" feature.
//
// Imported by gmail-* functions. Lives under _shared/ so Netlify does NOT treat
// it as its own function (no handler export); esbuild bundles it into callers.
//
// Trust boundary: every secret here is read from process.env inside the Function
// runtime only. Nothing in this file is ever shipped to the browser bundle.

import crypto from 'node:crypto'

// ── Env ───────────────────────────────────────────────────────────────────────
export const SUPA = process.env.VITE_SUPABASE_URL
export const ANON = process.env.VITE_SUPABASE_ANON_KEY
export const SERVICE = process.env.SUPABASE_SERVICE_KEY
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI
export const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '')
export const TOKEN_ENC_KEY = process.env.TOKEN_ENC_KEY

// HubSpot "log to CRM" BCC — keep in sync with src/lib/gmailDraft.js
export const HUBSPOT_LOG_BCC = '39719331@bcc.hubspot.com'

// Gmail scopes: send mail + identify the connected account.
export const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.send openid email'

export const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
})

// ── Encryption key (AES-256-GCM, 32 bytes) ─────────────────────────────────────
// TOKEN_ENC_KEY may be 64-char hex or base64 of 32 bytes.
function encKey() {
  if (!TOKEN_ENC_KEY) throw new Error('TOKEN_ENC_KEY not configured')
  let buf
  if (/^[0-9a-fA-F]{64}$/.test(TOKEN_ENC_KEY)) buf = Buffer.from(TOKEN_ENC_KEY, 'hex')
  else buf = Buffer.from(TOKEN_ENC_KEY, 'base64')
  if (buf.length !== 32) throw new Error('TOKEN_ENC_KEY must decode to 32 bytes (got ' + buf.length + ')')
  return buf
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv)
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  const tag = c.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decrypt(blob) {
  const raw = Buffer.from(String(blob), 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ct = raw.subarray(28)
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
}

// ── OAuth state (HMAC-signed, tamper-proof) ────────────────────────────────────
function hmac(data) {
  return crypto.createHmac('sha256', encKey()).update(data).digest('base64url')
}
export function signState(payloadObj) {
  const body = Buffer.from(JSON.stringify({ ...payloadObj, ts: Date.now() })).toString('base64url')
  return `${body}.${hmac(body)}`
}
export function verifyState(state, maxAgeMs = 15 * 60 * 1000) {
  const [body, sig] = String(state || '').split('.')
  if (!body || !sig) throw new Error('bad state')
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(hmac(body)))) throw new Error('state signature mismatch')
  const obj = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  if (!obj.ts || Date.now() - obj.ts > maxAgeMs) throw new Error('state expired')
  return obj
}

// ── Supabase: identify the caller from their access token ───────────────────────
export async function getUserFromToken(userToken) {
  if (!userToken) return null
  const r = await fetch(`${SUPA}/auth/v1/user`, {
    headers: { apikey: ANON, authorization: `Bearer ${userToken}` },
  })
  if (!r.ok) return null
  const u = await r.json()
  return u && u.id ? { id: u.id, email: u.email } : null
}
export function bearer(event) {
  return (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '')
}

// ── Supabase: service-role table ops (bypass RLS; functions only) ───────────────
const supaHeaders = () => ({
  apikey: SERVICE,
  authorization: `Bearer ${SERVICE}`,
  'content-type': 'application/json',
})
export async function supaUpsert(table, row, onConflict) {
  const url = `${SUPA}/rest/v1/${table}` + (onConflict ? `?on_conflict=${onConflict}` : '')
  const r = await fetch(url, {
    method: 'POST',
    headers: { ...supaHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  })
  if (!r.ok) throw new Error(`supabase upsert ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`)
}
export async function supaSelectOne(table, query) {
  const r = await fetch(`${SUPA}/rest/v1/${table}?${query}`, { headers: supaHeaders() })
  if (!r.ok) throw new Error(`supabase select ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const rows = await r.json()
  return rows[0] || null
}
export async function supaDelete(table, query) {
  const r = await fetch(`${SUPA}/rest/v1/${table}?${query}`, { method: 'DELETE', headers: supaHeaders() })
  if (!r.ok) throw new Error(`supabase delete ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`)
}
export async function logComm(row) {
  try { await supaUpsert('customer_comms', row) } catch { /* non-blocking */ }
}

// ── Google token endpoints ──────────────────────────────────────────────────────
export async function exchangeCode(code) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  if (!r.ok) throw new Error(`google token exchange ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json() // { access_token, refresh_token, id_token, expires_in, scope }
}
export async function refreshAccessToken(refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })
  if (!r.ok) throw new Error(`google token refresh ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json() // { access_token, expires_in, scope }
}
// Pull the email claim out of a Google id_token (no verification needed — it came
// straight from Google's token endpoint over TLS).
export function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'))
    return payload.email || null
  } catch { return null }
}

// ── MIME ────────────────────────────────────────────────────────────────────────
// RFC 2047 encode a header value if it contains non-ASCII (e.g. emoji in subject).
function encodeHeader(value) {
  const v = String(value || '')
  if (/^[\x00-\x7F]*$/.test(v)) return v
  return `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`
}
const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Build a base64url-encoded RFC 5322 message (multipart/alternative: text + html).
// `html` is optional; if absent we derive a minimal one from text.
export function buildRawMessage({ from, to, bcc, subject, text, html }) {
  const boundary = '==usr_' + crypto.randomBytes(8).toString('hex')
  const htmlPart = html || `<div>${escapeHtml(text || '').replace(/\n/g, '<br>')}</div>`
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean).join('\r\n')

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    text || '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlPart,
    `--${boundary}--`,
    '',
  ].join('\r\n')

  return Buffer.from(`${headers}\r\n\r\n${body}`, 'utf8').toString('base64url')
}
