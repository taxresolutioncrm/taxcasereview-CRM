import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'
import JSZip from 'https://esm.sh/jszip@3.10.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-source-authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODEL = 'gemini-3.8-flash'
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_EXTRACTED_CHARS = 180_000

// Publishable/anon keys are intentionally public credentials. No service-role key is used here.
const SOURCES = {
  tcr: {
    url: 'https://mpxgxfqdbquzkrvvejkh.supabase.co',
    anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlIiwicmVmIjoibXB4Z3hmcWRicXV6a3J2dmVqa2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc3OTI5OTkzOSwiZXhwIjoyMDk0ODc1OTM5fQ.puvhU1MV5nGOykizeTkwCpRR7NKKaGsVpA8oqjVjmu4',
  },
  nashville: {
    url: 'https://ydrvncdedgjtcprczwpu.supabase.co',
    anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlIiwicmVmIjoieWRydm5jZGVkZ2p0Y3ByY3p3cHUiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc4NjgwOTM1NCwiZXhwIjoyMTAyMzg1MzU0fQ.k6_dSA6HREDufH_dxGH9KFrdmwx4EnfV1v3pA1VsGag',
  },
} as const

type SourceKey = keyof typeof SOURCES

const TAX_PROMPT = `
You are the document intelligence engine for a professional tax-resolution CRM.
Analyze the supplied client file and return ONLY one valid JSON object.

Goals:
1. Classify the file accurately: tax return, IRS/state notice, transcript, W-2, 1099, bank statement, pay stub, financial statement, Profit & Loss (P&L), spreadsheet, image, correspondence, POA, business record, or other.
2. Extract material facts, people/entities, tax periods, amounts, balances, penalties, notice/deadline information, properties, employers, accounts, relationships, and useful structured facts.
3. If the file is a Profit & Loss statement / P&L / income statement, classify it as "Profit & Loss (P&L)" and extract statement period, business/entity name, total revenue/income, COGS, gross profit, payroll/labor, rent, taxes/licenses, insurance, interest, depreciation/amortization, major operating expense categories, total expenses, other income/expense, and net income/loss when visible. Preserve comparative, monthly, quarterly, and year-to-date columns.
4. For spreadsheets, preserve row/column meaning and use source_locator values such as "Sheet1!B7" or "Sheet1 rows 2-18" when possible.
5. For PDFs/images/scans, inspect visible content directly. Use source_page for paged documents when available.
6. Identify precise questions that still require a human answer.
7. Never invent values. Use null or omit an item if it is not visible.
8. Never expose full SSNs, EINs, TINs, routing numbers, or bank/account numbers. Mask all but the last four digits.
9. confidence must be between 0 and 1.
10. Do not silently decide legal/tax strategy. Extract facts and operationally useful findings for staff verification.

JSON shape:
{
  "document_type": "string",
  "tax_year": 2025,
  "summary": "short operational summary",
  "confidence": 0.95,
  "facts": [
    {
      "category": "identity|income|balance|penalty|deadline|filing|property|payment|notice|account|spreadsheet|pnl|expense|asset|other",
      "field_key": "snake_case_key",
      "field_label": "Human label",
      "value": "string|number|boolean|object|array|null",
      "normalized_text": "safe display value",
      "source_page": 1,
      "source_locator": "Sheet1!B7",
      "source_excerpt": "brief masked excerpt",
      "confidence": 0.95
    }
  ],
  "entities": [
    {
      "entity_type": "taxpayer|spouse|dependent|business|trust|estate|employer|property|agency|asset|other",
      "display_name": "name",
      "relationship": "relationship to client",
      "identifiers": {"last4":"1234"},
      "attributes": {},
      "source_page": 1,
      "source_locator": "Sheet1!A2",
      "confidence": 0.95
    }
  ],
  "questions": [
    {
      "question": "specific question staff should ask",
      "reason": "why the files do not answer it",
      "priority": "low|normal|high|urgent"
    }
  ]
}`

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function cleanJson(text: string) {
  let trimmed = String(text || '').trim()
  trimmed = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  try { return JSON.parse(trimmed || '{}') } catch {}
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
  throw new Error('AI returned invalid JSON')
}

function clamp(n: unknown) {
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  return Math.max(0, Math.min(1, v))
}

function maskDigits(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 4) return digits
  return '••••' + digits.slice(-4)
}

function redactText(input: unknown) {
  let text = String(input ?? '')
  text = text.replace(/\b(\d{3})[- ]?(\d{2})[- ]?(\d{4})\b/g, (_m, _a, _b, last4) => '***-**-' + last4)
  text = text.replace(/\b(\d{2})[- ]?(\d{7})\b/g, (_m, _a, rest) => '**-***' + String(rest).slice(-4))
  return text
}

function sanitizeValue(value: unknown, key = ''): unknown {
  const sensitiveKey = /(ssn|ein|tin|taxpayer.*id|routing|account.*(number|no|id)|bank.*(number|no|id))/i.test(key)
  if (value == null) return value
  if (sensitiveKey && (typeof value === 'string' || typeof value === 'number')) return maskDigits(String(value))
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, key))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeValue(v, k)
    return out
  }
  return redactText(value)
}

function sanitizeIdentifiers(value: unknown) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(source)) {
    if (raw == null) continue
    const digits = String(raw).replace(/\D/g, '')
    if (digits) out[key.toLowerCase().includes('last4') ? key : key + '_last4'] = digits.slice(-4)
  }
  return out
}

function inferMime(name: string, blobType: string) {
  const ext = name.toLowerCase().split('.').pop() || ''
  const byExt: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    csv: 'text/csv', txt: 'text/plain', json: 'application/json', xml: 'application/xml', rtf: 'application/rtf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  return byExt[ext] || (blobType && blobType !== 'application/octet-stream' ? blobType : 'application/octet-stream')
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, MAX_EXTRACTED_CHARS)
}

function stripXml(xml: string) {
  return xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<a:br\s*\/>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

async function extractOfficeText(bytes: Uint8Array, ext: string) {
  if (['xlsx', 'xlsm', 'xls'].includes(ext)) {
    const workbook = XLSX.read(bytes, { type: 'array', dense: true, cellDates: true })
    const chunks: string[] = []
    for (const sheetName of workbook.SheetNames.slice(0, 25)) {
      const sheet = workbook.Sheets[sheetName]
      chunks.push('--- SHEET: ' + sheetName + ' ---\n' + XLSX.utils.sheet_to_csv(sheet, { blankrows: false }))
      if (chunks.join('\n').length > MAX_EXTRACTED_CHARS) break
    }
    return chunks.join('\n').slice(0, MAX_EXTRACTED_CHARS)
  }
  if (ext === 'docx' || ext === 'pptx') {
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files)
      .filter((name) => ext === 'docx'
        ? name === 'word/document.xml' || /^word\/header\d+\.xml$/.test(name) || /^word\/footer\d+\.xml$/.test(name)
        : /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort()
    const chunks: string[] = []
    for (const name of names.slice(0, 200)) {
      const xml = await zip.file(name)?.async('string')
      if (!xml) continue
      chunks.push('--- ' + name + ' ---\n' + stripXml(xml))
      if (chunks.join('\n').length > MAX_EXTRACTED_CHARS) break
    }
    return chunks.join('\n').slice(0, MAX_EXTRACTED_CHARS)
  }
  return decodeText(bytes)
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

async function authenticate(source: typeof SOURCES[SourceKey], authHeader: string) {
  if (!authHeader.toLowerCase().startsWith('bearer ')) return false
  try {
    const res = await fetch(source.url + '/auth/v1/user', {
      headers: { apikey: source.anon, Authorization: authHeader },
    })
    return res.ok
  } catch {
    return false
  }
}

async function callGemini(apiKey: string, parts: any[]) {
  let lastError = 'AI provider request failed'
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + encodeURIComponent(apiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' },
        }),
      },
    )
    const raw = await res.text()
    if (res.ok) {
      const body = JSON.parse(raw)
      const text = (body?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || '').join('\n')
      if (!text.trim()) throw new Error('AI returned no document analysis')
      return cleanJson(text)
    }
    let msg = 'Gemini error ' + res.status
    try { msg = JSON.parse(raw)?.error?.message || msg } catch {}
    lastError = msg
    if (![429,500,502,503,504].includes(res.status) || attempt === 5) break
    await new Promise(resolve => setTimeout(resolve, 700 * attempt * attempt))
  }
  throw new Error(lastError)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('x-source-authorization') || req.headers.get('Authorization') || ''
  let payload: any = null
  try { payload = await req.json() } catch { return reply({ error: 'invalid_json' }, 400) }

  const sourceKey = String(payload?.sourceProject || 'tcr').toLowerCase() as SourceKey
  const source = SOURCES[sourceKey]
  if (!source) return reply({ error: 'unsupported_source_project' }, 400)
  if (!(await authenticate(source, authHeader))) return reply({ error: 'unauthorized' }, 401)

  const documentId = payload?.documentId
  const requestedClientId = payload?.clientId
  if (!documentId) return reply({ error: 'documentId required' }, 400)

  const geminiKey = Deno.env.get('GEMINI_API_KEY') || ''
  if (!geminiKey) return reply({ ok: false, error: 'AI provider is not configured', code: 'AI_PROVIDER_MISSING' })

  const userClient = createClient(source.url, source.anon, {
    global: { headers: { Authorization: authHeader } },
  })

  try {
    const { data: doc, error: docErr } = await userClient
      .from('documents')
      .select('id,tenant_id,client_id,client,clientname,docType,name,file_name,file_url,storage_path')
      .eq('id', documentId)
      .maybeSingle()
    if (docErr || !doc) return reply({ ok: false, error: 'Document was not found or is not available to this user', code: 'DOCUMENT_NOT_FOUND' })
    if (!doc.tenant_id) return reply({ ok: false, error: 'Document has no tenant assignment', code: 'DOCUMENT_NO_TENANT' })

    let effectiveClientId = doc.client_id || null
    let requestedClient: any = null
    if (requestedClientId) {
      const clientRes = await userClient.from('clients').select('id,name,tenant_id').eq('id', requestedClientId).maybeSingle()
      requestedClient = clientRes.data
      if (clientRes.error || !requestedClient) return reply({ ok: false, error: 'Client was not found', code: 'CLIENT_NOT_FOUND' })
      if (String(requestedClient.tenant_id || '') !== String(doc.tenant_id || '')) {
        return reply({ ok: false, error: 'Document and client belong to different offices', code: 'TENANT_MISMATCH' })
      }
      if (effectiveClientId && String(effectiveClientId) !== String(requestedClient.id)) {
        return reply({ ok: false, error: 'Document is linked to a different client', code: 'DOCUMENT_CLIENT_MISMATCH' })
      }
      if (!effectiveClientId) {
        const legacyName = String(doc.client || doc.clientname || '').trim().toLowerCase()
        if (!legacyName || legacyName !== String(requestedClient.name || '').trim().toLowerCase()) {
          return reply({ ok: false, error: 'Document is not linked to this client', code: 'DOCUMENT_NOT_LINKED' })
        }
        effectiveClientId = requestedClient.id
      }
    }
    if (!effectiveClientId) return reply({ ok: false, error: 'Document is not linked to a client', code: 'DOCUMENT_NOT_LINKED' })

    const storagePath = doc.storage_path
      || (String(doc.file_url || '').startsWith('storage://documents/')
        ? String(doc.file_url).replace('storage://documents/', '')
        : '')
    if (!storagePath) return reply({ ok: false, error: 'Document record has no attached file', code: 'NO_ATTACHED_FILE' })

    const { data: run, error: runErr } = await userClient.from('document_ai_runs').insert({
      tenant_id: doc.tenant_id,
      client_id: effectiveClientId,
      document_id: doc.id,
      status: 'processing',
      vertical: 'tax',
      started_at: new Date().toISOString(),
    }).select('id').single()
    if (runErr || !run) return reply({ ok: false, error: runErr?.message || 'AI run could not be started', code: 'RUN_START_FAILED' })

    try {
      const { data: fileData, error: downloadErr } = await userClient.storage.from('documents').download(storagePath)
      if (downloadErr || !fileData) throw new Error(downloadErr?.message || 'Document download failed')

      const bytes = new Uint8Array(await fileData.arrayBuffer())
      if (!bytes.length) throw new Error('Document is empty')
      if (bytes.length > MAX_FILE_BYTES) throw new Error('Document exceeds the 20 MB AI analysis limit')

      const name = String(doc.file_name || doc.name || 'document').toLowerCase()
      const ext = name.split('.').pop() || ''
      const mime = inferMime(name, fileData.type || '')
      const parts: any[] = []

      if (mime === 'application/pdf' || ['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
        parts.push({ inlineData: { mimeType: mime, data: toBase64(bytes) } })
      } else if (['csv', 'txt', 'json', 'xml', 'rtf', 'xlsx', 'xlsm', 'xls', 'docx', 'pptx'].includes(ext)) {
        const extracted = await extractOfficeText(bytes, ext)
        if (!extracted.trim()) throw new Error('No readable text was found in this file')
        parts.push({ text: 'EXTRACTED FILE CONTENT (' + ext.toUpperCase() + '):\n' + extracted })
      } else {
        throw new Error('Unsupported AI file type. Use PDF, JPG, PNG, WebP, CSV, TXT, JSON, XML, RTF, XLS/XLSX/XLSM, DOCX, or PPTX.')
      }

      parts.push({
        text: TAX_PROMPT
          + '\n\nCRM context: client=' + redactText(doc.client || doc.clientname || requestedClient?.name || 'unknown')
          + ', existing folder=' + redactText(doc.docType || 'unknown')
          + ', filename=' + redactText(doc.file_name || doc.name || 'unknown'),
      })

      const parsed = await callGemini(geminiKey, parts)
      const facts = Array.isArray(parsed.facts) ? parsed.facts : []
      const entities = Array.isArray(parsed.entities) ? parsed.entities : []
      const questions = Array.isArray(parsed.questions) ? parsed.questions : []

      if (facts.length) {
        const rows = facts.map((f: any) => ({
          tenant_id: doc.tenant_id,
          run_id: run.id,
          client_id: effectiveClientId,
          document_id: doc.id,
          category: String(f.category || 'other').slice(0, 80),
          field_key: String(f.field_key || 'unknown').slice(0, 120),
          field_label: f.field_label == null ? null : redactText(f.field_label).slice(0, 180),
          value_json: sanitizeValue(f.value ?? null, String(f.field_key || '')),
          normalized_text: f.normalized_text == null ? null : redactText(f.normalized_text).slice(0, 1000),
          source_page: Number.isInteger(f.source_page) && f.source_page > 0 ? f.source_page : null,
          source_locator: f.source_locator == null ? null : redactText(f.source_locator).slice(0, 240),
          source_excerpt: f.source_excerpt == null ? null : redactText(f.source_excerpt).slice(0, 500),
          confidence: clamp(f.confidence),
        }))
        const { error } = await userClient.from('document_ai_facts').insert(rows)
        if (error) throw error
      }

      if (entities.length) {
        const rows = entities.map((e: any) => ({
          tenant_id: doc.tenant_id,
          run_id: run.id,
          client_id: effectiveClientId,
          document_id: doc.id,
          entity_type: String(e.entity_type || 'other').slice(0, 80),
          display_name: redactText(e.display_name || 'Unknown').slice(0, 240),
          relationship: e.relationship == null ? null : redactText(e.relationship).slice(0, 240),
          identifiers: sanitizeIdentifiers(e.identifiers),
          attributes: sanitizeValue(e.attributes && typeof e.attributes === 'object' ? e.attributes : {}, 'attributes'),
          source_page: Number.isInteger(e.source_page) && e.source_page > 0 ? e.source_page : null,
          source_locator: e.source_locator == null ? null : redactText(e.source_locator).slice(0, 240),
          confidence: clamp(e.confidence),
        }))
        const { error } = await userClient.from('document_ai_entities').insert(rows)
        if (error) throw error
      }

      if (questions.length) {
        const rows = questions.map((q: any) => ({
          tenant_id: doc.tenant_id,
          client_id: effectiveClientId,
          run_id: run.id,
          document_id: doc.id,
          question: redactText(q.question || '').trim().slice(0, 1000),
          reason: q.reason == null ? null : redactText(q.reason).slice(0, 1000),
          priority: ['low', 'normal', 'high', 'urgent'].includes(String(q.priority)) ? String(q.priority) : 'normal',
        })).filter((q: any) => q.question)
        if (rows.length) {
          const { error } = await userClient.from('document_ai_questions').insert(rows)
          if (error) throw error
        }
      }

      const safeSummary = parsed.summary ? redactText(parsed.summary).slice(0, 2000) : null
      const safeType = parsed.document_type ? redactText(parsed.document_type).slice(0, 160) : null
      const { error: finishErr } = await userClient.from('document_ai_runs').update({
        status: 'complete',
        document_type: safeType,
        tax_year: Number.isInteger(parsed.tax_year) ? parsed.tax_year : null,
        summary: safeSummary,
        confidence: clamp(parsed.confidence),
        model: MODEL,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', run.id)
      if (finishErr) throw finishErr

      return reply({
        ok: true,
        runId: run.id,
        documentType: safeType,
        taxYear: Number.isInteger(parsed.tax_year) ? parsed.tax_year : null,
        summary: safeSummary,
        counts: { facts: facts.length, entities: entities.length, questions: questions.length },
        model: MODEL,
        sourceProject: sourceKey,
      })
    } catch (inner: any) {
      const safeError = redactText(inner?.message || inner).slice(0, 1000)
      await userClient.from('document_ai_runs').update({
        status: 'failed',
        error_message: safeError,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', run.id)
      return reply({ ok: false, error: safeError, code: 'ANALYSIS_FAILED', runId: run.id })
    }
  } catch (err: any) {
    console.error('[document-intelligence]', redactText(err?.message || err))
    return reply({ ok: false, error: redactText(err?.message || err), code: 'UNEXPECTED_ERROR' })
  }
})
