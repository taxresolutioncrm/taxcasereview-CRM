import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const pct = (n) => Math.max(0, Math.min(100, Math.round(Number(n || 0) * 100)))
const fmtDate = (v) => {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

export default function PreparedFile() {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const [client, setClient] = useState(null)
  const [docs, setDocs] = useState([])
  const [runs, setRuns] = useState([])
  const [facts, setFacts] = useState([])
  const [entities, setEntities] = useState([])
  const [questions, setQuestions] = useState([])
  const [busy, setBusy] = useState(false)
  const [activeDoc, setActiveDoc] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState('overview')
  const [clientOptions, setClientOptions] = useState([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [askText, setAskText] = useState('')
  const [askReply, setAskReply] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadType, setUploadType] = useState('Auto-detect')
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')

  useEffect(() => {
    if (clientId) load()
    else loadClientOptions()
  }, [clientId])

  async function loadClientOptions() {
    setError('')
    const { data, error } = await supabase
      .from('clients')
      .select('id,name,email,phone,tenant_id')
      .order('name', { ascending:true })
      .limit(500)
    if (error) {
      setError(error.message)
      setClientOptions([])
      return
    }
    setClientOptions(data || [])
  }

  async function load() {
    if (!clientId) return
    setError('')

    const cl = await supabase.from('clients').select('id,name,email,phone,tenant_id').eq('id', clientId).maybeSingle()
    if (cl.error) {
      setError(cl.error.message)
      setClient(null)
      return
    }
    const nextClient = cl.data || null
    setClient(nextClient)
    if (!nextClient) return

    const [byId, byName, rs, fs, es, qs] = await Promise.all([
      supabase.from('documents').select('*').eq('client_id', clientId).order('created_at', { ascending:false }),
      nextClient.name
        ? supabase.from('documents').select('*').is('client_id', null).eq('client', nextClient.name).order('created_at', { ascending:false })
        : Promise.resolve({ data:[], error:null }),
      supabase.from('document_ai_runs').select('*').eq('client_id', clientId).order('created_at', { ascending:false }),
      supabase.from('document_ai_facts').select('*').eq('client_id', clientId).order('created_at', { ascending:false }),
      supabase.from('document_ai_entities').select('*').eq('client_id', clientId).order('created_at', { ascending:false }),
      supabase.from('document_ai_questions').select('*').eq('client_id', clientId).order('created_at', { ascending:false }),
    ])

    const mergedDocs = [...(byId.data || []), ...(byName.data || [])]
      .filter((doc, index, all) => all.findIndex(x => String(x.id) === String(doc.id)) === index)
      .sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

    const firstError = [byId, byName, rs, fs, es, qs].find(result => result?.error)?.error
    if (firstError) setError(firstError.message)

    setDocs(mergedDocs)
    setRuns(rs.data || [])
    setFacts(fs.data || [])
    setEntities(es.data || [])
    setQuestions(qs.data || [])
  }

  const latestByDoc = useMemo(() => {
    const map = new Map()
    for (const r of runs) if (!map.has(String(r.document_id))) map.set(String(r.document_id), r)
    return map
  }, [runs])

  const latestCompleteRunIds = useMemo(() => {
    const ids = new Set()
    const seen = new Set()
    for (const run of runs) {
      const docId = String(run.document_id || '')
      if (!docId || seen.has(docId)) continue
      if (run.status === 'complete') {
        ids.add(String(run.id))
        seen.add(docId)
      }
    }
    return ids
  }, [runs])

  const currentFacts = facts.filter(f => latestCompleteRunIds.has(String(f.run_id)) && f.review_status !== 'rejected')
  const currentEntities = entities.filter(e => latestCompleteRunIds.has(String(e.run_id)) && e.review_status !== 'rejected')
  const currentQuestions = questions.filter(q => !q.run_id || latestCompleteRunIds.has(String(q.run_id)))
  const analyzedCount = docs.filter(d => latestByDoc.get(String(d.id))?.status === 'complete').length
  const ready = docs.length ? Math.round((analyzedCount / docs.length) * 100) : 0
  const openQuestions = currentQuestions.filter(q => q.status === 'open')
  const taxYears = [...new Set(runs.filter(r=>r.status==='complete').map(r => r.tax_year).filter(Boolean))].sort((a,b)=>b-a)
  const noticeDeadlineFacts = currentFacts.filter(f => ['notice','deadline'].includes(String(f.category || '').toLowerCase()))
  const reviewFindings = currentFacts.filter(f => f.review_status === 'unreviewed' || (f.confidence != null && Number(f.confidence) < 0.8))
  const unreadDocuments = docs.filter(d => latestByDoc.get(String(d.id))?.status !== 'complete')
  const recommendedActions = [
    ...unreadDocuments.slice(0,3).map(d => ({ kind:'document', text:`Analyze ${d.file_name || d.name || 'unread document'}` })),
    ...openQuestions.slice(0,4).map(q => ({ kind:'question', text:`Resolve: ${q.question}` })),
    ...reviewFindings.slice(0,4).map(f => ({ kind:'review', text:`Verify ${f.field_label || f.field_key}` })),
    ...noticeDeadlineFacts.slice(0,4).map(f => ({ kind:'deadline', text:`Review ${f.field_label || f.field_key}: ${f.normalized_text || ''}` })),
  ].slice(0,10)

  async function uploadAndAnalyze() {
    if (!client?.id || !client?.tenant_id) { setError('Client tenant context is unavailable.'); return }
    if (!uploadFile) { setError('Choose a document to upload.'); return }
    if (uploadFile.size > 20 * 1024 * 1024) { setError('AI analysis supports files up to 20 MB.'); return }

    setUploadBusy(true)
    setUploadStatus('Uploading…')
    setError('')
    let storagePath = ''
    try {
      const safeName = String(uploadFile.name || 'document')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
      storagePath = 'ai-intelligence/' + client.id + '/' + Date.now() + '_' + safeName
      const { error: uploadErr } = await supabase.storage.from('documents').upload(storagePath, uploadFile, {
        upsert: false,
        contentType: uploadFile.type || undefined,
      })
      if (uploadErr) throw uploadErr

      const docType = uploadType === 'Auto-detect' ? 'AI Intake' : uploadType
      const { data: inserted, error: insertErr } = await supabase.from('documents').insert({
        tenant_id: client.tenant_id,
        client_id: client.id,
        client: client.name,
        name: uploadFile.name,
        docType,
        file_name: uploadFile.name,
        file_size: uploadFile.size,
        storage_path: storagePath,
        file_url: 'storage://documents/' + storagePath,
        created_at: new Date().toISOString(),
      }).select('*').single()
      if (insertErr || !inserted) throw insertErr || new Error('Document record could not be created')

      setUploadStatus('Analyzing…')
      const { data, error: invokeError } = await supabase.functions.invoke('document-intelligence', {
        body: { documentId: inserted.id, clientId: client.id },
      })
      if (invokeError || data?.error) {
        throw new Error(data?.error || invokeError?.message || 'AI analysis failed')
      }

      setUploadFile(null)
      setUploadStatus('Complete')
      await load()
      setTab('overview')
    } catch (e) {
      if (storagePath && String(e?.message || '').includes('Document record could not be created')) {
        await supabase.storage.from('documents').remove([storagePath]).catch(()=>{})
      }
      setUploadStatus('')
      setError(e?.message || String(e))
    } finally {
      setUploadBusy(false)
    }
  }

  async function analyzeDocument(doc) {
    if (!doc?.id) return
    setActiveDoc(doc.id)
    setError('')
    const { data, error: invokeError } = await supabase.functions.invoke('document-intelligence', {
      body: { documentId: doc.id, clientId },
    })
    setActiveDoc('')
    if (invokeError || data?.error) throw new Error(data?.error || invokeError?.message || 'Analysis failed')
  }

  async function analyzeAll() {
    const pending = docs.filter(d => latestByDoc.get(String(d.id))?.status !== 'complete')
    if (!pending.length) return
    setBusy(true)
    setError('')
    try {
      for (const doc of pending) {
        try {
          await analyzeDocument(doc)
          await load()
        } catch (e) {
          setError((prev) => prev || (e?.message || String(e)))
        }
      }
    } finally {
      setBusy(false)
      await load()
    }
  }

  async function askClientAI() {
    const message = String(askText || '').trim()
    if (!message || askBusy) return
    setAskBusy(true)
    setAskReply('')
    setError('')
    try {
      const context = [
        'Client: ' + (client?.name || ''),
        'Tax years: ' + (taxYears.join(', ') || 'none identified'),
        'Document summaries: ' + runs.filter(r=>r.status==='complete').slice(0,12).map(r=>r.summary).filter(Boolean).join(' | '),
        'Verified/current facts: ' + currentFacts.slice(0,30).map(f=>(f.field_label||f.field_key)+': '+(f.normalized_text || JSON.stringify(f.value_json))).join(' | '),
        'Open questions: ' + openQuestions.slice(0,15).map(q=>q.question).join(' | '),
        'Notices/deadlines: ' + noticeDeadlineFacts.slice(0,15).map(f=>(f.field_label||f.field_key)+': '+(f.normalized_text||'')).join(' | '),
      ].join('\n')
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: { message, context, history: [] },
      })
      if (error || data?.error) throw new Error(data?.error || error?.message || 'AI request failed')
      setAskReply(String(data?.reply || data?.message || data?.content || 'No response returned.'))
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setAskBusy(false)
    }
  }

  async function openSource(documentId, page) {
    const doc = docs.find(d => String(d.id) === String(documentId))
    if (!doc) { setError('Source document is no longer available.'); return }
    try {
      let url = doc.file_url || ''
      if (doc.storage_path) {
        const { data, error } = await supabase.storage.from('documents').createSignedUrl(doc.storage_path, 900)
        if (error) throw error
        url = data?.signedUrl || ''
      }
      if (!url) throw new Error('Document URL unavailable')
      const suffix = page ? '#page=' + Number(page) : ''
      window.open(url + suffix, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e?.message || String(e))
    }
  }

  async function reviewFact(id, status) {
    const { data: authData } = await supabase.auth.getUser()
    await supabase.from('document_ai_facts').update({
      review_status: status,
      reviewed_by: authData?.user?.id || null,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id)
    load()
  }

  async function answerQuestion(q) {
    const answer = prompt(q.question, q.answer || '')
    if (answer === null) return
    const { data: authData } = await supabase.auth.getUser()
    await supabase.from('document_ai_questions').update({
      answer: String(answer),
      status: 'answered',
      answered_by: authData?.user?.id || null,
      answered_at: new Date().toISOString(),
    }).eq('id', q.id)
    load()
  }

  if (!clientId) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>AI Intelligence</h1>
            <p>Select a client to open their prepared file, analyze documents, and review AI findings.</p>
          </div>
        </div>

        {error && <div className="card" style={{border:'1px solid #ef4444',marginBottom:16,color:'#b91c1c'}}>{error}</div>}



        <div className="card" style={{maxWidth:760}}>
          <div className="form-group" style={{marginBottom:12}}>
            <label>Client</label>
            <select className="select" value={selectedClientId} onChange={e=>setSelectedClientId(e.target.value)}>
              <option value="">Select a client…</option>
              {clientOptions.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn primary" disabled={!selectedClientId} onClick={()=>navigate('/ai-intelligence/' + selectedClientId)}>
              Open AI Intelligence
            </button>
            <button className="btn" onClick={()=>navigate('/documents')}>Documents</button>
          </div>
          {!clientOptions.length && !error && <div style={{marginTop:14,fontSize:12,color:'var(--t3)'}}>No clients available.</div>}
        </div>
      </div>
    )
  }

  if (!client) {
    return <div><div className="page-header"><div><h1>AI Intelligence</h1><p>{error || 'Loading client file…'}</p></div></div></div>
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <button className="btn sm" onClick={()=>navigate('/ai-intelligence')} style={{marginBottom:10}}>← AI Intelligence</button>
          <h1>{client.name} — AI Intelligence</h1>
          <p>AI reads the client file, connects the facts, and surfaces only what still needs human review.</p>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'center'}}>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:30,fontWeight:900,color:'var(--pri,#6957ff)'}}>{ready}%</div>
            <div style={{fontSize:11,color:'var(--t3)'}}>FILE READ</div>
          </div>
          <button className="btn primary" disabled={busy || !docs.length} onClick={analyzeAll}>
            {busy ? 'Reading documents…' : '✦ Analyze unread documents'}
          </button>
        </div>
      </div>

      {error && <div className="card" style={{border:'1px solid #ef4444',marginBottom:16,color:'#b91c1c'}}>{error}</div>}

      <div className="card" style={{marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',flexWrap:'wrap'}}>
          <div>
            <div style={{fontWeight:900,fontSize:16}}>Upload & Analyze</div>
            <div style={{fontSize:12,color:'var(--t3)',marginTop:3}}>Upload a client document here and AI will read it immediately. Use Profit & Loss for P&L statements.</div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            <select className="select" value={uploadType} onChange={e=>setUploadType(e.target.value)} disabled={uploadBusy}>
              {['Auto-detect','Profit & Loss (P&L)','Tax Return','IRS / State Notice','W-2','1099','Bank Statement','Financial Statement','Pay Stub','Transcript','Other'].map(x=><option key={x} value={x}>{x}</option>)}
            </select>
            <input type="file" disabled={uploadBusy} onChange={e=>setUploadFile(e.target.files?.[0] || null)} accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.txt,.json,.xml,.rtf,.xls,.xlsx,.xlsm,.docx,.pptx" />
            <button className="btn primary" disabled={uploadBusy || !uploadFile} onClick={uploadAndAnalyze}>
              {uploadBusy ? (uploadStatus || 'Working…') : uploadType==='Profit & Loss (P&L)' ? '✦ Upload P&L & Analyze' : '✦ Upload & Analyze'}
            </button>
          </div>
        </div>
        {uploadFile && <div style={{fontSize:11,color:'var(--t3)',marginTop:8}}>Selected: {uploadFile.name} · {(uploadFile.size/1024/1024).toFixed(2)} MB</div>}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(5,minmax(0,1fr))',gap:12,marginBottom:16}}>
        {[
          ['Documents', docs.length],
          ['Facts found', currentFacts.length],
          ['People & entities', currentEntities.length],
          ['Tax years', taxYears.length],
          ['Open questions', openQuestions.length],
        ].map(([label,value])=>(
          <div className="card" key={label} style={{padding:16}}>
            <div style={{fontSize:24,fontWeight:900}}>{value}</div>
            <div style={{fontSize:12,color:'var(--t3)'}}>{label}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <div style={{display:'flex',gap:4,padding:'10px 12px',borderBottom:'1px solid var(--bd)'}}>
          {[
            ['overview','Overview'],
            ['documents','File Review'],
            ['entities','People & Entities'],
            ['facts','Tax Facts'],
            ['findings','Findings'],
            ['deadlines','Deadlines & Notices'],
            ['questions','Open Questions'],
            ['actions','Recommended Actions'],
            ['ask','Ask AI'],
          ].map(([key,label])=>(
            <button key={key} className={`btn sm ${tab===key?'primary':''}`} onClick={()=>setTab(key)}>{label}</button>
          ))}
        </div>

        <div style={{padding:18}}>
          {tab === 'overview' && (
            <div style={{display:'grid',gridTemplateColumns:'1.2fr .8fr',gap:16}}>
              <div>
                <h3 style={{marginTop:0}}>What AI found</h3>
                {runs.filter(r=>r.status==='complete').slice(0,8).map(r=>(
                  <div key={r.id} style={{padding:'12px 0',borderBottom:'1px solid var(--bd)'}}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:12}}>
                      <strong>{r.document_type || 'Document'} {r.tax_year ? `· ${r.tax_year}` : ''}</strong>
                      <span style={{fontSize:12,color:'var(--t3)'}}>{r.confidence == null ? '' : pct(r.confidence)+'% confidence'}</span>
                    </div>
                    <div style={{fontSize:13,color:'var(--t2)',marginTop:5,lineHeight:1.5}}>{r.summary || 'Analysis complete.'}</div>
                  </div>
                ))}
                {!runs.some(r=>r.status==='complete') && <div style={{color:'var(--t3)'}}>Run AI analysis to build the prepared client file.</div>}
              </div>
              <div>
                <h3 style={{marginTop:0}}>Needs attention</h3>
                {openQuestions.slice(0,8).map(q=>(
                  <button key={q.id} onClick={()=>answerQuestion(q)} style={{display:'block',width:'100%',textAlign:'left',padding:12,marginBottom:8,border:'1px solid var(--bd)',borderRadius:10,background:'var(--card)',cursor:'pointer'}}>
                    <div style={{fontWeight:700,fontSize:13}}>{q.question}</div>
                    {q.reason && <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>{q.reason}</div>}
                  </button>
                ))}
                {!openQuestions.length && <div style={{color:'var(--t3)'}}>No unanswered questions found.</div>}
              </div>
            </div>
          )}

          {tab === 'entities' && (
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10}}>
              {currentEntities.map(e=>(
                <div key={e.id} style={{border:'1px solid var(--bd)',borderRadius:12,padding:14}}>
                  <div style={{fontWeight:800}}>{e.display_name}</div>
                  <div style={{fontSize:12,color:'var(--t3)',marginTop:4}}>{e.entity_type}{e.relationship ? ' · '+e.relationship : ''}</div>
                  <div style={{fontSize:11,color:'var(--t3)',marginTop:8}}>
                    {e.source_locator || (e.source_page ? 'Source page ' + e.source_page : 'Source available')} · {e.confidence==null?'—':pct(e.confidence)+'%'}
                  </div>
                  {(e.source_page || e.source_locator) && <button className="btn sm" style={{marginTop:8}} onClick={()=>openSource(e.document_id,e.source_page)}>Open source</button>}
                </div>
              ))}
              {!currentEntities.length && <div style={{color:'var(--t3)'}}>No entities extracted yet.</div>}
            </div>
          )}

          {tab === 'facts' && (
            <div>
              {currentFacts.map(f=>(
                <div key={f.id} style={{display:'grid',gridTemplateColumns:'180px 1fr 120px 170px',gap:12,alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--bd)'}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:13}}>{f.field_label || f.field_key}</div>
                    <div style={{fontSize:10,color:'var(--t3)'}}>{f.category}</div>
                  </div>
                  <div style={{fontSize:13}}>
                    {f.normalized_text || (f.value_json == null ? '—' : typeof f.value_json === 'string' ? f.value_json : JSON.stringify(f.value_json))}
                    {(f.source_excerpt || f.source_locator || f.source_page) && <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>
                      <button className="btn sm" style={{marginRight:6,padding:'2px 6px'}} onClick={()=>openSource(f.document_id,f.source_page)}>
                        {f.source_locator || (f.source_page ? 'p.'+f.source_page : 'Source')}
                      </button>
                      {f.source_excerpt ? '“'+f.source_excerpt+'”' : ''}
                    </div>}
                  </div>
                  <div style={{fontSize:11,color:'var(--t3)'}}>{f.confidence==null?'—':pct(f.confidence)+'% confidence'}</div>
                  <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                    <button className="btn sm" onClick={()=>reviewFact(f.id,'verified')}>✓ Verify</button>
                    <button className="btn sm" onClick={()=>reviewFact(f.id,'rejected')}>✕ Reject</button>
                  </div>
                </div>
              ))}
              {!currentFacts.length && <div style={{color:'var(--t3)'}}>No facts extracted yet.</div>}
            </div>
          )}

          {tab === 'documents' && (
            <div>
              {docs.map(d=>{
                const run=latestByDoc.get(String(d.id))
                return (
                  <div key={d.id} style={{display:'grid',gridTemplateColumns:'1fr 180px 130px',gap:12,alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--bd)'}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:13}}>{d.file_name || d.name}</div>
                      <div style={{fontSize:11,color:'var(--t3)'}}>{d.docType || 'Document'} · {fmtDate(d.created_at)}</div>
                    </div>
                    <div style={{fontSize:12,color:run?.status==='complete'?'#16803a':'var(--t3)'}}>
                      {run ? run.status.replace('_',' ') : 'not analyzed'}
                    </div>
                    <button className="btn sm" disabled={activeDoc===d.id} onClick={async()=>{try{await analyzeDocument(d);await load()}catch(e){setError(e.message)}}}>
                      {activeDoc===d.id?'Reading…':'✦ Analyze'}
                    </button>
                  </div>
                )
              })}
              {!docs.length && <div style={{color:'var(--t3)'}}>No client documents are attached yet.</div>}
            </div>
          )}

          {tab === 'findings' && (
            <div>
              <h3 style={{marginTop:0}}>Findings that need review</h3>
              {reviewFindings.map(f=>(
                <div key={f.id} style={{padding:'11px 0',borderBottom:'1px solid var(--bd)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:12}}>
                    <strong>{f.field_label || f.field_key}</strong>
                    <span style={{fontSize:11,color:'var(--t3)'}}>{f.confidence==null?'—':pct(f.confidence)+'% confidence'}</span>
                  </div>
                  <div style={{fontSize:13,marginTop:4}}>{f.normalized_text || (f.value_json == null ? '—' : JSON.stringify(f.value_json))}</div>
                  <div style={{display:'flex',gap:6,marginTop:8}}>
                    {(f.source_page || f.source_locator) && <button className="btn sm" onClick={()=>openSource(f.document_id,f.source_page)}>Open source</button>}
                    <button className="btn sm" onClick={()=>reviewFact(f.id,'verified')}>✓ Verify</button>
                    <button className="btn sm" onClick={()=>reviewFact(f.id,'rejected')}>✕ Reject</button>
                  </div>
                </div>
              ))}
              {!reviewFindings.length && <div style={{color:'var(--t3)'}}>No unresolved findings currently need review.</div>}
            </div>
          )}

          {tab === 'deadlines' && (
            <div>
              <h3 style={{marginTop:0}}>Deadlines & notices found in the client file</h3>
              {noticeDeadlineFacts.map(f=>(
                <div key={f.id} style={{display:'grid',gridTemplateColumns:'180px 1fr 130px',gap:12,alignItems:'center',padding:'11px 0',borderBottom:'1px solid var(--bd)'}}>
                  <strong>{f.field_label || f.field_key}</strong>
                  <div>{f.normalized_text || (f.value_json == null ? '—' : JSON.stringify(f.value_json))}</div>
                  <button className="btn sm" onClick={()=>openSource(f.document_id,f.source_page)}>Open source</button>
                </div>
              ))}
              {!noticeDeadlineFacts.length && <div style={{color:'var(--t3)'}}>No notices or deadlines have been extracted yet.</div>}
            </div>
          )}

          {tab === 'actions' && (
            <div>
              <h3 style={{marginTop:0}}>Recommended next actions</h3>
              <p style={{fontSize:12,color:'var(--t3)',marginTop:-4}}>Suggestions are derived from unread documents, unanswered questions, unverified findings, and extracted deadlines. Staff decides what becomes case work.</p>
              {recommendedActions.map((action,index)=>(
                <div key={index} style={{display:'flex',alignItems:'center',gap:10,padding:'11px 0',borderBottom:'1px solid var(--bd)'}}>
                  <span style={{fontSize:11,textTransform:'uppercase',color:'var(--t3)',minWidth:72}}>{action.kind}</span>
                  <strong style={{fontSize:13}}>{action.text}</strong>
                </div>
              ))}
              {!recommendedActions.length && <div style={{color:'var(--t3)'}}>No AI-recommended follow-up is currently pending.</div>}
            </div>
          )}

          {tab === 'ask' && (
            <div style={{maxWidth:900}}>
              <h3 style={{marginTop:0}}>Ask AI about this client</h3>
              <p style={{fontSize:12,color:'var(--t3)'}}>Uses the current client’s document summaries, extracted facts, questions, notices and deadlines as context. It does not silently change CRM records.</p>
              <textarea className="textarea" rows={5} value={askText} onChange={e=>setAskText(e.target.value)} placeholder="Ask about the client file, case issues, missing information, deadlines, or next steps…" />
              <button className="btn primary" style={{marginTop:10}} disabled={askBusy || !askText.trim()} onClick={askClientAI}>{askBusy?'Thinking…':'Ask AI'}</button>
              {askReply && <div className="card" style={{marginTop:14,whiteSpace:'pre-wrap',lineHeight:1.6}}>{askReply}</div>}
            </div>
          )}

          {tab === 'questions' && (
            <div>
              {currentQuestions.map(q=>(
                <div key={q.id} style={{padding:'12px 0',borderBottom:'1px solid var(--bd)',opacity:q.status==='open'?1:.65}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:12}}>
                    <strong>{q.question}</strong>
                    <span style={{fontSize:11,textTransform:'uppercase',color:'var(--t3)'}}>{q.priority} · {q.status}</span>
                  </div>
                  {q.reason && <div style={{fontSize:12,color:'var(--t3)',marginTop:5}}>{q.reason}</div>}
                  {q.answer && <div style={{fontSize:12,marginTop:7}}><strong>Answer:</strong> {q.answer}</div>}
                  {q.status==='open' && <button className="btn sm" style={{marginTop:8}} onClick={()=>answerQuestion(q)}>Answer</button>}
                </div>
              ))}
              {!currentQuestions.length && <div style={{color:'var(--t3)'}}>No open questions detected.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
