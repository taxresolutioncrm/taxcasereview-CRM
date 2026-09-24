import { supabase } from './supabase'
import { parseIrsTranscript, extractPdfText } from './irsTranscriptParser'

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

// Interactive practitioner path: always available; practitioner logs in to IRS TDS directly
const INTERACTIVE_PROVIDER = {
  id: 'irs_interactive',
  label: 'Practitioner IRS / ID.me TDS',
  chip: 'Available',
  available: true,
  note: 'Practitioner signs in to the IRS Transcript Delivery System using their IRS / ID.me credentials. This path is always available and independent of the automated API integration.',
}

// Manual fallback: folder watcher
const MANUAL_PROVIDER = {
  id: 'manual',
  label: 'Manual — Folder Watcher',
  chip: 'Fallback',
  available: true,
  note: 'Watch a local folder where IRS TDS PDFs are saved; the CRM auto-imports, parses and files each PDF.',
}

export const PULL_PROVIDERS = [DIRECT_PROVIDER, INTERACTIVE_PROVIDER, MANUAL_PROVIDER]
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
  if (providerId === 'manual' || providerId === 'irs_interactive') return { status: 'Requested' }
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
  const text = await extractPdfText(file)
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


// ── Browser-assisted IRS TDS ────────────────────────────────────────────
// The practitioner signs in to the normal IRS / ID.me TDS site in their own browser tab and
// requests transcripts there. The CRM never sees, stores or relays IRS/ID.me credentials,
// cookies or tokens: it only opens the public IRS page and later receives the transcript
// PDFs the practitioner saved (watched folder or drop/upload), then files and analyzes them.
export const BROWSER_PROVIDER_ID = 'irs_browser'
export const IRS_TDS_URL = 'https://la.www4.irs.gov/esrv/tds/'
export const IRS_SOR_URL = 'https://la.www4.irs.gov/semail/views/list_mail'

export function openIrsTds(url = IRS_TDS_URL) {
  // noopener/noreferrer: the IRS tab and the CRM tab cannot reach each other.
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
}

// Open an empty tab inside the click (so the browser does not block it). It is only sent to the
// IRS after the CRM request is saved. The link back to the CRM is cut immediately.
export function openPendingIrsTab() {
  if (typeof window === 'undefined') return null
  const tab = window.open('', '_blank')
  if (!tab) return null
  try { tab.opener = null } catch { /* already isolated */ }
  try { tab.document.title = 'Saving request…'; tab.document.body.textContent = 'Saving your transcript request in the CRM…' } catch { /* cross-origin */ }
  return tab
}

// Send the waiting tab to the IRS. The redirect is issued from inside that tab with a
// no-referrer policy, so the IRS page receives no CRM address and no link back to the CRM.
export function navigatePendingIrsTab(tab, url = IRS_TDS_URL) {
  if (!tab || tab.closed) { openIrsTds(url); return }
  try {
    const safe = String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    tab.document.open()
    tab.document.write(`<!doctype html><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${safe}"><title>Opening IRS TDS…</title>`)
    tab.document.close()
  } catch {
    tab.location.replace(url)
  }
}

export function closePendingIrsTab(tab) {
  try { if (tab && !tab.closed) tab.close() } catch { /* noop */ }
}

// Save the pending request first; the IRS tab is navigated only after the insert succeeds.
export async function startBrowserTdsRequest(row, tab) {
  try {
    const { error } = await supabase.from('transcript_pull_requests').insert([row])
    if (error) throw new Error(error.message)
  } catch (e) {
    closePendingIrsTab(tab)
    throw e
  }
  navigatePendingIrsTab(tab, IRS_TDS_URL)
}

export function isOpenBrowserRequest(r) {
  return r?.provider === BROWSER_PROVIDER_ID && (r.status === 'Requested' || r.status === 'In Progress')
}

export async function sha256File(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function tinLast4(text) {
  const m = String(text || '').match(/(?:Taxpayer Identification Number|SSN\/EIN|SSN|EIN|TIN)\s*(?:provided)?\s*:?\s*[X*\d]{3}[- ]?[X*\d]{2}[- ]?(\d{4})\b|(?:Taxpayer Identification Number|EIN)\s*:?\s*[X*\d]{2}-?[X*\d]{3}(\d{4})\b/i)
  return m ? (m[1] || m[2]) : null
}

// Read a returned PDF once: text layer → parsed analysis + masked-TIN last 4 for matching.
export async function analyzeReturnedTranscript(file) {
  const text = await extractPdfText(file)
  if (!text || text.trim().length < 40) throw new Error('No text layer found — this looks like a scanned image, not a TDS download.')
  return { analysis: parseIrsTranscript(text), tinLast4: tinLast4(text) }
}

// Why a parsed transcript does not belong to this pending request (null = it belongs).
export function browserMatchProblem(req, clientTinLast4, parsed) {
  const a = parsed?.analysis || {}
  // Automatic filing needs a positive taxpayer match — never year/type alone.
  if (!clientTinLast4) return 'client has no SSN/EIN on file to match against — file this PDF manually'
  if (!parsed?.tinLast4) return 'no readable taxpayer SSN/EIN on this PDF — file it manually'
  if (parsed.tinLast4 !== clientTinLast4) return `TIN ending ${parsed.tinLast4} is not this client`
  const years = parseYearSpec(req?.tax_years)
  if (years.size && a.tax_year && !years.has(String(a.tax_year))) return `tax year ${a.tax_year} was not requested`
  const types = (req?.transcript_types || []).filter(Boolean)
  if (types.length && a.transcript_type && a.transcript_type !== 'Other' && !types.some(t => sameTranscriptType(a.transcript_type, t))) return `${a.transcript_type} was not requested`
  return null
}

async function clientTinLast4(clientId) {
  if (!clientId) return null
  const { data } = await supabase.from('clients').select('ssn,ein').eq('id', clientId).maybeSingle()
  const digits = String(data?.ein || data?.ssn || '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}

// One filing at a time per browser tab, so a folder scan and a drop can never file the same PDF twice.
let browserFilingQueue = Promise.resolve()

// File returned IRS PDFs against one pending browser request. Returns per-file results.
export function fileBrowserTranscripts(requestId, files) {
  const job = browserFilingQueue.then(() => fileBrowserTranscriptsNow(requestId, files))
  browserFilingQueue = job.catch(() => {})
  return job
}

async function fileBrowserTranscriptsNow(requestId, files) {
  const { data: req, error } = await supabase.from('transcript_pull_requests').select('*').eq('id', requestId).maybeSingle()
  if (error || !req) throw new Error('Transcript request not found in this office.')
  if (req.provider !== BROWSER_PROVIDER_ID) throw new Error('This request is not an IRS TDS browser request.')
  const clientLast4 = await clientTinLast4(req.client_id)
  const ids = new Set(req.result_analysis_ids || [])
  const filedKeys = new Set(req.provider_filed_keys || [])
  const results = []
  for (const file of files) {
    const name = file?.name || 'transcript.pdf'
    try {
      const key = await sha256File(file)
      if (filedKeys.has(key)) { results.push({ file: name, status: 'duplicate' }); continue }
      const { data: prior } = await supabase.from('transcript_analyses').select('id').eq('client_id', req.client_id).eq('raw_analysis->>file_sha256', key).limit(1)
      if (prior?.length) { filedKeys.add(key); results.push({ file: name, status: 'duplicate' }); continue }
      const parsed = await analyzeReturnedTranscript(file)
      const problem = browserMatchProblem(req, clientLast4, parsed)
      if (problem) { results.push({ file: name, status: 'rejected', reason: problem }); continue }
      const analysisId = await storeTranscriptAnalysis(file, req.client_name, { ...parsed.analysis, file_sha256: key }, { clientId: req.client_id || null })
      ids.add(analysisId); filedKeys.add(key)
      results.push({ file: name, status: 'filed', year: parsed.analysis.tax_year, type: parsed.analysis.transcript_type })
    } catch (e) {
      results.push({ file: name, status: 'error', reason: e?.message || 'Could not file this PDF.' })
    }
  }
  const idList = [...ids]
  let covered = false
  if (idList.length) {
    const { data: rows, error: rowsErr } = await supabase.from('transcript_analyses').select('id,tax_year,transcript_type').in('id', idList)
    if (rowsErr) throw new Error(rowsErr.message)
    covered = requestCoverageSatisfied(req, rows || [])
  }
  const { error: upErr } = await supabase.from('transcript_pull_requests').update({
    result_analysis_ids: idList,
    provider_filed_keys: [...filedKeys],
    provider_status: covered ? 'Filed' : idList.length ? 'Partially filed' : 'Awaiting IRS files',
    status: covered ? 'Completed' : 'In Progress',
    completed_at: covered ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', requestId)
  if (upErr) throw new Error(upErr.message)
  return { results, completed: covered, filedCount: idList.length }
}

// Pick the one open browser request a returned PDF belongs to (by client TIN + requested year/type).
export async function matchBrowserRequest(openRequests, parsed) {
  const candidates = []
  for (const r of openRequests.filter(isOpenBrowserRequest)) {
    const last4 = await clientTinLast4(r.client_id)
    if (!parsed.tinLast4 || !last4 || parsed.tinLast4 !== last4) continue
    if (!browserMatchProblem(r, last4, parsed)) candidates.push(r)
  }
  return candidates.length === 1 ? candidates[0] : null
}

// Remember the watched folder between visits (the handle stays in this browser only).
const HANDLE_DB = 'taxres-tds-folder', HANDLE_STORE = 'handles'
function handleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
export async function saveWatchedFolder(handle) {
  try { const db = await handleDb(); await new Promise((res, rej) => { const tx = db.transaction(HANDLE_STORE, 'readwrite'); tx.objectStore(HANDLE_STORE).put(handle, 'tds'); tx.oncomplete = res; tx.onerror = () => rej(tx.error) }) } catch { /* optional convenience */ }
}
export async function loadWatchedFolder() {
  try { const db = await handleDb(); return await new Promise(res => { const tx = db.transaction(HANDLE_STORE, 'readonly'); const g = tx.objectStore(HANDLE_STORE).get('tds'); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null) }) } catch { return null }
}
export async function forgetWatchedFolder() {
  try { const db = await handleDb(); const tx = db.transaction(HANDLE_STORE, 'readwrite'); tx.objectStore(HANDLE_STORE).delete('tds') } catch { /* noop */ }
}

