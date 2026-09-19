import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { parseTranscriptFile, storeTranscriptAnalysis } from '../lib/transcriptPull'
import TranscriptPull from '../components/TranscriptPull'

// ── IRS Portal ──
// Two tools that together close the POA -> transcripts loop:
//
// 1. Transcript Analysis: upload IRS transcript PDFs (pulled from TDS /
//    e-Services the normal way), parse them with the parse-transcript
//    edge function (Claude), and get per-year balances, penalties,
//    interest, assessment dates, CSED estimates, transaction history and
//    compliance flags — the analysis layer Canopy sells, minus the
//    restricted TDS pull (that requires IRS A2A software approval, on the
//    roadmap).
//
// 2. POA / CAF Tracker: every client's 2848/8821 lifecycle in one table —
//    Draft -> Signed -> Submitted -> On File — with the signed form
//    attached and one-click access to the IRS online submit tool and CAF
//    fax numbers.

const POA_STATUSES = ['Draft', 'Signed', 'Submitted', 'On File', 'Rejected']
const POA_METHODS = ['IRS Online (Tax Pro)', 'Fax to CAF — Ogden', 'Fax to CAF — Memphis', 'Fax to CAF — Philadelphia (Intl)', 'Mail']
const POA_BLANK = { clientName: '', formType: '2848', taxYears: '', status: 'Draft', signedDate: '', submittedDate: '', cafConfirmedDate: '', submissionMethod: 'IRS Online (Tax Pro)', notes: '', fileUrl: '' }

const STATUS_COLORS = {
  'Draft': '#64748b', 'Signed': '#2563eb', 'Submitted': '#b45309',
  'On File': '#15803d', 'Rejected': '#b91c1c',
}

function money(n) {
  if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export default function IRSPortal() {
  const location = useLocation()
  const [tab, setTab] = useState('transcripts')
  useEffect(() => {
    if (new URLSearchParams(location.search).get('new') === '1') setTab('pull')
  }, [location.search])

  // ── shared: client names for pickers ──
  const [clientNames, setClientNames] = useState([])
  useEffect(() => {
    supabase.from('clients').select('name').order('name')
      .then(({ data }) => setClientNames((data || []).map(c => c.name).filter(Boolean)))
  }, [])

  // ═══════════ TRANSCRIPT ANALYSIS ═══════════
  const [analyses, setAnalyses] = useState([])
  const [tLoading, setTLoading] = useState(true)
  const [uploadClient, setUploadClient] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseStatus, setParseStatus] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [tDel, setTDel] = useState(null)

  async function loadAnalyses() {
    setTLoading(true)
    const { data } = await supabase.from('transcript_analyses').select('*').order('created_at', { ascending: false })
    setAnalyses(data || [])
    setTLoading(false)
  }
  useEffect(() => { loadAnalyses() }, [])

  async function handleTranscriptFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return
    if (!uploadClient.trim()) { setParseStatus('❌ Pick or type the client name first.'); return }
    setParsing(true)
    let done = 0
    for (const file of files) {
      setParseStatus(`Analyzing ${file.name} (${done + 1} of ${files.length})…`)
      try {
        // Shared helper: deterministic in-browser parse, PDF stored to
        // Storage, analysis row inserted, and the doc filed in the client's
        // Documents → Transcripts folder.
        const a = await parseTranscriptFile(file)
        await storeTranscriptAnalysis(file, uploadClient, a)
        done++
      } catch (err) {
        setParseStatus(`❌ ${file.name}: ${err.message}`)
        setParsing(false)
        loadAnalyses()
        return
      }
    }
    setParseStatus(`✅ Analyzed ${done} transcript${done === 1 ? '' : 's'}.`)
    setParsing(false)
    loadAnalyses()
    setTimeout(() => setParseStatus(''), 6000)
  }

  async function deleteAnalysis(id) {
    const row = analyses.find(a => a.id === id)
    if (row?.file_path) await supabase.storage.from('documents').remove([row.file_path]).catch(() => {})
    if (row?.file_url) await supabase.from('documents').delete().eq('file_url', row.file_url)
    await supabase.from('transcript_analyses').delete().eq('id', id)
    setTDel(null)
    loadAnalyses()
  }

  async function openTranscriptFile(row) {
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    try {
      let url = row?.file_url || ''
      const path = row?.file_path
        || (String(url).startsWith('storage://documents/') ? String(url).replace('storage://documents/', '') : '')
      if (path) {
        const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
        if (error || !data?.signedUrl) throw error || new Error('Could not authorize transcript file')
        url = data.signedUrl
      }
      if (!url) throw new Error('Transcript file is unavailable')
      if (tab) tab.location.href = url
      else setParseStatus('❌ Allow pop-ups to open transcript PDFs.')
    } catch (e) {
      if (tab) tab.close()
      setParseStatus('❌ ' + (e?.message || e))
      setTimeout(() => setParseStatus(''), 6000)
    }
  }

  function copySummary(rows, client) {
    const lines = [`IRS Transcript Summary — ${client}`, '']
    let total = 0
    rows.forEach(r => {
      const bal = Number(r.total_balance || 0)
      total += bal
      lines.push(`${r.tax_year || '????'} (${r.transcript_type || 'transcript'}): balance ${money(r.total_balance)}, penalties ${money(r.accrued_penalty)}, interest ${money(r.accrued_interest)}${r.csed_estimate ? `, est. collection expiration ${r.csed_estimate}` : ''}`)
      const f = r.flags || {}
      const flagText = [f.unfiled_return && 'UNFILED RETURN', f.lien_filed && 'LIEN FILED', f.levy_issued && 'LEVY', f.installment_agreement && 'IA in place', f.currently_not_collectible && 'CNC'].filter(Boolean).join(', ')
      if (flagText) lines.push(`   Flags: ${flagText}`)
    })
    lines.push('', `Total balance across years: ${money(total)}`)
    lines.push('', 'CSED dates are estimates (assessment + 10 years) and can be extended by tolling events. Verify before relying on them.')
    navigator.clipboard.writeText(lines.join('\n'))
    setParseStatus('✅ Summary copied to clipboard.')
    setTimeout(() => setParseStatus(''), 3000)
  }

  // Group analyses by client
  const byClient = {}
  analyses.forEach(a => {
    const k = a.client_name || 'Unknown'
    if (!byClient[k]) byClient[k] = []
    byClient[k].push(a)
  })

  // ═══════════ POA / CAF TRACKER ═══════════
  const [poas, setPoas] = useState([])
  const [pLoading, setPLoading] = useState(true)
  const [poaModal, setPoaModal] = useState(false)
  const [poaForm, setPoaForm] = useState(POA_BLANK)
  const [poaEditId, setPoaEditId] = useState(null)
  const [poaSaving, setPoaSaving] = useState(false)
  const [poaDel, setPoaDel] = useState(null)

  async function loadPoas() {
    setPLoading(true)
    const { data } = await supabase.from('poa_records').select('*').order('created_at', { ascending: false })
    setPoas(data || [])
    setPLoading(false)
  }
  useEffect(() => { loadPoas() }, [])

  function pf(k, v) { setPoaForm(f => ({ ...f, [k]: v })) }

  async function savePoa() {
    if (!poaForm.clientName.trim()) return
    setPoaSaving(true)
    const payload = {
      client_name: poaForm.clientName.trim(),
      form_type: poaForm.formType,
      tax_years: poaForm.taxYears,
      status: poaForm.status,
      signed_date: poaForm.signedDate || null,
      submitted_date: poaForm.submittedDate || null,
      caf_confirmed_date: poaForm.cafConfirmedDate || null,
      submission_method: poaForm.submissionMethod,
      notes: poaForm.notes,
      file_url: poaForm.fileUrl || null,
      updated_at: new Date().toISOString(),
    }
    let error
    if (poaEditId) ({ error } = await supabase.from('poa_records').update(payload).eq('id', poaEditId))
    else ({ error } = await supabase.from('poa_records').insert([payload]))
    setPoaSaving(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setPoaModal(false); setPoaForm(POA_BLANK); setPoaEditId(null)
    loadPoas()
  }

  async function attachPoaFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const path = `poa/${(poaForm.clientName || 'unknown').replace(/[^A-Za-z0-9 _-]/g, '')}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
    if (error) { alert('Upload failed: ' + error.message); return }
    const { data: u } = await supabase.storage.from('documents').createSignedUrl(path, 94608000)
    pf('fileUrl', u?.signedUrl || '')
  }

  async function deletePoa(id) {
    await supabase.from('poa_records').delete().eq('id', id)
    setPoaDel(null)
    loadPoas()
  }

  const inputStyle = { width: '100%', boxSizing: 'border-box' }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>🏛️ IRS Portal</h1>
          <div style={{ color: 'var(--t3)', fontSize: 12, marginTop: 4 }}>
            Transcript analysis and POA / CAF tracking in one place.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn sec" href="https://www.irs.gov/tax-professionals/submit-forms-2848-and-8821-online" target="_blank" rel="noreferrer">↗ IRS: Submit 2848 / 8821</a>
          <a className="btn sec" href="https://www.irs.gov/e-services" target="_blank" rel="noreferrer">↗ IRS e-Services (TDS)</a>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        {[['transcripts', '📊 Transcript Analysis'], ['pull', '📡 Pull Transcripts'], ['poa', '📝 POA / CAF Tracker']].map(([k, label]) => (
          <button key={k} className={tab === k ? 'btn' : 'btn sec'} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {/* ═══════════ TRANSCRIPTS TAB ═══════════ */}
      {tab === 'transcripts' && (
        <div>
          <div style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 10, padding: 16, marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Upload & Analyze Transcripts</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input list="irsportal-clients" placeholder="Client name…" value={uploadClient}
                onChange={e => setUploadClient(e.target.value)} style={{ width: 240 }} />
              <datalist id="irsportal-clients">
                {clientNames.map(n => <option key={n} value={n} />)}
              </datalist>
              <label className="btn" style={{ cursor: parsing ? 'wait' : 'pointer', opacity: parsing ? 0.7 : 1 }}>
                {parsing ? '⏳ Analyzing…' : '📄 Upload Transcript PDF(s)'}
                <input type="file" accept="application/pdf" multiple style={{ display: 'none' }}
                  disabled={parsing} onChange={handleTranscriptFiles} />
              </label>
              {parseStatus && <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>{parseStatus}</span>}
            </div>
            <div style={{ color: 'var(--t3)', fontSize: 11.5, marginTop: 8 }}>
              Pull transcripts from IRS e-Services / TDS as usual, then drop the PDFs here. Each file is parsed into
              balances, penalties, interest, assessment dates, an estimated CSED, transaction history and compliance flags.
            </div>
          </div>

          {tLoading ? <div style={{ color: 'var(--t3)', fontSize: 13 }}>Loading…</div> :
            Object.keys(byClient).length === 0 ? (
              <div style={{ color: 'var(--t3)', fontSize: 13 }}>No analyzed transcripts yet. Upload one above to get started.</div>
            ) : Object.entries(byClient).map(([client, rows]) => {
              const total = rows.reduce((s, r) => s + Number(r.total_balance || 0), 0)
              return (
                <div key={client} style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 14, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{client}
                      <span style={{ marginLeft: 10, fontSize: 12, color: total > 0 ? '#f87171' : 'var(--t3)', fontWeight: 700 }}>
                        Total balance: {money(total)}
                      </span>
                    </div>
                    <button className="btn sec" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => copySummary(rows, client)}>📋 Copy Client Summary</button>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: 'var(--t3)', textAlign: 'left' }}>
                        {['Year', 'Type', 'Balance', 'Penalties', 'Interest', 'Assessed', 'Est. CSED', 'Flags', ''].map(h =>
                          <th key={h} style={{ padding: '7px 12px', fontWeight: 600 }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => {
                        const f = r.flags || {}
                        const flagChips = [f.unfiled_return && ['Unfiled', '#b91c1c'], f.lien_filed && ['Lien', '#b45309'],
                          f.levy_issued && ['Levy', '#b91c1c'], f.installment_agreement && ['IA', '#15803d'],
                          f.currently_not_collectible && ['CNC', '#2563eb']].filter(Boolean)
                        return (
                          <>
                            <tr key={r.id} style={{ borderTop: '1px solid var(--line)', cursor: 'pointer' }}
                              onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                              <td style={{ padding: '8px 12px', fontWeight: 700 }}>{r.tax_year || '—'}</td>
                              <td style={{ padding: '8px 12px', color: 'var(--t2)' }}>{r.transcript_type || '—'}</td>
                              <td style={{ padding: '8px 12px', fontWeight: 700, color: Number(r.total_balance) > 0 ? '#f87171' : 'inherit' }}>{money(r.total_balance)}</td>
                              <td style={{ padding: '8px 12px' }}>{money(r.accrued_penalty)}</td>
                              <td style={{ padding: '8px 12px' }}>{money(r.accrued_interest)}</td>
                              <td style={{ padding: '8px 12px', color: 'var(--t2)' }}>{r.assessment_date || '—'}</td>
                              <td style={{ padding: '8px 12px', color: 'var(--t2)' }}>{r.csed_estimate || '—'}</td>
                              <td style={{ padding: '8px 12px' }}>
                                {flagChips.length === 0 ? <span style={{ color: 'var(--t3)' }}>—</span> :
                                  flagChips.map(([label, color]) => (
                                    <span key={label} style={{ background: color, color: '#fff', borderRadius: 5, padding: '1px 7px', fontSize: 10, fontWeight: 700, marginRight: 4 }}>{label}</span>
                                  ))}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                {(r.file_url || r.file_path) && <button className="btn sec" style={{ fontSize: 10, padding: '3px 8px', marginRight: 4 }} onClick={e => { e.stopPropagation(); openTranscriptFile(r) }}>PDF</button>}
                                <button className="btn sec" style={{ fontSize: 10, padding: '3px 8px' }} onClick={e => { e.stopPropagation(); setTDel(r.id) }}>✕</button>
                              </td>
                            </tr>
                            {expanded === r.id && (
                              <tr key={r.id + '-detail'}>
                                <td colSpan={9} style={{ padding: '10px 16px', background: 'var(--s1)', borderTop: '1px solid var(--line)' }}>
                                  {(r.raw_analysis?.transactions || []).length > 0 && (
                                    <div style={{ marginBottom: 10 }}>
                                      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Transaction History</div>
                                      <table style={{ borderCollapse: 'collapse', fontSize: 11.5 }}>
                                        <tbody>
                                          {(r.raw_analysis.transactions || []).map((t, i) => (
                                            <tr key={i}>
                                              <td style={{ padding: '3px 10px 3px 0', color: 'var(--t3)', fontFamily: 'monospace' }}>{t.code}</td>
                                              <td style={{ padding: '3px 10px 3px 0', color: 'var(--t2)' }}>{t.date}</td>
                                              <td style={{ padding: '3px 10px 3px 0' }}>{t.description}</td>
                                              <td style={{ padding: '3px 0', textAlign: 'right' }}>{money(t.amount)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                  {(r.raw_analysis?.wage_income || []).length > 0 && (
                                    <div>
                                      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Wage & Income Documents</div>
                                      {(r.raw_analysis.wage_income || []).map((w, i) => (
                                        <div key={i} style={{ fontSize: 11.5, color: 'var(--t2)', padding: '2px 0' }}>
                                          {w.form} — {w.payer} {w.amount ? `(${money(w.amount)})` : ''}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {(!(r.raw_analysis?.transactions || []).length && !(r.raw_analysis?.wage_income || []).length) && (
                                    <div style={{ color: 'var(--t3)', fontSize: 12 }}>No transaction or wage detail extracted for this transcript.</div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })}

          <div style={{ color: 'var(--t3)', fontSize: 11, marginTop: 10 }}>
            CSED dates shown are estimates (assessment date + 10 years). Tolling events — bankruptcy, OIC review, CDP
            hearings, time outside the country — extend them. Verify before relying on any CSED.
          </div>
        </div>
      )}

      {/* ═══════════ PULL TRANSCRIPTS TAB ═══════════ */}
      {tab === 'pull' && (
        <TranscriptPull clientNames={clientNames} poas={poas}
          onGoToPoa={() => setTab('poa')} onImported={loadAnalyses} />
      )}

      {/* ═══════════ POA TAB ═══════════ */}
      {tab === 'poa' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ color: 'var(--t3)', fontSize: 12 }}>
              CAF fax lines: Ogden <b>855-214-7522</b> · Memphis <b>855-214-7519</b> · Philadelphia (Intl) <b>304-707-9785</b>
            </div>
            <button className="btn" onClick={() => { setPoaForm(POA_BLANK); setPoaEditId(null); setPoaModal(true) }}>+ Add POA Record</button>
          </div>

          {pLoading ? <div style={{ color: 'var(--t3)', fontSize: 13 }}>Loading…</div> :
            poas.length === 0 ? (
              <div style={{ color: 'var(--t3)', fontSize: 13 }}>No POA records yet. Add one for each client whose 2848 / 8821 you're tracking.</div>
            ) : (
              <div style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: 'var(--t3)', textAlign: 'left' }}>
                      {['Client', 'Form', 'Years', 'Status', 'Signed', 'Submitted', 'CAF Confirmed', 'Method', ''].map(h =>
                        <th key={h} style={{ padding: '8px 12px', fontWeight: 600 }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {poas.map(p => (
                      <tr key={p.id} style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>{p.client_name}</td>
                        <td style={{ padding: '8px 12px' }}>{p.form_type}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t2)' }}>{p.tax_years || '—'}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ background: STATUS_COLORS[p.status] || '#64748b', color: '#fff', borderRadius: 6, padding: '2px 9px', fontSize: 10.5, fontWeight: 700 }}>{p.status}</span>
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--t2)' }}>{p.signed_date || '—'}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t2)' }}>{p.submitted_date || '—'}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t2)' }}>{p.caf_confirmed_date || '—'}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--t2)', fontSize: 11 }}>{p.submission_method || '—'}</td>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                          {p.file_url && <a className="btn sec" style={{ fontSize: 10, padding: '3px 8px', marginRight: 4 }} href={p.file_url} target="_blank" rel="noreferrer">PDF</a>}
                          <button className="btn sec" style={{ fontSize: 10, padding: '3px 8px', marginRight: 4 }}
                            onClick={() => {
                              setPoaForm({
                                clientName: p.client_name, formType: p.form_type, taxYears: p.tax_years || '',
                                status: p.status, signedDate: p.signed_date || '', submittedDate: p.submitted_date || '',
                                cafConfirmedDate: p.caf_confirmed_date || '', submissionMethod: p.submission_method || 'IRS Online (Tax Pro)',
                                notes: p.notes || '', fileUrl: p.file_url || '',
                              })
                              setPoaEditId(p.id); setPoaModal(true)
                            }}>Edit</button>
                          <button className="btn sec" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => setPoaDel(p.id)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {/* ═══════════ POA MODAL ═══════════ */}
      {poaModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setPoaModal(false)}>
          <div style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 12, padding: 20, width: 'min(520px, 94vw)', maxHeight: '88vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 14 }}>{poaEditId ? 'Edit POA Record' : 'New POA Record'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 11, color: 'var(--t3)' }}>Client</label>
                <input list="irsportal-clients" value={poaForm.clientName} onChange={e => pf('clientName', e.target.value)} style={inputStyle} placeholder="Client name" />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--t3)' }}>Form</label>
                <select value={poaForm.formType} onChange={e => pf('formType', e.target.value)} style={inputStyle}>
                  <option value="2848">2848 — Power of Attorney</option>
                  <option value="8821">8821 — Tax Info Authorization</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--t3)' }}>Tax Years</label>
                <input value={poaForm.taxYears} onChange={e => pf('taxYears', e.target.value)} style={inputStyle} placeholder="2019-2024" />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--t3)' }}>Status</label>
                <select value={poaForm.status} onChange={e => pf('status', e.target.value)} style={inputStyle}>
                  {POA_STATUSES.map(st => <option key={st}>{st}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--t3)' }}>Submission Method</label>
                <select value={poaForm.submissionMethod} onChange={e => pf('submissionMethod', e.target.value)} style={inputStyle}>
                  {POA_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--t3)' }}>Signed Date</label>
                <input type="date" value={poaForm.signedDate} onChange={e => pf('signedDate', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--t3)' }}>Submitted Date</label>
                <input type="date" value={poaForm.submittedDate} onChange={e => pf('submittedDate', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--t3)' }}>CAF Confirmed Date</label>
                <input type="date" value={poaForm.cafConfirmedDate} onChange={e => pf('cafConfirmedDate', e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label className="btn sec" style={{ cursor: 'pointer', fontSize: 12 }}>
                  {poaForm.fileUrl ? '✅ Signed form attached' : '📎 Attach Signed Form'}
                  <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={attachPoaFile} />
                </label>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 11, color: 'var(--t3)' }}>Notes</label>
                <textarea value={poaForm.notes} onChange={e => pf('notes', e.target.value)} rows={2} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn sec" onClick={() => setPoaModal(false)}>Cancel</button>
              <button className="btn" disabled={poaSaving} onClick={savePoa}>{poaSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* delete confirms */}
      {(tDel || poaDel) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 12, padding: 20, width: 'min(380px, 92vw)' }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Delete this {tDel ? 'transcript analysis' : 'POA record'}?</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn sec" onClick={() => { setTDel(null); setPoaDel(null) }}>Cancel</button>
              <button className="btn" style={{ background: '#b91c1c' }} onClick={() => tDel ? deleteAnalysis(tDel) : deletePoa(poaDel)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
