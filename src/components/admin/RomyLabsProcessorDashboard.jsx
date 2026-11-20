import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from '../../lib/supabase'
const usd=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(c||0)/100)
const day=seconds=>seconds?new Date(Number(seconds)*1000).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'
const surface={border:'1px solid rgba(129,140,248,.2)',borderRadius:12,background:'rgba(255,255,255,.025)',overflow:'hidden'}
const tableCell={textAlign:'left',padding:'12px 15px',fontSize:12,color:'#cbd5e1',borderBottom:'1px solid rgba(129,140,248,.1)',whiteSpace:'nowrap'}
const headers={...tableCell,fontSize:10,color:'#94a3b8',fontWeight:800,textTransform:'uppercase',letterSpacing:'.045em',background:'rgba(99,102,241,.045)'}
const b={borderRadius:8,padding:'8px 12px',border:'1px solid rgba(129,140,248,.28)',color:'#c7d2fe',background:'rgba(99,102,241,.10)',fontSize:12,fontWeight:750,cursor:'pointer',transition:'background .15s ease,border-color .15s ease'}
const views=[['payments','Transactions'],['subscriptions','Subscriptions'],['invoices','Stripe invoices'],['payouts','Payouts'],['balance_transactions','Fees & net'],['refunds','Refunds'],['disputes','Disputes']]
const viewHeaders={
  payments:['Date','Payment','Description','Amount','Status'],
  subscriptions:['Created','Office','Subscription','Monthly','Status','Scheduled end'],
  invoices:['Created','Invoice','Subscription','Paid','Balance','Status'],
  payouts:['Created','Payout','Amount','Arrival','Status'],
  balance_transactions:['Date','Transaction','Category','Gross','Fee','Net'],
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
  const [historyOpen,setHistoryOpen]=useState(false),[historyLimit,setHistoryLimit]=useState(20)
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
  // Collapsed means hidden, not a different row limit. Search opens results without changing the disclosure.
  const showTransactionTable=view!=='payments'||historyOpen||Boolean(search.trim())
  const shownRows=view==='payments'&&!search.trim()?rows.slice(0,historyLimit):rows
  const payments=snapshot?.data?.payment_intents?.rows||[]
  const payouts=snapshot?.data?.payouts?.rows||[]
  const charges=(snapshot?.data?.balance_transactions?.rows||[]).filter(p=>p.reporting_category==='charge'||p.type==='charge')
  const financial=[
    ['Stripe payments',usd(sum(payments.filter(p=>p.status==='succeeded'),'amount_received')),
      snapshot?.data?.payment_intents?.has_more?'Latest 50 · not all-time':'Retrieved Stripe payments'],
    ['Stripe processing fees',snapshot?.data?.balance_transactions?usd(sum(charges,'fee')):'Unavailable',
      snapshot?.data?.balance_transactions?.has_more?'Latest 50 ledger entries':'Retrieved charge fees'],
    ['Available balance',snapshot?.data?.balance?usd(sum(snapshot.data.balance.available||[],'amount')):'Unavailable','Stripe merchant balance'],
    ['Pending balance',snapshot?.data?.balance?usd(sum(snapshot.data.balance.pending||[],'amount')):'Unavailable','Awaiting availability'],
    ['Paid out',snapshot?.data?.payouts?usd(sum(payouts.filter(p=>p.status==='paid'),'amount')):'Unavailable',
      snapshot?.data?.payouts?.has_more?'Latest 50 payouts':'Retrieved Stripe payouts']
  ]
  const renderCells=r=>{
    if(view==='payments')return [day(r.created),r.id,r.description||'—',usd(r.amount_received||r.amount),statusChip(r.status)]
    if(view==='subscriptions')return [day(r.created),r.office||'—',r.id,usd(r.amount_cents),statusChip(r.status),day(r.cancel_at)]
    if(view==='invoices')return [day(r.created),r.number||r.id,r.subscription_id||r.account_name||'—',usd(r.amount_paid),usd(r.amount_remaining),statusChip(r.status)]
    if(view==='payouts')return [day(r.created),r.id,usd(r.amount),day(r.arrival_date),statusChip(r.status)]
    if(view==='balance_transactions')return [day(r.created),r.id,r.reporting_category||r.type,usd(r.amount),usd(r.fee),usd(r.net)]
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
      <div role="tablist" aria-label="Stripe finance categories" style={{display:'flex',alignItems:'center',gap:6,padding:'11px 12px',flexWrap:'wrap',borderBottom:'1px solid rgba(129,140,248,.13)',background:'rgba(99,102,241,.025)'}}>
        {views.map(([id,label])=><button key={id} type="button" role="tab" aria-selected={view===id} onClick={()=>{setView(id);setSearch('');setHistoryOpen(false);setHistoryLimit(20)}} style={{
          ...b,padding:'8px 13px',fontWeight:view===id?800:650,background:view===id?'rgba(99,102,241,.24)':'transparent',borderColor:view===id?'rgba(165,180,252,.56)':'transparent',
          color:view===id?'#f8fafc':'#a6b1c4'
        }}>{label}{snapshot?.data?.[id==='payments'?'payment_intents':id]?.rows?.length!=null?' ('+snapshot.data[id==='payments'?'payment_intents':id].rows.length+')':''}</button>)}
      </div>
      <div style={{padding:'13px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={'Search '+view}
          aria-label={'Search Stripe '+view} style={{background:'#100f1d',color:'#f8fafc',border:'1px solid rgba(129,140,248,.23)',
          padding:'10px 12px',borderRadius:9,fontSize:12,flex:'1 1 250px',maxWidth:420}}/>
        <span style={{fontSize:11,color:'#94a3b8'}}>Read-only · No charges or refunds initiated here</span>
      </div>
      {view==='invoices'&&snapshot?.data?.invoices?.source==='romylabs_reconciled_ledger'&&
        <div role="status" style={{padding:'10px 14px',margin:'0 14px 12px',border:'1px solid rgba(129,140,248,.18)',borderRadius:9,
          background:'rgba(99,102,241,.06)',fontSize:11,lineHeight:1.6,color:'#c7d2fe'}}>
          Showing Stripe-paid invoices verified in the RomyLabs billing ledger.
          This is not the full Stripe invoice history; direct Stripe invoice access requires Invoices: Read permission.
        </div>}
      {snapshot?.errors?.[view==='payments'?'payment_intents':view]?
        <div role="status" style={{margin:'1px 14px 15px',padding:'13px 15px',borderRadius:9,background:'rgba(245,158,11,.055)',border:'1px solid rgba(245,158,11,.17)',color:'#fcd34d',fontSize:12,lineHeight:1.6}}>
          <strong style={{display:'block',fontSize:12,color:'#fde68a',marginBottom:3}}>Stripe access needed</strong>
          {snapshot.errors[view==='payments'?'payment_intents':view]}. Enable read-only permission for this section in your Stripe restricted key.
        </div>:
        <div>
          {view==='payments'&&<div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',padding:'0 14px 11px'}}>
            <button type="button" aria-expanded={historyOpen} aria-controls="romylabs-stripe-transaction-list" onClick={()=>{setHistoryOpen(v=>!v);setHistoryLimit(20)}} style={{...b,background:'transparent',borderColor:'rgba(129,140,248,.2)',color:'#cbd5e1'}}>
              {historyOpen?'▴ Hide transactions':'▾ Show transactions'}
            </button>
            <span style={{fontSize:11,color:'#94a3b8'}}>{!showTransactionTable?rows.length+' transactions hidden':shownRows.length+' of '+rows.length+' loaded transactions'}</span>
          </div>}
          {showTransactionTable&&<div id="romylabs-stripe-transaction-list" style={{overflowX:'auto',maxHeight:view==='payments'&&historyOpen?480:undefined,overflowY:view==='payments'&&historyOpen?'auto':undefined}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:750}}>
          <thead><tr>{viewHeaders[view].map(x=><th key={x} style={headers}>{x}</th>)}</tr></thead>
          <tbody>{shownRows.length?shownRows.map(r=><tr key={r.id} style={{background:'transparent'}}>{renderCells(r).map((c,i)=><td key={i} style={{...tableCell,maxWidth:i===2?280:210,overflow:'hidden',textOverflow:'ellipsis'}} title={typeof c==='string'?c:undefined}>{c}</td>)}</tr>):
            <tr><td colSpan={6} style={{...tableCell,padding:24,textAlign:'center'}}>No {view} found in the retrieved Stripe records.</td></tr>}
          </tbody>
        </table></div>}
          {view==='payments'&&historyOpen&&shownRows.length<rows.length&&<div style={{textAlign:'center',padding:'12px 14px',borderTop:'1px solid rgba(129,140,248,.12)'}}>
            <button type="button" onClick={()=>setHistoryLimit(n=>n+20)} style={b}>Show 20 more transactions</button>
          </div>}
        </div>}
      {snapshot?.data?.[view==='payments'?'payment_intents':view]?.has_more&&
        <div style={{padding:11,fontSize:11,color:'#fbbf24'}}>Showing the 50 most recent Stripe records only; these are not all-time totals.</div>}
    </div>
  </section>
}
