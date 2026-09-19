import { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { supabase } from '../../lib/supabase'

let stripePromise = null
function getStripe(pk) {
  if (!stripePromise) stripePromise = loadStripe(pk)
  return stripePromise
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

  useEffect(()=>{ start() },[])

  async function start() {
    setLoading(true); setErr('')
    try {
      const { data:s, error:sErr } = await supabase.from('settings').select('stripe_publishable_key,payment_provider').limit(1).maybeSingle()
      if (sErr) throw sErr
      if (s?.payment_provider !== 'stripe' || !s?.stripe_publishable_key) throw new Error('Stripe is not connected for this office in Settings.')
      setPublishableKey(s.stripe_publishable_key)

      const { data, error } = await supabase.functions.invoke('formacorp-state-fee-intent', {
        body:{ caseId:caseRecord.id, amount:Number(amount) }
      })
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not start payment')
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
      {!loading && !err && clientSecret && <Elements stripe={getStripe(publishableKey)} options={{clientSecret}}>
        <PayForm caseRecord={caseRecord} amount={amount} paymentIntentId={paymentIntentId} onClose={onClose} onPaid={onPaid}/>
      </Elements>}
    </div>
  </div>
}
