import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from '../../lib/supabase'
const usd=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(c||0)/100)
const day=seconds=>seconds?new Date(Number(seconds)*1000).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'
const surface={border:'1px solid rgba(129,140,248,.17)',borderRadius:12,background:'rgba(255,255,255,.022)',overflow:'hidden'}
const tableCell={textAlign:'left',padding:'11px 13px',fontSize:12,color:'#cbd5e1',borderBottom:'1px solid rgba(129,140,248,.09)',whiteSpace:'nowrap'}
const headers={...tableCell,fontSize:10,color:'#94a3b8',fontWeight:800,textTransform:'uppercase'}
const b={borderRadius:8,padding:'8px 12px',border:'1px solid rgba(129,140,248,.28)',color:'#c7d2fe',background:'rgba(99,102,241,.10)',fontSize:12,fontWeight:750,cursor:'pointer'}
const views=[['payments','Transactions'],['subscriptions','Subscriptions'],['invoices','Stripe invoices'],['payouts','Payouts'],['refunds','Refunds'],['disputes','Disputes']]
const viewHeaders={
  payments:['Date','Payment','Description','Amount','Status'],
  subscriptions:['Created','Office','Subscription','Monthly','Status','Scheduled end'],
  invoices:['Created','Invoice','Subscription','Paid','Balance','Status'],
  payouts:['Created','Payout','Amount','Arrival','Status'],
  refunds:['Date','Refund','Payment reference','Amount','Status'],
  disputes:['Date','Dispute','Payment reference','Amount','Status']
}
const tone=status=>status==='succeeded'||status==='paid'||status==='active'||status==='completed'?'#6ee7b7':
  status==='failed'||status==='canceled'||status==='lost'||status==='unpaid'?'#fca5a5':'#fbbf24'
const statusChip=value=><span style={{fontSize:11,fontWeight:750,color:tone(value)}}>{(value||'unknown').replaceAll('_',' ')}</span>
const sum=(items,key)=>items.reduce((a,v)=>a+Number(v?.[key]||0),0)
export default function RomyLabsProcessorDashboard({onRefresh}){
  const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const [view,setView]=useState('payments'),[search,setSearch]=useState('')
  const reload=async()=>{
    setLoading(true);setError('')
    try{
      const {data,error:e}=await supabase.functions.invoke('romylabs-stripe-finance',{body:{action:'summary'}})
      if(e||!data?.ok)throw Error(data?.error||e?.message||'Stripe merchant reporting unavailable')
      setSnapshot(data)
    }catch(e){setError(String(e?.message||e))}
    finally{setLoading(false)}
  }
  useEffect(()=>{void reload()},[])
  const records=snapshot?.data?.[view==='payments'?'payment_intents':view]?.rows||[]
  const rows=useMemo(()=>records.filter(r=>!search.trim()||
    Object.values(r).join(' ').toLowerCase().includes(search.trim().toLowerCase())),[records,search])
  const payments=snapshot?.data?.payment_intents?.rows||[]
  const payouts=snapshot?.data?.payouts?.rows||[]
  const financial=[
    ['Stripe payments',usd(sum(payments.filter(p=>p.status==='succeeded'),'amount_received')),
      snapshot?.data?.payment_intents?.has_more?'Latest 50 · not all-time':'Retrieved Stripe payments'],
    ['Available balance',snapshot?.data?.balance?usd(sum(snapshot.data.balance.available||[],'amount')):'Unavailable','Stripe merchant balance'],
    ['Pending balance',snapshot?.data?.balance?usd(sum(snapshot.data.balance.pending||[],'amount')):'Unavailable','Awaiting availability'],
    ['Paid out',snapshot?.data?.payouts?usd(sum(payouts.filter(p=>p.status==='paid'),'amount')):'Unavailable',
      snapshot?.data?.payouts?.has_more?'Latest 50 payouts':'Retrieved Stripe payouts']
  ]
  const renderCells=r=>{
    if(view==='payments')return [day(r.created),r.id,r.description||'—',usd(r.amount_received||r.amount),statusChip(r.status)]
    if(view==='subscriptions')return [day(r.created),r.office||'—',r.id,usd(r.amount_cents),statusChip(r.status),day(r.cancel_at)]
    if(view==='invoices')return [day(r.created),r.number||r.id,r.subscription_id||'—',usd(r.amount_paid),usd(r.amount_remaining),statusChip(r.status)]
    if(view==='payouts')return [day(r.created),r.id,usd(r.amount),day(r.arrival_date),statusChip(r.status)]
    if(view==='refunds')return [day(r.created),r.id,r.payment_intent||'—',usd(r.amount),statusChip(r.status)]
    return [day(r.created),r.id,r.payment_intent||'—',usd(r.amount),statusChip(r.status)]
  }
  return <section aria-label="RomyLabs Stripe merchant financial dashboard" style={{marginBottom:22}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginBottom:11}}>
      <div><div style={{fontSize:15,fontWeight:850,color:'#f8fafc'}}>Merchant activity</div>
        <div style={{fontSize:11,color:'#94a3b8',marginTop:4}}>
          Stripe live merchant records · SaaS collections only · {snapshot?.as_of?'Updated '+new Date(snapshot.as_of).toLocaleString():'Not yet loaded'}
        </div></div>
      <button type="button" onClick={()=>{void reload();onRefresh?.()}} disabled={loading} style={{...b,opacity:loading?.6:1}}>
        {loading?'Refreshing…':'↻ Refresh financials'}
      </button>
    </div>
    {error&&<div role="alert" style={{marginBottom:12,color:'#fecaca',fontSize:12}}>Stripe data could not be loaded: {error}</div>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(165px,1fr))',gap:10,marginBottom:15}}>
      {financial.map(([label,value,detail])=><div key={label} style={{...surface,padding:'14px 15px'}}>
        <div style={{fontSize:10,fontWeight:800,textTransform:'uppercase',color:'#94a3b8'}}>{label}</div>
        <div style={{fontSize:22,fontWeight:850,color:'#f8fafc',marginTop:7}}>{snapshot?value:'—'}</div>
        <div style={{fontSize:10,color:'#64748b',marginTop:5}}>{detail}</div>
      </div>)}
    </div>
    <div style={{...surface}}>
      <div style={{display:'flex',alignItems:'center',gap:7,padding:12,flexWrap:'wrap',borderBottom:'1px solid rgba(129,140,248,.13)'}}>
        {views.map(([id,label])=><button key={id} type="button" onClick={()=>{setView(id);setSearch('')}} style={{
          ...b,background:view===id?'rgba(99,102,241,.27)':'transparent',borderColor:view===id?'rgba(165,180,252,.5)':'transparent',
          color:view===id?'#f8fafc':'#94a3b8'
        }}>{label}{snapshot?.data?.[id==='payments'?'payment_intents':id]?.rows?.length!=null?' ('+snapshot.data[id==='payments'?'payment_intents':id].rows.length+')':''}</button>)}
      </div>
      <div style={{padding:'10px 12px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={'Search '+view}
          aria-label={'Search Stripe '+view} style={{background:'#100f1d',color:'#f8fafc',border:'1px solid rgba(129,140,248,.23)',
          padding:'9px 11px',borderRadius:8,fontSize:12,flex:'1 1 250px',maxWidth:420}}/>
        <span style={{fontSize:11,color:'#94a3b8'}}>Read-only · No charges or refunds initiated here</span>
      </div>
      {snapshot?.errors?.[view==='payments'?'payment_intents':view]?
        <div role="status" style={{padding:'18px 15px',color:'#fbbf24',fontSize:12}}>
          This Stripe section is unavailable: {snapshot.errors[view==='payments'?'payment_intents':view]}.
          Grant read-only access to this resource in the merchant restricted API key.
        </div>:
        <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:750}}>
          <thead><tr>{viewHeaders[view].map(x=><th key={x} style={headers}>{x}</th>)}</tr></thead>
          <tbody>{rows.length?rows.map(r=><tr key={r.id}>{renderCells(r).map((c,i)=><td key={i} style={{...tableCell,maxWidth:i===2?280:210,overflow:'hidden',textOverflow:'ellipsis'}} title={typeof c==='string'?c:undefined}>{c}</td>)}</tr>):
            <tr><td colSpan={6} style={{...tableCell,padding:24,textAlign:'center'}}>No {view} found in the retrieved Stripe records.</td></tr>}
          </tbody>
        </table></div>}
      {snapshot?.data?.[view==='payments'?'payment_intents':view]?.has_more&&
        <div style={{padding:11,fontSize:11,color:'#fbbf24'}}>Showing the 50 most recent Stripe records only; these are not all-time totals.</div>}
    </div>
  </section>
}
