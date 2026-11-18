import React,{useMemo,useState} from 'react'

const money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(c||0)/100)
const day=s=>s?new Date(s).toLocaleDateString('en-US',{year:'numeric',month:'2-digit',day:'2-digit'}):'—'
const input={background:'#11101d',border:'1px solid rgba(99,102,241,.28)',borderRadius:8,padding:'9px 10px',color:'#e2e8f0',fontSize:12,minWidth:0}
const button={background:'rgba(99,102,241,.14)',border:'1px solid rgba(99,102,241,.3)',borderRadius:8,padding:'9px 12px',color:'#c7d2fe',fontSize:12,fontWeight:800,cursor:'pointer'}
const tableHead={textAlign:'left',fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.04em',borderBottom:'1px solid rgba(99,102,241,.2)',padding:'10px 12px',whiteSpace:'nowrap'}
const cell={fontSize:12,padding:'10px 12px',borderBottom:'1px solid rgba(99,102,241,.1)',color:'#cbd5e1'}
const keyText=v=>String(v??'').toLowerCase()
const csvSafe=v=>{
  let value=String(v??'')
  // Do not allow spreadsheet formula evaluation in exported customer-owned values.
  if(/^[\s]*[=+@\-]/.test(value))value="'"+value
  return '"'+value.replace(/"/g,'""')+'"'
}
const csv=(header,rows)=>[header.map(csvSafe).join(','),...rows.map(r=>r.map(csvSafe).join(','))].join('\r\n')
function downloadCsv(filename,header,rows){
  const blob=new Blob(['\uFEFF',csv(header,rows)],{type:'text/csv;charset=utf-8'})
  const url=URL.createObjectURL(blob)
  try{const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove()}
  finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}
}
function Summary({title,value}){return <div style={{padding:'12px 14px',background:'rgba(255,255,255,.035)',border:'1px solid rgba(99,102,241,.16)',borderRadius:10}}><div style={{color:'#94a3b8',fontSize:10,fontWeight:700}}>{title}</div><div style={{fontSize:19,fontWeight:900,color:'#f8fafc',marginTop:5}}>{value}</div></div>}
function Status({value}){return <span style={{fontWeight:800,color:value==='paid'||value==='succeeded'?'#34d399':value==='open'||value==='pending'?'#fbbf24':value==='failed'||value==='refunded'?'#f87171':'#cbd5e1'}}>{value||'—'}</span>}

export default function RomyLabsLedgerExplorer({accounts=[],invoices=[],payments=[],events=[]}){
  const [tab,setTab]=useState('payments')
  const [search,setSearch]=useState('')
  const [method,setMethod]=useState('all')
  const [status,setStatus]=useState('all')
  const [from,setFrom]=useState('')
  const [to,setTo]=useState('')
  const [limit,setLimit]=useState(100)
  const byId=useMemo(()=>new Map(accounts.map(a=>[a.id,a])),[accounts])
  const alerts=useMemo(()=>events.filter(e=>['manual_hold','payment_failed','suspension_pending'].includes(e.event_type)).slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,12),[events])
  const providers=useMemo(()=>[...new Set(payments.map(p=>p.provider||'manual'))].sort(),[payments])
  const statuses=tab==='payments'?['succeeded','pending','failed','refunded','partially_refunded']:['open','paid','uncollectible','void']
  const rows=useMemo(()=>{
    const source=tab==='payments'?payments:invoices
    return source.filter(row=>{
      const acc=byId.get(row.account_id)
      const when=tab==='payments'?(row.paid_at||row.created_at):(row.issued_at||row.created_at)
      const d=when?new Date(when).toISOString().slice(0,10):''
      if(from&&(!d||d<from))return false
      if(to&&(!d||d>to))return false
      if(status!=='all'&&row.status!==status)return false
      if(tab==='payments'&&method!=='all'&&(row.provider||'manual')!==method)return false
      if(search.trim()){
        const haystack=[acc?.account_name,acc?.product_key,acc?.billing_email,acc?.external_tenant_id,row.invoice_number,row.provider_payment_id,row.reference,row.provider_invoice_id,row.id,row.invoice_id,row.provider,row.status].map(keyText).join(' ')
        if(!haystack.includes(search.trim().toLowerCase()))return false
      }
      return true
    }).sort((a,b)=>new Date((tab==='payments'?b.paid_at:b.issued_at)||b.created_at||0)-new Date((tab==='payments'?a.paid_at:a.issued_at)||a.created_at||0))
  },[tab,payments,invoices,byId,from,to,search,status,method])
  const settled=rows.filter(r=>r.status===(tab==='payments'?'succeeded':'paid'))
  const total=settled.reduce((sum,r)=>sum+Number(tab==='payments'?r.amount_cents:r.amount_paid_cents||r.amount_cents||0),0)
  const open=rows.filter(r=>r.status==='open').reduce((sum,r)=>sum+Math.max(0,Number(r.amount_cents||0)-Number(r.amount_paid_cents||0)),0)
  const page=rows.slice(0,limit)
  const exportRows=()=>tab==='payments'?
    downloadCsv('romylabs-payment-transactions.csv',['Paid date','Created date','Office','Product','Billing email','Amount USD','Method','Status','Invoice ID','Payment reference'],
      rows.map(p=>{const a=byId.get(p.account_id);return [p.paid_at||'',p.created_at||'',a?.account_name||'',a?.product_key||'',a?.billing_email||'',Number(p.amount_cents||0)/100,p.provider||'manual',p.status||'',p.invoice_id||'',p.provider_payment_id||p.reference||'']})):
    downloadCsv('romylabs-invoices.csv',['Issued','Due','Invoice','Office','Product','Amount USD','Paid USD','Balance USD','Status','Payment provider','Provider invoice ID'],
      rows.map(i=>{const a=byId.get(i.account_id);return [i.issued_at||'',i.due_at||'',i.invoice_number||'',a?.account_name||'',a?.product_key||'',Number(i.amount_cents||0)/100,Number(i.amount_paid_cents||0)/100,Math.max(0,Number(i.amount_cents||0)-Number(i.amount_paid_cents||0))/100,i.status||'',i.provider||'',i.provider_invoice_id||'']}))
  const changeTab=value=>{setTab(value);setLimit(100);setStatus('all');setMethod('all')}
  return <section style={{marginTop:24}} aria-label="RomyLabs billing transaction ledger">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12,marginBottom:12}}>
      <div><div style={{fontSize:14,fontWeight:900,color:'#f8fafc'}}>Payment Transactions & Invoice Ledger</div><div style={{fontSize:11,color:'#94a3b8',marginTop:4}}>One ledger for RomyLabs SaaS offices. Stripe, ACH and manual payments; office customer payments stay separate.</div></div>
      <button type="button" style={button} onClick={exportRows}>Export {tab==='payments'?'Transactions':'Invoices'} CSV ({rows.length})</button>
    </div>
    {alerts.length>0&&<details style={{marginBottom:12,padding:'10px 13px',border:'1px solid rgba(245,158,11,.25)',borderRadius:10}}>
      <summary style={{fontSize:12,fontWeight:800,color:'#fbbf24',cursor:'pointer'}}>Collection exceptions & finance review ({alerts.length} recent)</summary>
      <div style={{display:'grid',gap:8,marginTop:12}}>{alerts.map(e=><div key={e.id} style={{fontSize:11,color:'#cbd5e1',display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
        <span>{byId.get(e.account_id)?.account_name||'Unknown office'} · {String(e.event_type||'').replaceAll('_',' ')}</span>
        <span>{day(e.created_at)} · {e.detail?.stripe_event_type||e.channel||'billing review'}</span>
      </div>)}</div>
    </details>}
    <div style={{display:'flex',gap:8,marginBottom:12}}>{[['payments','Payments'],['invoices','Invoices']].map(([value,label])=><button type="button" key={value} onClick={()=>changeTab(value)} style={{...button,background:tab===value?'rgba(99,102,241,.3)':'transparent',borderColor:tab===value?'#818cf8':'rgba(99,102,241,.2)'}}>{label} ({value==='payments'?payments.length:invoices.length})</button>)}</div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:12}}>
      <Summary title="Matching records" value={rows.length.toLocaleString()}/>
      <Summary title={tab==='payments'?'Successful payments':'Paid invoices'} value={settled.length.toLocaleString()}/>
      <Summary title={tab==='payments'?'Collected in filtered records':'Paid value in filtered records'} value={money(total)}/>
      {tab==='invoices'&&<Summary title="Outstanding balance" value={money(open)}/>}
    </div>
    <div style={{display:'grid',gridTemplateColumns:'minmax(190px,2fr) repeat(4,minmax(125px,1fr))',gap:8,marginBottom:12}}>
      <input aria-label="Search billing transactions" placeholder="Search office, invoice, email or reference" style={input} value={search} onChange={e=>{setSearch(e.target.value);setLimit(100)}}/>
      {tab==='payments'?<select style={input} aria-label="Filter payment method" value={method} onChange={e=>setMethod(e.target.value)}><option value="all">All methods</option>{providers.map(x=><option key={x} value={x}>{x}</option>)}</select>:<div/>}
      <select style={input} aria-label="Filter billing status" value={status} onChange={e=>{setStatus(e.target.value);setLimit(100)}}><option value="all">All statuses</option>{statuses.map(x=><option key={x} value={x}>{x}</option>)}</select>
      <input style={input} aria-label="From date" type="date" value={from} onChange={e=>{setFrom(e.target.value);setLimit(100)}}/>
      <input style={input} aria-label="To date" type="date" min={from||undefined} value={to} onChange={e=>{setTo(e.target.value);setLimit(100)}}/>
    </div>
    <div style={{overflowX:'auto',border:'1px solid rgba(99,102,241,.2)',borderRadius:12}}>
      <table style={{borderCollapse:'collapse',width:'100%',minWidth:900}}>
        <thead><tr>{(tab==='payments'?['Payment date','Office','Product','Amount','Method','Status','Reference','Invoice ID']:['Issued','Invoice','Office','Amount','Paid','Balance','Due','Status']).map(x=><th key={x} style={tableHead}>{x}</th>)}</tr></thead>
        <tbody>{page.length===0?<tr><td colSpan={8} style={{...cell,textAlign:'center',padding:24}}>No records match the selected filters.</td></tr>:page.map(p=>{
          const a=byId.get(p.account_id)
          if(tab==='payments')return <tr key={p.id}><td style={cell}>{day(p.paid_at||p.created_at)}</td><td style={cell}>{a?.account_name||'Unknown office'}</td><td style={cell}>{a?.product_key||'—'}</td><td style={cell}>{money(p.amount_cents)}</td><td style={cell}>{p.provider||'manual'}</td><td style={cell}><Status value={p.status}/></td><td style={{...cell,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis'}} title={p.provider_payment_id||p.reference||''}>{p.provider_payment_id||p.reference||'—'}</td><td style={{...cell,maxWidth:150,overflow:'hidden',textOverflow:'ellipsis'}} title={p.invoice_id||''}>{p.invoice_id||'—'}</td></tr>
          return <tr key={p.id}><td style={cell}>{day(p.issued_at)}</td><td style={cell}>{p.invoice_number||'—'}</td><td style={cell}>{a?.account_name||'Unknown office'}</td><td style={cell}>{money(p.amount_cents)}</td><td style={cell}>{money(p.amount_paid_cents)}</td><td style={cell}>{money(Math.max(0,Number(p.amount_cents||0)-Number(p.amount_paid_cents||0)))}</td><td style={cell}>{day(p.due_at)}</td><td style={cell}><Status value={p.status}/></td></tr>
        })}</tbody>
      </table>
    </div>
    <div style={{marginTop:10,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap',color:'#94a3b8',fontSize:11}}>
      <span>Showing {Math.min(limit,rows.length)} of {rows.length} filtered records. CSV exports all filtered rows, not just the visible page.</span>
      {rows.length>limit&&<button type="button" style={button} onClick={()=>setLimit(n=>n+100)}>Show 100 more</button>}
    </div>
  </section>
}
