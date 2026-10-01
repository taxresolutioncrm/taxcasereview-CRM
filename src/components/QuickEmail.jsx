import { useState, useEffect } from 'react'
import { FIRM } from '../lib/firmBranding'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { sendGmailEmail } from '../lib/gmailUtils'
import { EMAIL_TEMPLATES, applyTemplate } from '../lib/emailTemplatesList'

// ── Quick Email (click-to-email from a lead/client record) ──
// Sends from the logged-in rep's connected Gmail (their signature); falls
// back to the firm-wide account if they haven't connected one. Every send is
// documented: a row in the emails table (rep's Sent box) and a 📧 note on
// the lead/client file — same shapes the Email page writes.

export default function QuickEmail({ contact, kind, leadId, onSent, onClose }) {
  const { user, myTenantId } = useApp()
  const [form, setForm] = useState({ to: contact?.email || '', subject: '', body: '' })
  const [state, setState] = useState('idle') // idle | sending | sent | error
  const [errMsg, setErrMsg] = useState('')
  const [signature, setSignature] = useState({ text: '', logoUrl: '' })

  // Same resolution as the Email page: personal signature first, firm fallback.
  useEffect(() => {
    (async () => {
      let sigText = '', sigLogo = '', firmLogo = ''
      try {
        // Also fetch logourl — RLS scopes this to the logged-in tenant automatically.
        // logourl is per-tenant since 7/21; email_signature_logo_url may be null.
        const { data: st } = await supabase.from('settings').select('email_signature,email_signature_logo_url,logourl').eq('tenant_id', myTenantId).maybeSingle()
        sigText = st?.email_signature || ''
        sigLogo = st?.email_signature_logo_url || ''
        firmLogo = st?.logourl || ''
        if (user?.email) {
          const { data: emp } = await supabase.from('employees')
            .select('email_signature,email_signature_logo_url').eq('tenant_id', myTenantId).eq('email', user.email).maybeSingle()
          if (emp?.email_signature) sigText = emp.email_signature
          if (emp?.email_signature_logo_url) sigLogo = emp.email_signature_logo_url
        }
      } catch { /* preview only — send still appends server-side */ }
      // Prefer explicit sig logo → per-tenant firm logo → FIRM module fallback.
      // Never fall through to a shared path — that bleeds one tenant's logo onto another.
      setSignature({ text: sigText, logoUrl: sigLogo || firmLogo || FIRM.logoUrl || '' })
    })()
  }, [user])

  async function send() {
    if (!form.to.trim() || !form.subject.trim() || !form.body.trim()) { setErrMsg('To, subject, and message are all required.'); setState('error'); return }
    setState('sending'); setErrMsg('')
    let sentVia = null
    try {
      await sendGmailEmail(supabase, { to: form.to.trim(), subject: form.subject, body: form.body, senderEmployeeEmail: user?.email })
      sentVia = 'personal'
    } catch {
      try {
        await sendGmailEmail(supabase, { to: form.to.trim(), subject: form.subject, body: form.body })
        sentVia = 'firm'
      } catch (e2) {
        setState('error'); setErrMsg('Send failed: ' + e2.message + ' — connect Gmail on the Email page, or check the firm account in Settings.')
        return
      }
    }

    // ── Document everything (best-effort; the email already went out) ──
    let authorName = user?.email || 'Staff'
    try {
      const { data: empRec } = await supabase.from('employees').select('name').eq('tenant_id', myTenantId).eq('email', user?.email).maybeSingle()
      if (empRec?.name) authorName = empRec.name
    } catch { /* noop */ }
    const preview = form.body.slice(0, 120).replace(/\n/g, ' ').trim()
    const noteText = `📧 Email Sent — "${form.subject}"\n${preview}${form.body.length > 120 ? '…' : ''}`
    try {
      await supabase.from('emails').insert([{
        recipient: form.to.trim(), clientName: contact?.name || '', subject: form.subject, body: form.body,
        triage: 'Sent', status: 'Sent', mailbox_owner: user?.email || null, created_at: new Date().toISOString(),
      }])
    } catch { /* noop */ }
    try {
      if (kind === 'lead' && leadId) {
        await supabase.from('lead_notes').insert({ lead_id: leadId, lead_name: contact?.name || '', text: noteText, type: 'Email', author: authorName, created_at: new Date().toISOString() })
      } else if (contact?.name) {
        await supabase.from('client_notes').insert({ clientname: contact.name, text: noteText, note_type: 'Email', author: authorName, created_at: new Date().toISOString() })
      }
    } catch { /* noop */ }

    setState('sent')
    if (onSent) onSent(sentVia)
  }

  const label = { display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 5 }
  const input = { width: '100%', boxSizing: 'border-box', background: 'rgba(15,23,42,0.55)', border: '1px solid var(--line)', borderRadius: 8, color: 'inherit', padding: '10px 12px', fontSize: 13.5, outline: 'none', fontFamily: 'inherit' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 14, width: 'min(560px, 96vw)', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ background: 'linear-gradient(135deg, #1d4ed8, #2563eb 60%, #3b82f6)', padding: '16px 20px', borderRadius: '13px 13px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#fff' }}>✉️ Email {contact?.name || ''}</div>
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11.5, marginTop: 2 }}>Sends from your Gmail · logged to the file automatically</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, color: '#fff', width: 28, height: 28, fontSize: 13, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: 20 }}>
          {state === 'sent' ? (
            <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto' }}>📨</div>
              <div style={{ fontWeight: 800, fontSize: 17, marginTop: 12 }}>Sent</div>
              <div style={{ color: 'var(--t3)', fontSize: 12.5, marginTop: 8 }}>Delivered to {form.to} and logged on the file with a 📧 note.</div>
              <button onClick={onClose} style={{ marginTop: 16, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 28px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Done</button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={label}>Templates</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {EMAIL_TEMPLATES.map(t => (
                    <button key={t.label} onClick={() => setForm(f => ({ ...f, ...applyTemplate(t, contact?.name) }))}
                      style={{ background: 'rgba(15,23,42,0.55)', border: '1px solid var(--line)', borderRadius: 7, color: 'inherit', padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <label style={label}>To</label>
                  <input style={input} type="email" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} />
                </div>
                <div>
                  <label style={label}>Subject</label>
                  <input style={input} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} autoFocus />
                </div>
                <div>
                  <label style={label}>Message</label>
                  <textarea style={{ ...input, resize: 'vertical', minHeight: 140 }} rows={7} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Write your message — the signature below is appended when sent." />
                </div>
                <div>
                  <label style={label}>Signature <span style={{ textTransform: 'none', fontWeight: 400 }}>(added automatically on send)</span></label>
                  {(signature.text || signature.logoUrl) ? (
                    <div style={{ background: 'rgba(15,23,42,0.4)', border: '1px dashed var(--line)', borderRadius: 8, padding: '10px 12px' }}>
                      {signature.logoUrl && <img src={signature.logoUrl} alt="" style={{ maxHeight: 44, maxWidth: 200, display: 'block', marginBottom: 6 }} />}
                      {signature.text && <div style={{ fontSize: 12.5, color: 'var(--t2)', whiteSpace: 'pre-wrap', fontFamily: 'Arial, sans-serif', lineHeight: 1.5 }}>{signature.text}</div>}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5, color: 'var(--t3)', padding: '8px 12px', background: 'rgba(15,23,42,0.4)', borderRadius: 8 }}>
                      No signature set — add yours in Settings → My Signature and it'll appear on every email.
                    </div>
                  )}
                </div>
              </div>
              {state === 'error' && (
                <div style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginTop: 12 }}>{errMsg}</div>
              )}
              <button disabled={state === 'sending'} onClick={send}
                style={{ width: '100%', marginTop: 14, border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14.5, fontWeight: 800, cursor: state === 'sending' ? 'wait' : 'pointer', background: state === 'sending' ? 'rgba(37,99,235,0.35)' : 'linear-gradient(135deg, #1d4ed8, #2563eb)', color: '#fff' }}>
                {state === 'sending' ? 'Sending…' : '📨 Send Email'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
