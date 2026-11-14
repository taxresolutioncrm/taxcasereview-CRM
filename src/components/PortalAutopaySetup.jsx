import { useState } from 'react'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { supabase } from '../lib/supabase'
import StripePaymentMethodModal from './StripePaymentMethodModal'

// Client-facing "set up monthly payments" flow for the Client Portal.
// Step 1 (only if no card on file yet): reuse the existing admin
// StripePaymentMethodModal as-is to collect a card via Stripe Elements.
// Step 2: pick a monthly amount, save via the stripe-set-autopay function.
// This never charges anything itself — it only saves the plan. Actual
// charging still goes through the existing staff-run autopay batch.
export default function PortalAutopaySetup({ client, suggestedAmount, portalToken, onClose, onSaved, showToast }) {
  const [needsCard, setNeedsCard] = useState(!client.default_payment_method_id)
  const [amount, setAmount] = useState(suggestedAmount > 0 ? String(suggestedAmount.toFixed(2)) : '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleConfirm() {
    if (!portalToken) { setErr('Please sign in to your client portal again.'); return }
    const numAmount = parseFloat(amount)
    if (!numAmount || numAmount <= 0) { setErr('Enter a valid monthly amount'); return }
    setSaving(true); setErr('')
    const { data, error } = await supabase.functions.invoke('stripe-set-autopay', {
      headers: { 'x-portal-token': portalToken },
      body: { clientId: client.id, enabled: true, amount: numAmount }
    })
    setSaving(false)
    if (error || data?.error) { setErr(data?.error || error.message); return }
    showToast?.('✅ Monthly payments set up')
    onSaved?.()
    onClose()
  }

  if (needsCard) {
    return (
      <StripePaymentMethodModal
        client={client}
        recordType="client"
        showToast={showToast}
        onSaved={() => setNeedsCard(false)}
        onClose={onClose}
      />
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: 420, maxWidth: '95vw', padding: 24, background: '#0f172a', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#f1f5f9' }}>Set Up Monthly Payments</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}>&times;</button>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>
          We'll charge the card on file this amount every month until your balance is paid off or you turn this off.
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11.5, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Monthly Amount ($)</label>
          <input type="text" inputMode="decimal" value={formatMoneyInput(amount)} onChange={e => setAmount(parseMoney(e.target.value))}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 7, background: '#0a1628', border: '1px solid #1e3a5f', color: '#f1f5f9', fontSize: 14, boxSizing: 'border-box' }} />
        </div>
        {err && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={saving} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6, color: '#cbd5e1', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={handleConfirm} disabled={saving} style={{ padding: '8px 18px', background: '#1A7FD4', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Start Monthly Payments'}
          </button>
        </div>
      </div>
    </div>
  )
}
