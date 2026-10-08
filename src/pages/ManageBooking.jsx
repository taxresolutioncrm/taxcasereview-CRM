import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { FIRM, loadFirmBrandingPublic } from '../lib/firmBranding'
import { supabase } from '../lib/supabase'
import { whenLong } from '../lib/bookingEmails'
import { etLabelInZone, visitorZone, zoneShort } from '../lib/timezones'

const C = { bg:'#0f172a',card:'#1e293b',line:'#334155',text:'#f1f5f9',dim:'#94a3b8',accent:'#2563eb' }

export default function ManageBooking() {
  const { token } = useParams()
  const [params] = useSearchParams()
  const [bk, setBk] = useState(undefined)
  const [mode, setMode] = useState(params.get('cancel') ? 'cancel' : 'view')
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState(null)
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [final, setFinal] = useState(null)
  const zone = visitorZone()

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase.rpc('booking_get', { p_token: token })
      const rec = error || !data ? null : data
      await loadFirmBrandingPublic(rec?.tenant_id)
      setBk(rec)
    })()
  }, [token])

  async function pickDate(iso) {
    setDate(iso); setTime(''); setSlots(null)
    if (!iso) return
    const args = bk?.tenant_id ? { p_date: iso, p_tenant: bk.tenant_id } : { p_date: iso }
    const { data, error } = await supabase.rpc('booking_get_slots', args)
    setSlots(error ? [] : (data || []))
  }

  async function doCancel() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('booking_cancel', { p_token: token })
    if (error || !data || data.ok === false) {
      setBusy(false)
      setErr((data && data.message) || (error && error.message) || 'Could not cancel.')
      return
    }
    await Promise.allSettled([
      supabase.functions.invoke('send-email', { body: { kind:'booking_cancel_confirmation', booking_token:token } }),
      supabase.functions.invoke('send-email', { body: { kind:'booking_cancel_firm_notification', booking_token:token } }),
    ])
    setBusy(false)
    setFinal({ kind:'canceled' })
  }

  async function doReschedule() {
    if (!date || !time) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('booking_reschedule', { p_token:token, p_date:date, p_time:time })
    if (error || !data || data.ok === false) {
      setBusy(false)
      setErr((data && data.message) || (error && error.message) || 'That time was just taken — pick another.')
      pickDate(date)
      return
    }
    await Promise.allSettled([
      supabase.functions.invoke('send-email', { body: { kind:'booking_confirmation', booking_token:token } }),
      supabase.functions.invoke('send-email', { body: { kind:'booking_reschedule_firm_notification', booking_token:token } }),
    ])
    setBusy(false)
    setFinal({ kind:'moved', date, time })
  }

  const box={background:C.card,border:`1px solid ${C.line}`,borderRadius:12,padding:20}
  const chip=(active)=>({padding:'9px 4px',borderRadius:8,cursor:'pointer',fontSize:13,textAlign:'center',fontWeight:600,border:`1px solid ${active?C.accent:C.line}`,background:active?C.accent:'transparent',color:C.text})
  const btn=(bg,extra={})=>({border:'none',borderRadius:8,padding:'12px 22px',fontSize:14,fontWeight:700,cursor:'pointer',color:'#fff',background:bg,...extra})

  return (
    <div style={{minHeight:'100vh',background:C.bg,color:C.text,fontFamily:'system-ui, -apple-system, sans-serif',padding:'32px 16px'}}>
      <div style={{maxWidth:560,margin:'0 auto'}}>
        <div style={{textAlign:'center',marginBottom:24}}>
          <div style={{fontSize:24,fontWeight:800}}>{FIRM.name || 'Firm'}</div>
          <div style={{color:C.dim,fontSize:14,marginTop:4}}>Manage your appointment</div>
        </div>

        {bk === undefined ? (
          <div style={{...box,textAlign:'center',color:C.dim}}>Loading…</div>
        ) : bk === null ? (
          <div style={{...box,textAlign:'center',color:C.dim}}>This booking link isn't valid anymore. If you need help, just call us or reply to your confirmation email.</div>
        ) : final ? (
          <div style={{...box,textAlign:'center'}}>
            <div style={{fontSize:38}}>{final.kind === 'canceled' ? '👍' : '✅'}</div>
            <div style={{fontWeight:800,fontSize:18,marginTop:8}}>{final.kind === 'canceled' ? 'Appointment canceled' : "You're rescheduled!"}</div>
            <div style={{color:C.dim,marginTop:8,fontSize:14,lineHeight:1.7}}>
              {final.kind === 'canceled'
                ? 'No worries — you can book a new time whenever you’re ready.'
                : <>{bk.event_type}<br />{whenLong(final.date, final.time)}{zone !== 'America/New_York' && <><br />{etLabelInZone(final.date, final.time, zone)} your time</>}</>}
            </div>
          </div>
        ) : bk.status === 'canceled' ? (
          <div style={{...box,textAlign:'center',color:C.dim}}>This appointment was already canceled.</div>
        ) : (
          <div style={box}>
            <div style={{background:'rgba(37,99,235,0.1)',border:`1px solid ${C.line}`,borderRadius:10,padding:'14px 16px',marginBottom:18,lineHeight:1.8,fontSize:14}}>
              <strong>{bk.event_type}</strong><br />
              {whenLong(bk.date,bk.time)}
              {zone !== 'America/New_York' && <span style={{color:C.dim}}><br />{etLabelInZone(bk.date,bk.time,zone)} your time ({zoneShort(zone)})</span>}
            </div>

            {mode === 'view' && (
              <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
                <button style={btn(C.accent)} onClick={()=>setMode('reschedule')}>🔁 Reschedule</button>
                <button style={btn('transparent',{border:`1px solid ${C.line}`,color:'#fca5a5'})} onClick={()=>setMode('cancel')}>Cancel Appointment</button>
              </div>
            )}

            {mode === 'cancel' && (
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:14,marginBottom:14}}>Cancel this appointment?</div>
                {err && <div style={{color:'#fca5a5',fontSize:13,marginBottom:10}}>{err}</div>}
                <div style={{display:'flex',gap:10,justifyContent:'center'}}>
                  <button disabled={busy} style={btn('#b91c1c')} onClick={doCancel}>{busy?'Canceling…':'Yes, Cancel It'}</button>
                  <button style={btn('transparent',{border:`1px solid ${C.line}`})} onClick={()=>setMode('view')}>Keep It</button>
                </div>
              </div>
            )}

            {mode === 'reschedule' && (
              <>
                <div style={{fontWeight:700,fontSize:13.5,marginBottom:8}}>Pick a new day</div>
                <input type="date" value={date} min={new Date().toISOString().slice(0,10)} onChange={e=>pickDate(e.target.value)}
                  style={{width:'100%',boxSizing:'border-box',background:C.bg,border:`1px solid ${C.line}`,borderRadius:8,color:C.text,padding:'10px 12px',fontSize:14,colorScheme:'dark',marginBottom:14}} />
                {date && (slots === null ? (
                  <div style={{color:C.dim,fontSize:13,marginBottom:14}}>Checking availability…</div>
                ) : slots.length === 0 ? (
                  <div style={{color:C.dim,fontSize:13,marginBottom:14}}>No open times that day — try another date.</div>
                ) : (
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(90px, 1fr))',gap:8,marginBottom:14}}>
                    {slots.map(s=><div key={s} style={chip(time===s)} onClick={()=>setTime(s)}>{etLabelInZone(date,s,zone)}</div>)}
                  </div>
                ))}
                {zone !== 'America/New_York' && date && slots && slots.length > 0 && <div style={{color:C.dim,fontSize:11.5,marginBottom:12}}>Times shown in your timezone ({zoneShort(zone)}).</div>}
                {err && <div style={{color:'#fca5a5',fontSize:13,marginBottom:10}}>{err}</div>}
                <div style={{display:'flex',gap:10}}>
                  <button disabled={busy||!time} style={btn(time?C.accent:'rgba(37,99,235,0.35)',{flex:1,cursor:time?'pointer':'not-allowed'})} onClick={doReschedule}>
                    {busy?'Moving…':time?`Move to ${etLabelInZone(date,time,zone)}`:'Pick a time'}
                  </button>
                  <button style={btn('transparent',{border:`1px solid ${C.line}`})} onClick={()=>setMode('view')}>Back</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
