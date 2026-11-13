import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'

// Non-billable engagement tracking, separate from employee Time Clock and
// invoiceable time entries. Only count the visible, recently active client tab.
// Each browser-tab/client session writes to its own immutable UUID key.
export function useAutoClientWorkTracking({clientId,clientName,tenantId,user}) {
  const [trackedSeconds,setTrackedSeconds]=useState(0)
  const [status,setStatus]=useState('off')
  useEffect(()=>{
    setTrackedSeconds(0)
    setStatus('off')
    if(!clientId || !clientName || !tenantId || !user?.id || !user?.email) return
    const id=crypto.randomUUID()
    const token=crypto.randomUUID()
    const leaseKey='taxres:active-client-work:'+tenantId+':'+user.id
    let stopped=false,writing=false,seconds=0,lastSaved=-1,startedAt=new Date().toISOString()
    let lastTick=Date.now(),lastActivity=Date.now()
    function ownsLease() {
      try {
        const current=JSON.parse(localStorage.getItem(leaseKey)||'null')
        if(current?.token!==token && Number(current?.expires)>Date.now()) return false
        localStorage.setItem(leaseKey,JSON.stringify({token,expires:Date.now()+15000}))
      } catch { /* browser storage may be disabled; per-tab sessions remain isolated */ }
      return true
    }
    function releaseLease() {
      try {
        const current=JSON.parse(localStorage.getItem(leaseKey)||'null')
        if(current?.token===token)localStorage.removeItem(leaseKey)
      }catch { /* storage unavailable */ }
    }
    const activity=()=>{lastActivity=Date.now()}
    const tick=()=>{
      const now=Date.now(),delta=Math.min(5500,Math.max(0,now-lastTick))
      lastTick=now
      if(document.hidden||now-lastActivity>90000) {setStatus('paused');return}
      if(!ownsLease()){setStatus('paused');return}
      seconds+=delta/1000
      setTrackedSeconds(Math.floor(seconds))
      setStatus('tracking')
    }
    const flush=async()=>{
      const rounded=Math.floor(seconds)
      if(writing||rounded<5||rounded===lastSaved) return
      writing=true
      const payload={
        id,tenant_id:tenantId,client_id:String(clientId),client_name:clientName,
        user_id:user.id,employee_email:user.email,started_at:startedAt,
        updated_at:new Date().toISOString(),elapsed_seconds:rounded,source:'client_profile',
      }
      const {error}=await supabase.from('client_work_sessions').upsert(payload,{onConflict:'id'})
      if(!error){lastSaved=rounded;window.dispatchEvent(new CustomEvent('taxres:client-work-updated',{detail:{clientId,tenantId}}))}
      else if(!stopped)setStatus('sync-error')
      writing=false
    }
    const interval=window.setInterval(tick,5000)
    const saver=window.setInterval(()=>{void flush()},15000)
    const onVisibility=()=>{lastTick=Date.now();if(document.hidden){releaseLease();void flush()}else lastActivity=Date.now()}
    for(const e of ['keydown','pointerdown','wheel','touchstart'])window.addEventListener(e,activity,{passive:true})
    document.addEventListener('visibilitychange',onVisibility)
    return ()=>{
      stopped=true
      window.clearInterval(interval);window.clearInterval(saver)
      for(const e of ['keydown','pointerdown','wheel','touchstart'])window.removeEventListener(e,activity)
      document.removeEventListener('visibilitychange',onVisibility)
      releaseLease()
      void flush()
    }
  },[clientId,clientName,tenantId,user?.id,user?.email])
  return {trackedSeconds,status}
}
