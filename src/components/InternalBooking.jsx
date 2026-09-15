import { useState } from 'react'
import { sendBookingInvite, bookUrl } from '../lib/bookingEmails'

// ── Send Booking Link (Calendar header) ──
// Calendly-exact: staff never pick times for anyone. This sends the person
// our booking link; THEY choose their own date and time on the public page.
// When they book, everything downstream is automatic — calendar event, lead
// created if they're new, note on the record, confirmation + rep emails.

export default function InternalBooking({ onClose }) {
  const [form, setForm] = useState({ name: '', email: '' })
  const [state, setState] = useState('idle') // idle | sending | sent | error
  const [copied, setCopied] = useState(false)

  async function send() {
    const email = form.email.trim().toLowerCase()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /@(gamil|gmial|gmai|gmail\.co)$/i.test(email)) {
      setState('invalid')
      return
    }
    setState('sending')
    const ok = await sendBookingInvite({ name: form.name, email })
    setState(ok ? 'sent' : 'error')
  }

  function copyLink() {
    navigator.clipboard.writeText(bookUrl()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) })
  }

  const label = { display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 5 }
  const input = {
    width: '100%', boxSizing: 'border-box', background: 'rgba(15,23,42,0.55)',
    border: '1px solid var(--line)', borderRadius: 8, color: 'inherit',
    padding: '10px 12px', fontSize: 13.5, outline: 'none', fontFamily: 'inherit',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 14, width: 'min(440px, 96vw)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>

        <div style={{ background: 'linear-gradient(135deg, #1d4ed8, #2563eb 60%, #3b82f6)', padding: '16px 20px', borderRadius: '13px 13px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#fff' }}>📅 Send Booking Link</div>
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11.5, marginTop: 2 }}>They pick their own date &amp; time</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, color: '#fff', width: 28, height: 28, fontSize: 13, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: 20 }}>
          {state === 'sent' ? (
            <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto' }}>✉️</div>
              <div style={{ fontWeight: 800, fontSize: 17, marginTop: 12 }}>Invite sent</div>
              <div style={{ color: 'var(--t3)', fontSize: 12.5, marginTop: 8, lineHeight: 1.7 }}>
                {form.email.trim()} got the link. When they book, the appointment hits the calendar,
                a lead is created if they're new, and the rep gets notified — automatically.
              </div>
              <button onClick={onClose} style={{ marginTop: 16, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 28px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Done</button>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <label style={label}>Their name</label>
                  <input style={input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Taxpayer" autoFocus />
                </div>
                <div>
                  <label style={label}>Their email *</label>
                  <input style={input} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@email.com" />
                </div>
              </div>

              {state === 'invalid' && (
                <div style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginTop: 12 }}>
                  Check the email address — it looks mistyped.
                </div>
              )}
              {state === 'error' && (
                <div style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginTop: 12 }}>
                  Send failed — check the address and try again.
                </div>
              )}

              <button disabled={state === 'sending' || !form.email.trim()} onClick={send}
                style={{
                  width: '100%', marginTop: 14, border: 'none', borderRadius: 10, padding: '13px 0',
                  fontSize: 14.5, fontWeight: 800, cursor: state === 'sending' || !form.email.trim() ? 'not-allowed' : 'pointer',
                  background: state === 'sending' || !form.email.trim() ? 'rgba(37,99,235,0.35)' : 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                  color: '#fff', boxShadow: state === 'sending' || !form.email.trim() ? 'none' : '0 6px 18px rgba(37,99,235,0.35)',
                }}>
                {state === 'sending' ? 'Sending…' : state === 'error' ? 'Retry Send' : '✉️ Email Booking Link'}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, justifyContent: 'center' }}>
                <span style={{ color: 'var(--t3)', fontSize: 11.5 }}>or share it yourself:</span>
                <button onClick={copyLink} style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 7, color: 'inherit', padding: '5px 12px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                  {copied ? '✅ Copied' : '📋 Copy Link'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
