import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'
import JSZip from 'https://esm.sh/jszip@3.10.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODEL = 'claude-sonnet-4-5-20250929'
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_EXTRACTED_CHARS = 180_000

const TAX_PROMPT = `
You are the document intelligence engine for a tax resolution CRM.
Analyze the supplied client file and return ONLY valid JSON.

Goals:
1. Classify the file. It may be a tax document, spreadsheet, image/logo, correspondence, financial record, or other business file.
2. Extract material facts, people/entities, tax periods, amounts, notice/deadline information, properties, employers, accounts, relationships, and useful structured spreadsheet facts.
3. For spreadsheets, preserve useful row/column meaning and include a source_locator such as "Sheet1!B7" or "Sheet1 rows 2-18" when possible.
4. For images/logos, identify the asset type and visible business/name text when useful. Never infer a person or company identity that is not visible in the file.
5. Identify questions that still require a human answer.
6. Never invent values. Use null or omit an item if it is not visible.
7. Every extracted fact/entity should include source_page for paged documents and/or source_locator for spreadsheets/office files when available.
8. Never expose full SSNs, EINs, TINs, routing numbers, or bank/account numbers. Mask identifiers except the last four digits.
9. confidence must be 0 through 1.

JSON shape:
{
  "document_type": "string",
  "tax_year": 2025,
  "summary": "short operational summary",
  "confidence": 0.95,
  "facts": [
    {
      "category": "identity|income|balance|penalty|deadline|filing|property|payment|notice|account|spreadsheet|asset|other",
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

function jsonResponse(body: unknown, status=200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function cleanJson(text: string) {
  const trimmed = String(text || '').replace(/^\`\`\`json\s*/i, '').replace(/\`\`\`$/i, '').trim()
  return JSON.parse(trimmed || '{}')
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
  // SSN/TIN-like 9 digit patterns, including dashed forms.
  text = text.replace(/\b(\d{3})[- ]?(\d{2})[- ]?(\d{4})\b/g, (_m, _a, _b, last4) => '***-**-' + last4)
  // EIN-like forms.
  text = text.replace(/\b(\d{2})[- ]?(\d{7})\b/g, (_m, _a, rest) => '**-***' + String(rest).slice(-4))
  return text
}

function sanitizeValue(value: unknown, key=''): unknown {
  const sensitiveKey = /(ssn|ein|tin|taxpayer.*id|routing|account.*(number|no|id)|bank.*(number|no|id))/i.test(key)
  if (value == null) return value
  if (typeof value === 'string') return sensitiveKey ? maskDigits(value) : redactText(value)
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
  const byExt: Record<string,string> = {
    pdf:'application/pdf',
    jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp',
    csv:'text/csv', txt:'text/plain', json:'application/json', xml:'application/xml', rtf:'application/rtf',
    xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsm:'application/vnd.ms-excel.sheet.macroEnabled.12',
    xls:'application/vnd.ms-excel',
    docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  if (byExt[ext]) return byExt[ext]
  return blobType && blobType !== 'application/octet-stream' ? blobType : 'application/octet-stream'
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder('utf-8', { fatal:false }).decode(bytes).slice(0, MAX_EXTRACTED_CHARS)
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
  if (['xlsx','xlsm','xls'].includes(ext)) {
    const workbook = XLSX.read(bytes, { type:'array', dense:true, cellDates:true })
    const chunks: string[] = []
    for (const sheetName of workbook.SheetNames.slice(0, 25)) {
      const sheet = workbook.Sheets[sheetName]
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows:false })
      chunks.push('--- SHEET: ' + sheetName + ' ---\n' + csv)
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500)

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401)

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })

  try {
    const { documentId } = await req.json()
    if (!documentId) return jsonResponse({ error: 'documentId required' }, 400)

    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401)

    // RLS decides whether the caller may see this document. Tenant comes from that authorized row;
    // no separate tenant RPC is trusted for this operation.
    const { data: doc, error: docErr } = await userClient
      .from('documents')
      .select('id,tenant_id,client_id,client,clientname,docType,name,file_name,file_url,storage_path')
      .eq('id', documentId)
      .maybeSingle()

    if (docErr || !doc) return jsonResponse({ error: 'document_not_found' }, 404)
    const tenantId = doc.tenant_id
    if (!tenantId) return jsonResponse({ error: 'document_has_no_tenant' }, 400)
    if (!doc.client_id) return jsonResponse({ error: 'document_not_linked_to_client' }, 400)

    const storagePath = doc.storage_path
      || (String(doc.file_url || '').startsWith('storage://documents/')
        ? String(doc.file_url).replace('storage://documents/', '')
        : '')
    if (!storagePath) return jsonResponse({ error: 'document_has_no_storage_path' }, 400)

    const { data: run, error: runErr } = await userClient
      .from('document_ai_runs')
      .insert({
        tenant_id: tenantId,
        client_id: doc.client_id,
        document_id: doc.id,
        status: 'processing',
        vertical: 'tax',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (runErr || !run) return jsonResponse({ error: runErr?.message || 'could_not_start_run' }, 500)

    try {
      // Download with the caller-scoped Supabase client so Storage RLS remains authoritative.
      const { data: fileData, error: downloadErr } = await userClient.storage.from('documents').download(storagePath)
      if (downloadErr || !fileData) throw new Error(downloadErr?.message || 'document_download_failed')

      const bytes = new Uint8Array(await fileData.arrayBuffer())
      if (!bytes.length) throw new Error('Document is empty')
      if (bytes.length > MAX_FILE_BYTES) throw new Error('Document exceeds 20 MB AI analysis limit')

      const name = String(doc.file_name || doc.name || '').toLowerCase()
      const ext = name.split('.').pop() || ''
      const mime = inferMime(name, fileData.type || '')
      const content: any[] = []

      if (mime === 'application/pdf') {
        content.push({ type:'document', source:{ type:'base64', media_type:'application/pdf', data:toBase64(bytes) } })
      } else if (['image/jpeg','image/png','image/webp'].includes(mime)) {
        content.push({ type:'image', source:{ type:'base64', media_type:mime, data:toBase64(bytes) } })
      } else if ([
        'csv','txt','json','xml','rtf','xlsx','xlsm','xls','docx','pptx'
      ].includes(ext)) {
        const extracted = await extractOfficeText(bytes, ext)
        if (!extracted.trim()) throw new Error('No readable text was found in this file')
        content.push({
          type:'text',
          text:'EXTRACTED FILE CONTENT (' + ext.toUpperCase() + '):\n' + extracted,
        })
      } else {
        throw new Error('Unsupported AI file type. Use PDF, JPG, PNG, WebP, CSV, TXT, JSON, XML, RTF, XLS/XLSX/XLSM, DOCX, or PPTX.')
      }

      content.push({
        type:'text',
        text:TAX_PROMPT
          + '\n\nCRM context: client=' + redactText(doc.client || doc.clientname || 'unknown')
          + ', existing folder=' + redactText(doc.docType || 'unknown')
          + ', filename=' + redactText(doc.file_name || doc.name || 'unknown'),
      })

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'x-api-key':anthropicKey,
          'anthropic-version':'2023-06-01',
        },
        body:JSON.stringify({
          model:MODEL,
          max_tokens:6500,
          temperature:0,
          messages:[{ role:'user', content }],
        }),
      })
      const aiBody = await aiRes.json()
      if (!aiRes.ok) throw new Error(aiBody?.error?.message || ('Anthropic error ' + aiRes.status))

      const text = (aiBody?.content || []).filter((x:any) => x?.type === 'text').map((x:any) => x.text).join('\n')
      const parsed = cleanJson(text)
      const facts = Array.isArray(parsed.facts) ? parsed.facts : []
      const entities = Array.isArray(parsed.entities) ? parsed.entities : []
      const questions = Array.isArray(parsed.questions) ? parsed.questions : []

      if (facts.length) {
        const rows = facts.map((f:any) => ({
          tenant_id:tenantId,
          run_id:run.id,
          client_id:doc.client_id,
          document_id:doc.id,
          category:String(f.category || 'other').slice(0,80),
          field_key:String(f.field_key || 'unknown').slice(0,120),
          field_label:f.field_label == null ? null : redactText(f.field_label).slice(0,180),
          value_json:sanitizeValue(f.value ?? null, String(f.field_key || '')),
          normalized_text:f.normalized_text == null ? null : redactText(f.normalized_text).slice(0,1000),
          source_page:Number.isInteger(f.source_page) && f.source_page > 0 ? f.source_page : null,
          source_locator:f.source_locator == null ? null : redactText(f.source_locator).slice(0,240),
          source_excerpt:f.source_excerpt == null ? null : redactText(f.source_excerpt).slice(0,500),
          confidence:clamp(f.confidence),
        }))
        const { error } = await userClient.from('document_ai_facts').insert(rows)
        if (error) throw error
      }

      if (entities.length) {
        const rows = entities.map((e:any) => ({
          tenant_id:tenantId,
          run_id:run.id,
          client_id:doc.client_id,
          document_id:doc.id,
          entity_type:String(e.entity_type || 'other').slice(0,80),
          display_name:redactText(e.display_name || 'Unknown').slice(0,240),
          relationship:e.relationship == null ? null : redactText(e.relationship).slice(0,240),
          identifiers:sanitizeIdentifiers(e.identifiers),
          attributes:sanitizeValue(e.attributes && typeof e.attributes === 'object' ? e.attributes : {}, 'attributes'),
          source_page:Number.isInteger(e.source_page) && e.source_page > 0 ? e.source_page : null,
          source_locator:e.source_locator == null ? null : redactText(e.source_locator).slice(0,240),
          confidence:clamp(e.confidence),
        }))
        const { error } = await userClient.from('document_ai_entities').insert(rows)
        if (error) throw error
      }

      if (questions.length) {
        const rows = questions.map((q:any) => ({
          tenant_id:tenantId,
          client_id:doc.client_id,
          run_id:run.id,
          document_id:doc.id,
          question:redactText(q.question || '').trim().slice(0,1000),
          reason:q.reason == null ? null : redactText(q.reason).slice(0,1000),
          priority:['low','normal','high','urgent'].includes(String(q.priority)) ? String(q.priority) : 'normal',
        })).filter((q:any) => q.question)
        if (rows.length) {
          const { error } = await userClient.from('document_ai_questions').insert(rows)
          if (error) throw error
        }
      }

      const safeSummary = parsed.summary ? redactText(parsed.summary).slice(0,2000) : null
      const safeType = parsed.document_type ? redactText(parsed.document_type).slice(0,160) : null
      const { error: finishErr } = await userClient.from('document_ai_runs').update({
        status:'complete',
        document_type:safeType,
        tax_year:Number.isInteger(parsed.tax_year) ? parsed.tax_year : null,
        summary:safeSummary,
        confidence:clamp(parsed.confidence),
        model:MODEL,
        completed_at:new Date().toISOString(),
        updated_at:new Date().toISOString(),
      }).eq('id', run.id)
      if (finishErr) throw finishErr

      return jsonResponse({
        ok:true,
        runId:run.id,
        documentType:safeType,
        taxYear:Number.isInteger(parsed.tax_year) ? parsed.tax_year : null,
        summary:safeSummary,
        counts:{ facts:facts.length, entities:entities.length, questions:questions.length },
      })
    } catch (inner:any) {
      await userClient.from('document_ai_runs').update({
        status:'failed',
        error_message:redactText(inner?.message || inner).slice(0,1000),
        completed_at:new Date().toISOString(),
        updated_at:new Date().toISOString(),
      }).eq('id', run.id)
      throw inner
    }
  } catch (err:any) {
    return jsonResponse({ error:redactText(err?.message || err) }, 500)
  }
})
