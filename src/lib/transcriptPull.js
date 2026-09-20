import { supabase } from './supabase'
import { parseIrsTranscript, extractPdfText } from './irsTranscriptParser'

const MANUAL_PROVIDER = {
  id: 'manual',
  label: 'Manual — IRS e-Services (TDS)',
  chip: 'Fallback',
  available: true,
  note: 'Manual fallback: pull from IRS TDS and let the CRM auto-import, parse and file the downloaded PDF.',
}

const DIRECT_PROVIDER = {
  id: 'irs_a2a',
  label: 'IRS TDS Direct',
  chip: 'Connection required',
  available: false,
  note: 'Pull the transcript directly into the CRM through the office’s approved IRS TDS API connection.',
}

export const PULL_PROVIDERS = [MANUAL_PROVIDER, DIRECT_PROVIDER]
const activeDirectPolls = new Set()

async function refreshProviderCapability() {
  try {
    const { data, error } = await supabase.functions.invoke('transcript-pull', { body: { action: 'capabilities' } })
    if (error) throw error
    DIRECT_PROVIDER.available = Boolean(data?.directConfigured)
    DIRECT_PROVIDER.chip = DIRECT_PROVIDER.available ? 'Connected' : 'Connection required'
  } catch {
    DIRECT_PROVIDER.available = false
    DIRECT_PROVIDER.chip = 'Connection required'
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
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
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
  const text = await extractPdfText(file)
  if (!text || text.trim().length < 40) throw new Error('No text layer found — this looks like a scanned image, not a TDS download.')
  return parseIrsTranscript(text)
}

export async function storeTranscriptAnalysis(file, clientName, a, existing = null, explicitClientId = null) {
  const client = clientName.trim()
  if (!client) throw new Error('Client name is required before filing a transcript.')
  if (!file) throw new Error('Transcript PDF is required.')
  let clientId = explicitClientId || null
  if (!clientId) {
    const { data: matches, error: clientErr } = await supabase.from('clients').select('id').eq('name', client).limit(2)
    if (clientErr) throw new Error(`Could not resolve transcript client: ${clientErr.message}`)
    if (!matches || matches.length !== 1) throw new Error('Transcript filing requires one stable client record. Select the client by record before filing.')
    clientId = matches[0].id
  }
  const safeClient = client.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 100) || 'client'
  const safeFile = String(file.name || 'transcript.pdf').replace(/[\\/\r\n]/g, '_').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 140) || 'transcript.pdf'
  const uploadedHere = !existing?.filePath
  const filePath = existing?.filePath || `transcripts/${safeClient}/${crypto.randomUUID()}-${safeFile}`
  if (uploadedHere) {
    const { error: uploadErr } = await supabase.storage.from('documents').upload(filePath, file, { upsert: false })
    if (uploadErr) throw new Error(`Transcript PDF upload failed: ${uploadErr.message}`)
  }
  let analysisId = null
  try {
    let fileUrl = existing?.signedUrl || null
    if (!fileUrl) {
      const { data: signed, error: signErr } = await supabase.storage.from('documents').createSignedUrl(filePath, 900)
      if (signErr || !signed?.signedUrl) throw new Error(`Secure transcript link failed: ${signErr?.message || 'No signed URL returned'}`)
      fileUrl = signed.signedUrl
    }
    const { data: analysis, error: analysisErr } = await supabase.from('transcript_analyses').insert({
      client_name: client,
      client_id: clientId,
      tax_year: a.tax_year || null,
      transcript_type: a.transcript_type || null,
      total_balance: a.account_balance ?? null,
      accrued_penalty: a.accrued_penalty ?? null,
      accrued_interest: a.accrued_interest ?? null,
      assessment_date: a.assessment_date || null,
      csed_estimate: a.csed_estimate || null,
      flags: a.flags || {},
      raw_analysis: a,
      file_url: fileUrl,
      file_path: filePath,
    }).select('id').single()
    if (analysisErr || !analysis?.id) throw new Error(`Transcript analysis save failed: ${analysisErr?.message || 'No analysis ID returned'}`)
    analysisId = analysis.id
    const title = ['IRS', a.transcript_type || 'Transcript', a.tax_year || ''].filter(Boolean).join(' ')
    const bal = a.account_balance
    const { error: documentErr } = await supabase.from('documents').insert([{
      name: title,
      client,
      client_id: clientId,
      docType: 'Transcripts',
      notes: bal !== null && bal !== undefined ? `Auto-imported. Balance: $${Number(bal).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 'Auto-imported.',
      file_url: fileUrl,
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
  const analysisId = await storeTranscriptAnalysis(file, req.client_name, analysis, { filePath: result.filePath, signedUrl: result.signedUrl }, req.client_id || null)
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
  if (req.status === 'Canceled' || (req.provider_status === 'Filed' && req.status === 'Completed')) return true
  try {
    const result = await checkDirectPull(requestId)
    if (result?.status === 'Filed') return true
    if (result?.status === 'Delivered') return await finalizeDirectDelivery(req, result)
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
  const run = async () => { if (await pollDirectOnce(requestId)) stop() }
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
