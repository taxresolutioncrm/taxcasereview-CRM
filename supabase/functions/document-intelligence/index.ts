import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'
import JSZip from 'https://esm.sh/jszip@3.10.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-source-authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODEL = 'gemini-3.5-flash-lite'
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_EXTRACTED_CHARS = 180_000

// Publishable/anon keys are intentionally public credentials. No service-role key is used here.
const SOURCES = {
  tcr: {
    url: 'https://mpxgxfqdbquzkrvvejkh.supabase.co',
    anon: 'sb_publishable_nE5-rNsdH9XabAkbPSd9ug_Pf8MWzcm',
  },
  nashville: {
    url: 'https://ydrvncdedgjtcprczwpu.supabase.co',
    anon: 'sb_publishable_yQ4YkTr03xJWB-BUHlY-TQ_vqVSKGIM',
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
6. You will also receive CRM_CONTEXT. Before returning any question, check the document AND CRM_CONTEXT. Do not ask a question if trusted CRM data, prior extracted facts, payments, notes, case data, document metadata, or staff/representative records already answer it. Only return genuinely unresolved questions that still require human input.
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
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok:false, status:0, reason:'missing_bearer' }
  try {
    const token = authHeader.slice(7).trim()
    if (!token) return { ok:false, status:0, reason:'empty_token' }
    const res = await fetch(source.url + '/auth/v1/user', {
      headers: { apikey: source.anon, Authorization: 'Bearer ' + token },
    })
    if (res.ok) return { ok:true, status:res.status, reason:'' }
    let reason = 'auth_rejected'
    try {
      const body = await res.json()
      reason = String(body?.code || body?.msg || body?.message || reason).slice(0,160)
    } catch {}
    return { ok:false, status:res.status, reason }
  } catch (err:any) {
    return { ok:false, status:0, reason:String(err?.message||err).slice(0,160) }
  }
}


function compactRows(rows: any[], limit = 80) {
  return (rows || []).slice(0, limit).map((row:any) => sanitizeValue(row))
}

async function loadCrmContext(userClient:any, clientId:string) {
  const clientRes = await userClient.from('clients').select(
    'id,name,email,phone,street,city,state,zip,business_name,taxYears,assignedTo,taxAssociate,filingStatus,irsBalance,stateBalance,issueType,contractFee,payment_method_type,payment_method_brand,payment_method_last4,autopay_enabled,autopay_amount,autopay_frequency,autopay_next_charge,autopay_last_result,autopay_last_charged_at,tenant_id'
  ).eq('id', clientId).maybeSingle()
  if (clientRes.error || !clientRes.data) throw new Error(clientRes.error?.message || 'Client context was not found')
  const client:any = clientRes.data
  const clientName = String(client.name || '').trim()

  const [notesById, notesByName, paymentsById, paymentsByName, casesById, casesByName, docsById, docsByName, facts, reps] = await Promise.all([
    userClient.from('client_notes').select('text,author,type,note_type,created_at').eq('client_id',clientId).order('created_at',{ascending:false}).limit(100),
    clientName ? userClient.from('client_notes').select('text,author,type,note_type,created_at').eq('clientname',clientName).order('created_at',{ascending:false}).limit(100) : Promise.resolve({data:[],error:null}),
    userClient.from('payments').select('amount,method,date,status,payment_status,scheduled_date,notes,source,trade_type,created_at').eq('client_id',clientId).order('created_at',{ascending:false}).limit(100),
    clientName ? userClient.from('payments').select('amount,method,date,status,payment_status,scheduled_date,notes,source,trade_type,created_at').eq('clientName',clientName).order('created_at',{ascending:false}).limit(100) : Promise.resolve({data:[],error:null}),
    userClient.from('cases').select('caseNum,caseType,status,assignedTo,taxAssociate,deadline,taxYears,irsBalance,resolutionAmount,notes,created_at').eq('clientid',clientId).order('created_at',{ascending:false}).limit(30),
    clientName ? userClient.from('cases').select('caseNum,caseType,status,assignedTo,taxAssociate,deadline,taxYears,irsBalance,resolutionAmount,notes,created_at').eq('clientName',clientName).order('created_at',{ascending:false}).limit(30) : Promise.resolve({data:[],error:null}),
    userClient.from('documents').select('id,file_name,name,docType,notes,source,caseNum,created_at').eq('client_id',clientId).order('created_at',{ascending:false}).limit(150),
    clientName ? userClient.from('documents').select('id,file_name,name,docType,notes,source,caseNum,created_at').is('client_id',null).eq('client',clientName).order('created_at',{ascending:false}).limit(150) : Promise.resolve({data:[],error:null}),
    userClient.from('document_ai_facts').select('category,field_key,field_label,normalized_text,value_json,source_locator,source_page,confidence,review_status,created_at').eq('client_id',clientId).neq('review_status','rejected').order('created_at',{ascending:false}).limit(200),
    userClient.from('employees').select('name,role,title,caf,caf_number,ptin,status').eq('tenant_id',client.tenant_id).eq('status','Active').limit(100),
  ])

  const merge = (a:any,b:any,keyFn:(x:any)=>string) => {
    const out:any[]=[]; const seen=new Set<string>()
    for(const row of [...(a?.data||[]),...(b?.data||[])]){ const k=keyFn(row); if(!seen.has(k)){seen.add(k);out.push(row)} }
    return out
  }
  const notes=merge(notesById,notesByName,(x)=>String(x.created_at||'')+'|'+String(x.text||''))
  const payments=merge(paymentsById,paymentsByName,(x)=>String(x.created_at||'')+'|'+String(x.amount||'')+'|'+String(x.method||''))
  const cases=merge(casesById,casesByName,(x)=>String(x.caseNum||x.created_at||'')+'|'+String(x.caseType||''))
  const documents=merge(docsById,docsByName,(x)=>String(x.id||x.file_name||x.name||''))

  return sanitizeValue({
    client,
    notes: compactRows(notes,100),
    payments: compactRows(payments,100),
    cases: compactRows(cases,30),
    documents: compactRows(documents,150),
    prior_facts: compactRows(facts.data||[],200),
    representatives: compactRows(reps.data||[],100),
  })
}

async function resolveOpenQuestions(userClient:any, geminiKey:string, clientId:string) {
  const context=await loadCrmContext(userClient,clientId)
  const {data:open,error}=await userClient.from('document_ai_questions')
    .select('id,question,reason,priority,document_id,created_at')
    .eq('client_id',clientId).eq('status','open').order('created_at',{ascending:true}).limit(200)
  if(error) throw error
  if(!open?.length) return {resolved:0,remaining:0,resolutions:[]}

  const prompt='You resolve open questions in a professional tax-resolution CRM using ONLY trusted CRM_CONTEXT below.\\n'
    +'Do not guess, infer legal strategy, or appoint representatives merely because they are employees.\\n'
    +'Answer a question only when the context explicitly supports the answer.\\n'
    +'Payments may answer payment-status/payment-method questions. Client profile may answer contact/address/tax-year questions. Notes/cases/prior facts may answer case-specific questions. Representative records may support identity/credential details only when the client/case/notes establish that person as the representative.\\n'
    +'Return ONLY JSON: {"resolutions":[{"id":"uuid","answer":"concise answer","confidence":0.0,"source":"client profile|payment record|client note|case|prior document fact|representative record"}]}\\n'
    +'Include only answers with confidence >= 0.80. Leave genuinely unresolved questions out.\\n\\nOPEN_QUESTIONS:\\n'
    +JSON.stringify(open)+'\\n\\nCRM_CONTEXT:\\n'+JSON.stringify(context)

  const parsed=await callGemini(geminiKey,[{text:prompt}])
  const resolutions=Array.isArray(parsed?.resolutions)?parsed.resolutions:[]
  let resolved=0
  const allowedIds=new Set(open.map((q:any)=>String(q.id)))
  for(const item of resolutions){
    const id=String(item?.id||'')
    const confidence=clamp(item?.confidence)
    const answer=redactText(item?.answer||'').trim().slice(0,1800)
    const source=redactText(item?.source||'CRM record').trim().slice(0,240)
    if(!allowedIds.has(id)||!answer||confidence==null||confidence<0.8) continue
    const {error:updateErr}=await userClient.from('document_ai_questions').update({
      answer: answer + (source ? ' [Source: '+source+']' : ''),
      status:'answered',
      answered_at:new Date().toISOString(),
    }).eq('id',id).eq('status','open')
    if(!updateErr) resolved++
  }
  return {resolved,remaining:Math.max(0,open.length-resolved),resolutions}
}

async function callGemini(apiKey: string, parts: any[]) {
  let lastError = 'AI provider request failed'
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + encodeURIComponent(apiKey),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(45_000),
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature: 0, maxOutputTokens: 5000, responseMimeType: 'application/json' },
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
      if (![429,500,502,503,504].includes(res.status) || attempt === 2) break
    } catch (err:any) {
      lastError = err?.name === 'TimeoutError' ? 'AI provider timed out' : String(err?.message || err)
      if (attempt === 2) break
    }
    await new Promise(resolve => setTimeout(resolve, 700))
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
  const authCheck = await authenticate(source, authHeader)
  if (!authCheck.ok) return reply({ error: 'unauthorized', auth_status: authCheck.status, auth_reason: authCheck.reason }, 401)

  const documentId = payload?.documentId
  const requestedClientId = payload?.clientId

  const geminiKey = Deno.env.get('GEMINI_API_KEY') || ''
  if (!geminiKey) return reply({ ok: false, error: 'AI provider is not configured', code: 'AI_PROVIDER_MISSING' })

  const userClient = createClient(source.url, source.anon, {
    global: { headers: { Authorization: authHeader } },
  })

  if (String(payload?.action || '').toLowerCase() === 'resolve_questions') {
    if (!requestedClientId) return reply({ ok:false,error:'clientId required',code:'CLIENT_REQUIRED' },400)
    try {
      const result=await resolveOpenQuestions(userClient,geminiKey,String(requestedClientId))
      return reply({ok:true,action:'resolve_questions',...result,sourceProject:sourceKey})
    } catch(err:any) {
      return reply({ok:false,error:redactText(err?.message||err).slice(0,1000),code:'QUESTION_RESOLUTION_FAILED'})
    }
  }

  if (!documentId) return reply({ error: 'documentId required' }, 400)

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

      const crmContext = await loadCrmContext(userClient,String(effectiveClientId))
      parts.push({
        text: TAX_PROMPT
          + '\n\nCURRENT_DOCUMENT: client=' + redactText(doc.client || doc.clientname || requestedClient?.name || 'unknown')
          + ', existing folder=' + redactText(doc.docType || 'unknown')
          + ', filename=' + redactText(doc.file_name || doc.name || 'unknown')
          + '\n\nCRM_CONTEXT (trusted CRM data to use before creating questions):\n' + JSON.stringify(crmContext),
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
