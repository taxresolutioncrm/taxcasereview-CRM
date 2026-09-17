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
  chip: 'Direct',
  available: false,
  note: 'Pull the transcript directly into the CRM through the office’s approved IRS TDS API connection.',
}

export const PULL_PROVIDERS = [MANUAL_PROVIDER, DIRECT_PROVIDER]

export async function loadPullProviders() {
  try {
    const { data, error } = await supabase.functions.invoke('transcript-pull', { body: { action: 'capabilities' } })
    if (error) throw error
    const direct = Boolean(data?.directConfigured)
    return [MANUAL_PROVIDER, { ...DIRECT_PROVIDER, available: direct, chip: direct ? 'Connected' : 'Connection required' }]
  } catch {
    return [MANUAL_PROVIDER, { ...DIRECT_PROVIDER, available: false, chip: 'Connection required' }]
  }
}

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
  if (!text || text.trim().length < 40) {
    throw new Error('No text layer found — this looks like a scanned image, not a TDS download.')
  }
  return parseIrsTranscript(text)
}

export async function storeTranscriptAnalysis(file, clientName, a, existing = null) {
  const client = clientName.trim()
  if (!client) throw new Error('Client name is required before filing a transcript.')
  if (!file) throw new Error('Transcript PDF is required.')

  let clientId = null
  const { data: matches, error: clientErr } = await supabase.from('clients').select('id').eq('name', client).limit(2)
  if (!clientErr && matches?.length === 1) clientId = matches[0].id

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
