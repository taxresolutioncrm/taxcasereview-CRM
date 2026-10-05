// Signed-sale handoff: signed agreements can launch office onboarding and remain linked to the office record.
import React, { useEffect, useMemo, useState } from 'react'

const money = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v||0))
const dt = v => v ? new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '—'
const STATUS = {draft:'#64748b',sent:'#6366f1',viewed:'#0ea5e9',signed:'#10b981',declined:'#ef4444',expired:'#f59e0b',void:'#475569'}

const BRAND = {
  taxres_crm:{name:'TaxRes CRM',email:'romy@taxrescrm.net'},
  camvella:{name:'Camvella',email:'romy@camvella.com'},
  arcvena:{name:'Arcvena',email:'romy@arcvena.com'},
  bocasync:{name:'BocaSync',email:'romy@bocasync.com'},
  groundivo:{name:'Groundivo',email:'info@romylabs.com'},
  oculivo:{name:'Oculivo',email:'info@romylabs.com'},
  restore_relay:{name:'Restore Relay',email:'info@romylabs.com'},
  romylabs:{name:'RomyLabs',email:'info@romylabs.com'},
}

export default function RomyLabsAgreementPanel({prospect,supabase,onChanged}){
  const [rows,setRows]=useState([])
  const [loading,setLoading]=useState(false)
  const [working,setWorking]=useState(false)
  const [msg,setMsg]=useState('')
  const [error,setError]=useState('')

  const seats = Math.max(Number(prospect?.seats||1),1)
  const monthly = Number(prospect?.mrr_potential||0)
  const pricePerSeat = seats>0 && monthly>0 ? monthly/seats : 0
  const brand = BRAND[prospect?.product] || {name:'RomyLabs',email:'info@romylabs.com'}

  async function load(){
    if(!prospect?.id) return
    setLoading(true)
    const {data,error:e}=await supabase.rpc('admin_romylabs_agreements_for_prospect',{p_prospect_id:prospect.id})
    if(e){setError(e.message);setRows([])} else {setRows(Array.isArray(data)?data:[]);setError('')}
    setLoading(false)
  }
  useEffect(()=>{load()},[prospect?.id])

  async function sendEmail(payload){
    const signUrl=payload.sign_url
    const subject=`${brand.name} Agreement — ${prospect.firm_name}`
    const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033"><h2>${brand.name} Subscription Agreement</h2><p>Hi ${prospect.contact_name||'there'},</p><p>Your agreement for <strong>${brand.name}</strong> is ready to review and sign electronically.</p><div style="background:#f5f7fb;border-radius:10px;padding:14px 16px;margin:18px 0"><strong>${prospect.firm_name}</strong><br>${payload.seats||seats} seats · ${money(payload.monthly_amount??monthly)}/month</div><p><a href="${signUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Review & Sign Agreement</a></p><p style="font-size:12px;color:#64748b">This secure signing link expires in 14 days. If you have questions, reply to this email.</p><p>Best Regards,<br><strong>${brand.name}</strong><br>RomyLabs</p></div>`
    const {data,error:e}=await supabase.functions.invoke('send-email',{body:{
      to: prospect.contact_email,
      subject,
      html,
      tenant_id:'a0000000-0000-0000-0000-000000000001',
      from_name:brand.name,
      from_email:brand.email,
    }})
    if(e || !data?.success) throw new Error(e?.message || data?.error || 'Email send failed')
  }

  async function createAndSend(){
    if(!prospect?.contact_email){setError('Add a prospect email before sending an agreement.');return}
    if(!window.confirm(`Create and email a ${brand.name} agreement to ${prospect.contact_email}?`)) return
    setWorking(true);setError('');setMsg('')
    try{
      const {data,error:e}=await supabase.rpc('admin_romylabs_create_sales_agreement',{
        p_prospect_id:prospect.id,
        p_seats:seats,
        p_price_per_seat:pricePerSeat||null,
        p_monthly_amount:monthly||null,
        p_expires_days:14,
      })
      if(e||!data?.ok) throw new Error(e?.message||data?.error||'Agreement creation failed')
      await sendEmail(data)
      const sent=await supabase.rpc('admin_romylabs_mark_agreement_sent',{p_agreement_id:data.agreement_id})
      if(sent.error) throw sent.error
      await supabase.from('prospect_activities').insert({prospect_id:prospect.id,activity_type:'proposal',body:`Agreement emailed to ${prospect.contact_email} · ${seats} seats · ${money(monthly)}/mo`,actor:'info@romylabs.com'})
      setMsg(`Agreement sent to ${prospect.contact_email} ✓`)
      await load(); await onChanged?.()
    }catch(e){setError(e.message||String(e))}
    setWorking(false)
  }

  async function resend(row){
    if(!window.confirm(`Send a fresh signing link to ${row.signer_email}?`)) return
    setWorking(true);setError('');setMsg('')
    try{
      const {data,error:e}=await supabase.rpc('admin_romylabs_refresh_agreement_link',{p_agreement_id:row.id})
      if(e||!data?.ok) throw new Error(e?.message||data?.error||'Could not refresh signing link')
      await sendEmail(data)
      setMsg('Fresh signing link emailed ✓'); await load()
    }catch(e){setError(e.message||String(e))}
    setWorking(false)
  }

  async function voidAgreement(row){
    const reason=window.prompt('Reason for voiding this agreement?')
    if(reason===null) return
    setWorking(true);setError('');setMsg('')
    const {data,error:e}=await supabase.rpc('admin_romylabs_void_agreement',{p_agreement_id:row.id,p_reason:reason||null})
    if(e||!data?.ok)setError(e?.message||data?.error||'Void failed'); else {setMsg('Agreement voided');await load()}
    setWorking(false)
  }

  function startOffice(row){
    const q=new URLSearchParams({prospect_id:prospect.id,agreement_id:row.id})
    window.location.assign(`/crm-admin/provision?${q.toString()}`)
  }

  const latest=rows[0]
  const active=useMemo(()=>rows.find(r=>['draft','sent','viewed'].includes(r.status)),[rows])
  const createDisabled = working || !!active || !prospect?.contact_email

  return <div style={{padding:'12px 18px',borderBottom:'1px solid rgba(99,102,241,.08)'}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:10}}>
      <div><div style={{fontSize:9,fontWeight:800,color:'#334155',textTransform:'uppercase',letterSpacing:'.07em'}}>Agreement / E-Sign</div><div style={{fontSize:10,color:'#475569',marginTop:2}}>Prospect SaaS agreement · secure electronic signature</div></div>
      <button onClick={createAndSend} disabled={createDisabled} title={active?'Void or complete the active agreement before creating another.':''}
        style={{padding:'6px 10px',borderRadius:7,border:'none',background:'#6366f1',color:'#fff',fontSize:10,fontWeight:800,cursor:createDisabled?'not-allowed':'pointer',opacity:createDisabled?.5:1}}>{working?'Working…':'+ Create & Email Agreement'}</button>
    </div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,marginBottom:10}}>
      {[['Seats',seats],['Per Seat',pricePerSeat?money(pricePerSeat):'—'],['Monthly',monthly?money(monthly):'—']].map(([l,v])=><div key={l} style={{background:'rgba(255,255,255,.03)',borderRadius:7,padding:'7px 9px'}}><div style={{fontSize:8,color:'#334155',fontWeight:800,textTransform:'uppercase'}}>{l}</div><div style={{fontSize:11,color:'#e2e8f0',fontWeight:700,marginTop:2}}>{v}</div></div>)}
    </div>

    {loading?<div style={{fontSize:11,color:'#475569'}}>Loading agreements…</div>:rows.length===0?<div style={{fontSize:11,color:'#475569'}}>No agreement created yet.</div>:rows.slice(0,4).map(row=>{
      const c=STATUS[row.status]||'#64748b'
      return <div key={row.id} style={{padding:'9px 10px',borderRadius:8,background:'rgba(255,255,255,.025)',border:'1px solid rgba(99,102,241,.08)',marginBottom:6}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:9,fontWeight:800,textTransform:'uppercase',color:c,background:`${c}18`,padding:'2px 7px',borderRadius:12}}>{row.status}</span><span style={{fontSize:10,color:'#64748b'}}>{row.sent_at?`Sent ${dt(row.sent_at)}`:`Created ${dt(row.created_at)}`}</span>{row.signed_at&&<span style={{fontSize:10,color:'#10b981',marginLeft:'auto'}}>Signed {dt(row.signed_at)}</span>}</div>
        <div style={{fontSize:11,color:'#cbd5e1',marginTop:5}}>{row.agreement_title} · {row.seats||'—'} seats · {money(row.monthly_amount)}/mo</div>
        {row.signed_name&&<div style={{fontSize:10,color:'#10b981',marginTop:3}}>✓ Signed by {row.signed_name}</div>}
        {row.status==='signed'&&!row.tenant_id&&!row.external_office_id&&!prospect?.external_office_id&&<div style={{marginTop:8}}><button onClick={()=>startOffice(row)} style={{fontSize:10,padding:'6px 10px',borderRadius:7,border:'none',background:'#10b981',color:'#052e16',fontWeight:900,cursor:'pointer'}}>🏢 Create New Office from Sale</button></div>}
        {row.status==='signed'&&(row.tenant_id||row.external_office_id||prospect?.external_office_id)&&<div style={{fontSize:10,color:'#10b981',marginTop:6}}>✓ Office created and linked to this signed sale</div>}
        {!['signed','declined','void'].includes(row.status)&&<div style={{display:'flex',gap:6,marginTop:7}}><button disabled={working} onClick={()=>resend(row)} style={{fontSize:9,padding:'4px 8px',borderRadius:6,border:'1px solid rgba(99,102,241,.25)',background:'rgba(99,102,241,.08)',color:'#a5b4fc',cursor:'pointer'}}>Resend Fresh Link</button><button disabled={working} onClick={()=>voidAgreement(row)} style={{fontSize:9,padding:'4px 8px',borderRadius:6,border:'1px solid rgba(239,68,68,.2)',background:'rgba(239,68,68,.06)',color:'#f87171',cursor:'pointer'}}>Void</button></div>}
      </div>
    })}
    {msg&&<div style={{fontSize:10,color:'#10b981',marginTop:7}}>{msg}</div>}
    {error&&<div style={{fontSize:10,color:'#f87171',marginTop:7,lineHeight:1.4}}>{error}</div>}
    {!prospect?.contact_email&&<div style={{fontSize:10,color:'#f59e0b',marginTop:7}}>Add the prospect's email before sending an agreement.</div>}
    {latest?.status==='signed'&&!latest?.tenant_id&&!latest?.external_office_id&&!prospect?.external_office_id&&<div style={{fontSize:10,color:'#64748b',marginTop:7}}>Signed agreement is locked. Click Create New Office from Sale to begin onboarding.</div>}
    {latest?.status==='signed'&&(latest?.tenant_id||latest?.external_office_id||prospect?.external_office_id)&&<div style={{fontSize:10,color:'#10b981',marginTop:7}}>Office onboarding is linked to this agreement.</div>}
  </div>
}
