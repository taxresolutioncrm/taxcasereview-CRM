import { validateFile } from '../lib/uploadUtils'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { ORGANIZER_STEPS, shouldShow } from '../lib/organizerSchema'
import { FIRM } from '../lib/firmBranding'

const LOGO_URL = ''  // replaced by FIRM.logoUrl

// Shared wizard engine. Used standalone (OrganizerPage.jsx, public link) and
// embedded inside ClientPortal.jsx. Persists answers to `tax_organizer_responses`
// keyed by organizerId (the row id), autosaving on every change and on step nav.
export default function OrganizerWizard({ organizerId, embedded = false, onComplete }) {
  const [record, setRecord] = useState(null)
  const [answers, setAnswers] = useState({})
  const [stepIdx, setStepIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [uploadingKey, setUploadingKey] = useState('')
  const saveTimer = useRef(null)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.rpc('organizer_get', { p_id: organizerId })
      if (error || !data) { setError('Organizer not found or expired.'); setLoading(false); return }
      setRecord(data)
      setAnswers(data.answers || {})
      if (data.status === 'Submitted') setSubmitted(true)
      setLoading(false)
    }
    if (organizerId) load()
  }, [organizerId])

  function setAnswer(id, value) {
    setAnswers(prev => {
      const next = { ...prev, [id]: value }
      scheduleSave(next)
      return next
    })
  }

  function scheduleSave(next) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(next), 900)
  }

  async function doSave(next) {
    setSaving(true)
    await supabase.rpc('organizer_save_answers', { p_id: organizerId, p_answers: next })
    setSaving(false)
  }

  async function handleUpload(questionId, file, entryIdx = null) {
    if (!file) return
    const key = entryIdx !== null ? `${questionId}_${entryIdx}` : questionId
    setUploadingKey(key)
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(reader.error || new Error('Could not read file'))
        reader.onload = () => resolve(String(reader.result || ''))
        reader.readAsDataURL(file)
      })
      const fileBase64 = String(dataUrl).split(',')[1] || ''
      const { data, error: uploadErr } = await supabase.functions.invoke('organizer-action', {
        body: {
          type: 'upload_document', organizerId,
          fileName: file.name, fileType: file.type || 'application/octet-stream', fileBase64,
        },
      })
      if (uploadErr || !data?.ok) throw new Error(data?.error || uploadErr?.message || 'Upload failed')
      if (entryIdx !== null) {
        updateEntry(questionId, entryIdx, '_uploadUrl', data.url || '')
      } else {
        setAnswer(questionId, data.url || '')
      }
    } catch (e) {
      setError('Upload failed: ' + e.message)
    } finally {
      setUploadingKey('')
    }
  }

  function addEntry(questionId, fields) {
    const current = answers[questionId] || []
    const blank = {}
    fields.forEach(f => blank[f.id] = '')
    setAnswer(questionId, [...current, blank])
  }
  function updateEntry(questionId, idx, fieldId, value) {
    const current = [...(answers[questionId] || [])]
    current[idx] = { ...current[idx], [fieldId]: value }
    setAnswer(questionId, current)
  }
  function removeEntry(questionId, idx) {
    const current = [...(answers[questionId] || [])]
    current.splice(idx, 1)
    setAnswer(questionId, current)
  }

  async function submit() {
    setSaving(true)
    await supabase.rpc('organizer_submit', { p_id: organizerId, p_answers: answers })
    setSaving(false)
    setSubmitted(true)
    if (onComplete) onComplete()
  }

  if (loading) return <div style={S.center}>Loading organizer…</div>
  if (error) return <div style={S.center}>{error}</div>

  if (submitted) return (
    <div style={S.card}>
      <div style={{textAlign:'center', padding:'32px 16px'}}>
        <div style={{fontSize:48, marginBottom:12}}>✅</div>
        <div style={{fontSize:19, fontWeight:800, color:'#4ade80', marginBottom:8}}>Organizer Submitted!</div>
        <div style={{color:'#94a3b8', fontSize:13.5, lineHeight:1.7}}>
          Thank you{record?.client_name ? `, ${record.client_name}` : ''}. Your responses for tax year {record?.tax_year} have been sent to {FIRM.name || 'Firm'}.
          {!embedded && ' You may close this window.'}
        </div>
      </div>
    </div>
  )

  const visibleSteps = ORGANIZER_STEPS
  const step = visibleSteps[stepIdx]
  const visibleQuestions = step.questions.filter(q => shouldShow(q, answers))
  const isLast = stepIdx === visibleSteps.length - 1
  const isFirst = stepIdx === 0
  const progressPct = Math.round(((stepIdx + 1) / visibleSteps.length) * 100)

  return (
    <div style={S.card}>
      {!embedded && (
        <div style={{textAlign:'center', marginBottom:18}}>
          <img src={FIRM.logoUrl} style={{height:42, marginBottom:8}} onError={e=>e.target.style.display='none'}/>
          <div style={{fontSize:11, fontWeight:800, color:'#60a5fa', letterSpacing:'.1em', textTransform:'uppercase'}}>{FIRM.name || 'Firm'}</div>
          <div style={{fontSize:11, color:'#64748b'}}>Tax Year {record?.tax_year} Organizer</div>
        </div>
      )}

      {/* Progress bar */}
      <div style={{marginBottom:18}}>
        <div style={{display:'flex', justifyContent:'space-between', fontSize:11, color:'#64748b', marginBottom:6}}>
          <span>Step {stepIdx+1} of {visibleSteps.length}</span>
          <span>{saving ? 'Saving…' : 'Saved'}</span>
        </div>
        <div style={{height:6, background:'#1e293b', borderRadius:3, overflow:'hidden'}}>
          <div style={{height:'100%', width:`${progressPct}%`, background:'#3b82f6', transition:'width .3s'}}/>
        </div>
      </div>

      <div style={{fontSize:18, fontWeight:800, color:'#f1f5f9', marginBottom:16}}>{step.title}</div>

      <div>
        {visibleQuestions.map(q => (
          <Question key={q.id} q={q} answers={answers} setAnswer={setAnswer}
            onUpload={handleUpload} uploadingKey={uploadingKey}
            addEntry={addEntry} updateEntry={updateEntry} removeEntry={removeEntry}
            taxYear={record?.tax_year}/>
        ))}
      </div>

      <div style={{display:'flex', gap:10, marginTop:24}}>
        {!isFirst && (
          <button onClick={()=>setStepIdx(i=>i-1)} style={S.btnSecondary}>← Back</button>
        )}
        {!isLast ? (
          <button onClick={()=>setStepIdx(i=>i+1)} style={S.btnPrimary}>Next →</button>
        ) : (
          <button onClick={submit} disabled={saving} style={S.btnSubmit}>{saving ? 'Submitting…' : 'Submit Organizer'}</button>
        )}
      </div>
    </div>
  )
}

function Question({ q, answers, setAnswer, onUpload, uploadingKey, addEntry, updateEntry, removeEntry, taxYear }) {
  const val = answers[q.id]

  if (q.type === 'info') {
    const text = (q.text || '').replace(/\{\{year\}\}/g, taxYear || '')
    return <div style={{...S.docBody, whiteSpace:'pre-wrap'}}>{text}</div>
  }

  return (
    <div style={{marginBottom:18}}>
      <label style={S.label}>{q.label}{q.optional && <span style={{color:'#64748b', fontWeight:400}}> (optional)</span>}</label>

      {q.type === 'yesno' && (
        <div style={{display:'flex', gap:10}}>
          {['Yes','No'].map(opt => (
            <button key={opt} onClick={()=>setAnswer(q.id, opt)} style={val===opt ? S.toggleActive : S.toggle}>{opt}</button>
          ))}
        </div>
      )}

      {q.type === 'select' && (
        <select value={val||''} onChange={e=>setAnswer(q.id, e.target.value)} style={S.input}>
          <option value="">— Select —</option>
          {q.options.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      )}

      {q.type === 'multiselect' && (
        <div style={{display:'flex', flexDirection:'column', gap:8}}>
          {q.options.map(o => {
            const arr = Array.isArray(val) ? val : []
            const checked = arr.includes(o)
            return (
              <label key={o} style={{display:'flex', alignItems:'flex-start', gap:8, fontSize:13, color:'#cbd5e1', cursor:'pointer'}}>
                <input type="checkbox" checked={checked} style={{marginTop:3}}
                  onChange={()=>{
                    const next = checked ? arr.filter(x=>x!==o) : [...arr, o]
                    setAnswer(q.id, next)
                  }}/>
                {o}
              </label>
            )
          })}
        </div>
      )}

      {q.type === 'text' && (
        <input type="text" value={val||''} onChange={e=>setAnswer(q.id, e.target.value)} style={S.input}/>
      )}

      {q.type === 'textarea' && (
        <textarea value={val||''} onChange={e=>setAnswer(q.id, e.target.value)} style={{...S.input, minHeight:80, resize:'vertical'}}/>
      )}

      {q.type === 'number' && (
        <input type="text" inputMode="decimal" value={formatMoneyInput(val)}
          onChange={e=>setAnswer(q.id, parseMoney(e.target.value))} style={S.input}/>
      )}

      {q.type === 'date' && (
        <input type="date" value={val||''} onChange={e=>setAnswer(q.id, e.target.value)} style={S.input}/>
      )}

      {q.type === 'upload' && (
        <div>
          {val ? (
            <div style={{display:'flex', alignItems:'center', gap:10, fontSize:12.5, color:'#4ade80'}}>
              ✅ {val.startsWith('http') ? 'Uploaded' : val}
              {val.startsWith('http') && <a href={val} target="_blank" rel="noreferrer" style={{color:'#60a5fa'}}>View</a>}
              <button onClick={()=>setAnswer(q.id,'')} style={S.linkBtn}>Replace</button>
            </div>
          ) : (
            <div>
              <input type="file" onChange={e=>onUpload(q.id, e.target.files[0])} style={{fontSize:12.5, color:'#94a3b8'}}/>
              {uploadingKey === q.id && <div style={{fontSize:11, color:'#64748b', marginTop:4}}>Uploading…</div>}
            </div>
          )}
          <div style={{marginTop:6}}>
            <button onClick={()=>setAnswer(q.id, 'Upload Later')} style={S.linkBtn}>Upload Later</button>
            <span style={{margin:'0 6px', color:'#475569'}}>·</span>
            <button onClick={()=>setAnswer(q.id, 'Provided Elsewhere')} style={S.linkBtn}>Provided Elsewhere</button>
          </div>
        </div>
      )}

      {q.type === 'entries' && (
        <div>
          {(val||[]).map((entry, idx) => (
            <div key={idx} style={{background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:8, padding:14, marginBottom:10}}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:8}}>
                <div style={{fontSize:11, fontWeight:700, color:'#60a5fa', textTransform:'uppercase'}}>Entry #{idx+1}</div>
                <button onClick={()=>removeEntry(q.id, idx)} style={{...S.linkBtn, color:'#f87171'}}>Remove</button>
              </div>
              {q.entryFields.map(f => (
                <div key={f.id} style={{marginBottom:8}}>
                  <div style={{fontSize:11, color:'#94a3b8', marginBottom:3}}>{f.label}</div>
                  {f.type === 'select' ? (
                    <select value={entry[f.id]||''} onChange={e=>updateEntry(q.id, idx, f.id, e.target.value)} style={S.inputSm}>
                      <option value="">— Select —</option>
                      {f.options.map(o=><option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'yesno' ? (
                    <div style={{display:'flex', gap:8}}>
                      {['Yes','No'].map(opt=>(
                        <button key={opt} onClick={()=>updateEntry(q.id, idx, f.id, opt)}
                          style={entry[f.id]===opt ? {...S.toggleActive, padding:'4px 14px', fontSize:12} : {...S.toggle, padding:'4px 14px', fontSize:12}}>{opt}</button>
                      ))}
                    </div>
                  ) : f.type === 'upload' ? (
                    entry['_uploadUrl'] ? (
                      <div style={{fontSize:12, color:'#4ade80'}}>✅ Uploaded</div>
                    ) : (
                      <input type="file" onChange={e=>onUpload(q.id, e.target.files[0], idx)} style={{fontSize:12, color:'#94a3b8'}}/>
                    )
                  ) : (
                    <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                      value={entry[f.id]||''} onChange={e=>updateEntry(q.id, idx, f.id, e.target.value)} style={S.inputSm}/>
                  )}
                </div>
              ))}
            </div>
          ))}
          <button onClick={()=>addEntry(q.id, q.entryFields)} style={S.btnAdd}>+ Add Entry</button>
        </div>
      )}
    </div>
  )
}

const S = {
  center: { display:'flex', alignItems:'center', justifyContent:'center', minHeight:300, color:'#64748b', fontSize:13 },
  card: { background:'#0f172a', border:'1px solid #1e293b', borderRadius:14, padding:'24px 22px', maxWidth:560, margin:'0 auto', width:'100%' },
  label: { display:'block', fontSize:13, fontWeight:700, color:'#e2e8f0', marginBottom:8 },
  input: { width:'100%', padding:'10px 12px', background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:8, color:'#f1f5f9', fontSize:13.5, boxSizing:'border-box' },
  inputSm: { width:'100%', padding:'7px 10px', background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:6, color:'#f1f5f9', fontSize:12.5, boxSizing:'border-box' },
  toggle: { padding:'8px 22px', borderRadius:7, border:'1px solid #334155', background:'#0a1628', color:'#94a3b8', fontSize:13, fontWeight:600, cursor:'pointer' },
  toggleActive: { padding:'8px 22px', borderRadius:7, border:'1px solid #3b82f6', background:'#1d4ed8', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' },
  btnPrimary: { flex:1, padding:'13px', background:'#1d4ed8', color:'#fff', border:'none', borderRadius:9, fontSize:14, fontWeight:700, cursor:'pointer' },
  btnSecondary: { padding:'13px 20px', background:'transparent', color:'#94a3b8', border:'1px solid #334155', borderRadius:9, fontSize:14, fontWeight:600, cursor:'pointer' },
  btnSubmit: { flex:1, padding:'13px', background:'#16a34a', color:'#fff', border:'none', borderRadius:9, fontSize:14, fontWeight:700, cursor:'pointer' },
  btnAdd: { padding:'8px 16px', background:'transparent', border:'1px dashed #3b82f6', color:'#60a5fa', borderRadius:7, fontSize:12.5, fontWeight:600, cursor:'pointer' },
  linkBtn: { background:'none', border:'none', color:'#64748b', fontSize:11.5, cursor:'pointer', textDecoration:'underline', padding:0 },
  docBody: { background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:9, padding:16, fontSize:13, lineHeight:1.7, color:'#cbd5e1' },
}
