import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { fillForm, FORM_LABELS, TEMPLATE_PATHS } from '../lib/irsFormUtils';
import { FIRM } from '../lib/firmBranding'

function downloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// All IRS forms with their types — drives both the full list and the routing
const ALL_IRS_FORMS = [
  { formType: '2848_personal', label: 'Form 2848 — Power of Attorney (Personal)',     needsSsn: true  },
  { formType: '2848_business', label: 'Form 2848 — Power of Attorney (Business)',     needsEin: true  },
  { formType: '8821_personal', label: 'Form 8821 — Tax Info Authorization (Personal)', needsSsn: true },
  { formType: '8821_business', label: 'Form 8821 — Tax Info Authorization (Business)', needsEin: true },
  { formType: '433a',  label: 'Form 433-A — Collection Info (Individual)',   needsSsn: true  },
  { formType: '433b',  label: 'Form 433-B — Collection Info (Business)',     needsEin: true  },
  { formType: '433d',  label: 'Form 433-D — Installment Agreement',          needsSsn: true  },
  { formType: '433f',  label: 'Form 433-F — Collection Info (General)',      needsSsn: true  },
  { formType: '433h',  label: 'Form 433-H — Installment Agreement Request & CIS', needsSsn: true },
  { formType: '656l',  label: 'Form 656-L — OIC Doubt as to Liability',     needsSsn: true  },
  { formType: '9465',  label: 'Form 9465 — Installment Agreement Request',   needsSsn: true  },
  { formType: '843',   label: 'Form 843 — Penalty Abatement/Refund',         needsSsn: true  },
  { formType: '8822',  label: 'Form 8822 — Change of Address (Individual)',  needsSsn: true  },
  { formType: '8822b', label: 'Form 8822-B — Change of Address (Business)', needsEin: true  },
  { formType: '4506t', label: 'Form 4506-T — Request for Transcript',        needsSsn: true  },
  { formType: '12153', label: 'Form 12153 — CDP Hearing Request',            needsSsn: true  },
  { formType: '656',   label: 'Form 656 — Offer in Compromise',             needsSsn: true  },
  { formType: '4549',  label: 'Form 4549 — Exam Changes (Audit)',           needsSsn: true  },
  { formType: '8832',  label: 'Form 8832 — Entity Classification',          needsEin: true  },
  { formType: '911',   label: 'Form 911 — Taxpayer Advocate',               needsSsn: true  },
  { formType: 'ss4',   label: 'Form SS-4 — Apply for EIN',                  needsEin: true  },
  { formType: '2553',  label: 'Form 2553 — S-Corp Election',                needsEin: true  },
  { formType: '12661', label: 'Form 12661 — Disputed Issue Verification',   needsSsn: true  },
  { formType: '1128',  label: 'Form 1128 — Adopt/Change Tax Year',          needsEin: true  },
];

export default function IRSFormFiller({ client, onClose }) {
  const [loading,  setLoading]  = useState(null);
  const [sending,  setSending]  = useState(null);
  const [sendVia,  setSendVia]  = useState('email');
  const [sentMsg,  setSentMsg]  = useState('');
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');

  if (!client) return null;

  const clientName = client.business_name || client.name || 'Client';
  const hasSsn = !!(client.ssn || client.tin);
  const hasEin = !!client.ein;
  const isBiz  = hasEin || !!client.business_name || client.clientType === 'Business' || client.clientType === 'Individual & Biz';
  const hasEmail = !!client.email;
  const hasPhone = !!client.phone;

  // If opened from a specific form card (_formType), show only that form
  const targetFormType = client._formType;
  const targetForm = targetFormType ? ALL_IRS_FORMS.find(f => f.formType === targetFormType) : null;

  const visibleForms = targetForm
    ? [targetForm]
    : ALL_IRS_FORMS.filter(f => {
        if (search && !f.label.toLowerCase().includes(search.toLowerCase())) return false;
        // Hide business forms for pure individual clients
        if (f.needsEin && !isBiz) return false;
        return true;
      });

  const handleFill = async (formType) => {
    setLoading(formType);
    setError('');
    try {
      const bytes = await fillForm(formType, client);
      const label = FORM_LABELS[formType] || formType;
      const safeName = clientName.replace(/[^a-zA-Z0-9]+/g, '_');
      downloadPdf(bytes, `${formType}_${safeName}.pdf`);
    } catch (e) {
      setError(`${e.message} — if this is a newer IRS form, the field names may need updating. Contact support.`);
    } finally {
      setLoading(null);
    }
  };

  const handleSend = async (formType) => {
    setSending(formType);
    setError('');
    setSentMsg('');
    try {
      if (sendVia !== 'sms' && !hasEmail) throw new Error('Client has no email on file');
      if (sendVia !== 'email' && !hasPhone) throw new Error('Client has no phone on file');

      const bytes = await fillForm(formType, client);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const safeName = clientName.replace(/[^a-zA-Z0-9]+/g, '-');
      const path = `docs/${safeName}/irs-forms/${formType}_${Date.now()}.pdf`;

      const { error: upErr } = await supabase.storage.from('documents')
        .upload(path, blob, { upsert: true, contentType: 'application/pdf' });
      if (upErr) throw new Error(upErr.message);

      const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 94608000);
      const label = FORM_LABELS[formType] || formType;

      const { data: esign, error: esignErr } = await supabase.from('esigns').insert([{
        doc_type: label,
        client_name: clientName,
        client_email: client.email || '',
        client_phone: client.phone || '',
        message: `Please review and sign your ${label}.`,
        pdf_attachments: [{ formType, label, url: urlData?.signedUrl || '' }],
        priority: 'Normal',
        status: 'Awaiting',
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }]).select().single();
      if (esignErr) throw new Error(esignErr.message);

      const sigUrl = `${window.location.origin}/sign/${esign.id}?token=${encodeURIComponent(esign.signer_token || '')}`;
      await navigator.clipboard.writeText(sigUrl).catch(() => {});

      let emailSent = false, smsSent = false;

      if ((sendVia === 'email' || sendVia === 'both') && client.email) {
        const { error: eErr } = await supabase.functions.invoke('send-email', {
          body: {
            tenant_id: FIRM.tenantId || undefined,
            to: client.email,
            subject: `Action Required: Sign Your ${label}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
              <div style="text-align:center;margin-bottom:20px">
                <img src="${FIRM.logoUrl}" alt="${FIRM.name}" style="max-height:56px;display:block;margin:0 auto 8px" onerror="this.style.display='none'"/>
                <div style="font-size:12px;font-weight:800;color:#1d4ed8;text-transform:uppercase">${FIRM.name}</div>
              </div>
              <p>Dear <strong>${clientName}</strong>,</p>
              <p>Your <strong>${label}</strong> is ready for your review and signature.</p>
              <p style="text-align:center;margin:24px 0">
                <a href="${sigUrl}" style="background:#1d4ed8;color:#fff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">Review &amp; Sign →</a>
              </p>
              <p style="font-size:11px;color:#94a3b8;margin-top:24px">${FIRM.name} · ${FIRM.address}<br/>📞 ${FIRM.phone}</p>
            </div>`
          }
        });
        emailSent = !eErr;
      }

      if ((sendVia === 'sms' || sendVia === 'both') && client.phone) {
        const { data: cfg } = await supabase.from('settings').select('signalwire_backend').limit(1).maybeSingle();
        if (cfg?.signalwire_backend) {
          try {
            await fetch(cfg.signalwire_backend + '/sms/send', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: client.phone, body: `${FIRM.name || 'Tax Case Review'}: please sign your ${label}: ${sigUrl}` })
            });
            smsSent = true;
          } catch (_) {}
        }
      }

      setSentMsg(emailSent || smsSent ? '✅ Sent for signature!' : '✅ Signing link copied to clipboard');
      setTimeout(() => setSentMsg(''), 4000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="modal-bg open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 520, maxHeight: '90vh', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div className="mh" style={{ padding: '14px 18px', borderBottom: '1px solid var(--br)', flexShrink: 0 }}>
          <div>
            <span className="mt">{targetForm ? targetForm.label : 'IRS Form Pre-Fill'}</span>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{clientName}</div>
          </div>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {error && (
            <div style={{ background: 'rgba(192,32,47,.12)', border: '1px solid var(--bad)', color: 'var(--bad)', fontSize: 12, borderRadius: 8, padding: '10px 12px' }}>
              {error}
            </div>
          )}
          {sentMsg && (
            <div style={{ background: 'rgba(37,162,90,.12)', border: '1px solid var(--good)', color: 'var(--good)', fontSize: 12, borderRadius: 8, padding: '10px 12px' }}>
              {sentMsg}
            </div>
          )}

          {/* Info — what gets filled */}
          <div style={{ background: 'var(--blt)', border: '1px solid var(--blue)', fontSize: 12, borderRadius: 8, padding: '10px 12px', lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Data filled into this form:</div>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '2px 8px', color: 'var(--b2)' }}>
              <span style={{ color: 'var(--t3)' }}>Name</span>      <span style={{ fontWeight: 600 }}>{client.name || '—'}</span>
              <span style={{ color: 'var(--t3)' }}>Address</span>   <span>{[client.address||client.street, client.city, client.state, client.zip].filter(Boolean).join(', ') || '—'}</span>
              <span style={{ color: 'var(--t3)' }}>SSN</span>       <span style={{ color: hasSsn ? 'inherit' : 'var(--warn)' }}>{hasSsn ? (client.ssn||client.tin) : 'Not on file'}</span>
              {isBiz && <><span style={{ color: 'var(--t3)' }}>EIN</span> <span style={{ color: hasEin ? 'inherit' : 'var(--warn)' }}>{hasEin ? client.ein : 'Not on file'}</span></>}
              <span style={{ color: 'var(--t3)' }}>Phone</span>     <span>{client.phone || '—'}</span>
            </div>
          </div>

          {/* Send via */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Send Via</label>
            <select value={sendVia} onChange={e => setSendVia(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--bd)', fontSize: 12, background: 'var(--s2)', color: 'var(--tx)' }}>
              <option value="email">Email</option>
              <option value="sms">Text Message</option>
              <option value="both">Email + Text</option>
            </select>
          </div>

          {/* Search (only when showing full list) */}
          {!targetForm && (
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search forms…"
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 13 }}
            />
          )}

          {/* Form list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visibleForms.map(f => (
              <div key={f.formType} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--s1)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--br)' }}>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>{f.label}</span>
                <button className="btn sec" disabled={!!loading || !!sending}
                  onClick={() => handleFill(f.formType)}
                  style={{ fontSize: 11, padding: '5px 12px', whiteSpace: 'nowrap' }}>
                  {loading === f.formType ? '⏳' : '📄'} Download
                </button>
                <button className="btn pri" disabled={!!loading || !!sending}
                  onClick={() => handleSend(f.formType)}
                  style={{ fontSize: 11, padding: '5px 12px', whiteSpace: 'nowrap' }}>
                  {sending === f.formType ? '⏳' : '✍️'} Send
                </button>
              </div>
            ))}
          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--br)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
