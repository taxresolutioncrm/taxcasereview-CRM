import React,{useState} from 'react'
import {supabase} from '../../lib/supabase'
export default function RomyLabsHelcimSettings(){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState(null),[error,setError]=useState('')
  async function check(){
    setBusy(true);setError('')
    try{
      const {data,error:e}=await supabase.functions.invoke('romylabs-helcim-admin',{body:{action:'verify'}})
      if(e||!data?.ok)throw Error(data?.error||e?.message||'Helcim status unavailable')
      setStatus(data)
    }catch(e){setError(String(e?.message||e))}
    finally{setBusy(false)}
  }
  const button={border:'1px solid rgba(139,92,246,.4)',background:'rgba(99,102,241,.2)',color:'#e0e7ff',borderRadius:9,padding:'9px 13px',fontWeight:800,cursor:'pointer'}
  return <section aria-label="Helcim merchant payments" style={{background:'rgba(99,102,241,.045)',border:'1px solid rgba(139,92,246,.22)',borderRadius:14,padding:'18px 20px',marginBottom:18}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}><div><strong style={{color:'#fff'}}>Helcim · RomyLabs payments</strong><p style={{fontSize:12,color:'#94a3b8'}}>SaaS office billing only. Stripe stays unchanged. Live Helcim checkout is not enabled.</p></div><button type="button" style={button} onClick={()=>setOpen(x=>!x)}>{open?'Hide settings':'Payment Settings'}</button></div>
    {open&&<div style={{marginTop:14,fontSize:12,color:'#cbd5e1',lineHeight:1.7}}>
      <p>Create a Helcim API token in your Helcim merchant dashboard. Configure it only as Supabase Edge Function secret HELCIM_API_TOKEN. Never put the token in this browser, GitHub or chat.</p>
      <p>Helcim hosted payment pages can be sent manually while secure webhook reconciliation and six-cycle subscription billing are being certified.</p>
      <button type="button" style={button} onClick={check} disabled={busy}>{busy?'Checking…':'Verify connection'}</button>
      {status&&<p role="status" style={{color:status.verified?'#86efac':'#fbbf24'}}>{status.reason}</p>}
      {error&&<p role="alert" style={{color:'#fca5a5'}}>{error}</p>}
    </div>}
  </section>
}
