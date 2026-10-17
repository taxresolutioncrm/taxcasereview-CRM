// Deployment refresh: reload central support registry and secrets (2026-08-28).
// supabase/functions/support-api/index.ts
//
// RomyLabs Central Support API
// Receives authenticated server-to-server requests from product backends.
// NEVER called directly from browser JavaScript.
//
// Authentication: HMAC-SHA256 signed requests
//   Headers required:
//     x-romylabs-product:   product identifier (e.g. 'camvella')
//     x-romylabs-timestamp: Unix seconds as string
//     x-romylabs-signature: hex(HMAC-SHA256(secret, timestamp + "." + raw_body))
//
//   Secrets (set in TCR Supabase Dashboard → Edge Functions → Secrets):
//     TAXRES_SUPPORT_SECRET
//     CAMVELLA_SUPPORT_SECRET
//     ARCVENA_SUPPORT_SECRET
//     BOCASYNC_SUPPORT_SECRET
//
// Security properties:
//   • Constant-time HMAC comparison (prevents timing attacks)
//   • ±5 minute timestamp window (anti-replay)
//   • Signature covers raw body bytes (prevents body-after-signing attacks)
//   • product_id in body must match x-romylabs-product header
//   • Generic error messages (never expose which check failed)
//   • Internal notes EXCLUDED from all customer-facing responses
//   • Tenant isolation enforced in SQL — cross-org access impossible
//   • No secrets in logs

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Constants ──────────────────────────────────────────────────────────────────

const TIMESTAMP_TOLERANCE_SECONDS = 300  // ±5 minutes

const MAX_BODY_BYTES  = 32_768  // 32 KB hard limit on incoming body
const MAX_MESSAGE_LEN = 10_000  // characters
const MAX_SUBJECT_LEN = 500
const MAX_DESC_LEN    = 20_000

const CATEGORIES = ['Bug Report', 'Feature Request', 'Account Issue', 'Billing Question', 'Other'] as const
const PRIORITIES  = ['Low', 'Normal', 'High', 'Urgent'] as const

// Server-side product authentication.
// Product allowlist is registry-driven: romylabs_product_support.
// Adding a new product requires only an INSERT into romylabs_product_support
// with support_enabled=true. No code changes required here.
// The browser cannot extend the allowlist — the DB lookup enforces it.
//
// Secret env var names must match this pattern — prevents arbitrary env var lookup.
const SUPPORT_SECRET_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,48}_SUPPORT_SECRET$/

// ── CORS ───────────────────────────────────────────────────────────────────────
// support-api is a server-to-server endpoint.
// The only legitimate caller is a product Supabase Edge Function,
// which does not perform CORS preflight. We respond to OPTIONS for safety
// but restrict the allowed origin to Supabase's server-side caller context.
const cors = {
  'Access-Control-Allow-Origin':  'https://mpxgxfqdbquzkrvvejkh.supabase.co',
  'Access-Control-Allow-Headers': 'x-romylabs-product, x-romylabs-timestamp, x-romylabs-signature, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Utility helpers ────────────────────────────────────────────────────────────

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function authError(): Response {
  // Generic — never reveal which check failed
  return jsonResp({ error: 'Unauthorized' }, 401)
}

function validationError(msg: string): Response {
  return jsonResp({ error: msg }, 400)
}

// Constant-time byte comparison — prevents timing attacks on HMAC verification
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// Hex-encode a Uint8Array
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// Compute HMAC-SHA256(key, message) → hex string
async function hmacSHA256(keyStr: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return toHex(sig)
}

// Verify HMAC with constant-time comparison
async function verifyHMAC(keyStr: string, message: string, expectedHex: string): Promise<boolean> {
  const actual   = await hmacSHA256(keyStr, message)
  const enc      = new TextEncoder()
  const actualB  = enc.encode(actual)
  const expectedB = enc.encode(expectedHex.toLowerCase())
  return timingSafeEqual(actualB, expectedB)
}

// ── HMAC Authentication ────────────────────────────────────────────────────────

async function authenticate(
  req: Request,
  rawBody: string,
  supabase: ReturnType<typeof createClient>,
): Promise<{ ok: false } | { ok: true; product: string }> {
  const product   = req.headers.get('x-romylabs-product')?.toLowerCase().trim() ?? ''
  const timestamp = req.headers.get('x-romylabs-timestamp') ?? ''
  const signature = req.headers.get('x-romylabs-signature') ?? ''

  // Step 1: All headers present
  if (!product || !timestamp || !signature) return { ok: false }

  // Step 2: Timestamp within ±5 minutes (anti-replay) — checked before any DB call
  const ts  = parseInt(timestamp, 10)
  const now = Math.floor(Date.now() / 1000)
  if (isNaN(ts) || Math.abs(now - ts) > TIMESTAMP_TOLERANCE_SECONDS) return { ok: false }

  // Step 3: Registry lookup — product must be in romylabs_product_support
  // with support_enabled=true AND romylabs_products.active=true.
  // Single indexed PK lookup: sub-millisecond on a ~10-row table.
  const { data: cfg } = await supabase
    .from('romylabs_product_support')
    .select('secret_env_key, romylabs_products!inner(active)')
    .eq('product_id', product)
    .eq('support_enabled', true)
    .maybeSingle()

  // If product not found, not support-enabled, or product not active: generic failure.
  // Never reveal which check failed — identical response for all non-auth reasons.
  if (!cfg) return { ok: false }
  const productActive = (cfg as any).romylabs_products?.active
  if (!productActive) return { ok: false }

  // Step 4: Env var name allowlist — prevents arbitrary env var lookup
  // even in the hypothetical case of a DB row misconfiguration.
  const secretEnvKey = (cfg as any).secret_env_key as string
  if (!secretEnvKey || !SUPPORT_SECRET_KEY_PATTERN.test(secretEnvKey)) {
    console.error(`support-api: malformed secret_env_key for product '${product}'`)
    return { ok: false }
  }

  // Step 5: Load product secret server-side — never from request, never logged
  const secret = Deno.env.get(secretEnvKey)
  if (!secret) {
    console.error(`support-api: secret ${secretEnvKey} not configured`)
    return { ok: false }
  }

  // Step 6: Verify HMAC — constant-time comparison prevents timing attacks
  const signingInput = `${timestamp}.${rawBody}`
  const valid = await verifyHMAC(secret, signingInput, signature)
  if (!valid) return { ok: false }

  return { ok: true, product }
}

// ── Action handlers ────────────────────────────────────────────────────────────

async function handleCreateTicket(
  supabase: ReturnType<typeof createClient>,
  product: string,
  body: Record<string, unknown>,
): Promise<Response> {
  // Validate required fields from the trusted product backend payload
  const product_tenant_id   = body.product_tenant_id   as string | undefined
  const product_tenant_name = body.product_tenant_name as string | undefined
  const product_user_id     = body.product_user_id     as string | undefined
  const product_user_email  = body.product_user_email  as string | undefined
  const product_org_role    = body.product_org_role    as string | undefined  // audit only
  const subject             = body.subject             as string | undefined
  const description         = body.description         as string | undefined
  const category            = (body.category           as string | undefined) ?? 'Other'
  const priority            = (body.priority           as string | undefined) ?? 'Normal'

  if (!product_tenant_id || !product_user_id || !subject || !description) {
    return validationError('Missing required fields: product_tenant_id, product_user_id, subject, description')
  }

  // Sanitize user-supplied content
  if (subject.length     > MAX_SUBJECT_LEN) return validationError(`subject exceeds ${MAX_SUBJECT_LEN} characters`)
  if (description.length > MAX_DESC_LEN)    return validationError(`description exceeds ${MAX_DESC_LEN} characters`)
  if (!CATEGORIES.includes(category as typeof CATEGORIES[number])) {
    return validationError(`invalid category; must be one of: ${CATEGORIES.join(', ')}`)
  }
  if (!PRIORITIES.includes(priority as typeof PRIORITIES[number])) {
    return validationError(`invalid priority; must be one of: ${PRIORITIES.join(', ')}`)
  }

  const { data, error } = await supabase
    .from('support_tickets')
    .insert({
      // product identity — set by product backend, not browser
      product_id:           product,
      product_tenant_id,
      product_tenant_name:  product_tenant_name ?? null,
      product_user_id,
      product_user_email:   product_user_email   ?? null,
      product_org_role:     product_org_role     ?? null,  // audit metadata
      source:               'web',
      // user-supplied content (validated above)
      submitted_by_name:    (body.submitted_by_name as string | undefined) ?? product_user_email ?? 'Customer',
      submitted_by_email:   product_user_email ?? '',
      category,
      priority,
      subject:              subject.trim(),
      description:          description.trim(),
      // tenant_id is NULL for non-TaxRes products
      tenant_id:            null,
    })
    .select('id, ticket_number')
    .single()

  if (error) {
    console.error('support-api create_ticket error:', error.code, error.message)
    return jsonResp({ error: 'Failed to create ticket' }, 500)
  }

  return jsonResp({ ok: true, ticket_id: data.id, ticket_number: data.ticket_number })
}

async function handleListTickets(
  supabase: ReturnType<typeof createClient>,
  product: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const product_tenant_id = body.product_tenant_id as string | undefined
  const product_user_id   = body.product_user_id   as string | undefined
  const caller_role       = body.caller_role        as string | undefined  // 'admin' | 'member'
  const status_filter     = body.status_filter      as string | undefined
  const limit             = Math.min(Number(body.limit  ?? 25), 50)
  const offset            = Math.max(Number(body.offset ?? 0),  0)

  if (!product_tenant_id || !product_user_id) {
    return validationError('Missing required fields: product_tenant_id, product_user_id')
  }

  let query = supabase
    .from('support_tickets')
    .select('id, ticket_number, product_id, product_tenant_name, submitted_by_name, submitted_by_email, category, priority, subject, status, source, created_at, updated_at')
    .eq('product_id', product)
    .eq('product_tenant_id', product_tenant_id)
    .order('created_at', { ascending: false })
    .limit(limit)
    .range(offset, offset + limit - 1)

  // Scope by role: org admins see all their org's tickets; members see only their own
  const isOrgAdmin = caller_role === 'admin' || caller_role === 'support_manager'
  if (!isOrgAdmin) {
    query = query.eq('product_user_id', product_user_id)
  }

  if (status_filter && ['Open', 'In Progress', 'Resolved'].includes(status_filter)) {
    query = query.eq('status', status_filter)
  }

  const { data, error } = await query

  if (error) {
    console.error('support-api list_tickets error:', error.code, error.message)
    return jsonResp({ error: 'Failed to list tickets' }, 500)
  }

  // NEVER include internal_notes or any internal-note content in customer responses
  return jsonResp({ ok: true, tickets: data ?? [] })
}

async function handleGetTicket(
  supabase: ReturnType<typeof createClient>,
  product: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const ticket_id         = body.ticket_id         as string | undefined
  const product_tenant_id = body.product_tenant_id as string | undefined
  const product_user_id   = body.product_user_id   as string | undefined
  const caller_role       = body.caller_role        as string | undefined

  if (!ticket_id || !product_tenant_id || !product_user_id) {
    return validationError('Missing required fields: ticket_id, product_tenant_id, product_user_id')
  }

  // Fetch the ticket and verify ownership — product AND tenant must match
  const { data: ticket, error: ticketErr } = await supabase
    .from('support_tickets')
    .select('id, ticket_number, product_id, product_tenant_id, product_user_id, product_tenant_name, submitted_by_name, submitted_by_email, category, priority, subject, description, status, source, created_at, updated_at')
    .eq('id', ticket_id)
    .eq('product_id', product)
    .eq('product_tenant_id', product_tenant_id)
    .single()

  if (ticketErr || !ticket) {
    // Return 404 regardless of whether the ticket exists but belongs to another org
    // (prevents information leakage about other organizations' ticket IDs)
    return jsonResp({ error: 'Ticket not found' }, 404)
  }

  // Members can only see their own tickets
  const isOrgAdmin = caller_role === 'admin' || caller_role === 'support_manager'
  if (!isOrgAdmin && ticket.product_user_id !== product_user_id) {
    return jsonResp({ error: 'Ticket not found' }, 404)
  }

  // Fetch messages — EXCLUDE internal notes entirely (not null, excluded)
  const { data: messages, error: msgErr } = await supabase
    .from('support_ticket_messages')
    .select('id, sender, message, created_at')
    .eq('ticket_id', ticket_id)
    .eq('is_internal', false)            // HARD FILTER — internal notes never included
    .order('created_at', { ascending: true })

  if (msgErr) {
    console.error('support-api get_ticket messages error:', msgErr.code, msgErr.message)
    return jsonResp({ error: 'Failed to fetch ticket thread' }, 500)
  }

  return jsonResp({
    ok: true,
    ticket,
    messages: messages ?? [],
  })
}

async function handleAddReply(
  supabase: ReturnType<typeof createClient>,
  product: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const ticket_id         = body.ticket_id         as string | undefined
  const product_tenant_id = body.product_tenant_id as string | undefined
  const product_user_id   = body.product_user_id   as string | undefined
  const message           = body.message           as string | undefined
  const caller_role       = body.caller_role        as string | undefined

  if (!ticket_id || !product_tenant_id || !product_user_id || !message) {
    return validationError('Missing required fields: ticket_id, product_tenant_id, product_user_id, message')
  }

  if (message.trim().length === 0)    return validationError('message cannot be empty')
  if (message.length > MAX_MESSAGE_LEN) return validationError(`message exceeds ${MAX_MESSAGE_LEN} characters`)

  // Verify ticket ownership — same product+tenant check as get_ticket
  const { data: ticket, error: ticketErr } = await supabase
    .from('support_tickets')
    .select('id, product_user_id, status')
    .eq('id', ticket_id)
    .eq('product_id', product)
    .eq('product_tenant_id', product_tenant_id)
    .single()

  if (ticketErr || !ticket) {
    return jsonResp({ error: 'Ticket not found' }, 404)
  }

  const isOrgAdmin = caller_role === 'admin' || caller_role === 'support_manager'
  if (!isOrgAdmin && ticket.product_user_id !== product_user_id) {
    return jsonResp({ error: 'Ticket not found' }, 404)
  }

  if (ticket.status === 'Resolved') {
    return validationError('Cannot reply to a resolved ticket')
  }

  // Insert as customer reply — is_internal is ALWAYS false for product-api replies
  const { data: msg, error: msgErr } = await supabase
    .from('support_ticket_messages')
    .insert({
      ticket_id,
      sender:      'customer',   // always — product API cannot set sender='romy' or 'staff'
      message:     message.trim(),
      is_internal: false,        // always false — internal notes only via Command Center
    })
    .select('id, created_at')
    .single()

  if (msgErr) {
    console.error('support-api add_reply error:', msgErr.code, msgErr.message)
    return jsonResp({ error: 'Failed to add reply' }, 500)
  }

  // Update ticket updated_at (trigger handles this on UPDATE, but we also want
  // updated_at to reflect new messages — update the ticket row explicitly)
  await supabase
    .from('support_tickets')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', ticket_id)

  return jsonResp({ ok: true, message_id: msg.id, created_at: msg.created_at })
}

// ── Arcvena system-mail relay ─────────────────────────────────────────────────
//
// Arcvena runs in its own Supabase project, while the Stalwart credential vault
// for RomyLabs product mailboxes is centralized here. Product backends already
// authenticate to this API with HMAC. Reuse that trust boundary instead of
// copying mailbox passwords into product databases or browsers.

const SYSTEM_MAIL_KINDS = new Set(['auth_invite', 'auth_access', 'auth_recovery'])
const MAX_SYSTEM_SUBJECT_LEN = 300
const MAX_SYSTEM_HTML_LEN = 200_000

function cleanHeader(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

function validEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

async function sendSystemMailViaStalwart(opts: {
  host: string
  username: string
  password: string
  fromAddress: string
  fromName: string
  to: string
  subject: string
  html: string
}) {
  const base = 'https://' + opts.host.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const authorization = 'Basic ' + btoa(opts.username + ':' + opts.password)

  const sessionResponse = await fetch(base + '/.well-known/jmap', {
    headers: { Authorization: authorization, Accept: 'application/json' },
  })
  if (!sessionResponse.ok) throw new Error('Stalwart JMAP session failed (' + sessionResponse.status + ')')

  const session = await sessionResponse.json()
  const apiUrl = String(session?.apiUrl || '').replace('{accountId}', '')
  const accountId =
    session?.primaryAccounts?.['urn:ietf:params:jmap:mail'] ||
    Object.keys(session?.accounts || {})[0]
  if (!apiUrl || !accountId) throw new Error('Stalwart JMAP session missing mail account')

  const metadataResponse = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      using: [
        'urn:ietf:params:jmap:core',
        'urn:ietf:params:jmap:mail',
        'urn:ietf:params:jmap:submission',
      ],
      methodCalls: [
        ['Identity/get', { accountId }, 'identity'],
        ['Mailbox/get', { accountId, properties: ['id', 'name', 'role'] }, 'mailboxes'],
      ],
    }),
  })
  if (!metadataResponse.ok) {
    throw new Error('Stalwart JMAP metadata failed (' + metadataResponse.status + ')')
  }

  const metadata = await metadataResponse.json()
  const identities =
    metadata?.methodResponses?.find((item: any) => item?.[0] === 'Identity/get')?.[1]?.list || []
  const mailboxes =
    metadata?.methodResponses?.find((item: any) => item?.[0] === 'Mailbox/get')?.[1]?.list || []

  const fromAddress = opts.fromAddress.toLowerCase()
  const identity = identities.find(
    (item: any) => String(item?.email || '').toLowerCase() === fromAddress,
  )
  const drafts = mailboxes.find(
    (item: any) => String(item?.role || '').toLowerCase() === 'drafts',
  )
  const sent = mailboxes.find(
    (item: any) => String(item?.role || '').toLowerCase() === 'sent',
  )

  if (!identity?.id) throw new Error('Stalwart sender identity is unavailable')
  if (!drafts?.id || !sent?.id) throw new Error('Stalwart Drafts or Sent mailbox unavailable')

  const partId = 'html'
  const emailObject = {
    from: [{ email: fromAddress, name: opts.fromName }],
    to: [{ email: opts.to }],
    subject: opts.subject,
    mailboxIds: { [drafts.id]: true },
    keywords: { '$draft': true },
    bodyValues: { [partId]: { value: opts.html, charset: 'utf-8' } },
    htmlBody: [{ partId, type: 'text/html' }],
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      using: [
        'urn:ietf:params:jmap:core',
        'urn:ietf:params:jmap:mail',
        'urn:ietf:params:jmap:submission',
      ],
      methodCalls: [
        ['Email/set', { accountId, create: { draft: emailObject } }, 'email'],
        ['EmailSubmission/set', {
          accountId,
          create: { send: { emailId: '#draft', identityId: identity.id } },
          onSuccessUpdateEmail: {
            '#send': {
              ['mailboxIds/' + drafts.id]: null,
              ['mailboxIds/' + sent.id]: true,
              'keywords/$draft': null,
            },
          },
        }, 'submission'],
      ],
    }),
  })
  if (!response.ok) throw new Error('Stalwart JMAP send failed (' + response.status + ')')

  const result = await response.json()
  const emailSet =
    result?.methodResponses?.find((item: any) => item?.[0] === 'Email/set')?.[1]
  const emailRejected = emailSet?.notCreated?.draft
  if (emailRejected) {
    throw new Error(
      String(emailRejected.description || emailRejected.type || 'Stalwart rejected email draft'),
    )
  }

  const submission =
    result?.methodResponses?.find((item: any) => item?.[0] === 'EmailSubmission/set')?.[1]
  const rejected = submission?.notCreated?.send
  if (rejected) {
    throw new Error(String(rejected.description || rejected.type || 'Stalwart rejected send'))
  }

  const submissionId = submission?.created?.send?.id
  if (!submissionId) throw new Error('Stalwart did not confirm message submission')
  return String(submissionId)
}

async function handleSendSystemEmail(
  supabase: ReturnType<typeof createClient>,
  product: string,
  body: Record<string, unknown>,
): Promise<Response> {
  // Keep this endpoint narrow. It exists specifically so the Arcvena project can
  // use the already-registered Arcvena Stalwart identity in the central vault.
  if (product !== 'arcvena') return authError()

  const kind = cleanHeader(body.kind).toLowerCase()
  const to = cleanHeader(body.to).toLowerCase()
  const subject = cleanHeader(body.subject)
  const html = String(body.html ?? '')

  if (!SYSTEM_MAIL_KINDS.has(kind)) return validationError('Unsupported system mail kind')
  if (!validEmailAddress(to)) return validationError('A valid recipient email is required')
  if (!subject || subject.length > MAX_SYSTEM_SUBJECT_LEN) {
    return validationError('System email subject is invalid')
  }
  if (!html || html.length > MAX_SYSTEM_HTML_LEN) {
    return validationError('System email body is invalid')
  }

  // Prevent this highly privileged relay from being repurposed for unrelated
  // mail or another RomyLabs product.
  if (!/arcvena/i.test(subject + '\n' + html)) {
    return validationError('Arcvena branding is required')
  }
  const forbiddenBrands = ['Tax Case Review', 'TaxRes CRM', 'Nashville Tax Solutions', 'CloudCPA']
  if (forbiddenBrands.some(brand => subject.includes(brand) || html.includes(brand))) {
    return validationError('Foreign branding is not allowed')
  }

  const { data: transport, error: transportError } = await supabase.rpc(
    'romylabs_stalwart_transport_for_product',
    { p_product_key: 'arcvena' },
  )
  if (
    transportError ||
    !transport?.ok ||
    !transport?.host ||
    !transport?.username ||
    !transport?.password ||
    !transport?.from_address
  ) {
    console.error(
      'support-api Arcvena system mail transport unavailable:',
      transportError?.message || transport?.error || 'incomplete transport',
    )
    return jsonResp({ error: 'Arcvena system mail transport is unavailable' }, 503)
  }

  try {
    const submissionId = await sendSystemMailViaStalwart({
      host: cleanHeader(transport.host),
      username: cleanHeader(transport.username),
      password: String(transport.password),
      fromAddress: cleanHeader(transport.from_address).toLowerCase(),
      fromName: 'Arcvena',
      to,
      subject,
      html,
    })

    return jsonResp({
      ok: true,
      provider: 'STALWART_JMAP',
      from: cleanHeader(transport.from_address).toLowerCase(),
      submission_id: submissionId,
    })
  } catch (error) {
    console.error(
      'support-api Arcvena Stalwart send failed:',
      error instanceof Error ? error.message : String(error),
    )
    return jsonResp({ error: 'Arcvena Stalwart delivery failed' }, 502)
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') {
    return jsonResp({ error: 'Method not allowed' }, 405)
  }

  // ── Body size limit ─────────────────────────────────────────────────────────
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResp({ error: 'Request body too large' }, 413)
  }

  // Read raw body as text — needed for HMAC verification over exact bytes
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return jsonResp({ error: 'Failed to read request body' }, 400)
  }

  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonResp({ error: 'Request body too large' }, 413)
  }

  // Create the privileged database client before HMAC authentication because
  // authenticate() performs the server-side product registry lookup.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── HMAC authentication ─────────────────────────────────────────────────────
  const authResult = await authenticate(req, rawBody, supabase)
  if (!authResult.ok) {
    return authError()
  }
  const { product } = authResult

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return validationError('Invalid JSON body')
  }

  // ── Verify body.product_id matches authenticated product ────────────────────
  if (body.product_id !== product) {
    // Mismatch between header and body — possible substitution attack
    return authError()
  }

  // ── Route action ────────────────────────────────────────────────────────────
  const action = body.action as string | undefined
  if (!action) return validationError('Missing action')

  switch (action) {
    case 'create_ticket':      return handleCreateTicket(supabase, product, body)
    case 'list_tickets':       return handleListTickets(supabase, product, body)
    case 'get_ticket':         return handleGetTicket(supabase, product, body)
    case 'add_reply':          return handleAddReply(supabase, product, body)
    case 'send_system_email':  return handleSendSystemEmail(supabase, product, body)
    default:
      return validationError(`Unknown action: ${action}`)
  }
})
