import { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { supabase } from '../../lib/supabase'

const stripePromises = new Map()
function getStripe(pk, stripeAccount = null) {
  const cacheKey = `${pk}:${stripeAccount || ''}`
  if (!stripePromises.has(cacheKey)) {
    stripePromises.set(cacheKey, loadStripe(pk, stripeAccount ? { stripeAccount } : undefined))
  }
  return stripePromises.get(cacheKey)
}

function PayForm({ caseRecord, amount, paymentIntentId, onPaid, onClose }) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!stripe || !elements || busy) return
    setBusy(true); setErr('')
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect:'if_required' })
    if (error) { setErr(error.message || 'Payment failed'); setBusy(false); return }

    const { data, error:fnErr } = await supabase.functions.invoke('formacorp-state-fee-confirm', {
      body:{
        caseId:caseRecord.id,
        paymentIntentId:paymentIntent?.id || paymentIntentId,
        expectedAmount:Number(amount),
      }
    })
    setBusy(false)
    if (fnErr || data?.error) { setErr(data?.error || fnErr?.message || 'Could not verify payment'); return }
    onPaid?.(data)
  }

  return <div>
    <PaymentElement options={{ layout:'tabs' }} />
    {err && <div style={{color:'var(--bad)',fontSize:12,marginTop:10}}>{err}</div>}
    <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:16}}>
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn pri" onClick={submit} disabled={busy || !stripe}>{busy?'Processing…':'Pay $' + Number(amount||0).toFixed(2)}</button>
    </div>
  </div>
}

export default function FormaCorpStateFeeModal({ caseRecord, amount, onClose, onPaid }) {
  const [loading,setLoading]=useState(true)
  const [err,setErr]=useState('')
  const [publishableKey,setPublishableKey]=useState('')
  const [clientSecret,setClientSecret]=useState('')
  const [paymentIntentId,setPaymentIntentId]=useState('')
  const [stripeAccount,setStripeAccount]=useState(null)

  useEffect(()=>{ start() },[])

  async function start() {
    setLoading(true); setErr('')
    try {
      const { data:tenantId, error:tenantErr } = await supabase.rpc('current_tenant_id')
      if (tenantErr) throw tenantErr
      if (!tenantId) throw new Error('No active office context.')

      const { data, error } = await supabase.functions.invoke('formacorp-state-fee-intent', {
        body:{ caseId:caseRecord.id, amount:Number(amount) }
      })
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not start payment')

      if (data?.already_collected) {
        onPaid?.(data)
        return
      }

      if (data?.already_succeeded && data?.payment_intent_id) {
        const { data:confirmed, error:confirmErr } = await supabase.functions.invoke('formacorp-state-fee-confirm', {
          body:{
            caseId:caseRecord.id,
            paymentIntentId:data.payment_intent_id,
            expectedAmount:Number(amount),
          }
        })
        if (confirmErr || confirmed?.error) throw new Error(confirmed?.error || confirmErr?.message || 'Could not recover completed payment')
        onPaid?.(confirmed)
        return
      }

      const pk=String(data?.publishable_key || '').trim()
      if (!pk) throw new Error('Stripe publishable key is not configured for this office.')
      if (!data?.client_secret || !data?.payment_intent_id) throw new Error('Payment session is incomplete.')
      setPublishableKey(pk)
      setStripeAccount(data?.stripe_account || null)
      setClientSecret(data.client_secret)
      setPaymentIntentId(data.payment_intent_id)
    } catch(e) {
      setErr(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  return <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&onClose?.()}>
    <div className="modal" style={{width:480,maxWidth:'95vw'}}>
      <div className="mh"><span className="mt">💳 State Filing Funds — {caseRecord.entity_name}</span><button className="xbtn" onClick={onClose}>&times;</button></div>
      <div style={{fontSize:12,color:'var(--t3)',lineHeight:1.55,marginBottom:14}}>
        Collect the exact government filing amount inside FormaCorp. This payment is recorded against the formation case so the office can remit the government fee through the supported state filing method. FormaCorp does not add a service fee.
      </div>
      <div className="card" style={{padding:'10px 12px',marginBottom:14,background:'var(--s2)'}}>
        <div className="dr"><span className="dl">Government filing amount</span><span className="dv">{'$' + Number(amount||0).toFixed(2)}</span></div>
        <div className="dr"><span className="dl">FormaCorp add-on fee</span><span className="dv">$0.00</span></div>
      </div>
      {loading && <div style={{fontSize:12,color:'var(--t3)'}}>Loading secure payment form…</div>}
      {err && <div style={{color:'var(--bad)',fontSize:12,lineHeight:1.5}}>{err}<div style={{marginTop:12}}><button className="btn" onClick={start}>Retry</button></div></div>}
      {!loading && !err && clientSecret && <Elements stripe={getStripe(publishableKey,stripeAccount)} options={{clientSecret}}>
        <PayForm caseRecord={caseRecord} amount={amount} paymentIntentId={paymentIntentId} onClose={onClose} onPaid={onPaid}/>
      </Elements>}
    </div>
  </div>
}
