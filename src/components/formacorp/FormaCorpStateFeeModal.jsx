import { useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { supabase } from '../../lib/supabase'

const stripeCache = new Map()
function stripeFor(key) {
  if (!stripeCache.has(key)) stripeCache.set(key, loadStripe(key))
  return stripeCache.get(key)
}

function PaymentForm({ caseRecord, client, paymentIntentId, amount, onClose, onPaid, showToast }) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function pay() {
    if (!stripe || !elements || busy) return
    setBusy(true); setErr('')
    const result = await stripe.confirmPayment({ elements, redirect:'if_required' })
    if (result.error) { setBusy(false); setErr(result.error.message); return }
    const intentId = result.paymentIntent?.id || paymentIntentId
    const confirm = await supabase.functions.invoke('formacorp-state-fee', { body:{ action:'confirm', caseId:caseRecord.id, clientId:client.id, paymentIntentId:intentId } })
    setBusy(false)
    if (confirm.error || confirm.data?.error) { setErr(confirm.data?.error || confirm.error.message); return }
    if (!confirm.data?.success) { setErr('Payment was not confirmed.'); return }
    showToast?.('✅ State filing fee paid and recorded in FormaCorp')
    onPaid?.({ fee_paid:true, ...(caseRecord.state === 'FL' ? { fl_payment_status:'received', fl_payment_reference:confirm.data.payment_intent_id || intentId } : {}) })
  }

  return <div>
    <PaymentElement />
    {err && <div style={{color:'var(--bad)',fontSize:12,marginTop:10}}>{err}</div>}
    <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:16}}>
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn pri" onClick={pay} disabled={busy || !stripe}>{busy?'Processing…':'Pay $'+Number(amount).toFixed(2)}</button>
    </div>
  </div>
}

export default function FormaCorpStateFeeModal({ caseRecord, client, amount, onClose, onPaid, showToast }) {
  const [clientSecret, setClientSecret] = useState('')
  const [paymentIntentId, setPaymentIntentId] = useState('')
  const [publishableKey, setPublishableKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function start() {
    if (!caseRecord?.id || !client?.id || !Number(amount)) { setErr('Formation case, linked client, and filing fee are required.'); return }
    setLoading(true); setErr('')
    const settings = await supabase.from('settings').select('stripe_publishable_key,payment_provider').limit(1).maybeSingle()
    if (settings.error || settings.data?.payment_provider !== 'stripe' || !settings.data?.stripe_publishable_key) { setLoading(false); setErr('Online payments are not connected for this office in Settings.'); return }
    const response = await supabase.functions.invoke('formacorp-state-fee', { body:{ action:'intent', caseId:caseRecord.id, clientId:client.id } })
    setLoading(false)
    if (response.error || response.data?.error) { setErr(response.data?.error || response.error.message); return }
    setPublishableKey(settings.data.stripe_publishable_key)
    setClientSecret(response.data.client_secret)
    setPaymentIntentId(response.data.payment_intent_id)
  }

  return <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.68)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1200,padding:20}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div className="modal" style={{width:480,maxWidth:'95vw',padding:24}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,marginBottom:14}}>
        <div><div style={{fontWeight:800,fontSize:16}}>💳 State Filing Fee</div><div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>{caseRecord.entity_name} · {caseRecord.state}</div></div>
        <button className="xbtn" onClick={onClose}>&times;</button>
      </div>
      <div style={{padding:'10px 12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:8,marginBottom:14}}>
        <div className="dr"><span className="dl">Client</span><span className="dv">{client.name}</span></div>
        <div className="dr"><span className="dl">Government filing fee</span><span className="dv">{'$'+Number(amount).toFixed(2)}</span></div>
        <div style={{fontSize:10,color:'var(--t3)',marginTop:6,lineHeight:1.5}}>Card details are entered directly into Stripe's secure Payment Element and are never stored by FormaCorp.</div>
      </div>
      {!clientSecret ? <>
        {err && <div style={{color:'var(--bad)',fontSize:12,marginBottom:10}}>{err}</div>}
        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <button className="btn" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn pri" onClick={start} disabled={loading}>{loading?'Loading secure payment…':'Continue — $'+Number(amount).toFixed(2)}</button>
        </div>
      </> : <Elements stripe={stripeFor(publishableKey)} options={{clientSecret}}>
        <PaymentForm caseRecord={caseRecord} client={client} paymentIntentId={paymentIntentId} amount={amount} onClose={onClose} onPaid={onPaid} showToast={showToast}/>
      </Elements>}
    </div>
  </div>
}
