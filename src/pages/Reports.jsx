import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FIRM } from '../lib/firmBranding'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { exportPDF, exportExcel } from '../lib/exportUtils'
import { OPEN_STATUSES, PIPELINE_STAGE_KEYS as PIPELINE_STAGES, PIPELINE_STAGE_LABELS as STAGE_LABELS, DEFAULT_PIPELINE_STAGE } from '../lib/caseStatuses'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const TABS = [
  { key:'overview',    label:'📊 Overview' },
  { key:'bookwhip',    label:'📚 Book Whip' },
  { key:'pipeline',   label:'🔄 Pipeline' },
  { key:'revenue',    label:'💰 Revenue' },
  { key:'reps',       label:'👥 Rep Performance' },
  { key:'leads',      label:'📋 Leads' },
  { key:'cases',      label:'📁 Cases' },
  { key:'tasks',      label:'✅ Tasks' },
  { key:'taxreturns', label:'🧾 Tax Returns' },
  { key:'esign',      label:'✍️ E-Signatures' },
  { key:'formacorp',  label:'🏢 FormaCorp' },
  { key:'books',      label:'📒 Books & Ledger' },
]

export default function Reports() {
  const { user } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('all')
  const [data, setData] = useState({
    clients:[], leads:[], cases:[], tasks:[], invoices:[],
    payments:[], deadlines:[], employees:[], taxReturns:[],
    esigns:[], formacorp:[], bookkeeping:[]
  })
  const thisMonth = new Date().toISOString().slice(0,7) + '-01'
  const [bookWhipMonth,setBookWhipMonth] = useState(thisMonth)
  const [bookWhipRows,setBookWhipRows] = useState([])
  const [bookWhipLoading,setBookWhipLoading] = useState(false)
  const [bookWhipSearch,setBookWhipSearch] = useState('')
  const [bookWhipAssociate,setBookWhipAssociate] = useState('all')
  const [bookWhipFilter,setBookWhipFilter] = useState('all')
  const [bookWhipSort,setBookWhipSort] = useState({key:'client_name',direction:'asc'})
  const [bookWhipPage,setBookWhipPage] = useState(1)
  const BOOK_WHIP_PAGE_SIZE = 100

  // Guard: wait for auth — every office remains tenant-scoped.
  useEffect(() => { if (user) loadAll() }, [user?.id])
  useEffect(() => {
    if (!user || tab !== 'bookwhip') return
    loadBookWhip(bookWhipMonth)
  }, [user?.id,tab,bookWhipMonth])
  useEffect(() => {
    setBookWhipPage(1)
  }, [bookWhipMonth,bookWhipSearch,bookWhipAssociate,bookWhipFilter,bookWhipSort.key,bookWhipSort.direction])

  async function fetchAllRows(table, { orderBy, ascending=true, filter } = {}) {
    const pageSize = 1000
    const rows = []
    for (let from = 0; ; from += pageSize) {
      let query = supabase.from(table).select('*')
      if (filter) query = filter(query)
      if (orderBy) query = query.order(orderBy, { ascending })
      const { data: page, error } = await query.range(from, from + pageSize - 1)
      if (error) throw new Error(`${table} report load failed: ${error.message}`)
      rows.push(...(page || []))
      if (!page || page.length < pageSize) break
    }
    return rows
  }

  async function loadAll() {
    setLoading(true)
    try {
      const [clients,leads,cases,tasks,invoices,payments,deadlines,employees,taxReturns,esigns,formacorp,bookkeeping] = await Promise.all([
        fetchAllRows('clients',{orderBy:'created_at'}),
        fetchAllRows('leads',{orderBy:'created_at'}),
        fetchAllRows('cases',{orderBy:'created_at'}),
        fetchAllRows('tasks',{orderBy:'created_at',filter:q=>q.not('deleted','is',true)}),
        fetchAllRows('invoices',{orderBy:'created_at'}),
        fetchAllRows('payments',{orderBy:'created_at'}),
        fetchAllRows('deadlines'),
        fetchAllRows('employees'),
        fetchAllRows('tax_returns',{orderBy:'created_at',ascending:false}),
        fetchAllRows('esigns',{orderBy:'created_at',ascending:false}),
        fetchAllRows('formacorp',{orderBy:'created_at',ascending:false}),
        fetchAllRows('bookkeeping',{orderBy:'date',ascending:false}),
      ])
      setData({ clients,leads,cases,tasks,invoices,payments,deadlines,employees,taxReturns,esigns,formacorp,bookkeeping })
    } catch (err) {
      console.error('Reports exhaustive load failed:', err)
      setData({ clients:[], leads:[], cases:[], tasks:[], invoices:[], payments:[], deadlines:[], employees:[], taxReturns:[], esigns:[], formacorp:[], bookkeeping:[] })
    } finally {
      setLoading(false)
    }
  }

  async function loadBookWhip(month) {
    if (!month) return
    setBookWhipLoading(true)
    const { data:rows,error } = await supabase.from('book_whip_rows')
      .select('*').eq('snapshot_month',month).order('client_name',{ascending:true})
    setBookWhipLoading(false)
    if (error) { console.error('Book Whip load failed:',error); return }
    setBookWhipRows(rows||[])
  }

  async function createBookWhipMonth() {
    setBookWhipLoading(true)
    const { error } = await supabase.rpc('create_book_whip_month',{p_month:bookWhipMonth})
    setBookWhipLoading(false)
    if (error) { console.error('Book Whip refresh failed:',error); return }
    await loadBookWhip(bookWhipMonth)
  }

  async function saveBookWhipField(id,field,value) {
    const allowed=new Set(['financials','transcripts','state_res_hold','hold_date','notes','quote','return_quote','resolution_step','chris_flag','johnny_flag','last_contact_date','assigned_associate','last_payment'])
    if(!allowed.has(field)) return
    const { error } = await supabase.from('book_whip_rows').update({[field]:value,updated_at:new Date().toISOString()}).eq('id',id)
    if(error){ console.error('Book Whip save failed:',error); return }
    setBookWhipRows(rows=>rows.map(r=>r.id===id?{...r,[field]:value}:r))
  }

  function filterByRange(arr, field='created_at') {
    if (dateRange==='all') return arr
    const cutoff = new Date()
    if (dateRange==='30d') cutoff.setDate(cutoff.getDate()-30)
    if (dateRange==='60d') cutoff.setDate(cutoff.getDate()-60)
    if (dateRange==='90d') cutoff.setDate(cutoff.getDate()-90)
    if (dateRange==='6mo') cutoff.setMonth(cutoff.getMonth()-6)
    if (dateRange==='ytd') cutoff.setMonth(0,1)
    return arr.filter(r => r[field] && new Date(r[field])>=cutoff)
  }

  function exportCSV(rows, name) {
    const csv = rows.map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = `TCR_${name}_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:300,color:'var(--t3)',fontSize:13}}>
      Loading reports…
    </div>
  )

  const { clients, leads, cases, tasks, invoices, payments, deadlines, employees, taxReturns, esigns, formacorp, bookkeeping } = data

  // ── SHARED COMPUTATIONS ──
  const normalizeStatus = (v) => String(v || '').trim().toLowerCase()
  const settledStatuses = new Set(['succeeded','cleared','paid','posted','completed','success'])
  const isSettledPayment = (p) => settledStatuses.has(normalizeStatus(p.status)) || settledStatuses.has(normalizeStatus(p.payment_status))
  const paymentDate = (p) => p.date || p.created_at
  const invoiceAmountDue = (i) => {
    const balance = parseFloat(i.balance)
    if (Number.isFinite(balance)) return Math.max(0, balance)
    return Math.max(0, parseFloat(i.total || i.amount || 0) - parseFloat(i.paid || 0))
  }
  const isConvertedLead = (l) => ['converted to client','converted','closed won'].includes(normalizeStatus(l.status))

  const fPayments = dateRange === 'all' ? payments : filterByRange(payments.map(p=>({...p,__reportDate:paymentDate(p)})), '__reportDate')
  const fInvoices = filterByRange(invoices)
  const fClients  = filterByRange(clients)
  const fLeads    = filterByRange(leads).filter(l=>!l.deleted_at)
  const fCases    = filterByRange(cases)

  const settledPayments = fPayments.filter(isSettledPayment)
  const totalRevenue    = settledPayments.reduce((s,p)=>s+parseFloat(p.amount||0),0)
  const pendingRevenue  = fInvoices.reduce((s,i)=>s+invoiceAmountDue(i),0)
  const openCases       = fCases.filter(c=>OPEN_STATUSES.includes(c.status)).length
  const overdueDl       = deadlines.filter(d=>d.dueDate&&new Date(d.dueDate)<new Date()&&d.status!=='Completed').length
  const conversionRate  = fLeads.length ? Math.round((fLeads.filter(isConvertedLead).length/fLeads.length)*100) : 0

  // Pipeline
  const pipelineCount = {}
  PIPELINE_STAGES.forEach(s=>pipelineCount[s]=0)
  clients.forEach(c=>{ const s=c.pipelineStage||DEFAULT_PIPELINE_STAGE; if(pipelineCount[s]!==undefined) pipelineCount[s]++ })
  const maxPipeline = Math.max(...Object.values(pipelineCount),1)

  // Revenue by month — chronological rolling 12 months; never collapse different years together.
  const monthBuckets = Array.from({length:12}, (_,offset) => {
    const d = new Date()
    d.setDate(1)
    d.setHours(0,0,0,0)
    d.setMonth(d.getMonth() - (11 - offset))
    return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}` }
  })
  const revByMonth = Object.fromEntries(monthBuckets.map((_,i)=>[i,0]))
  const bucketIndex = new Map(monthBuckets.map((b,i)=>[b.key,i]))
  settledPayments.forEach(p=>{
    const raw = paymentDate(p)
    if(!raw) return
    const d = new Date(raw)
    if(Number.isNaN(d.getTime())) return
    const idx = bucketIndex.get(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)
    if(idx !== undefined) revByMonth[idx] += parseFloat(p.amount||0)
  })
  const maxRev = Math.max(...Object.values(revByMonth),1)

  // Rep stats
  const reps = employees.length>0 ? employees.map(e=>e.name) : ['Romy Cruz','Dana Richard','Yesenia Gonzalez']
  const repStats = reps.map(rep => {
    const repClients  = clients.filter(c=>c.assignedTo===rep)
    const repCases    = cases.filter(c=>c.assignedTo===rep)
    const repClientIds = new Set(repClients.map(c=>String(c.id)))
    const repPayments = settledPayments.filter(p=>p.client_id && repClientIds.has(String(p.client_id)))
    const repTasks    = tasks.filter(t=>t.assignedTo===rep)
    const repLeads    = leads.filter(l=>l.assignedTo===rep)
    const repTR       = taxReturns.filter(r=>r.assigned_to===rep||r.preparer===rep)
    const repDone     = repTasks.filter(t=>t.done).length
    return {
      name: rep,
      clients:  repClients.length,
      cases:    repCases.length,
      leads:    repLeads.length,
      revenue:  repPayments.reduce((s,p)=>s+parseFloat(p.amount||0),0),
      openTasks:repTasks.filter(t=>!t.done).length,
      taskCompletion: repTasks.length ? Math.round((repDone/repTasks.length)*100) : 0,
      taxReturns: repTR.length,
    }
  })
  const topRep = repStats.reduce((a,b)=>b.revenue>a.revenue?b:a, repStats[0]||{})

  // ── REUSABLE COMPONENTS ──
  const StatCard = ({icon,label,value,sub,color,small}) => (
    <div className="card" style={{padding:'18px 16px'}}>
      <div style={{fontSize:22,marginBottom:6}}>{icon}</div>
      <div style={{fontSize:24,fontWeight:800,color:color||'var(--tx)',lineHeight:1,marginBottom:6}}>{value}</div>
      <div style={{fontSize:12,fontWeight:600,color:'var(--t2)',marginBottom:sub?3:0}}>{label}</div>
      {sub&&<div style={{fontSize:11,color:'var(--t3)'}}>{sub}</div>}
    </div>
  )

  const SectionTitle = ({title,action}) => (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,marginTop:4}}>
      <div style={{fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'.07em',color:'var(--t3)'}}>{title}</div>
      {action}
    </div>
  )

  const BarRow = ({label,value,max,color='var(--blue)',format,sub}) => {
    const pct = Math.round((value/Math.max(max,1))*100)
    return (
      <div style={{marginBottom:10}}>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
          <span style={{color:'var(--t2)',fontWeight:500}}>{label}{sub&&<span style={{color:'var(--t3)',fontSize:10,marginLeft:6}}>{sub}</span>}</span>
          <span style={{fontWeight:700,color:'var(--tx)'}}>{format?format(value):value}</span>
        </div>
        <div style={{height:7,background:'var(--s3)',borderRadius:4,overflow:'hidden'}}>
          <div style={{height:'100%',width:pct+'%',background:color,borderRadius:4,transition:'width .4s ease'}}/>
        </div>
      </div>
    )
  }

  const ExportBtn = ({rows, name, pdfSections}) => (
    <div style={{display:'flex',gap:4}}>
      <button className="btn sec" style={{fontSize:10,padding:'3px 10px'}} onClick={()=>exportCSV(rows,name)}>⬇ CSV</button>
      <button className="btn sec" style={{fontSize:10,padding:'3px 10px'}} onClick={()=>exportExcel(rows, name)}>📊 Excel</button>
      {pdfSections && <button className="btn sec" style={{fontSize:10,padding:'3px 10px'}} onClick={()=>exportPDF(name, pdfSections)}>🖨️ PDF</button>}
    </div>
  )

  const Empty = ({msg='No data yet.'}) => (
    <div style={{fontSize:12,color:'var(--t3)',padding:'20px 0',textAlign:'center'}}>{msg}</div>
  )

  // count helper
  const countBy = (arr, key) => arr.reduce((a,r)=>{ const v=r[key]||'Unknown'; a[v]=(a[v]||0)+1; return a },{})

  const cleanBookWhipName = r => String(r.client_display||r.client_name||'').replace(/\s+[0-9]{5}$/,'').replace(/\s{2,}/g,' ').trim()
  const fmtBookWhipDate = value => {
    if(!value) return '—'
    const d=new Date(value)
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'numeric'})
  }
  const bookWhipAssociates=[...new Set(bookWhipRows.map(r=>r.assigned_associate).filter(Boolean))].sort()
  const bookWhipBase=bookWhipRows.filter(r=>{
    const q=bookWhipSearch.trim().toLowerCase()
    const searchOk=!q || [r.client_name,r.client_owner,r.assigned_associate,r.notes,r.last_payment,r.state_res_hold].some(v=>String(v||'').toLowerCase().includes(q))
    return searchOk && (bookWhipAssociate==='all' || r.assigned_associate===bookWhipAssociate)
  })
  const filteredBookWhip=bookWhipBase.filter(r=>{
    if(bookWhipFilter==='financials') return !String(r.financials||'').trim()
    if(bookWhipFilter==='transcripts') return !!String(r.transcripts||'').trim() && !['yes','complete','completed','received'].includes(normalizeStatus(r.transcripts))
    if(bookWhipFilter==='contact') return !String(r.last_contact_date||'').trim()
    return true
  })
  const bookWhipColumns=[
    ['client_name','Client Name'],['client_since','Client Since'],['client_owner','Client Owner'],['source_created_on','Created On'],
    ['tags','Tags'],['spouse_name','Spouse Name'],['client_display','Client'],['assigned_associate','Assigned Associate'],
    ['financials','Financials'],['last_payment','Last Payment'],['transcripts','Transcripts'],['state_res_hold','State Res/Hold'],
    ['hold_date','Hold Date'],['notes','Notes'],['quote','Quote'],['return_quote','Return Quote'],['resolution_step','Resolution Step'],
    ['chris_flag','Chris'],['johnny_flag','Johnny'],['last_contact_date','Last Contact Date']
  ]
  const bookWhipHeaders=bookWhipColumns.map(([,label])=>label)
  const sortBookWhipValue=(r,key)=>{
    if(key==='client_name'||key==='client_display') return cleanBookWhipName(r).toLowerCase()
    if(['client_since','source_created_on','hold_date','last_contact_date'].includes(key)){
      const d=new Date(r[key]||'')
      return Number.isNaN(d.getTime()) ? String(r[key]||'').toLowerCase() : d.getTime()
    }
    if(['quote','return_quote'].includes(key)){
      const n=Number(String(r[key]||'').replace(/[^0-9.-]/g,''))
      return Number.isFinite(n)?n:String(r[key]||'').toLowerCase()
    }
    return String(r[key]||'').toLowerCase()
  }
  const sortedBookWhip=[...filteredBookWhip].sort((a,b)=>{
    const av=sortBookWhipValue(a,bookWhipSort.key),bv=sortBookWhipValue(b,bookWhipSort.key)
    const cmp=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'})
    return bookWhipSort.direction==='asc'?cmp:-cmp
  })
  const toggleBookWhipSort=key=>setBookWhipSort(s=>s.key===key?{key,direction:s.direction==='asc'?'desc':'asc'}:{key,direction:'asc'})
  const bookWhipPageCount=Math.max(1,Math.ceil(sortedBookWhip.length/BOOK_WHIP_PAGE_SIZE))
  const safeBookWhipPage=Math.min(bookWhipPage,bookWhipPageCount)
  const pagedBookWhip=sortedBookWhip.slice((safeBookWhipPage-1)*BOOK_WHIP_PAGE_SIZE,safeBookWhipPage*BOOK_WHIP_PAGE_SIZE)
  const bookWhipExportRows=sortedBookWhip.map(r=>[
    cleanBookWhipName(r),r.client_since,r.client_owner,fmtBookWhipDate(r.source_created_on),r.tags,r.spouse_name,cleanBookWhipName(r),
    r.assigned_associate,r.financials,r.last_payment,r.transcripts,r.state_res_hold,r.hold_date,r.notes,r.quote,r.return_quote,r.resolution_step,r.chris_flag,r.johnny_flag,r.last_contact_date
  ])
  const bookWhipEdit=(r,field,width=105,multiline=false)=>multiline
    ? <textarea defaultValue={r[field]||''} onBlur={e=>saveBookWhipField(r.id,field,e.target.value)} style={{width,minHeight:44,resize:'vertical',fontSize:11,padding:6,background:'var(--s2)',border:'1px solid var(--br)',borderRadius:5,color:'var(--tx)'}}/>
    : <input defaultValue={r[field]||''} onBlur={e=>saveBookWhipField(r.id,field,e.target.value)} style={{width,fontSize:11,padding:'5px 6px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:5,color:'var(--tx)'}}/>

  return (
    <div style={{padding:'20px 24px',maxWidth:tab==='bookwhip'?'none':1100,margin:'0 auto',boxSizing:'border-box'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:8}}>
        <h2 style={{fontSize:15,fontWeight:700,margin:0}}>📊 Reports & Analytics</h2>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <button className="btn sec" style={{fontSize:11,padding:'5px 12px'}}
            onClick={()=>exportPDF(`Reports — ${FIRM.name || 'Tax Case Review'}`,[{heading:'Revenue Summary',headers:['Month','Revenue'],rows:monthBuckets.map((b,i)=>[b.label,'$'+Math.round(revByMonth[i])])}])}>
            🖨️ PDF
          </button>
          <button className="btn sec" style={{fontSize:11,padding:'5px 12px'}}
            onClick={()=>exportExcel([['Month','Revenue'],...monthBuckets.map((b,i)=>[b.label,'$'+Math.round(revByMonth[i])])],'Reports')}>
            📊 Excel
          </button>
          <span style={{fontSize:11,color:'var(--t3)'}}>Range:</span>
          {[['all','All Time'],['30d','30 Days'],['60d','60 Days'],['90d','90 Days'],['6mo','6 Months'],['ytd','YTD']].map(([k,l])=>(
            <button key={k} className={`btn ${dateRange===k?'pri':'sec'}`}
              style={{fontSize:10,padding:'3px 10px'}} onClick={()=>setDateRange(k)}>{l}</button>
          ))}
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{display:'flex',gap:4,flexWrap:'wrap',borderBottom:'1px solid var(--br)',marginBottom:16,paddingBottom:6}}>
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)}
            style={{flex:'0 0 auto',padding:'10px 10px',fontSize:13,fontWeight:tab===t.key?700:500,
              borderBottom:tab===t.key?'3px solid var(--blue)':'3px solid transparent',
              background:'none',border:'none',
              color:tab===t.key?'var(--blue)':'var(--t2)',cursor:'pointer',whiteSpace:'nowrap',paddingBottom:10,
              transition:'color .15s'}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── BOOK WHIP ── */}
      {tab==='bookwhip'&&(
        <div>
          <div className="card" style={{padding:14,marginBottom:12}}>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <div style={{fontWeight:800,marginRight:6}}>📚 Monthly Book Whip</div>
              <input type="month" value={bookWhipMonth.slice(0,7)} onChange={e=>setBookWhipMonth(e.target.value+'-01')} style={{padding:'7px 9px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:7,color:'var(--tx)'}}/>
              <input value={bookWhipSearch} onChange={e=>setBookWhipSearch(e.target.value)} placeholder="Search client, notes, payment…" style={{minWidth:220,flex:'1 1 220px',padding:'7px 9px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:7,color:'var(--tx)'}}/>
              <select value={bookWhipAssociate} onChange={e=>setBookWhipAssociate(e.target.value)} style={{padding:'7px 9px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:7,color:'var(--tx)'}}>
                <option value="all">All Associates</option>
                {bookWhipAssociates.map(a=><option key={a} value={a}>{a}</option>)}
              </select>
              <button className="btn sec" disabled={bookWhipLoading} onClick={createBookWhipMonth}>＋ Create / Refresh Month</button>
              <button className="btn sec" disabled={!sortedBookWhip.length} onClick={()=>exportExcel([bookWhipHeaders,...bookWhipExportRows],`Book_Whip_${bookWhipMonth.slice(0,7)}`)}>📊 Excel</button>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(140px,1fr))',gap:10,marginBottom:12}}>
            {[
              ['all','Clients in Book Whip',bookWhipBase.length],
              ['financials','Financials Missing',bookWhipBase.filter(r=>!String(r.financials||'').trim()).length],
              ['transcripts','Transcript Issues',bookWhipBase.filter(r=>!!String(r.transcripts||'').trim()&&!['yes','complete','completed','received'].includes(normalizeStatus(r.transcripts))).length],
              ['contact','No Recent Contact',bookWhipBase.filter(r=>!String(r.last_contact_date||'').trim()).length],
            ].map(([key,label,value])=>(
              <button key={key} type="button" onClick={()=>setBookWhipFilter(key)}
                className="card"
                style={{padding:16,textAlign:'left',cursor:'pointer',border:bookWhipFilter===key?'1px solid var(--blue)':'1px solid var(--br)',background:bookWhipFilter===key?'var(--blt)':'var(--s1)'}}>
                <div style={{fontSize:24,fontWeight:800,color:'var(--tx)'}}>{value}</div>
                <div style={{fontSize:12,fontWeight:700,color:'var(--t2)',marginTop:5}}>{label}</div>
                <div style={{fontSize:10,color:'var(--t3)',marginTop:5}}>Click to filter</div>
              </button>
            ))}
          </div>

          {bookWhipLoading ? <div style={{padding:40,textAlign:'center',color:'var(--t3)'}}>Loading Book Whip…</div> :
           sortedBookWhip.length===0 ? <div className="card"><Empty msg="No Book Whip rows match this filter."/></div> :
           <div className="card" style={{padding:0,overflow:'hidden'}}>
             <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'10px 12px',borderBottom:'1px solid var(--br)',flexWrap:'wrap'}}>
               <div style={{fontSize:11,color:'var(--t3)'}}>Showing {sortedBookWhip.length ? ((safeBookWhipPage-1)*BOOK_WHIP_PAGE_SIZE)+1 : 0}–{Math.min(safeBookWhipPage*BOOK_WHIP_PAGE_SIZE,sortedBookWhip.length)} of {sortedBookWhip.length}</div>
               <div style={{display:'flex',alignItems:'center',gap:6}}>
                 <button className="btn sec" style={{fontSize:10,padding:'4px 9px'}} disabled={safeBookWhipPage<=1} onClick={()=>setBookWhipPage(p=>Math.max(1,p-1))}>← Prev</button>
                 <span style={{fontSize:11,color:'var(--t2)'}}>Page {safeBookWhipPage} / {bookWhipPageCount}</span>
                 <button className="btn sec" style={{fontSize:10,padding:'4px 9px'}} disabled={safeBookWhipPage>=bookWhipPageCount} onClick={()=>setBookWhipPage(p=>Math.min(bookWhipPageCount,p+1))}>Next →</button>
               </div>
             </div>
             <div style={{overflowX:'auto',overflowY:'auto',maxHeight:'68vh'}}>
             <table style={{borderCollapse:'collapse',fontSize:11,minWidth:3000,width:'max-content'}}>
               <thead style={{position:'sticky',top:0,zIndex:2,background:'var(--s1)'}}><tr>{bookWhipColumns.map(([key,label])=><th key={key} style={{textAlign:'left',padding:'8px 7px',borderBottom:'1px solid var(--br)',whiteSpace:'nowrap'}}><button type="button" onClick={()=>toggleBookWhipSort(key)} style={{background:'none',border:0,padding:0,color:'inherit',font:'inherit',fontWeight:700,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4}} title={`Sort ${label} ${bookWhipSort.key===key&&bookWhipSort.direction==='asc'?'descending':'ascending'}`}>{label}<span style={{fontSize:9,opacity:bookWhipSort.key===key?1:.35}}>{bookWhipSort.key===key?(bookWhipSort.direction==='asc'?'▲':'▼'):'↕'}</span></button></th>)}</tr></thead>
               <tbody>{pagedBookWhip.map(r=><tr key={r.id}>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)',fontWeight:700,minWidth:210,whiteSpace:'nowrap',position:'sticky',left:0,background:'var(--s1)',zIndex:1}}>
                   <button type="button" onClick={()=>r.client_id&&navigate(`/clients/${r.client_id}`)} title="Open client"
                     style={{all:'unset',cursor:r.client_id?'pointer':'default',color:r.client_id?'var(--blue)':'var(--tx)',fontWeight:700}}>
                     {cleanBookWhipName(r)||'—'}
                   </button>
                 </td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)',whiteSpace:'nowrap'}}>{fmtBookWhipDate(r.client_since)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)',whiteSpace:'nowrap'}}>{r.client_owner||'—'}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)',whiteSpace:'nowrap'}}>{fmtBookWhipDate(r.source_created_on)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)',whiteSpace:'nowrap'}}>{r.tags||'—'}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)',whiteSpace:'nowrap'}}>{r.spouse_name||'—'}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)',whiteSpace:'nowrap'}}>{cleanBookWhipName(r)||'—'}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'assigned_associate',110)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'financials',85)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'last_payment',145)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'transcripts',100)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'state_res_hold',120)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'hold_date',100)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'notes',240,true)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'quote',90)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'return_quote',95)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'resolution_step',105)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'chris_flag',60)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'johnny_flag',60)}</td>
                 <td style={{padding:7,borderBottom:'1px solid var(--br)'}}>{bookWhipEdit(r,'last_contact_date',105)}</td>
               </tr>)}</tbody>
             </table>
             </div>
           </div>}
        </div>
      )}

      {/* ── OVERVIEW ── */}
      {tab==='overview'&&(
        <div>
          <SectionTitle title="Key Metrics"/>
          <div style={{display:'grid',gridTemplateColumns:'repeat(9,1fr)',gap:10,marginBottom:20}}>
            <StatCard icon="👥" label="Total Clients"    value={clients.length}   sub={`+${fClients.length} in range`} color="var(--blue)"/>
            <StatCard icon="📋" label="Total Leads"      value={leads.length}     sub={`${conversionRate}% conversion`} color="var(--warn)"/>
            <StatCard icon="📁" label="Active Cases"     value={openCases}        sub={`of ${cases.length} total`} color={openCases>0?'var(--warn)':'var(--ok)'}/>
            <StatCard icon="💰" label="Revenue Collected" value={'$'+Math.round(totalRevenue).toLocaleString()} color="var(--ok)"/>
            <StatCard icon="⏳" label="AR Outstanding"   value={'$'+Math.round(pendingRevenue).toLocaleString()} color="var(--warn)"/>
            <StatCard icon="💳" label="Invoices Paid"    value={invoices.filter(i=>i.status==='Paid').length} sub={`of ${invoices.length} total`} color="var(--ok)"/>
            <StatCard icon="🧾" label="Tax Returns"      value={taxReturns.length} color="var(--blue)"/>
            <StatCard icon="✍️" label="E-Sign Awaiting"  value={esigns.filter(e=>e.status==='Awaiting').length} color="var(--warn)"/>
            <StatCard icon="⚠️" label="Overdue Deadlines" value={overdueDl} color={overdueDl>0?'var(--bad)':'var(--ok)'}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
            <div className="card">
              <SectionTitle title="Clients by Issue Type"/>
              {Object.entries(countBy(clients,'issueType')).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={clients.length}/>
              ))}
              {clients.length===0&&<Empty/>}
            </div>
            <div className="card">
              <SectionTitle title="Case Status"/>
              {Object.entries(countBy(cases,'status')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={cases.length}
                  color={l==='Closed'?'var(--ok)':l==='Open'?'var(--blue)':'var(--warn)'}/>
              ))}
              {cases.length===0&&<Empty/>}
            </div>
          </div>
          <div className="card" style={{marginTop:12}}>
            <SectionTitle title="Firm Summary"/>
            <table style={{width:'100%',fontSize:14,borderCollapse:'collapse'}}>
              <tbody>
                {[
                  ['👥 Total Clients',clients.length,'📋 Total Leads',leads.length],
                  ['🆕 New Leads',leads.filter(l=>l.status==='New Lead').length,'🔄 Lead→Client Rate',conversionRate+'%'],
                  ['📁 Total Cases',cases.length,'🔓 Open/Pending',openCases],
                  ['✅ Tasks Completed',tasks.filter(t=>t.done).length,'📌 Tasks Open',tasks.filter(t=>!t.done).length],
                  ['💰 Revenue Collected','$'+Math.round(totalRevenue).toLocaleString(),'⏳ AR Outstanding','$'+Math.round(pendingRevenue).toLocaleString()],
                  ['💳 Invoices Paid',invoices.filter(i=>i.status==='Paid').length,'✍️ E-Signs Awaiting',esigns.filter(e=>e.status==='Awaiting').length],
                  ['🧾 Tax Returns',taxReturns.length,'🏢 FormaCorp Filings',formacorp.length],
                  ['📒 Bookkeeping Entries',bookkeeping.length,'⚠️ Overdue Deadlines',overdueDl],
                  ['📅 Total Deadlines',deadlines.length,'',''],
                ].map(([l1,v1,l2,v2],i)=>(
                  <tr key={i} style={{borderBottom:'1px solid var(--br)'}}>
                    <td style={{padding:'11px 8px',color:'var(--t2)',fontWeight:500}}>{l1}</td>
                    <td style={{padding:'11px 8px',fontWeight:700,fontSize:15,textAlign:'right',paddingRight:32}}>{v1}</td>
                    <td style={{padding:'11px 8px',color:'var(--t2)',fontWeight:500}}>{l2}</td>
                    <td style={{padding:'11px 8px',fontWeight:700,fontSize:15,textAlign:'right'}}>{v2}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PIPELINE ── */}
      {tab==='pipeline'&&(
        <div>
          <SectionTitle title="Client Pipeline Funnel"/>
          <div className="card" style={{marginBottom:12}}>
            {PIPELINE_STAGES.map((stage,i)=>{
              const count=pipelineCount[stage]||0
              const pct=Math.round((count/Math.max(clients.length,1))*100)
              const width=Math.round((count/maxPipeline)*100)
              const palette=['#6366f1','#8b5cf6','#3b82f6','#0ea5e9','#06b6d4','#14b8a6','#10b981','#84cc16','#f59e0b','#f97316','#ef4444','#ec4899','#64748b']
              const colors=PIPELINE_STAGES.map((_,idx)=>palette[idx%palette.length])
              return (
                <div key={stage} style={{marginBottom:14}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:5}}>
                    <div style={{fontWeight:600,color:'var(--tx)'}}>{i+1}. {STAGE_LABELS[stage]}</div>
                    <div style={{display:'flex',gap:12,alignItems:'center'}}>
                      <span style={{fontSize:10,color:'var(--t3)'}}>{pct}% of clients</span>
                      <span style={{fontWeight:800,fontSize:15,color:colors[i]}}>{count}</span>
                    </div>
                  </div>
                  <div style={{height:28,background:'var(--s3)',borderRadius:6,overflow:'hidden'}}>
                    <div style={{height:'100%',width:width+'%',background:colors[i],borderRadius:6,minWidth:count>0?40:0,transition:'width .5s ease',opacity:.85}}/>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="card">
            <SectionTitle title="Stage-to-Stage Conversion"/>
            {PIPELINE_STAGES.slice(0,-1).map((stage,i)=>{
              const curr=pipelineCount[PIPELINE_STAGES[i]]||0
              const next=pipelineCount[PIPELINE_STAGES[i+1]]||0
              const pass=curr?Math.round((next/curr)*100):0
              return (
                <div key={stage} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--br)',fontSize:12}}>
                  <div style={{width:110,fontWeight:600,color:'var(--t2)'}}>{STAGE_LABELS[stage]}</div>
                  <div style={{fontSize:16,color:'var(--t3)'}}>→</div>
                  <div style={{width:110,color:'var(--t2)'}}>{STAGE_LABELS[PIPELINE_STAGES[i+1]]}</div>
                  <div style={{flex:1,height:6,background:'var(--s3)',borderRadius:4,overflow:'hidden'}}>
                    <div style={{height:'100%',width:pass+'%',background:pass>75?'var(--ok)':pass>40?'var(--warn)':'var(--bad)',borderRadius:4}}/>
                  </div>
                  <div style={{width:70,textAlign:'right',fontWeight:700,color:pass>75?'var(--ok)':pass>40?'var(--warn)':'var(--bad)'}}>
                    {curr>0?`${pass}% pass`:'—'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── REVENUE ── */}
      {tab==='revenue'&&(
        <div>

          {/* ── Trade Headers ── */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>

            {/* 1st Trade Card */}
            <div className="card" style={{borderTop:'3px solid var(--blue)',padding:'16px 18px'}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--blue)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:10}}>
                🎯 1st Trade — Acquisition Revenue
              </div>
              <div style={{fontSize:11,color:'var(--t3)',marginBottom:12,lineHeight:1.5}}>Investigation fees collected at enrollment. Source: leads.taxFee field.</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:10,color:'var(--t3)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:4}}>MTD</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--ok)'}}>${Math.round(leads.filter(l=>l.created_at?.startsWith(new Date().toISOString().slice(0,7))).reduce((s,l)=>s+parseFloat(l.taxFee||0),0)).toLocaleString()}</div>
                </div>
                <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:10,color:'var(--t3)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:4}}>All Time</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--tx)'}}>${Math.round(leads.reduce((s,l)=>s+parseFloat(l.taxFee||0),0)).toLocaleString()}</div>
                </div>
                <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:10,color:'var(--t3)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:4}}>Total Leads</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--tx)'}}>{leads.length}</div>
                </div>
                <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:10,color:'var(--t3)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:4}}>Avg Fee</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--tx)'}}>{leads.filter(l=>l.taxFee>0).length?'$'+Math.round(leads.reduce((s,l)=>s+parseFloat(l.taxFee||0),0)/Math.max(leads.filter(l=>l.taxFee>0).length,1)).toLocaleString():'$0'}</div>
                </div>
              </div>
            </div>

            {/* 2nd Trade Card */}
            <div className="card" style={{borderTop:'3px solid var(--ok)',padding:'16px 18px'}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--ok)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:10}}>
                💵 2nd Trade — Service Revenue
              </div>
              <div style={{fontSize:11,color:'var(--t3)',marginBottom:12,lineHeight:1.5}}>Resolution fees + installment collections. Source: payments tagged resolution_fee + AR.</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:10,color:'var(--t3)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:4}}>MTD</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--ok)'}}>${Math.round(payments.filter(p=>p.source==='resolution_fee'&&p.status==='Cleared'&&p.created_at?.startsWith(new Date().toISOString().slice(0,7))).reduce((s,p)=>s+parseFloat(p.amount||0),0)).toLocaleString()}</div>
                </div>
                <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:10,color:'var(--t3)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:4}}>All Time</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--tx)'}}>${Math.round(payments.filter(p=>p.source==='resolution_fee'&&p.status==='Cleared').reduce((s,p)=>s+parseFloat(p.amount||0),0)).toLocaleString()}</div>
                </div>
                <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:10,color:'var(--t3)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:4}}>AR Outstanding</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--warn)'}}>${Math.round(pendingRevenue).toLocaleString()}</div>
                </div>
                <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:10,color:'var(--t3)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:4}}>Invoices Paid</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--tx)'}}>{invoices.filter(i=>i.status==='Paid').length}<span style={{fontSize:12,color:'var(--t3)',fontWeight:400}}> / {invoices.length}</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* Combined total strip */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:16}}>
            <StatCard icon="💰" label="Total Collected (All)"  value={'$'+Math.round(totalRevenue).toLocaleString()} color="var(--ok)"/>
            <StatCard icon="⏳" label="AR Outstanding"          value={'$'+Math.round(pendingRevenue).toLocaleString()} color="var(--warn)" small/>
            <StatCard icon="🧾" label="Invoices Paid"           value={invoices.filter(i=>i.status==='Paid').length} sub={`of ${invoices.length} total`} small/>
            <StatCard icon="📅" label="Avg per Client"          value={clients.length?'$'+Math.round(totalRevenue/Math.max(clients.length,1)).toLocaleString():'$0'} small/>
          </div>

          <div className="card" style={{marginBottom:12}}>
            <SectionTitle title="Revenue by Month (All Time)"
              action={<ExportBtn name="Revenue" rows={[['Month','Revenue'],...MONTHS.map((m,i)=>[m,'$'+Math.round(revByMonth[i])])]}/>}/>
            <div style={{display:'flex',gap:6,alignItems:'flex-end',height:120,marginBottom:8}}>
              {MONTHS.map((m,i)=>{
                const val=revByMonth[i]||0
                const h=Math.round((val/maxRev)*100)
                return (
                  <div key={m} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                    <div style={{fontSize:9,color:'var(--t3)',fontWeight:700,display:val>0?'block':'none'}}>
                      ${val>=1000?Math.round(val/1000)+'k':Math.round(val)}
                    </div>
                    <div style={{width:'100%',height:Math.max(h,val>0?6:2)+'px',background:val>0?'var(--blue)':'var(--s3)',borderRadius:'3px 3px 0 0',opacity:val>0?0.85:0.3}}/>
                    <div style={{fontSize:9,color:'var(--t3)',textAlign:'center'}}>{m}</div>
                  </div>
                )
              })}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
            <div className="card">
              <SectionTitle title="Invoice Status"/>
              {Object.entries(countBy(invoices,'status')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={invoices.length}
                  color={l==='Paid'?'var(--ok)':l==='Overdue'?'var(--bad)':'var(--warn)'}/>
              ))}
              {invoices.length===0&&<Empty/>}
            </div>
            <div className="card">
              <SectionTitle title="Payment Status"/>
              {Object.entries(countBy(payments,'status')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={payments.length}
                  color={l==='Cleared'?'var(--ok)':l==='Failed'?'var(--bad)':'var(--warn)'}/>
              ))}
              {payments.length===0&&<Empty/>}
            </div>
          </div>
        </div>
      )}

      {/* ── REP PERFORMANCE ── */}
      {tab==='reps'&&(
        <div>
          {topRep?.name&&(
            <div className="card" style={{marginBottom:12,border:'1px solid var(--b2c)33'}}>
              <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:'var(--blue)',marginBottom:6}}>⭐ Top Performer</div>
              <div style={{fontSize:17,fontWeight:800,color:'var(--tx)',marginBottom:4}}>{topRep.name}</div>
              <div style={{fontSize:12,color:'var(--t2)',display:'flex',gap:16,flexWrap:'wrap'}}>
                <span>💰 ${Math.round(topRep.revenue).toLocaleString()} revenue</span>
                <span>👥 {topRep.clients} clients</span>
                <span>📁 {topRep.cases} cases</span>
                <span>🧾 {topRep.taxReturns} tax returns</span>
                <span>✅ {topRep.taskCompletion}% task completion</span>
              </div>
            </div>
          )}
          {repStats.map(rep=>(
            <div key={rep.name} className="card" style={{marginBottom:10}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:12}}>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>{rep.name}</div>
                  <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>
                    {rep.clients} clients · {rep.cases} cases · {rep.leads} leads · {rep.taxReturns} returns · {rep.openTasks} open tasks
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontWeight:800,fontSize:18,color:'var(--ok)'}}>${Math.round(rep.revenue).toLocaleString()}</div>
                  <div style={{fontSize:10,color:'var(--t3)'}}>collected</div>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:10}}>
                {[
                  ['Clients',rep.clients,clients.length,'var(--blue)'],
                  ['Cases',rep.cases,Math.max(cases.length,1),'var(--warn)'],
                  ['Task Completion',rep.taskCompletion,100,rep.taskCompletion>75?'var(--ok)':rep.taskCompletion>40?'var(--warn)':'var(--bad)'],
                ].map(([label,val,max,color])=>(
                  <div key={label}>
                    <div style={{fontSize:10,color:'var(--t3)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.04em'}}>{label}</div>
                    <div style={{height:6,background:'var(--s3)',borderRadius:3,overflow:'hidden'}}>
                      <div style={{height:'100%',width:Math.round((val/Math.max(max,1))*100)+'%',background:color,borderRadius:3}}/>
                    </div>
                    <div style={{fontSize:10,color:'var(--t2)',marginTop:2}}>{label==='Task Completion'?val+'%':val}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {repStats.length===0&&<Empty msg="No employee data found."/>}
        </div>
      )}

      {/* ── LEADS ── */}
      {tab==='leads'&&(
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:16}}>
            <StatCard icon="📋" label="Total Leads"     value={leads.length} color="var(--blue)"/>
            <StatCard icon="🆕" label="New Leads"       value={leads.filter(l=>l.status==='New Lead').length} color="var(--warn)" small/>
            <StatCard icon="🔄" label="Conversion Rate" value={conversionRate+'%'} color={conversionRate>30?'var(--ok)':'var(--warn)'} small/>
            <StatCard icon="👥" label="Became Clients"  value={clients.length} color="var(--ok)" small/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12,marginBottom:12}}>
            <div className="card">
              <SectionTitle title="Lead Status"
                action={<ExportBtn name="Leads_Status" rows={[['Status','Count'],...Object.entries(countBy(leads,'status'))]}/>}/>
              {Object.entries(countBy(leads,'status')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={leads.length}
                  color={l==='Converted to Client'?'var(--ok)':l==='New Lead'?'var(--blue)':'var(--warn)'}/>
              ))}
              {leads.length===0&&<Empty/>}
            </div>
            <div className="card">
              <SectionTitle title="Lead Source"/>
              {Object.entries(countBy(leads,'source')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={leads.length}/>
              ))}
              {leads.length===0&&<Empty/>}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
            <div className="card">
              <SectionTitle title="Issue Type"/>
              {Object.entries(countBy(leads,'issueType')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={leads.length} color="var(--blue)"/>
              ))}
              {leads.length===0&&<Empty/>}
            </div>
            <div className="card">
              <SectionTitle title="Assigned Rep"/>
              {Object.entries(countBy(leads,'assignedTo')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={leads.length} color="var(--ok)"/>
              ))}
              {leads.length===0&&<Empty/>}
            </div>
          </div>
        </div>
      )}

      {/* ── CASES ── */}
      {tab==='cases'&&(
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:16}}>
            <StatCard icon="📁" label="Total Cases"  value={cases.length} color="var(--blue)"/>
            <StatCard icon="🔓" label="Open"         value={cases.filter(c=>c.status==='Open').length} color="var(--warn)" small/>
            <StatCard icon="⏳" label="Pending IRS"  value={cases.filter(c=>c.status==='Pending IRS').length} color="var(--warn)" small/>
            <StatCard icon="✅" label="Closed"        value={cases.filter(c=>c.status==='Closed').length} color="var(--ok)" small/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12,marginBottom:12}}>
            <div className="card">
              <SectionTitle title="Cases by Status"
                action={<ExportBtn name="Cases_Status" rows={[['Status','Count'],...Object.entries(countBy(cases,'status'))]}/>}/>
              {Object.entries(countBy(cases,'status')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={cases.length}
                  color={l==='Closed'?'var(--ok)':l==='Open'?'var(--blue)':'var(--warn)'}/>
              ))}
              {cases.length===0&&<Empty/>}
            </div>
            <div className="card">
              <SectionTitle title="Cases by Type"/>
              {Object.entries(countBy(cases,'caseType')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={cases.length} color="var(--blue)"/>
              ))}
              {cases.length===0&&<Empty/>}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
            <div className="card">
              <SectionTitle title="Cases by Rep"/>
              {Object.entries(countBy(cases,'assignedTo')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={cases.length} color="var(--ok)"/>
              ))}
              {cases.length===0&&<Empty/>}
            </div>
            <div className="card">
              <SectionTitle title="Cases by Resolution Type"/>
              {Object.entries(countBy(cases,'resolutionType')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={cases.length} color="var(--warn)"/>
              ))}
              {cases.length===0&&<Empty/>}
            </div>
          </div>
        </div>
      )}

      {/* ── TASKS ── */}
      {tab==='tasks'&&(
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:16}}>
            <StatCard icon="✅" label="Total Tasks"   value={tasks.length} color="var(--blue)"/>
            <StatCard icon="📌" label="Open"          value={tasks.filter(t=>!t.done).length} color="var(--warn)" small/>
            <StatCard icon="🎯" label="Completed"     value={tasks.filter(t=>t.done).length} color="var(--ok)" small/>
            <StatCard icon="📈" label="Completion %"  value={tasks.length?Math.round((tasks.filter(t=>t.done).length/tasks.length)*100)+'%':'0%'} color="var(--ok)" small/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12,marginBottom:12}}>
            <div className="card">
              <SectionTitle title="Tasks by Rep"
                action={<ExportBtn name="Tasks_Rep" rows={[['Rep','Open','Done'],...repStats.map(r=>[r.name,r.openTasks,tasks.filter(t=>t.assignedTo===r.name&&t.done).length])]}/>}/>
              {repStats.map(rep=>{
                const total=tasks.filter(t=>t.assignedTo===rep.name).length
                const done=tasks.filter(t=>t.assignedTo===rep.name&&t.done).length
                const pct=total?Math.round((done/total)*100):0
                return total>0&&(
                  <BarRow key={rep.name} label={rep.name} value={pct} max={100}
                    sub={`${done}/${total} done`}
                    color={pct>75?'var(--ok)':pct>40?'var(--warn)':'var(--bad)'}
                    format={v=>v+'%'}/>
                )
              })}
              {tasks.length===0&&<Empty/>}
            </div>
            <div className="card">
              <SectionTitle title="Tasks by Priority"/>
              {Object.entries(countBy(tasks,'priority')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={tasks.length}
                  color={l==='High'?'var(--bad)':l==='Medium'?'var(--warn)':'var(--blue)'}/>
              ))}
              {tasks.length===0&&<Empty/>}
            </div>
          </div>
          <div className="card">
            <SectionTitle title="Open Tasks List"/>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--br)'}}>
                  {['Task','Client','Assigned To','Priority','Due'].map(h=>(
                    <th key={h} style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'var(--t3)',fontWeight:700,textTransform:'uppercase'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.filter(t=>!t.done).slice(0,30).map(t=>(
                  <tr key={t.id} style={{borderBottom:'1px solid var(--br)'}}>
                    <td style={{padding:'7px 8px',color:'var(--tx)',fontWeight:500}}>{t.title||t.task||'—'}</td>
                    <td style={{padding:'7px 8px',color:'var(--t2)'}}>{t.clientName||'—'}</td>
                    <td style={{padding:'7px 8px',color:'var(--t2)'}}>{t.assignedTo||'—'}</td>
                    <td style={{padding:'7px 8px'}}>
                      <span style={{fontSize:10,padding:'2px 7px',borderRadius:4,background:t.priority==='High'?'var(--bad)22':t.priority==='Medium'?'var(--warn)22':'var(--s3)',color:t.priority==='High'?'var(--bad)':t.priority==='Medium'?'var(--warn)':'var(--t3)'}}>
                        {t.priority||'Normal'}
                      </span>
                    </td>
                    <td style={{padding:'7px 8px',color:t.dueDate&&new Date(t.dueDate)<new Date()?'var(--bad)':'var(--t2)',fontSize:11}}>
                      {t.dueDate||'—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tasks.filter(t=>!t.done).length===0&&<Empty msg="All tasks complete!"/>}
          </div>
        </div>
      )}

      {/* ── TAX RETURNS ── */}
      {tab==='taxreturns'&&(
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:16}}>
            <StatCard icon="🧾" label="Total Returns"  value={taxReturns.length} color="var(--blue)"/>
            <StatCard icon="✅" label="Filed"          value={taxReturns.filter(r=>r.status==='Filed').length} color="var(--ok)" small/>
            <StatCard icon="⏳" label="In Progress"    value={taxReturns.filter(r=>r.status==='In Progress'||r.status==='Preparing').length} color="var(--warn)" small/>
            <StatCard icon="🔍" label="Under Review"   value={taxReturns.filter(r=>r.status==='Review').length} color="var(--warn)" small/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12,marginBottom:12}}>
            <div className="card">
              <SectionTitle title="Returns by Status"
                action={<ExportBtn name="TaxReturns_Status" rows={[['Status','Count'],...Object.entries(countBy(taxReturns,'status'))]}/>}/>
              {Object.entries(countBy(taxReturns,'status')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={taxReturns.length}
                  color={l==='Filed'?'var(--ok)':l==='Rejected'?'var(--bad)':'var(--warn)'}/>
              ))}
              {taxReturns.length===0&&<Empty/>}
            </div>
            <div className="card">
              <SectionTitle title="Returns by Type"/>
              {Object.entries(countBy(taxReturns,'returnType')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={taxReturns.length} color="var(--blue)"/>
              ))}
              {taxReturns.length===0&&<Empty/>}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12,marginBottom:12}}>
            <div className="card">
              <SectionTitle title="Returns by Tax Year"/>
              {Object.entries(countBy(taxReturns,'taxYear')).sort((a,b)=>Number(b[0])-Number(a[0])).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={taxReturns.length} color="var(--blue)"/>
              ))}
              {taxReturns.length===0&&<Empty/>}
            </div>
            <div className="card">
              <SectionTitle title="Returns by Rep"/>
              {Object.entries(countBy(taxReturns,'preparer')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={taxReturns.length} color="var(--ok)"/>
              ))}
              {taxReturns.length===0&&<Empty/>}
            </div>
          </div>
          <div className="card">
            <SectionTitle title="Recent Tax Returns"
              action={<ExportBtn name="TaxReturns" rows={[['Client','Type','Year','Status','Preparer','Created'],
                ...taxReturns.slice(0,100).map(r=>[r.clientName,r.returnType,r.taxYear,r.status,r.preparer,r.created_at?.slice(0,10)])]}/>}/>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--br)'}}>
                  {['Client','Type','Year','Status','Preparer'].map(h=>(
                    <th key={h} style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'var(--t3)',fontWeight:700,textTransform:'uppercase'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {taxReturns.slice(0,40).map(r=>(
                  <tr key={r.id} style={{borderBottom:'1px solid var(--br)'}}>
                    <td style={{padding:'7px 8px',fontWeight:500}}>{r.clientName||r.client_name||'—'}</td>
                    <td style={{padding:'7px 8px',color:'var(--t2)'}}>{r.returnType||'—'}</td>
                    <td style={{padding:'7px 8px',color:'var(--t2)'}}>{r.taxYear||'—'}</td>
                    <td style={{padding:'7px 8px'}}>
                      <span style={{fontSize:10,padding:'2px 7px',borderRadius:4,
                        background:r.status==='Filed'?'var(--ok)22':r.status==='Rejected'?'var(--bad)22':'var(--warn)22',
                        color:r.status==='Filed'?'var(--ok)':r.status==='Rejected'?'var(--bad)':'var(--warn)'}}>
                        {r.status||'—'}
                      </span>
                    </td>
                    <td style={{padding:'7px 8px',color:'var(--t2)'}}>{r.preparer||r.assigned_to||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {taxReturns.length===0&&<Empty/>}
          </div>
        </div>
      )}

      {/* ── E-SIGNATURES ── */}
      {tab==='esign'&&(
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:16}}>
            <StatCard icon="✍️" label="Total Sent"   value={esigns.length} color="var(--blue)"/>
            <StatCard icon="⏳" label="Awaiting"     value={esigns.filter(e=>e.status==='Awaiting').length} color="var(--warn)" small/>
            <StatCard icon="✅" label="Signed"        value={esigns.filter(e=>e.status==='Signed').length} color="var(--ok)" small/>
            <StatCard icon="📈" label="Sign Rate"    value={esigns.length?Math.round((esigns.filter(e=>e.status==='Signed').length/esigns.length)*100)+'%':'0%'} color="var(--ok)" small/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12,marginBottom:12}}>
            <div className="card">
              <SectionTitle title="By Status"/>
              {Object.entries(countBy(esigns,'status')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={esigns.length}
                  color={l==='Signed'?'var(--ok)':l==='Declined'?'var(--bad)':'var(--warn)'}/>
              ))}
              {esigns.length===0&&<Empty/>}
            </div>
            <div className="card">
              <SectionTitle title="By Document Type"/>
              {Object.entries(countBy(esigns,'doc_type')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={esigns.length} color="var(--blue)"/>
              ))}
              {esigns.length===0&&<Empty/>}
            </div>
          </div>
          <div className="card">
            <SectionTitle title="Awaiting Signatures"
              action={<ExportBtn name="Esign_Awaiting" rows={[['Client','Document','Sent','Days Pending'],
                ...esigns.filter(e=>e.status==='Awaiting').map(e=>[e.client_name,e.doc_type,e.sent_at?.slice(0,10),
                  Math.floor((Date.now()-new Date(e.sent_at))/86400000)+'d'])]}/>}/>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--br)'}}>
                  {['Client','Document','Sent','Pending'].map(h=>(
                    <th key={h} style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'var(--t3)',fontWeight:700,textTransform:'uppercase'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {esigns.filter(e=>e.status==='Awaiting').map(e=>{
                  const days=Math.floor((Date.now()-new Date(e.sent_at))/86400000)
                  return (
                    <tr key={e.id} style={{borderBottom:'1px solid var(--br)'}}>
                      <td style={{padding:'7px 8px',fontWeight:500}}>{e.client_name}</td>
                      <td style={{padding:'7px 8px',color:'var(--t2)'}}>{e.doc_type}</td>
                      <td style={{padding:'7px 8px',color:'var(--t2)',fontSize:11}}>{e.sent_at?.slice(0,10)||'—'}</td>
                      <td style={{padding:'7px 8px',fontWeight:700,color:days>5?'var(--bad)':days>2?'var(--warn)':'var(--t2)'}}>{days}d</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {esigns.filter(e=>e.status==='Awaiting').length===0&&<Empty msg="No pending signatures."/>}
          </div>
        </div>
      )}

      {/* ── FORMACORP ── */}
      {tab==='formacorp'&&(
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:16}}>
            <StatCard icon="🏢" label="Total Filings" value={formacorp.length} color="var(--blue)"/>
            <StatCard icon="✅" label="Active"        value={formacorp.filter(f=>f.stage==='Active'||f.status==='Active').length} color="var(--ok)" small/>
            <StatCard icon="⏳" label="Pending"       value={formacorp.filter(f=>f.stage==='Pending'||f.status==='Pending').length} color="var(--warn)" small/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12,marginBottom:12}}>
            <div className="card">
              <SectionTitle title="By Stage/Status"
                action={<ExportBtn name="FormaCorp_Status" rows={[['Stage','Count'],...Object.entries(countBy(formacorp,'stage'))]}/>}/>
              {Object.entries(countBy(formacorp,'stage')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={formacorp.length}
                  color={l==='Active'?'var(--ok)':l==='Dissolved'?'var(--bad)':'var(--warn)'}/>
              ))}
              {formacorp.length===0&&<Empty/>}
            </div>
            <div className="card">
              <SectionTitle title="By Entity Type"/>
              {Object.entries(countBy(formacorp,'entityType')).sort((a,b)=>b[1]-a[1]).map(([l,v])=>(
                <BarRow key={l} label={l} value={v} max={formacorp.length} color="var(--blue)"/>
              ))}
              {formacorp.length===0&&<Empty/>}
            </div>
          </div>
          <div className="card">
            <SectionTitle title="All FormaCorp Filings"
              action={<ExportBtn name="FormaCorp" rows={[['Entity','Type','State','Stage','Created'],
                ...formacorp.map(f=>[f.entityName||f.name,f.entityType,f.state,f.stage,f.created_at?.slice(0,10)])]}/>}/>
            <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--br)'}}>
                  {['Entity Name','Type','State','Stage'].map(h=>(
                    <th key={h} style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'var(--t3)',fontWeight:700,textTransform:'uppercase'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {formacorp.slice(0,40).map(f=>(
                  <tr key={f.id} style={{borderBottom:'1px solid var(--br)'}}>
                    <td style={{padding:'7px 8px',fontWeight:500}}>{f.entityName||f.name||'—'}</td>
                    <td style={{padding:'7px 8px',color:'var(--t2)'}}>{f.entityType||'—'}</td>
                    <td style={{padding:'7px 8px',color:'var(--t2)'}}>{f.state||'—'}</td>
                    <td style={{padding:'7px 8px'}}>
                      <span style={{fontSize:10,padding:'2px 7px',borderRadius:4,
                        background:f.stage==='Active'?'var(--ok)22':f.stage==='Dissolved'?'var(--bad)22':'var(--warn)22',
                        color:f.stage==='Active'?'var(--ok)':f.stage==='Dissolved'?'var(--bad)':'var(--warn)'}}>
                        {f.stage||'—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {formacorp.length===0&&<Empty/>}
          </div>
        </div>
      )}

      {/* ── BOOKS & LEDGER ── */}
      {tab==='books'&&(
        <div>
          {(()=>{
            const income  = bookkeeping.filter(e=>e.type==='Income'||e.amount>0)
            const expense = bookkeeping.filter(e=>e.type==='Expense'||e.amount<0)
            const totalIn  = income.reduce((s,e)=>s+Math.abs(parseFloat(e.amount||0)),0)
            const totalOut = expense.reduce((s,e)=>s+Math.abs(parseFloat(e.amount||0)),0)
            const net = totalIn - totalOut
            return (
              <>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:16}}>
                  <StatCard icon="📒" label="Total Entries" value={bookkeeping.length} color="var(--blue)"/>
                  <StatCard icon="⬆️" label="Total Income"  value={'$'+Math.round(totalIn).toLocaleString()} color="var(--ok)" small/>
                  <StatCard icon="⬇️" label="Total Expenses" value={'$'+Math.round(totalOut).toLocaleString()} color="var(--bad)" small/>
                  <StatCard icon="💵" label="Net"           value={'$'+Math.round(net).toLocaleString()} color={net>=0?'var(--ok)':'var(--bad)'} small/>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12,marginBottom:12}}>
                  <div className="card">
                    <SectionTitle title="By Category"
                      action={<ExportBtn name="Books_Category" rows={[['Category','Amount'],...Object.entries(
                        bookkeeping.reduce((a,e)=>{ a[e.category||'Uncategorized']=(a[e.category||'Uncategorized']||0)+parseFloat(e.amount||0); return a},{}))
                        .map(([k,v])=>[k,'$'+Math.round(v)])]}/>}/>
                    {Object.entries(bookkeeping.reduce((a,e)=>{
                      const cat=e.category||'Uncategorized'
                      a[cat]=(a[cat]||0)+Math.abs(parseFloat(e.amount||0))
                      return a
                    },{})).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([l,v])=>(
                      <BarRow key={l} label={l} value={v} max={Math.max(...Object.values(
                        bookkeeping.reduce((a,e)=>{ const c=e.category||'Unc'; a[c]=(a[c]||0)+Math.abs(parseFloat(e.amount||0)); return a},{})
                      ),1)} format={v=>'$'+Math.round(v).toLocaleString()} color="var(--blue)"/>
                    ))}
                    {bookkeeping.length===0&&<Empty/>}
                  </div>
                  <div className="card">
                    <SectionTitle title="Income vs Expense"/>
                    <BarRow label="Income"   value={totalIn}  max={Math.max(totalIn,totalOut,1)} format={v=>'$'+Math.round(v).toLocaleString()} color="var(--ok)"/>
                    <BarRow label="Expenses" value={totalOut} max={Math.max(totalIn,totalOut,1)} format={v=>'$'+Math.round(v).toLocaleString()} color="var(--bad)"/>
                    <div style={{marginTop:16,padding:'12px 14px',background:'var(--s2)',borderRadius:8,fontSize:13}}>
                      <span style={{color:'var(--t3)'}}>Net: </span>
                      <span style={{fontWeight:800,color:net>=0?'var(--ok)':'var(--bad)'}}>${Math.round(net).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <div className="card" style={{overflow:'hidden'}}>
                  <SectionTitle title="Recent Entries"
                    action={<ExportBtn name="Bookkeeping" rows={[['Date','Description','Category','Amount','Type','Reconciled'],
                      ...bookkeeping.slice(0,100).map(e=>[e.date,e.description,e.category,e.amount,e.type,e.reconciled?'Yes':'No'])]}/>}/>
                  <div style={{overflowX:'auto',width:'100%'}}>
                  <table style={{width:'100%',minWidth:640,fontSize:12,borderCollapse:'collapse'}}>
                    <thead>
                      <tr style={{borderBottom:'1px solid var(--br)'}}>
                        {['Date','Description','Category','Amount'].map(h=>(
                          <th key={h} style={{padding:'6px 8px',textAlign:'left',fontSize:10,color:'var(--t3)',fontWeight:700,textTransform:'uppercase'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bookkeeping.slice(0,40).map(e=>(
                        <tr key={e.id} style={{borderBottom:'1px solid var(--br)'}}>
                          <td style={{padding:'7px 8px',color:'var(--t3)',fontSize:11}}>{e.date||'—'}</td>
                          <td style={{padding:'7px 8px',fontWeight:500}}>{e.description||'—'}</td>
                          <td style={{padding:'7px 8px',color:'var(--t2)'}}>{e.category||'—'}</td>
                          <td style={{padding:'7px 8px',fontWeight:700,color:parseFloat(e.amount||0)>=0?'var(--ok)':'var(--bad)'}}>
                            ${Math.abs(parseFloat(e.amount||0)).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  {bookkeeping.length===0&&<Empty/>}
                </div>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
