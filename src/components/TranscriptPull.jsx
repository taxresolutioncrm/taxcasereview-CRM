import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import {
  parseYearSpec, nameKey, requestCoverageSatisfied,
  parseTranscriptFile, storeTranscriptAnalysis,
  BROWSER_PROVIDER_ID, IRS_TDS_URL, IRS_SOR_URL, openIrsTds, isOpenBrowserRequest,
  openPendingIrsTab, startBrowserTdsRequest,
  analyzeReturnedTranscript, matchBrowserRequest, fileBrowserTranscripts,
  saveWatchedFolder, loadWatchedFolder, forgetWatchedFolder,
} from '../lib/transcriptPull'

const REQ_STATUSES = ['Requested', 'In Progress', 'Completed', 'Canceled']
const REQ_COLORS = { Requested: '#2563eb', 'In Progress': '#b45309', Completed: '#15803d', Canceled: '#64748b' }
const TRANSCRIPT_TYPES = ['Account Transcript', 'Wage and Income', 'Record of Account', 'Return Transcript', 'Verification of Non-Filing']
const TAX_YEARS = Array.from({ length: 31 }, (_, i) => String(new Date().getFullYear() - i))
const BLANK = { clientName: '', clientId: null, types: ['Account Transcript', 'Wage and Income'], taxYears: '', notes: '' }

export default function TranscriptPull({ clientNames = [], clients = [], poas = [], onGoToPoa, onImported }) {
  const { employeeName } = useApp()
  const [requests, setRequests] = useState([])
  const [legacyCount, setLegacyCount] = useState(0)
  const [migrating, setMigrating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
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
  const [savedFolder, setSavedFolder] = useState(null)
  const [returnBusyId, setReturnBusyId] = useState(null)
  const [dropId, setDropId] = useState(null)
  const fsSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  // Client combobox state
  const [clientSearch, setClientSearch] = useState('')
  const [clientDropOpen, setClientDropOpen] = useState(false)
  const [clientHighlight, setClientHighlight] = useState(-1)
  const clientInputRef = useRef(null)
  const clientDropRef = useRef(null)

  // Filtered client list for dropdown (max 40)
  const clientMatches = (() => {
    const q = clientSearch.trim().toLowerCase()
    if (!q) return clients.slice(0, 40)
    return clients.filter(c => c.name && c.name.toLowerCase().includes(q)).slice(0, 40)
  })()

  function selectClient(c) {
    ff('clientName', c.name)
    ff('clientId', c.id)
    setClientSearch(c.name)
    setClientDropOpen(false)
    setClientHighlight(-1)
  }

  function clearClientSelection() {
    ff('clientName', '')
    ff('clientId', null)
    setClientSearch('')
    setClientDropOpen(false)
    setClientHighlight(-1)
  }

  function handleClientKey(e) {
    if (!clientDropOpen) {
      if (e.key === 'ArrowDown') { setClientDropOpen(true); setClientHighlight(0) }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setClientHighlight(h => Math.min(h + 1, clientMatches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setClientHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (clientHighlight >= 0 && clientMatches[clientHighlight]) selectClient(clientMatches[clientHighlight]) }
    else if (e.key === 'Escape') { setClientDropOpen(false); setClientHighlight(-1) }
  }

  function handleClientInput(e) {
    const val = e.target.value
    setClientSearch(val)
    ff('clientName', val)
    ff('clientId', null) // clear selection when user edits text
    setClientDropOpen(true)
    setClientHighlight(-1)
  }

  // Close dropdown on outside click
  useEffect(() => {
    function onDown(e) {
      if (clientDropRef.current && !clientDropRef.current.contains(e.target) &&
          clientInputRef.current && !clientInputRef.current.contains(e.target)) {
        setClientDropOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function flash(t) { setMsg(t); setTimeout(() => setMsg(''), 6000) }
  function ff(k, v) { setForm(f => ({ ...f, [k]: v })) }

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
    const hasLiveDirect = requests.some(r => (r.provider === 'irs_a2a' || r.provider === BROWSER_PROVIDER_ID) && r.status !== 'Completed' && r.status !== 'Canceled')
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

  // Resolve client by selected ID first, then exact unique name as a safe fallback.
  function resolveClient(formState) {
    if (formState.clientId) return clients.find(c => String(c.id) === String(formState.clientId)) || null
    const key = nameKey(formState.clientName)
    if (!key) return null
    const matches = clients.filter(c => nameKey(c.name) === key)
    return matches.length === 1 ? matches[0] : null
  }

  function poaOnFile(client) {
    if (!client) return null
    const byId = poas.find(p => p.status === 'On File' && p.client_id && String(p.client_id) === String(client.id))
    if (byId) return byId
    return poas.find(p => p.status === 'On File' && nameKey(p.client_name) === nameKey(client.name))
  }
  const formClient = resolveClient(form)
  const formPoa = poaOnFile(formClient)
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
      setSavedFolder(null)
      saveWatchedFolder(handle)
      await scanFolder(true)
    } catch (e) {
      if (e?.name !== 'AbortError') flash('❌ Could not connect TDS download folder: ' + (e?.message || 'Unknown error'))
    }
  }

  function disconnectFolder() {
    dirRef.current = null
    setDirName('')
    setSavedFolder(null)
    forgetWatchedFolder()
  }

  // Re-attach the folder chosen on an earlier visit. Chrome/Edge may keep read access; otherwise one click re-grants it.
  useEffect(() => {
    if (!fsSupported) return
    let alive = true
    loadWatchedFolder().then(async handle => {
      if (!alive || !handle) return
      let perm = 'prompt'
      try { perm = await handle.queryPermission({ mode: 'read' }) } catch { /* unsupported */ }
      if (perm === 'granted') { dirRef.current = handle; setDirName(handle.name) }
      else setSavedFolder(handle)
    })
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function reconnectFolder() {
    const handle = savedFolder
    if (!handle) return connectFolder()
    try {
      if (await handle.requestPermission({ mode: 'read' }) !== 'granted') return
      dirRef.current = handle
      setDirName(handle.name)
      setSavedFolder(null)
      await scanFolder(true)
    } catch (e) {
      flash('❌ Could not reconnect the TDS download folder: ' + (e?.message || 'Unknown error'))
    }
  }

  async function addReturnedFiles(req, fileList) {
    const files = [...(fileList || [])].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf')
    if (!files.length) { flash('⚠ Choose the transcript PDF files you saved from IRS TDS.'); return }
    setReturnBusyId(req.id)
    try {
      const out = await fileBrowserTranscripts(req.id, files)
      const filed = out.results.filter(r => r.status === 'filed').length
      const dup = out.results.filter(r => r.status === 'duplicate').length
      const bad = out.results.filter(r => r.status === 'rejected' || r.status === 'error')
      await loadRequests()
      if (filed && onImported) onImported()
      flash(`${filed ? '✅' : '⚠'} ${filed} filed to ${req.client_name}${dup ? ` · ${dup} already filed` : ''}${bad.length ? ` · ${bad.length} not filed (${bad.map(b => `${b.file}: ${b.reason}`).join('; ')})` : ''}${out.completed ? ' · request complete' : ''}`)
    } catch (e) {
      flash('❌ Could not file returned transcripts: ' + (e?.message || 'Unknown error'))
    } finally {
      setReturnBusyId(null)
    }
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
          const openBrowser = requests.filter(isOpenBrowserRequest)
          const since = openBrowser.reduce((m, r) => Math.min(m, new Date(r.requested_at || 0).getTime()), Infinity) - 10 * 60 * 1000
          const parsed = await analyzeReturnedTranscript(file)
          const target = file.lastModified >= since ? await matchBrowserRequest(openBrowser, parsed) : null
          if (target) {
            const out = await fileBrowserTranscripts(target.id, [file])
            seenRef.current.add(key)
            if (out.results.some(r => r.status === 'filed')) {
              filed++
              setImported(im => [...im, { file: file.name, client: target.client_name, year: parsed.analysis.tax_year, type: parsed.analysis.transcript_type }])
            }
            continue
          }
          // No positive taxpayer (SSN/EIN) match to a pending request: never auto-file — leave it for manual assignment.
          setUnmatched(u => [...u.filter(x => x.key !== key), { key, fileName: file.name, file, analysis: parsed.analysis, assignTo: '' }])
          seenRef.current.add(key)
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
  const selectedYears = parseYearSpec(form.taxYears)
  const poaYears = formPoa ? parseYearSpec(formPoa.tax_years || '') : new Set()
  const selectedYearsCovered = Boolean(formPoa && selectedYears.size > 0 && poaYears.size > 0 && [...selectedYears].every(y => poaYears.has(y)))
  const canRequest = Boolean(formClient && formPoa && selectedYearsCovered && form.types.length > 0)

  function toggleTaxYear(year) {
    const next = new Set(selectedYears)
    if (next.has(year)) next.delete(year)
    else next.add(year)
    ff('taxYears', [...next].sort((a, b) => Number(b) - Number(a)).join(','))
  }

  function maskedSsn(value) {
    const digits = String(value || '').replace(/\D/g, '')
    return digits ? `***-**-${digits.slice(-4)}` : 'Not on file'
  }

  async function submitCanopyStyleRequest() {
    const nextForm = { ...form }
    if (!nextForm.clientName.trim() || nextForm.types.length === 0 || !nextForm.taxYears.trim()) return
    const client = resolveClient(nextForm)
    const poa = poaOnFile(client)
    if (!client || !poa || !selectedYearsCovered) return
    // Open an empty tab inside the click so the browser does not block it; it goes to IRS TDS only after the request is saved.
    const irsTab = openPendingIrsTab()
    if (!irsTab) {
      flash('❌ Browser blocked the IRS TDS tab. Allow pop-ups for this CRM and try again — no transcript request was saved.')
      return
    }
    setSaving(true)
    try {
      const row = {
        id: crypto.randomUUID(),
        client_name: client.name,
        client_id: client.id,
        transcript_types: nextForm.types,
        tax_years: nextForm.taxYears.trim(),
        provider: BROWSER_PROVIDER_ID,
        status: 'Requested',
        provider_status: 'Awaiting IRS files',
        poa_record_id: poa.id,
        requested_by: employeeName || null,
        notes: nextForm.notes || null,
      }
      await startBrowserTdsRequest(row, irsTab)
      setForm(BLANK)
      setClientSearch('')
      await loadRequests()
      flash(`✅ Request saved for ${client.name}. Request the transcripts in the IRS TDS tab, save the PDFs, and they will be filed here automatically.`)
    } catch (e) {
      flash('❌ ' + (e?.message || 'Could not save the transcript request.') + ' IRS TDS was not opened.')
    } finally {
      setSaving(false)
    }
  }

  // Derive the single most-actionable reason the CTA is unavailable (used below CTA only)
  const ctaBlockReason = (() => {
    if (!formClient) return 'Select a client.'
    if (!formPoa) return 'POA must be On File before requesting transcripts.'
    if (selectedYears.size === 0) return 'Select at least one tax year.'
    if (!selectedYearsCovered) return 'Selected years are not fully covered by this POA.'
    if (form.types.length === 0) return 'Select at least one transcript type.'
    return null
  })()

  return (
    <div>
      {/* ── Connection-state card ───────────────────────────────────────────── */}
      <div style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>IRS Transcript Delivery</div>
            <div style={{ color: 'var(--t3)', fontSize: 11.5, marginTop: 3 }}>
              Use the IRS-hosted TDS sign-in for practitioner access.
              {' '}<span style={{ opacity: 0.75 }}>Returned PDFs attach to the selected client file automatically.</span>
            </div>
          </div>
          <span style={{
            background: dirName ? '#15803d' : '#1d4ed8',
            color: '#fff', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 700, flexShrink: 0,
          }}>
            {dirName ? '● Watching TDS downloads' : '○ Browser sign-in'}
          </span>
        </div>

        <div style={{ padding: '14px 16px' }} id="irs-session-status">
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '11px 13px', background: 'var(--s1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>IRS / ID.me Sign-In</div>
                <div style={{ color: 'var(--t3)', fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>
                  Opens the IRS Transcript Delivery System in a new tab. Sign in there with your own IRS / ID.me login — your IRS session stays in that tab and is never shared with the CRM.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button className="btn" onClick={() => openIrsTds(IRS_TDS_URL)}>Sign in to IRS</button>
                <button className="btn sec" onClick={() => openIrsTds(IRS_SOR_URL)}>Secure Mailbox</button>
              </div>
            </div>
            <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 9, fontSize: 11.5, color: 'var(--t3)', lineHeight: 1.45, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ color: 'var(--t2)' }}>Returned PDFs:</strong>
              {!fsSupported ? (
                <span>Drop the saved PDFs on the request below (folder watching needs Chrome or Edge).</span>
              ) : dirName ? (
                <>
                  <span>Watching <b>{dirName}</b> — PDFs you save there are matched to the pending request and filed automatically{lastScan ? ` · last scan ${lastScan.toLocaleTimeString()}` : ''}.</span>
                  <button className="btn sec" style={{ fontSize: 11 }} disabled={scanning} onClick={() => scanFolder(true)}>{scanning ? 'Scanning…' : 'Scan Now'}</button>
                  <button className="btn sec" style={{ fontSize: 11 }} onClick={disconnectFolder}>Disconnect</button>
                </>
              ) : savedFolder ? (
                <>
                  <span>Allow the CRM to keep reading <b>{savedFolder.name}</b> for this visit.</span>
                  <button className="btn sec" style={{ fontSize: 11 }} onClick={reconnectFolder}>Reconnect Folder</button>
                </>
              ) : (
                <>
                  <span>Choose the folder where your browser saves IRS transcript PDFs (one time), or drop the PDFs on the request below.</span>
                  <button className="btn sec" style={{ fontSize: 11 }} onClick={connectFolder}>Connect Download Folder</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Request form ─────────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Request Transcripts</div>
        </div>
        <div style={{ padding: '14px 16px' }}>

          {/* Client + Tax Years row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12, alignItems: 'start' }}>
            {/* Client search */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--t3)', marginBottom: 5 }}>Client</label>
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={clientInputRef}
                    value={clientSearch}
                    onChange={handleClientInput}
                    onFocus={() => setClientDropOpen(true)}
                    onKeyDown={handleClientKey}
                    style={{ ...inputStyle, paddingRight: clientSearch ? 28 : undefined }}
                    placeholder="Search client by name…"
                    autoComplete="off"
                    data-testid="transcript-client-search"
                  />
                  {clientSearch && (
                    <button
                      type="button"
                      onClick={clearClientSelection}
                      style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                      aria-label="Clear client"
                    >×</button>
                  )}
                </div>

                {/* Dropdown */}
                {clientDropOpen && clientMatches.length > 0 && !form.clientId && (
                  <div
                    ref={clientDropRef}
                    style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                      background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 8,
                      boxShadow: '0 4px 16px rgba(0,0,0,.18)', maxHeight: 240, overflowY: 'auto',
                      marginTop: 3,
                    }}
                    data-testid="transcript-client-dropdown"
                  >
                    {clientMatches.map((c, i) => (
                      <div
                        key={c.id}
                        onMouseDown={e => { e.preventDefault(); selectClient(c) }}
                        onMouseEnter={() => setClientHighlight(i)}
                        style={{
                          padding: '8px 12px', cursor: 'pointer',
                          background: i === clientHighlight ? 'var(--blt)' : 'transparent',
                          borderBottom: i < clientMatches.length - 1 ? '1px solid var(--br)' : 'none',
                        }}
                        data-testid={`transcript-client-option-${c.id}`}
                      >
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                          SSN {maskedSsn(c.ssn)}{c.dob ? ` · DOB ${c.dob}` : ''}
                        </div>
                      </div>
                    ))}
                    {clientSearch.trim() && clientMatches.length === 40 && (
                      <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--t3)', borderTop: '1px solid var(--br)' }}>
                        Showing first 40 matches — type more to narrow
                      </div>
                    )}
                  </div>
                )}

                {/* No results */}
                {clientDropOpen && clientSearch.trim() && clientMatches.length === 0 && !form.clientId && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--t3)', marginTop: 3 }}>
                    No clients match "{clientSearch}"
                  </div>
                )}
              </div>

              {form.clientName.trim() && (!formClient ? (
                <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 5 }}>Select one exact client record.</div>
              ) : (
                <div style={{ marginTop: 8, border: '1px solid var(--line)', borderRadius: 9, padding: '9px 11px', background: 'var(--s1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 12.5 }}>{formClient.name}</div>
                      <div style={{ color: 'var(--t3)', fontSize: 11, marginTop: 3 }}>
                        SSN {maskedSsn(formClient.ssn)} · DOB {formClient.dob || 'Not on file'}
                      </div>
                    </div>
                    <span style={{ background: formPoa ? '#15803d' : '#b91c1c', color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 10.5, fontWeight: 800, alignSelf: 'flex-start' }}>
                      {formPoa ? 'POA On File' : 'POA Required'}
                    </span>
                  </div>
                  {formPoa ? (
                    <div style={{ fontSize: 11, color: selectedYears.size === 0 ? 'var(--t3)' : selectedYearsCovered ? '#22c55e' : '#f87171', marginTop: 6 }}>
                      Form {formPoa.form_type}{formPoa.tax_years ? ` · POA years: ${formPoa.tax_years}` : ''}
                      {selectedYears.size ? (selectedYearsCovered ? ' · Years valid ✓' : ' · Years not fully covered') : ' · Select years to validate'}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>
                      POA must be On File before requesting transcripts.{' '}
                      <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => onGoToPoa && onGoToPoa()}>Open POA / CAF Tracker</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Tax years */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--t3)', marginBottom: 5 }}>Tax Years</label>
              <select
                value=""
                onChange={e => {
                  const year = e.target.value
                  if (!year) return
                  const next = new Set(selectedYears)
                  next.add(year)
                  ff('taxYears', [...next].sort((a, b) => Number(b) - Number(a)).join(','))
                }}
                style={{ ...inputStyle, minHeight: 38 }}
              >
                <option value="">Add a tax year…</option>
                {TAX_YEARS.filter(year => !selectedYears.has(year)).map(year => <option key={year} value={year}>{year}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, minHeight: 28 }}>
                {[...selectedYears].sort((a, b) => Number(b) - Number(a)).map(year => (
                  <button
                    key={year}
                    type="button"
                    onClick={() => toggleTaxYear(year)}
                    title={`Remove ${year}`}
                    style={{
                      padding: '4px 10px', fontSize: 11.5, fontWeight: 700, borderRadius: 7,
                      border: '1px solid var(--blue)', background: 'rgba(37,99,235,.14)',
                      color: 'var(--blue)', cursor: 'pointer', lineHeight: 1.4,
                    }}
                  >{year} ×</button>
                ))}
                {selectedYears.size === 0 && <span style={{ color: 'var(--t3)', fontSize: 11.5, lineHeight: '28px' }}>Choose one or more years above.</span>}
              </div>
            </div>
          </div>

          {/* Transcript types */}
          <div style={{ marginTop: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--t3)', marginBottom: 6 }}>Transcript Types</label>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {TRANSCRIPT_TYPES.map(t => {
                const checked = form.types.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => ff('types', checked ? form.types.filter(x => x !== t) : [...form.types, t])}
                    style={{
                      padding: '6px 12px', fontSize: 11.5, borderRadius: 8, cursor: 'pointer',
                      border: checked ? '1px solid rgba(37,99,235,.6)' : '1px solid var(--line)',
                      background: checked ? 'rgba(37,99,235,.16)' : 'var(--s1)',
                      color: checked ? 'var(--blue)' : 'var(--t2)',
                      fontWeight: checked ? 700 : 500,
                      transition: 'background .12s, border-color .12s',
                    }}
                  >{t}</button>
                )
              })}
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--t3)', marginBottom: 5 }}>Notes <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <textarea value={form.notes} onChange={e => ff('notes', e.target.value)} rows={2} style={{ ...inputStyle, minHeight: 54, resize: 'vertical' }} placeholder="Internal note for this request" />
          </div>

          {/* CTA row */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, marginTop: 14 }}>
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ color: 'var(--t3)', fontSize: 11.5 }}>
                {formClient ? `Files will attach to: ${formClient.name}` : 'Returned PDFs attach to the selected client file automatically.'}
                {msg && <span style={{ marginLeft: 10, color: 'var(--t2)' }}>{msg}</span>}
              </div>
              <button
                className="btn"
                disabled={saving || !canRequest}
                onClick={submitCanopyStyleRequest}
                style={{ minWidth: 220, minHeight: 40, fontWeight: 800, flexShrink: 0 }}
              >
                {saving ? 'Requesting…' : 'Request Transcripts'}
              </button>
            </div>
            {!canRequest && ctaBlockReason && (
              <div style={{ fontSize: 11, color: 'var(--t3)', textAlign: 'right' }}>{ctaBlockReason}</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1.6fr) minmax(300px,.55fr)', gap:14, marginBottom:16 }}>
        <div id="irs-request-history" style={{ scrollMarginTop: 20 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
            <div style={{ fontWeight:700, fontSize:13 }}>Recent Transcript Requests</div>
            <button className="btn sec" style={{ fontSize:10.5, padding:'4px 9px' }} onClick={() => loadRequests()}>View All / Refresh</button>
          </div>
          {loading ? <div style={{ color:'var(--t3)', fontSize:13 }}>Loading…</div> :
            requests.length === 0 ? (
              <div style={{ color:'var(--t3)', fontSize:12.5, padding:'12px 0' }}>No transcript requests yet.</div>
            ) : (
              <div style={{ background:'var(--s2)', border:'1px solid var(--line)', borderRadius:10, overflow:'hidden' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ color:'var(--t3)', textAlign:'left' }}>
                      {['Client','Types','Years','Status','Filed','Requested',''].map(h => <th key={h} style={{ padding:'8px 12px', fontWeight:600 }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(r => (
                      <tr key={r.id} style={{ borderTop:'1px solid var(--line)', outline: dropId === r.id ? '2px dashed var(--blue)' : 'none', outlineOffset: -2 }}
                        onDragOver={isOpenBrowserRequest(r) ? (e => { e.preventDefault(); setDropId(r.id) }) : undefined}
                        onDragLeave={isOpenBrowserRequest(r) ? (() => setDropId(null)) : undefined}
                        onDrop={isOpenBrowserRequest(r) ? (e => { e.preventDefault(); setDropId(null); addReturnedFiles(r, e.dataTransfer.files) }) : undefined}
                        data-testid={`transcript-request-${r.id}`}>
                        <td style={{ padding:'8px 12px', fontWeight:700 }}>{r.client_name}</td>
                        <td style={{ padding:'8px 12px', color:'var(--t2)', fontSize:11 }}>{(r.transcript_types || []).join(', ') || '—'}</td>
                        <td style={{ padding:'8px 12px', color:'var(--t2)' }}>{r.tax_years || '—'}</td>
                        <td style={{ padding:'8px 12px' }}>
                          <span style={{ background:REQ_COLORS[r.status] || '#64748b', color:'#fff', borderRadius:6, padding:'2px 9px', fontSize:10.5, fontWeight:700 }}>{r.status}</span>
                          {r.provider_status && <div style={{ color:r.provider_error ? '#f87171' : 'var(--t3)', fontSize:10, marginTop:3 }}>{r.provider_status}{r.provider_error ? ` · ${r.provider_error}` : ''}</div>}
                        </td>
                        <td style={{ padding:'8px 12px', color:'var(--t2)' }}>{importedCount(r)}</td>
                        <td style={{ padding:'8px 12px', color:'var(--t2)', fontSize:11 }}>{r.requested_at ? new Date(r.requested_at).toLocaleDateString() : '—'}{r.requested_by ? ` · ${r.requested_by}` : ''}</td>
                        <td style={{ padding:'8px 12px', whiteSpace:'nowrap' }}>
                          {isOpenBrowserRequest(r) && (
                            <label className="btn sec" title="Add the transcript PDFs you saved from IRS TDS (or drop them on this row)" style={{ fontSize:10, padding:'3px 8px', marginRight:4, cursor: returnBusyId === r.id ? 'wait' : 'pointer' }}>
                              {returnBusyId === r.id ? 'Filing…' : 'Add IRS PDFs'}
                              <input type="file" accept="application/pdf" multiple style={{ display:'none' }} disabled={returnBusyId === r.id} data-testid={`transcript-return-input-${r.id}`} onChange={e => { const f = e.target.files; addReturnedFiles(r, f); e.target.value = '' }} />
                            </label>
                          )}
                          <button className="btn sec" style={{ fontSize:10, padding:'3px 8px' }} onClick={() => setDelId(r.id)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
        <div style={{ background:'var(--s2)', border:'1px solid var(--line)', borderRadius:10, padding:14, alignSelf:'start' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
            <div style={{ fontWeight:800, fontSize:13 }}>Auto-File Destination</div>
            <span style={{ fontSize:10, fontWeight:800, color:'#fff', background:'#15803d', borderRadius:6, padding:'3px 8px' }}>Enabled</span>
          </div>
          <div style={{ fontSize:11.5, color:'var(--t3)', marginTop:8, lineHeight:1.5 }}>Returned transcripts are automatically saved to the selected client record.</div>
          <div style={{ fontSize:11.5, marginTop:10, lineHeight:1.7 }}>
            <div><b>Location:</b> Documents → Transcripts</div>
            <div><b>Access:</b> Restricted by tenant/RLS</div>
            <div><b>Analysis:</b> Automatically parsed into Transcript Analysis</div>
          </div>
        </div>
      </div>

      <div id="irs-manual-fallback" style={{ borderTop: '1px solid var(--line)', paddingTop: 12, scrollMarginTop: 20 }}>
        <button className="btn sec" style={{ fontSize: 11 }} onClick={() => setFallbackOpen(v => !v)}>
          {fallbackOpen ? 'Hide manual fallback' : 'Manual PDF fallback'}
        </button>
        {fallbackOpen && (
          <div style={{ marginTop: 10, background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Manual IRS TDS fallback</div>
            <div style={{ color: 'var(--t3)', fontSize: 11.5, marginTop: 5, lineHeight: 1.45 }}>
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
                        <>
                          <input
                            list="transcript-fallback-clients"
                            placeholder="Assign to client…"
                            value={u.assignTo}
                            style={{ width: 200 }}
                            onChange={e => setUnmatched(x => x.map(i => i.key === u.key ? { ...i, assignTo: e.target.value } : i))}
                          />
                          <datalist id="transcript-fallback-clients">
                            {clients.map(c => <option key={c.id} value={c.name} />)}
                          </datalist>
                        </>
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
