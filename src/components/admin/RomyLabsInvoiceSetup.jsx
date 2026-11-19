import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from '../../lib/supabase'
const field={background:'#11101d',border:'1px solid rgba(99,102,241,.27)',borderRadius:8,padding:'9px 11px',fontSize:12,color:'#e2e8f0',width:'100%',boxSizing:'border-box'}
const btn={padding:'9px 12px',background:'rgba(99,102,241,.2)',border:'1px solid rgba(139,92,246,.34)',color:'#e0e7ff',borderRadius:8,fontSize:12,fontWeight:800,cursor:'pointer'}
const label={fontSize:11,color:'#94a3b8',fontWeight:800}
const dateUTC=v=>v.toISOString().slice(0,10)
const dollars=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100)
export default function RomyLabsInvoiceSetup({accounts=[],officeRegistry=[],invoices=[],onRefresh}){
  const [show,setShow]=useState(false)
  const [office,setOffice]=useState('')
  const [name,setName]=useState('')
  const [email,setEmail]=useState('')
  const [price,setPrice]=useState('399.00')
  const [seats,setSeats]=useState('10')
  const [target,setTarget]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const available=useMemo(()=>officeRegistry.filter(o=>o.product_key&&o.external_office_id&&!accounts.some(a=>a.product_key===o.product_key&&String(a.external_tenant_id)===String(o.external_office_id))),[officeRegistry,accounts])
  const chooseOffice=v=>{
    setOffice(v)
    const o=available.find(o=>o.product_key+'|'+o.external_office_id===v)
    if(o){setName(o.firm_name||'');setEmail(o.primary_contact_email||'');setTarget('')}
  }
  const current=accounts.find(a=>a.id===target)
  useEffect(()=>{if(!target&&accounts.length===1)setTarget(accounts[0].id)},[target,accounts])
  async function createAccount(){
    const selected=available.find(o=>o.product_key+'|'+o.external_office_id===office)
    const cents=Math.round(Number(price)*100)
    if(!selected){setError('Select a registered office without a billing account.');return}
    if(!name.trim()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){setError('Enter the legal business name and a valid billing email.');return}
    if(!Number.isInteger(cents)||cents<1||Math.abs(Number(price)*100-cents)>0.0001){setError('Enter a valid positive monthly price in dollars and cents.');return}
    const count=Number(seats)
    if(!Number.isInteger(count)||count<1||count>10000){setError('Enter a valid seat count.');return}
    if(!window.confirm('Create a RomyLabs billing account for '+name+' at '+dollars(cents)+'/month? This creates no charges.'))return
    setBusy(true);setError('');setMessage('')
    try{
      const {data,error:e}=await supabase.from('romylabs_billing_accounts').insert({
        product_key:selected.product_key,external_tenant_id:String(selected.external_office_id),
        account_name:name.trim(),billing_email:email.trim(),currency:'USD',
        monthly_amount_cents:cents,seat_count:count,per_seat_amount_cents:Math.round(cents/count),
        auto_invoice:false,auto_suspend:false,status:'active'
      }).select('id').single()
      if(e)throw e
      setTarget(data.id)
      setMessage('Billing account created. Automatic invoices and suspensions are OFF until the approved subscription contract is configured. Create the first invoice below.')
      await onRefresh?.()
    }catch(e){setError(String(e.message||e))}
    finally{setBusy(false)}
  }
  async function createInvoice(){
    if(!current){setError('Select an existing RomyLabs billing account.');return}
    if(!current.billing_email){setError('This office needs a billing email before a payment link can be issued.');return}
    const amount=Number(current.monthly_amount_cents)
    if(!Number.isSafeInteger(amount)||amount<=0){setError('Account must have a valid monthly price.');return}
    const now=new Date()
    const start=now.toISOString().slice(0,7)+'-01'
    const end=dateUTC(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)))
    const existing=invoices.find(i=>i.account_id===current.id&&i.period_start===start&&i.period_end===end&&i.status!=='void')
    if(existing){setError('This office already has an invoice for the current monthly period ('+existing.invoice_number+'). Use the existing invoice to avoid duplicate billing.');return}
    if(!window.confirm('Issue '+dollars(amount)+' invoice for '+current.account_name+' for '+start+' through '+end+'? This does not charge the customer.'))return
    setBusy(true);setError('');setMessage('')
    const number='RL-'+start.slice(0,7).replace('-','')+'-'+String(current.id).slice(0,8).toUpperCase()
    const due=new Date(now);due.setUTCDate(due.getUTCDate()+10)
    try{
      const {data,error:e}=await supabase.from('romylabs_invoices').insert({
        account_id:current.id,invoice_number:number,period_start:start,period_end:end,
        issued_at:now.toISOString(),due_at:due.toISOString(),amount_cents:amount,status:'open',
      }).select('id,invoice_number').single()
      if(e)throw e
      setMessage('Created invoice '+data.invoice_number+'. Open Stripe below to email or copy the secure checkout link once merchant verification is complete.')
      await onRefresh?.()
    }catch(e){setError(String(e.message||e))}
    finally{setBusy(false)}
  }
  return <section style={{border:'1px solid rgba(99,102,241,.22)',background:'rgba(99,102,241,.04)',borderRadius:12,padding:16,marginBottom:18}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
      <div><div style={{fontSize:14,fontWeight:900,color:'#f8fafc'}}>Office Billing & Invoice Setup</div><div style={{fontSize:11,color:'#94a3b8',marginTop:4}}>Link a registered CRM office, issue its first invoice, then collect through secure Stripe Checkout.</div></div>
      <button type="button" style={btn} onClick={()=>setShow(v=>!v)}>{show?'Hide setup':'Create Billing Account / Invoice'}</button>
    </div>
    {show&&<div style={{display:'grid',gap:13,marginTop:15}}>
      <div style={{display:'grid',gap:9,padding:13,border:'1px solid rgba(99,102,241,.16)',borderRadius:10}}>
        <div style={{fontSize:12,fontWeight:800,color:'#c7d2fe'}}>1. Create billing account (only for offices that are already registered)</div>
        <label style={label}>Registered CRM office<select style={field} value={office} onChange={e=>chooseOffice(e.target.value)}><option value="">Select an office…</option>{available.map(o=><option key={o.product_key+'|'+o.external_office_id} value={o.product_key+'|'+o.external_office_id}>{o.firm_name||o.external_office_id} · {o.product_key}</option>)}</select></label>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:9}}>
          <label style={label}>Legal business name<input style={field} value={name} onChange={e=>setName(e.target.value)}/></label>
          <label style={label}>Billing email<input type="email" style={field} value={email} onChange={e=>setEmail(e.target.value)}/></label>
          <label style={label}>Monthly subscription ($)<input type="number" min=".01" step=".01" style={field} value={price} onChange={e=>setPrice(e.target.value)}/></label>
          <label style={label}>Included users<input type="number" min="1" step="1" style={field} value={seats} onChange={e=>setSeats(e.target.value)}/></label>
        </div>
        <button type="button" style={btn} onClick={createAccount} disabled={busy||!office}>{busy?'Saving…':'Create Office Billing Account'}</button>
      </div>
      <div style={{display:'grid',gap:9,padding:13,border:'1px solid rgba(99,102,241,.16)',borderRadius:10}}>
        <div style={{fontSize:12,fontWeight:800,color:'#c7d2fe'}}>2. Create current-month invoice</div>
        <label style={label}>Billing account<select style={field} value={target} onChange={e=>setTarget(e.target.value)}><option value="">Select account…</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.account_name} · {dollars(Number(a.monthly_amount_cents))}/month</option>)}</select></label>
        <div style={{fontSize:11,color:'#94a3b8'}}>Invoices are one-time payment requests. This does not turn on indefinite subscription charges. A six-payment recurring mandate is configured separately.</div>
        <button type="button" style={btn} onClick={createInvoice} disabled={busy||!current}>{busy?'Saving…':'Create First / Current Invoice'}</button>
      </div>
    </div>}
    {error&&<p role="alert" style={{color:'#fca5a5',fontSize:12}}>{error}</p>}
    {message&&<p role="status" style={{color:'#86efac',fontSize:12}}>{message}</p>}
  </section>
}
