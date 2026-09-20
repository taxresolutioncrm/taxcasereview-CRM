import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import TDSSessionPresence from './TDSSessionPresence'
import {
  PULL_PROVIDERS, loadPullProviders, getProvider, submitToProvider,
  parseYearSpec, nameKey, namesMatch, requestCoverageSatisfied,
  parseTranscriptFile, storeTranscriptAnalysis,
} from '../lib/transcriptPull'

const REQ_STATUSES = ['Requested', 'In Progress', 'Completed', 'Canceled']
const REQ_COLORS = { Requested: '#2563eb', 'In Progress': '#b45309', Completed: '#15803d', Canceled: '#64748b' }
const TRANSCRIPT_TYPES = ['Account Transcript', 'Wage and Income', 'Record of Account', 'Return Transcript', 'Verification of Non-Filing']
const BLANK = { clientName: '', types: ['Account Transcript', 'Wage and Income'], taxYears: '', provider: 'irs_a2a', notes: '' }

export default function TranscriptPull({ clientNames = [], clients = [], poas = [], onGoToPoa, onImported }) {
  const { employeeName } = useApp()
  const [providers, setProviders] = useState(PULL_PROVIDERS.map(p => ({ ...p })))
  const [requests, setRequests] = useState([])
  const [legacyCount, setLegacyCount] = useState(0)
  const [migrating, setMigrating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [retryingId, setRetryingId] = useState(null)
  const [delId, setDelId] = useState(null)
  const [msg, setMsg] = useState('')
  const [fallbackOpen, setFallbackOpen] = useState(false)

  const dirRef = useRef(null)
  const seenRef = useRef(new Set())
  const scanBusyRef = useRef(false)
  const [dirName, setDirName] = useState('')
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState(null)
  const [imported, setImported] = useState([])
  const [unmatched, setUnmatched] = useState([])
  const fsSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  function flash(t) { setMsg(t); setTimeout(() => setMsg(''), 6000) }
  function ff(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function refreshProviders() {
    const next = await loadPullProviders()
    setProviders(next)
    return next
  }

  useEffect(() => {
    let alive = true
    loadPullProviders().then(next => { if (alive) setProviders(next) }).catch(() => {})
    return () => { alive = false }
  }, [])

  async function loadRequests() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('transcript_pull_requests').select('*').order('requested_at', { ascending: false })
      if (error) throw new Error(error.message)
      setRequests(data || [])
    } catch (e) {
      setRequests([])
      flash('❌ Could not load pull requests: ' + (e?.message || 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadRequests() }, [])

  useEffect(() => {
    const hasLiveDirect = requests.some(r => r.provider === 'irs_a2a' && r.status !== 'Completed' && r.status !== 'Canceled')
    if (!hasLiveDirect) return undefined
    const t = setInterval(loadRequests, 30000)
    return () => clearInterval(t)
  }, [requests])

  useEffect(() => {
    (async () => {
      const { count, error } = await supabase.from('transcripts').select('id', { count: 'exact', head: true }).not('migrated_to_pull', 'is', true)
      if (error) throw error
      setLegacyCount(count || 0)
    })().catch(() => setLegacyCount(0))
  }, [])

  async function migrateLegacy() {
    setMigrating(true)
    try {
      const { data: old, error } = await supabase.from('transcripts').select('*').or('migrated_to_pull.is.null,migrated_to_pull.eq.false')
      if (error) throw new Error(error.message)
      const rows = old || []
      let done = 0
      for (const t of rows) {
        const received = (t.status || '').includes('Received')
        const years = t.taxYears || t.taxyears || null
        const legacyType = t.type || t.transcriptType || null
        const marker = `[Migrated from Transcripts tab:${t.id}]`
        const { data: existing, error: findErr } = await supabase.from('transcript_pull_requests').select('id').like('notes', `${marker}%`).limit(1)
        if (findErr) throw new Error(`Could not check migration state for ${t.id}: ${findErr.message}`)
        if (!existing?.length) {
          const payload = {
            client_name: t.clientname || t.clientName || 'Unknown',
            transcript_types: legacyType ? [legacyType] : [],
            tax_years: years,
            provider: 'manual',
            status: received ? 'Completed' : ((t.status || '').includes('Error') || t.status === 'On Hold') ? 'Canceled' : 'In Progress',
            poa_record_id: null,
            requested_by: null,
            notes: `${marker} ${t.notes || ''}`.trim(),
            requested_at: t.requesteddate || t.requestDate || t.created_at || new Date().toISOString(),
            completed_at: null,
          }
          const { error: insErr } = await supabase.from('transcript_pull_requests').insert([payload])
          if (insErr) throw new Error(`Could not migrate ${t.id}: ${insErr.message}`)
        }
        const { error: markErr } = await supabase.from('transcripts').update({ migrated_to_pull: true }).eq('id', t.id)
        if (markErr) throw new Error(`Migrated ${t.id} but could not mark the legacy row: ${markErr.message}`)
        done++
      }
      setLegacyCount(0)
      await loadRequests()
      flash(`✅ Migrated ${done} request${done === 1 ? '' : 's'} from the old Transcripts tab. Originals kept, marked migrated.`)
    } catch (e) {
      flash('❌ Migration failed: ' + (e?.message || 'Unknown error'))
    } finally {
      setMigrating(false)
    }
  }

  function uniqueClientForName(clientName) {
    const key = nameKey(clientName)
    if (!key) return null
    const matches = clients.filter(c => nameKey(c.name) === key)
    return matches.length === 1 ? matches[0] : null
  }

  function poaOnFile(clientName) {
    const client = uniqueClientForName(clientName)
    if (client) {
      const byId = poas.find(p => p.status === 'On File' && p.client_id && String(p.client_id) === String(client.id))
      if (byId) return byId
    }
    return poas.find(p => p.status === 'On File' && nameKey(p.client_name) === nameKey(clientName))
  }
  const formClient = uniqueClientForName(form.clientName)
  const formPoa = poaOnFile(form.clientName)
  const formProvider = getProvider(form.provider, providers)
  const directNeedsSignIn = form.provider === 'irs_a2a' && formProvider?.available && !formProvider?.sessionActive

  function openNewRequest() {
    const direct = providers.find(p => p.id === 'irs_a2a' && p.available)
    setForm({ ...BLANK, provider: direct ? 'irs_a2a' : 'manual' })
    setModal(true)
  }

  async function createRequest() {
    if (!form.clientName.trim() || form.types.length === 0) return
    const client = uniqueClientForName(form.clientName)
    const poa = poaOnFile(form.clientName)
    const provider = getProvider(form.provider, providers)
    if (!client || !poa || !provider?.available) return
    if (form.provider === 'irs_a2a' && !provider.sessionActive) {
      flash('⚠ Sign in to the IRS first, then request transcripts.')
      return
    }
    setSaving(true)
    let saved = false
    try {
      const row = {
        id: crypto.randomUUID(),
        client_name: client.name,
        client_id: client.id,
        transcript_types: form.types,
        tax_years: form.taxYears.trim() || null,
        provider: form.provider,
        status: 'Requested',
        poa_record_id: poa.id,
        requested_by: employeeName || null,
        notes: form.notes || null,
      }
      const { error } = await supabase.from('transcript_pull_requests').insert([row])
      if (error) throw new Error(error.message)
      saved = true
      await submitToProvider(form.provider, row)
      setModal(false)
      setForm(BLANK)
      await loadRequests()
      flash(form.provider === 'irs_a2a' ? '✅ IRS TDS pull submitted. The CRM will retrieve and file delivered transcripts automatically.' : '✅ Manual TDS pull request created. The watched folder will file downloaded transcripts automatically.')
    } catch (e) {
      if (saved) {
        setModal(false)
        setForm(BLANK)
        await loadRequests()
        flash('⚠ Pull request was saved, but IRS TDS submission failed: ' + (e?.message || 'Unknown error') + '. Use Retry on the saved request after the connection issue is corrected.')
      } else {
        flash('❌ ' + (e?.message || 'Could not create pull request.'))
      }
    } finally {
      setSaving(false)
    }
  }

  async function retryDirect(req) {
    setRetryingId(req.id)
    try {
      const next = await refreshProviders()
      const direct = getProvider('irs_a2a', next)
      if (!direct?.available) throw new Error('IRS TDS ISP connection is not configured.')
      if (!direct.sessionActive) throw new Error('Sign in to the IRS first, then retry this request.')
      await submitToProvider('irs_a2a', req)
      await loadRequests()
      flash('✅ IRS TDS pull resubmitted.')
    } catch (e) {
      await loadRequests()
      flash('❌ IRS TDS retry failed: ' + (e?.message || 'Unknown error'))
    } finally {
      setRetryingId(null)
    }
  }

  async function setStatus(id, status) {
    try {
      const patch = {
        status,
        updated_at: new Date().toISOString(),
        completed_at: status === 'Completed' ? new Date().toISOString() : null,
      }
      const { error } = await supabase.from('transcript_pull_requests').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
      await loadRequests()
    } catch (e) {
      flash('❌ Could not update pull request: ' + (e?.message || 'Unknown error'))
    }
  }

  async function deleteRequest(id) {
    try {
      const { error } = await supabase.from('transcript_pull_requests').delete().eq('id', id)
      if (error) throw new Error(error.message)
      setDelId(null)
      await loadRequests()
    } catch (e) {
      flash('❌ Could not delete pull request: ' + (e?.message || 'Unknown error'))
    }
  }

  async function refreshCoverage(req, justAddedId) {
    const existingIds = new Set(req.result_analysis_ids || [])
    if (justAddedId) existingIds.add(justAddedId)
    const idList = [...existingIds]
    const patch = {
      updated_at: new Date().toISOString(),
      result_analysis_ids: idList,
    }
    let rows = []
    if (idList.length) {
      const { data, error } = await supabase.from('transcript_analyses')
        .select('id,tax_year,transcript_type')
        .in('id', idList)
      if (error) throw new Error(`Could not verify transcript coverage: ${error.message}`)
      rows = data || []
    }
    const done = requestCoverageSatisfied(req, rows)
    patch.status = done ? 'Completed' : 'In Progress'
    patch.completed_at = done ? new Date().toISOString() : null
    const { error: updateErr } = await supabase.from('transcript_pull_requests').update(patch).eq('id', req.id)
    if (updateErr) throw new Error(`Could not update pull request coverage: ${updateErr.message}`)
  }

  async function connectFolder() {
    try {
      const handle = await window.showDirectoryPicker({ id: 'tds-downloads', mode: 'read' })
      dirRef.current = handle
      setDirName(handle.name)
      await scanFolder(true)
    } catch (e) {
      if (e?.name !== 'AbortError') flash('❌ Could not connect TDS download folder: ' + (e?.message || 'Unknown error'))
    }
  }

  function disconnectFolder() {
    dirRef.current = null
    setDirName('')
  }

  async function routeAnalysis(file, a, key) {
    const tp = a.taxpayer_name || ''
    const open = requests.filter(r => r.status === 'Requested' || r.status === 'In Progress')
    const req = open.find(r => namesMatch(tp, r.client_name))
    if (req) {
      const id = await storeTranscriptAnalysis(file, req.client_name, a, { clientId: req.client_id || null })
      seenRef.current.add(key)
      setUnmatched(u => u.filter(x => x.key !== key))
      setImported(im => [...im, { file: file.name, client: req.client_name, year: a.tax_year, type: a.transcript_type }])
      try {
        await refreshCoverage(req, id)
      } catch (e) {
        flash(`⚠ ${file.name} was filed, but its pull-request status could not update: ${e?.message || 'Unknown error'}`)
      }
      return true
    }
    const client = clientNames.find(c => namesMatch(tp, c))
    if (client) {
      await storeTranscriptAnalysis(file, client, a)
      seenRef.current.add(key)
      setUnmatched(u => u.filter(x => x.key !== key))
      setImported(im => [...im, { file: file.name, client, year: a.tax_year, type: a.transcript_type }])
      return true
    }
    setUnmatched(u => [...u.filter(x => x.key !== key), { key, fileName: file.name, file, analysis: a, assignTo: '' }])
    return false
  }

  async function scanFolder(manual = false) {
    const handle = dirRef.current
    if (!handle || scanBusyRef.current) return
    scanBusyRef.current = true
    setScanning(true)
    let found = 0, filed = 0
    try {
      for await (const entry of handle.values()) {
        if (entry.kind !== 'file' || !/\.pdf$/i.test(entry.name)) continue
        const file = await entry.getFile()
        const key = `${entry.name}:${file.size}:${file.lastModified}`
        if (seenRef.current.has(key)) continue
        found++
        try {
          const a = await parseTranscriptFile(file)
          if (await routeAnalysis(file, a, key)) filed++
          else seenRef.current.add(key)
        } catch (err) {
          setUnmatched(u => [...u.filter(x => x.key !== key), { key, fileName: entry.name, file, analysis: null, error: err?.message || 'Import failed', assignTo: '' }])
        }
      }
      setLastScan(new Date())
      await loadRequests()
      if (onImported && filed > 0) onImported()
      if (manual) flash(found === 0 ? 'Scan complete — no new PDFs in the folder.' : `✅ Scan complete — ${filed} of ${found} new PDF${found === 1 ? '' : 's'} filed automatically.`)
    } catch (e) {
      flash('❌ Folder scan failed: ' + (e?.message || 'Unknown error'))
    } finally {
      scanBusyRef.current = false
      setScanning(false)
    }
  }

  useEffect(() => {
    const t = setInterval(() => { if (dirRef.current) scanFolder(false) }, 30000)
    return () => clearInterval(t)
  }, [requests, clientNames])

  async function assignUnmatched(item) {
    if (!item.assignTo.trim() || !item.analysis) return
    try {
      const id = await storeTranscriptAnalysis(item.file, item.assignTo.trim(), item.analysis)
      seenRef.current.add(item.key)
      setUnmatched(u => u.filter(x => x.key !== item.key))
      setImported(im => [...im, { file: item.fileName, client: item.assignTo.trim(), year: item.analysis.tax_year, type: item.analysis.transcript_type }])
      const open = requests.filter(r => (r.status === 'Requested' || r.status === 'In Progress') && nameKey(r.client_name) === nameKey(item.assignTo))
      if (open[0]) {
        try {
          await refreshCoverage(open[0], id)
        } catch (e) {
          flash(`⚠ ${item.fileName} was filed, but its pull-request status could not update: ${e?.message || 'Unknown error'}`)
        }
      }
      await loadRequests()
      if (onImported) onImported()
    } catch (e) {
      flash('❌ ' + (e?.message || 'Could not file transcript.'))
    }
  }

  const importedCount = (r) => (r.result_analysis_ids || []).length
  const inputStyle = { width: '100%', boxSizing: 'border-box' }
  const direct = getProvider('irs_a2a', providers)
  const canRequest = Boolean(formClient && formPoa && direct?.available && direct?.sessionActive && form.types.length > 0 && form.taxYears.trim())

  async function submitCanopyStyleRequest() {
    ff('provider', 'irs_a2a')
    const nextForm = { ...form, provider: 'irs_a2a' }
    if (!nextForm.clientName.trim() || nextForm.types.length === 0 || !nextForm.taxYears.trim()) return
    const client = uniqueClientForName(nextForm.clientName)
    const poa = poaOnFile(nextForm.clientName)
    if (!client || !poa || !direct?.available || !direct?.sessionActive) return
    setSaving(true)
    let saved = false
    try {
      const row = {
        id: crypto.randomUUID(),
        client_name: client.name,
        client_id: client.id,
        transcript_types: nextForm.types,
        tax_years: nextForm.taxYears.trim(),
        provider: 'irs_a2a',
        status: 'Requested',
        poa_record_id: poa.id,
        requested_by: employeeName || null,
        notes: nextForm.notes || null,
      }
      const { error } = await supabase.from('transcript_pull_requests').insert([row])
      if (error) throw new Error(error.message)
      saved = true
      await submitToProvider('irs_a2a', row)
      setForm(BLANK)
      await loadRequests()
      flash('✅ Transcript request sent to IRS. Returned PDFs will be filed to this client automatically.')
    } catch (e) {
      if (saved) {
        await loadRequests()
        flash('⚠ Request saved, but IRS submission failed: ' + (e?.message || 'Unknown error') + '.')
      } else {
        flash('❌ ' + (e?.message || 'Could not request transcripts.'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>IRS Transcript Delivery</div>
            <div style={{ color: 'var(--t3)', fontSize: 11.5, marginTop: 4 }}>
              Sign in once, choose the client, years and transcript types, then request. Returned IRS PDFs are filed to that client automatically and analyzed in the CRM.
            </div>
          </div>
          <span style={{ background: direct?.sessionActive ? '#15803d' : '#64748b', color: '#fff', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 700 }}>
            {direct?.sessionActive ? 'IRS session active' : 'IRS sign-in required'}
          </span>
        </div>

        <div style={{ padding: 18 }}>
          <TDSSessionPresence />

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1.4fr) minmax(180px,.8fr)', gap: 12, alignItems: 'start' }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--t3)' }}>Client</label>
              <input list="irsportal-clients" value={form.clientName} onChange={e => ff('clientName', e.target.value)} style={inputStyle} placeholder="Search or select client" />
              {form.clientName.trim() && (!formClient ? (
                <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 5 }}>Select one exact client record.</div>
              ) : formPoa ? (
                <div style={{ fontSize: 11.5, color: '#15803d', marginTop: 5 }}>POA on file · Form {formPoa.form_type}{formPoa.tax_years ? ` · ${formPoa.tax_years}` : ''}</div>
              ) : (
                <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 5 }}>
                  POA must be On File before requesting transcripts.{' '}
                  <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => onGoToPoa && onGoToPoa()}>Open POA / CAF Tracker</span>
                </div>
              ))}
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--t3)' }}>Tax Years</label>
              <input value={form.taxYears} onChange={e => ff('taxYears', e.target.value)} style={inputStyle} placeholder="2019-2024" />
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 11, color: 'var(--t3)' }}>Transcript Types</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
              {TRANSCRIPT_TYPES.map(t => {
                const checked = form.types.includes(t)
                return (
                  <label key={t} style={{
                    border: '1px solid var(--line)', borderRadius: 8, padding: '7px 9px', cursor: 'pointer',
                    background: checked ? 'rgba(37,99,235,.16)' : 'var(--s1)', fontSize: 11.5, fontWeight: checked ? 700 : 500
                  }}>
                    <input type="checkbox" checked={checked} onChange={e => ff('types', e.target.checked ? [...form.types, t] : form.types.filter(x => x !== t))} style={{ marginRight: 6 }} />
                    {t}
                  </label>
                )
              })}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 11, color: 'var(--t3)' }}>Notes <span style={{ color: 'var(--t3)' }}>(optional)</span></label>
            <textarea value={form.notes} onChange={e => ff('notes', e.target.value)} rows={2} style={inputStyle} placeholder="Internal note for this request" />
          </div>

          {!direct?.available && (
            <div style={{ marginTop: 12, color: '#b45309', fontSize: 11.5 }}>
              IRS direct connection is not configured yet. The request controls remain here so the workflow does not change when the connection is enabled.
            </div>
          )}
          {direct?.available && !direct?.sessionActive && (
            <div style={{ marginTop: 12, color: 'var(--t3)', fontSize: 11.5 }}>Sign in to IRS above to enable transcript requests for the one-hour session.</div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
            <div style={{ color: 'var(--t3)', fontSize: 11.5 }}>
              {formClient ? `Files will attach to: ${formClient.name}` : 'Returned PDFs attach to the selected client file automatically.'}
              {msg && <span style={{ marginLeft: 10, color: 'var(--t2)' }}>{msg}</span>}
            </div>
            <button className="btn" disabled={saving || !canRequest} onClick={submitCanopyStyleRequest}>
              {saving ? 'Requesting…' : 'Request Transcripts'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Transcript Requests</div>
          <button className="btn sec" style={{ fontSize: 10.5, padding: '4px 9px' }} onClick={() => loadRequests()}>Refresh</button>
        </div>
        {loading ? <div style={{ color: 'var(--t3)', fontSize: 13 }}>Loading…</div> :
          requests.length === 0 ? (
            <div style={{ color: 'var(--t3)', fontSize: 12.5, padding: '12px 0' }}>No transcript requests yet.</div>
          ) : (
            <div style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--t3)', textAlign: 'left' }}>
                    {['Client', 'Types', 'Years', 'Status', 'Filed', 'Requested', ''].map(h => <th key={h} style={{ padding: '8px 12px', fontWeight: 600 }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {requests.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 700 }}>{r.client_name}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--t2)', fontSize: 11 }}>{(r.transcript_types || []).join(', ') || '—'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--t2)' }}>{r.tax_years || '—'}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ background: REQ_COLORS[r.status] || '#64748b', color: '#fff', borderRadius: 6, padding: '2px 9px', fontSize: 10.5, fontWeight: 700 }}>{r.status}</span>
                        {r.provider_status && <div style={{ color: r.provider_error ? '#f87171' : 'var(--t3)', fontSize: 10, marginTop: 3 }}>{r.provider_status}{r.provider_error ? ` · ${r.provider_error}` : ''}</div>}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--t2)' }}>{importedCount(r)}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--t2)', fontSize: 11 }}>{r.requested_at ? new Date(r.requested_at).toLocaleDateString() : '—'}{r.requested_by ? ` · ${r.requested_by}` : ''}</td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                        {r.provider === 'irs_a2a' && (r.provider_status === 'Error' || !r.provider_request_id) && <button className="btn sec" disabled={retryingId === r.id} style={{ fontSize: 10, padding: '3px 8px', marginRight: 4 }} onClick={() => retryDirect(r)}>{retryingId === r.id ? 'Retrying…' : 'Retry'}</button>}
                        <button className="btn sec" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => setDelId(r.id)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <button className="btn sec" style={{ fontSize: 11 }} onClick={() => setFallbackOpen(v => !v)}>
          {fallbackOpen ? 'Hide manual fallback' : 'Manual PDF fallback'}
        </button>
        {fallbackOpen && (
          <div style={{ marginTop: 10, background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Manual IRS TDS fallback</div>
            <div style={{ color: 'var(--t3)', fontSize: 11.5, marginTop: 4 }}>
              Use this only when direct IRS delivery is unavailable. Connect the folder where IRS TDS PDFs are saved; new PDFs are parsed and filed to the matching client.
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {!fsSupported ? (
                <span style={{ color: 'var(--t3)', fontSize: 12 }}>Folder watching requires Chrome or Edge. Manual upload remains available on Transcript Analysis.</span>
              ) : dirName ? (
                <>
                  <span style={{ fontSize: 12, color: 'var(--t2)' }}>Watching <b>{dirName}</b>{lastScan ? ` · last scan ${lastScan.toLocaleTimeString()}` : ''}</span>
                  <button className="btn sec" disabled={scanning} onClick={() => scanFolder(true)}>{scanning ? 'Scanning…' : 'Scan Now'}</button>
                  <button className="btn sec" onClick={disconnectFolder}>Disconnect</button>
                </>
              ) : (
                <button className="btn sec" onClick={connectFolder}>Connect Download Folder</button>
              )}
            </div>
            {unmatched.length > 0 && (
              <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>Needs a client ({unmatched.length})</div>
                {unmatched.map(u => (
                  <div key={u.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0', fontSize: 12 }}>
                    <span style={{ minWidth: 200 }}>{u.fileName}</span>
                    {u.error ? <span style={{ color: '#f87171' }}>{u.error}</span> : (
                      <>
                        <input list="irsportal-clients" placeholder="Assign to client…" value={u.assignTo} style={{ width: 200 }} onChange={e => setUnmatched(x => x.map(i => i.key === u.key ? { ...i, assignTo: e.target.value } : i))} />
                        <button className="btn sec" style={{ fontSize: 10, padding: '3px 8px' }} disabled={!u.assignTo.trim()} onClick={() => assignUnmatched(u)}>File It</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {delId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 12, padding: 20, width: 'min(380px, 92vw)' }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Delete this pull request? Filed analyses stay on the Transcript Analysis tab.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn sec" onClick={() => setDelId(null)}>Cancel</button>
              <button className="btn" style={{ background: '#b91c1c' }} onClick={() => deleteRequest(delId)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
