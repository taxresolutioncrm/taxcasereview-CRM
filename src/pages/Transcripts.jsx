import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'

const YEARS = Array.from({length:21},(_,i)=>2026-i)
const BLANK = { clientName:'', transcriptType:'Tax Return (1040)', taxYears:[], taxYearsCustom:'', requestDate:'', receivedDate:'', method:'IRS e-Services', status:'Pending', assignedTo:'', notes:'' }
const TRANSCRIPT_TYPES = {
  'Individual': ['Tax Return (1040)','Account Transcript','Wage and Income (W-2/1099)','Record of Account','Verification of Non-Filing'],
  'Business': ['Business Return (1120/1065)','Business Account Transcript','Employment Tax (941)','940 FUTA'],
  'Penalties': ['Civil Penalty Transcript','Trust Fund Recovery Penalty','Payroll Tax (940/941)'],
  'State': ['State Tax Return','State Account Transcript','State Wage & Income'],
}
const REQUEST_METHODS = ['IRS e-Services','CAF Unit (Fax)','IRS Online Portal','Phone (800-829-1040)','Mail Form 4506-T','State Agency']
const STATUSES = ['Pending','Requested — Waiting','Received — Partial','Received — Complete','Error / Rejected','On Hold']

export default function Transcripts() {
  const { myTenantId } = useApp()
  const location = useLocation()
  const [items,     setItems]    = useState([])
  const [clients,   setClients]  = useState([])
  const [employees, setEmployees]= useState([])
  const [modal,     setModal]    = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [editId,    setEditId]   = useState(null)
  const [form,      setForm]     = useState(BLANK)
  const [saving,    setSaving]   = useState(false)
  const [toast,     setToast]    = useState('')
  const [search,    setSearch]   = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [suggestions, setSug]    = useState([])
  const [showSug,   setShowSug]  = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  useEffect(() => {
    if (new URLSearchParams(location.search).get('new') === '1') {
      setForm(BLANK)
      setEditId(null)
      setModal(true)
    }
  }, [location.search])


  useEffect(() => { if (myTenantId) load() }, [myTenantId])

  async function load() {
    const [{ data:t },{ data:c },{ data:e }] = await Promise.all([
      supabase.from('transcripts').select('*').eq('tenant_id', myTenantId).order('created_at',{ascending:false}),
      supabase.from('clients').select('id,name,ssn,taxYears,assignedTo').eq('tenant_id', myTenantId),
      supabase.from('employees').select('name').eq('tenant_id', myTenantId),
    ])
    if (t) setItems(t)
    if (c) setClients(c)
    if (e) setEmployees(e)
  }

  function showToast(msg) { setToast(msg); setTimeout(()=>setToast(''),3000) }
  function fld(k,v) { setForm(f=>({...f,[k]:v})) }

  function toggleYear(y) {
    setForm(f=>({...f, taxYears: f.taxYears.includes(String(y)) ? f.taxYears.filter(x=>x!==String(y)) : [...f.taxYears, String(y)]}))
  }

  function searchClient(val) {
    fld('clientName',val)
    if (val.length<2) { setSug([]); setShowSug(false); return }
    const matches = clients.filter(c=>c.name.toLowerCase().includes(val.toLowerCase())).slice(0,6)
    setSug(matches); setShowSug(matches.length>0)
  }

  function selectClient(c) {
    fld('clientName',c.name)
    if (c.assignedTo) fld('assignedTo',c.assignedTo)
    // Pre-fill years from client record
    if (c.taxYears) {
      const yrs = c.taxYears.split(/[,\s]+/).map(y=>y.trim()).filter(y=>y.match(/^\d{4}$/))
      if (yrs.length) setForm(f=>({...f, clientName:c.name, taxYears:yrs}))
    }
    setSug([]); setShowSug(false)
  }

  async function save() {
    if (!form.clientName) { showToast('Client required'); return }
    setSaving(true)
    const payload = { ...form, taxYears:JSON.stringify(form.taxYears), requestDate: form.requestDate||new Date().toISOString().slice(0,10) }
    let error
    if (editId) {
      ;({error} = await supabase.from('transcripts').update({...payload, updated_at:new Date().toISOString()}).eq('id',editId))
    } else {
      ;({error} = await supabase.from('transcripts').insert([{...payload, created_at:new Date().toISOString()}]))
    }
    setSaving(false)
    if (error) { showToast('Error: '+error.message); return }
    showToast('✅ Transcript request saved!')
    setModal(false); setForm(BLANK); setEditId(null); load()
  }

  async function updateStatus(id, status) {
    const update = {status, updated_at:new Date().toISOString()}
    if (status.includes('Received')) update.receivedDate = new Date().toISOString().slice(0,10)
    const { error } = await supabase.from('transcripts').update(update).eq('id',id)
    if (error) { showToast('Error: ' + error.message); return }
    load()
  }

  async function del(id) { setConfirmDel(id) }
  async function confirmDelTranscript() {
    const { error } = await supabase.from('transcripts').delete().eq('id', confirmDel)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    setItems(prev => prev.filter(i => i.id !== confirmDel)); setConfirmDel(null); showToast('Deleted')
  }

  function parseYears(t) {
    try { return JSON.parse(t?.taxYears||'[]') } catch { return [] }
  }

  const reps = employees.length>0 ? employees.map(e=>e.name) : ['Romy Cruz','Dana Richard','Yesenia Gonzalez']

  const filtered = items.filter(i=>{
    const q = search.toLowerCase()
    const ms = !q || i.clientName?.toLowerCase().includes(q) || i.transcriptType?.toLowerCase().includes(q)
    const mst = filterStatus==='All' || i.status===filterStatus
    return ms && mst
  })

  const statusColors = { 'Pending':'ba','Requested — Waiting':'bb','Received — Partial':'bw','Received — Complete':'bg','Error / Rejected':'br','On Hold':'bn' }

  return (
    <div style={{padding:'20px 24px',maxWidth:700,margin:'0 auto'}}>
      {toast&&<div className="toast show">{toast}</div>}

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:8}}>
        <h2 style={{fontSize:15,fontWeight:700,margin:0}}>📄 IRS Transcripts</h2>
        <button className="btn pri" onClick={()=>{setForm(BLANK);setEditId(null);setModal(true)}}>+ Request Transcript</button>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:8,marginBottom:14}}>
        {[
          ['Total Requests',items.length,'var(--tx)'],
          ['Pending',items.filter(i=>i.status==='Pending'||i.status==='Requested — Waiting').length,'var(--warn)'],
          ['Received',items.filter(i=>i.status?.includes('Received')).length,'var(--ok)'],
          ['Complete',items.filter(i=>i.status==='Received — Complete').length,'var(--ok)'],
          ['Issues',items.filter(i=>i.status?.includes('Error')||i.status==='On Hold').length,'var(--bad)'],
        ].map(([label,val,color])=>(
          <div key={label} className="card" style={{padding:'10px 12px',textAlign:'center'}}>
            <div style={{fontWeight:800,fontSize:18,color,lineHeight:1}}>{val}</div>
            <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search client or type…"
          style={{flex:1,minWidth:160,padding:'7px 12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12}}/>
        {['All','Pending','Requested — Waiting','Received — Complete','Error / Rejected'].map(s=>(
          <button key={s} className={`btn ${filterStatus===s?'pri':'sec'}`}
            style={{fontSize:10,padding:'4px 10px',whiteSpace:'nowrap'}} onClick={()=>setFilterStatus(s)}>
            {s==='Requested — Waiting'?'Waiting':s==='Received — Complete'?'Complete':s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        {filtered.length===0 ? (
          <div style={{padding:24,textAlign:'center',color:'var(--t3)',fontSize:13}}>
            {items.length===0?'No transcript requests yet.':'No requests match your filters.'}
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--br)',background:'var(--s2)'}}>
                {['Client','Type','Tax Years','Method','Requested','Received','Rep','Status','Actions'].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.05em'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t=>{
                const years = parseYears(t)
                const isExpanded = expandedId===t.id
                return (
                  <>
                    <tr key={t.id} style={{borderBottom:'1px solid var(--br)',background:isExpanded?'var(--s2)':''}}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                      onMouseLeave={e=>e.currentTarget.style.background=isExpanded?'var(--s2)':''}>
                      <td style={{padding:'9px 12px',fontWeight:600}}>{t.clientName}</td>
                      <td style={{padding:'9px 12px',color:'var(--t2)',fontSize:11}}>{t.transcriptType}</td>
                      <td style={{padding:'9px 12px'}}>
                        <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                          {years.slice(0,4).map(y=><span key={y} className="bdg bn" style={{fontSize:9}}>{y}</span>)}
                          {years.length>4&&<span style={{fontSize:10,color:'var(--t3)'}}>+{years.length-4}</span>}
                          {t.taxYearsCustom&&!years.length&&<span style={{fontSize:11,color:'var(--t2)'}}>{t.taxYearsCustom}</span>}
                        </div>
                      </td>
                      <td style={{padding:'9px 12px',color:'var(--t2)',fontSize:11}}>{t.method||'—'}</td>
                      <td style={{padding:'9px 12px',color:'var(--t2)'}}>{t.requestDate||'—'}</td>
                      <td style={{padding:'9px 12px',color:t.receivedDate?'var(--ok)':'var(--t3)'}}>{t.receivedDate||'—'}</td>
                      <td style={{padding:'9px 12px',color:'var(--t2)',fontSize:11}}>{t.assignedTo||'—'}</td>
                      <td style={{padding:'9px 12px'}}>
                        <select value={t.status||'Pending'}
                          onChange={e=>updateStatus(t.id,e.target.value)}
                          style={{fontSize:10,padding:'3px 6px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:4,color:'var(--tx)',cursor:'pointer'}}>
                          {STATUSES.map(s=><option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{padding:'9px 12px'}}>
                        <div style={{display:'flex',gap:5}}>
                          <button className="btn sec" style={{fontSize:10,padding:'3px 8px'}} onClick={()=>{setForm({...BLANK,...t,taxYears:parseYears(t)});setEditId(t.id);setModal(true)}}>Edit</button>
                          <button className="btn sec" style={{fontSize:10,padding:'3px 8px'}} onClick={()=>setExpandedId(isExpanded?null:t.id)}>{isExpanded?'▲':'▼'}</button>
                          <button className="btn del" style={{fontSize:10,padding:'3px 8px'}} onClick={()=>del(t.id)}>Del</button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded&&(
                      <tr key={t.id+'detail'}>
                        <td colSpan={9} style={{padding:'10px 16px',background:'var(--s3)',borderBottom:'1px solid var(--br)'}}>
                          <div className="form-grid2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                            <div>
                              <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',marginBottom:6}}>Tax Years Requested</div>
                              <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                                {years.map(y=><span key={y} className="bdg bb" style={{fontSize:11}}>{y}</span>)}
                                {t.taxYearsCustom&&<span style={{fontSize:11,color:'var(--t2)'}}>{t.taxYearsCustom}</span>}
                              </div>
                            </div>
                            {t.notes&&(
                              <div>
                                <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',marginBottom:6}}>Notes</div>
                                <div style={{fontSize:12,color:'var(--t2)',lineHeight:1.5}}>{t.notes}</div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal&&(
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&(setModal(false),setEditId(null))}>
          <div className="modal" style={{width:620}}>
            <div className="mh">
              <span className="mt">{editId?'Edit Transcript Request':'Request Transcript'}</span>
              <button className="xbtn" onClick={()=>{setModal(false);setEditId(null)}}>&times;</button>
            </div>

            <div className="field" style={{position:'relative'}}>
              <label>Client * (search)</label>
              <input value={form.clientName} onChange={e=>searchClient(e.target.value)}
                placeholder="Search clients…" autoComplete="off"
                onBlur={()=>setTimeout(()=>setShowSug(false),150)}/>
              {showSug&&suggestions.length>0&&(
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--s3)',border:'1px solid var(--b2c)',borderRadius:7,zIndex:500}}>
                  {suggestions.map(c=>(
                    <div key={c.id} onClick={()=>selectClient(c)}
                      style={{padding:'8px 12px',cursor:'pointer',fontSize:13,borderBottom:'1px solid var(--br)'}}>
                      {c.name}
                      {c.taxYears&&<span style={{fontSize:10,color:'var(--t3)',marginLeft:8}}>Tax years: {c.taxYears}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="field"><label>Transcript Type</label>
              <select value={form.transcriptType} onChange={e=>fld('transcriptType',e.target.value)}>
                {Object.entries(TRANSCRIPT_TYPES).map(([group,types])=>(
                  <optgroup key={group} label={group}>
                    {types.map(t=><option key={t}>{t}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="field"><label>Tax Years (click to select)</label>
              <div style={{background:'var(--s2)',border:'1px solid var(--br)',borderRadius:7,padding:'8px 10px',maxHeight:90,overflowY:'auto',display:'flex',flexWrap:'wrap',gap:'4px 14px'}}>
                {YEARS.map(y=>(
                  <label key={y} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:12,cursor:'pointer',whiteSpace:'nowrap',
                    color:form.taxYears.includes(String(y))?'var(--blue)':'var(--t2)',fontWeight:form.taxYears.includes(String(y))?700:400}}>
                    <input type="checkbox" checked={form.taxYears.includes(String(y))} onChange={()=>toggleYear(y)} style={{width:'auto'}}/>
                    {y}
                  </label>
                ))}
              </div>
              {form.taxYears.length>0&&(
                <div style={{fontSize:11,color:'var(--blue)',marginTop:4,fontWeight:600}}>Selected: {form.taxYears.join(', ')}</div>
              )}
              <input value={form.taxYearsCustom} onChange={e=>fld('taxYearsCustom',e.target.value)}
                placeholder="Or type custom years: 2018, 2017…" style={{marginTop:6}}/>
            </div>

            <div className="fg2">
              <div className="field"><label>Request Method</label>
                <select value={form.method||'IRS e-Services'} onChange={e=>fld('method',e.target.value)}>
                  {REQUEST_METHODS.map(m=><option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="field"><label>Assigned To</label>
                <select value={form.assignedTo||''} onChange={e=>fld('assignedTo',e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {reps.map(r=><option key={r}>{r}</option>)}
                </select>
              </div>
            </div>

            <div className="fg2">
              <div className="field"><label>Request Date</label><input type="date" value={form.requestDate} onChange={e=>fld('requestDate',e.target.value)}/></div>
              <div className="field"><label>Date Received (if done)</label><input type="date" value={form.receivedDate||''} onChange={e=>fld('receivedDate',e.target.value)}/></div>
            </div>

            <div className="fg2">
              <div className="field"><label>Status</label>
                <select value={form.status} onChange={e=>fld('status',e.target.value)}>
                  {STATUSES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="field"><label>Notes</label><input value={form.notes||''} onChange={e=>fld('notes',e.target.value)}/></div>
            </div>

            <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:10}} onClick={save} disabled={saving}>
              {saving?'Saving…':editId?'Update Request':'Submit Transcript Request'}
            </button>
          </div>
        </div>
      )}
      <DeleteConfirmModal open={!!confirmDel} label="transcript request" onConfirm={confirmDelTranscript} onCancel={() => setConfirmDel(null)} />
    </div>
  )
}

