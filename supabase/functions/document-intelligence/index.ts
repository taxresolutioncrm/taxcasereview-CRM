import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TAX_PROMPT = `
You are the document intelligence engine for a tax resolution CRM.
Analyze the supplied client document and return ONLY valid JSON.

Goals:
1. Classify the document.
2. Extract material facts, people/entities, tax periods, amounts, notice/deadline information, properties, employers, accounts, and relationships.
3. Identify questions that still require a human answer.
4. Never invent values. Use null or omit an item if it is not visible.
5. Every extracted fact/entity must include the page number when available.
6. Do not expose full SSNs/EINs in normalized_text or source_excerpt. Mask identifiers except last four digits.
7. confidence must be 0 through 1.

JSON shape:
{
  "document_type": "string",
  "tax_year": 2025,
  "summary": "short operational summary",
  "confidence": 0.95,
  "facts": [
    {
      "category": "identity|income|balance|penalty|deadline|filing|property|payment|notice|account|other",
      "field_key": "snake_case_key",
      "field_label": "Human label",
      "value": "string|number|boolean|object|array|null",
      "normalized_text": "safe display value",
      "source_page": 1,
      "source_excerpt": "brief masked excerpt",
      "confidence": 0.95
    }
  ],
  "entities": [
    {
      "entity_type": "taxpayer|spouse|dependent|business|trust|estate|employer|property|agency|other",
      "display_name": "name",
      "relationship": "relationship to client",
      "identifiers": {"last4":"1234"},
      "attributes": {},
      "source_page": 1,
      "confidence": 0.95
    }
  ],
  "questions": [
    {
      "question": "specific question staff should ask",
      "reason": "why the documents do not answer it",
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
  const trimmed = String(text || '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
  return JSON.parse(trimmed || '{}')
}

function clamp(n: unknown) {
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  return Math.max(0, Math.min(1, v))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500)

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401)

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const admin = createClient(supabaseUrl, serviceKey)

  try {
    const { documentId } = await req.json()
    if (!documentId) return jsonResponse({ error: 'documentId required' }, 400)

    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401)

    const { data: tenantId, error: tenantErr } = await userClient.rpc('current_tenant_id')
    if (tenantErr || !tenantId) return jsonResponse({ error: 'tenant_not_resolved' }, 403)

    const { data: doc, error: docErr } = await userClient
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .maybeSingle()

    if (docErr || !doc) return jsonResponse({ error: 'document_not_found' }, 404)

    const storagePath = doc.storage_path
      || (String(doc.file_url || '').startsWith('storage://documents/')
        ? String(doc.file_url).replace('storage://documents/', '')
        : '')

    if (!storagePath) return jsonResponse({ error: 'document_has_no_storage_path' }, 400)

    const { data: run, error: runErr } = await userClient
      .from('document_ai_runs')
      .insert({
        tenant_id: tenantId,
        client_id: doc.client_id || null,
        document_id: doc.id,
        status: 'processing',
        vertical: 'tax',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (runErr || !run) return jsonResponse({ error: runErr?.message || 'could_not_start_run' }, 500)

    try {
      const { data: fileData, error: downloadErr } = await admin.storage.from('documents').download(storagePath)
      if (downloadErr || !fileData) throw new Error(downloadErr?.message || 'document_download_failed')

      const bytes = new Uint8Array(await fileData.arrayBuffer())
      if (bytes.length > 20 * 1024 * 1024) throw new Error('Document exceeds 20 MB AI analysis limit')

      let binary = ''
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
      }
      const base64 = btoa(binary)
      const name = String(doc.file_name || doc.name || '').toLowerCase()
      const mime = fileData.type || (name.endsWith('.pdf') ? 'application/pdf'
        : name.endsWith('.png') ? 'image/png'
        : name.endsWith('.webp') ? 'image/webp'
        : 'image/jpeg')

      const content: any[] = []
      if (mime === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } })
      } else if (['image/jpeg','image/png','image/webp'].includes(mime)) {
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      } else {
        throw new Error('Unsupported AI document type. Use PDF, JPG, PNG, or WebP.')
      }

      content.push({
        type: 'text',
        text: TAX_PROMPT + '\n\nCRM context: client=' + String(doc.client || doc.clientname || 'unknown')
          + ', existing folder=' + String(doc.docType || 'unknown')
          + ', filename=' + String(doc.file_name || doc.name || 'unknown'),
      })

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 5000,
          temperature: 0,
          messages: [{ role: 'user', content }],
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
        const { error } = await userClient.from('document_ai_facts').insert(facts.map((f:any) => ({
          tenant_id: tenantId,
          run_id: run.id,
          client_id: doc.client_id || null,
          document_id: doc.id,
          category: String(f.category || 'other'),
          field_key: String(f.field_key || 'unknown'),
          field_label: f.field_label ? String(f.field_label) : null,
          value_json: f.value ?? null,
          normalized_text: f.normalized_text == null ? null : String(f.normalized_text),
          source_page: Number.isInteger(f.source_page) ? f.source_page : null,
          source_excerpt: f.source_excerpt == null ? null : String(f.source_excerpt).slice(0, 500),
          confidence: clamp(f.confidence),
        })))
        if (error) throw error
      }

      if (entities.length) {
        const { error } = await userClient.from('document_ai_entities').insert(entities.map((e:any) => ({
          tenant_id: tenantId,
          run_id: run.id,
          client_id: doc.client_id || null,
          document_id: doc.id,
          entity_type: String(e.entity_type || 'other'),
          display_name: String(e.display_name || 'Unknown'),
          relationship: e.relationship == null ? null : String(e.relationship),
          identifiers: e.identifiers && typeof e.identifiers === 'object' ? e.identifiers : {},
          attributes: e.attributes && typeof e.attributes === 'object' ? e.attributes : {},
          source_page: Number.isInteger(e.source_page) ? e.source_page : null,
          confidence: clamp(e.confidence),
        })))
        if (error) throw error
      }

      if (questions.length) {
        const { error } = await userClient.from('document_ai_questions').insert(questions.map((q:any) => ({
          tenant_id: tenantId,
          client_id: doc.client_id || null,
          run_id: run.id,
          document_id: doc.id,
          question: String(q.question || '').trim(),
          reason: q.reason == null ? null : String(q.reason),
          priority: ['low','normal','high','urgent'].includes(String(q.priority)) ? String(q.priority) : 'normal',
        })).filter((q:any) => q.question))
        if (error) throw error
      }

      await userClient.from('document_ai_runs').update({
        status: 'complete',
        document_type: parsed.document_type ? String(parsed.document_type) : null,
        tax_year: Number.isInteger(parsed.tax_year) ? parsed.tax_year : null,
        summary: parsed.summary ? String(parsed.summary) : null,
        confidence: clamp(parsed.confidence),
        model: 'claude-sonnet-4-5-20250929',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', run.id)

      return jsonResponse({
        ok: true,
        runId: run.id,
        documentType: parsed.document_type || null,
        taxYear: parsed.tax_year || null,
        summary: parsed.summary || null,
        counts: { facts: facts.length, entities: entities.length, questions: questions.length },
      })
    } catch (inner:any) {
      await userClient.from('document_ai_runs').update({
        status: 'failed',
        error_message: String(inner?.message || inner).slice(0, 1000),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', run.id)
      throw inner
    }
  } catch (err:any) {
    return jsonResponse({ error: String(err?.message || err) }, 500)
  }
})
