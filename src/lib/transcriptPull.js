import { supabase } from './supabase'
import { parseIrsTranscript, extractTranscriptText } from './irsTranscriptParser'

// Automated IRS API provider: optional, requires approved IRS API Client ID + verified product contract
// Do not infer that an IRS Web TDS / ID.me browser session is an automated API session.
const DIRECT_PROVIDER = {
  id: 'irs_a2a',
  label: 'IRS TDS — Automated API',
  chip: 'Not configured',
  available: false,
  sessionActive: false,
  note: 'Requires an approved IRS e-Services API Client ID and a verified product auth/request contract. Web TDS remains a separate practitioner login path.',
}

// Manual fallback: folder watcher
const MANUAL_PROVIDER = {
  id: 'manual',
  label: 'Manual — Folder Watcher',
  chip: 'Fallback',
  available: true,
  note: 'Watch a local folder where IRS TDS PDFs are saved; the CRM auto-imports, parses and files each PDF.',
}

export const PULL_PROVIDERS = [DIRECT_PROVIDER, MANUAL_PROVIDER]
const activeDirectPolls = new Set()

async function refreshProviderCapability() {
  // Direct IRS requests are available only when the approved API contract is configured and verified.
  try {
    const { data, error } = await supabase.functions.invoke('transcript-pull', { body: { action: 'capabilities' } })
    if (error) throw error
    DIRECT_PROVIDER.available = Boolean(data?.authorizationConfigured && data?.transcriptContractConfigured && data?.apiFlowVerified)
    DIRECT_PROVIDER.sessionActive = Boolean(data?.sessionActive)
    DIRECT_PROVIDER.chip = !DIRECT_PROVIDER.available
      ? 'API activation pending'
      : DIRECT_PROVIDER.sessionActive ? 'IRS API session active' : 'API connection required'
  } catch {
    DIRECT_PROVIDER.available = false
    DIRECT_PROVIDER.sessionActive = false
    DIRECT_PROVIDER.chip = 'Not configured'
  }
  return PULL_PROVIDERS.map(p => ({ ...p }))
}

export async function loadPullProviders() { return refreshProviderCapability() }

export function getProvider(id, providers = PULL_PROVIDERS) {
  return providers.find(p => p.id === id) || providers[0]
}

export async function submitToProvider(providerId, requestRow) {
  if (providerId === 'manual') return { status: 'Requested' }
  if (providerId !== 'irs_a2a') throw new Error('Unsupported transcript provider.')
  if (!requestRow?.id) throw new Error('Direct IRS TDS requires a saved pull request.')
  const { data, error } = await supabase.functions.invoke('transcript-pull', {
    body: { action: 'submit', requestId: requestRow.id },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  if (typeof window !== 'undefined') setTimeout(() => startDirectPolling(requestRow.id), 2000)
  return data
}

export async function checkDirectPull(requestId) {
  const { data, error } = await supabase.functions.invoke('transcript-pull', {
    body: { action: 'status', requestId },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

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

function typeKey(v) {
  let x = String(v || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (x === 'tax return transcript') x = 'return transcript'
  if (x === 'wage income') x = 'wage and income'
  if (x === 'wage income transcript') x = 'wage and income transcript'
  return x
}

function sameTranscriptType(a, b) {
  const x = typeKey(a), y = typeKey(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

export function requestCoverageSatisfied(req, rows) {
  const wantedYears = parseYearSpec(req?.tax_years)
  const wantedTypes = (req?.transcript_types || []).filter(Boolean)
  const have = rows || []
  if (wantedYears.size === 0 && wantedTypes.length === 0) return have.length > 0
  if (wantedYears.size > 0 && wantedTypes.length > 0) {
    return [...wantedYears].every(year => wantedTypes.every(type => have.some(r => String(r.tax_year || '') === year && sameTranscriptType(r.transcript_type, type))))
  }
  if (wantedYears.size > 0) return [...wantedYears].every(year => have.some(r => String(r.tax_year || '') === year))
  return wantedTypes.every(type => have.some(r => sameTranscriptType(r.transcript_type, type)))
}

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
  return cTok.every(w => w.length === 1 ? tTok.some(x => x[0] === w) : tTok.includes(w))
}

export async function parseTranscriptFile(file) {
  const text = await extractTranscriptText(file)
  if (!text || text.trim().length < 40) throw new Error('No text layer found — this looks like a scanned image, not a TDS download.')
  return parseIrsTranscript(text)
}

export async function storeTranscriptAnalysis(file, clientName, a, existing = null) {
  const clientNameInput = String(clientName || '').trim()
  if (!clientNameInput) throw new Error('Client name is required before filing a transcript.')
  if (!file) throw new Error('Transcript PDF is required.')

  const { data: tenantId, error: tenantErr } = await supabase.rpc('current_tenant_id')
  if (tenantErr || !tenantId) throw new Error(`Could not resolve office tenant: ${tenantErr?.message || 'No tenant returned'}`)

  let clientId = existing?.clientId || null
  let canonicalName = clientNameInput
  if (clientId) {
    const { data: row, error } = await supabase.from('clients').select('id,name').eq('tenant_id', tenantId).eq('id', clientId).maybeSingle()
    if (error || !row) throw new Error('The transcript client is no longer available in this office.')
    canonicalName = row.name || canonicalName
  } else {
    const { data: matches, error } = await supabase.from('clients').select('id,name').eq('tenant_id', tenantId).ilike('name', clientNameInput).limit(2)
    if (error) throw new Error(error.message)
    if ((matches || []).length !== 1) throw new Error((matches || []).length === 0
      ? `Could not resolve "${clientNameInput}" to one client in this office.`
      : `More than one client matches "${clientNameInput}". Select the exact client record.`)
    clientId = matches[0].id
    canonicalName = matches[0].name || canonicalName
  }

  const safeFile = String(file.name || 'transcript.pdf').replace(/[\\/\r\n]/g, '_').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 140) || 'transcript.pdf'
  const uploadedHere = !existing?.filePath
  const filePath = existing?.filePath || `transcripts/${clientId}/${crypto.randomUUID()}-${safeFile}`
  if (uploadedHere) {
    const { error: uploadErr } = await supabase.storage.from('documents').upload(filePath, file, { upsert: false })
    if (uploadErr) throw new Error(`Transcript PDF upload failed: ${uploadErr.message}`)
  }

  const durableUrl = `storage://documents/${filePath}`
  let analysisId = null
  try {
    const { data: analysis, error: analysisErr } = await supabase.from('transcript_analyses').insert({
      tenant_id: tenantId,
      client_id: clientId,
      client_name: canonicalName,
      tax_year: a.tax_year || null,
      transcript_type: a.transcript_type || null,
      total_balance: a.account_balance ?? null,
      accrued_penalty: a.accrued_penalty ?? null,
      accrued_interest: a.accrued_interest ?? null,
      assessment_date: a.assessment_date || null,
      csed_estimate: a.csed_estimate || null,
      flags: a.flags || {},
      raw_analysis: a,
      file_url: durableUrl,
      file_path: filePath,
    }).select('id').single()
    if (analysisErr || !analysis?.id) throw new Error(`Transcript analysis save failed: ${analysisErr?.message || 'No analysis ID returned'}`)
    analysisId = analysis.id

    const title = ['IRS', a.transcript_type || 'Transcript', a.tax_year || ''].filter(Boolean).join(' ')
    const bal = a.account_balance
    const { error: documentErr } = await supabase.from('documents').insert([{
      tenant_id: tenantId,
      name: title,
      client: canonicalName,
      clientname: canonicalName,
      client_id: clientId,
      docType: 'Transcripts',
      notes: bal !== null && bal !== undefined ? `Auto-imported. Balance: $${Number(bal).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 'Auto-imported.',
      file_url: durableUrl,
      storage_path: filePath,
      file_name: file.name,
      file_size: file.size,
      created_at: new Date().toISOString(),
    }])
    if (documentErr) throw new Error(`Client document filing failed: ${documentErr.message}`)
    return analysisId
  } catch (e) {
    if (analysisId) {
      try { await supabase.from('transcript_analyses').delete().eq('id', analysisId) } catch { /* best-effort rollback */ }
    }
    if (uploadedHere) {
      try { await supabase.storage.from('documents').remove([filePath]) } catch { /* best-effort rollback */ }
    }
    throw e
  }
}
async function finalizeDirectDelivery(req, result) {
  if (!result?.signedUrl || !result?.filePath || !result?.resultKey) throw new Error('IRS TDS delivered a transcript without a complete secure result reference.')
  const response = await fetch(result.signedUrl)
  if (!response.ok) throw new Error(`Could not download delivered IRS transcript (${response.status}).`)
  const blob = await response.blob()
  const file = new File([blob], `IRS-TDS-${req.id}-${result.resultKey.slice(0, 12)}.pdf`, { type: 'application/pdf' })
  const analysis = await parseTranscriptFile(file)
  const analysisId = await storeTranscriptAnalysis(file, req.client_name, analysis, { filePath: result.filePath, signedUrl: result.signedUrl, clientId: req.client_id || null })
  const ids = new Set(req.result_analysis_ids || [])
  ids.add(analysisId)
  const filedKeys = new Set(req.provider_filed_keys || [])
  filedKeys.add(result.resultKey)
  const idList = [...ids]
  const { data: coveredRows, error: coveredErr } = await supabase.from('transcript_analyses').select('id,tax_year,transcript_type').in('id', idList)
  if (coveredErr) throw new Error(coveredErr.message)
  const completed = requestCoverageSatisfied(req, coveredRows || [])
  const { error } = await supabase.from('transcript_pull_requests').update({
    result_analysis_ids: idList,
    provider_filed_keys: [...filedKeys],
    provider_status: completed ? 'Filed' : 'In Progress',
    provider_error: null,
    provider_last_checked_at: new Date().toISOString(),
    status: completed ? 'Completed' : 'In Progress',
    completed_at: completed ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', req.id)
  if (error) throw new Error(error.message)
  return completed
}

async function pollDirectOnce(requestId) {
  const { data: req, error } = await supabase.from('transcript_pull_requests').select('*').eq('id', requestId).maybeSingle()
  if (error) return false
  if (!req) return true
  if (req.status === 'Canceled' || ['Filed','Partial','Error'].includes(req.provider_status)) return true
  try {
    const result = await checkDirectPull(requestId)
    if (result?.status === 'Filed') return true
    if (result?.status === 'Delivered') return await finalizeDirectDelivery(req, result)
    if (result?.terminalError) {
      await supabase.from('transcript_pull_requests').update({
        provider_status: 'Error',
        provider_error: result?.remoteStatus || result?.status || 'IRS TDS request ended with an error.',
        provider_last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', requestId)
      return true
    }
    if (result?.terminal) {
      const ids = req.result_analysis_ids || []
      let rows = []
      if (ids.length) {
        const { data, error: coverageErr } = await supabase.from('transcript_analyses').select('id,tax_year,transcript_type').in('id', ids)
        if (coverageErr) throw coverageErr
        rows = data || []
      }
      const covered = requestCoverageSatisfied(req, rows)
      await supabase.from('transcript_pull_requests').update({
        provider_status: covered ? 'Filed' : 'Partial',
        provider_error: covered ? null : 'IRS completed the request, but some requested transcript coverage was not returned.',
        provider_last_checked_at: new Date().toISOString(),
        status: 'Completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', requestId)
      return true
    }
    return false
  } catch (e) {
    await supabase.from('transcript_pull_requests').update({ provider_error: e?.message || 'IRS TDS status check failed.', provider_last_checked_at: new Date().toISOString() }).eq('id', requestId)
    return false
  }
}

function startDirectPolling(requestId) {
  if (!requestId || activeDirectPolls.has(requestId) || typeof window === 'undefined') return
  activeDirectPolls.add(requestId)
  let timer = null
  const stop = () => {
    if (timer) clearInterval(timer)
    activeDirectPolls.delete(requestId)
  }
  let inFlight = false
  const run = async () => {
    if (inFlight) return
    inFlight = true
    try { if (await pollDirectOnce(requestId)) stop() } finally { inFlight = false }
  }
  timer = setInterval(run, 30000)
  run()
}

async function resumeDirectPulls() {
  try {
    const { data } = await supabase.from('transcript_pull_requests')
      .select('id')
      .eq('provider', 'irs_a2a')
      .not('provider_request_id', 'is', null)
      .or('provider_status.neq.Filed,status.neq.Completed')
    for (const row of data || []) startDirectPolling(row.id)
  } catch { /* page can still use the manual path */ }
}

if (typeof window !== 'undefined') {
  setTimeout(() => refreshProviderCapability(), 0)
  setTimeout(() => resumeDirectPulls(), 2000)
}
