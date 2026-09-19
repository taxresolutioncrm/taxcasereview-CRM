// ─── Gmail OAuth + Send utilities ────────────────────────────────────────────
// Uses Google's token endpoint directly from the browser (no backend needed).
// Each employee's own tokens live in `employee_gmail_accounts`, keyed by
// their own employees.email — NOT the old single shared `settings` row.
// This is what makes "Connect Gmail" actually mean "connect MY Gmail"
// instead of silently overwriting one firm-wide connection that everyone
// then saw regardless of who they were.

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SEND_URL  = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const LIST_URL  = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'

export function getRedirectUri() {
  return window.location.origin + '/auth/callback'
}

// Exchange an authorization code for access + refresh tokens, store against
// THIS employee's own row in employee_gmail_accounts. The OAuth app's own
// client_id/client_secret (the app's identity, not a personal secret) still
// comes from the shared `settings` row — that part is fine to stay shared.
export async function exchangeCodeForTokens(supabase, code, employeeEmail) {
  if (!employeeEmail) throw new Error('No logged-in employee to connect this Gmail account to')

  const { data: settings } = await supabase.from('settings').select('*').not('gmail_client_id', 'is', null).limit(1).maybeSingle()
  if (!settings?.gmail_client_id || !settings?.gmail_client_secret) {
    throw new Error('Gmail Client ID/Secret not configured in Settings')
  }

  const body = new URLSearchParams({
    code,
    client_id: settings.gmail_client_id,
    client_secret: settings.gmail_client_secret,
    redirect_uri: getRedirectUri(),
    grant_type: 'authorization_code',
  })

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || data.error || 'Token exchange failed')

  // Look up which actual Gmail address this token is for, so the UI can
  // show "connected as you@gmail.com" per employee.
  let connectedEmail = null
  try {
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })
    const profile = await profileRes.json()
    connectedEmail = profile.emailAddress || null
  } catch (_) { /* non-fatal — connection still works without this label */ }

  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  const payload = {
    employee_email: employeeEmail,
    gmail_access_token: data.access_token,
    gmail_token_expiry: expiresAt,
    gmail_connected_email: connectedEmail,
  }
  // refresh_token is only returned on first consent — don't overwrite with null on re-auth
  if (data.refresh_token) payload.gmail_refresh_token = data.refresh_token

  const { data: existing } = await supabase.from('employee_gmail_accounts')
    .select('gmail_refresh_token').eq('employee_email', employeeEmail).maybeSingle()
  if (!data.refresh_token && existing?.gmail_refresh_token) {
    payload.gmail_refresh_token = existing.gmail_refresh_token
  }

  await supabase.from('employee_gmail_accounts').upsert(payload, { onConflict: 'employee_email' })
  return data
}

// Returns a valid access token for a SPECIFIC employee's own connected
// Gmail account, refreshing it first if expired.
export async function getValidGmailToken(supabase, employeeEmail) {
  if (!employeeEmail) throw new Error('No employee specified for Gmail token lookup')

  const { data: acct } = await supabase.from('employee_gmail_accounts')
    .select('*').eq('employee_email', employeeEmail).maybeSingle()
  if (!acct?.gmail_refresh_token) throw new Error('Gmail not connected for this account')

  const { data: settings } = await supabase.from('settings')
    .select('gmail_client_id,gmail_client_secret').not('gmail_client_id', 'is', null).limit(1).maybeSingle()
  if (!settings?.gmail_client_id || !settings?.gmail_client_secret) {
    throw new Error('Gmail Client ID/Secret not configured in Settings')
  }

  const expiry = acct.gmail_token_expiry ? new Date(acct.gmail_token_expiry).getTime() : 0
  if (acct.gmail_access_token && expiry > Date.now() + 60000) {
    return acct.gmail_access_token
  }

  // Refresh
  const body = new URLSearchParams({
    refresh_token: acct.gmail_refresh_token,
    client_id: settings.gmail_client_id,
    client_secret: settings.gmail_client_secret,
    grant_type: 'refresh_token',
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || data.error || 'Token refresh failed')

  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  await supabase.from('employee_gmail_accounts').update({
    gmail_access_token: data.access_token,
    gmail_token_expiry: expiresAt,
  }).eq('employee_email', employeeEmail)

  return data.access_token
}

// The old shared-firm-account token refresh logic, preserved as-is for
// automated system emails (Deadlines/Calendar/Invoices/Estimates) that
// intentionally have no specific human sender and should keep coming from
// one consistent firm-wide address.
async function getValidFirmGmailToken(supabase, settings) {
  const expiry = settings.gmail_token_expiry ? new Date(settings.gmail_token_expiry).getTime() : 0
  if (settings.gmail_access_token && expiry > Date.now() + 60000) {
    return settings.gmail_access_token
  }
  const body = new URLSearchParams({
    refresh_token: settings.gmail_refresh_token,
    client_id: settings.gmail_client_id,
    client_secret: settings.gmail_client_secret,
    grant_type: 'refresh_token',
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || data.error || 'Token refresh failed')

  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  await supabase.from('settings').update({
    gmail_access_token: data.access_token,
    gmail_token_expiry: expiresAt,
  }).eq('id', settings.id)

  return data.access_token
}

function base64UrlEncode(str) {
  // Encode a UTF-8 string to base64url (Gmail API requirement)
  const utf8 = new TextEncoder().encode(str)
  let binary = ''
  utf8.forEach(b => { binary += String.fromCharCode(b) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Email headers (Subject, the display-name part of From) are supposed to be
// plain ASCII. Putting raw UTF-8 characters like an em dash (—) directly in
// a header is non-conformant, and different mail systems handle that
// inconsistently — some show mojibake ("Ã¢Â€Â"" instead of "—"), and it can
// even cause a message to bounce. RFC 2047 encoded-word syntax sidesteps
// this entirely by explicitly declaring the charset, so only encode when
// the string actually contains non-ASCII characters.
function encodeHeaderValue(str) {
  if (!str || /^[\x00-\x7F]*$/.test(str)) return str
  const utf8 = new TextEncoder().encode(str)
  let binary = ''
  utf8.forEach(b => { binary += String.fromCharCode(b) })
  return `=?UTF-8?B?${btoa(binary)}?=`
}

// Turns plain text (with \n line breaks, as typed in the Compose textarea)
// into safe HTML — escapes anything that looks like a tag, then converts
// newlines to <br>, so the body renders correctly without letting stray
// "<" or "&" characters break the HTML structure.
function textToHtml(text) {
  const escaped = (text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.replace(/\r\n|\r|\n/g, '<br>')
}

// Sends an email via the Gmail API.
// If senderEmployeeEmail is given (Email compose page — a real person
// writing), sends from THEIR OWN connected Gmail account with their own
// signature. If not given (Deadlines/Calendar/Invoices/Estimates —
// automated, system-triggered, no specific human sender), falls back to
// the one shared firm-wide account in `settings`, same as before this
// per-employee rework — those should keep coming from one consistent
// firm address regardless of who's logged in when the automation fires.
// attachments (optional): [{ filename, mimeType, base64Data }] — base64Data
// is the standard (non-url) base64 encoding of the raw file bytes.
export async function sendGmailEmail(supabase, { to, subject, body, fromName, attachments = [], senderEmployeeEmail }) {
  let token, senderAddress, sig, fromDisplayName

  if (senderEmployeeEmail) {
    token = await getValidGmailToken(supabase, senderEmployeeEmail)
    const [{ data: acct }, { data: emp }] = await Promise.all([
      supabase.from('employee_gmail_accounts').select('gmail_connected_email').eq('employee_email', senderEmployeeEmail).maybeSingle(),
      supabase.from('employees').select('name,email_signature,email_signature_logo_url').eq('email', senderEmployeeEmail).maybeSingle(),
    ])
    sig = { text: emp?.email_signature, logo: emp?.email_signature_logo_url }
    fromDisplayName = fromName || emp?.name || 'Tax Case Review'
    senderAddress = acct?.gmail_connected_email || senderEmployeeEmail
  } else {
    const { data: settings } = await supabase.from('settings')
      .select('email,name,email_signature,email_signature_logo_url,gmail_refresh_token,gmail_client_id,gmail_client_secret,gmail_access_token,gmail_token_expiry')
      .limit(1).maybeSingle()
    if (!settings?.gmail_refresh_token) throw new Error('Gmail not connected (firm-wide account)')
    token = await getValidFirmGmailToken(supabase, settings)
    sig = { text: settings?.email_signature, logo: settings?.email_signature_logo_url }
    fromDisplayName = fromName || settings?.name || 'Tax Case Review'
    senderAddress = settings?.email
  }

  // A bare display name with no email address is malformed per the email
  // spec, and can get a message silently spam-filtered even when Gmail's
  // API reports success. Use a proper "Name <email>" format when we have
  // a real address on file; Gmail will still send as the authenticated
  // account either way, but a well-formed header improves deliverability.
  const from = senderAddress ? `${encodeHeaderValue(fromDisplayName)} <${senderAddress}>` : encodeHeaderValue(fromDisplayName)
  const encodedSubject = encodeHeaderValue(subject)

  // Build the signature block as real HTML so the logo can actually show.
  // The logo is referenced by its public Supabase Storage URL — simpler
  // and more broadly compatible across mail clients than inline cid:
  // embedding, at the cost of the image needing internet access to load
  // (true for basically every modern mail client anyway).
  let signatureHtml = ''
  if (sig.logo) {
    signatureHtml += `<img src="${sig.logo}" alt="" style="max-height:60px;max-width:240px;display:block;margin-bottom:8px;" />`
  }
  if (sig.text) {
    signatureHtml += `<div style="font-size:13px;color:#444;white-space:pre-wrap;font-family:Arial,sans-serif;">${textToHtml(sig.text)}</div>`
  }

  const bodyHtml = `<div style="font-size:14px;color:#222;font-family:Arial,sans-serif;line-height:1.6;">${textToHtml(body)}</div>` +
    (signatureHtml ? `<div style="margin-top:18px;padding-top:12px;border-top:1px solid #e2e2e2;">${signatureHtml}</div>` : '')

  let message
  if (attachments.length === 0) {
    const headers = [
      `To: ${to}`,
      `From: ${from}`,
      `Subject: ${encodedSubject}`,
      `Date: ${new Date().toUTCString()}`,
      'Content-Type: text/html; charset="UTF-8"',
      'MIME-Version: 1.0',
    ].join('\r\n')
    message = `${headers}\r\n\r\n${bodyHtml}`
  } else {
    const boundary = `====tcr_${Date.now()}====`
    const parts = [
      [
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        bodyHtml,
      ].join('\r\n'),
      ...attachments.map(att => [
        `--${boundary}`,
        `Content-Type: ${att.mimeType}; name="${att.filename}"`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        // wrap at 76 chars — conventional, and some mail servers expect it
        att.base64Data.replace(/(.{76})/g, '$1\r\n'),
      ].join('\r\n')),
      `--${boundary}--`,
    ]
    const headers = [
      `To: ${to}`,
      `From: ${from}`,
      `Subject: ${encodedSubject}`,
      `Date: ${new Date().toUTCString()}`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      'MIME-Version: 1.0',
    ].join('\r\n')
    message = `${headers}\r\n\r\n${parts.join('\r\n')}`
  }

  const raw = base64UrlEncode(message)

  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || 'Failed to send email')
  return data.id
}

// ─── Gmail Sync utilities ─────────────────────────────────────────────────
// Pulls real Inbox + Sent mail into the `emails` table so the CRM actually
// mirrors Gmail instead of only logging what's composed inside the CRM.

function base64UrlDecodeToString(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

function headerValue(headers, name) {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

// Pulls a single email address out of a "Name <email@x.com>" style header.
function extractAddress(headerVal) {
  const m = headerVal.match(/<([^>]+)>/)
  return (m ? m[1] : headerVal).trim()
}
function extractDisplayName(headerVal) {
  const m = headerVal.match(/^"?([^"<]*)"?\s*<[^>]+>$/)
  return m && m[1].trim() ? m[1].trim() : extractAddress(headerVal)
}

// Recursively finds a text/plain (preferred) or text/html part anywhere in
// a Gmail message payload, which can be nested arbitrarily for multipart
// messages (alternative/mixed/related all nest differently).
function findBodyPart(payload, mimeType) {
  if (!payload) return null
  if (payload.mimeType === mimeType && payload.body?.data) return payload.body.data
  for (const part of payload.parts || []) {
    const found = findBodyPart(part, mimeType)
    if (found) return found
  }
  return null
}
function stripHtml(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

// Recursively collects attachment metadata (filename/mimeType/size/id) from
// anywhere in a message's payload — only the pointers, never the file
// bytes, so syncing never has to download or store large binary data.
function findAttachments(payload, out = []) {
  if (!payload) return out
  if (payload.filename && payload.body?.attachmentId) {
    out.push({
      filename: payload.filename,
      mimeType: payload.mimeType || 'application/octet-stream',
      size: payload.body.size || 0,
      attachmentId: payload.body.attachmentId,
    })
  }
  for (const part of payload.parts || []) findAttachments(part, out)
  return out
}

// List message ids matching a label (and optional date-bounded query for
// backfill, e.g. "after:2025/06/18"), paginating with pageToken.
// Returns { ids, nextPageToken }.
export async function listGmailMessages(supabase, { labelIds, query, pageToken, maxResults = 25 } = {}) {
  const token = await getValidGmailToken(supabase)
  const params = new URLSearchParams({ maxResults: String(maxResults) })
  if (labelIds) params.set('labelIds', labelIds)
  if (query) params.set('q', query)
  if (pageToken) params.set('pageToken', pageToken)
  const res = await fetch(`${LIST_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || 'Gmail list failed')
  return { ids: (data.messages || []).map(m => m.id), nextPageToken: data.nextPageToken || null }
}

// Fetches one message and parses it into the shape the `emails` table uses.
// Returns null for label types we don't care about (drafts, trash, promo-only). Spam is surfaced in the CRM Spam folder.
export async function getAndParseGmailMessage(supabase, id, clients = []) {
  const token = await getValidGmailToken(supabase)
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const msg = await res.json()
  if (!res.ok) throw new Error(msg.error?.message || 'Gmail get failed')

  const labels = msg.labelIds || []
  const isSent = labels.includes('SENT')
  const isInbox = labels.includes('INBOX')
  const isSpam = labels.includes('SPAM')
  if (!isSent && !isInbox && !isSpam) return null // draft / trash / promo-only, skip

  const headers = msg.payload?.headers || []
  const fromHeader = headerValue(headers, 'From')
  const toHeader = headerValue(headers, 'To')
  const subject = headerValue(headers, 'Subject') || '(no subject)'
  const dateHeader = headerValue(headers, 'Date')
  const receivedAt = dateHeader ? new Date(dateHeader).toISOString() : new Date(Number(msg.internalDate || Date.now())).toISOString()

  const plainData = findBodyPart(msg.payload, 'text/plain')
  const htmlData = findBodyPart(msg.payload, 'text/html')
  let body = msg.snippet || ''
  if (plainData) body = base64UrlDecodeToString(plainData)
  else if (htmlData) body = stripHtml(base64UrlDecodeToString(htmlData))
  // Many automated/report emails ship a short plain-text stub ("view in
  // HTML for the full report") alongside a rich HTML part — if we only ever
  // stored `body`, that stub is all anyone would ever see. Keep the raw
  // HTML separately so the reading pane can render the real content.
  const bodyHtmlRaw = htmlData ? base64UrlDecodeToString(htmlData) : null

  const counterpartHeader = isSent ? toHeader : fromHeader
  const counterpartAddress = extractAddress(counterpartHeader)
  const counterpartName = extractDisplayName(counterpartHeader)
  const matchedClient = clients.find(c => c.email && c.email.toLowerCase() === counterpartAddress.toLowerCase())
  const attachments = findAttachments(msg.payload)

  return {
    recipient: isSent ? counterpartAddress : extractAddress(fromHeader),
    clientName: matchedClient?.name || counterpartName || counterpartAddress,
    subject,
    body,
    body_html: bodyHtmlRaw,
    triage: isSent ? 'Sent' : isSpam ? 'Spam' : 'Inbox',
    status: isSent ? 'Sent' : isSpam ? 'Spam' : 'Received',
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId,
    from_address: extractAddress(fromHeader),
    received_at: receivedAt,
    created_at: receivedAt,
    is_read: isSent, // sent mail is inherently "read" (you wrote it); inbox mail starts unread
    attachments,
  }
}

// Fetches one Gmail attachment's raw bytes as a Blob. Shared by the
// download-to-computer action and the "attach to client/lead file" action —
// same fetch, different destination for the resulting bytes.
export async function fetchGmailAttachmentBlob(supabase, { gmailMessageId, attachmentId, mimeType, employeeEmail }) {
  const token = await getValidGmailToken(supabase, employeeEmail)
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || 'Could not download attachment')

  const b64 = data.data.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' })
}

// Downloads one attachment from Gmail and triggers a browser save-as —
// fetched on demand so we never have to store attachment bytes ourselves.
export async function downloadGmailAttachment(supabase, { gmailMessageId, attachmentId, filename, mimeType, employeeEmail }) {
  const blob = await fetchGmailAttachmentBlob(supabase, { gmailMessageId, attachmentId, mimeType, employeeEmail })

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'attachment'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

