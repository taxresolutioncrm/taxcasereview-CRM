import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'
const ACTIONS = new Set(['archive','trash','read','unread','inbox','spam'])
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-cron-token',
  'Content-Type': 'application/json',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors })

function decode(v = '') {
  if (!v) return ''
  const b64 = v.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - v.length % 4) % 4)
  const raw = atob(b64)
  return new TextDecoder().decode(Uint8Array.from(raw, c => c.charCodeAt(0)))
}
function h(headers: any[], name: string) { return headers?.find((x: any) => String(x.name).toLowerCase() === name.toLowerCase())?.value || '' }
function address(v = '') { const m = v.match(/<([^>]+)>/); return (m ? m[1] : v).trim() }
function displayName(v = '') { const m = v.match(/^"?([^"<]*)"?\s*<[^>]+>$/); return m?.[1]?.trim() || address(v) }
function part(payload: any, mime: string): string | null { if (!payload) return null; if (payload.mimeType === mime && payload.body?.data) return payload.body.data; for (const p of payload.parts || []) { const x = part(p, mime); if (x) return x } return null }
function plain(html = '') { return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() }
function files(payload: any, out: any[] = []) { if (!payload) return out; if (payload.filename && payload.body?.attachmentId) out.push({ filename: payload.filename, mimeType: payload.mimeType || 'application/octet-stream', size: payload.body.size || 0, attachmentId: payload.body.attachmentId }); for (const p of payload.parts || []) files(p, out); return out }

async function token(db: any, acct: any, creds: any) {
  const expiry = acct.gmail_token_expiry ? new Date(acct.gmail_token_expiry).getTime() : 0
  if (acct.gmail_access_token && expiry > Date.now() + 60_000) return acct.gmail_access_token
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: acct.gmail_refresh_token, client_id: creds.gmail_client_id, client_secret: creds.gmail_client_secret, grant_type: 'refresh_token' }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || `Token refresh failed (${res.status})`)
  await db.from('employee_gmail_accounts').update({ gmail_access_token: data.access_token, gmail_token_expiry: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString() }).eq('employee_email', acct.employee_email)
  return data.access_token
}

async function listIds(tok: string, label: string, opts: { pages?: number, q?: string, pageSize?: number } = {}) {
  const ids: string[] = []; let pageToken = ''; const pages = opts.pages || 1
  for (let page = 0; page < pages; page++) {
    const qs = new URLSearchParams({ maxResults: String(opts.pageSize || 500), labelIds: label }); if (pageToken) qs.set('pageToken', pageToken); if (opts.q) qs.set('q', opts.q)
    const res = await fetch(`${GMAIL}?${qs}`, { headers: { Authorization: `Bearer ${tok}` } }); const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error?.message || `Gmail list failed (${res.status})`)
    ids.push(...(data.messages || []).map((m: any) => m.id)); pageToken = data.nextPageToken || ''; if (!pageToken) break
  }
  return ids
}

async function parse(tok: string, id: string, clients: any[], leads: any[]) {
  const res = await fetch(`${GMAIL}/${encodeURIComponent(id)}?format=full`, { headers: { Authorization: `Bearer ${tok}` } }); const msg = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(msg?.error?.message || `Gmail get failed (${res.status})`)
  const labels = msg.labelIds || [], sent = labels.includes('SENT'), inbox = labels.includes('INBOX'), spam = labels.includes('SPAM'); if (!sent && !inbox && !spam) return null
  const headers = msg.payload?.headers || [], fromH = h(headers, 'From'), toH = h(headers, 'To'), counterpartH = sent ? toH : fromH, counterpart = address(counterpartH)
  const client = clients.find((c: any) => c.email && String(c.email).toLowerCase() === counterpart.toLowerCase())
  const lead = client ? null : leads.find((l: any) => l.email && String(l.email).toLowerCase() === counterpart.toLowerCase())
  const htmlData = part(msg.payload, 'text/html'), html = htmlData ? decode(htmlData) : null, textData = part(msg.payload, 'text/plain'), body = textData ? decode(textData) : html ? plain(html) : (msg.snippet || '')
  const dateH = h(headers, 'Date'), at = dateH && !Number.isNaN(Date.parse(dateH)) ? new Date(dateH).toISOString() : new Date(Number(msg.internalDate || Date.now())).toISOString()
  return { row: { recipient: sent ? counterpart : address(fromH), clientName: client?.name || lead?.name || displayName(counterpartH) || counterpart, subject: h(headers, 'Subject') || '(no subject)', body, body_html: html, triage: sent ? 'Sent' : spam ? 'Spam' : 'Inbox', status: sent ? 'Sent' : spam ? 'Spam' : 'Received', gmail_message_id: msg.id, gmail_thread_id: msg.threadId, from_address: address(fromH), received_at: at, created_at: at, is_read: sent || !labels.includes('UNREAD'), attachments: files(msg.payload) }, match: client ? { kind: 'client', id: client.id, name: client.name } : lead ? { kind: 'lead', id: lead.id, name: lead.name } : null }
}

async function allLocalGmailRows(db: any, owner: string) {
  const out: any[] = []
  for (let from = 0; ; from += 1000) { const { data, error } = await db.from('emails').select('id,gmail_message_id,is_read,triage').eq('mailbox_owner', owner).is('deleted_at', null).not('gmail_message_id', 'is', null).order('id', { ascending: true }).range(from, from + 999); if (error) throw error; out.push(...(data || [])); if (!data || data.length < 1000) break }
  return out
}
async function reconcileUnread(db: any, tok: string, owner: string) {
  const unreadIds = await listIds(tok, 'UNREAD', { pages: 20, pageSize: 500 }), unread = new Set(unreadIds), rows = await allLocalGmailRows(db, owner); let changed = 0
  for (let i = 0; i < rows.length; i += 300) { const chunk = rows.slice(i, i + 300), toUnread = chunk.filter((r: any) => unread.has(r.gmail_message_id) && r.is_read !== false).map((r: any) => r.id), toRead = chunk.filter((r: any) => !unread.has(r.gmail_message_id) && r.is_read !== true).map((r: any) => r.id); if (toUnread.length) { const { error } = await db.from('emails').update({ is_read: false }).in('id', toUnread); if (error) throw error; changed += toUnread.length } if (toRead.length) { const { error } = await db.from('emails').update({ is_read: true }).in('id', toRead); if (error) throw error; changed += toRead.length } }
  return { gmailUnread: unreadIds.length, localRows: rows.length, changed }
}

async function importIds(db: any, tok: string, owner: string, tenantId: string, ids: string[], clients: any[], leads: any[]) {
  let inserted = 0
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100), { data: knownRows } = await db.from('emails').select('gmail_message_id').eq('mailbox_owner', owner).in('gmail_message_id', batch), known = new Set((knownRows || []).map((r: any) => r.gmail_message_id))
    for (const id of batch.filter(x => !known.has(x))) {
      try { const parsed = await parse(tok, id, clients, leads); if (!parsed) continue; const { error } = await db.from('emails').insert({ ...parsed.row, tenant_id: tenantId, mailbox_owner: owner }); if (error) { console.error('gmail-sync insert', id, error.message); continue } inserted++; const m = parsed.match; if (m) { const direction = parsed.row.triage === 'Sent' ? 'Sent' : 'Received', preview = String(parsed.row.body || '').slice(0, 120).replace(/\n/g, ' ').trim(), note = `📧 Email ${direction} — "${parsed.row.subject}"${preview ? `\n${preview}${String(parsed.row.body || '').length > 120 ? '…' : ''}` : ''}`; if (m.kind === 'client') await db.from('client_notes').insert({ clientname: m.name, text: note, note_type: 'Email', author: direction === 'Sent' ? owner : m.name, created_at: parsed.row.created_at, tenant_id: tenantId }); else await db.from('lead_notes').insert({ lead_id: m.id, lead_name: m.name, text: note, type: 'Email', author: direction === 'Sent' ? owner : m.name, created_at: parsed.row.created_at, tenant_id: tenantId }) } } catch (e) { console.error('gmail-sync message import', id, e) }
    }
  }
  return inserted
}

async function syncAccount(db: any, acct: any, tenantId: string, creds: any) {
  const tok = await token(db, acct, creds)
  const [{ data: clients }, { data: leads }] = await Promise.all([db.from('clients').select('id,name,email').eq('tenant_id', tenantId), db.from('leads').select('id,name,email').eq('tenant_id', tenantId)])
  const backfillDone = acct.gmail_backfill_phase === 'done', query = backfillDone ? '' : `after:${Math.floor((Date.now() - 365 * 86400000) / 1000)}`, pages = backfillDone ? 1 : 10; let inserted = 0
  for (const label of ['INBOX','SENT','SPAM']) { const ids = await listIds(tok, label, { pages, pageSize: backfillDone ? 100 : 500, q: query || undefined }); inserted += await importIds(db, tok, acct.employee_email, tenantId, ids, clients || [], leads || []) }
  const unread = await reconcileUnread(db, tok, acct.employee_email), now = new Date().toISOString()
  await db.from('employee_gmail_accounts').update({ gmail_last_sync_at: now, gmail_last_error: null, gmail_backfill_phase: 'done', gmail_backfill_page_token: null }).eq('employee_email', acct.employee_email)
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString(); await db.from('emails').delete().lt('created_at', cutoff).eq('mailbox_owner', acct.employee_email)
  return { inserted, ...unread }
}

async function messageAction(req: Request, db: any, payload: any) {
  const auth = req.headers.get('authorization') || ''; if (!auth.toLowerCase().startsWith('bearer ')) return json({ ok: false, error: 'Unauthorized' }, 401)
  const userDb = createClient(URL, ANON, { global: { headers: { Authorization: auth } } }), { data: { user }, error: userErr } = await userDb.auth.getUser(); if (userErr || !user?.email) return json({ ok: false, error: 'Unauthorized' }, 401)
  const action = String(payload.action || ''); if (!ACTIONS.has(action)) return json({ ok: false, error: 'Invalid email action' }, 400)
  const requested = Array.isArray(payload.email_ids) ? payload.email_ids : [payload.email_id], ids = [...new Set(requested.filter(Boolean))].slice(0, 100); if (!ids.length) return json({ ok: false, error: 'No emails selected' }, 400)
  const owner = String(user.email).toLowerCase(), { data: rows, error } = await db.from('emails').select('id,gmail_message_id,mailbox_owner,tenant_id').in('id', ids); if (error) throw error
  const owned = (rows || []).filter((r: any) => String(r.mailbox_owner || '').toLowerCase() === owner); if (owned.length !== ids.length) return json({ ok: false, error: 'One or more emails are not available for this mailbox' }, 403)
  const { data: emp } = await db.from('employees').select('tenant_id,status').ilike('email', user.email).limit(1).maybeSingle(); if (!emp?.tenant_id || String(emp.status || '').toLowerCase() !== 'active') return json({ ok: false, error: 'Employee is not active' }, 403)
  const tenantId = emp.tenant_id; if (owned.some((r: any) => r.tenant_id && r.tenant_id !== tenantId)) return json({ ok: false, error: 'Cross-tenant email action blocked' }, 403)
  const gmailRows = owned.filter((r: any) => r.gmail_message_id); let tok = ''
  if (gmailRows.length) { const { data: acct } = await db.from('employee_gmail_accounts').select('employee_email,gmail_refresh_token,gmail_access_token,gmail_token_expiry').ilike('employee_email', user.email).limit(1).maybeSingle(), { data: creds } = await db.from('settings').select('gmail_client_id,gmail_client_secret').eq('tenant_id', tenantId).limit(1).maybeSingle(); if (!acct?.gmail_refresh_token) return json({ ok: false, error: 'Gmail is not connected for this employee' }, 409); if (!creds?.gmail_client_id || !creds?.gmail_client_secret) return json({ ok: false, error: 'Gmail OAuth settings missing for this office' }, 500); tok = await token(db, acct, creds) }
  const succeeded: any[] = [], failures: any[] = []
  const processRow = async (row: any) => { try { if (row.gmail_message_id) { const id = encodeURIComponent(row.gmail_message_id); let endpoint = `${GMAIL}/${id}/modify`, body: any = null; if (action === 'archive') body = { removeLabelIds: ['INBOX'] }; else if (action === 'inbox') body = { addLabelIds: ['INBOX'], removeLabelIds: ['SPAM'] }; else if (action === 'spam') body = { addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] }; else if (action === 'read') body = { removeLabelIds: ['UNREAD'] }; else if (action === 'unread') body = { addLabelIds: ['UNREAD'] }; else endpoint = `${GMAIL}/${id}/trash`; const res = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), data = await res.json().catch(() => ({})), alreadyGone = res.status === 404 && (action === 'trash' || action === 'archive'); if (!res.ok && !alreadyGone) throw new Error(data?.error?.message || `Gmail ${action} failed (${res.status})`) } const patch: any = action === 'trash' ? { deleted_at: new Date().toISOString(), triage: 'Archive' } : action === 'archive' ? { triage: 'Archive' } : action === 'spam' ? { triage: 'Spam', deleted_at: null } : action === 'inbox' ? { triage: 'Inbox', deleted_at: null } : action === 'read' ? { is_read: true } : { is_read: false }; const { error: updateErr } = await db.from('emails').update(patch).eq('id', row.id).eq('mailbox_owner', row.mailbox_owner).eq('tenant_id', tenantId); if (updateErr) throw updateErr; succeeded.push(row.id) } catch (e) { const message = String((e as Error)?.message || e); console.error('gmail message action failed', { action, email_id: row.id, message }); failures.push({ id: row.id, error: message }) } }
  for (let i = 0; i < owned.length; i += 5) await Promise.all(owned.slice(i, i + 5).map(processRow))
  return json({ ok: failures.length === 0, action, succeeded, failures }, failures.length ? 207 : 200)
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)
  const db = createClient(URL, SERVICE)
  try {
    let payload: any = {}; if ((req.headers.get('content-type') || '').includes('application/json')) payload = await req.json().catch(() => ({}))
    if (payload?.mode === 'message_action') return await messageAction(req, db, payload)

    // Background service-role sync is never public. Browser message actions
    // retain their normal user-JWT authorization path above.
    const cronToken = req.headers.get('x-internal-cron-token') || ''
    const serviceAuth = req.headers.get('authorization') === `Bearer ${SERVICE}`
    let cronAllowed = serviceAuth
    if (!cronAllowed && cronToken) { const { data, error } = await db.rpc('verify_internal_cron_token', { provided: cronToken }); cronAllowed = !error && data === true }
    if (!cronAllowed) return json({ ok: false, error: 'Unauthorized' }, 401)

    const [{ data: settings }, { data: accounts }] = await Promise.all([db.from('settings').select('tenant_id,gmail_client_id,gmail_client_secret').not('gmail_client_id','is',null), db.from('employee_gmail_accounts').select('employee_email,gmail_refresh_token,gmail_access_token,gmail_token_expiry,gmail_backfill_phase').not('gmail_refresh_token','is',null)])
    if (!accounts?.length) return json({ ok: true, synced: 0, failed: 0, inserted: 0, unreadChanged: 0 })
    const credsByTenant = new Map((settings || []).filter((r: any) => r.tenant_id && r.gmail_client_id && r.gmail_client_secret).map((r: any) => [r.tenant_id, r])), emails = accounts.map((a: any) => a.employee_email)
    const { data: employees } = await db.from('employees').select('email,tenant_id,status').in('email', emails).eq('status','Active')
    const tenantByEmail = new Map((employees || []).map((e: any) => [String(e.email).toLowerCase(), e.tenant_id]))
    let synced = 0, failed = 0, inserted = 0, unreadChanged = 0; const errors: any[] = []
    for (const acct of accounts) {
      const tenantId = tenantByEmail.get(String(acct.employee_email).toLowerCase()), creds = tenantId ? credsByTenant.get(tenantId) : null
      if (!tenantId || !creds) { const msg = !tenantId ? 'Active employee tenant not found' : 'Gmail OAuth credentials not configured for employee tenant'; failed++; errors.push({ employee_email: acct.employee_email, error: msg }); await db.from('employee_gmail_accounts').update({ gmail_last_error: msg }).eq('employee_email', acct.employee_email); continue }
      try { const result = await syncAccount(db, acct, tenantId, creds); inserted += result.inserted; unreadChanged += result.changed; synced++ } catch (e) { const msg = String((e as Error)?.message || e); failed++; errors.push({ employee_email: acct.employee_email, error: msg }); await db.from('employee_gmail_accounts').update({ gmail_last_error: msg }).eq('employee_email', acct.employee_email) }
    }
    return json({ ok: failed === 0, synced, failed, inserted, unreadChanged, errors }, failed ? 207 : 200)
  } catch (e) { console.error('gmail-sync-cron error', e); return json({ ok: false, error: String((e as Error)?.message || e) }, 500) }
})