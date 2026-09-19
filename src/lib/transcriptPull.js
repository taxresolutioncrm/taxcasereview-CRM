// ── Transcript pull layer (provider-agnostic) ──
//
// How Canopy actually does it: their transcript pull runs over the IRS's
// sanctioned TDS Application-to-Application (A2A) channel as an enrolled
// software provider, keyed to the firm's CAF number and an active 2848/8821.
// Their original tool automated e-Services logins and the IRS shut it down
// in Sept 2018 — login automation is never an option here (it risks the
// firm's CAF / e-Services standing).
//
// So this layer is built to Canopy parity with a swappable backend:
//   • manual      — live today. Practitioner pulls from TDS; the watched
//                   folder auto-imports, parses, matches and files.
//   • irs_a2a     — the Canopy channel. Goes live when TCR's IRS
//                   software-provider (A2A) enrollment is approved.
//   • partner_api — optional bridge: an IRS-authorized API partner
//                   (TaxStatus-style, 8821-based) while A2A is pending.
//
// submitToProvider() is the single swap point — when a real backend lands,
// it invokes the `transcript-pull` edge function and nothing in the UI
// changes.

import { supabase } from './supabase'
import { parseIrsTranscript, extractPdfText } from './irsTranscriptParser'

export const PULL_PROVIDERS = [
  {
    id: 'manual',
    label: 'Manual — IRS e-Services (TDS)',
    chip: 'Active',
    available: true,
    note: 'Pull from TDS as usual. The watched folder below auto-imports, parses and files every download against the right client and request.',
  },
  {
    id: 'irs_a2a',
    label: 'IRS TDS A2A (direct pull)',
    chip: 'Enrollment pending',
    available: false,
    note: 'The channel Canopy uses: automated TDS pulls as an IRS-enrolled software provider, gated on CAF + active POA. Activates here the moment enrollment is approved — no UI change.',
  },
  {
    id: 'partner_api',
    label: 'Authorized API partner',
    chip: 'Evaluating',
    available: false,
    note: 'IRS-authorized partner API (8821-based, TaxStatus-style) as an optional bridge while A2A enrollment completes.',
  },
]

export function getProvider(id) {
  return PULL_PROVIDERS.find(p => p.id === id) || PULL_PROVIDERS[0]
}

// Single backend swap point.
export async function submitToProvider(providerId, requestRow) {
  const p = getProvider(providerId)
  if (!p.available) throw new Error(`${p.label} isn't live yet.`)
  if (p.id === 'manual') return { status: 'Requested' } // fulfilled via TDS + watched folder
  // Future (A2A / partner):
  // const { data, error } = await supabase.functions.invoke('transcript-pull',
  //   { body: { requestId: requestRow.id, provider: p.id } })
  // if (error) throw error
  // return data
  return { status: 'Requested' }
}

// ── Year spec helpers ──
// "2019-2024" / "2019, 2021" / "2019 2021" → Set('2019','2020',…)
export function parseYearSpec(spec) {
  const out = new Set()
  if (!spec) return out
  const s = String(spec)
  const ranges = s.match(/((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})/g) || []
  for (const r of ranges) {
    const [a, b] = r.match(/(?:19|20)\d{2}/g).map(Number)
    for (let y = Math.min(a, b); y <= Math.max(a, b); y++) out.add(String(y))
  }
  const rest = s.replace(/((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})/g, ' ')
  for (const m of rest.match(/(?:19|20)\d{2}/g) || []) out.add(m)
  return out
}

// ── Name matching ──
// Transcript header ("NAME(S) SHOWN ON RETURN") is uppercase, may include a
// spouse ("JOHN Q & JANE DOE") or trail an address fragment. A client
// matches when every token of the client's name appears among the
// transcript-name tokens (initials match on first letter).
export function nameKey(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function namesMatch(transcriptName, clientName) {
  const t = nameKey(transcriptName), c = nameKey(clientName)
  if (!t || !c) return false
  if (t === c) return true
  const tTok = t.split(' ')
  const cTok = c.split(' ').filter(w => !['JR', 'SR', 'II', 'III', 'IV'].includes(w))
  if (cTok.length === 0) return false
  return cTok.every(w =>
    w.length === 1 ? tTok.some(x => x[0] === w) : tTok.includes(w)
  )
}

// ── Parse / store (split so the importer can identify before filing) ──
export async function parseTranscriptFile(file) {
  const text = await extractPdfText(file)
  if (!text || text.trim().length < 40) {
    throw new Error('No text layer found — this looks like a scanned image, not a TDS download.')
  }
  return parseIrsTranscript(text)
}

// Mirrors the insert on the Transcript Analysis tab so both paths file
// identical rows.
export async function storeTranscriptAnalysis(file, clientName, a) {
  const normalizedClientName = clientName.trim()
  const { data: tenantId } = await supabase.rpc('current_tenant_id')
  const { data: matches, error: clientErr } = await supabase.from('clients')
    .select('id,name')
    .eq('tenant_id', tenantId)
    .ilike('name', normalizedClientName)
    .limit(2)
  if (clientErr) throw new Error(clientErr.message)
  if ((matches || []).length !== 1) {
    throw new Error((matches || []).length === 0
      ? `Could not resolve "${normalizedClientName}" to a Nashville client.`
      : `More than one Nashville client matches "${normalizedClientName}". Assign the transcript manually.`)
  }

  const client = matches[0]
  let filePath = null
  try {
    const safeFile = String(file.name || 'transcript.pdf').replace(/[^A-Za-z0-9._-]+/g, '-')
    filePath = `transcripts/${client.id}/${Date.now()}-${safeFile}`
    const { error: upErr } = await supabase.storage.from('documents').upload(filePath, file, { upsert: false })
    if (upErr) throw upErr
  } catch (e) {
    throw new Error(`Transcript file upload failed: ${e?.message || e}`)
  }

  const storageUrl = `storage://documents/${filePath}`
  const { data, error } = await supabase.from('transcript_analyses').insert({
    tenant_id: tenantId,
    client_id: client.id,
    client_name: client.name,
    tax_year: a.tax_year || null,
    transcript_type: a.transcript_type || null,
    total_balance: a.account_balance ?? null,
    accrued_penalty: a.accrued_penalty ?? null,
    accrued_interest: a.accrued_interest ?? null,
    assessment_date: a.assessment_date || null,
    csed_estimate: a.csed_estimate || null,
    flags: a.flags || {},
    raw_analysis: a,
    file_url: storageUrl,
    file_path: filePath,
  }).select('id').single()
  if (error) {
    await supabase.storage.from('documents').remove([filePath]).catch(()=>{})
    throw new Error(error.message)
  }

  // File it in the authoritative client Documents → Transcripts folder.
  const title = ['IRS', a.transcript_type || 'Transcript', a.tax_year || ''].filter(Boolean).join(' ')
  const bal = a.account_balance
  const { error: docErr } = await supabase.from('documents').insert([{
    tenant_id: tenantId,
    client_id: client.id,
    client: client.name,
    clientname: client.name,
    name: title,
    docType: 'Transcripts',
    notes: bal !== null && bal !== undefined ? `Auto-imported. Balance: ${Number(bal).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 'Auto-imported.',
    file_url: storageUrl,
    storage_path: filePath,
    file_name: file.name,
    file_size: file.size,
    created_at: new Date().toISOString(),
  }])
  if (docErr) throw new Error(`Transcript analysis saved, but client filing failed: ${docErr.message}`)

  return data?.id || null
}
