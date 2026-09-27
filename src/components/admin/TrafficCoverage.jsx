import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

const STATUS = {
  live: { label:'Live', color:'#10b981' },
  configured: { label:'Configured', color:'#60a5fa' },
  planned: { label:'Planned', color:'#64748b' },
  blocked: { label:'Blocked', color:'#ef4444' },
  not_applicable: { label:'N/A', color:'#475569' },
}

export default function TrafficCoverage() {
  const [rows,setRows] = useState([])
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [selected,setSelected] = useState('all')

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('admin_product_traffic_coverage')
      .select('*')
      .order('product_name')
      .order('sort_order')
    if (error) { setError(error.message); setRows([]) }
    else { setError(''); setRows(data || []) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[])

  const products = useMemo(() => [...new Map(rows.map(r => [r.product_id,{id:r.product_id,name:r.product_name,lifecycle:r.lifecycle}])).values()], [rows])
  const visible = selected==='all' ? rows : rows.filter(r=>r.product_id===selected)
  const grouped = useMemo(() => {
    const m = new Map()
    visible.forEach(r => {
      if (!m.has(r.product_id)) m.set(r.product_id,{ name:r.product_name, lifecycle:r.lifecycle, rows:[] })
      m.get(r.product_id).rows.push(r)
    })
    return [...m.entries()]
  },[visible])

  const totals = useMemo(() => {
    const now = Date.now()
    const isStale = r => r.status==='live' && r.last_verified_at && (now - new Date(r.last_verified_at).getTime()) > 30*86400000
    return {
      live: rows.filter(r=>r.status==='live' && !isStale(r)).length,
      configured: rows.filter(r=>r.status==='configured').length,
      blocked: rows.filter(r=>r.status==='blocked' || isStale(r)).length,
      not_applicable: rows.filter(r=>r.status==='not_applicable').length,
    }
  },[rows])

  async function updateStatus(row,status) {
    const { error } = await supabase.from('product_traffic_channels')
      .update({ status, updated_at:new Date().toISOString(), last_verified_at:status==='live'?new Date().toISOString():row.last_verified_at })
      .eq('product_id',row.product_id).eq('channel_key',row.channel_key)
    if (error) return setError(error.message)
    await load()
  }

  return (
    <div style={{padding:'30px 34px',maxWidth:1400,color:'#e2e8f0'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:20,alignItems:'flex-start',marginBottom:22}}>
        <div>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:'.1em',textTransform:'uppercase',color:'#C6FF00',marginBottom:7}}>RomyLabs Growth Infrastructure</div>
          <h1 style={{fontSize:25,margin:0,color:'#fff'}}>Traffic Coverage</h1>
          <p style={{fontSize:13,color:'#64748b',maxWidth:720,lineHeight:1.6,margin:'8px 0 0'}}>One acquisition standard across every current and future product: search, analytics, paid, social, community, referral, email, brand, AI/AEO and local discovery.</p>
        </div>
        <button onClick={load} style={{border:'1px solid rgba(99,102,241,.3)',background:'rgba(99,102,241,.1)',color:'#a5b4fc',borderRadius:8,padding:'8px 14px',fontWeight:700,cursor:'pointer'}}>Refresh</button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(130px,1fr))',gap:10,marginBottom:20}}>
        {Object.entries(totals).map(([key,val]) => <div key={key} style={{background:'rgba(255,255,255,.035)',border:'1px solid rgba(99,102,241,.15)',borderRadius:12,padding:'14px 16px'}}><div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'.07em',color:'#64748b',fontWeight:800}}>{STATUS[key].label}</div><div style={{fontSize:24,fontWeight:900,color:STATUS[key].color,marginTop:5}}>{val}</div></div>)}
      </div>

      <div style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:18}}>
        <button onClick={()=>setSelected('all')} style={pill(selected==='all')}>All products</button>
        {products.map(p=><button key={p.id} onClick={()=>setSelected(p.id)} style={pill(selected===p.id)}>{p.name}</button>)}
      </div>

      {error && <div style={{padding:12,border:'1px solid rgba(239,68,68,.3)',background:'rgba(239,68,68,.08)',borderRadius:10,color:'#fca5a5',marginBottom:14}}>{error}</div>}
      {loading ? <div style={{padding:30,color:'#64748b'}}>Loading traffic coverage…</div> : grouped.map(([id,p]) => {
        const now = Date.now()
        const live = p.rows.filter(r => r.status==='live' && (!r.last_verified_at || (now - new Date(r.last_verified_at).getTime()) <= 30*86400000)).length
        return <div key={id} style={{background:'rgba(255,255,255,.025)',border:'1px solid rgba(99,102,241,.15)',borderRadius:14,marginBottom:14,overflow:'hidden'}}>
          <div style={{padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid rgba(99,102,241,.1)'}}>
            <div><strong style={{color:'#fff'}}>{p.name}</strong><span style={{marginLeft:9,fontSize:10,color:'#64748b',textTransform:'uppercase'}}>{p.lifecycle}</span></div>
            <div style={{fontSize:11,color:live===p.rows.length?'#10b981':'#94a3b8',fontWeight:800}}>{live}/{p.rows.length} live</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:0}}>
            {p.rows.map(r => {
              const ageDays = r.last_verified_at ? Math.floor((Date.now()-new Date(r.last_verified_at).getTime())/86400000) : null
              const stale = r.status==='live' && ageDays != null && ageDays > 30
              const st = stale ? STATUS.blocked : (STATUS[r.status]||STATUS.planned)
              return <div key={r.channel_key} style={{padding:'14px 16px',borderRight:'1px solid rgba(99,102,241,.08)',borderBottom:'1px solid rgba(99,102,241,.08)',minHeight:92}}>
                <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',marginBottom:6}}><div style={{fontSize:12,fontWeight:800,color:'#e2e8f0'}}>{r.channel_label}</div><span style={{fontSize:9,fontWeight:900,color:st.color,textTransform:'uppercase'}}>{st.label}</span></div>
                <div style={{fontSize:10,color:'#475569',marginBottom:8,textTransform:'uppercase'}}>{r.category}</div>
                {r.tracking_id && <div style={{fontSize:10,color:'#64748b',marginBottom:5}}>ID: {r.tracking_id}</div>}
                <div style={{fontSize:9,color:stale?'#f59e0b':'#475569',marginBottom:8}}>
                  {r.last_verified_at ? `${stale?'Verification stale · ':'Verified '}${new Date(r.last_verified_at).toLocaleDateString()}` : 'No live verification recorded'}
                </div>
                <select value={r.status} onChange={e=>updateStatus(r,e.target.value)} style={{width:'100%',background:'#111827',border:'1px solid rgba(99,102,241,.2)',color:'#cbd5e1',borderRadius:6,padding:'5px 7px',fontSize:10}}>{Object.keys(STATUS).map(s=><option key={s} value={s}>{STATUS[s].label}</option>)}</select>
              </div>
            })}
          </div>
        </div>
      })}
    </div>
  )
}

function pill(active) {
  return {padding:'6px 11px',borderRadius:999,border:`1px solid ${active?'rgba(198,255,0,.45)':'rgba(99,102,241,.18)'}`,background:active?'rgba(198,255,0,.08)':'rgba(255,255,255,.025)',color:active?'#C6FF00':'#64748b',fontSize:11,fontWeight:800,cursor:'pointer'}
}
