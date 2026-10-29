import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useCall } from '../context/CallContext'
import AIGovernmentCallModal from '../components/calling/AIGovernmentCallModal'
import { formatGovernmentNumber } from '../lib/governmentCallRecipes'

const ACTIVE=['created','dialing','navigating','holding','human_detected','takeover_requested','human_joined']
const LABELS={created:'Preparing',dialing:'Dialing',navigating:'Navigating IVR',holding:'Waiting / On Hold',human_detected:'Representative Connected',takeover_requested:'Joining Staff',human_joined:'Human Takeover',completed:'Completed',failed:'Failed',cancelled:'Cancelled'}
const COLORS={dialing:'#3b82f6',navigating:'#7c3aed',holding:'#d97706',human_detected:'#dc2626',takeover_requested:'#dc2626',human_joined:'#16a34a',completed:'#16a34a',failed:'#dc2626',cancelled:'#64748b'}

function elapsed(from,to=null){
  if(!from)return '—'
  const sec=Math.max(0,Math.floor(((to?new Date(to):new Date())-new Date(from))/1000))
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60
  return h ? h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0') : m+':'+String(s).padStart(2,'0')
}

export default function AIGovernmentCalls(){
  const {user}=useApp()
  const {joinAIGovernmentCall,calling}=useCall()
  const [sessions,setSessions]=useState([])
  const [events,setEvents]=useState({})
  const [showStart,setShowStart]=useState(false)
  const [showBatch,setShowBatch]=useState(false)
  const [batchCount,setBatchCount]=useState(3)
  const [batchType,setBatchType]=useState('irs-investigation')
  const [batchBusy,setBatchBusy]=useState(false)
  const [toast,setToast]=useState('')
  const [,setNowTick]=useState(0)
  const [busyId,setBusyId]=useState(null)
  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(''),4500)}

  async function load(){
    const {data,error}=await supabase.from('ai_government_call_sessions').select('*').order('created_at',{ascending:false}).limit(100)
    if(error){showToast('AI calls failed to load: '+error.message);return}
    setSessions(data||[])
  }
  async function loadEvents(id){
    const {data}=await supabase.from('ai_government_call_events').select('*').eq('session_id',id).order('created_at',{ascending:false}).limit(30)
    setEvents(x=>Object.assign({},x,{[id]:data||[]}))
  }
  useEffect(()=>{load()},[])
  useEffect(()=>{const t=setInterval(()=>setNowTick(x=>x+1),1000);return()=>clearInterval(t)},[])
  useEffect(()=>{
    if(!user?.email)return
    const ch=supabase.channel('ai-government-calls-page-'+user.email)
      .on('postgres_changes',{event:'*',schema:'public',table:'ai_government_call_sessions'},payload=>{
        const row=payload.new||payload.old
        if(!row?.id)return
        setSessions(prev=>{
          const next=prev.filter(x=>x.id!==row.id)
          return payload.eventType==='DELETE'?next:[row,...next].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
        })
        loadEvents(row.id)
      }).subscribe()
    return()=>supabase.removeChannel(ch)
  },[user?.email])

  const active=useMemo(()=>sessions.filter(x=>ACTIVE.includes(x.status)),[sessions])
  async function launchBatch(){
    if(batchBusy)return
    setBatchBusy(true)
    const purpose=batchType==='irs-business'?'Business':'Personal'
    let started=0
    try{
      for(let n=0;n<batchCount;n++){
        const {data,error}=await supabase.functions.invoke('ai-government-call-start',{body:{
          purpose_key:batchType,agency:'IRS',destination_number:'8668604259',
          objective:'Reach a live IRS '+purpose.toLowerCase()+' practitioner representative. Navigate the IVR and hold queue; offer human takeover when connected.',
          route_hints:[{intent:'English',digit:'1'},{intent:'Practitioner Priority Service',digit:'2'},
            ...(batchType==='irs-business'?[{intent:'Business taxpayer account',digit:'4'}]:[])],
        }})
        if(error||!data?.ok)throw new Error(data?.error||error?.message||'Call could not start')
        started++
      }
      showToast(started+' separate IRS '+purpose.toLowerCase()+' calls started. Select TAKE OVER NOW on whichever reaches a representative.')
      setShowBatch(false)
      await load()
    }catch(e){showToast(started+' calls started; launch stopped: '+(e?.message||e));await load()}
    finally{setBatchBusy(false)}
  }
  async function takeover(s){
    if(calling){showToast('Finish the current browser call before taking over this AI call.');return}
    setBusyId(s.id)
    const ok=await joinAIGovernmentCall(s)
    setBusyId(null)
    if(!ok){showToast('Could not join the AI call conference.');return}
    showToast('Connected — you now have the government representative.')
    await loadEvents(s.id)
  }
  async function cancel(s){
    setBusyId(s.id)
    const {data,error}=await supabase.functions.invoke('ai-government-call-cancel',{body:{session_id:s.id}})
    setBusyId(null)
    if(error||!data?.ok){showToast('Could not cancel AI call: '+(data?.error||error?.message||'unknown error'));return}
    showToast('AI government call ended.')
  }

  return <div style={{maxWidth:1180,margin:'0 auto'}}>
    {toast&&<div className="toast show">{toast}</div>}
    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,flexWrap:'wrap'}}>
      <div>
        <div style={{fontSize:22,fontWeight:900}}>🤖 AI Government Calls</div>
        <div style={{fontSize:12,color:'var(--t3)',marginTop:3}}>TaxRes navigates government auto attendants and hold queues, then hands the live representative to staff.</div>
      </div>
      <button className="btn sec" style={{marginLeft:'auto'}} onClick={()=>setShowBatch(true)}>☎ Launch Multiple IRS Calls</button>
      <button className="btn pri" onClick={()=>setShowStart(true)}>＋ Start AI Call</button>
    </div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10,marginBottom:16}}>
      {[
        ['Active',active.length,'var(--blue)'],
        ['On Hold',active.filter(x=>x.status==='holding').length,'#d97706'],
        ['Rep Connected',active.filter(x=>x.status==='human_detected').length,'#dc2626'],
        ['Completed Today',sessions.filter(x=>x.status==='completed'&&new Date(x.ended_at||x.updated_at).toDateString()===new Date().toDateString()).length,'#16a34a']
      ].map(([label,val,color])=><div className="card" key={label} style={{padding:14}}>
        <div style={{fontSize:25,fontWeight:900,color}}>{val}</div><div style={{fontSize:10,fontWeight:800,color:'var(--t3)',textTransform:'uppercase'}}>{label}</div>
      </div>)}
    </div>

    {sessions.length===0?<div className="card" style={{padding:42,textAlign:'center',color:'var(--t3)'}}>No AI government calls yet.</div>:
      <div style={{display:'grid',gap:10}}>
        {sessions.map(s=>{
          const isActive=ACTIVE.includes(s.status),needsYou=s.status==='human_detected',ev=events[s.id]||[]
          return <div key={s.id} className="card" style={{padding:15,border:needsYou?'2px solid #dc2626':'1px solid var(--br)'}}>
            <div style={{display:'flex',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
              <div style={{flex:1,minWidth:260}}>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <div style={{fontWeight:900,fontSize:15}}>{s.client_name||'Government Call'}</div>
                  <span style={{fontSize:10,fontWeight:900,padding:'4px 8px',borderRadius:20,background:(COLORS[s.status]||'#64748b')+'22',color:COLORS[s.status]||'#64748b'}}>{LABELS[s.status]||s.status}</span>
                </div>
                <div style={{fontSize:12,color:'var(--t2)',marginTop:5}}>{s.agency} · {formatGovernmentNumber(s.destination_number)} · {s.purpose_key}</div>
                <div style={{fontSize:11,color:'var(--t3)',marginTop:5,lineHeight:1.5}}>{s.objective}</div>
                {s.last_prompt&&<div style={{marginTop:9,padding:'8px 10px',background:'var(--s2)',borderRadius:7,fontSize:11,color:'var(--t2)'}}>
                  <strong>AI heard:</strong> “{s.last_prompt.slice(0,280)}{s.last_prompt.length>280?'…':''}”
                </div>}
              </div>
              <div style={{textAlign:'right',minWidth:130}}>
                <div style={{fontSize:10,color:'var(--t3)',fontWeight:800,textTransform:'uppercase'}}>Elapsed</div>
                <div style={{fontSize:20,fontWeight:900,fontFamily:'monospace'}}>{elapsed(s.started_at,s.ended_at)}</div>
                {s.confidence!=null&&<div style={{fontSize:10,color:'var(--t3)'}}>AI confidence {Math.round(Number(s.confidence))}%</div>}
              </div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
              {needsYou&&<button className="btn pri" disabled={busyId===s.id} onClick={()=>takeover(s)} style={{background:'#dc2626',borderColor:'#dc2626'}}>☎ TAKE OVER NOW</button>}
              {isActive&&s.status!=='human_joined'&&<button className="btn del" disabled={busyId===s.id} onClick={()=>cancel(s)}>End AI Call</button>}
              <button className="btn sec" onClick={()=>loadEvents(s.id)}>Refresh Call Trail</button>
            </div>
            {ev.length>0&&<div style={{marginTop:10,borderTop:'1px solid var(--br)',paddingTop:9,display:'grid',gap:5}}>
              {ev.slice(0,6).map(e=><div key={e.id} style={{fontSize:10.5,color:'var(--t3)',display:'flex',gap:8}}>
                <span style={{minWidth:68}}>{new Date(e.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'})}</span>
                <strong style={{color:'var(--t2)'}}>{e.event_type}</strong>
                <span>{e.digit?'Pressed '+e.digit:(e.action||'')}</span>
              </div>)}
            </div>}
          </div>
        })}
      </div>}

    {showBatch&&<div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&!batchBusy&&setShowBatch(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Launch parallel IRS calls" style={{maxWidth:480,width:'95vw'}}>
        <div className="mh"><span className="mt">Multiple IRS Practitioner Calls</span><button className="xbtn" disabled={batchBusy} onClick={()=>setShowBatch(false)}>×</button></div>
        <p style={{fontSize:12,color:'var(--t2)'}}>Launch independent outbound calls and monitor each queue. Each call may incur provider charges. Only one can be joined in your browser at once.</p>
        <div className="field"><label>IRS queue</label><select value={batchType} onChange={e=>setBatchType(e.target.value)} disabled={batchBusy}>
          <option value="irs-investigation">Personal / individual accounts</option><option value="irs-business">Business accounts</option>
        </select></div>
        <div className="field"><label>Number of separate calls</label><select value={batchCount} onChange={e=>setBatchCount(Number(e.target.value))} disabled={batchBusy}>
          <option value={2}>2 calls</option><option value={3}>3 calls</option>
        </select></div>
        <p style={{fontSize:11,color:'var(--t3)'}}>Calls are initiated separately. If an IRS callback is offered, the agent must not treat that as a connected call; callback return handling is not yet certified.</p>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:14}}>
          <button className="btn sec" disabled={batchBusy} onClick={()=>setShowBatch(false)}>Cancel</button>
          <button className="btn pri" disabled={batchBusy} onClick={launchBatch}>{batchBusy?'Starting calls…':'Start '+batchCount+' IRS Calls'}</button>
        </div>
      </div>
    </div>}
    {showStart&&<AIGovernmentCallModal client={null} onClose={()=>setShowStart(false)} onStarted={load} showToast={showToast}/>}
  </div>
}
