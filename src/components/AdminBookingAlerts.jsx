import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Durable, server-recorded new booking alerts. Never depends on email or the tab
// being open when a visitor books an appointment.
export default function AdminBookingAlerts() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const load = useCallback(async () => {
    const {data,error:queryError} = await supabase
      .from('romylabs_booking_alerts')
      .select('booking_id,product_id,lead_name,lead_email,appointment_type,appointment_date,appointment_time,booked_at,acknowledged_at,notification_submission_id,notification_submitted_at,notification_last_error,followup_status,assigned_to,contacted_at,contact_outcome')
      .neq('followup_status','completed')
      .order('booked_at',{ascending:false}).limit(100)
    if (queryError) { setError('Booking alerts unavailable — check database migration and access.'); return }
    setError('')
    setItems(data || [])
  }, [])
  useEffect(() => {
    void load()
    const interval = setInterval(() => { void load() }, 30000)
    const onFocus = () => { void load() }
    window.addEventListener('focus',onFocus)
    return () => { clearInterval(interval); window.removeEventListener('focus',onFocus) }
  }, [load])
  async function acknowledge(id) {
    const {error} = await supabase.from('romylabs_booking_alerts')
      .update({acknowledged_at:new Date().toISOString(),followup_status:'acknowledged'}).eq('booking_id',id)
    if (error) {setError('Could not acknowledge booking. Try again.');return}
    await load()
  }
  async function markContacted(item) {
    const outcome = window.prompt('Contact outcome / next action for ' + item.lead_name)
    if (!outcome?.trim()) return
    const {error} = await supabase.from('romylabs_booking_alerts').update({
      followup_status:'contacted',
      acknowledged_at:item.acknowledged_at || new Date().toISOString(),
      contacted_at:new Date().toISOString(),
      contact_outcome:outcome.trim()
    }).eq('booking_id',item.booking_id)
    if(error){setError('Unable to save contact outcome. Task remains open.');return}
    await load()
  }
  async function complete(item) {
    if(item.followup_status!=='contacted'){setError('Record contact before completing.');return}
    const {error} = await supabase.from('romylabs_booking_alerts').update({followup_status:'completed',completed_at:new Date().toISOString()}).eq('booking_id',item.booking_id)
    if(error){setError('Unable to complete task.');return}
    await load()
  }
  return (
    <section aria-label="New demo booking alerts" style={{padding:'8px 16px',background:items.length?'#261b12':'#151b29',borderBottom:'1px solid #3b4454',color:'#f1f5f9'}}>
      <button type="button" onClick={()=>setExpanded(value=>!value)}
        style={{border:'none',background:'transparent',color:'inherit',cursor:'pointer',fontSize:13,fontWeight:700,padding:'5px 0'}}>
        {items.length ? '🔔 ' + items.length + ' open demo follow-up' + (items.length===1?'':'s') + ' — review tasks' : '🔔 Demo booking alerts'}
        <span style={{fontSize:11,color:'#94a3b8',marginLeft:8}}>{expanded?'Hide':'Show'}</span>
      </button>
      {error && <div role="alert" style={{color:'#fca5a5',fontSize:12}}>{error}</div>}
      {expanded && (items.length ? (
        <div style={{maxHeight:290,overflowY:'auto',display:'grid',gap:8,padding:'7px 0'}}>
          {items.map(item=>(
            <div key={item.booking_id} style={{display:'flex',flexWrap:'wrap',gap:10,justifyContent:'space-between',alignItems:'center',background:'#111827',padding:'10px 12px',borderRadius:8}}>
              <div style={{fontSize:12}}>
                <strong>{(item.product_id||'').replaceAll('_',' ').toUpperCase()} — {item.lead_name}</strong>
                <div style={{color:'#cbd5e1'}}>{item.appointment_type} · {item.appointment_date} {item.appointment_time} ET</div>
                {item.lead_email && <a href={'mailto:'+item.lead_email} style={{color:'#93c5fd'}}>{item.lead_email}</a>}
                <div style={{fontSize:11,color:'#fbbf24',marginTop:4}}>Assigned: {item.assigned_to} · {item.followup_status} · {item.contact_outcome || 'Contact required'}</div>
                <div style={{fontSize:11,color:item.notification_submission_id?'#86efac':'#fbbf24',marginTop:4}}>
                  {item.notification_submission_id ? 'Mail submitted to Stalwart (inbox delivery not yet verified)' : 'Mail submission not confirmed — review lead now'}
                  {item.notification_last_error ? ' · Last error: '+item.notification_last_error : ''}
                </div>
              </div>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                {item.followup_status==='new' && <button type="button" onClick={()=>acknowledge(item.booking_id)}>Acknowledge</button>}
                <button type="button" onClick={()=>markContacted(item)}>Record contact</button>
                {item.followup_status==='contacted' && <button type="button" onClick={()=>complete(item)}>Complete</button>}
              </div>
            </div>
          ))}
        </div>
      ) : <div style={{fontSize:12,color:'#94a3b8'}}>No outstanding demo follow-ups.</div>)}
    </section>
  )
}
