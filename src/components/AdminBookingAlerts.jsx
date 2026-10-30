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
      .select('booking_id,product_id,lead_name,lead_email,appointment_type,appointment_date,appointment_time,booked_at,acknowledged_at,notification_submission_id,notification_submitted_at,notification_last_error')
      .is('acknowledged_at',null)
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
      .update({acknowledged_at:new Date().toISOString()}).eq('booking_id',id)
    if (error) {setError('Could not acknowledge booking. Try again.');return}
    setItems(current=>current.filter(item=>item.booking_id!==id))
  }
  return (
    <section aria-label="New demo booking alerts" style={{padding:'8px 16px',background:items.length?'#261b12':'#151b29',borderBottom:'1px solid #3b4454',color:'#f1f5f9'}}>
      <button type="button" onClick={()=>setExpanded(value=>!value)}
        style={{border:'none',background:'transparent',color:'inherit',cursor:'pointer',fontSize:13,fontWeight:700,padding:'5px 0'}}>
        {items.length ? '🔔 ' + items.length + ' new online booking' + (items.length===1?'':'s') + ' — review leads' : '🔔 Demo booking alerts'}
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
                <div style={{fontSize:11,color:item.notification_submission_id?'#86efac':'#fbbf24',marginTop:4}}>
                  {item.notification_submission_id ? 'Mail submitted to Stalwart (inbox delivery not yet verified)' : 'Mail submission not confirmed — review lead now'}
                  {item.notification_last_error ? ' · Last error: '+item.notification_last_error : ''}
                </div>
              </div>
              <button type="button" onClick={()=>acknowledge(item.booking_id)}
                style={{background:'#334155',border:'1px solid #64748b',padding:'6px 10px',borderRadius:6,color:'#fff',cursor:'pointer',fontSize:12}}>
                Mark reviewed
              </button>
            </div>
          ))}
        </div>
      ) : <div style={{fontSize:12,color:'#94a3b8'}}>No unreviewed bookings.</div>)}
    </section>
  )
}
