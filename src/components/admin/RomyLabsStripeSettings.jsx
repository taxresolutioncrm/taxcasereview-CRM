import React,{useEffect,useState} from 'react'
import {supabase} from '../../lib/supabase'
const main={background:'rgba(99,102,241,.045)',border:'1px solid rgba(139,92,246,.22)',borderRadius:14,padding:'18px 20px',marginBottom:18}
const input={width:'100%',boxSizing:'border-box',padding:'10px 12px',borderRadius:9,background:'#0d0c1a',border:'1px solid rgba(139,92,246,.3)',color:'#f8fafc',fontSize:13}
const btn={border:'1px solid rgba(139,92,246,.4)',background:'rgba(99,102,241,.2)',color:'#e0e7ff',borderRadius:9,padding:'9px 13px',fontSize:12,fontWeight:800,cursor:'pointer'}
const endpoint='https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/romylabs-stripe-webhook'
export default function RomyLabsStripeSettings({invoices=[],onRefresh}){
  const [info,setInfo]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState('')
  const [key,setKey]=useState(''),[secret,setSecret]=useState(''),[mode,setMode]=useState('test')
  const [busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false),[paying,setPaying]=useState('')
  const invoke=async body=>{
    const {data,error:e}=await supabase.functions.invoke('romylabs-stripe-checkout',{body})
    if(e||!data?.ok)throw Error(data?.error||e?.message||'Stripe integration unavailable')
    return data
  }
  const refresh=async()=>{
    try{const data=await invoke({action:'status'});setInfo(data);setError('')}
    catch(e){setError(String(e?.message||e))}
  }
  useEffect(()=>{void refresh()},[])
  async function connect(){
    if(!key.trim()||busy)return
    setBusy(true);setError('');setMessage('')
    try{
      const data=await invoke({action:'connect',restricted_key:key.trim(),mode})
      setKey('');setMessage('Merchant account '+data.account_id+' verified. Next: configure your signed webhook.')
      await refresh()
    }catch(e){setError(String(e?.message||e))}
    finally{setBusy(false)}
  }
  async function saveWebhook(){
    if(!secret.trim()||busy)return
    setBusy(true);setError('');setMessage('')
    try{await invoke({action:'save_webhook',signing_secret:secret.trim(),mode})
      setSecret('');setMessage('Signing secret stored encrypted. Send a signed account.updated test event from Stripe to verify delivery and activate checkout.')
      await refresh()
    }catch(e){setError(String(e?.message||e))}
    finally{setBusy(false)}
  }
  async function checkout(invoice,delivery='copy'){
    if(paying)return
    setPaying(invoice.id);setError('');setMessage('')
    try{
      const data=await invoke({action:'checkout',invoice_id:invoice.id})
      // The billing address is trusted server-side data from the selected invoice's account.
      // An email draft is explicit: never claim a payment link has been sent until a mail system confirms it.
      if(delivery==='email'){
        const subject='RomyLabs invoice '+data.invoice_number+' — secure payment link'
        const body='Hello '+(data.account_name||'')+',\n\nYour secure payment link for invoice '+data.invoice_number+' is below.\n\n'+data.checkout_url+'\n\nPlease use the Stripe-hosted checkout to enter your card information. Do not email payment details.\n\nThank you,\nRomyLabs Billing'
        const href='mailto:'+encodeURIComponent(data.billing_email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body)
        window.location.href=href
        setMessage('An email draft was opened for '+data.billing_email+'. Review it and click Send in your email app. Payment will appear here only after Stripe confirms it.')
      }else{
        await navigator.clipboard.writeText(data.checkout_url)
        setMessage('Secure checkout link copied for '+invoice.invoice_number+'. Payment records update after Stripe verifies the transaction.')
      }
      onRefresh?.()
    }catch(e){setError(String(e?.message||e))}
    finally{setPaying('')}
  }
  const ready=info?.checkout_ready===true
  return <section style={main} aria-label="RomyLabs Stripe merchant payments">
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:14,flexWrap:'wrap'}}>
      <div style={{flex:'1 1 250px'}}>
        <div style={{fontSize:16,fontWeight:900,color:'#fff'}}>Stripe · RomyLabs payments</div>
        <div style={{fontSize:12,color:'#94a3b8',marginTop:5}}>Merchant: Romy Labs, LLC · SaaS invoices only. Your CRM offices' customer payments stay separate.</div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:9,flexWrap:'wrap'}}>
        <span style={{fontSize:11,fontWeight:800,color:ready?'#34d399':'#fbbf24',padding:'7px 10px',background:ready?'rgba(16,185,129,.1)':'rgba(245,158,11,.1)',borderRadius:20}}>
          {ready?'Verified · '+info.mode:'Setup required'}
        </span>
        <button type="button" onClick={()=>setExpanded(v=>!v)} style={btn}>{expanded?'Hide payment settings':'Payment Settings'}</button>
        <button type="button" onClick={refresh} style={btn}>Refresh</button>
      </div>
    </div>
    <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:15,color:'#cbd5e1',fontSize:11}}>
      <span style={{padding:'6px 9px',background:'rgba(255,255,255,.04)',borderRadius:7}}>Merchant {info?.account_id?'Verified':'Not configured'}</span>
      <span style={{padding:'6px 9px',background:'rgba(255,255,255,.04)',borderRadius:7}}>Webhook {info?.webhook_verified?'Verified':info?.webhook_configured?'Awaiting signed test':'Not configured'}</span>
      <span style={{padding:'6px 9px',background:'rgba(255,255,255,.04)',borderRadius:7}}>Checkout {ready?'Ready':'Locked'}</span>
    </div>
    {error&&<p role="alert" style={{color:'#fca5a5',fontSize:12}}>{error}</p>}
    {message&&<p role="status" style={{color:'#86efac',fontSize:12}}>{message}</p>}
    {expanded&&<div style={{marginTop:20,borderTop:'1px solid rgba(139,92,246,.22)',paddingTop:16}}>
      <p style={{fontSize:12,color:'#cbd5e1',lineHeight:1.7,marginTop:0}}>Create a least-privilege restricted API key in the Stripe Dashboard. Paste it here, not in ChatGPT. A successful verification stores it encrypted in Supabase Vault. Start in Stripe test mode; do not enable live charges until signed webhook delivery is confirmed.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))',gap:15}}>
        <div><label style={{fontSize:11,fontWeight:800,color:'#cbd5e1'}}>Environment</label>
          <select value={mode} onChange={e=>setMode(e.target.value)} style={{...input,marginTop:6}}><option value="test">Stripe test mode</option><option value="live">Stripe live mode</option></select>
          <label style={{display:'block',fontSize:11,fontWeight:800,color:'#cbd5e1',marginTop:14,marginBottom:6}}>Restricted API key</label>
          <input type="password" autoComplete="off" spellCheck={false} placeholder={mode==='live'?'rk_live_…':'rk_test_…'} value={key} onChange={e=>setKey(e.target.value)} style={input}/>
          <button type="button" disabled={!key||busy} onClick={connect} style={{...btn,marginTop:10,opacity:key&&!busy?1:.5}}>Verify & Save Stripe Key</button>
        </div>
        <div><label style={{fontSize:11,fontWeight:800,color:'#cbd5e1'}}>Stripe webhook destination</label>
          <div style={{display:'flex',gap:6,marginTop:6,alignItems:'center'}}>
            <input readOnly value={endpoint} aria-label="Webhook URL" style={{...input,flex:1,minWidth:0,fontSize:10}}/>
            <button type="button" onClick={()=>navigator.clipboard.writeText(endpoint)} style={btn}>Copy</button>
          </div>
          <label style={{display:'block',fontSize:11,fontWeight:800,color:'#cbd5e1',marginTop:14,marginBottom:6}}>Webhook signing secret</label>
          <input type="password" autoComplete="off" spellCheck={false} placeholder="whsec_…" value={secret} onChange={e=>setSecret(e.target.value)} style={input}/>
          <button type="button" disabled={!secret||busy} onClick={saveWebhook} style={{...btn,marginTop:10,opacity:secret&&!busy?1:.5}}>Save Signing Secret</button>
        </div>
      </div>
      <div style={{color:'#94a3b8',fontSize:11,marginTop:14,lineHeight:1.7}}>
        Subscribe the endpoint to account.updated, checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, charge.refunded, charge.dispute.created, and radar.early_fraud_warning.created. Send a signed account.updated event to certify delivery. Never paste sk_ or whsec_ secrets in a chat or public repository.
      </div>
    </div>}
    {Array.isArray(info?.webhook_recent_events)&&info.webhook_recent_events.length>0&&
      <details style={{marginTop:13,padding:'10px 12px',border:'1px solid rgba(139,92,246,.16)',borderRadius:9}}>
        <summary style={{fontSize:12,fontWeight:800,color:'#cbd5e1',cursor:'pointer'}}>Webhook delivery history ({info.webhook_recent_events.length} recent events)</summary>
        <div style={{display:'grid',gap:6,marginTop:12}}>{info.webhook_recent_events.map(e=>
          <div key={e.id} style={{display:'flex',justifyContent:'space-between',gap:10,fontSize:11,flexWrap:'wrap',color:e.failed?'#fca5a5':e.processed?'#86efac':'#fbbf24'}}>
            <span>{e.type} · {e.mode}</span><span>{e.failed?'Requires review':e.processed?'Processed':'Pending'} · {e.received_at?new Date(e.received_at).toLocaleString():'—'}</span>
          </div>)}
        </div>
      </details>}
    <div style={{marginTop:16,borderTop:'1px solid rgba(139,92,246,.15)',paddingTop:14}}>
      <div style={{fontSize:13,fontWeight:800,color:'#e2e8f0',marginBottom:9}}>Collect an outstanding RomyLabs invoice</div>
      {!ready?<p style={{fontSize:12,color:'#94a3b8',margin:'0'}}>Checkout links unlock only after the merchant key and signature-verified webhook are configured. No live charges can be created from this screen yet.</p>
        :!invoices.some(i=>i.status==='open')?<p style={{fontSize:12,color:'#94a3b8',margin:0}}>No open invoices available for payment links.</p>
        :<div style={{display:'grid',gap:8}}>
          {invoices.filter(i=>i.status==='open').slice(0,15).map(i=><div key={i.id} style={{display:'flex',gap:10,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',padding:'9px 10px',background:'rgba(255,255,255,.025)',borderRadius:9}}>
            <div style={{fontSize:12,color:'#cbd5e1'}}>{i.invoice_number} · {new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(i.amount_cents)-Number(i.amount_paid_cents||0))/100)} due</div>
            <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>
              <button type="button" onClick={()=>checkout(i,'copy')} disabled={Boolean(paying)} style={btn}>{paying===i.id?'Creating…':'Copy Checkout Link'}</button>
              <button type="button" onClick={()=>checkout(i,'email')} disabled={Boolean(paying)} style={{...btn,color:'#86efac',borderColor:'rgba(16,185,129,.34)'}}>Email Payment Link</button>
            </div>
          </div>)}
        </div>}
    </div>
  </section>
}
