import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Durable, server-recorded new booking alerts. Never depends on email or the tab
// being open when a visitor books an appointment.
export default function AdminBookingAlerts({workspace=false}) {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(workspace)
  const [showCompleted, setShowCompleted] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [expandedTask,setExpandedTask]=useState(null)
  const [taskFilter, setTaskFilter] = useState('open')
  const [drafts, setDrafts] = useState({})
  const [savingTask, setSavingTask] = useState(null)
  const [saveNotice, setSaveNotice] = useState('')
  const [activityEditor,setActivityEditor]=useState(null)
  const [activityDraft,setActivityDraft]=useState({type:'email_sent',notes:'',nextDate:'',nextTime:''})
  const [history,setHistory]=useState({})
  const [historyOpen,setHistoryOpen]=useState(null)
  const [submittingActivity,setSubmittingActivity]=useState(false)
  const load = useCallback(async () => {
    const {data,error:queryError} = await supabase
      .from('romylabs_booking_alerts')
      .select('booking_id,product_id,lead_name,lead_email,appointment_type,appointment_date,appointment_time,booked_at,acknowledged_at,notification_submission_id,notification_submitted_at,notification_last_error,followup_status,assigned_to,contacted_at,contact_outcome,followup_due_at')
      .in('followup_status',showCompleted?['new','acknowledged','contacted','completed']:['new','acknowledged','contacted'])
      .order('booked_at',{ascending:false}).limit(100)
    if (queryError) { setError('Booking alerts unavailable — check database migration and access.'); return }
    setError('')
    setItems(data || [])
  }, [showCompleted])
  useEffect(() => {
    void load()
    const interval = setInterval(() => { void load() }, 30000)
    const onFocus = () => { void load() }
    window.addEventListener('focus',onFocus)
    return () => { clearInterval(interval); window.removeEventListener('focus',onFocus) }
  }, [load])
  async function updateTask(id,fields) {
    const {error:writeError}=await supabase.from('romylabs_booking_alerts').update(fields).eq('booking_id',id)
    if(writeError){setError('Unable to save task changes: '+writeError.message);return}
    await load()
  }
  function startEditing(item) {
    if(editingTask===item.booking_id){setEditingTask(null);return}
    const local=new Date(item.followup_due_at||item.booked_at)
    const pad=n=>String(n).padStart(2,'0')
    setDrafts(previous=>({...previous,[item.booking_id]:{
      assigned_to:item.assigned_to||'',
      followup_status:item.followup_status,
      date:local.getFullYear()+'-'+pad(local.getMonth()+1)+'-'+pad(local.getDate()),
      time:pad(local.getHours())+':'+pad(local.getMinutes())
    }}))
    setEditingTask(item.booking_id)
    setSaveNotice('')
  }
  async function saveTask(item) {
    const draft=drafts[item.booking_id]
    if(!draft?.assigned_to?.trim()||!draft.date||!draft.time){setError('Enter an owner, date and time before saving.');return}
    const due=new Date(draft.date+'T'+draft.time)
    if(Number.isNaN(due.getTime())){setError('Choose a valid follow-up date and time.');return}
    const status=draft.followup_status
    if(!['new','acknowledged','contacted','completed'].includes(status)){setError('Choose a valid task status.');return}
    if(['contacted','completed'].includes(status) && (!item.contacted_at||!item.contact_outcome?.trim())){
      setError('Please log the contact details first using Log activity / Update status, then save this task status.');setActivityEditor(item.booking_id);setExpandedTask(item.booking_id);return
    }
    // The database requires contact first; only previously contacted tasks can be completed.
    if(status==='completed' && item.followup_status!=='contacted' && item.followup_status!=='completed'){
      setError('Record contact and set the task to Contacted before marking it Done.');return
    }
    setSavingTask(item.booking_id)
    const fields={assigned_to:draft.assigned_to.trim(),followup_due_at:due.toISOString(),
      followup_status:status,
      acknowledged_at:status!=='new'?(item.acknowledged_at||new Date().toISOString()):item.acknowledged_at,
      completed_at:status==='completed'?(item.completed_at||new Date().toISOString()):null}
    const {data,error:writeError}=await supabase.from('romylabs_booking_alerts').update(fields).eq('booking_id',item.booking_id).select('booking_id,assigned_to,followup_due_at,followup_status').single()
    setSavingTask(null)
    if(writeError||!data){setError('Could not save task: '+(writeError?.message||'No updated record returned'));return}
    setError('')
    setEditingTask(null)
    setSaveNotice('Task status and follow-up saved successfully.')
    await load()
  }
  async function acknowledge(id) {
    const {error} = await supabase.from('romylabs_booking_alerts')
      .update({acknowledged_at:new Date().toISOString(),followup_status:'acknowledged'}).eq('booking_id',id)
    if (error) {setError('Could not acknowledge booking. Try again.');return}
    await load()
  }
  const activityTypes=[['email_sent','Email Sent'],['called_no_answer','Called — No Answer'],['voicemail_left','Voicemail Left'],['spoke_with_lead','Spoke With Lead'],['awaiting_response','Awaiting Response'],['followup_scheduled','Follow-Up Scheduled'],['other','Other']]
  async function loadHistory(id){
    const {data,error:readError}=await supabase.from('romylabs_booking_activities').select('id,activity_type,notes,created_at').eq('booking_id',id).order('created_at',{ascending:false}).limit(100)
    if(readError){setError('Unable to load contact history: '+readError.message);return}
    setHistory(old=>({...old,[id]:data||[]}))
  }
  async function showHistory(id){
    if(historyOpen===id){setHistoryOpen(null);return}
    await loadHistory(id)
    setHistoryOpen(id)
  }
  async function markContacted(item) {
    setActivityEditor(item.booking_id)
    setHistoryOpen(item.booking_id)
    void loadHistory(item.booking_id)
    setActivityDraft({type:'email_sent',notes:'',nextDate:'',nextTime:''})
    setError('')
  }
  async function recordActivity(item){
    if(!activityDraft.notes.trim()){setError('Enter what happened before saving this activity.');return}
    let nextFollowup=null
    if(activityDraft.nextDate || activityDraft.nextTime){
      if(!activityDraft.nextDate||!activityDraft.nextTime){setError('Choose both a follow-up date and time.');return}
      const due=new Date(activityDraft.nextDate+'T'+activityDraft.nextTime)
      if(Number.isNaN(due.getTime())){setError('Choose a valid follow-up date and time.');return}
      nextFollowup=due.toISOString()
    }
    setSubmittingActivity(true)
    const {error:writeError}=await supabase.rpc('romylabs_record_booking_activity',{p_booking_id:item.booking_id,p_activity_type:activityDraft.type,p_notes:activityDraft.notes.trim(),p_next_followup:nextFollowup})
    setSubmittingActivity(false)
    if(writeError){setError('Could not record activity: '+writeError.message);return}
    setActivityEditor(null)
    setSaveNotice('Contact activity saved with timestamp.')
    const {data,error:readError}=await supabase.from('romylabs_booking_activities').select('id,activity_type,notes,created_at').eq('booking_id',item.booking_id).order('created_at',{ascending:false}).limit(100)
    if(!readError){setHistory(old=>({...old,[item.booking_id]:data||[]}));setHistoryOpen(item.booking_id)}
    await load()
  }
  async function complete(item) {
    if(item.followup_status!=='contacted'){setError('Record contact before completing.');return}
    const {error} = await supabase.from('romylabs_booking_alerts').update({followup_status:'completed',completed_at:new Date().toISOString()}).eq('booking_id',item.booking_id)
    if(error){setError('Unable to complete task.');return}
    await load()
  }
  const overdue = items.filter(item => item.followup_status!=='completed' && new Date(item.followup_due_at||item.booked_at).getTime() < Date.now()).length
  const awaitingContact = items.filter(item => ['new','acknowledged'].includes(item.followup_status)).length
  const filteredItems=items.filter(item=>{
    if(taskFilter==='contact')return ['new','acknowledged'].includes(item.followup_status)
    if(taskFilter==='overdue')return item.followup_status!=='completed' && new Date(item.followup_due_at||item.booked_at).getTime()<Date.now()
    return item.followup_status!=='completed' || showCompleted
  })
  const buttonBase={border:'1px solid #374151',background:'#1e293b',color:'#e2e8f0',fontSize:13,fontWeight:650,padding:'9px 13px',borderRadius:9,cursor:'pointer',whiteSpace:'nowrap'}
  const fieldBase={background:'#0b1221',border:'1px solid #475569',color:'#f8fafc',padding:'10px 11px',borderRadius:9,fontSize:13,maxWidth:'100%'}
  return (
    <section aria-label="Demo Leads and Tasks" style={{background:workspace?'transparent':'#151b29',color:'#f1f5f9',padding:workspace?0:'12px 16px',width:'100%',boxSizing:'border-box'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,flexWrap:'wrap',marginBottom:18}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <span style={{fontSize:15,fontWeight:750}}>Follow-up queue</span>
            <span style={{fontSize:12,fontWeight:700,background:'#283347',border:'1px solid #42516b',borderRadius:99,padding:'4px 10px',color:'#e2e8f0'}}>{items.filter(item=>item.followup_status!=='completed').length} open</span>
          </div>
          <div style={{fontSize:13,color:'#94a3b8',marginTop:6}}>All incoming demo leads remain here until their follow-up is complete.</div>
        </div>
        <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:'#cbd5e1',cursor:'pointer',padding:'8px 0'}}>
          <input type="checkbox" checked={showCompleted} onChange={e=>setShowCompleted(e.target.checked)} style={{accentColor:'#818cf8',width:16,height:16}}/>
          Include completed follow-ups
        </label>
      </div>
      <div role="status" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:12,marginBottom:20}}>
        {[
          ['open','Open follow-ups',items.filter(item=>item.followup_status!=='completed').length,'#e2e8f0'],
          ['contact','Needs contact',awaitingContact,'#fbbf24'],
          ['overdue','Overdue tasks',overdue,overdue?'#fca5a5':'#86efac']
        ].map(([filter,label,value,color])=><button type="button" key={filter} aria-pressed={taskFilter===filter} onClick={()=>setTaskFilter(filter)} style={{textAlign:'left',cursor:'pointer',background:taskFilter===filter?'#202947':'#151c2d',border:taskFilter===filter?'1px solid #818cf8':'1px solid #283449',borderRadius:13,padding:'15px 18px',fontFamily:'inherit'}}>
          <div style={{fontSize:12,color:'#94a3b8',fontWeight:600}}>{label}</div>
          <div style={{fontSize:26,fontWeight:800,color,marginTop:5,lineHeight:1.2}}>{value}</div>
        </button>)}
      </div>
      {saveNotice && <div role="status" style={{color:'#86efac',fontSize:13,marginBottom:12}}>{saveNotice}</div>}
      {error && <div role="alert" style={{border:'1px solid #7f1d1d',background:'#3b1820',color:'#fecaca',padding:12,borderRadius:9,marginBottom:14,fontSize:13}}>{error}</div>}
      {(workspace || expanded) && (filteredItems.length ? (
        <div style={{display:'grid',gap:13}}>
          {filteredItems.map(item=>{
            const isOverdue=item.followup_status!=='completed' && new Date(item.followup_due_at||item.booked_at).getTime()<Date.now()
            return <article key={item.booking_id} style={{background:'#131c2d',border:'1px solid #2d3950',borderRadius:12,padding:'11px 15px',display:'grid',gap:expandedTask===item.booking_id?12:0,minWidth:0}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10,flexWrap:'wrap'}}>
                <div style={{minWidth:0,flex:'1 1 300px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:9,flexWrap:'wrap'}}>
                    <strong style={{fontSize:14,color:'#f8fafc'}}>{item.lead_name}</strong>
                    <span style={{fontSize:11,fontWeight:750,letterSpacing:'.04em',padding:'5px 9px',borderRadius:7,background:'#29335d',color:'#c7d2fe'}}>{(item.product_id||'').replaceAll('_',' ').toUpperCase()}</span>
                    <span style={{fontSize:11,fontWeight:750,padding:'5px 9px',borderRadius:7,background:isOverdue?'#46242c':'#24364a',color:isOverdue?'#fca5a5':'#93c5fd'}}>{isOverdue?'Overdue':item.followup_status.replaceAll('_',' ')}</span>
                  </div>
                  <div style={{fontSize:12,color:'#aebdd0',marginTop:4}}>{item.appointment_type} · {item.appointment_date} · {item.appointment_time} ET</div>
                  {expandedTask===item.booking_id && <div style={{fontSize:13,marginTop:8}}>{item.lead_email && <a href={'mailto:'+item.lead_email} style={{color:'#93c5fd',textDecoration:'underline',overflowWrap:'anywhere'}}>{item.lead_email}</a>}</div>}
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
                  <span style={{fontSize:12,color:'#94a3b8'}}>{item.assigned_to||'Unassigned'}</span>
                  <button type="button" aria-expanded={expandedTask===item.booking_id} onClick={()=>setExpandedTask(expandedTask===item.booking_id?null:item.booking_id)} style={{...buttonBase,padding:'7px 11px',background:'#253250',borderColor:'#536585'}}>{expandedTask===item.booking_id?'Hide details':'View details'}</button>
                  {expandedTask===item.booking_id && <>
                  {item.followup_status==='new' && <button type="button" style={buttonBase} onClick={()=>acknowledge(item.booking_id)}>Acknowledge</button>}
                  <button type="button" style={{...buttonBase,background:'#312e81',borderColor:'#6366f1',color:'#eef2ff'}} onClick={()=>startEditing(item)}>{editingTask===item.booking_id?'Close editor':'Edit task'}</button>
                  <button type="button" style={{...buttonBase,background:'#164e63',borderColor:'#0891b2',color:'#ecfeff'}} onClick={()=>markContacted(item)}>{activityEditor===item.booking_id?'Recording activity':'Log activity / Update status'}</button>
                  {item.followup_status==='contacted' && <button type="button" style={{...buttonBase,background:'#14532d',borderColor:'#16a34a',color:'#dcfce7'}} onClick={()=>complete(item)}>Complete</button>}
                  </>}
                </div>
              </div>
              {expandedTask===item.booking_id && <>
              <div style={{display:'flex',gap:10,flexWrap:'wrap',fontSize:12,color:'#cbd5e1',borderTop:'1px solid #273348',paddingTop:12}}>
                <span><strong style={{color:'#94a3b8'}}>Assigned:</strong> {item.assigned_to||'Unassigned'}</span>
                <span style={{color:'#475569'}}>·</span>
                <span><strong style={{color:'#94a3b8'}}>Status:</strong> {item.followup_status}</span>
                <span style={{color:'#475569'}}>·</span>
                <span><strong style={{color:'#94a3b8'}}>Last contact:</strong> <strong style={{color:item.contacted_at?'#86efac':'#fbbf24'}}>{item.contact_outcome||'No contact recorded'}</strong></span>
                {item.contacted_at && <span style={{color:'#94a3b8'}}>{new Date(item.contacted_at).toLocaleString()}</span>}
              </div>
              {editingTask===item.booking_id && <div style={{display:'flex',flexWrap:'wrap',gap:15,alignItems:'end',padding:15,background:'#0d1729',border:'1px solid #30405c',borderRadius:11}}>
                <label style={{display:'grid',gap:7,fontSize:12,color:'#cbd5e1',fontWeight:650}}>Assigned to
                  <input aria-label={'Assigned owner for '+item.lead_name} value={drafts[item.booking_id]?.assigned_to||''} onChange={e=>setDrafts(d=>({...d,[item.booking_id]:{...d[item.booking_id],assigned_to:e.target.value}}))} style={{...fieldBase,width:205}}/>
                </label>
                <label style={{display:'grid',gap:7,fontSize:12,color:'#cbd5e1',fontWeight:650}}>Follow-up date
                  <input aria-label={'Follow-up date for '+item.lead_name} type="date" onClick={e=>e.currentTarget.showPicker?.()} value={drafts[item.booking_id]?.date||''} onChange={e=>setDrafts(d=>({...d,[item.booking_id]:{...d[item.booking_id],date:e.target.value}}))} style={{...fieldBase,width:190,colorScheme:'dark'}}/>
                </label>
                <label style={{display:'grid',gap:7,fontSize:12,color:'#cbd5e1',fontWeight:650}}>Time
                  <input aria-label={'Follow-up time for '+item.lead_name} type="time" value={drafts[item.booking_id]?.time||''} onChange={e=>setDrafts(d=>({...d,[item.booking_id]:{...d[item.booking_id],time:e.target.value}}))} style={{...fieldBase,width:145,colorScheme:'dark'}}/>
                </label>
                <label style={{display:'grid',gap:7,fontSize:12,color:'#cbd5e1',fontWeight:650}}>Task status
                  <select aria-label={'Task status for '+item.lead_name} value={drafts[item.booking_id]?.followup_status||item.followup_status} onChange={e=>setDrafts(d=>({...d,[item.booking_id]:{...d[item.booking_id],followup_status:e.target.value}}))} style={{...fieldBase,width:185}}>
                    <option value="new">Open</option>
                    <option value="acknowledged">In progress</option>
                    <option value="contacted">Contacted</option>
                    <option value="completed">Done / Closed</option>
                  </select>
                </label>
                <button type="button" disabled={savingTask===item.booking_id} style={{...buttonBase,background:'#312e81',borderColor:'#818cf8'}} onClick={()=>saveTask(item)}>{savingTask===item.booking_id?'Saving…':'Save changes'}</button>
                <button type="button" style={buttonBase} onClick={()=>setEditingTask(null)}>Cancel</button>
                <span style={{fontSize:12,color:isOverdue?'#fca5a5':'#86efac',paddingBottom:10}}>{isOverdue?'● Overdue':'● On track'}</span>
              </div>}
              <div style={{fontSize:13,color:'#cbd5e1',display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}><strong>Contact activity</strong><span style={{color:'#94a3b8'}}>{item.contacted_at?'Last updated '+new Date(item.contacted_at).toLocaleString():'No contact logged yet — use Log activity / Update status to record an email, call, or conversation.'}</span></div>
              {activityEditor===item.booking_id && <div style={{display:'grid',gap:12,padding:16,background:'#0d1729',border:'1px solid #30405c',borderRadius:11}}>
                <strong style={{fontSize:14}}>Log contact activity and update lead status</strong>
                <label style={{display:'grid',gap:5,fontSize:12}}>Contact status
                  <select aria-label="Contact status" value={activityDraft.type} onChange={e=>setActivityDraft(v=>({...v,type:e.target.value}))} style={fieldBase}>{activityTypes.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
                </label>
                <label style={{display:'grid',gap:5,fontSize:12}}>What happened?
                  <textarea aria-label="Contact notes" rows={3} maxLength={4000} value={activityDraft.notes} onChange={e=>setActivityDraft(v=>({...v,notes:e.target.value}))} placeholder="Example: Sent introduction email, awaiting reply" style={{...fieldBase,resize:'vertical'}}/>
                </label>
                <div style={{display:'flex',flexWrap:'wrap',alignItems:'end',gap:12}}>
                  <label style={{display:'grid',gap:5,fontSize:12}}>Next follow-up date (optional)
                    <input type="date" aria-label="Next follow-up date" value={activityDraft.nextDate} onClick={e=>e.currentTarget.showPicker?.()} onChange={e=>setActivityDraft(v=>({...v,nextDate:e.target.value}))} style={{...fieldBase,colorScheme:'dark'}}/>
                  </label>
                  <label style={{display:'grid',gap:5,fontSize:12}}>Time
                    <input type="time" aria-label="Next follow-up time" value={activityDraft.nextTime} onChange={e=>setActivityDraft(v=>({...v,nextTime:e.target.value}))} style={{...fieldBase,colorScheme:'dark'}}/>
                  </label>
                  <button type="button" disabled={submittingActivity} onClick={()=>recordActivity(item)} style={{...buttonBase,background:'#164e63',borderColor:'#0891b2'}}>{submittingActivity?'Saving…':'Save activity'}</button>
                  <button type="button" style={buttonBase} onClick={()=>setActivityEditor(null)}>Cancel</button>
                </div>
              </div>}
              <div>
                <button type="button" onClick={()=>showHistory(item.booking_id)} style={buttonBase}>{historyOpen===item.booking_id?'Hide history':'View activity history'}</button>
                {historyOpen===item.booking_id && <ol aria-label={'Activity history for '+item.lead_name} style={{paddingLeft:24,color:'#cbd5e1',fontSize:13}}>
                  {(history[item.booking_id]||[]).length===0 && <li>No recorded activities yet.</li>}
                  {(history[item.booking_id]||[]).map(entry=><li key={entry.id} style={{margin:'9px 0'}}>
                    <strong>{activityTypes.find(x=>x[0]===entry.activity_type)?.[1]||entry.activity_type}</strong> · {new Date(entry.created_at).toLocaleString()}
                    <div style={{marginTop:4,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{entry.notes}</div>
                  </li>)}
                </ol>}
              </div>
              <div style={{fontSize:12,color:item.notification_submission_id?'#86efac':'#fbbf24'}}>
                {item.notification_submission_id ? 'Mail submitted to Stalwart (inbox delivery not yet verified)' : 'Mail submission not confirmed — review lead now'}
                {item.notification_last_error ? ' · Last error: '+item.notification_last_error : ''}
              </div>
              </>}
            </article>
          })}
        </div>
      ) : <div style={{fontSize:13,color:'#94a3b8',background:'#151c2d',border:'1px solid #283449',padding:24,borderRadius:13}}>No outstanding demo follow-ups.</div>)}
    </section>
  )
}
