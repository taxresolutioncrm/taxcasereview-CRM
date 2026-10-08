import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(cents||0)/100)
const date = value => value ? new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'
const tone = status => ({active:'#10b981',paid:'#10b981',past_due:'#f59e0b',open:'#f59e0b',suspended:'#ef4444',uncollectible:'#ef4444',trial:'#6366f1',cancelled:'#64748b'})[status] || '#94a3b8'
const badge = status => ({display:'inline-block',fontSize:10,fontWeight:800,padding:'3px 9px',borderRadius:20,textTransform:'capitalize',color:tone(status),background:`${tone(status)}18`,border:`1px solid ${tone(status)}33`})
const card = {background:'rgba(255,255,255,.03)',border:'1px solid rgba(99,102,241,.2)',borderRadius:14,overflow:'hidden'}
const th = {padding:'10px 14px',fontSize:10,fontWeight:800,color:'#475569',textTransform:'uppercase',letterSpacing:'.05em',textAlign:'left',borderBottom:'1px solid rgba(99,102,241,.12)'}
const td = {padding:'11px 14px',fontSize:12,borderBottom:'1px solid rgba(99,102,241,.07)',color:'#94a3b8'}
const input = {width:'100%',boxSizing:'border-box',padding:'9px 10px',borderRadius:8,border:'1px solid rgba(99,102,241,.25)',background:'#11101d',color:'#e2e8f0',fontSize:13,outline:'none'}
const label = {display:'block',fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:5}
const PRODUCT_OPTIONS = [
  ['taxres_crm','TaxRes CRM'],['camvella','Camvella'],['arcvena','Arcvena'],['bocasync','BocaSync'],['groundivo','GroundIVO'],['oculivo','Oculivo'],['restore_relay','Restore Relay']
]
const todayLocal = () => {
  const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d.getTime()-off*60000).toISOString().slice(0,10)
}
const blankPayment = {product_key:'taxres_crm',external_tenant_id:'',account_name:'',billing_email:'',seat_count:'',per_seat_rate:'',amount:'',paid_date:todayLocal(),provider:'zelle',reference:'',notes:''}

export default function RomyLabsBilling() {
  const [data,setData] = useState(null)
  const [error,setError] = useState('')
  const [filter,setFilter] = useState('all')
  const [selected,setSelected] = useState(null)
  const [tenants,setTenants] = useState([])
  const [paymentOpen,setPaymentOpen] = useState(false)
  const [payment,setPayment] = useState(blankPayment)
  const [saving,setSaving] = useState(false)
  const savingRef = useRef(false)
  const liveReloadRef = useRef(null)
  const [paymentKey,setPaymentKey] = useState('')
  const [notice,setNotice] = useState('')

  const load = useCallback(async()=>{
    setError('')
    const [{data:payload,error:e},{data:tenantPayload,error:tenantError}] = await Promise.all([
      supabase.rpc('romylabs_billing_dashboard'),
      supabase.rpc('admin_tenant_overview')
    ])
    if(e){setError(e.message);setData(null);return null}
    const nextData = payload || {accounts:[],invoices:[],payments:[],events:[]}
    setData(nextData)
    setSelected(current => current ? (nextData.accounts || []).find(a=>a.id===current.id) || current : current)
    if(!tenantError) setTenants(Array.isArray(tenantPayload)?tenantPayload:[])
    return nextData
  },[])
  useEffect(()=>{load()},[load])
  useEffect(()=>{
    const channel = supabase
      .channel('romylabs-billing-live')
      .on(
        'postgres_changes',
        { event:'*', schema:'public', table:'romylabs_metrics_cache' },
        () => {
          if (liveReloadRef.current) clearTimeout(liveReloadRef.current)
          liveReloadRef.current = setTimeout(() => load(), 150)
        },
      )
      .subscribe()
    return () => {
      if (liveReloadRef.current) clearTimeout(liveReloadRef.current)
      liveReloadRef.current = null
      supabase.removeChannel(channel)
    }
  },[load])
  useEffect(()=>{
    const host = document.querySelector('.rl-admin-main')
    if (host) host.scrollTo({ top:0, left:0, behavior:'auto' })
  },[])

  const accounts = data?.accounts || []
  const invoices = data?.invoices || []
  const payments = data?.payments || []
  const events = data?.events || []
  const visible = useMemo(()=>filter==='all'?accounts:accounts.filter(a=>a.status===filter),[accounts,filter])
  const sortedPayments = useMemo(()=>[...payments].sort((a,b)=>new Date(b.paid_at||b.created_at||0)-new Date(a.paid_at||a.created_at||0)),[payments])
  const latestPaymentFor = accountId => sortedPayments.find(p => p.account_id===accountId && p.status==='succeeded') || null
  const accountInvoices = selected ? invoices.filter(i=>i.account_id===selected.id) : []
  const accountPayments = selected ? payments.filter(p=>p.account_id===selected.id) : []
  const accountEvents = selected ? events.filter(e=>e.account_id===selected.id) : []
  const kpis = [
    ['Monthly Recurring',money(data?.mrr_cents),'#10b981'],
    ['Past Due',money(data?.past_due_cents),'#f59e0b'],
    ['Past-Due Accounts',Number(data?.past_due_accounts||0).toLocaleString(),'#f97316'],
    ['Suspended',Number(data?.suspended_accounts||0).toLocaleString(),'#ef4444'],
  ]

  const recalc = (next) => {
    const seats = Number(next.seat_count||0)
    const rate = Number(next.per_seat_rate||0)
    return {...next,amount:seats>0&&rate>0?(seats*rate).toFixed(2):next.amount}
  }
  const chooseTenant = id => {
    const t = tenants.find(x=>x.id===id)
    if(!t){setPayment(p=>({...p,external_tenant_id:id}));return}
    setPayment(p=>recalc({...p,external_tenant_id:t.id,account_name:t.firm_name||'',billing_email:t.primary_contact_email||p.billing_email,seat_count:t.billing_seats||p.seat_count||t.employee_count||'',per_seat_rate:t.per_seat_rate||p.per_seat_rate||''}))
  }
  const openPayment = account => {
    setNotice('')
    setError('')
    savingRef.current = false
    setPaymentKey(`manual-ui-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`)
    if(account){
      setPayment(recalc({...blankPayment,product_key:account.product_key,external_tenant_id:account.external_tenant_id,account_name:account.account_name,billing_email:account.billing_email||'',seat_count:account.seat_count||'',per_seat_rate:Number(account.per_seat_amount_cents||0)/100}))
    } else setPayment({...blankPayment,paid_date:todayLocal()})
    setPaymentOpen(true)
  }
  const savePayment = async e => {
    e.preventDefault()
    if(savingRef.current) return
    savingRef.current = true
    setSaving(true); setError(''); setNotice('')
    const seats = Number(payment.seat_count)
    const rate = Number(payment.per_seat_rate)
    const amount = Number(payment.amount)
    if(!payment.external_tenant_id||!payment.account_name||seats<=0||rate<=0||amount<=0){
      savingRef.current=false;setSaving(false);setError('Account, tenant ID, seats, rate, and payment amount are required.');return
    }
    const paidAt = new Date(`${payment.paid_date}T12:00:00`).toISOString()
    const stableReference = payment.reference?.trim() || paymentKey
    try {
      const {data:result,error:e2} = await supabase.rpc('admin_record_manual_subscription_payment',{
        p_product_key:payment.product_key,
        p_external_tenant_id:payment.external_tenant_id,
        p_account_name:payment.account_name,
        p_billing_email:payment.billing_email||null,
        p_seat_count:seats,
        p_per_seat_amount_cents:Math.round(rate*100),
        p_amount_cents:Math.round(amount*100),
        p_paid_at:paidAt,
        p_provider:payment.provider,
        p_reference:stableReference,
        p_notes:payment.notes||null
      })
      if(e2){setError(e2.message);return}
      const refreshed = await load()
      const refreshedAccount = (refreshed?.accounts || []).find(a =>
        a.product_key===payment.product_key &&
        String(a.external_tenant_id)===String(payment.external_tenant_id)
      )
      if(refreshedAccount) setSelected(refreshedAccount)
      setPaymentOpen(false)
      const duplicateText = result?.idempotent ? 'Already recorded — no duplicate created.' : 'Saved successfully.'
      setNotice(`Payment recorded: ${money(result?.amount_cents)} · ${result?.seat_count||seats} seats · ${result?.invoice_number||''}. ${duplicateText}`)
    } finally {
      savingRef.current=false
      setSaving(false)
    }
  }

  return <div style={{padding:'28px 36px',width:'100%',maxWidth:'none',boxSizing:'border-box'}}>
    <div style={{position:'sticky',top:0,zIndex:40,display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',flexWrap:'wrap',marginBottom:22,padding:'10px 0 14px',background:'#090816',borderBottom:'1px solid rgba(99,102,241,.12)'}}>
      <div style={{minWidth:0,flex:'1 1 420px'}}><div style={{fontSize:22,fontWeight:900,color:'#fff'}}>💳 RomyLabs Billing & Collections</div><div style={{fontSize:13,color:'#64748b',marginTop:5}}>RomyLabs SaaS subscriptions only — separate from each CRM's customer, patient, or client billing.</div></div>
      <div style={{display:'flex',gap:8,flexShrink:0,marginLeft:'auto'}}><button onClick={()=>openPayment(null)} style={{padding:'8px 14px',borderRadius:8,border:'none',background:'linear-gradient(135deg,#10b981,#059669)',color:'#fff',fontWeight:800,cursor:'pointer'}}>+ Record Manual Payment</button><button onClick={load} style={{padding:'7px 13px',borderRadius:8,border:'1px solid rgba(99,102,241,.3)',background:'rgba(99,102,241,.1)',color:'#a5b4fc',fontWeight:700,cursor:'pointer'}}>Refresh</button></div>
    </div>
    {notice && <div role="status" style={{position:'fixed',top:20,right:20,zIndex:12000,maxWidth:480,padding:13,borderRadius:10,background:'#0f2b22',border:'1px solid rgba(16,185,129,.45)',color:'#86efac',fontWeight:800,boxShadow:'0 16px 45px rgba(0,0,0,.45)'}}>{notice}</div>}
    {error && <div style={{padding:14,borderRadius:10,background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.25)',color:'#fca5a5',marginBottom:18}}>Billing error: {error}</div>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(150px,1fr))',gap:12,marginBottom:20}}>{kpis.map(([labelText,value,color])=><div key={labelText} style={{...card,padding:'17px 18px'}}><div style={{fontSize:10,color:'#64748b',fontWeight:800,textTransform:'uppercase'}}>{labelText}</div><div style={{fontSize:26,color,fontWeight:900,marginTop:8}}>{data?value:'…'}</div></div>)}</div>
    <div style={{...card,padding:'13px 16px',marginBottom:18,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}><span style={{fontSize:11,fontWeight:800,color:'#64748b',textTransform:'uppercase'}}>Collection policy</span><span style={{fontSize:12,color:'#e2e8f0'}}>Invoice automatically</span><span style={{color:'#475569'}}>→</span><span style={{fontSize:12,color:'#f59e0b'}}>Day 10 notice</span><span style={{color:'#475569'}}>→</span><span style={{fontSize:12,color:'#f97316'}}>Day 15 final notice</span><span style={{color:'#475569'}}>→</span><span style={{fontSize:12,color:'#ef4444'}}>Day 20 suspend</span><span style={{marginLeft:'auto',fontSize:11,color:'#475569'}}>Manual payments are audited and update purchased seats/MRR.</span></div>
    <div style={{display:'flex',gap:8,marginBottom:12}}>{['all','active','past_due','suspended','trial'].map(v=><button key={v} onClick={()=>setFilter(v)} style={{padding:'6px 11px',borderRadius:20,border:`1px solid ${filter===v?'#6366f1':'rgba(255,255,255,.08)'}`,background:filter===v?'rgba(99,102,241,.18)':'transparent',color:filter===v?'#c7d2fe':'#64748b',cursor:'pointer',fontSize:11,fontWeight:700}}>{v==='all'?'All accounts':v.replace('_',' ')}</button>)}</div>
    {!data ? <div style={{padding:40,textAlign:'center',color:'#475569'}}>Loading billing accounts…</div> : <div style={{...card,overflowX:'auto'}}><table style={{width:'100%',minWidth:1280,borderCollapse:'collapse',tableLayout:'auto'}}><thead><tr>{['Account','Product','Status','Seats','Monthly','Billing Email','Last Payment','Next Billing','Auto Suspend',''].map((h,i)=><th key={h} style={i===9?{...th,position:'sticky',right:0,zIndex:3,background:'#171625',minWidth:220}:{...th}}>{h}</th>)}</tr></thead><tbody>{visible.length===0?<tr><td colSpan={10} style={{...td,textAlign:'center',padding:28}}>No subscription accounts in this view.</td></tr>:visible.map(a=><tr key={a.id}><td style={{...td,color:'#e2e8f0',fontWeight:700}}>{a.account_name}</td><td style={td}>{a.product_key}</td><td style={td}><span style={badge(a.status)}>{a.status.replace('_',' ')}</span></td><td style={{...td,color:'#c7d2fe',fontWeight:800}}>{Number(a.seat_count||0)}</td><td style={{...td,color:'#10b981',fontWeight:800}}>{money(a.monthly_amount_cents)}/mo</td><td style={td}>{a.billing_email||'—'}</td><td style={{...td,minWidth:145}}>{latestPaymentFor(a.id)?money(latestPaymentFor(a.id).amount_cents)+' · '+date(latestPaymentFor(a.id).paid_at||latestPaymentFor(a.id).created_at):'—'}</td><td style={td}>Day {a.billing_day}</td><td style={td}>{a.auto_suspend?'✓ Enabled':'Manual'}</td><td style={{...td,whiteSpace:'nowrap',minWidth:220,position:'sticky',right:0,zIndex:2,background:'#171625',boxShadow:'-10px 0 18px rgba(9,8,22,.45)'}}><div style={{display:'flex',gap:8,justifyContent:'flex-end',alignItems:'center'}}><button onClick={()=>openPayment(a)} style={{padding:'5px 9px',borderRadius:7,border:'1px solid rgba(16,185,129,.3)',background:'rgba(16,185,129,.08)',color:'#6ee7b7',cursor:'pointer',fontWeight:700,whiteSpace:'nowrap'}}>Manual Payment</button><button onClick={()=>setSelected(a)} style={{padding:'5px 12px',minWidth:86,borderRadius:7,border:'1px solid rgba(99,102,241,.3)',background:'rgba(99,102,241,.1)',color:'#a5b4fc',cursor:'pointer',fontWeight:700}}>Details →</button></div></td></tr>)}</tbody></table></div>}
    <div style={{marginTop:18}}>
      <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:12,marginBottom:9}}>
        <div style={{fontSize:12,fontWeight:900,color:'#e2e8f0',textTransform:'uppercase',letterSpacing:'.06em'}}>Payment Transactions</div>
        <div style={{fontSize:11,color:'#64748b'}}>Manual and processor subscription payments</div>
      </div>
      <div style={{...card,overflowX:'auto'}}>
        <table style={{width:'100%',minWidth:900,borderCollapse:'collapse'}}>
          <thead><tr>{['Paid Date','Account','Amount','Method','Status','Reference'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {sortedPayments.length===0
              ? <tr><td colSpan={6} style={{...td,textAlign:'center',padding:22}}>No subscription payments recorded.</td></tr>
              : sortedPayments.slice(0,50).map(p=>{
                  const account=accounts.find(a=>a.id===p.account_id)
                  return <tr key={p.id}>
                    <td style={td}>{date(p.paid_at||p.created_at)}</td>
                    <td style={{...td,color:'#e2e8f0',fontWeight:700}}>{account?.account_name||'Unknown account'}</td>
                    <td style={{...td,color:'#10b981',fontWeight:900}}>{money(p.amount_cents)}</td>
                    <td style={td}>{p.provider||'manual'}</td>
                    <td style={td}><span style={badge(p.status==='succeeded'?'active':p.status||'active')}>{p.status||'succeeded'}</span></td>
                    <td style={{...td,maxWidth:320,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={p.provider_payment_id||p.reference||''}>{p.provider_payment_id||p.reference||'—'}</td>
                  </tr>
                })}
          </tbody>
        </table>
      </div>
    </div>

    {paymentOpen && <div style={{position:'fixed',inset:0,zIndex:10000,background:'rgba(0,0,0,.8)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={e=>e.target===e.currentTarget&&setPaymentOpen(false)}><form onSubmit={savePayment} style={{width:620,maxWidth:'96vw',maxHeight:'92vh',overflowY:'auto',background:'#0f0e1a',border:'1px solid rgba(99,102,241,.28)',borderRadius:16,padding:24,boxShadow:'0 24px 80px rgba(0,0,0,.55)'}}><div style={{display:'flex',justifyContent:'space-between',gap:12,marginBottom:20}}><div><div style={{fontSize:20,fontWeight:900,color:'#fff'}}>Record Manual Payment</div><div style={{fontSize:12,color:'#64748b',marginTop:4}}>Zelle, ACH, check, wire, cash, or another offline payment.</div></div><button type="button" onClick={()=>setPaymentOpen(false)} style={{background:'none',border:0,color:'#64748b',fontSize:22,cursor:'pointer'}}>✕</button></div>
      {error && <div role="alert" style={{marginBottom:14,padding:12,borderRadius:9,background:'rgba(239,68,68,.12)',border:'1px solid rgba(239,68,68,.35)',color:'#fecaca',fontSize:12,fontWeight:700}}>Payment error: {error}</div>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <Field title="Product"><select value={payment.product_key} onChange={e=>setPayment(p=>({...p,product_key:e.target.value}))} style={input}>{PRODUCT_OPTIONS.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></Field>
        {payment.product_key==='taxres_crm'?<Field title="TaxRes Office"><select value={payment.external_tenant_id} onChange={e=>chooseTenant(e.target.value)} style={input}><option value="">Select office…</option>{tenants.filter(t=>t.tenant_code!=='DEMO').map(t=><option key={t.id} value={t.id}>{t.firm_name}</option>)}</select></Field>:<Field title="Tenant / Practice ID"><input value={payment.external_tenant_id} onChange={e=>setPayment(p=>({...p,external_tenant_id:e.target.value}))} style={input}/></Field>}
        <Field title="Account Name"><input value={payment.account_name} onChange={e=>setPayment(p=>({...p,account_name:e.target.value}))} style={input}/></Field>
        <Field title="Billing Email"><input type="email" value={payment.billing_email} onChange={e=>setPayment(p=>({...p,billing_email:e.target.value}))} style={input}/></Field>
        <Field title="Purchased Seats"><input type="number" min="1" value={payment.seat_count} onChange={e=>setPayment(p=>recalc({...p,seat_count:e.target.value}))} style={input}/></Field>
        <Field title="Per Seat / Month ($)"><input type="number" min="0.01" step="0.01" value={payment.per_seat_rate} onChange={e=>setPayment(p=>recalc({...p,per_seat_rate:e.target.value}))} style={input}/></Field>
        <Field title="Payment Amount ($)"><input type="number" min="0.01" step="0.01" value={payment.amount} onChange={e=>setPayment(p=>({...p,amount:e.target.value}))} style={input}/></Field>
        <Field title="Payment Date"><input type="date" value={payment.paid_date} onChange={e=>setPayment(p=>({...p,paid_date:e.target.value}))} style={input}/></Field>
        <Field title="Method"><select value={payment.provider} onChange={e=>setPayment(p=>({...p,provider:e.target.value}))} style={input}><option value="zelle">Zelle</option><option value="ach">ACH</option><option value="check">Check</option><option value="wire">Wire</option><option value="cash">Cash</option><option value="other">Other</option></select></Field>
        <Field title="Reference / Confirmation"><input value={payment.reference} onChange={e=>setPayment(p=>({...p,reference:e.target.value}))} placeholder="Optional" style={input}/></Field>
      </div>
      <Field title="Notes"><textarea rows="3" value={payment.notes} onChange={e=>setPayment(p=>({...p,notes:e.target.value}))} style={{...input,resize:'vertical'}}/></Field>
      <div style={{marginTop:12,padding:12,borderRadius:9,background:'rgba(16,185,129,.07)',border:'1px solid rgba(16,185,129,.16)',fontSize:12,color:'#94a3b8'}}>Expected monthly billing: <strong style={{color:'#86efac'}}>{money(Math.round(Number(payment.seat_count||0)*Number(payment.per_seat_rate||0)*100))}</strong>. Saving records the payment, creates/updates the monthly invoice, updates purchased seats, and updates MRR.</div>
      {(()=>{ const d=payment.paid_date ? new Date(payment.paid_date+'T12:00:00') : null; const inv=d ? invoices.find(i=>i.account_id===accounts.find(a=>String(a.external_tenant_id)===String(payment.external_tenant_id)&&a.product_key===payment.product_key)?.id && i.period_start===new Date(d.getFullYear(),d.getMonth(),1-d.getTimezoneOffset()/1440).toISOString().slice(0,10)) : null; return inv?.status==='paid' ? <div style={{marginTop:10,padding:11,borderRadius:9,background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.28)',color:'#fde68a',fontSize:12,fontWeight:700}}>This billing period is already paid ({money(inv.amount_paid_cents)}). Choose a different payment date; another payment for the same paid period will be rejected.</div> : null })()}
      <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:18}}><button type="button" onClick={()=>setPaymentOpen(false)} style={{padding:'8px 14px',borderRadius:8,border:'1px solid rgba(255,255,255,.1)',background:'transparent',color:'#94a3b8',cursor:'pointer',fontWeight:700}}>Cancel</button><button type="submit" disabled={saving} style={{padding:'9px 16px',borderRadius:8,border:'none',background:saving?'#475569':'linear-gradient(135deg,#10b981,#059669)',color:'#fff',cursor:saving?'wait':'pointer',fontWeight:800}}>{saving?'Recording…':'Record Payment'}</button></div>
    </form></div>}

    {selected && <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,.76)',display:'flex',justifyContent:'flex-end'}} onClick={e=>e.target===e.currentTarget&&setSelected(null)}><div style={{width:620,maxWidth:'94vw',height:'100%',overflowY:'auto',background:'#0f0e1a',borderLeft:'1px solid rgba(99,102,241,.25)',padding:26}}><div style={{display:'flex',justifyContent:'space-between',gap:12}}><div><div style={{fontSize:20,fontWeight:900,color:'#fff'}}>{selected.account_name}</div><div style={{fontSize:12,color:'#64748b',marginTop:3}}>{selected.product_key} · {selected.external_tenant_id}</div></div><button onClick={()=>setSelected(null)} style={{background:'none',border:0,color:'#64748b',fontSize:22,cursor:'pointer'}}>✕</button></div><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginTop:20}}><div style={{...card,padding:14}}><div style={{fontSize:10,color:'#64748b'}}>STATUS</div><div style={{marginTop:8}}><span style={badge(selected.status)}>{selected.status}</span></div></div><div style={{...card,padding:14}}><div style={{fontSize:10,color:'#64748b'}}>SEATS</div><div style={{fontSize:20,fontWeight:900,color:'#c7d2fe',marginTop:5}}>{Number(selected.seat_count||0)}</div></div><div style={{...card,padding:14}}><div style={{fontSize:10,color:'#64748b'}}>MONTHLY</div><div style={{fontSize:20,fontWeight:900,color:'#10b981',marginTop:5}}>{money(selected.monthly_amount_cents)}</div></div></div><div style={{marginTop:12}}><button onClick={()=>openPayment(selected)} style={{padding:'7px 12px',borderRadius:8,border:'1px solid rgba(16,185,129,.3)',background:'rgba(16,185,129,.08)',color:'#6ee7b7',cursor:'pointer',fontWeight:800}}>+ Record Payment</button></div><Section title="Invoices">{accountInvoices.length?accountInvoices.map(i=><Row key={i.id} left={`${i.invoice_number} · ${money(i.amount_cents)}`} right={`${i.status} · due ${date(i.due_at)}`}/>):<Empty text="No invoices yet."/>}</Section><Section title="Payments">{accountPayments.length?accountPayments.map(p=><Row key={p.id} left={`${money(p.amount_cents)} · ${p.provider||'manual'} · ${p.status}`} right={date(p.paid_at||p.created_at)}/>):<Empty text="No subscription payments yet."/>}</Section><Section title="Collection history">{accountEvents.length?accountEvents.slice(0,30).map(e=><Row key={e.id} left={e.event_type.replaceAll('_',' ')} right={date(e.created_at)}/>):<Empty text="No collection events yet."/>}</Section><div style={{marginTop:20,padding:14,borderRadius:10,background:'rgba(245,158,11,.07)',border:'1px solid rgba(245,158,11,.18)',fontSize:11,lineHeight:1.6,color:'#94a3b8'}}>Suspension controls remain server-side. Manual payment entries are platform-admin only and are written to the subscription ledger and audit history.</div></div></div>}
  </div>
}
function Field({title,children}){return <label style={{display:'block',marginBottom:12}}><span style={label}>{title}</span>{children}</label>}
function Section({title,children}){return <div style={{marginTop:22}}><div style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>{title}</div><div style={card}>{children}</div></div>}
function Row({left,right}){return <div style={{display:'flex',justifyContent:'space-between',gap:14,padding:'10px 13px',borderBottom:'1px solid rgba(99,102,241,.08)',fontSize:12}}><span style={{color:'#e2e8f0'}}>{left}</span><span style={{color:'#64748b',textAlign:'right'}}>{right}</span></div>}
function Empty({text}){return <div style={{padding:14,color:'#475569',fontSize:12}}>{text}</div>}
