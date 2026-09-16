import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function fmtDate(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleString() } catch { return '—' }
}
function eventLabel(v) {
  if (!v) return 'No activity'
  return String(v).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function stateLabel(r){
  const p=Math.max(0,Math.min(100,Number(r.max_progress||0)))
  if(String(r.status||'').toLowerCase()==='signed') return 'Completed'
  if(p>=95) return 'Signing started'
  if(p>=85) return 'Signature started'
  if(p>=75) return 'Identity entered'
  if(p>=50) return 'Halfway through'
  if(p>=25) return 'Reviewing'
  if(Number(r.open_count||0)>0) return 'Opened'
  return 'Not opened'
}

export default function EsignManagerAuditBridge() {
  const [visible, setVisible] = useState(window.location.pathname === '/esign')
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailId,setDetailId]=useState(null)
  const [timeline,setTimeline]=useState([])
  const [timelineLoading,setTimelineLoading]=useState(false)

  useEffect(() => {
    const timer = setInterval(() => setVisible(window.location.pathname === '/esign'), 400)
    return () => clearInterval(timer)
  }, [])

  async function load() {
    setLoading(true); setError('')
    const { data, error } = await supabase.rpc('esign_audit_overview')
    setLoading(false)
    if (error) { setError(error.message || 'Could not load signing audit'); return }
    setRows(data || [])
  }
  async function show() { setOpen(true); await load() }
  async function toggleDetail(id){
    if(detailId===id){setDetailId(null);setTimeline([]);return}
    setDetailId(id);setTimeline([]);setTimelineLoading(true)
    const {data,error}=await supabase.rpc('esign_audit_timeline',{p_id:id})
    setTimelineLoading(false)
    if(error){setError(error.message||'Could not load signing timeline');return}
    setTimeline(data||[])
  }

  if (!visible) return null
  return <>
    <button onClick={show} className="btn" style={{position:'fixed',right:24,bottom:24,zIndex:1200,fontWeight:800,boxShadow:'0 8px 24px rgba(0,0,0,.2)'}}>📊 Signing Audit</button>
    {open&&<div className="modal-bg open" style={{zIndex:5000}} onClick={e=>e.target===e.currentTarget&&setOpen(false)}>
      <div className="modal" style={{width:'min(1380px,96vw)',maxHeight:'88vh',overflow:'hidden',display:'flex',flexDirection:'column'}}>
        <div className="mh"><div><div className="mt">📊 E-Signature Audit</div><div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>Opens, repeat views, sessions, progress, reminders, last step and completion telemetry</div></div><button className="xbtn" onClick={()=>setOpen(false)}>&times;</button></div>
        <div style={{padding:'0 18px 12px',display:'flex',justifyContent:'flex-end'}}><button className="btn sec" onClick={load} disabled={loading}>{loading?'Refreshing…':'↻ Refresh'}</button></div>
        <div style={{overflow:'auto',padding:'0 18px 18px'}}>
          {error?<div style={{padding:18,color:'var(--bad)'}}>{error}</div>:loading&&rows.length===0?<div style={{padding:30,textAlign:'center',color:'var(--t3)'}}>Loading audit…</div>:(
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead><tr>{['Client / Document','Status','Opens','Sessions','Progress','Current State','First Opened','Last Opened','Last Step','Last Seen','Completed',''].map(h=><th key={h} style={{textAlign:'left',padding:'8px 9px',borderBottom:'1px solid var(--br)',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
              <tbody>{rows.map(r=>{
                const progress=Math.max(0,Math.min(100,Number(r.max_progress||0)))
                return <>
                  <tr key={r.esign_id}>
                    <td style={{padding:'9px',borderBottom:'1px solid var(--br)'}}><div style={{fontWeight:700}}>{r.client_name||'—'}</div><div style={{fontSize:11,color:'var(--t3)'}}>{r.doc_type||'Document'}</div></td>
                    <td style={{padding:'9px',borderBottom:'1px solid var(--br)'}}>{r.status||'—'}</td>
                    <td style={{padding:'9px',borderBottom:'1px solid var(--br)',fontWeight:800}}>{Number(r.open_count||0)}</td>
                    <td style={{padding:'9px',borderBottom:'1px solid var(--br)'}}>{Number(r.session_count||0)}</td>
                    <td style={{padding:'9px',borderBottom:'1px solid var(--br)',minWidth:105}}><div style={{display:'flex',alignItems:'center',gap:7}}><div style={{width:58,height:6,borderRadius:999,background:'var(--s2)',overflow:'hidden'}}><div style={{width:`${progress}%`,height:'100%',background:'var(--b2)'}}/></div><strong>{progress}%</strong></div></td>
                    <td style={{padding:'9px',borderBottom:'1px solid var(--br)',fontWeight:700}}>{stateLabel(r)}</td>
                    <td style={{padding:'9px',borderBottom:'1px solid var(--br)',whiteSpace:'nowrap'}}>{fmtDate(r.first_opened_at)}</td>
                    <td style={{padding:'9px',borderBottom:'1px solid var(--br)',whiteSpace:'nowrap'}}>{fmtDate(r.last_opened_at)}</td>
                    <td style={{padding:'9px',borderBottom:'1px solid var(--br)',fontWeight:700}}>{eventLabel(r.last_step||r.last_event)}</td>
                    <td style={{padding:'9px',borderBottom:'1px solid var(--br)',whiteSpace:'nowrap'}}>{fmtDate(r.last_event_at)}</td>
                    <td style={{padding:'9px',borderBottom:'1px solid var(--br)',whiteSpace:'nowrap'}}>{fmtDate(r.completed_at)}</td>
                    <td style={{padding:'9px',borderBottom:'1px solid var(--br)'}}><button className="btn sec" style={{fontSize:10,padding:'4px 7px'}} onClick={()=>toggleDetail(r.esign_id)}>{detailId===r.esign_id?'Hide':'Timeline'}</button></td>
                  </tr>
                  {detailId===r.esign_id&&<tr key={r.esign_id+'-timeline'}><td colSpan={12} style={{padding:'10px 16px',background:'rgba(59,130,246,.04)',borderBottom:'1px solid var(--br)'}}>
                    {timelineLoading?<div style={{color:'var(--t3)'}}>Loading timeline…</div>:timeline.length===0?<div style={{color:'var(--t3)'}}>No events recorded.</div>:timeline.map(e=><div key={e.id} style={{display:'grid',gridTemplateColumns:'170px 130px 90px minmax(0,1fr)',gap:8,padding:'5px 0',fontSize:11,borderBottom:'1px solid rgba(255,255,255,.04)'}}>
                      <span style={{color:'var(--t3)'}}>{fmtDate(e.event_at)}</span><strong>{eventLabel(e.event_type)}</strong><span>{e.progress==null?'—':e.progress+'%'}</span><span style={{color:'var(--t2)'}}>{eventLabel(e.step)}{e.metadata?.estimated_page?` · page ~${e.metadata.estimated_page}/${e.metadata.estimated_pages||'?'}`:''}</span>
                    </div>)}
                  </td></tr>}
                </>
              })}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>}
  </>
}
