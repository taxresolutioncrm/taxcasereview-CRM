import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { FIRM } from '../lib/firmBranding'
import { triggerWorkflow } from '../lib/triggerWorkflow'
import { advanceLeadStatus } from '../lib/leadStatus'
import { sendBookingInvite } from '../lib/bookingEmails'

const CLIENT_EVENT_TYPES = [
  { type: 'Case Discussion',          icon: '💬' },
  { type: 'Tax Investigation Review', icon: '🔍' },
  { type: 'Document Signing',         icon: '✍️' },
  { type: 'Follow-Up Call',           icon: '📞' },
  { type: 'In-Person Meeting',        icon: '🤝' },
  { type: 'Other',                    icon: '📌' },
]

const LEAD_EVENT_TYPES = CLIENT_EVENT_TYPES

const HELP_OPTIONS = [
  'Tax Resolution / IRS Debt',
  'Unfiled Tax Returns',
  'IRS Notice or Audit',
  'Wage Garnishment / Levy',
  'Payment Plan Setup',
  'Tax Planning',
  'Something Else',
]

// mode: 'client' = simple internal scheduler
//       'lead'   = qualification questions + scheduler (no external widget)
export default function BookingWidget({ contact, onClose, mode = 'lead' }) {
  const [saving, setSaving] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [linkSent, setLinkSent] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Calendly-style: email them the public booking link and let THEM pick
  async function sendBookingLink() {
    if (!contact?.email) return
    setLinkSent('sending')
    const ok = await sendBookingInvite({ name: contact.name, email: contact.email, phone: contact.phone })
    if (ok && contact?.name) {
      const linkNote = `✉️ Booking link emailed to ${contact.email}`
      if (mode === 'lead' && contact?.id) {
        await supabase.from('lead_notes').insert({ lead_id: contact.id, lead_name: contact.name, text: linkNote, type: 'Email', author: 'System' }).catch(()=>{})
      } else {
        await supabase.from('client_notes').insert({ clientname: contact.name, text: linkNote, author: 'System', visible_to_client: false }).catch(()=>{})
      }
    }
    setLinkSent(ok ? true : 'error')
  }

  const today = new Date().toISOString().slice(0,10)
  const [form, setForm] = useState({
    date: today, time: '',
    eventType: 'Case Discussion',
    notes: '',
    // Lead qualification fields
    decisionMaker: '', happyWithSupport: '', helpNeeded: [], extraInfo: '',
  })
  function fld(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function toggleHelp(opt) {
    setForm(f => ({ ...f, helpNeeded: f.helpNeeded.includes(opt) ? f.helpNeeded.filter(x=>x!==opt) : [...f.helpNeeded, opt] }))
  }

  const EVENT_TYPES = mode === 'client' ? CLIENT_EVENT_TYPES : LEAD_EVENT_TYPES

  async function confirmBooking() {
    if (!form.date || !form.time) return
    setErrorMsg('')
    setSaving(true)
    const title = `${contact?.name || 'Appointment'} - ${form.eventType}`

    const notesLines = [form.notes]
    if (mode === 'lead') {
      notesLines.push(
        '',
        '— Qualification —',
        `Key decision maker: ${form.decisionMaker || '—'}`,
        `Happy with current tax/accounting support: ${form.happyWithSupport || '—'}`,
        `Help needed: ${form.helpNeeded.length ? form.helpNeeded.join(', ') : '—'}`,
        form.extraInfo ? `Additional info: ${form.extraInfo}` : null,
      )
    }
    const fullNotes = notesLines.filter(Boolean).join('\n')

    const { error } = await supabase.from('calevents').insert([{
      title, clientName: contact?.name || '', date: form.date, time: form.time,
      eventType: form.eventType, color: 'bb', status: 'scheduled',
      notes: fullNotes, source: 'internal',
      created_at: new Date().toISOString(),
    }])
    setSaving(false)
    if (error) { setErrorMsg('Could not save appointment: ' + error.message); return }

    // Save qualification answers as a lead note too
    if (mode === 'lead' && contact?.id) {
      await supabase.from('lead_notes').insert([{
        lead_id: contact.id,
        content: `📅 Appointment scheduled (${form.eventType}, ${form.date} ${form.time}).\n\n${notesLines.slice(2).filter(Boolean).join('\n')}`,
        created_at: new Date().toISOString(),
      }])
      // Booking a call with a lead is the consultation being scheduled —
      // forward-only, so this is a no-op if the lead is already past this stage.
      await advanceLeadStatus(supabase, contact?.name, 'Consultation Scheduled')
    }

    // Workflow trigger — appointment scheduled
    const entityType = mode === 'lead' ? 'lead' : 'client'
    await triggerWorkflow('lead_appointment_set', entityType, contact?.name || '', 'Staff').catch(()=>{})

    // Log note on the lead or client record
    const noteText = `📅 Appointment scheduled: ${form.date} at ${form.time}${form.eventType ? ` (${form.eventType})` : ''}${form.notes ? ` — ${form.notes}` : ''}`
    if (mode === 'lead' && contact?.id) {
      await supabase.from('lead_notes').insert({ lead_id: contact.id, lead_name: contact.name, text: noteText, type: 'Appointment', author: 'System', created_at: new Date().toISOString() }).catch(()=>{})
    } else if (contact?.name) {
      await supabase.from('client_notes').insert({ clientname: contact.name, text: noteText, author: 'System', visible_to_client: false }).catch(()=>{})
    }

    setConfirmed(true)
    setTimeout(() => { setConfirmed(false); onClose() }, 1500)
  }

  const initials = (contact?.name || '?').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()
  const dateLabel = form.date ? new Date(form.date+'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) : null

  return (
    <div className="modal-bg open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 460, maxHeight: '90vh', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Header band */}
        <div style={{ padding: '18px 20px', background: 'linear-gradient(135deg, var(--blue), var(--b2))', position: 'relative', flexShrink: 0 }}>
          <button className="xbtn" onClick={onClose} style={{ position: 'absolute', top: 12, right: 14, color: '#fff' }}>&times;</button>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.75)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
            Schedule Appointment
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, color: '#fff', flexShrink: 0 }}>
              {initials}
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>{contact?.name || 'Client'}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.8)' }}>{FIRM.name || 'Tax Resolution'}</div>
            </div>
          </div>
        </div>

        <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1 }}>
          {errorMsg && (
            <div role="alert" style={{background:'rgba(239,68,68,.10)',border:'1px solid rgba(239,68,68,.35)',color:'#fca5a5',borderRadius:8,padding:'9px 11px',fontSize:12,marginBottom:12}}>
              {errorMsg}
            </div>
          )}
          {confirmed ? (
            <div style={{ textAlign: 'center', color: 'var(--ok)', fontWeight: 700, fontSize: 14, padding: '24px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              Appointment scheduled!
            </div>
          ) : (
            <>
              {/* Calendly-style: let the contact pick their own time */}
              <div style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, color: 'var(--t2)', flex: 1, minWidth: 170 }}>
                  <b>Let {(contact?.name || 'them').split(' ')[0]} pick the time</b> — email the online booking link and they choose from live availability.
                </div>
                {linkSent === true ? (
                  <span style={{ color: 'var(--ok)', fontSize: 12, fontWeight: 700 }}>✅ Link sent</span>
                ) : (
                  <button className="btn sec" disabled={!contact?.email || linkSent === 'sending'} onClick={sendBookingLink}>
                    {linkSent === 'sending' ? 'Sending…' : linkSent === 'error' ? 'Retry Send' : '✉️ Email Booking Link'}
                  </button>
                )}
                {!contact?.email && <span style={{ fontSize: 11, color: 'var(--t3)' }}>No email on file</span>}
              </div>

              {/* Lead qualification questions (lead mode only) */}
              {mode === 'lead' && (
                <>
                  <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 16 }}>
                    A few quick questions before we schedule — this helps our team prep for the call.
                  </div>

                  {/* Q1 */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                      Are you the key decision maker?
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {['Yes','No'].map(opt => (
                        <button key={opt} onClick={() => fld('decisionMaker', opt)}
                          style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            border: form.decisionMaker===opt ? '1.5px solid var(--blue)' : '1px solid var(--br)',
                            background: form.decisionMaker===opt ? 'var(--blt)' : 'var(--s2)',
                            color: form.decisionMaker===opt ? 'var(--b2)' : 'var(--t2)' }}>
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Q2 */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                      Are you happy with your current tax & accounting support?
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {['Yes','No','They could be better'].map(opt => (
                        <button key={opt} onClick={() => fld('happyWithSupport', opt)}
                          style={{ flex: '1 1 auto', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                            border: form.happyWithSupport===opt ? '1.5px solid var(--blue)' : '1px solid var(--br)',
                            background: form.happyWithSupport===opt ? 'var(--blt)' : 'var(--s2)',
                            color: form.happyWithSupport===opt ? 'var(--b2)' : 'var(--t2)' }}>
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Q3 */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                      What do you need the most help with? <span style={{ fontWeight: 400, textTransform: 'none' }}>(check all that apply)</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {HELP_OPTIONS.map(opt => (
                        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--t2)' }}>
                          <input type="checkbox" checked={form.helpNeeded.includes(opt)} onChange={() => toggleHelp(opt)} />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Q4 */}
                  <div className="field" style={{ marginBottom: 18 }}>
                    <label>Anything else you'd like to share before the call? <span style={{ fontWeight: 400, color: 'var(--t3)', textTransform: 'none' }}>(optional)</span></label>
                    <textarea rows={3} value={form.extraInfo} onChange={e => fld('extraInfo', e.target.value)} placeholder="Tell us a bit more..." />
                  </div>

                  <div style={{ borderTop: '1px solid var(--br)', margin: '4px 0 18px' }} />
                </>
              )}

              {/* Appointment type chips */}
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                What's this about?
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 18 }}>
                {EVENT_TYPES.map(({type, icon}) => (
                  <button key={type} onClick={() => fld('eventType', type)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      padding: '10px 4px', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                      border: form.eventType === type ? '1.5px solid var(--blue)' : '1px solid var(--br)',
                      background: form.eventType === type ? 'var(--blt)' : 'var(--s2)',
                      color: form.eventType === type ? 'var(--b2)' : 'var(--t2)',
                      transition: 'all .12s',
                    }}>
                    <span style={{ fontSize: 18 }}>{icon}</span>
                    <span style={{ textAlign: 'center', lineHeight: 1.2 }}>{type}</span>
                  </button>
                ))}
              </div>

              {/* Date & Time */}
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                When?
              </div>
              <div className="fg2" style={{ marginBottom: 14 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>📅 Date</label>
                  <input type="date" value={form.date} onChange={e => fld('date', e.target.value)} />
                  {dateLabel && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>{dateLabel}</div>}
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>🕐 Time</label>
                  <input type="time" value={form.time} onChange={e => fld('time', e.target.value)} />
                </div>
              </div>

              {/* Notes */}
              <div className="field" style={{ marginBottom: 18 }}>
                <label>📝 Notes <span style={{ fontWeight: 400, color: 'var(--t3)', textTransform: 'none' }}>(optional)</span></label>
                <textarea rows={3} value={form.notes} onChange={e => fld('notes', e.target.value)} placeholder="What will be discussed on this call..." />
              </div>

              <button className="btn pri" style={{ width: '100%', justifyContent: 'center', padding: 11, fontSize: 14, fontWeight: 700, gap: 8 }}
                onClick={confirmBooking} disabled={saving || !form.date || !form.time}>
                {saving ? 'Saving…' : '✅ Schedule Appointment'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
