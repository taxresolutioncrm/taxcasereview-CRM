import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Oculivo native leads are distinct from scheduled calevents.
// Admin-only RLS is the data boundary; this UI never exposes service role keys.
export default function AdminOculivoDemoRequests() {
  const [items,setItems]=useState([])
  const [error,setError]=useState('')
  const [saving,setSaving]=useState('')
  const [taskView,setTaskView]=useState('open')
  const [drafts,setDrafts]=useState({})
  const load=useCallback(async()=>{
    const fields='id,product_id,lead_name,lead_email,practice_name,specialty,locations,notes,created_at,assigned_to,followup_status,followup_due_at,contacted_at,contact_outcome,notification_submission_id,notification_last_error'
    const [open,completed]=await Promise.all([
      supabase.from('romylabs_demo_requests').select(fields).neq('followup_status','completed').order('created_at',{ascending:false}).limit(100),
      supabase.from('romylabs_demo_requests').select(fields).eq('followup_status','completed').order('created_at',{ascending:false}).limit(100),
    ])
    if(open.error||completed.error){setError('Oculivo demo request tasks unavailable: '+(open.error||completed.error).message);return}
    setError('');setItems([...(open.data||[]),...(completed.data||[])])
  },[])
  useEffect(()=>{
    void load()
    const interval=setInterval(()=>{if(document.visibilityState==='visible')void load()},45000)
    const focused=()=>{void load()}
    window.addEventListener('focus',focused)
    return()=>{clearInterval(interval);window.removeEventListener('focus',focused)}
  },[load])

  async function save(item){
    const draft=drafts[item.id]||{}
    const status=draft.followup_status||item.followup_status
    const assigned=(draft.assigned_to??item.assigned_to??'').trim()
    const outcome=(draft.contact_outcome??item.contact_outcome??'').trim()
    if(!assigned){setError('Assigned owner is required.');return}
    if(['contacted','completed'].includes(status)&&!outcome){setError('Record a contact outcome before marking a lead contacted/completed.');return}
    if(status==='completed'&&!item.contacted_at&&item.followup_status!=='contacted'){setError('Mark the lead contacted before completing follow-up.');return}
    const patch={followup_status:status,assigned_to:assigned,contact_outcome:outcome||null}
    if(['contacted','completed'].includes(status))patch.contacted_at=item.contacted_at||new Date().toISOString()
    setSaving(item.id);setError('')
    const {error:err}=await supabase.from('romylabs_demo_requests').update(patch).eq('id',item.id)
    setSaving('')
    if(err){setError(err.message);return}
    setDrafts(v=>{const next={...v};delete next[item.id];return next})
    await load()
  }
  const visibleItems=items.filter(item=>taskView==='completed'?item.followup_status==='completed':item.followup_status!=='completed')
  const completedCount=items.filter(item=>item.followup_status==='completed').length
  const openCount=items.length-completedCount
  const field={background:'#10192b',color:'#f1f5f9',border:'1px solid #38445a',borderRadius:8,padding:'9px 11px',fontSize:13,width:'100%'}
  const btn={background:'#252e45',color:'#f1f5f9',border:'1px solid #41516f',borderRadius:8,padding:'9px 13px',cursor:'pointer'}
  return <section aria-label="Oculivo Website Demo Requests" style={{margin:'18px 0 24px',padding:18,border:'1px solid #31405a',borderRadius:14,background:'#11192b'}}>
    <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:16}}>
      <div><h2 style={{margin:0,fontSize:19,color:'#f1f5f9'}}>Oculivo Website Demo Requests</h2>
        <p style={{margin:'5px 0 0',color:'#a7b3c9',fontSize:13}}>New contact-form leads. Each submission creates a durable follow-up task, separate from scheduled bookings.</p></div>
      <div style={{display:'flex',gap:10,alignItems:'center'}}>
        <button type="button" aria-pressed={taskView==='open'} onClick={()=>setTaskView('open')} style={{...btn,borderColor:taskView==='open'?'#818cf8':'#41516f'}}>Open ({openCount})</button>
        <button type="button" aria-pressed={taskView==='completed'} onClick={()=>setTaskView('completed')} style={{...btn,borderColor:taskView==='completed'?'#818cf8':'#41516f'}}>Completed ({completedCount})</button>
        <button type="button" style={btn} onClick={()=>void load()}>Refresh</button>
      </div>
    </div>
    {error&&<p role="alert" style={{color:'#fecaca'}}>{error}</p>}
    {!visibleItems.length?<p style={{color:'#94a3b8'}}>{taskView==='completed'?'No completed Oculivo website demo requests yet.':'No open Oculivo website demo requests.'}</p>:<div style={{display:'grid',gap:11}}>
      {visibleItems.map(item=>{
        const draft=drafts[item.id]||{}
        const update=(key,value)=>setDrafts(v=>({...v,[item.id]:{...v[item.id],[key]:value}}))
        return <article key={item.id} style={{background:'#17243a',border:'1px solid #31405a',padding:16,borderRadius:12}}>
          <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:12}}>
            <div><strong style={{color:'#fff'}}>{item.lead_name}</strong> · <strong style={{color:'#d8b4fe'}}>{item.practice_name}</strong>
              <p style={{color:'#b2c1d7',margin:'6px 0',fontSize:13}}>{item.specialty} · {item.locations} location(s) · {new Date(item.created_at).toLocaleString()}</p>
              <a href={'mailto:'+encodeURIComponent(item.lead_email)} style={{color:'#7dd3fc'}}>{item.lead_email}</a>
              {item.notes&&<p style={{color:'#cbd5e1',whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:13}}>{item.notes}</p>}
            </div>
            <div style={{fontSize:12,color:item.notification_submission_id?'#86efac':'#fbbf24'}}>
              {item.notification_submission_id?'Email submitted to Stalwart':'Email not confirmed — contact lead directly'}
              {item.notification_last_error&&<div style={{maxWidth:280,color:'#fda4af'}}>Transport: {item.notification_last_error}</div>}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginTop:14}}>
            <label style={{fontSize:12,color:'#cbd5e1'}}>Owner
              <input aria-label={'Owner for '+item.lead_name} style={field} value={draft.assigned_to??item.assigned_to??''} onChange={e=>update('assigned_to',e.target.value)}/>
            </label>
            <label style={{fontSize:12,color:'#cbd5e1'}}>Status
              <select aria-label={'Status for '+item.lead_name} style={field} value={draft.followup_status??item.followup_status} onChange={e=>update('followup_status',e.target.value)}>
                <option value="new">New</option><option value="acknowledged">Acknowledged</option><option value="contacted">Contacted</option><option value="completed">Completed</option>
              </select>
            </label>
            <div style={{fontSize:12,color:'#cbd5e1'}}>Follow-up due
              <div style={{marginTop:9,color:new Date(item.followup_due_at)<new Date()?'#fda4af':'#f1f5f9'}}>{new Date(item.followup_due_at).toLocaleString()}</div>
            </div>
          </div>
          <label style={{display:'block',fontSize:12,color:'#cbd5e1',marginTop:12}}>Contact outcome
            <textarea style={{...field,minHeight:64,resize:'vertical'}} maxLength={2000} value={draft.contact_outcome??item.contact_outcome??''} onChange={e=>update('contact_outcome',e.target.value)} placeholder="When contacted, note the result before completing"/>
          </label>
          <button type="button" disabled={saving===item.id||!drafts[item.id]} style={{...btn,marginTop:12,opacity:saving===item.id ? .6 : 1}} onClick={()=>void save(item)}>{saving===item.id?'Saving…':'Save follow-up'}</button>
        </article>
      })}
    </div>}
  </section>
}
