import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../context/AppContext'
import { useCall } from '../../context/CallContext'
import { playRing, stopRingAudio } from '../../lib/notifySound'

export default function AIGovernmentCallNotifier(){
  const {user}=useApp()
  const {joinAIGovernmentCall,calling}=useCall()
  const navigate=useNavigate()
  const [session,setSession]=useState(null)
  const [joining,setJoining]=useState(false)

  useEffect(()=>{
    if(!session)return
    let stopped=false
    const fire=()=>{ if(!stopped) { try{ playRing() }catch{} } }
    fire()
    const alarm=setInterval(fire,5000)
    return()=>{ stopped=true; clearInterval(alarm); try{stopRingAudio()}catch{} }
  },[session?.id])

  useEffect(()=>{
    if(!user?.email)return
    let cancelled=false
    async function loadPending(){
      const {data}=await supabase.from('ai_government_call_sessions').select('*')
        .eq('assigned_to_email',user.email.toLowerCase()).eq('status','human_detected')
        .order('human_detected_at',{ascending:false}).limit(1).maybeSingle()
      if(!cancelled&&data)setSession(data)
    }
    loadPending()
    const ch=supabase.channel('ai-gov-rep-alert-'+user.email)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'ai_government_call_sessions'},payload=>{
        const row=payload.new
        if(String(row?.assigned_to_email||'').toLowerCase()!==user.email.toLowerCase())return
        if(row.status==='human_detected'){
          setSession(row)
          try{playRing()}catch{}
          try{
            if('Notification' in window&&Notification.permission==='granted'){
              new Notification('Government representative connected',{body:(row.client_name||row.agency)+': take over the call now.'})
            }
          }catch{}
        }else if(session?.id===row.id&&!['human_detected','takeover_requested'].includes(row.status)){
          setSession(null)
        }
      }).subscribe()
    return()=>{cancelled=true;supabase.removeChannel(ch)}
  },[user?.email,session?.id])

  if(!session)return null
  async function takeover(){
    if(calling){navigate('/ai-government-calls');return}
    setJoining(true)
    const ok=await joinAIGovernmentCall(session)
    setJoining(false)
    if(ok)setSession(null)
  }

  return <div style={{
    position:'fixed',right:18,bottom:76,zIndex:10020,width:'min(420px,calc(100vw - 28px))',
    background:'var(--sf)',border:'3px solid #dc2626',borderRadius:14,boxShadow:'0 0 0 4px rgba(220,38,38,.18),0 18px 50px rgba(0,0,0,.45)',padding:16
  }}>
    <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
      <div style={{fontSize:28}}>☎️</div>
      <div style={{flex:1}}>
        <div style={{fontSize:12,fontWeight:900,color:'#dc2626',textTransform:'uppercase'}}>Government Representative Connected</div>
        <div style={{fontSize:16,fontWeight:900,marginTop:3}}>{session.client_name||session.agency}</div>
        <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>{session.agency} · {session.objective}</div>
      </div>
      <button className="xbtn" title="Dismiss popup — sidebar badge remains until takeover" onClick={()=>{try{stopRingAudio()}catch{};setSession(null)}}>&times;</button>
    </div>
    <div style={{display:'flex',gap:8,marginTop:13}}>
      <button className="btn pri" disabled={joining||calling} onClick={takeover}
        style={{flex:1,justifyContent:'center',background:'#dc2626',borderColor:'#dc2626'}}>
        {joining?'Joining…':'TAKE OVER NOW'}
      </button>
      <button className="btn" onClick={()=>navigate('/ai-government-calls')}>Open</button>
    </div>
    {calling&&<div style={{fontSize:10,color:'var(--warn)',marginTop:7}}>You already have a browser call active. Open AI Government Calls after ending it.</div>}
  </div>
}
